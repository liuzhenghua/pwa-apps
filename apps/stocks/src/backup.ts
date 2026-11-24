import { unlockTokenBox } from '@pwa-apps/shared';
import { validateLedger, type Ledger } from './domain.ts';
import { assembleLedger, calendarYear, splitLedger, validateIndex, type ArchiveIndex, type ArchiveState, type Part, type YearRecords } from './archive.ts';
import { updateLocal, type LocalState } from './store.ts';

const folderPattern = /^[\w-]{1,60}$/;

export const repository = 'liuzhenghua/pwa-apps-data';
export const bundledToken = import.meta.env?.VITE_GITHUB_TOKEN_BOX?.trim();
export const missingTokenBoxMessage = '缺少 GitHub 同步配置。请配置 VITE_GITHUB_TOKEN_BOX 后重新启动开发服务，或重新部署应用。';
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

async function encrypt(data: unknown, secret: string): Promise<Encrypted> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret, salt), encoder.encode(JSON.stringify(data)));
  return { format: 'stocks-encrypted-v1', salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

async function decrypt(raw: Encrypted, secret: string): Promise<unknown> {
  if (raw?.format !== 'stocks-encrypted-v1') throw Error('云端备份格式无法识别');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(raw.iv) }, await key(secret, decode(raw.salt)), decode(raw.ciphertext));
    return JSON.parse(decoder.decode(plain));
  } catch {
    throw Error('无法解密云端备份，请检查数据口令及备份文件');
  }
}

export type SyncDirection = 'auto' | 'upload' | 'download';

export class SyncConflict extends Error {}

