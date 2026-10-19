import { createEncryption, decryptNote, encryptNote, unlockEncryption, type CryptoMetadata, type EncryptedNote } from './crypto.ts';

export type Note = { id: string; title: string; body: string; updated: number; created?: number; categoryId?: string; categoryName?: string; pinned?: boolean; deletedAt?: number | null };
export const storageRepository = 'liuzhenghua/pwa-apps-data';
export type RemoteEntry = { name: string; sha: string };
export type RemoteNotes = { notes: Note[]; shas: Record<string, string>; key?: CryptoKey; encrypted: boolean; fingerprint: string };

export function indexFingerprint(entries: RemoteEntry[]): string {
  return JSON.stringify(entries.map(entry => [entry.name, entry.sha]).sort(([a], [b]) => a.localeCompare(b)));
}

export function mergeNotes(local: Note[], cloud: Note[], baseline: Note[] | null): { notes: Note[]; conflicts: string[] } {
  const localById = new Map(local.map(note => [note.id, note]));
  const cloudById = new Map(cloud.map(note => [note.id, note]));
  const baseById = new Map((baseline || []).map(note => [note.id, note]));
  const merged: Note[] = [];
  const conflicts: string[] = [];
  const same = (a: Note, b: Note) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of new Set([...localById.keys(), ...cloudById.keys()])) {
    const a = localById.get(id), b = cloudById.get(id), previous = baseById.get(id);
    if (a && b) {
      if (same(a, b)) merged.push(a);
      else if (previous && same(a, previous)) merged.push(b);
      else if (previous && same(b, previous)) merged.push(a);
      else {
        merged.push(a, { ...b, id: crypto.randomUUID(), title: `${b.title || '无标题'}（冲突副本）`, deletedAt: null, updated: Date.now() });
        conflicts.push(a.title || '无标题');
      }
    } else if (a || b) {
      const existing = (a || b)!;
      if (!previous || !same(existing, previous)) merged.push(existing);
    }
  }
  return { notes: merged, conflicts };
}

function repoApi(): string {
  const match = storageRepository.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) throw new Error('GitHub 存储仓库配置不正确。');
  return `https://api.github.com/repos/${match[1]}/${match[2]}`;
}

function directory(folder: string): string {
  return `${repoApi()}/contents/notes/${encodeURIComponent(validateFolder(folder))}`;
}

function fileUrl(folder: string, id: string): string {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('笔记 ID 格式不正确。');
  return `${directory(folder)}/${encodeURIComponent(id)}.json`;
}

function headers(token: string): HeadersInit {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
}

export async function verifyRepository(token: string): Promise<void> {
  const response = await fetch(repoApi(), { headers: headers(token), cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('Token 无效或没有访问仓库的权限。');
  if (response.status === 404) throw new Error('找不到数据仓库，或 Token 没有访问这个私有仓库的权限。');
  if (!response.ok) throw new Error(`验证仓库失败（${response.status}）。`);
  const repository = await response.json() as { private?: boolean };
  if (!repository.private) throw new Error('数据仓库必须设置为 Private。');
}

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function validateFolder(value: string): string {
  const folder = value.trim();
  if (!/^[\w-]{1,60}$/.test(folder)) throw new Error('名字只可使用字母、数字、下划线和连字符，最多 60 位。');
  return folder;
}

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Record<string, unknown>;
  return typeof note.id === 'string' && typeof note.title === 'string' && typeof note.body === 'string' && typeof note.updated === 'number';
}

async function readJsonFile<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: headers(token), cache: 'no-store' });
  if (!response.ok) throw new Error(`读取云端文件失败（${response.status}）。`);
  const file = await response.json() as { content?: string };
  try { return JSON.parse(decodeBase64(file.content || '')) as T; }
  catch { throw new Error('云端文件格式不正确。'); }
}

export async function getRemoteIndex(folder: string, token: string): Promise<RemoteEntry[]> {
  const response = await fetch(directory(folder), { headers: headers(token), cache: 'no-store' });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Token 无效或没有访问该仓库的权限。' : `读取云端失败（${response.status}）。`);
  const entries = await response.json() as RemoteEntry[];
  if (!Array.isArray(entries)) throw new Error('云端文件夹格式不正确。');
  if (entries.length >= 1000) throw new Error('云端笔记文件已接近 GitHub 目录接口上限，请先升级同步方式。');
  return entries;
}

export async function getRemote(folder: string, token: string, secret: string, entries?: RemoteEntry[]): Promise<RemoteNotes> {
  entries ??= await getRemoteIndex(folder, token);
  const fingerprint = indexFingerprint(entries);
  const noteEntries = entries.filter(entry => entry.name.endsWith('.json') && entry.name !== '_crypto.json');
  if (noteEntries.some(entry => !/^[0-9a-f-]+\.json$/i.test(entry.name))) throw new Error('云端包含无法识别的笔记文件。');
  const metadataEntry = entries.find(entry => entry.name === '_crypto.json');
  if (!metadataEntry && noteEntries.length) throw new Error('云端有未加密的旧笔记，请先备份并迁移，不能继续同步。');
  if (!metadataEntry) return { notes: [], shas: {}, encrypted: false, fingerprint };
  const metadata = await readJsonFile<CryptoMetadata>(`${directory(folder)}/_crypto.json`, token);
  const key = await unlockEncryption(secret, metadata);
  const notes = await Promise.all(noteEntries.map(async entry => {
    const id = entry.name.slice(0, -5);
    const encrypted = await readJsonFile<EncryptedNote>(fileUrl(folder, id), token);
    const note = await decryptNote<unknown>(encrypted, key);
    if (!isNote(note) || note.id !== id) throw new Error(`笔记 ${id} 格式不正确。`);
    return note;
  }));
  return { notes, shas: Object.fromEntries(noteEntries.map(entry => [entry.name.slice(0, -5), entry.sha])), key, encrypted: true, fingerprint };
}

export async function putRemote(folder: string, token: string, secret: string, notes: Note[], remote: RemoteNotes): Promise<void> {
  let key = remote.key;
  if (!key) {
    const setup = await createEncryption(secret);
    const response = await fetch(`${directory(folder)}/_crypto.json`, {
      method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Initialize encrypted notes', content: encodeBase64(JSON.stringify(setup.metadata)) }),
    });
    if (!response.ok) throw new Error(`初始化云端加密失败（${response.status}）。`);
    key = setup.key;
  }
  const localIds = new Set(notes.map(note => note.id));
  const remoteById = new Map(remote.notes.map(note => [note.id, note]));
  // GitHub's Contents API creates one commit per request; run writes serially.
  for (const note of notes) {
    const old = remoteById.get(note.id);
    if (old && JSON.stringify(old) === JSON.stringify(note)) continue;
    const response = await fetch(fileUrl(folder, note.id), {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Sync note ${note.id}`, content: encodeBase64(JSON.stringify(await encryptNote(note, key))), ...(remote.shas[note.id] ? { sha: remote.shas[note.id] } : {}) }),
    });
    if (!response.ok) throw new Error(`上传笔记「${note.title || '无标题'}」失败（${response.status}）。云端可能已部分更新，请重新读取。`);
  }
  for (const [id, sha] of Object.entries(remote.shas)) {
    if (localIds.has(id)) continue;
    const response = await fetch(fileUrl(folder, id), {
      method: 'DELETE',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete note ${id}`, sha }),
    });
    if (!response.ok) throw new Error(`删除云端笔记 ${id} 失败（${response.status}）。云端可能已部分更新，请重新读取。`);
  }
}
