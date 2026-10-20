import type { Caption, Frame, Margins, PhotoAdjustment, TemplateId } from './render-layout';

export type PhotoProject = {
  id: string; name: string; template: TemplateId; createdAt: number; updatedAt: number; lastExportedAt?: number;
  frames: Frame[]; adjustments: PhotoAdjustment[]; captions: Caption[]; margins: Margins; quality: number;
  assets: (Blob | null)[]; thumbnail?: Blob;
};

type StoredAsset = { bytes: ArrayBuffer; type: string };
type StoredProject = Omit<PhotoProject, 'assets'> & { assets: (StoredAsset | Blob | null)[] };

async function restoreProject(project: StoredProject): Promise<PhotoProject> {
  const assets = await Promise.all(project.assets.map(async asset => {
    if (!asset) return null;
    // Read legacy Blob records before an autosave can replace their backing record.
    if (asset instanceof Blob) return new Blob([await asset.arrayBuffer()], { type: asset.type });
    return new Blob([asset.bytes], { type: asset.type });
  }));
  return { ...project, assets };
}

const DB_NAME = 'photo-layout-local';
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readProjects(): Promise<PhotoProject[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').getAll();
    request.onsuccess = () => {
      db.close();
      Promise.all((request.result as StoredProject[]).map(restoreProject))
        .then(items => resolve(items.sort((a, b) => b.updatedAt - a.updatedAt)), reject);
    };
    request.onerror = () => reject(request.error);
  });
}
export async function readProject(id: string): Promise<PhotoProject | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(id);
    request.onsuccess = () => {
      db.close();
      if (!request.result) { resolve(undefined); return; }
      restoreProject(request.result as StoredProject).then(resolve, reject);
    };
    request.onerror = () => reject(request.error);
  });
}
export async function writeProject(project: PhotoProject): Promise<void> {
  // Persist actual bytes, not file-backed Blob handles. Finish reading before
  // opening the write transaction so a read failure leaves the saved record intact.
  const assets = await Promise.all(project.assets.map(async asset => asset
    ? { bytes: await asset.arrayBuffer(), type: asset.type }
    : null));
  const record: StoredProject = { ...project, assets };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(record);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('本地存储事务被中断')); };
  });
}
export async function removeProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('本地存储事务被中断')); };
  });
}
