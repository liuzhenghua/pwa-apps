const iterations = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type CryptoMetadata = { version: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; checkIv: string; check: string };
export type EncryptedNote = { version: 1; iv: string; ciphertext: string };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function randomBytes(length: number): Uint8Array { return crypto.getRandomValues(new Uint8Array(length)); }

async function derive(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function createEncryption(secret: string): Promise<{ metadata: CryptoMetadata; key: CryptoKey }> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt);
  const checkIv = randomBytes(12);
  const check = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: checkIv as BufferSource }, key, encoder.encode('pwa-apps-notes-v1')));
  return { metadata: { version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), checkIv: toBase64(checkIv), check: toBase64(check) }, key };
}

export async function unlockEncryption(secret: string, metadata: CryptoMetadata): Promise<CryptoKey> {
  if (metadata?.version !== 1 || metadata.kdf !== 'PBKDF2-SHA256' || metadata.iterations !== iterations) throw new Error('不支持此云端加密格式。');
  try {
    const key = await derive(secret, fromBase64(metadata.salt));
    const check = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(metadata.checkIv) as BufferSource }, key, fromBase64(metadata.check) as BufferSource);
    if (decoder.decode(check) !== 'pwa-apps-notes-v1') throw new Error();
    return key;
  } catch { throw new Error('加密口令错误，或云端加密配置已损坏。'); }
}

export async function encryptNote(value: unknown, key: CryptoKey): Promise<EncryptedNote> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(JSON.stringify(value))));
  return { version: 1, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptNote<T>(value: EncryptedNote, key: CryptoKey): Promise<T> {
  if (value?.version !== 1) throw new Error('不支持此云端笔记加密格式。');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(value.iv) as BufferSource }, key, fromBase64(value.ciphertext) as BufferSource);
    return JSON.parse(decoder.decode(plain)) as T;
  } catch { throw new Error('云端笔记无法解密，文件可能已损坏。'); }
}
