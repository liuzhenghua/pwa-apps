import type { Note } from './sync';
export type Category = { id: string; name: string; order: number };
export type Library = { notes: Note[]; categories: Category[] };
export const defaults: Category[] = [{ id: 'uncategorized', name: '未分类', order: 0 }, ...['技术', '工作', '生活'].map((name, i) => ({ id: crypto.randomUUID(), name, order: i + 1 }))];
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('notebook', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readLibrary(): Promise<Library | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('library').objectStore('library').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeLibrary(value: Library) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('library', 'readwrite');
    transaction.objectStore('library').put(value, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
