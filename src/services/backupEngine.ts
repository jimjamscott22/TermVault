import {
  BackupMode,
  BackupRunProgress,
  PortableEncryptedBundle,
  SnapshotFileEntry,
  SnapshotManifestPayload,
  SourceFile,
  StoredChunk,
  StoredSnapshot,
  TerminalLogLevel,
} from '../types/backup';
import {
  base64ToBytes,
  bytesToUtf8,
  decryptPayload,
  encryptPayload,
  formatBytes,
  sha256Hex,
  splitIntoChunks,
  utf8ToBytes,
} from './cryptoEngine';
import {
  getAllChunks,
  getAllSnapshots,
  getChunk,
  getSnapshot,
  putChunksBatch,
  putSnapshot,
} from './localVault';

export interface RunBackupOptions {
  sources: SourceFile[];
  passphrase: string;
  mode: BackupMode;
  label?: string;
  hostname: string;
  compressionEnabled: boolean;
  onProgress: (progress: BackupRunProgress) => void;
  onLog: (level: TerminalLogLevel, message: string) => void;
}

function sourceToBytes(file: SourceFile): Uint8Array {
  return file.encoding === 'base64' ? base64ToBytes(file.content) : utf8ToBytes(file.content);
}

function makeSnapshotId(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const rand = Math.random().toString(16).slice(2, 6);
  return `snap-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
}

export async function decryptSnapshotManifest(
  snapshot: StoredSnapshot,
  passphrase: string
): Promise<SnapshotManifestPayload> {
  const bytes = await decryptPayload(snapshot.manifestEnvelope, passphrase);
  return JSON.parse(bytesToUtf8(bytes)) as SnapshotManifestPayload;
}

export async function computePendingDiff(
  sources: SourceFile[],
  latestSnapshot: StoredSnapshot | undefined,
  passphrase: string
): Promise<{ added: string[]; modified: string[]; deleted: string[]; unchanged: string[] }> {
  const included = sources.filter((f) => f.included);
  if (!latestSnapshot) {
    return {
      added: included.map((f) => f.path),
      modified: [],
      deleted: [],
      unchanged: [],
    };
  }

  let prevManifest: SnapshotManifestPayload | null = null;
  try {
    prevManifest = await decryptSnapshotManifest(latestSnapshot, passphrase);
  } catch {
    return {
      added: included.map((f) => f.path),
      modified: [],
      deleted: [],
      unchanged: [],
    };
  }

  const prevMap = new Map(prevManifest.files.map((f) => [f.path, f]));
  const currentPaths = new Set<string>();
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  for (const file of included) {
    currentPaths.add(file.path);
    const prev = prevMap.get(file.path);
    const hash = await sha256Hex(sourceToBytes(file));
    if (!prev) {
      added.push(file.path);
    } else if (prev.sha256 !== hash) {
      modified.push(file.path);
    } else {
      unchanged.push(file.path);
    }
  }

  const deleted: string[] = [];
  for (const prevPath of prevMap.keys()) {
    if (!currentPaths.has(prevPath)) {
      deleted.push(prevPath);
    }
  }

  return { added, modified, deleted, unchanged };
}

export async function runBackupJob(options: RunBackupOptions): Promise<StoredSnapshot> {
  const {
    sources,
    passphrase,
    mode,
    label,
    hostname,
    compressionEnabled,
    onProgress,
    onLog,
  } = options;

  const includedFiles = sources.filter((f) => f.included);
  if (includedFiles.length === 0) {
    throw new Error('No source files are selected for backup.');
  }

  const startTime = performance.now();
  const totalBytes = includedFiles.reduce((acc, f) => acc + f.size, 0);

  onLog('info', `Starting ${mode} backup on host ${hostname} (${includedFiles.length} files, ${formatBytes(totalBytes)})`);
  onProgress({
    active: true,
    phase: 'scanning',
    percent: 8,
    currentPath: 'Scanning filesystem index',
    filesProcessed: 0,
    totalFiles: includedFiles.length,
    bytesProcessed: 0,
    totalBytes,
    throughputMBs: 0,
  });

  const existingSnapshots = await getAllSnapshots();
  const parentSnapshot = mode === 'incremental' ? existingSnapshots[0] ?? null : null;
  let prevFilesMap = new Map<string, SnapshotFileEntry>();

  if (parentSnapshot) {
    try {
      const parentManifest = await decryptSnapshotManifest(parentSnapshot, passphrase);
      prevFilesMap = new Map(parentManifest.files.map((f) => [f.path, f]));
      onLog('info', `Loaded parent baseline ${parentSnapshot.id} (${parentManifest.files.length} tracked entries)`);
    } catch {
      onLog('warn', `Could not decrypt parent ${parentSnapshot.id} with current key; falling back to full block scan`);
    }
  }

  const existingChunks = await getAllChunks();
  const existingChunkMap = new Map(existingChunks.map((c) => [c.hash, c]));

  const manifestFiles: SnapshotFileEntry[] = [];
  const newChunksToPersist: StoredChunk[] = [];
  const snapshotChunkHashSet = new Set<string>();

  let addedCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;
  let newChunkCount = 0;
  let reusedChunkCount = 0;
  let newDeltaBytes = 0;
  let storedEncryptedBytes = 0;
  let dedupSavedBytes = 0;
  let bytesProcessed = 0;

  for (let i = 0; i < includedFiles.length; i++) {
    const file = includedFiles[i];
    const fileBytes = sourceToBytes(file);
    const fileHash = await sha256Hex(fileBytes);
    const prevEntry = prevFilesMap.get(file.path);

    let diffStatus: SnapshotFileEntry['diffStatus'];
    if (!prevEntry) {
      diffStatus = 'added';
      addedCount++;
    } else if (prevEntry.sha256 !== fileHash) {
      diffStatus = 'modified';
      modifiedCount++;
    } else {
      diffStatus = 'unchanged';
      unchangedCount++;
    }

    const chunks = splitIntoChunks(fileBytes);
    const fileChunkHashes: string[] = [];

    for (const chunkBytes of chunks) {
      const chunkHash = await sha256Hex(chunkBytes);
      fileChunkHashes.push(chunkHash);
      snapshotChunkHashSet.add(chunkHash);

      const alreadyInVault = existingChunkMap.has(chunkHash);
      const alreadyQueued = newChunksToPersist.some((c) => c.hash === chunkHash);

      if (alreadyInVault || alreadyQueued) {
        reusedChunkCount++;
        dedupSavedBytes += chunkBytes.byteLength;
      } else {
        const envelope = await encryptPayload(chunkBytes, passphrase, compressionEnabled);
        const storedChunk: StoredChunk = {
          hash: chunkHash,
          rawBytes: chunkBytes.byteLength,
          storedBytes: envelope.encryptedBytes,
          envelope,
          createdAt: envelope.createdAt,
        };
        newChunksToPersist.push(storedChunk);
        existingChunkMap.set(chunkHash, storedChunk);
        newChunkCount++;
        newDeltaBytes += chunkBytes.byteLength;
        storedEncryptedBytes += envelope.encryptedBytes;
      }
    }

    manifestFiles.push({
      path: file.path,
      name: file.name,
      directory: file.directory,
      mimeType: file.mimeType,
      encoding: file.encoding,
      permissions: file.permissions,
      size: fileBytes.byteLength,
      lastModified: file.lastModified,
      sha256: fileHash,
      chunkHashes: fileChunkHashes,
      diffStatus,
    });

    bytesProcessed += fileBytes.byteLength;
    const elapsedSec = Math.max((performance.now() - startTime) / 1000, 0.005);
    const throughputMBs = Number(((bytesProcessed / (1024 * 1024)) / elapsedSec).toFixed(2));
    const percent = Math.min(82, 12 + Math.round(((i + 1) / includedFiles.length) * 70));

    onProgress({
      active: true,
      phase: diffStatus === 'unchanged' ? 'chunking' : 'encrypting',
      percent,
      currentPath: file.path,
      filesProcessed: i + 1,
      totalFiles: includedFiles.length,
      bytesProcessed,
      totalBytes,
      throughputMBs,
    });
  }

  const currentPathSet = new Set(includedFiles.map((f) => f.path));
  const deletedPaths: string[] = [];
  for (const prevPath of prevFilesMap.keys()) {
    if (!currentPathSet.has(prevPath)) {
      deletedPaths.push(prevPath);
    }
  }

  onProgress({
    active: true,
    phase: 'committing',
    percent: 90,
    currentPath: 'Encrypting snapshot manifest & committing to vault',
    filesProcessed: includedFiles.length,
    totalFiles: includedFiles.length,
    bytesProcessed: totalBytes,
    totalBytes,
    throughputMBs: Number(
      ((totalBytes / (1024 * 1024)) / Math.max((performance.now() - startTime) / 1000, 0.005)).toFixed(2)
    ),
  });

  const snapshotId = makeSnapshotId();
  const createdAt = new Date().toISOString();
  const manifestPayload: SnapshotManifestPayload = {
    id: snapshotId,
    label: label?.trim() || (mode === 'full' ? 'Full System Snapshot' : 'Incremental Delta Snapshot'),
    hostname,
    mode,
    parentId: parentSnapshot ? parentSnapshot.id : null,
    createdAt,
    files: manifestFiles,
    deletedPaths,
  };

  const manifestBytes = utf8ToBytes(JSON.stringify(manifestPayload));
  const manifestEnvelope = await encryptPayload(manifestBytes, passphrase, compressionEnabled);
  storedEncryptedBytes += manifestEnvelope.encryptedBytes;

  await putChunksBatch(newChunksToPersist);

  const durationMs = Math.max(1, Math.round(performance.now() - startTime));
  const throughputMBs = Number(
    ((Math.max(totalBytes, 1024) / (1024 * 1024)) / Math.max(durationMs / 1000, 0.005)).toFixed(2)
  );
  const totalChunksTouched = newChunkCount + reusedChunkCount;
  const dedupRatioPercent =
    totalChunksTouched > 0 ? Math.round((reusedChunkCount / totalChunksTouched) * 100) : 0;

  const snapshotRecord: StoredSnapshot = {
    id: snapshotId,
    label: manifestPayload.label,
    hostname,
    mode,
    parentId: parentSnapshot ? parentSnapshot.id : null,
    createdAt,
    fileCount: manifestFiles.length,
    addedCount,
    modifiedCount,
    unchangedCount,
    deletedCount: deletedPaths.length,
    totalRawBytes: totalBytes,
    newDeltaBytes,
    storedEncryptedBytes,
    dedupSavedBytes,
    dedupRatioPercent,
    chunkCount: snapshotChunkHashSet.size,
    newChunkCount,
    reusedChunkCount,
    durationMs,
    throughputMBs,
    manifestSha256: manifestEnvelope.plaintextSha256,
    manifestEnvelope,
    chunkHashes: Array.from(snapshotChunkHashSet),
    cloudSync: {
      synced: false,
      driveFileId: null,
      driveFileName: null,
      syncedAt: null,
    },
    verifiedAt: createdAt,
    verificationStatus: 'verified',
  };

  await putSnapshot(snapshotRecord);

  onLog(
    'crypto',
    `Encrypted ${newChunkCount} new chunks (${reusedChunkCount} deduplicated, ${dedupRatioPercent}% reuse) via AES-256-GCM`
  );
  onLog(
    'success',
    `Committed ${snapshotId} · +${addedCount} added, ~${modifiedCount} modified, ${unchangedCount} unchanged · ${formatBytes(storedEncryptedBytes)} stored in ${durationMs}ms`
  );

  onProgress({
    active: false,
    phase: 'complete',
    percent: 100,
    currentPath: `Snapshot ${snapshotId} ready`,
    filesProcessed: includedFiles.length,
    totalFiles: includedFiles.length,
    bytesProcessed: totalBytes,
    totalBytes,
    throughputMBs,
  });

  return snapshotRecord;
}

export async function verifySnapshotIntegrity(
  snapshotId: string,
  passphrase: string,
  onLog?: (level: TerminalLogLevel, msg: string) => void
): Promise<{ verified: boolean; checkedChunks: number; error?: string }> {
  const snapshot = await getSnapshot(snapshotId);
  if (!snapshot) {
    return { verified: false, checkedChunks: 0, error: 'Snapshot not found in local vault.' };
  }

  try {
    onLog?.('crypto', `Verifying AES-256-GCM auth tags & SHA-256 digests for ${snapshotId}...`);
    const manifest = await decryptSnapshotManifest(snapshot, passphrase);
    let checkedChunks = 0;

    for (const hash of snapshot.chunkHashes) {
      const chunk = await getChunk(hash);
      if (!chunk) {
        throw new Error(`Missing encrypted chunk ${hash.slice(0, 12)} in local store.`);
      }
      const decrypted = await decryptPayload(chunk.envelope, passphrase);
      const actualHash = await sha256Hex(decrypted);
      if (actualHash !== hash) {
        throw new Error(`Hash mismatch on chunk ${hash.slice(0, 12)}.`);
      }
      checkedChunks++;
    }

    const updated: StoredSnapshot = {
      ...snapshot,
      verifiedAt: new Date().toISOString(),
      verificationStatus: 'verified',
    };
    await putSnapshot(updated);
    onLog?.(
      'success',
      `Integrity OK: ${snapshotId} (${manifest.files.length} files, ${checkedChunks} encrypted blocks verified)`
    );
    return { verified: true, checkedChunks };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    const updated: StoredSnapshot = {
      ...snapshot,
      verifiedAt: new Date().toISOString(),
      verificationStatus: 'failed',
    };
    await putSnapshot(updated);
    onLog?.('error', `Integrity check failed for ${snapshotId}: ${message}`);
    return { verified: false, checkedChunks: 0, error: message };
  }
}

export async function decryptFileFromSnapshot(
  snapshot: StoredSnapshot,
  entry: SnapshotFileEntry,
  passphrase: string
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let totalLen = 0;

  for (const hash of entry.chunkHashes) {
    const chunk = await getChunk(hash);
    if (!chunk) {
      throw new Error(`Missing chunk ${hash.slice(0, 10)} needed to reconstruct ${entry.path}`);
    }
    const plainChunk = await decryptPayload(chunk.envelope, passphrase);
    parts.push(plainChunk);
    totalLen += plainChunk.byteLength;
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  const hash = await sha256Hex(combined);
  if (hash !== entry.sha256) {
    throw new Error(`Reconstructed file checksum mismatch for ${entry.path}`);
  }
  return combined;
}

export async function buildPortableBundle(snapshot: StoredSnapshot): Promise<PortableEncryptedBundle> {
  const chunksMap: Record<string, StoredChunk> = {};
  for (const hash of snapshot.chunkHashes) {
    const chunk = await getChunk(hash);
    if (chunk) {
      chunksMap[hash] = chunk;
    }
  }

  return {
    bundleVersion: 1,
    snapshotId: snapshot.id,
    label: snapshot.label,
    hostname: snapshot.hostname,
    mode: snapshot.mode,
    parentId: snapshot.parentId,
    createdAt: snapshot.createdAt,
    manifestSha256: snapshot.manifestSha256,
    stats: {
      fileCount: snapshot.fileCount,
      addedCount: snapshot.addedCount,
      modifiedCount: snapshot.modifiedCount,
      unchangedCount: snapshot.unchangedCount,
      deletedCount: snapshot.deletedCount,
      totalRawBytes: snapshot.totalRawBytes,
      newDeltaBytes: snapshot.newDeltaBytes,
      storedEncryptedBytes: snapshot.storedEncryptedBytes,
      dedupSavedBytes: snapshot.dedupSavedBytes,
      dedupRatioPercent: snapshot.dedupRatioPercent,
      chunkCount: snapshot.chunkCount,
      newChunkCount: snapshot.newChunkCount,
      reusedChunkCount: snapshot.reusedChunkCount,
      durationMs: snapshot.durationMs,
      throughputMBs: snapshot.throughputMBs,
    },
    manifestEnvelope: snapshot.manifestEnvelope,
    chunks: chunksMap,
  };
}

export async function importPortableBundleToLocalVault(
  bundle: PortableEncryptedBundle,
  driveMeta?: { driveFileId: string; driveFileName: string; syncedAt: string }
): Promise<StoredSnapshot> {
  const chunksList = Object.values(bundle.chunks);
  await putChunksBatch(chunksList);

  const snapshot: StoredSnapshot = {
    id: bundle.snapshotId,
    label: bundle.label,
    hostname: bundle.hostname,
    mode: bundle.mode,
    parentId: bundle.parentId,
    createdAt: bundle.createdAt,
    ...bundle.stats,
    manifestSha256: bundle.manifestSha256,
    manifestEnvelope: bundle.manifestEnvelope,
    chunkHashes: Object.keys(bundle.chunks),
    cloudSync: driveMeta
      ? {
          synced: true,
          driveFileId: driveMeta.driveFileId,
          driveFileName: driveMeta.driveFileName,
          syncedAt: driveMeta.syncedAt,
        }
      : {
          synced: false,
          driveFileId: null,
          driveFileName: null,
          syncedAt: null,
        },
    verifiedAt: null,
    verificationStatus: 'unverified',
  };

  await putSnapshot(snapshot);
  return snapshot;
}
