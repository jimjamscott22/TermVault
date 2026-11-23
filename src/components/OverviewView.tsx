import React, { useState } from 'react';
import {
  ArrowRight,
  CloudUpload,
  Play,
  ShieldCheck,
} from 'lucide-react';
import {
  BackupMode,
  BackupRunProgress,
  NavSection,
  SourceFile,
  StoredSnapshot,
  TerminalLogEntry,
} from '../types/backup';
import { formatBytes } from '../services/cryptoEngine';
import { TerminalConsole } from './TerminalConsole';
import { ThroughputChart } from './ThroughputChart';

interface OverviewViewProps {
  sources: SourceFile[];
  snapshots: StoredSnapshot[];
  pendingDiff: { added: string[]; modified: string[]; deleted: string[]; unchanged: string[] };
  chunkCount: number;
  totalChunkStoredBytes: number;
  driveConnected: boolean;
  driveEmail: string | null;
  remoteCount: number;
  hostname: string;
  vaultLocked: boolean;
  progress: BackupRunProgress;
  logs: TerminalLogEntry[];
  syncingNow: boolean;
  onRunBackup: (mode: BackupMode, label?: string) => Promise<void>;
  onSyncAllPending: () => Promise<void>;
  onVerifySnapshot: (id: string) => Promise<void>;
  onNavigate: (section: NavSection) => void;
  onExecuteCommand: (cmd: string) => Promise<void>;
  onClearLogs: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  sources,
  snapshots,
  pendingDiff,
  chunkCount,
  totalChunkStoredBytes,
  driveConnected,
  driveEmail,
  remoteCount,
  hostname,
  vaultLocked,
  progress,
  logs,
  syncingNow,
  onRunBackup,
  onSyncAllPending,
  onVerifySnapshot,
  onNavigate,
  onExecuteCommand,
  onClearLogs,
}) => {
  const [selectedMode, setSelectedMode] = useState<BackupMode>('incremental');
  const [labelInput, setLabelInput] = useState('');

  const includedFiles = sources.filter((f) => f.included);
  const activeDatasetBytes = includedFiles.reduce((acc, f) => acc + f.size, 0);
  const latestSnapshot = snapshots[0] ?? null;
  const syncedCount = snapshots.filter((s) => s.cloudSync.synced).length;
  const pendingSyncCount = snapshots.length - syncedCount;
  const avgDedup =
    snapshots.length > 0
      ? Math.round(
          snapshots.reduce((acc, s) => acc + s.dedupRatioPercent, 0) / snapshots.length
        )
      : 0;

  const handleTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    await onRunBackup(selectedMode, labelInput);
    setLabelInput('');
  };

  return (
    <div className="space-y-6">
      {/* 4-Column Metric Strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-5">
          <div className="text-xs font-medium text-[#8B949E]">Active Dataset</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#E6EDF3]">
            {formatBytes(activeDatasetBytes)}
          </div>
          <div className="mt-2 text-xs text-[#8B949E] font-mono tabular-nums">
            {includedFiles.length} files · +{pendingDiff.added.length} new · ~
            {pendingDiff.modified.length} mod
          </div>
        </div>

        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-5">
          <div className="text-xs font-medium text-[#8B949E]">Encrypted Local Vault</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
            {formatBytes(totalChunkStoredBytes)}
          </div>
          <div className="mt-2 text-xs text-[#8B949E] font-mono tabular-nums">
            AES-256-GCM · {chunkCount} chunks · {avgDedup}% avg dedup
          </div>
        </div>

        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#8B949E]">Google Drive Sync</span>
            <button
              type="button"
              onClick={() => onNavigate('cloud')}
              className="text-xs text-emerald-400 hover:underline whitespace-nowrap"
            >
              Configure
            </button>
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#E6EDF3]">
            {driveConnected ? `${syncedCount}/${snapshots.length}` : 'Offline'}
          </div>
          <div className="mt-2 truncate text-xs text-[#8B949E] font-mono">
            {driveConnected
              ? `${remoteCount} remote · ${driveEmail ?? 'Connected'}`
              : 'Sign in via Cloud Sync to enable'}
          </div>
        </div>

        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-5">
          <div className="text-xs font-medium text-[#8B949E]">Latest Snapshot</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#E6EDF3]">
            {latestSnapshot ? `${latestSnapshot.throughputMBs.toFixed(1)} MB/s` : 'Idle'}
          </div>
          <div className="mt-2 truncate text-xs text-[#8B949E] font-mono tabular-nums">
            {latestSnapshot
              ? `${latestSnapshot.mode} · ${latestSnapshot.durationMs}ms · ${new Date(
                  latestSnapshot.createdAt
                ).toLocaleTimeString()}`
              : 'No snapshot committed yet'}
          </div>
        </div>
      </div>

      {/* Real-Time Backup Execution & Status Bar Card */}
      <section
        aria-label="Backup Runner"
        className="rounded-lg border border-[#222933] bg-[#12161C] p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#E6EDF3]">
              Real-Time Backup Operations
            </h2>
            <p className="mt-1 text-xs text-[#8B949E]">
              Content-addressed SHA-256 chunking writes only modified blocks, then encrypts locally
              with AES-256-GCM before optional Google Drive upload.
            </p>
          </div>

          <form onSubmit={handleTrigger} className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-md border border-[#222933] bg-[#0B0E11] p-1">
              <button
                type="button"
                onClick={() => setSelectedMode('incremental')}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedMode === 'incremental'
                    ? 'bg-[#1D242E] text-emerald-400'
                    : 'text-[#8B949E] hover:text-[#E6EDF3]'
                }`}
              >
                Incremental
              </button>
              <button
                type="button"
                onClick={() => setSelectedMode('full')}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedMode === 'full'
                    ? 'bg-[#1D242E] text-emerald-400'
                    : 'text-[#8B949E] hover:text-[#E6EDF3]'
                }`}
              >
                Full
              </button>
            </div>

            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Optional snapshot label..."
              aria-label="Snapshot label"
              className="w-48 rounded-md border border-[#222933] bg-[#0B0E11] px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#6E7681] focus:border-emerald-400 focus:outline-none"
            />

            <button
              type="submit"
              disabled={progress.active || vaultLocked || includedFiles.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] transition-colors hover:bg-emerald-400 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {progress.active
                ? 'Running...'
                : selectedMode === 'incremental'
                ? 'Run Incremental'
                : 'Run Full'}
            </button>

            {driveConnected && pendingSyncCount > 0 && (
              <button
                type="button"
                disabled={syncingNow || progress.active}
                onClick={onSyncAllPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] transition-colors hover:bg-[#1E2530] disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <CloudUpload className="h-3.5 w-3.5 text-emerald-400" />
                {syncingNow ? 'Syncing...' : `Sync Pending (${pendingSyncCount})`}
              </button>
            )}
          </form>
        </div>

        {/* Live Telemetry Progress Bar */}
        <div className="mt-5 rounded-md border border-[#1E242D] bg-[#0B0E11] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={
                  progress.phase === 'error'
                    ? 'text-red-400'
                    : progress.active
                    ? 'text-emerald-400'
                    : progress.phase === 'complete'
                    ? 'text-emerald-400'
                    : 'text-[#8B949E]'
                }
              >
                {progress.phase === 'idle'
                  ? vaultLocked
                    ? 'Vault locked — unlock in Vault Encryption to run jobs'
                    : 'Daemon ready — waiting for backup trigger'
                  : `${progress.phase.toUpperCase()} · ${progress.currentPath}`}
              </span>
            </div>
            <div className="flex items-center gap-3 tabular-nums text-[#8B949E] shrink-0">
              <span>
                {progress.filesProcessed}/{progress.totalFiles || includedFiles.length} files
              </span>
              <span aria-hidden="true">·</span>
              <span>{progress.percent}%</span>
              {progress.throughputMBs > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">{progress.throughputMBs.toFixed(2)} MB/s</span>
                </>
              )}
            </div>
          </div>

          <div
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1A2029]"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Backup progress"
          >
            <div
              className={`h-full transition-all duration-150 ${
                progress.phase === 'error' ? 'bg-red-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </section>

      {/* Main Balanced Split: Retro Terminal Console + Storage Efficiency Chart */}
      <div className="grid items-stretch gap-6 xl:grid-cols-12">
        <div className="flex flex-col xl:col-span-7">
          <TerminalConsole
            logs={logs}
            hostname={hostname}
            onExecuteCommand={onExecuteCommand}
            onClear={onClearLogs}
          />
        </div>

        <section className="flex flex-col justify-between rounded-lg border border-[#222933] bg-[#12161C] p-5 xl:col-span-5">
          <div>
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Deduplication &amp; Delta Efficiency
            </h3>
            <p className="mt-1 text-xs text-[#8B949E]">
              Compares full logical dataset size against actual compressed AES-256-GCM delta blocks
              written per snapshot.
            </p>
          </div>

          <div className="mt-4">
            <ThroughputChart snapshots={snapshots} />
          </div>
        </section>
      </div>

      {/* Recent Snapshots Table Card */}
      <section className="overflow-hidden rounded-lg border border-[#222933] bg-[#12161C]">
        <div className="flex items-center justify-between border-b border-[#1E242D] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Recent Snapshot Chain</h3>
          <button
            type="button"
            onClick={() => onNavigate('snapshots')}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap"
          >
            View All Snapshots
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-[#8B949E]">
            No snapshots in local vault yet. Click <span className="text-[#E6EDF3]">Run Incremental</span>{' '}
            above or run <span className="font-mono text-emerald-400">backup</span> in the terminal.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1E242D] text-[#8B949E]">
                  <th className="px-5 py-2.5 font-medium">Snapshot</th>
                  <th className="px-3 py-2.5 font-medium">Mode</th>
                  <th className="px-3 py-2.5 text-right font-medium">Delta Written</th>
                  <th className="px-3 py-2.5 text-right font-medium">Dedup</th>
                  <th className="px-3 py-2.5 font-medium">Cloud</th>
                  <th className="px-5 py-2.5 text-right font-medium">Verify</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A2029]">
                {snapshots.slice(0, 5).map((snap) => (
                  <tr key={snap.id} className="hover:bg-[#151A22]">
                    <td className="px-5 py-3">
                      <div className="font-mono text-[#E6EDF3]">{snap.id}</div>
                      <div className="mt-0.5 text-[#8B949E]">
                        {snap.label} · {new Date(snap.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono capitalize text-[#C9D1D9]">{snap.mode}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-400">
                      {formatBytes(snap.storedEncryptedBytes)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-[#C9D1D9]">
                      {snap.dedupRatioPercent}%
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {snap.cloudSync.synced ? (
                        <span className="text-emerald-400">Google Drive</span>
                      ) : (
                        <span className="text-amber-400">Local only</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onVerifySnapshot(snap.id)}
                        className="inline-flex items-center gap-1 font-mono text-xs text-[#C9D1D9] hover:text-emerald-400 whitespace-nowrap"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Check
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
