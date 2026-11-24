import { openAlerts, requireAlerts, type AlertState } from './alerts.ts';
import { bundledToken, missingTokenBoxMessage } from './backup.ts';

type Snapshot = { state?: AlertState; error?: string; loading: boolean; saving: boolean };
const freshFor = 45_000;

export function createAlertCloud(credential: string) {
  const setupError = !bundledToken ? missingTokenBoxMessage :
    !credential.trim() ? '请先在同步配置中填写云端访问口令。' : undefined;
  let snapshot: Snapshot = { error: setupError, loading: false, saving: false };
  let loadedAt = 0;
  let generation = 0;
  let refresh: Promise<void> | undefined;
  let remote: Promise<Awaited<ReturnType<typeof openAlerts>>> | undefined;
  let remoteExpires = 0;
  const listeners = new Set<() => void>();

  function publish(changes: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach(listener => listener());
  }

  function connection() {
    if (!remote || Date.now() >= remoteExpires) {
      remoteExpires = Date.now() + freshFor;
      remote = openAlerts(credential);
    }
    return remote;
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(force = false) {
      if (refresh) return refresh;
      if (setupError || snapshot.saving || (!force && Date.now() - loadedAt < freshFor)) return;
      publish({ loading: true, error: undefined });
      const started = generation;
      refresh = connection().then(store => store.read()).then(({ data }) => {
        if (started !== generation) return;
        const state = requireAlerts(data);
        loadedAt = Date.now();
        publish({ state });
      }).catch((reason: unknown) => {
        remote = undefined;
        if (started === generation) publish({ error: reason instanceof Error ? reason.message : '无法读取价格提醒' });
      }).finally(() => {
        refresh = undefined;
        publish({ loading: false });
      });
      return refresh;
    },
    async update(change: (current: AlertState) => AlertState) {
      if (setupError) throw Error(setupError);
      if (snapshot.saving) throw Error('上一项修改正在保存，请稍后重试');
      publish({ saving: true, error: undefined });
      try {
        const store = await connection();
        const state = await store.update(current => change(requireAlerts(current)));
        generation++;
        loadedAt = Date.now();
        publish({ state, error: undefined });
      } catch (reason) {
        remote = undefined;
        throw reason;
      } finally {
        publish({ saving: false });
      }
    },
  };
}

export type AlertCloud = ReturnType<typeof createAlertCloud>;
