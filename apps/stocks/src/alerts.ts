import { githubAlertFiles, SyncConflict, type Encrypted } from './backup.ts';
import type { OrderKind } from './domain.ts';

export type PriceAlert = {
  id: string;
  symbol: string;
  name: string;
  kind: OrderKind;
  price: number;
  triggeredAt?: string;
  notifiedDevices?: string[];
};
export type PushDevice = { endpoint: string; keys: { p256dh: string; auth: string } };
export type DeviceAlerts = { subscription?: PushDevice; alerts: PriceAlert[] };
export type AlertAccount = { alerts: PriceAlert[]; devices: Record<string, PushDevice> };
export type AlertState = {
  version: 2; publicKey: string; privateKeyBox: Encrypted;
  devices: Record<string, DeviceAlerts>;
  accounts?: Record<string, AlertAccount>;
};
const file = 'alerts.json';

export async function openAlerts(credential: string) {
  const archive = await githubAlertFiles(credential);
  async function read() {
    const head = await archive.head();
    const data = (await archive.read(file, head))?.data as AlertState | undefined;
    if (data && (data.version !== 2 || !data.publicKey || !data.privateKeyBox || !data.devices ||
      Array.isArray(data.devices) || Object.values(data.devices).some(device => !Array.isArray(device?.alerts)) ||
      (data.accounts && Object.values(data.accounts).some(account => !Array.isArray(account?.alerts) || !account.devices)))) {
      throw Error('无法识别云端提醒配置');
    }
    return { head, data };
  }

  return {
    read,
    async update(change: (current: AlertState | undefined) => AlertState) {
      for (let attempt = 0; ; attempt++) {
        const { head, data } = await read();
        const next = change(data);
        if (next === data) return next;
        try {
          await archive.publish(head, new Map([[file, next]]));
          return next;
        } catch (error) {
          if (!(error instanceof SyncConflict) || attempt >= 3) throw error;
        }
      }
    },
  };
}

export function requireAlerts(state: AlertState | undefined): AlertState {
  if (!state) throw Error('家庭价格提醒尚未初始化。请在盯盘电脑上按 README 运行 npm run stocks:alerts -- --init');
  return state;
}

export function alertAccount(state: AlertState, name: string): AlertAccount {
  return state.accounts && Object.hasOwn(state.accounts, name) ? state.accounts[name] : { alerts: [], devices: {} };
}

export function updateAlertAccount(state: AlertState, name: string, change: (account: AlertAccount) => AlertAccount): AlertState {
  return { ...state, accounts: { ...state.accounts, [name]: change(alertAccount(state, name)) } };
}

export function enrollAlertDevice(state: AlertState, name: string, id: string, subscription?: PushDevice): AlertState {
  const { [id]: legacy, ...devices } = state.devices;
  const accounts = Object.fromEntries(Object.entries(state.accounts ?? {}).map(([accountName, account]) => {
    if (accountName === name || !Object.hasOwn(account.devices, id)) return [accountName, account];
    const { [id]: previous, ...remaining } = account.devices;
    return [accountName, { ...account, devices: remaining }];
  }));
  return updateAlertAccount({ ...state, devices, accounts }, name, account => {
    const seen = new Set(account.alerts.map(alert => alert.id));
    return {
      alerts: [...account.alerts, ...(legacy?.alerts ?? []).filter(alert => !seen.has(alert.id))],
      devices: subscription ? { ...account.devices, [id]: subscription } : account.devices,
    };
  });
}

export function matchesAlert(alert: PriceAlert, price: number): boolean {
  return !alert.triggeredAt && (alert.kind === 'buy' ? price <= alert.price : price >= alert.price);
}

export function sharedAlertTargets(state: AlertState) {
  return Object.entries(state.accounts ?? {}).flatMap(([account, { alerts, devices }]) =>
    alerts.filter(alert => !alert.triggeredAt).flatMap(alert => Object.entries(devices)
      .filter(([id]) => !alert.notifiedDevices?.includes(id))
      .map(([id, device]) => ({ account, id, alert, device }))));
}

export function applySharedAlertResults(
  state: AlertState,
  delivered: ReadonlyMap<string, string>,
  expired: ReadonlyMap<string, string>,
) {
  if (!state.accounts || (!delivered.size && !expired.size)) return state;
  let changed = false;
  const accounts = Object.fromEntries(Object.entries(state.accounts).map(([name, account]) => {
    const devices = Object.fromEntries(Object.entries(account.devices)
      .filter(([id, device]) => expired.get(JSON.stringify([name, id])) !== device.endpoint));
    const deviceIds = Object.keys(devices);
    const alerts = account.alerts.map(alert => {
      if (alert.triggeredAt) return alert;
      const notified = new Set(alert.notifiedDevices);
      let acceptedAt: string | undefined;
      for (const id of Object.keys(account.devices)) {
        const time = delivered.get(JSON.stringify([name, alert.id, id]));
        if (!time) continue;
        notified.add(id);
        acceptedAt ??= time;
      }
      if (notified.size && deviceIds.every(id => notified.has(id))) {
        return { ...alert, triggeredAt: acceptedAt ?? new Date().toISOString(), notifiedDevices: undefined };
      }
      return acceptedAt ? { ...alert, notifiedDevices: [...notified] } : alert;
    });
    if (deviceIds.length === Object.keys(account.devices).length && alerts.every((alert, i) => alert === account.alerts[i])) return [name, account];
    changed = true;
    return [name, { alerts, devices }];
  }));
  return changed ? { ...state, accounts } : state;
}
