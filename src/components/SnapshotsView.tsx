import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  Eye,
  FileDown,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { SnapshotFileEntry, SnapshotManifestPayload, StoredSnapshot } from '../types/backup';
import { formatBytes } from '../services/cryptoEngine';

interface SnapshotsViewProps {
  snapshots: StoredSnapshot[];
  driveConnected: boolean;
  busySnapshotId: string | null;
  onRunBackup: (mode: 'incremental' | 'full') => void;
  onVerifySnapshot: (snapshotId: string) => Promise<void>;
  onSyncSnapshotToDrive: (snapshot: StoredSnapshot) => Promise<void>;
  onExportArchive: (snapshot: StoredSnapshot) => Promise<void>;
  onDeleteLocalSnapshot: (snapshot: StoredSnapshot) => void;
  onInspectSnapshot: (snapshot: StoredSnapshot) => Promise<SnapshotManifestPayload | null>;
  onRestoreFileToSources: (snapshot: StoredSnapshot, entry: SnapshotFileEntry) => Promise<void>;
  onDownloadDecryptedFile: (snapshot: StoredSnapshot, entry: SnapshotFileEntry) => Promise<void>;
}

type SyncFilter = 'all' | 'synced' | 'local';

export const SnapshotsView: React.FC<SnapshotsViewProps> = ({
  snapshots,
  driveConnected,
  busySnapshotId,
  onRunBackup,
  onVerifySnapshot,
  onSyncSnapshotToDrive,
  onExportArchive,
  onDeleteLocalSnapshot,
  onInspectSnapshot,
  onRestoreFileToSources,
  onDownloadDecryptedFile,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SyncFilter>('all');
  const [inspectedSnapshot, setInspectedSnapshot] = useState<StoredSnapshot | null>(null);
  const [inspectedManifest, setInspectedManifest] = useState<SnapshotManifestPayload | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshots.filter((snap) => {
      if (filter === 'synced' && !snap.cloudSync.synced) return false;
      if (filter === 'local' && snap.cloudSync.synced) return false;
      if (!q) return true;
      return (
        snap.id.toLowerCase().includes(q) ||
        snap.label.toLowerCase().includes(q) ||
        snap.hostname.toLowerCase().includes(q) ||
        snap.mode.toLowerCase().includes(q)
      );
    });
  }, [snapshots, search, filter]);

  const handleOpenInspector = async (snap: StoredSnapshot) => {
    setInspectedSnapshot(snap);
    setInspectedManifest(null);
    setInspectError(null);
    setInspectLoading(true);
    try {
      const manifest = await onInspectSnapshot(snap);
      if (!manifest) {
        setInspectError('Unable to decrypt manifest with the active vault passphrase.');
      } else {
        setInspectedManifest(manifest);
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Failed to decrypt snapshot manifest.');
    } finally {
      setInspectLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[#222933] bg-[#12161C] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#E6EDF3]">Encrypted Snapshots</h2>
          <p className="mt-1 text-sm text-[#8B949E]">
            {snapshots.length} local snapshot{snapshots.length === 1 ? '' : 's'} ·{' '}
            {snapshots.filter((s) => s.cloudSync.synced).length} synced to Google Drive
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-[#222933] bg-[#0B0E11] p-1">
            {(
              [
                ['all', 'All'],
                ['synced', 'Cloud Synced'],
                ['local', 'Local Only'],
              ] as Array<[SyncFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === key
                    ? 'bg-[#1D242E] text-[#E6EDF3]'
                    : 'text-[#8B949E] hover:text-[#E6EDF3]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6E7681]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search snapshot ID or label..."
              aria-label="Search snapshots"
              className="w-56 rounded-md border border-[#222933] bg-[#0B0E11] py-1.5 pl-8 pr-3 font-mono text-xs text-[#E6EDF3] placeholder-[#6E7681] focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Snapshot Table */}
      <div className="overflow-hidden rounded-lg border border-[#222933] bg-[#12161C]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium text-[#E6EDF3]">
              {snapshots.length === 0 ? 'No backup snapshots created yet' : 'No snapshots match your filter'}
            </p>
            <p className="mt-1 max-w-md text-xs text-[#8B949E]">
              {snapshots.length === 0
                ? 'Create your first AES-256-GCM encrypted snapshot to initialize the incremental deduplication chain.'
                : 'Try switching the sync filter or clearing your search query.'}
            </p>
            {snapshots.length === 0 && (
              <button
                type="button"
                onClick={() => onRunBackup('full')}
                className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] hover:bg-emerald-400"
              >
                Create Initial Full Snapshot
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1E242D] text-[#8B949E]">
                  <th className="px-5 py-3 font-medium">Snapshot ID</th>
                  <th className="px-3 py-3 font-medium">Mode / Delta</th>
                  <th className="px-3 py-3 text-right font-medium">Logical Size</th>
                  <th className="px-3 py-3 text-right font-medium">Encrypted Delta</th>
                  <th className="px-3 py-3 text-right font-medium">Dedup</th>
                  <th className="px-3 py-3 font-medium">Cloud Status</th>
                  <th className="px-3 py-3 font-medium">Integrity</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A2029]">
                {filtered.map((snap) => {
                  const isBusy = busySnapshotId === snap.id;
                  return (
                    <tr key={snap.id} className="transition-colors hover:bg-[#151A22]">
                      <td className="px-5 py-3.5">
                        <div className="font-mono font-medium text-[#E6EDF3]">{snap.id}</div>
                        <div className="mt-0.5 text-[#8B949E]">
                          {snap.label} · {new Date(snap.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 font-mono">
                        <div className="text-[#E6EDF3] capitalize">{snap.mode}</div>
                        <div className="mt-0.5 text-[#8B949E] tabular-nums">
                          +{snap.addedCount} / ~{snap.modifiedCount} / ={snap.unchangedCount}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-[#C9D1D9]">
                        {formatBytes(snap.totalRawBytes)}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-emerald-400">
                        {formatBytes(snap.storedEncryptedBytes)}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-[#C9D1D9]">
                        {snap.dedupRatioPercent}%
                      </td>
                      <td className="px-3 py-3.5 font-mono">
                        {snap.cloudSync.synced ? (
                          <span className="text-emerald-400">Synced (Drive)</span>
                        ) : (
                          <span className="text-amber-400">Local only</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 font-mono">
                        {snap.verificationStatus === 'verified' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Verified
                          </span>
                        ) : snap.verificationStatus === 'failed' ? (
                          <span className="text-red-400">Check failed</span>
                        ) : (
                          <span className="text-[#8B949E]">Unchecked</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenInspector(snap)}
                            title="Inspect & restore files"
                            aria-label={`Inspect ${snap.id}`}
                            className="rounded p-1.5 text-[#8B949E] transition-colors hover:bg-[#1E2530] hover:text-[#E6EDF3]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onVerifySnapshot(snap.id)}
                            title="Verify AES-GCM tags & SHA-256 blocks"
                            aria-label={`Verify ${snap.id}`}
                            className="rounded p-1.5 text-[#8B949E] transition-colors hover:bg-[#1E2530] hover:text-emerald-400 disabled:opacity-40"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || !driveConnected}
                            onClick={() => onSyncSnapshotToDrive(snap)}
                            title={
                              driveConnected
                                ? snap.cloudSync.synced
                                  ? 'Re-upload to Google Drive'
                                  : 'Upload encrypted snapshot to Google Drive'
                                : 'Connect Google Drive to sync'
                            }
                            aria-label={`Sync ${snap.id} to Google Drive`}
                            className="rounded p-1.5 text-[#8B949E] transition-colors hover:bg-[#1E2530] hover:text-emerald-400 disabled:opacity-35"
                          >
                            <CloudUpload className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onExportArchive(snap)}
                            title="Export encrypted .tva.enc.json file"
                            aria-label={`Export ${snap.id}`}
                            className="rounded p-1.5 text-[#8B949E] transition-colors hover:bg-[#1E2530] hover:text-[#E6EDF3] disabled:opacity-40"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onDeleteLocalSnapshot(snap)}
                            title="Delete snapshot from local vault"
                            aria-label={`Delete ${snap.id}`}
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

      {/* Snapshot Manifest Inspector & File Restore Modal */}
      {inspectedSnapshot && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Snapshot inspector"
        >
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#2B3442] bg-[#12161C] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#1E242D] px-6 py-4">
              <div className="min-w-0">
                <h3 className="font-mono text-sm font-semibold text-[#E6EDF3]">
                  {inspectedSnapshot.id}
                </h3>
                <p className="mt-1 text-xs text-[#8B949E]">
                  {inspectedSnapshot.label} · {inspectedSnapshot.mode} · Parent:{' '}
                  <span className="font-mono">{inspectedSnapshot.parentId ?? 'none (root)'}</span> ·
                  SHA-256:{' '}
                  <span className="font-mono">{inspectedSnapshot.manifestSha256.slice(0, 16)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedSnapshot(null)}
                aria-label="Close inspector"
                className="rounded p-1 text-[#8B949E] hover:bg-[#1E2530] hover:text-[#E6EDF3]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {inspectLoading ? (
                <div className="py-12 text-center font-mono text-xs text-[#8B949E]">
                  Deriving PBKDF2-SHA256 key &amp; decrypting AES-256-GCM manifest...
                </div>
              ) : inspectError ? (
                <div className="rounded-md border border-red-500/30 bg-red-950/20 p-4 text-xs text-red-300">
                  {inspectError}
                </div>
              ) : inspectedManifest ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-md border border-[#1E242D]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#1E242D] bg-[#0E1217] text-[#8B949E]">
                          <th className="px-4 py-2.5 font-medium">File Path</th>
                          <th className="px-3 py-2.5 font-medium">Change</th>
                          <th className="px-3 py-2.5 font-medium">SHA-256</th>
                          <th className="px-3 py-2.5 text-right font-medium">Size</th>
                          <th className="px-4 py-2.5 text-right font-medium">Restore</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1A2029]">
                        {inspectedManifest.files.map((entry) => (
                          <tr key={entry.path} className="hover:bg-[#151A22]">
                            <td className="px-4 py-2.5 font-mono text-[#E6EDF3]">{entry.path}</td>
                            <td className="px-3 py-2.5 font-mono">
                              <span
                                className={
                                  entry.diffStatus === 'added'
                                    ? 'text-emerald-400'
                                    : entry.diffStatus === 'modified'
                                    ? 'text-amber-400'
                                    : 'text-[#8B949E]'
                                }
                              >
                                {entry.diffStatus}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[#8B949E]">
                              {entry.sha256.slice(0, 12)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#C9D1D9]">
                              {formatBytes(entry.size)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    onRestoreFileToSources(inspectedSnapshot, entry)
                                  }
                                  className="inline-flex items-center gap-1 text-emerald-400 hover:underline whitespace-nowrap"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Restore
                                </button>
                                <span className="text-[#303A48]" aria-hidden="true">
                                  /
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDownloadDecryptedFile(inspectedSnapshot, entry)
                                  }
                                  className="inline-flex items-center gap-1 text-[#C9D1D9] hover:text-[#E6EDF3] whitespace-nowrap"
                                >
                                  <FileDown className="h-3 w-3" />
                                  Download
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {inspectedManifest.deletedPaths.length > 0 && (
                    <div className="rounded-md border border-[#1E242D] bg-[#0B0E11] p-4">
                      <div className="text-xs font-medium text-[#8B949E]">
                        Removed since parent snapshot ({inspectedManifest.deletedPaths.length})
                      </div>
                      <ul className="mt-2 space-y-1 font-mono text-xs text-red-400">
                        {inspectedManifest.deletedPaths.map((p) => (
                          <li key={p}>- {p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
