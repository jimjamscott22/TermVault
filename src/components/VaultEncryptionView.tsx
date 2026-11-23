import React, { useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  FileUp,
  HardDrive,
  KeyRound,
  Lock,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import { SyncSettings } from '../types/backup';
import { formatBytes } from '../services/cryptoEngine';

interface VaultEncryptionViewProps {
  passphrase: string;
  vaultLocked: boolean;
  chunkCount: number;
  totalChunkRawBytes: number;
  totalChunkStoredBytes: number;
  snapshotCount: number;
  syncSettings: SyncSettings;
  onUpdatePassphrase: (nextPassphrase: string) => Promise<void>;
  onLockVault: () => void;
  onUnlockVault: (candidate: string) => Promise<boolean>;
  onUpdateSettings: (patch: Partial<SyncSettings>) => void;
  onImportArchiveFile: (file: File) => Promise<void>;
  onRequestWipeLocalVault: () => void;
}

export const VaultEncryptionView: React.FC<VaultEncryptionViewProps> = ({
  passphrase,
  vaultLocked,
  chunkCount,
  totalChunkRawBytes,
  totalChunkStoredBytes,
  snapshotCount,
  syncSettings,
  onUpdatePassphrase,
  onLockVault,
  onUnlockVault,
  onUpdateSettings,
  onImportArchiveFile,
  onRequestWipeLocalVault,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [unlockInput, setUnlockInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [hostnameDraft, setHostnameDraft] = useState(syncSettings.hostname);
  const importRef = useRef<HTMLInputElement>(null);

  const compressionRatio =
    totalChunkRawBytes > 0
      ? Math.max(0, Math.round((1 - totalChunkStoredBytes / totalChunkRawBytes) * 100))
      : 0;

  const handleSavePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.trim().length < 6) {
      setKeyMessage('Passphrase must be at least 6 characters.');
      return;
    }
    await onUpdatePassphrase(newPass.trim());
    setNewPass('');
    setKeyMessage('Active vault key updated. New snapshots will encrypt with the new passphrase.');
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    const ok = await onUnlockVault(unlockInput);
    if (!ok) {
      setUnlockError('Invalid passphrase. PBKDF2-SHA256 sentinel check failed.');
    } else {
      setUnlockInput('');
    }
  };

  const handleHostnameSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = hostnameDraft.trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (cleaned) {
      onUpdateSettings({ hostname: cleaned });
    }
  };

  return (
    <div className="space-y-6">
      {/* Encryption Parameters Card */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-6 lg:col-span-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-[#E6EDF3]">
                  AES-256-GCM Local Vault Key
                </h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
                Keys are derived locally via PBKDF2-SHA256 (150,000 iterations) with a fresh 128-bit
                salt and 96-bit IV per chunk. Passphrases never leave this browser.
              </p>
            </div>

            {!vaultLocked && (
              <button
                type="button"
                onClick={onLockVault}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3442] bg-[#161B22] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2530] whitespace-nowrap shrink-0"
              >
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                Lock Vault
              </button>
            )}
          </div>

          {vaultLocked ? (
            <form onSubmit={handleUnlock} className="mt-5 space-y-3 rounded-md border border-amber-500/30 bg-[#0B0E11] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                <Lock className="h-4 w-4" />
                Vault is currently locked. Enter your passphrase to resume backups and decryption.
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  type="password"
                  value={unlockInput}
                  onChange={(e) => setUnlockInput(e.target.value)}
                  placeholder="Enter vault passphrase..."
                  className="flex-1 rounded-md border border-[#2B3442] bg-[#12161C] px-3 py-2 font-mono text-xs text-[#E6EDF3] focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] hover:bg-emerald-400 whitespace-nowrap"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  Unlock Vault
                </button>
              </div>
              {unlockError && <p className="text-xs text-red-400">{unlockError}</p>}
            </form>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-md border border-[#222933] bg-[#0B0E11] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-xs text-[#8B949E]">Active Session Passphrase</div>
                  <div className="mt-1 truncate font-mono text-xs text-[#E6EDF3]">
                    {showKey ? passphrase : '••••••••••••••••••••••••'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Hide passphrase' : 'Reveal passphrase'}
                  className="rounded p-1.5 text-[#8B949E] hover:bg-[#1E2530] hover:text-[#E6EDF3]"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <form onSubmit={handleSavePassphrase} className="space-y-3">
                <label
                  htmlFor="rotate-passphrase"
                  className="block text-xs font-medium text-[#C9D1D9]"
                >
                  Rotate Vault Passphrase
                </label>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <input
                    id="rotate-passphrase"
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder="Enter new passphrase (min 6 chars)..."
                    className="flex-1 rounded-md border border-[#2B3442] bg-[#0B0E11] px-3 py-2 font-mono text-xs text-[#E6EDF3] focus:border-emerald-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-[#2B3442] bg-[#161B22] px-4 py-2 text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2530] whitespace-nowrap shrink-0"
                  >
                    Update Key
                  </button>
                </div>
                {keyMessage && <p className="text-xs text-emerald-400">{keyMessage}</p>}
              </form>
            </div>
          )}
        </div>

        {/* Local IndexedDB Storage Metrics */}
        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-6 lg:col-span-5">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-[#E6EDF3]">
              Encrypted Local Chunk Store
            </h2>
          </div>
          <p className="mt-1 text-xs text-[#8B949E]">
            Content-addressed IndexedDB repository storing 16 KB deduplicated encrypted blocks.
          </p>

          <dl className="mt-5 divide-y divide-[#1E242D] text-xs">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[#8B949E]">Cipher Suite</dt>
              <dd className="font-mono text-[#E6EDF3]">AES-256-GCM / PBKDF2-SHA256</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[#8B949E]">Unique Encrypted Chunks</dt>
              <dd className="font-mono tabular-nums text-[#E6EDF3]">{chunkCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[#8B949E]">Local Snapshots</dt>
              <dd className="font-mono tabular-nums text-[#E6EDF3]">{snapshotCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[#8B949E]">Stored Ciphertext Volume</dt>
              <dd className="font-mono tabular-nums text-emerald-400">
                {formatBytes(totalChunkStoredBytes)}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[#8B949E]">Gzip Space Reduction</dt>
              <dd className="font-mono tabular-nums text-[#E6EDF3]">{compressionRatio}%</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Host Configuration, Archive Import & Danger Zone */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#222933] bg-[#12161C] p-6 lg:col-span-7">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Host &amp; Compression Settings</h3>
          <div className="mt-4 space-y-4">
            <form onSubmit={handleHostnameSave} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="linux-hostname"
                  className="mb-1.5 block text-xs font-medium text-[#8B949E]"
                >
                  Linux Hostname Identifier
                </label>
                <input
                  id="linux-hostname"
                  type="text"
                  value={hostnameDraft}
                  onChange={(e) => setHostnameDraft(e.target.value)}
                  className="w-full rounded-md border border-[#2B3442] bg-[#0B0E11] px-3 py-2 font-mono text-xs text-[#E6EDF3] focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-md border border-[#2B3442] bg-[#161B22] px-4 py-2 text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2530] whitespace-nowrap shrink-0"
              >
                Save Hostname
              </button>
            </form>

            <label className="flex items-center justify-between gap-4 border-t border-[#1E242D] pt-4 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-[#E6EDF3]">
                  Enable Gzip Pre-Encryption Compression
                </div>
                <div className="mt-0.5 text-xs text-[#8B949E]">
                  Compresses each content block prior to AES-256-GCM encryption to lower local and
                  cloud storage costs.
                </div>
              </div>
              <input
                type="checkbox"
                checked={syncSettings.compressionEnabled}
                onChange={(e) => onUpdateSettings({ compressionEnabled: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-lg border border-[#222933] bg-[#12161C] p-6 lg:col-span-5">
          <div>
            <h3 className="text-sm font-semibold text-[#E6EDF3]">Archive Portability &amp; Maintenance</h3>
            <p className="mt-1 text-xs text-[#8B949E]">
              Import an offline encrypted <span className="font-mono">.tva.enc.json</span> archive
              into your local store, or purge all local snapshots and encrypted blocks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportArchiveFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2530] whitespace-nowrap shrink-0"
            >
              <FileUp className="h-3.5 w-3.5 text-emerald-400" />
              Import Encrypted Archive
            </button>

            <button
              type="button"
              onClick={onRequestWipeLocalVault}
              className="inline-flex items-center gap-2 rounded-md border border-red-500/35 bg-red-950/20 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-950/40 whitespace-nowrap shrink-0"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Wipe Local Vault
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