export async function githubArchive(folderInput: string, credential: string, secret: string) {
  const folder = folderInput.trim();
  if (!folderPattern.test(folder)) throw Error('云端名字需使用 1–60 位字母、数字、下划线或连字符');
  if (!credential.trim() || !secret) throw Error('请填写云端访问凭据和数据加密口令');
  const directory = 'stocks/' + folder + '/';
  const token = bundledToken ? await unlockTokenBox(bundledToken, credential) : credential.trim();
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' };
  const repo = await fetch(api, { headers, cache: 'no-store' });
  if (!repo.ok) throw Error('无法访问私有数据仓库（' + repo.status + '）');
  const repositoryInfo = await repo.json();
  if (!repositoryInfo.private) throw Error('GitHub 数据仓库必须设置为 Private');
  if (typeof repositoryInfo.default_branch !== 'string' || !repositoryInfo.default_branch) throw Error('无法确认数据仓库的默认分支');
  const branch = 'heads/' + repositoryInfo.default_branch.split('/').map(encodeURIComponent).join('/');

  async function request(path: string, message: string) {
    const response = await fetch(api + path, { headers, cache: 'no-store' });
    if (!response.ok) throw Error(message + '（' + response.status + '）');
    return response.json();
  }

  async function head(): Promise<string> {
    const response = await request('/git/ref/' + branch, '无法读取默认分支，请确认数据仓库已有初始提交');
    if (typeof response.object?.sha !== 'string') throw Error('无法读取默认分支版本');
    return response.object.sha;
  }

  async function read(file: string, commit: string) {
    const response = await fetch(api + '/contents/' + directory + file + '?ref=' + encodeURIComponent(commit), { headers, cache: 'no-store' });
    if (response.status === 404) return undefined;
    if (!response.ok) throw Error('读取云端失败（' + response.status + '）');
    const payload = await response.json();
    if (typeof payload.sha !== 'string' || typeof payload.content !== 'string' || !payload.content.trim()) {
      throw Error('云端文件内容无法读取，可能超出单文件大小限制');
    }
    return { sha: payload.sha as string, data: await decrypt(JSON.parse(decoder.decode(decode(payload.content))), secret) };
  }

  async function gitWrite(path: string, method: 'POST' | 'PATCH', data: unknown) {
    const result = await fetch(api + '/git/' + path, {
      method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!result.ok) {
      if (method === 'PATCH' && [409, 422].includes(result.status)) {
        throw new SyncConflict('云端分支已变化，或拒绝更新，请重新同步');
      }
      throw Error('写入云端 ' + path.split('/')[0] + ' 失败（' + result.status + '）');
    }
    return result.json();
  }

  async function publish(parent: string, changes: Map<string, unknown>) {
    const base = await request('/git/commits/' + encodeURIComponent(parent), '无法读取当前提交');
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
    let indexSha = '';
    for (const [file, data] of changes) {
      let sha: string | null = null;
      if (data !== null) {
        const serialized = encoder.encode(JSON.stringify(data));
        // AES-GCM adds a 16-byte tag before the ciphertext is encoded in Base64.
        if (Math.ceil((serialized.length + 16) / 3) * 4 + 256 > 950_000) {
          throw Error('「' + file + '」将超过 950 KB，已保留原云端备份');
        }
        const content = encode(encoder.encode(JSON.stringify(await encrypt(data, secret))));
        sha = (await gitWrite('blobs', 'POST', { content, encoding: 'base64' })).sha;
        if (typeof sha !== 'string' || !sha) throw Error('云端文件版本无效');
      }
      if (file === 'open.json') indexSha = sha ?? '';
      tree.push({ path: directory + file, mode: '100644', type: 'blob', sha });
    }
    const message = changes.has('alerts.json') ? 'Sync encrypted stock alerts' : 'Sync encrypted stock ledger';
    const nextTree = await gitWrite('trees', 'POST', { base_tree: base.tree.sha, tree });
    const commit = await gitWrite('commits', 'POST', { message, tree: nextTree.sha, parents: [parent] });
    await gitWrite('refs/' + branch, 'PATCH', { sha: commit.sha, force: false });
    return { sha: indexSha, commit: commit.sha as string };
  }

  return { folder, head, read, publish };
}

async function digest(data: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readPart<T extends unknown[]>(remote: Awaited<ReturnType<typeof githubArchive>>, part: Part, commit: string): Promise<T> {
  const result = await remote.read(part.file, commit);
  if (!Array.isArray(result?.data) || await digest(result.data) !== part.digest) throw Error('云端归档缺失或内容不匹配');
  return result.data as T;
}

async function stagePart(changes: Map<string, unknown>, file: string, data: unknown[], previous?: Part): Promise<Part> {
  const checksum = await digest(data);
  if (previous?.file !== file || previous.digest !== checksum) changes.set(file, data);
  return { file, digest: checksum };
}

export async function syncGithub(
  local: LocalState, folderInput: string, credential: string, secret: string, direction: SyncDirection,
  confirmReplace: (direction: Exclude<SyncDirection, 'auto'>) => boolean,
) {
  const remote = await githubArchive(folderInput, credential, secret);
  const { folder } = remote;
  const commit = await remote.head();
  const openFile = await remote.read('open.json', commit);
  const bundled = (openFile?.data as { format?: string } | undefined)?.format === 'stocks-index-v3';
  const oldFile = bundled ? undefined : await remote.read('ledger.json', commit);
  if (openFile && !bundled && (!oldFile || !Array.isArray(openFile.data))) throw Error('云端 open.json 格式无法识别');
  const head = bundled ? openFile : oldFile;
  let sha = head?.sha ?? null;
  const data = head?.data as { format?: string } | undefined;
  const index = bundled || data?.format === 'stocks-index-v2' ? validateIndex(data) : undefined;
  const legacy = head && !index ? validateLedger(data) : undefined;
  const { ledger } = local;
  const baseline = local.sync?.[folder];
  const remoteRevision = index?.core.revision ?? legacy?.revision;
  const same = remoteRevision === ledger.revision && (!legacy || JSON.stringify(legacy) === JSON.stringify(ledger));
  let action: SyncDirection = direction;

  if (same) {
    const needsCurrentYear = local.archive?.missing.includes(calendarYear());
    const switchedPartialFolder = !!local.archive?.missing.length && local.archive.folder !== folder;
    action = switchedPartialFolder || needsCurrentYear ? 'download' : oldFile ? 'upload' : 'auto';
  }
  else if (!head && ledger.revision === 'empty') action = 'auto';
  else if (direction === 'auto') {
    const changedLocal = ledger.revision !== (baseline?.revision ?? 'empty');
    const changedCloud = sha !== (baseline?.sha ?? null);
    if (changedLocal && !changedCloud) action = 'upload';
    else if (!changedLocal && changedCloud && head) action = 'download';
    else if (changedLocal || changedCloud) throw new SyncConflict('本机和云端内容不同，无法自动同步。导出备份后，可选择保留哪一端。');
  } else {
    if (direction === 'download' && !head) throw Error('云端尚无可恢复的备份');
    if (!confirmReplace(direction)) return { local, message: '已取消同步', canceled: true };
  }

  let nextLedger = ledger;
  let archive = local.archive;
  if (action === 'upload') {
    const pending = local.archive?.missing ?? [];
    if (pending.length && local.archive?.folder !== folder) throw Error('切换云端名字前，请先在原目录下载全部历史');
    const { core, open, years } = splitLedger(ledger);
    const files: ArchiveIndex['years'] = {};
    const changes = new Map<string, unknown>();
    for (const year of pending) {
      const previous = local.archive!.years[year];
      const name = 'year-' + year + '.json';
      const current = index?.years[year];
      if (current?.file === name && current.digest === previous.digest) {
        files[year] = current;
      } else {
        const records = await readPart<YearRecords>(remote, previous, local.archive?.commit ?? commit);
        files[year] = await stagePart(changes, name, records, current);
      }
    }
    for (const [year, records] of Object.entries(years)) {
      files[year] = await stagePart(changes, 'year-' + year + '.json', records, index?.years[year]);
    }
    for (const [year, part] of Object.entries(index?.years ?? {})) {
      if (!(year in files) && part.file === 'year-' + year + '.json') changes.set(part.file, null);
    }
    const nextIndex: ArchiveIndex = { format: 'stocks-index-v3', core, open, years: files };
    changes.set('open.json', nextIndex);
    if (oldFile) changes.set('ledger.json', null);
    const published = await remote.publish(commit, changes);
    sha = published.sha;
    archive = { folder, commit: published.commit, years: files, missing: pending };
  } else if (action === 'download') {
    if (index) {
      const cached = splitLedger(ledger);
      const loaded: YearRecords[] = [];
      const missing: string[] = [];
      const yearNow = calendarYear();
      for (const [year, part] of Object.entries(index.years)) {
        if (cached.years[year] && await digest(cached.years[year]) === part.digest) loaded.push(cached.years[year]);
        else if (year === yearNow) loaded.push(await readPart(remote, part, commit));
        else missing.push(year);
      }
      let open: ReturnType<typeof splitLedger>['open'] = [];
      if (index.format === 'stocks-index-v3') open = index.open;
      else if (index.open) {
        open = openFile && index.open.file === 'open.json' && await digest(openFile.data) === index.open.digest
          ? openFile.data as typeof open : await readPart(remote, index.open, commit);
      }
      nextLedger = assembleLedger(index.core, open, loaded);
      archive = { folder, commit, years: index.years, missing };
    } else if (legacy) {
      nextLedger = legacy;
      archive = undefined;
    }
  }

  const next = await updateLocal(ledger.revision, current => {
    if (action === 'upload' && archive && current.archive?.folder === archive.folder) {
      const stillMissing = current.archive.missing;
      archive = { ...archive, missing: archive.missing.filter(year => stillMissing.includes(year)) };
    }
    return {
      ...current, ledger: action === 'download' ? nextLedger : current.ledger,
      archive: action === 'auto' ? current.archive : archive,
      sync: { ...current.sync, [folder]: { revision: nextLedger.revision, sha, time: Date.now() } },
    };
  });
  return {
    local: next,
    message: action === 'upload' ? '已加密上传到 GitHub' : action === 'download' ? '已从 GitHub 更新本机' : '本机与云端已同步',
  };
}

export async function loadArchiveYears(local: LocalState, years: string[], credential: string, secret: string): Promise<LocalState> {
  const archive = local.archive;
  if (!archive) return local;
  const pending = years.filter(year => archive.missing.includes(year));
  if (!pending.length) return local;
  const remote = await githubArchive(archive.folder, credential, secret);
  const fetched = new Map<string, YearRecords>();
  const commit = archive.commit ?? await remote.head();
  for (const year of pending) fetched.set(year, await readPart(remote, archive.years[year], commit));
  return updateLocal(local.ledger.revision, current => {
    const target = current.archive;
    if (!target || target.folder !== archive.folder || pending.some(year => target.years[year]?.digest !== archive.years[year].digest)) {
      throw Error('归档已变化，请重新同步后再试');
    }
    const { core, open, years: loaded } = splitLedger(current.ledger);
    for (const [year, records] of fetched) if (target.missing.includes(year)) loaded[year] = records;
    return {
      ...current, ledger: assembleLedger(core, open, Object.values(loaded)),
      archive: { ...target, missing: target.missing.filter(year => !fetched.has(year)) },
    };
  });
}

export function downloadLedger(ledger: Ledger) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(ledger, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stocks-' + new Date().toISOString().slice(0, 10) + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
