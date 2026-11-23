/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Cloud,
  FolderTree,
  History,
  KeyRound,
  LayoutDashboard,
  Menu,
  Play,
  Terminal,
  X,
} from 'lucide-react';
import {
  BackupMode,
  BackupRunProgress,
  ConfirmDialogConfig,
  DriveSnapshotFile,
  EncryptedArchiveEnvelope,
  NavSection,
  PortableEncryptedBundle,
  SnapshotFileEntry,
  SnapshotManifestPayload,
  SourceFile,
  StoredSnapshot,
  SyncSettings,
  TerminalLogEntry,
  TerminalLogLevel,
} from './types/backup';
import {
  bytesToBase64,
  bytesToUtf8,
  createPassphraseCheckToken,
  formatBytes,
  verifyPassphraseCheckToken,
} from './services/cryptoEngine';
import {
  clearVaultData,
  deleteLocalSnapshot,
  deleteSource,
  ensureInitialSources,
  getAllChunks,
  getAllSnapshots,
  putSnapshot,
  putSource,
  putSourcesBatch,
} from './services/localVault';
import {
  buildPortableBundle,
  computePendingDiff,
  decryptFileFromSnapshot,
  decryptSnapshotManifest,
  importPortableBundleToLocalVault,
  runBackupJob,
  verifySnapshotIntegrity,
} from './services/backupEngine';
import {
  clearCachedToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logoutGoogle,
} from './services/googleAuth';
import {
  deleteRemoteSnapshotFromDrive,
  downloadRemoteSnapshotFromDrive,
  ensureBackupFolder,
  listRemoteSnapshots,
  uploadEncryptedSnapshotToDrive,
} from './services/googleDrive';
import { OverviewView } from './components/OverviewView';
import { SourcesView } from './components/SourcesView';
import { SnapshotsView } from './components/SnapshotsView';
import { CloudSyncView } from './components/CloudSyncView';
import { VaultEncryptionView } from './components/VaultEncryptionView';
import { ConfirmDialog } from './components/ConfirmDialog';

const SETTINGS_STORAGE_KEY = 'termvault_settings_v1';
const SENTINEL_STORAGE_KEY = 'termvault_key_sentinel_v1';
const DEFAULT_PASSPHRASE = 'termvault-linux-local-key';

const DEFAULT_SETTINGS: SyncSettings = {
  autoSyncOnBackup: true,
  intervalMinutes: 15,
  hostname: 'arch-workstation-01',
  compressionEnabled: true,
  retentionKeepCount: 30,
};

function loadSavedSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SyncSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function nowTimeStr(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sources', label: 'Sources & Files', icon: FolderTree },
  { id: 'snapshots', label: 'Snapshots', icon: History },
  { id: 'cloud', label: 'Cloud Sync', icon: Cloud },
  { id: 'vault', label: 'Vault Encryption', icon: KeyRound },
];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Core Vault State
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [totalChunkRawBytes, setTotalChunkRawBytes] = useState(0);
  const [totalChunkStoredBytes, setTotalChunkStoredBytes] = useState(0);
  const [pendingDiff, setPendingDiff] = useState<{
    added: string[];
    modified: string[];
    deleted: string[];
    unchanged: string[];
  }>({ added: [], modified: [], deleted: [], unchanged: [] });

  // Encryption Key State (passphrase stays in memory only)
  const [passphrase, setPassphrase] = useState<string>(DEFAULT_PASSPHRASE);
  const [vaultLocked, setVaultLocked] = useState(false);

  // Settings
  const [syncSettings, setSyncSettings] = useState<SyncSettings>(loadSavedSettings);

  // Google Drive Auth & Cloud State
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<DriveSnapshotFile[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [nextAutoSyncSeconds, setNextAutoSyncSeconds] = useState<number | null>(null);

  // Operational Status & Logs
  const [busySnapshotId, setBusySnapshotId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BackupRunProgress>({
    active: false,
    phase: 'idle',
    percent: 0,
    currentPath: '',
    filesProcessed: 0,
    totalFiles: 0,
    bytesProcessed: 0,
    totalBytes: 0,
    throughputMBs: 0,
  });
  const [logs, setLogs] = useState<TerminalLogEntry[]>([
    {
      id: 'boot-1',
      timestamp: nowTimeStr(),
      level: 'info',
      message: 'TermVault backup daemon initialized (Web Crypto AES-256-GCM + SHA-256 deduplication)',
    },
    {
      id: 'boot-2',
      timestamp: nowTimeStr(),
      level: 'info',
      message: 'Local encrypted IndexedDB vault mounted at /var/lib/termvault · Type "help" for CLI commands',
    },
  ]);

  // Confirmation Dialog
  const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig | null>(null);

  const appendLog = useCallback((level: TerminalLogLevel, message: string) => {
    setLogs((prev) => [
      ...prev.slice(-199),
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        timestamp: nowTimeStr(),
        level,
        message,
      },
    ]);
  }, []);

  const refreshVaultState = useCallback(async () => {
    const [loadedSources, loadedSnapshots, loadedChunks] = await Promise.all([
      ensureInitialSources(),
      getAllSnapshots(),
      getAllChunks(),
    ]);
    setSources(loadedSources);
    setSnapshots(loadedSnapshots);
    setChunkCount(loadedChunks.length);
    setTotalChunkRawBytes(loadedChunks.reduce((acc, c) => acc + c.rawBytes, 0));
    setTotalChunkStoredBytes(loadedChunks.reduce((acc, c) => acc + c.storedBytes, 0));
  }, []);

  // Initialize local vault & sentinel token
  useEffect(() => {
    refreshVaultState().catch((err) => {
      appendLog('error', `Failed to mount local vault: ${err instanceof Error ? err.message : String(err)}`);
    });

    const existingSentinel = localStorage.getItem(SENTINEL_STORAGE_KEY);
    if (!existingSentinel) {
      createPassphraseCheckToken(DEFAULT_PASSPHRASE)
        .then((token) => localStorage.setItem(SENTINEL_STORAGE_KEY, JSON.stringify(token)))
        .catch(() => {});
    }
  }, [refreshVaultState, appendLog]);

  // Recompute real SHA-256 incremental pending diff whenever sources or latest snapshot change
  useEffect(() => {
    if (vaultLocked) return;
    let cancelled = false;
    computePendingDiff(sources, snapshots[0], passphrase)
      .then((diff) => {
        if (!cancelled) setPendingDiff(diff);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sources, snapshots, passphrase, vaultLocked]);

  // Persist non-sensitive sync settings
  const handleUpdateSettings = useCallback((patch: Partial<SyncSettings>) => {
    setSyncSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  // Google Drive refresh helper
  const refreshRemoteDrive = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride ?? getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }

      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const folder = await ensureBackupFolder(token);
        setDriveFolderId(folder.id);
        if (folder.created) {
          appendLog('cloud', 'Created "TermVault Backups" folder in Google Drive');
        }
        const files = await listRemoteSnapshots(token, folder.id);
        setRemoteFiles(files);
        appendLog('cloud', `Indexed ${files.length} remote encrypted archive(s) from Google Drive`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to list Google Drive backups';
        if (msg.startsWith('AUTH_EXPIRED')) {
          clearCachedToken();
          setNeedsAuth(true);
        }
        setRemoteError(msg);
        appendLog('error', msg);
      } finally {
        setRemoteLoading(false);
      }
    },
    [appendLog]
  );

  // Firebase Auth state listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser, token) => {
        setUser(authUser);
        setNeedsAuth(false);
        refreshRemoteDrive(token);
      },
      (authUser) => {
        setUser(authUser);
        setNeedsAuth(true);
        setRemoteFiles([]);
        setDriveFolderId(null);
      }
    );
    return unsubscribe;
  }, [refreshRemoteDrive]);

  const handleGoogleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setRemoteError(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setNeedsAuth(false);
      appendLog('cloud', `Authenticated Google Drive session for ${result.user.email ?? 'user'}`);
      await refreshRemoteDrive(result.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in cancelled or failed.';
      setRemoteError(msg);
      appendLog('error', `Google Drive sign-in failed: ${msg}`);
    } finally {
      setIsSigningIn(false);
    }
  }, [appendLog, refreshRemoteDrive]);

  const handleGoogleSignOut = useCallback(async () => {
    await logoutGoogle();
    setUser(null);
    setNeedsAuth(true);
    setDriveFolderId(null);
    setRemoteFiles([]);
    appendLog('cloud', 'Signed out of Google Drive; cleared in-memory access token');
  }, [appendLog]);

  // Execute actual upload to Drive (called directly for brand-new snapshot files, or via confirmation modal for overwrites)
  const executeUploadSnapshot = useCallback(
    async (snapshot: StoredSnapshot, existingDriveFileId?: string | null) => {
      const token = getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        appendLog('warn', 'Google Drive sign-in required before uploading snapshots');
        return;
      }

      setBusySnapshotId(snapshot.id);
      setSyncingNow(true);
      try {
        const folderId = driveFolderId ?? (await ensureBackupFolder(token)).id;
        setDriveFolderId(folderId);
        appendLog(
          'cloud',
          `${existingDriveFileId ? 'Updating' : 'Uploading'} encrypted archive ${snapshot.id}.tva.enc.json to Google Drive...`
        );

        const bundle = await buildPortableBundle(snapshot);
        const uploaded = await uploadEncryptedSnapshotToDrive(
          token,
          folderId,
          bundle,
          existingDriveFileId
        );

        const updatedSnap: StoredSnapshot = {
          ...snapshot,
          cloudSync: {
            synced: true,
            driveFileId: uploaded.id,
            driveFileName: uploaded.name,
            syncedAt: uploaded.modifiedTime,
          },
        };
        await putSnapshot(updatedSnap);
        await refreshVaultState();
        await refreshRemoteDrive(token);
        appendLog(
          'success',
          `Synced ${uploaded.name} (${formatBytes(uploaded.size)}) to Google Drive`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Drive upload failed';
        if (msg.startsWith('AUTH_EXPIRED')) {
          clearCachedToken();
          setNeedsAuth(true);
        }
        appendLog('error', msg);
      } finally {
        setBusySnapshotId(null);
        setSyncingNow(false);
      }
    },
    [driveFolderId, appendLog, refreshVaultState, refreshRemoteDrive]
  );

  // Sync a single snapshot (with mandatory confirmation if overwriting an existing remote file)
  const handleSyncSnapshotToDrive = useCallback(
    async (snapshot: StoredSnapshot) => {
      const token = getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        setActiveNav('cloud');
        appendLog('warn', 'Sign in with Google Drive to sync snapshots.');
        return;
      }

      const existingRemote = remoteFiles.find(
        (f) =>
          f.id === snapshot.cloudSync.driveFileId ||
          f.appProperties?.snapshotId === snapshot.id ||
          f.name === `${snapshot.id}.tva.enc.json`
      );

      if (existingRemote) {
        setConfirmConfig({
          title: 'Overwrite existing snapshot in Google Drive?',
          description:
            'This encrypted snapshot already exists in your "TermVault Backups" Google Drive folder. Confirm to replace the remote archive contents with your local copy.',
          affectedItems: [`${existingRemote.name} (Drive ID: ${existingRemote.id})`],
          confirmLabel: 'Overwrite Remote Archive',
          destructive: false,
          onConfirm: async () => {
            await executeUploadSnapshot(snapshot, existingRemote.id);
          },
        });
        return;
      }

      await executeUploadSnapshot(snapshot, null);
    },
    [remoteFiles, executeUploadSnapshot, appendLog]
  );

  // Sync all unsynced local snapshots
  const handleSyncAllPending = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      appendLog('warn', 'Cannot sync: Google Drive session not connected.');
      return;
    }

    const latestLocal = await getAllSnapshots();
    const pending = latestLocal.filter((s) => !s.cloudSync.synced);
    if (pending.length === 0) {
      appendLog('cloud', 'All local snapshots are already synchronized with Google Drive.');
      return;
    }

    setSyncingNow(true);
    try {
      const folderId = driveFolderId ?? (await ensureBackupFolder(token)).id;
      setDriveFolderId(folderId);
      const currentRemote = await listRemoteSnapshots(token, folderId);

      for (const snap of pending) {
        const exists = currentRemote.find(
          (f) => f.appProperties?.snapshotId === snap.id || f.name === `${snap.id}.tva.enc.json`
        );
        if (exists) {
          // Link metadata without silent overwrite
          await putSnapshot({
            ...snap,
            cloudSync: {
              synced: true,
              driveFileId: exists.id,
              driveFileName: exists.name,
              syncedAt: exists.modifiedTime,
            },
          });
          appendLog('cloud', `Linked existing Drive archive ${exists.name}`);
          continue;
        }
        const bundle = await buildPortableBundle(snap);
        const uploaded = await uploadEncryptedSnapshotToDrive(token, folderId, bundle, null);
        await putSnapshot({
          ...snap,
          cloudSync: {
            synced: true,
            driveFileId: uploaded.id,
            driveFileName: uploaded.name,
            syncedAt: uploaded.modifiedTime,
          },
        });
        appendLog('success', `Uploaded ${uploaded.name} (${formatBytes(uploaded.size)}) to Drive`);
      }

      await refreshVaultState();
      await refreshRemoteDrive(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch Drive sync failed';
      if (msg.startsWith('AUTH_EXPIRED')) {
        clearCachedToken();
        setNeedsAuth(true);
      }
      appendLog('error', msg);
    } finally {
      setSyncingNow(false);
    }
  }, [driveFolderId, appendLog, refreshVaultState, refreshRemoteDrive]);

  // Automated background periodic sync timer
  const syncPendingRef = useRef(handleSyncAllPending);
  syncPendingRef.current = handleSyncAllPending;

  useEffect(() => {
    if (needsAuth || syncSettings.intervalMinutes === 0) {
      setNextAutoSyncSeconds(null);
      return;
    }

    const totalSec = syncSettings.intervalMinutes * 60;
    let remaining = totalSec;
    setNextAutoSyncSeconds(remaining);

    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = totalSec;
        syncPendingRef.current();
      }
      setNextAutoSyncSeconds(remaining);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [needsAuth, syncSettings.intervalMinutes]);

  // Run backup job (incremental or full) + optional automatic Drive sync
  const handleRunBackup = useCallback(
    async (mode: BackupMode, label?: string) => {
      if (vaultLocked) {
        appendLog('error', 'Vault is locked. Unlock it in Vault Encryption before running backups.');
        setActiveNav('vault');
        return;
      }
      if (progress.active) return;

      try {
        const currentSources = await ensureInitialSources();
        const created = await runBackupJob({
          sources: currentSources,
          passphrase,
          mode,
          label,
          hostname: syncSettings.hostname,
          compressionEnabled: syncSettings.compressionEnabled,
          onProgress: setProgress,
          onLog: appendLog,
        });

        await refreshVaultState();

        if (syncSettings.autoSyncOnBackup && getAccessToken()) {
          setProgress((p) => ({
            ...p,
            active: true,
            phase: 'syncing',
            percent: 95,
            currentPath: `Syncing ${created.id} to Google Drive`,
          }));
          await executeUploadSnapshot(created, null);
          setProgress((p) => ({
            ...p,
            active: false,
            phase: 'complete',
            percent: 100,
            currentPath: `Snapshot ${created.id} backed up & synced to Google Drive`,
          }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Backup job failed';
        appendLog('error', msg);
        setProgress((p) => ({
          ...p,
          active: false,
          phase: 'error',
          currentPath: msg,
        }));
      }
    },
    [
      vaultLocked,
      progress.active,
      passphrase,
      syncSettings,
      appendLog,
      refreshVaultState,
      executeUploadSnapshot,
    ]
  );

  const handleVerifySnapshot = useCallback(
    async (snapshotId: string) => {
      if (vaultLocked) {
        appendLog('error', 'Unlock vault before verifying encrypted snapshots.');
        return;
      }
      setBusySnapshotId(snapshotId);
      try {
        await verifySnapshotIntegrity(snapshotId, passphrase, appendLog);
        await refreshVaultState();
      } finally {
        setBusySnapshotId(null);
      }
    },
    [vaultLocked, passphrase, appendLog, refreshVaultState]
  );

  const handleExportArchive = useCallback(
    async (snapshot: StoredSnapshot) => {
      setBusySnapshotId(snapshot.id);
      try {
        const bundle = await buildPortableBundle(snapshot);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${snapshot.id}.tva.enc.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        appendLog('info', `Exported offline encrypted bundle ${snapshot.id}.tva.enc.json`);
      } finally {
        setBusySnapshotId(null);
      }
    },
    [appendLog]
  );

  const handleImportArchiveFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const bundle = JSON.parse(text) as PortableEncryptedBundle;
        if (bundle.bundleVersion !== 1 || !bundle.manifestEnvelope) {
          throw new Error('Invalid TermVault archive format.');
        }
        const imported = await importPortableBundleToLocalVault(bundle);
        await refreshVaultState();
        appendLog(
          'success',
          `Imported offline encrypted snapshot ${imported.id} (${imported.chunkCount} blocks)`
        );
      } catch (err) {
        appendLog(
          'error',
          `Failed to import archive: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [refreshVaultState, appendLog]
  );

  const handlePullRemoteSnapshot = useCallback(
    async (file: DriveSnapshotFile) => {
      const token = getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setSyncingNow(true);
      try {
        appendLog('cloud', `Downloading ${file.name} from Google Drive...`);
        const bundle = await downloadRemoteSnapshotFromDrive(token, file.id);
        const imported = await importPortableBundleToLocalVault(bundle, {
          driveFileId: file.id,
          driveFileName: file.name,
          syncedAt: file.modifiedTime,
        });
        await refreshVaultState();
        appendLog(
          'success',
          `Pulled ${imported.id} into local encrypted vault (${Object.keys(bundle.chunks).length} chunks)`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to pull snapshot from Drive';
        if (msg.startsWith('AUTH_EXPIRED')) {
          clearCachedToken();
          setNeedsAuth(true);
        }
        appendLog('error', msg);
      } finally {
        setSyncingNow(false);
      }
    },
    [appendLog, refreshVaultState]
  );

  // Destructive actions — ALL strictly guarded by ConfirmDialog
  const handleRequestDeleteRemote = useCallback(
    (file: DriveSnapshotFile) => {
      setConfirmConfig({
        title: 'Delete encrypted snapshot from Google Drive?',
        description:
          'This permanently deletes the encrypted backup archive from your "TermVault Backups" folder in Google Drive. Your local copy (if present) will not be affected.',
        affectedItems: [`${file.name} (${formatBytes(file.size)})`],
        confirmLabel: 'Delete from Google Drive',
        destructive: true,
        onConfirm: async () => {
          const token = getAccessToken();
          if (!token) {
            setNeedsAuth(true);
            return;
          }
          setSyncingNow(true);
          try {
            await deleteRemoteSnapshotFromDrive(token, file.id);
            const snapId = file.appProperties?.snapshotId;
            if (snapId) {
              const allLocal = await getAllSnapshots();
              const match = allLocal.find(
                (s) => s.id === snapId || s.cloudSync.driveFileId === file.id
              );
              if (match) {
                await putSnapshot({
                  ...match,
                  cloudSync: {
                    synced: false,
                    driveFileId: null,
                    driveFileName: null,
                    syncedAt: null,
                  },
                });
              }
            }
            await refreshVaultState();
            await refreshRemoteDrive(token);
            appendLog('warn', `Deleted remote archive ${file.name} from Google Drive`);
          } finally {
            setSyncingNow(false);
          }
        },
      });
    },
    [refreshVaultState, refreshRemoteDrive, appendLog]
  );

  const handleRequestDeleteLocalSnapshot = useCallback(
    (snapshot: StoredSnapshot) => {
      setConfirmConfig({
        title: 'Delete snapshot from local encrypted vault?',
        description:
          'Removes this snapshot metadata and garbage-collects any unreferenced encrypted chunks from local IndexedDB storage. Remote Google Drive copies remain untouched.',
        affectedItems: [`${snapshot.id} (${snapshot.label} · ${formatBytes(snapshot.storedEncryptedBytes)})`],
        confirmLabel: 'Delete Local Snapshot',
        destructive: true,
        onConfirm: async () => {
          await deleteLocalSnapshot(snapshot.id);
          await refreshVaultState();
          appendLog('warn', `Deleted local snapshot ${snapshot.id} and ran chunk garbage collection`);
        },
      });
    },
    [refreshVaultState, appendLog]
  );

  const handleRequestDeleteSource = useCallback(
    (path: string) => {
      setConfirmConfig({
        title: 'Remove file from backup sources?',
        description:
          'Removes this path from the active backup source list. Previously committed encrypted snapshots still retain historical copies of this file.',
        affectedItems: [path],
        confirmLabel: 'Remove File',
        destructive: true,
        onConfirm: async () => {
          await deleteSource(path);
          await refreshVaultState();
          appendLog('info', `Removed ${path} from backup sources`);
        },
      });
    },
    [refreshVaultState, appendLog]
  );

  const handleRequestWipeLocalVault = useCallback(() => {
    setConfirmConfig({
      title: 'Wipe all local snapshots and encrypted chunks?',
      description:
        'This permanently erases all local snapshots and encrypted content-addressed blocks from this browser. Synced archives in Google Drive and your source files will not be deleted.',
      affectedItems: [
        `${snapshots.length} local snapshot(s)`,
        `${chunkCount} encrypted chunk block(s) (${formatBytes(totalChunkStoredBytes)})`,
      ],
      confirmLabel: 'Wipe Local Vault',
      destructive: true,
      onConfirm: async () => {
        await clearVaultData();
        await refreshVaultState();
        appendLog('warn', 'Wiped local encrypted IndexedDB vault (snapshots & chunks cleared)');
      },
    });
  }, [snapshots.length, chunkCount, totalChunkStoredBytes, refreshVaultState, appendLog]);

  // Source manipulation handlers
  const handleUpsertSource = useCallback(
    async (file: SourceFile) => {
      await putSource(file);
      await refreshVaultState();
      appendLog('info', `Updated source file ${file.path} (${formatBytes(file.size)})`);
    },
    [refreshVaultState, appendLog]
  );

  const handleAddSourcesBatch = useCallback(
    async (files: SourceFile[]) => {
      await putSourcesBatch(files);
      await refreshVaultState();
      appendLog('success', `Imported ${files.length} file(s) into backup source tree`);
    },
    [refreshVaultState, appendLog]
  );

  const handleToggleInclude = useCallback(
    async (path: string) => {
      const target = sources.find((s) => s.path === path);
      if (!target) return;
      await putSource({ ...target, included: !target.included });
      await refreshVaultState();
    },
    [sources, refreshVaultState]
  );

  // Snapshot inspection & decryption/restore
  const handleInspectSnapshot = useCallback(
    async (snapshot: StoredSnapshot): Promise<SnapshotManifestPayload | null> => {
      if (vaultLocked) {
        throw new Error('Vault is locked. Unlock it in Vault Encryption first.');
      }
      return decryptSnapshotManifest(snapshot, passphrase);
    },
    [vaultLocked, passphrase]
  );

  const handleRestoreFileToSources = useCallback(
    async (snapshot: StoredSnapshot, entry: SnapshotFileEntry) => {
      try {
        const plainBytes = await decryptFileFromSnapshot(snapshot, entry, passphrase);
        const restored: SourceFile = {
          path: entry.path,
          directory: entry.directory,
          name: entry.name,
          mimeType: entry.mimeType,
          size: plainBytes.byteLength,
          lastModified: Date.now(),
          encoding: entry.encoding,
          content:
            entry.encoding === 'base64' ? bytesToBase64(plainBytes) : bytesToUtf8(plainBytes),
          included: true,
          permissions: entry.permissions,
        };
        await putSource(restored);
        await refreshVaultState();
        appendLog(
          'success',
          `Decrypted & restored ${entry.path} from ${snapshot.id} (${formatBytes(plainBytes.byteLength)})`
        );
      } catch (err) {
        appendLog(
          'error',
          `Restore failed for ${entry.path}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [passphrase, refreshVaultState, appendLog]
  );

  const handleDownloadDecryptedFile = useCallback(
    async (snapshot: StoredSnapshot, entry: SnapshotFileEntry) => {
      try {
        const plainBytes = await decryptFileFromSnapshot(snapshot, entry, passphrase);
        const copy = new Uint8Array(plainBytes.byteLength);
        copy.set(plainBytes);
        const blob = new Blob([copy], { type: entry.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        appendLog('success', `Decrypted & downloaded ${entry.name} from ${snapshot.id}`);
      } catch (err) {
        appendLog(
          'error',
          `Download failed for ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [passphrase, appendLog]
  );

  // Vault key rotation / lock / unlock
  const handleUpdatePassphrase = useCallback(
    async (nextPassphrase: string) => {
      setPassphrase(nextPassphrase);
      const token = await createPassphraseCheckToken(nextPassphrase);
      localStorage.setItem(SENTINEL_STORAGE_KEY, JSON.stringify(token));
      appendLog('crypto', 'Rotated active PBKDF2-SHA256 / AES-256-GCM vault passphrase');
    },
    [appendLog]
  );

  const handleLockVault = useCallback(() => {
    setPassphrase('');
    setVaultLocked(true);
    appendLog('crypto', 'Vault locked; in-memory encryption key wiped');
  }, [appendLog]);

  const handleUnlockVault = useCallback(
    async (candidate: string): Promise<boolean> => {
      const raw = localStorage.getItem(SENTINEL_STORAGE_KEY);
      if (!raw) {
        setPassphrase(candidate);
        setVaultLocked(false);
        return true;
      }
      const token = JSON.parse(raw) as EncryptedArchiveEnvelope;
      const valid = await verifyPassphraseCheckToken(token, candidate);
      if (valid) {
        setPassphrase(candidate);
        setVaultLocked(false);
        appendLog('crypto', 'Vault unlocked via PBKDF2-SHA256 key verification');
        return true;
      }
      appendLog('error', 'Vault unlock rejected: invalid passphrase');
      return false;
    },
    [appendLog]
  );

  // Interactive Retro Terminal CLI interpreter
  const handleExecuteCommand = useCallback(
    async (rawCmd: string) => {
      appendLog('cmd', `$ ${rawCmd}`);
      const parts = rawCmd.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      switch (cmd) {
        case 'help':
          appendLog(
            'info',
            'Commands: status | diff | ls | backup [--full] | sync | verify [snapshot-id] | clear'
          );
          break;
        case 'clear':
          setLogs([]);
          break;
        case 'status':
          appendLog(
            'info',
            `host=${syncSettings.hostname} · sources=${sources.filter((s) => s.included).length}/${sources.length} · snapshots=${snapshots.length} · chunks=${chunkCount} (${formatBytes(totalChunkStoredBytes)}) · drive=${needsAuth ? 'disconnected' : user?.email ?? 'connected'}`
          );
          break;
        case 'ls':
          if (snapshots.length === 0) {
            appendLog('info', 'No snapshots in local vault.');
          } else {
            for (const s of snapshots.slice(0, 8)) {
              appendLog(
                'info',
                `${s.id}  ${s.mode.padEnd(11)}  ${formatBytes(s.storedEncryptedBytes).padStart(8)}  dedup=${s.dedupRatioPercent}%  ${s.cloudSync.synced ? '[drive]' : '[local]'}`
              );
            }
          }
          break;
        case 'diff':
          appendLog(
            'info',
            `Pending delta: +${pendingDiff.added.length} added, ~${pendingDiff.modified.length} modified, -${pendingDiff.deleted.length} deleted, =${pendingDiff.unchanged.length} unchanged`
          );
          for (const p of pendingDiff.added.slice(0, 5)) appendLog('success', `  + ${p}`);
          for (const p of pendingDiff.modified.slice(0, 5)) appendLog('warn', `  ~ ${p}`);
          for (const p of pendingDiff.deleted.slice(0, 5)) appendLog('error', `  - ${p}`);
          break;
        case 'backup': {
          const isFull = parts.includes('--full') || parts.includes('-f');
          await handleRunBackup(isFull ? 'full' : 'incremental');
          break;
        }
        case 'sync':
          if (needsAuth) {
            appendLog('warn', 'Google Drive not connected. Navigate to Cloud Sync to sign in.');
          } else {
            await handleSyncAllPending();
          }
          break;
        case 'verify': {
          const targetId = parts[1] ?? snapshots[0]?.id;
          if (!targetId) {
            appendLog('warn', 'No snapshot available to verify.');
          } else {
            await handleVerifySnapshot(targetId);
          }
          break;
        }
        default:
          appendLog('error', `Unknown command "${cmd}". Type "help" for available commands.`);
      }
    },
    [
      appendLog,
      syncSettings.hostname,
      sources,
      snapshots,
      chunkCount,
      totalChunkStoredBytes,
      needsAuth,
      user,
      pendingDiff,
      handleRunBackup,
      handleSyncAllPending,
      handleVerifySnapshot,
    ]
  );

  const currentSectionLabel = useMemo(
    () => NAV_ITEMS.find((n) => n.id === activeNav)?.label ?? 'Overview',
    [activeNav]
  );

  return (
    <div className="flex min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[#1E242D] bg-[#0E1217] lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-[#1E242D] px-5">
          <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-display text-base font-bold tracking-tight text-[#E6EDF3] whitespace-nowrap">
            TermVault
          </span>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#171E27] text-emerald-400'
                    : 'text-[#9BA4B0] hover:bg-[#141A22] hover:text-[#E6EDF3]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#1E242D] p-4 text-xs">
          <div className="font-mono text-[#6E7681]">Host</div>
          <div className="mt-0.5 truncate font-mono text-[#C9D1D9]">{syncSettings.hostname}</div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[#6E7681]">Google Drive</span>
            <button
              type="button"
              onClick={() => setActiveNav('cloud')}
              className={`font-mono ${
                needsAuth ? 'text-amber-400 hover:underline' : 'text-emerald-400 hover:underline'
              }`}
            >
              {needsAuth ? 'Connect' : 'Connected'}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col border-r border-[#1E242D] bg-[#0E1217]">
            <div className="flex h-14 items-center justify-between border-b border-[#1E242D] px-5">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <span className="font-display text-base font-bold text-[#E6EDF3]">TermVault</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="rounded p-1 text-[#8B949E] hover:text-[#E6EDF3]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-[#171E27] text-emerald-400'
                        : 'text-[#9BA4B0] hover:bg-[#141A22] hover:text-[#E6EDF3]'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb Left — Primary Action Right */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-[#1E242D] bg-[#0B0E11]/95 px-5 backdrop-blur-sm lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded p-1.5 text-[#8B949E] hover:bg-[#161B22] hover:text-[#E6EDF3] lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap truncate">
              <span className="font-medium text-[#8B949E]">TermVault</span>
              <span className="text-[#3A4454]" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-[#E6EDF3]">{currentSectionLabel}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={progress.active || vaultLocked}
              onClick={() => handleRunBackup('incremental')}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] transition-colors hover:bg-emerald-400 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {progress.active ? 'Backing Up...' : 'Run Backup'}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-5 py-6 lg:px-8">
          {activeNav === 'overview' && (
            <OverviewView
              sources={sources}
              snapshots={snapshots}
              pendingDiff={pendingDiff}
              chunkCount={chunkCount}
              totalChunkStoredBytes={totalChunkStoredBytes}
              driveConnected={!needsAuth && Boolean(user)}
              driveEmail={user?.email ?? null}
              remoteCount={remoteFiles.length}
              hostname={syncSettings.hostname}
              vaultLocked={vaultLocked}
              progress={progress}
              logs={logs}
              syncingNow={syncingNow}
              onRunBackup={handleRunBackup}
              onSyncAllPending={handleSyncAllPending}
              onVerifySnapshot={handleVerifySnapshot}
              onNavigate={setActiveNav}
              onExecuteCommand={handleExecuteCommand}
              onClearLogs={() => setLogs([])}
            />
          )}

          {activeNav === 'sources' && (
            <SourcesView
              sources={sources}
              pendingDiff={pendingDiff}
              onUpsertSource={handleUpsertSource}
              onAddSourcesBatch={handleAddSourcesBatch}
              onToggleInclude={handleToggleInclude}
              onDeleteSource={handleRequestDeleteSource}
              onRunBackup={(mode) => handleRunBackup(mode)}
              backupRunning={progress.active}
            />
          )}

          {activeNav === 'snapshots' && (
            <SnapshotsView
              snapshots={snapshots}
              driveConnected={!needsAuth && Boolean(user)}
              busySnapshotId={busySnapshotId}
              onRunBackup={(mode) => handleRunBackup(mode)}
              onVerifySnapshot={handleVerifySnapshot}
              onSyncSnapshotToDrive={handleSyncSnapshotToDrive}
              onExportArchive={handleExportArchive}
              onDeleteLocalSnapshot={handleRequestDeleteLocalSnapshot}
              onInspectSnapshot={handleInspectSnapshot}
              onRestoreFileToSources={handleRestoreFileToSources}
              onDownloadDecryptedFile={handleDownloadDecryptedFile}
            />
          )}

          {activeNav === 'cloud' && (
            <CloudSyncView
              user={user}
              needsAuth={needsAuth}
              isSigningIn={isSigningIn}
              driveFolderId={driveFolderId}
              remoteFiles={remoteFiles}
              remoteLoading={remoteLoading}
              remoteError={remoteError}
              syncingNow={syncingNow}
              localSnapshots={snapshots}
              syncSettings={syncSettings}
              nextAutoSyncSeconds={nextAutoSyncSeconds}
              onSignIn={handleGoogleSignIn}
              onSignOut={handleGoogleSignOut}
              onRefreshRemote={() => refreshRemoteDrive()}
              onSyncAllPending={handleSyncAllPending}
              onPullRemoteSnapshot={handlePullRemoteSnapshot}
              onRequestDeleteRemote={handleRequestDeleteRemote}
              onUpdateSettings={handleUpdateSettings}
            />
          )}

          {activeNav === 'vault' && (
            <VaultEncryptionView
              passphrase={passphrase}
              vaultLocked={vaultLocked}
              chunkCount={chunkCount}
              totalChunkRawBytes={totalChunkRawBytes}
              totalChunkStoredBytes={totalChunkStoredBytes}
              snapshotCount={snapshots.length}
              syncSettings={syncSettings}
              onUpdatePassphrase={handleUpdatePassphrase}
              onLockVault={handleLockVault}
              onUnlockVault={handleUnlockVault}
              onUpdateSettings={handleUpdateSettings}
              onImportArchiveFile={handleImportArchiveFile}
              onRequestWipeLocalVault={handleRequestWipeLocalVault}
            />
          )}
        </main>
      </div>

      {/* Mandatory Confirmation Dialog for Destructive / Drive Mutating Actions */}
      <ConfirmDialog
        config={confirmConfig}
        onClose={() => setConfirmConfig(null)}
      />
    </div>
  );
}
