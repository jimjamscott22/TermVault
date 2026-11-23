export type NavSection = 'overview' | 'sources' | 'snapshots' | 'cloud' | 'vault';

export type BackupMode = 'incremental' | 'full';

export type FileDiffStatus = 'added' | 'modified' | 'unchanged' | 'deleted';

export interface SourceFile {
  path: string;
  directory: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  /** UTF-8 text content for text/config files or base64 for binary uploads */
  encoding: 'utf8' | 'base64';
  content: string;
  included: boolean;
  permissions: string;
}

export interface EncryptedArchiveEnvelope {
  format: 'termvault-aes256gcm-v1';
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  compression: 'gzip' | 'none';
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  plaintextSha256: string;
  rawBytes: number;
  compressedBytes: number;
  encryptedBytes: number;
  createdAt: string;
}

export interface StoredChunk {
  hash: string;
  rawBytes: number;
  storedBytes: number;
  envelope: EncryptedArchiveEnvelope;
  createdAt: string;
}

export interface SnapshotFileEntry {
  path: string;
  name: string;
  directory: string;
  mimeType: string;
  encoding: 'utf8' | 'base64';
  permissions: string;
  size: number;
  lastModified: number;
  sha256: string;
  chunkHashes: string[];
  diffStatus: FileDiffStatus;
}

export interface SnapshotManifestPayload {
  id: string;
  label: string;
  hostname: string;
  mode: BackupMode;
  parentId: string | null;
  createdAt: string;
  files: SnapshotFileEntry[];
  deletedPaths: string[];
}

export interface StoredSnapshot {
  id: string;
  label: string;
  hostname: string;
  mode: BackupMode;
  parentId: string | null;
  createdAt: string;
  fileCount: number;
  addedCount: number;
  modifiedCount: number;
  unchangedCount: number;
  deletedCount: number;
  totalRawBytes: number;
  newDeltaBytes: number;
  storedEncryptedBytes: number;
  dedupSavedBytes: number;
  dedupRatioPercent: number;
  chunkCount: number;
  newChunkCount: number;
  reusedChunkCount: number;
  durationMs: number;
  throughputMBs: number;
  manifestSha256: string;
  manifestEnvelope: EncryptedArchiveEnvelope;
  /** Self-contained encrypted bundle references for Drive/export */
  chunkHashes: string[];
  cloudSync: {
    synced: boolean;
    driveFileId: string | null;
    driveFileName: string | null;
    syncedAt: string | null;
  };
  verifiedAt: string | null;
  verificationStatus: 'unverified' | 'verified' | 'failed';
}

/** Portable encrypted archive format uploaded to Google Drive or exported to disk */
export interface PortableEncryptedBundle {
  bundleVersion: 1;
  snapshotId: string;
  label: string;
  hostname: string;
  mode: BackupMode;
  parentId: string | null;
  createdAt: string;
  manifestSha256: string;
  stats: {
    fileCount: number;
    addedCount: number;
    modifiedCount: number;
    unchangedCount: number;
    deletedCount: number;
    totalRawBytes: number;
    newDeltaBytes: number;
    storedEncryptedBytes: number;
    dedupSavedBytes: number;
    dedupRatioPercent: number;
    chunkCount: number;
    newChunkCount: number;
    reusedChunkCount: number;
    durationMs: number;
    throughputMBs: number;
  };
  manifestEnvelope: EncryptedArchiveEnvelope;
  chunks: Record<string, StoredChunk>;
}

export interface DriveSnapshotFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  appProperties?: {
    snapshotId?: string;
    mode?: string;
    fileCount?: string;
    hostname?: string;
    manifestSha256?: string;
    label?: string;
  };
}

export type TerminalLogLevel = 'info' | 'success' | 'warn' | 'error' | 'cmd' | 'crypto' | 'cloud';

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  level: TerminalLogLevel;
  message: string;
}

export interface BackupRunProgress {
  active: boolean;
  phase: 'idle' | 'scanning' | 'chunking' | 'encrypting' | 'committing' | 'syncing' | 'complete' | 'error';
  percent: number;
  currentPath: string;
  filesProcessed: number;
  totalFiles: number;
  bytesProcessed: number;
  totalBytes: number;
  throughputMBs: number;
}

export interface SyncSettings {
  autoSyncOnBackup: boolean;
  intervalMinutes: 0 | 5 | 15 | 60;
  hostname: string;
  compressionEnabled: boolean;
  retentionKeepCount: number;
}

export interface ConfirmDialogConfig {
  title: string;
  description: string;
  affectedItems?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}
