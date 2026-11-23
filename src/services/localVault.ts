import { SourceFile, StoredChunk, StoredSnapshot } from '../types/backup';

const DB_NAME = 'TermVaultEncryptedDB';
const DB_VERSION = 1;
const STORE_CHUNKS = 'chunks';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SOURCES = 'sources';

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SOURCES)) {
        db.createObjectStore(STORE_SOURCES, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open local encrypted vault database'));
  });
}

function txPromise<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openVaultDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = executor(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export async function getAllSources(): Promise<SourceFile[]> {
  const list = await txPromise<SourceFile[]>(STORE_SOURCES, 'readonly', (s) => s.getAll());
  return list.sort((a, b) => a.path.localeCompare(b.path));
}

export async function putSource(file: SourceFile): Promise<void> {
  await txPromise(STORE_SOURCES, 'readwrite', (s) => s.put(file));
}

export async function putSourcesBatch(files: SourceFile[]): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SOURCES, 'readwrite');
    const store = tx.objectStore(STORE_SOURCES);
    for (const file of files) {
      store.put(file);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteSource(path: string): Promise<void> {
  await txPromise(STORE_SOURCES, 'readwrite', (s) => s.delete(path));
}

export async function getChunk(hash: string): Promise<StoredChunk | undefined> {
  return txPromise<StoredChunk | undefined>(STORE_CHUNKS, 'readonly', (s) => s.get(hash));
}

export async function getAllChunks(): Promise<StoredChunk[]> {
  return txPromise<StoredChunk[]>(STORE_CHUNKS, 'readonly', (s) => s.getAll());
}

export async function putChunksBatch(chunks: StoredChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    for (const chunk of chunks) {
      store.put(chunk);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getAllSnapshots(): Promise<StoredSnapshot[]> {
  const list = await txPromise<StoredSnapshot[]>(STORE_SNAPSHOTS, 'readonly', (s) => s.getAll());
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getSnapshot(id: string): Promise<StoredSnapshot | undefined> {
  return txPromise<StoredSnapshot | undefined>(STORE_SNAPSHOTS, 'readonly', (s) => s.get(id));
}

export async function putSnapshot(snapshot: StoredSnapshot): Promise<void> {
  await txPromise(STORE_SNAPSHOTS, 'readwrite', (s) => s.put(snapshot));
}

export async function deleteLocalSnapshot(id: string): Promise<void> {
  await txPromise(STORE_SNAPSHOTS, 'readwrite', (s) => s.delete(id));
  await garbageCollectOrphanChunks();
}

export async function garbageCollectOrphanChunks(): Promise<number> {
  const snapshots = await getAllSnapshots();
  const referenced = new Set<string>();
  for (const snap of snapshots) {
    for (const hash of snap.chunkHashes) {
      referenced.add(hash);
    }
  }
  const allChunks = await getAllChunks();
  const orphanHashes = allChunks.filter((c) => !referenced.has(c.hash)).map((c) => c.hash);
  if (orphanHashes.length === 0) return 0;

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    for (const hash of orphanHashes) {
      store.delete(hash);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
  return orphanHashes.length;
}

export async function clearVaultData(): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_SNAPSHOTS], 'readwrite');
    tx.objectStore(STORE_CHUNKS).clear();
    tx.objectStore(STORE_SNAPSHOTS).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function createDefaultLinuxSources(): SourceFile[] {
  const now = Date.now();
  const entries: Array<{ path: string; permissions: string; mimeType: string; content: string }> = [
    {
      path: '/etc/systemd/system/termvault-daemon.service',
      permissions: '-rw-r--r--',
      mimeType: 'text/plain',
      content: `[Unit]
Description=TermVault Encrypted Incremental Backup Daemon
After=network-online.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
User=backupd
Group=backupd
ExecStart=/usr/local/bin/termvaultd --config /etc/termvault/vault.toml
Restart=on-failure
RestartSec=10s
CapabilityBoundingSet=CAP_DAC_READ_SEARCH
ProtectSystem=strict
ReadWritePaths=/var/lib/termvault

[Install]
WantedBy=multi-user.target
`,
    },
    {
      path: '/etc/ssh/sshd_config',
      permissions: '-rw-------',
      mimeType: 'text/plain',
      content: `# OpenSSH Hardened Workstation Policy
Port 2222
Protocol 2
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com
`,
    },
    {
      path: '/etc/fstab',
      permissions: '-rw-r--r--',
      mimeType: 'text/plain',
      content: `# /etc/fstab: static file system information
UUID=9f48a102-8e71-41b3-b91e-22c91a40b911 /               ext4    errors=remount-ro,noatime 0 1
UUID=4d2a-819b                            /boot/efi       vfat    umask=0077                0 1
UUID=c7b20118-3c9f-40a1-8e09-550a817e2204 /mnt/vault      btrfs   compress=zstd:3,noatime   0 2
tmpfs                                     /tmp            tmpfs   defaults,nosuid,nodev     0 0
`,
    },
    {
      path: '/etc/nginx/sites-available/gateway.conf',
      permissions: '-rw-r--r--',
      mimeType: 'text/plain',
      content: `server {
    listen 443 ssl http2;
    server_name ops.internal.lan;

    ssl_certificate     /etc/ssl/certs/ops-internal.pem;
    ssl_certificate_key /etc/ssl/private/ops-internal.key;
    ssl_protocols       TLSv1.3;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
`,
    },
    {
      path: '/var/lib/postgresql/16/main/postgresql.conf',
      permissions: '-rw-------',
      mimeType: 'text/plain',
      content: `# PostgreSQL 16 Production Tuning
listen_addresses = '127.0.0.1'
max_connections = 120
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /mnt/vault/wal/%f && cp %p /mnt/vault/wal/%f'
checkpoint_completion_target = 0.9
`,
    },
    {
      path: '/opt/stack/docker-compose.yml',
      permissions: '-rw-r--r--',
      mimeType: 'text/yaml',
      content: `services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pg_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: telemetry
      POSTGRES_USER: ops_admin

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb
    restart: unless-stopped

volumes:
  pg_data:
`,
    },
    {
      path: '/home/ops/.bashrc',
      permissions: '-rw-r--r--',
      mimeType: 'text/plain',
      content: `# Interactive bash configuration
export EDITOR=nvim
export HISTCONTROL=ignoreboth:erasedups
export HISTSIZE=50000
export PATH="$HOME/.local/bin:/usr/local/go/bin:$PATH"

alias ll='ls -alFh --color=auto'
alias gs='git status -sb'
alias tv='termvault'
PS1='\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '
`,
    },
    {
      path: '/home/ops/.config/nvim/init.lua',
      permissions: '-rw-r--r--',
      mimeType: 'text/plain',
      content: `-- Neovim workstation defaults
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.termguicolors = true
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 250
vim.g.mapleader = " "
`,
    },
    {
      path: '/usr/local/bin/rotate-wal.sh',
      permissions: '-rwxr-xr-x',
      mimeType: 'text/x-shellscript',
      content: `#!/usr/bin/env bash
set -euo pipefail

WAL_DIR="/mnt/vault/wal"
RETENTION_DAYS=14

if [[ -d "$WAL_DIR" ]]; then
  find "$WAL_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
  echo "[rotate-wal] Pruned WAL segments older than \${RETENTION_DAYS}d"
fi
`,
    },
  ];

  return entries.map((item, idx) => {
    const lastSlash = item.path.lastIndexOf('/');
    const directory = lastSlash > 0 ? item.path.slice(0, lastSlash) : '/';
    const name = item.path.slice(lastSlash + 1);
    const size = new TextEncoder().encode(item.content).byteLength;
    return {
      path: item.path,
      directory,
      name,
      mimeType: item.mimeType,
      size,
      lastModified: now - idx * 3600_000,
      encoding: 'utf8',
      content: item.content,
      included: true,
      permissions: item.permissions,
    };
  });
}

export async function ensureInitialSources(): Promise<SourceFile[]> {
  const existing = await getAllSources();
  if (existing.length > 0) return existing;
  const defaults = createDefaultLinuxSources();
  await putSourcesBatch(defaults);
  return defaults;
}
