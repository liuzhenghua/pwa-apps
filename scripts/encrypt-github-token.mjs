import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const token = process.env.DATA_GITHUB_TOKEN?.trim();
const passphrase = process.env.DATA_TOKEN_PASSPHRASE || '';
if (!token) throw new Error('缺少 DATA_GITHUB_TOKEN。');
if (!passphrase) throw new Error('缺少 DATA_TOKEN_PASSPHRASE。');
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(passphrase, salt, 600000, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final(), cipher.getAuthTag()]);
const box = { version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') };
const encoded = Buffer.from(JSON.stringify(box)).toString('base64url');
for (const app of ['notes', 'assets']) {
  const output = resolve(import.meta.dirname, `../apps/${app}/.env.local`);
  writeFileSync(output, `VITE_GITHUB_TOKEN_BOX=${encoded}\n`, { mode: 0o600 });
  process.stdout.write(`已写入 ${output}\n`);
}
process.stdout.write('把密文配置为 GitHub Actions Secret：DATA_GITHUB_TOKEN_BOX。\n');
