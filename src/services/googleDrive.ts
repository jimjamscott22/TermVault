import { DriveSnapshotFile, PortableEncryptedBundle } from '../types/backup';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const BACKUP_FOLDER_NAME = 'TermVault Backups';

async function driveFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new Error('AUTH_EXPIRED: Google Drive session expired. Please sign in again.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Drive API error (${res.status}): ${errText || res.statusText}`);
  }
  return res;
}

export async function ensureBackupFolder(token: string): Promise<{ id: string; created: boolean }> {
  const query = encodeURIComponent(
    `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await driveFetch(
    `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&spaces=drive`,
    token
  );
  const searchJson = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };

  if (searchJson.files && searchJson.files.length > 0) {
    return { id: searchJson.files[0].id, created: false };
  }

  const createRes = await driveFetch(`${DRIVE_API_BASE}/files?fields=id,name`, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Encrypted incremental Linux backup archives managed by TermVault',
    }),
  });
  const created = (await createRes.json()) as { id: string };
  return { id: created.id, created: true };
}

export async function listRemoteSnapshots(
  token: string,
  folderId: string
): Promise<DriveSnapshotFile[]> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent(
    'files(id,name,size,createdTime,modifiedTime,appProperties)'
  );
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files?q=${query}&orderBy=modifiedTime desc&fields=${fields}&pageSize=100`,
    token
  );
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      createdTime?: string;
      modifiedTime?: string;
      appProperties?: DriveSnapshotFile['appProperties'];
    }>;
  };

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size ?? 0),
    createdTime: f.createdTime ?? new Date().toISOString(),
    modifiedTime: f.modifiedTime ?? f.createdTime ?? new Date().toISOString(),
    appProperties: f.appProperties,
  }));
}

export async function uploadEncryptedSnapshotToDrive(
  token: string,
  folderId: string,
  bundle: PortableEncryptedBundle,
  existingFileId?: string | null
): Promise<DriveSnapshotFile> {
  const fileName = `${bundle.snapshotId}.tva.enc.json`;
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: 'application/json',
    description: `TermVault AES-256-GCM ${bundle.mode} backup (${bundle.stats.fileCount} files)`,
    appProperties: {
      snapshotId: bundle.snapshotId,
      mode: bundle.mode,
      fileCount: String(bundle.stats.fileCount),
      hostname: bundle.hostname,
      manifestSha256: bundle.manifestSha256.slice(0, 32),
      label: bundle.label.slice(0, 64),
    },
  };

  if (!existingFileId) {
    metadata.parents = [folderId];
  }

  const boundary = `termvault_boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const serializedBundle = JSON.stringify(bundle);

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    serializedBundle,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const url = existingFileId
    ? `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,appProperties`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,appProperties`;

  const res = await driveFetch(url, token, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  const uploaded = (await res.json()) as {
    id: string;
    name: string;
    size?: string;
    createdTime?: string;
    modifiedTime?: string;
    appProperties?: DriveSnapshotFile['appProperties'];
  };

  return {
    id: uploaded.id,
    name: uploaded.name,
    size: Number(uploaded.size ?? serializedBundle.length),
    createdTime: uploaded.createdTime ?? new Date().toISOString(),
    modifiedTime: uploaded.modifiedTime ?? new Date().toISOString(),
    appProperties: uploaded.appProperties,
  };
}

export async function downloadRemoteSnapshotFromDrive(
  token: string,
  fileId: string
): Promise<PortableEncryptedBundle> {
  const res = await driveFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, token);
  const parsed = (await res.json()) as PortableEncryptedBundle;
  if (!parsed || parsed.bundleVersion !== 1 || !parsed.manifestEnvelope) {
    throw new Error('Downloaded file is not a valid TermVault encrypted archive.');
  }
  return parsed;
}

export async function deleteRemoteSnapshotFromDrive(
  token: string,
  fileId: string
): Promise<void> {
  await driveFetch(`${DRIVE_API_BASE}/files/${fileId}`, token, {
    method: 'DELETE',
  });
}
