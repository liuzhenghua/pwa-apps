import type { Caption, Frame, Margins, PhotoAdjustment, TemplateId } from './render-layout';

export type PhotoProject = {
  id: string; name: string; template: TemplateId; createdAt: number; updatedAt: number; lastExportedAt?: number;
  frames: Frame[]; adjustments: PhotoAdjustment[]; captions: Caption[]; margins: Margins; quality: number;
  assets: (Blob | null)[]; thumbnail?: Blob;
};

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
    request.onsuccess = () => resolve((request.result as PhotoProject[]).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}
export async function writeProject(project: PhotoProject): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export async function removeProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
