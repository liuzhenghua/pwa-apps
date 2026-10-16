type TokenBox = { version: 1; kdf: 'PBKDF2-SHA256'; iterations: 600000; salt: string; iv: string; ciphertext: string };
const bytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export async function unlockTokenBox(encoded: string, passphrase: string): Promise<string> {
  if (!encoded.trim()) throw new Error('构建时未配置加密 Token。');
  if (!passphrase) throw new Error('请输入云端访问口令。');
  let box: TokenBox;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    box = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as TokenBox;
    if (box.version !== 1 || box.kdf !== 'PBKDF2-SHA256' || box.iterations !== 600000) throw new Error();
  } catch { throw new Error('构建内的加密 Token 格式错误。'); }
  try {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(box.salt) as BufferSource, iterations: box.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) as BufferSource }, key, bytes(box.ciphertext) as BufferSource);
    const token = new TextDecoder().decode(plain).trim();
    if (!token) throw new Error();
    return token;
  } catch { throw new Error('云端访问口令错误，或加密 Token 已损坏。'); }
}
