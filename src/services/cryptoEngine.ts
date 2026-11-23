import { EncryptedArchiveEnvelope } from '../types/backup';

const PBKDF2_ITERATIONS = 150000;
const CHUNK_SIZE_BYTES = 16384; // 16 KiB content-addressed blocks

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function splitIntoChunks(data: Uint8Array, chunkSize = CHUNK_SIZE_BYTES): Uint8Array[] {
  if (data.byteLength === 0) {
    return [new Uint8Array(0)];
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    chunks.push(data.subarray(offset, Math.min(offset + chunkSize, data.byteLength)));
  }
  return chunks;
}

async function compressGzip(data: Uint8Array): Promise<{ bytes: Uint8Array; compression: 'gzip' | 'none' }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: data, compression: 'none' };
  }
  try {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    writer.write(copy);
    writer.close();
    const compressedBuffer = await new Response(cs.readable).arrayBuffer();
    return { bytes: new Uint8Array(compressedBuffer), compression: 'gzip' };
  } catch {
    return { bytes: data, compression: 'none' };
  }
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    return data;
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  writer.write(copy);
  writer.close();
  const buffer = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(
  plaintext: Uint8Array,
  passphrase: string,
  enableCompression = true
): Promise<EncryptedArchiveEnvelope> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Vault passphrase must be at least 4 characters.');
  }

  const plaintextSha256 = await sha256Hex(plaintext);
  const compressed = enableCompression
    ? await compressGzip(plaintext)
    : { bytes: plaintext, compression: 'none' as const };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    compressed.bytes as BufferSource
  );
  const encryptedBytes = new Uint8Array(encryptedBuf);

  return {
    format: 'termvault-aes256gcm-v1',
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    compression: compressed.compression,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(encryptedBytes),
    plaintextSha256,
    rawBytes: plaintext.byteLength,
    compressedBytes: compressed.bytes.byteLength,
    encryptedBytes: encryptedBytes.byteLength,
    createdAt: new Date().toISOString(),
  };
}

export async function decryptPayload(
  envelope: EncryptedArchiveEnvelope,
  passphrase: string
): Promise<Uint8Array> {
  if (!passphrase) {
    throw new Error('Vault passphrase is required to decrypt.');
  }

  const salt = base64ToBytes(envelope.saltB64);
  const iv = base64ToBytes(envelope.ivB64);
  const ciphertext = base64ToBytes(envelope.ciphertextB64);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations || PBKDF2_ITERATIONS);

  let decryptedCompressed: Uint8Array;
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    decryptedCompressed = new Uint8Array(plainBuf);
  } catch {
    throw new Error('Decryption failed: invalid passphrase or corrupted authentication tag.');
  }

  const plaintext =
    envelope.compression === 'gzip'
      ? await decompressGzip(decryptedCompressed)
      : decryptedCompressed;

  const actualHash = await sha256Hex(plaintext);
  if (actualHash !== envelope.plaintextSha256) {
    throw new Error('Integrity verification failed: SHA-256 digest mismatch.');
  }

  return plaintext;
}

export async function createPassphraseCheckToken(passphrase: string): Promise<EncryptedArchiveEnvelope> {
  const sentinel = utf8ToBytes('TERMVAULT_KEY_SENTINEL_OK');
  return encryptPayload(sentinel, passphrase, false);
}

export async function verifyPassphraseCheckToken(
  token: EncryptedArchiveEnvelope,
  passphrase: string
): Promise<boolean> {
  try {
    const bytes = await decryptPayload(token, passphrase);
    return bytesToUtf8(bytes) === 'TERMVAULT_KEY_SENTINEL_OK';
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}
