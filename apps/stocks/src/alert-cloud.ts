import { readStored, saveStored } from '@pwa-apps/shared';
import { alertAccount, openAlerts, requireAlerts, type AlertState, type PriceAlert } from './alerts.ts';
import { bundledToken, missingTokenBoxMessage } from './backup.ts';

type Snapshot = { state?: AlertState; alerts?: PriceAlert[]; error?: string; loading: boolean; saving: boolean };
const freshFor = 45_000;

function readCachedAlerts(key: string): PriceAlert[] | undefined {
  const cached = readStored<unknown>(key, undefined);
  if (!Array.isArray(cached)) return;
  return cached.filter(alert => typeof alert?.id === 'string' && typeof alert.symbol === 'string' &&
    typeof alert.name === 'string' && (alert.kind === 'buy' || alert.kind === 'sell') &&
    Number.isSafeInteger(alert.price) && alert.price > 0);
}

export function createAlertCloud(credential: string, folder: string) {
  const account = folder.trim();
  const setupError = !bundledToken ? missingTokenBoxMessage :
    !credential.trim() || !/^[A-Za-z0-9_-]{1,60}$/.test(account) ? '请先在同步配置中填写云端名字和访问口令。' : undefined;
  const cacheKey = 'stocks:alert-rules:' + account;
  let snapshot: Snapshot = {
    alerts: setupError ? undefined : readCachedAlerts(cacheKey),
    error: setupError,
    loading: false,
    saving: false,
  };
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

  function publishState(state: AlertState) {
    const alerts = alertAccount(state, account).alerts;
    const cachedAlerts = alerts.map(({ id, symbol, name, kind, price, triggeredAt }) =>
      ({ id, symbol, name, kind, price, triggeredAt }));
    try {
      saveStored(cacheKey, cachedAlerts);
    } catch { /* The live list is still available if local storage is disabled or full. */ }
    loadedAt = Date.now();
    publish({ state, alerts, error: undefined });
  }

  function connection() {
    if (!remote || Date.now() >= remoteExpires) {
      remoteExpires = Date.now() + freshFor;
      remote = openAlerts(credential, account);
    }
    return remote;
  }

  return {
    account,
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
        publishState(requireAlerts(data));
      }).catch((reason: unknown) => {
        remote = undefined;
        if (started === generation) publish({ error: reason instanceof Error ? reason.message : '无法读取价格提醒' });
      }).finally(() => {
        refresh = undefined;
        publish({ loading: false });
      });
      return refresh;
    },
    async update(change: (current: AlertState) => AlertState, previousName?: string) {
      if (setupError) throw Error(setupError);
      if (snapshot.saving) throw Error('上一项修改正在保存，请稍后重试');
      publish({ saving: true, error: undefined });
      try {
        const store = await connection();
        const state = await store.update(current => change(requireAlerts(current)), previousName ? [previousName] : undefined);
        generation++;
        publishState(state);
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
