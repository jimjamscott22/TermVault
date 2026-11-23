import React from 'react';
import { User } from 'firebase/auth';
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  FolderCheck,
  LogOut,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { DriveSnapshotFile, StoredSnapshot, SyncSettings } from '../types/backup';
import { formatBytes } from '../services/cryptoEngine';
import { BACKUP_FOLDER_NAME } from '../services/googleDrive';
import { GoogleSignInButton } from './GoogleSignInButton';

interface CloudSyncViewProps {
  user: User | null;
  needsAuth: boolean;
  isSigningIn: boolean;
  driveFolderId: string | null;
  remoteFiles: DriveSnapshotFile[];
  remoteLoading: boolean;
  remoteError: string | null;
  syncingNow: boolean;
  localSnapshots: StoredSnapshot[];
  syncSettings: SyncSettings;
  nextAutoSyncSeconds: number | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefreshRemote: () => Promise<void>;
  onSyncAllPending: () => Promise<void>;
  onPullRemoteSnapshot: (file: DriveSnapshotFile) => Promise<void>;
  onRequestDeleteRemote: (file: DriveSnapshotFile) => void;
  onUpdateSettings: (patch: Partial<SyncSettings>) => void;
}

export const CloudSyncView: React.FC<CloudSyncViewProps> = ({
  user,
  needsAuth,
  isSigningIn,
  driveFolderId,
  remoteFiles,
  remoteLoading,
  remoteError,
  syncingNow,
  localSnapshots,
  syncSettings,
  nextAutoSyncSeconds,
  onSignIn,
  onSignOut,
  onRefreshRemote,
  onSyncAllPending,
  onPullRemoteSnapshot,
  onRequestDeleteRemote,
  onUpdateSettings,
}) => {
  const pendingLocal = localSnapshots.filter((s) => !s.cloudSync.synced);
  const localIds = new Set(localSnapshots.map((s) => s.id));
  const remoteBytes = remoteFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="space-y-6">
      {/* Google Drive Connection Card */}
      <div className="rounded-lg border border-[#222933] bg-[#12161C] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-5 w-5 text-emerald-400" />
              <h2 className="text-lg font-semibold text-[#E6EDF3]">
                Google Drive Cloud Synchronization
              </h2>
            </div>
            <p className="max-w-2xl text-sm text-[#8B949E]">
              Every backup archive is encrypted locally with AES-256-GCM before upload. Google Drive
              receives only ciphertext bundles inside a dedicated{' '}
              <span className="font-mono text-[#C9D1D9]">{BACKUP_FOLDER_NAME}</span> directory.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {needsAuth || !user ? (
              <GoogleSignInButton
                onClick={onSignIn}
                disabled={isSigningIn}
                label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
              />
            ) : (
              <>
                <div className="flex items-center gap-3 rounded-md border border-[#222933] bg-[#0B0E11] px-3.5 py-2">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName ?? 'Google account'}
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 font-mono text-xs font-semibold text-emerald-300">
                      {(user.email ?? 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="text-xs">
                    <div className="font-medium text-[#E6EDF3]">
                      {user.displayName ?? 'Connected Account'}
                    </div>
                    <div className="font-mono text-[#8B949E]">{user.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#C9D1D9] transition-colors hover:bg-[#1E2530] hover:text-[#E6EDF3] whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </button>
              </>
            )}
          </div>
        </div>

        {!needsAuth && user && (
          <div className="mt-5 grid gap-4 border-t border-[#1E242D] pt-5 sm:grid-cols-3">
            <div>
              <div className="text-xs text-[#8B949E]">Target Folder</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-sm text-[#E6EDF3]">
                <FolderCheck className="h-4 w-4 text-emerald-400" />
                {BACKUP_FOLDER_NAME}
              </div>
              {driveFolderId && (
                <div className="mt-0.5 font-mono text-xs text-[#6E7681] truncate">
                  ID: {driveFolderId}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-[#8B949E]">Remote Archive Footprint</div>
              <div className="mt-1 font-mono text-sm font-medium tabular-nums text-[#E6EDF3]">
                {formatBytes(remoteBytes)} · {remoteFiles.length} archive
                {remoteFiles.length === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 text-xs text-[#6E7681]">
                Zero-knowledge AES-256-GCM ciphertext
              </div>
            </div>

            <div>
              <div className="text-xs text-[#8B949E]">Sync Queue</div>
              <div className="mt-1 font-mono text-sm font-medium tabular-nums text-[#E6EDF3]">
                {pendingLocal.length === 0 ? (
                  <span className="text-emerald-400">All local snapshots synced</span>
                ) : (
                  <span className="text-amber-400">
                    {pendingLocal.length} snapshot{pendingLocal.length === 1 ? '' : 's'} pending upload
                  </span>
                )}
              </div>
              {nextAutoSyncSeconds !== null && (
                <div className="mt-0.5 font-mono text-xs tabular-nums text-[#6E7681]">
                  Next scheduled sync in {Math.floor(nextAutoSyncSeconds / 60)}m{' '}
                  {String(nextAutoSyncSeconds % 60).padStart(2, '0')}s
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Automated Sync Schedule Controls */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-5 lg:col-span-5">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Automation Policy</h3>
          <p className="mt-1 text-xs text-[#8B949E]">
            Configure how newly encrypted incremental snapshots propagate to Google Drive.
          </p>

          <div className="mt-5 space-y-4">
            <label className="flex items-start justify-between gap-4 border-b border-[#1E242D] pb-4 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-[#E6EDF3]">
                  Auto-sync after every backup
                </div>
                <div className="mt-0.5 text-xs text-[#8B949E]">
                  Immediately uploads encrypted deltas once a local backup commits.
                </div>
              </div>
              <input
                type="checkbox"
                checked={syncSettings.autoSyncOnBackup}
                onChange={(e) => onUpdateSettings({ autoSyncOnBackup: e.target.checked })}
                className="mt-1 h-4 w-4 accent-emerald-500"
              />
            </label>

            <div>
              <div className="mb-2 text-xs font-medium text-[#E6EDF3]">
                Background Sync Cadence
              </div>
              <div className="grid grid-cols-4 gap-1.5 rounded-md border border-[#222933] bg-[#0B0E11] p-1">
                {([0, 5, 15, 60] as const).map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => onUpdateSettings({ intervalMinutes: mins })}
                    className={`rounded py-1.5 font-mono text-xs font-medium transition-colors ${
                      syncSettings.intervalMinutes === mins
                        ? 'bg-[#1D242E] text-emerald-400'
                        : 'text-[#8B949E] hover:text-[#E6EDF3]'
                    }`}
                  >
                    {mins === 0 ? 'Manual' : `${mins}m`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={needsAuth || syncingNow || pendingLocal.length === 0}
                onClick={onSyncAllPending}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] transition-colors hover:bg-emerald-400 disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                {syncingNow
                  ? 'Syncing...'
                  : `Push Pending (${pendingLocal.length})`}
              </button>
              <button
                type="button"
                disabled={needsAuth || remoteLoading}
                onClick={onRefreshRemote}
                className="inline-flex items-center gap-2 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] transition-colors hover:bg-[#1E2530] disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${remoteLoading ? 'animate-spin' : ''}`} />
                Refresh Drive
              </button>
            </div>
          </div>
        </div>

        {/* Remote Google Drive Archives Table */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[#222933] bg-[#12161C] lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[#1E242D] px-5 py-3.5">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Remote Snapshots in Google Drive
            </h3>
            <span className="font-mono text-xs tabular-nums text-[#8B949E]">
              {remoteFiles.length} file{remoteFiles.length === 1 ? '' : 's'}
            </span>
          </div>

          {remoteError && (
            <div className="mx-5 mt-4 rounded-md border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">
              {remoteError}
            </div>
          )}

          {needsAuth ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <p className="text-sm font-medium text-[#E6EDF3]">
                Connect Google Drive to view remote archives
              </p>
              <p className="mt-1 max-w-sm text-xs text-[#8B949E]">
                Sign in with your Google account above to automatically push encrypted snapshots and
                restore backups across workstations.
              </p>
            </div>
          ) : remoteLoading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-10 animate-pulse rounded bg-[#1A2029]"
                />
              ))}
            </div>
          ) : remoteFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <p className="text-sm font-medium text-[#E6EDF3]">No remote archives found yet</p>
              <p className="mt-1 max-w-sm text-xs text-[#8B949E]">
                Push a local snapshot or run a backup with Auto-sync enabled to store encrypted
                archives in Google Drive.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1E242D] text-[#8B949E]">
                    <th className="px-5 py-2.5 font-medium">Archive File</th>
                    <th className="px-3 py-2.5 font-medium">Local Copy</th>
                    <th className="px-3 py-2.5 text-right font-medium">Size</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1A2029]">
                  {remoteFiles.map((file) => {
                    const snapId =
                      file.appProperties?.snapshotId || file.name.replace(/\.tva\.enc\.json$/, '');
                    const hasLocal = localIds.has(snapId);
                    return (
                      <tr key={file.id} className="hover:bg-[#151A22]">
                        <td className="px-5 py-3">
                          <div className="font-mono text-[#E6EDF3]">{file.name}</div>
                          <div className="mt-0.5 text-[#8B949E]">
                            {file.appProperties?.mode ? `${file.appProperties.mode} · ` : ''}
                            {file.appProperties?.fileCount
                              ? `${file.appProperties.fileCount} files · `
                              : ''}
                            {new Date(file.modifiedTime).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono">
                          {hasLocal ? (
                            <span className="text-emerald-400">In local vault</span>
                          ) : (
                            <span className="text-amber-400">Remote only</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-[#C9D1D9]">
                          {formatBytes(file.size)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={syncingNow}
                              onClick={() => onPullRemoteSnapshot(file)}
                              title="Download encrypted archive into local vault"
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-emerald-400 transition-colors hover:bg-[#1E2530] disabled:opacity-40 whitespace-nowrap"
                            >
                              <CloudDownload className="h-3.5 w-3.5" />
                              Pull
                            </button>
                            <button
                              type="button"
                              disabled={syncingNow}
                              onClick={() => onRequestDeleteRemote(file)}
                              title="Delete archive from Google Drive"
                              aria-label={`Delete ${file.name} from Google Drive`}
                              className="rounded p-1.5 text-[#8B949E] transition-colors hover:bg-[#1E2530] hover:text-red-400 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
