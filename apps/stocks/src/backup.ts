import { unlockTokenBox } from '@pwa-apps/shared';
import { validateLedger, type Ledger } from './domain.ts';
import { updateLocal, type LocalState } from './store.ts';

const folderPattern = /^[\w-]{1,60}$/;

export const repository = 'liuzhenghua/pwa-apps-data';
export const bundledToken = import.meta.env?.VITE_GITHUB_TOKEN_BOX?.trim();
const api = 'https://api.github.com/repos/' + repository;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Encrypted = { format: 'stocks-encrypted-v1'; salt: string; iv: string; ciphertext: string };
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
const decode = (value: string) => Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0));

async function key(secret: string, salt: Uint8Array<ArrayBuffer>) {
  const raw = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, raw,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encrypt(ledger: Ledger, secret: string): Promise<Encrypted> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret, salt), encoder.encode(JSON.stringify(ledger)));
  return { format: 'stocks-encrypted-v1', salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

async function decrypt(raw: Encrypted, secret: string): Promise<Ledger> {
  if (raw?.format !== 'stocks-encrypted-v1') throw Error('云端备份格式无法识别');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(raw.iv) }, await key(secret, decode(raw.salt)), decode(raw.ciphertext));
    return validateLedger(JSON.parse(decoder.decode(plain)));
  } catch {
    throw Error('无法解密云端备份，请检查数据口令及备份文件');
  }
}

export type SyncDirection = 'auto' | 'upload' | 'download';

export class SyncConflict extends Error {}

export async function syncGithub(
  local: LocalState, folderInput: string, credential: string, secret: string, direction: SyncDirection,
  confirmReplace: (direction: Exclude<SyncDirection, 'auto'>) => boolean,
) {
  const folder = folderInput.trim();
  if (!folderPattern.test(folder)) throw Error('云端名字需使用 1–60 位字母、数字、下划线或连字符');
  if (!credential.trim() || !secret) throw Error('请填写云端访问凭据和数据加密口令');
  const token = bundledToken ? await unlockTokenBox(bundledToken, credential) : credential.trim();
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' };
  const repo = await fetch(api, { headers, cache: 'no-store' });
  if (!repo.ok) throw Error('无法访问私有数据仓库（' + repo.status + '）');
  if (!(await repo.json()).private) throw Error('GitHub 数据仓库必须设置为 Private');
  const url = api + '/contents/stocks/' + encodeURIComponent(folder) + '/ledger.json';
  const file = await fetch(url, { headers, cache: 'no-store' });
  if (!file.ok && file.status !== 404) throw Error('读取云端失败（' + file.status + '）');
  let sha: string | null = null;
  let cloud: Ledger | null = null;
  if (file.ok) {
    const payload = await file.json();
    if (typeof payload.sha !== 'string' || typeof payload.content !== 'string') throw Error('云端文件内容无法读取');
    sha = payload.sha;
    cloud = await decrypt(JSON.parse(decoder.decode(decode(payload.content))), secret);
  }

  const { ledger } = local;
  const baseline = local.sync?.[folder];
  const same = cloud && JSON.stringify(cloud) === JSON.stringify(ledger);
  let action: SyncDirection = direction;
  if (same || (!cloud && ledger.revision === 'empty')) action = 'auto';
  else if (direction === 'auto') {
    const changedLocal = ledger.revision !== (baseline?.revision ?? 'empty');
    const changedCloud = sha !== (baseline?.sha ?? null);
    if (changedLocal && !changedCloud) action = 'upload';
    else if (!changedLocal && changedCloud && cloud) action = 'download';
    else if (changedLocal || changedCloud) throw new SyncConflict('本机和云端内容不同，无法自动同步。导出备份后，可选择保留哪一端。');
  } else {
    if (direction === 'download' && !cloud) throw Error('云端尚无可恢复的备份');
    if (!confirmReplace(direction)) return { local, message: '已取消同步', canceled: true };
  }

  if (action === 'upload') {
    const encrypted = await encrypt(ledger, secret);
    const result = await fetch(url, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Sync encrypted stock ledger', content: encode(encoder.encode(JSON.stringify(encrypted))), ...(sha ? { sha } : {}) }),
    });
    if (!result.ok) {
      if ([409, 422].includes(result.status)) throw new SyncConflict('云端备份已变化，请重新同步');
      throw Error('上传云端失败（' + result.status + '）');
    }
    sha = (await result.json()).content.sha;
  }

  const nextLedger = action === 'download' && cloud ? cloud : ledger;
  const next = await updateLocal(ledger.revision, current => ({
    ...current, ledger: nextLedger,
    sync: { ...current.sync, [folder]: { revision: nextLedger.revision, sha, time: Date.now() } },
  }));
  return {
    local: next,
    message: action === 'upload' ? '已加密上传到 GitHub' : action === 'download' ? '已从 GitHub 更新本机' : '本机与云端已同步',
  };
}

export function downloadLedger(ledger: Ledger) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(ledger, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stocks-' + new Date().toISOString().slice(0, 10) + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
