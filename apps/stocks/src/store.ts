import { emptyLedger, validateLedger, type Ledger } from './domain.ts';

type SyncPoint = { revision: string; sha: string | null; time: number };
export type LocalState = { ledger: Ledger; backupAt?: number; sync?: Record<string, SyncPoint> };
let database: Promise<IDBDatabase> | undefined;

function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pwa-stocks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ledger');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('请关闭使用旧版应用的标签页后重试'));
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

const initial = (): LocalState => ({ ledger: emptyLedger() });

export async function readLocal(): Promise<LocalState> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('ledger').objectStore('ledger').get('current');
    request.onsuccess = () => resolve(request.result ?? initial());
    request.onerror = () => reject(request.error);
  });
}

export async function updateLocal(revision: string, update: (current: LocalState) => LocalState): Promise<LocalState> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('ledger', 'readwrite');
    const store = transaction.objectStore('ledger');
    const request = store.get('current');
    let next: LocalState;
    request.onsuccess = () => {
      try {
        const current: LocalState = request.result ?? initial();
        if (current.ledger.revision !== revision) throw Error('数据已在其他标签页修改，请刷新本地数据后重试');
        next = update(current);
        validateLedger(next.ledger);
        store.put(next, 'current');
      } catch (error) {
        reject(error);
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onabort = () => reject(transaction.error ?? Error('本地保存未完成'));
  });
}
