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
const legacyFile = 'alerts.json';
const pushFile = 'push.json';
const accountName = /^[A-Za-z0-9_-]{1,60}$/;
const accountPath = (name: string) => 'accounts/' + name + '.json';

type PushConfig = Pick<AlertState, 'publicKey' | 'privateKeyBox'>;

function validAccount(value: AlertAccount | undefined): value is AlertAccount {
  return Boolean(value && Array.isArray(value.alerts) && value.devices &&
    typeof value.devices === 'object' && !Array.isArray(value.devices));
}

export async function openAlerts(credential: string, name?: string) {
  if (name !== undefined && !accountName.test(name)) throw Error('无效的云端名字');
  const archive = await githubAlertFiles(credential);

  async function load(accountsToRead?: readonly string[]) {
    const head = await archive.head();
    const [pushEntry, legacyEntry, files] = await Promise.all([
      archive.read(pushFile, head),
      archive.read(legacyFile, head),
      name === undefined && accountsToRead === undefined ? archive.list('accounts', head) : [],
    ]);
    const config = pushEntry?.data as PushConfig | undefined;
    const legacy = legacyEntry?.data as AlertState | undefined;
    if (legacy && (legacy.version !== 2 || !legacy.devices ||
      Object.values(legacy.devices).some(device => !Array.isArray(device?.alerts)))) {
      throw Error('无法识别旧版提醒配置');
    }
    const push = config ?? legacy;
    if (!push) return { head, config, legacy, data: undefined, stored: new Map<string, AlertAccount>() };
    if (!push.publicKey || !push.privateKeyBox) throw Error('无法识别推送密钥配置');

    const names = name !== undefined || accountsToRead !== undefined
      ? [name, ...(accountsToRead ?? [])]
      : [...files.filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)), ...Object.keys(legacy?.accounts ?? {})];
    const selected = [...new Set(names.filter((value): value is string => Boolean(value && accountName.test(value))))];
    const stored = new Map<string, AlertAccount>();
    const accounts = Object.fromEntries((await Promise.all(selected.map(async account => {
      const entry = await archive.read(accountPath(account), head);
      if (entry && !validAccount(entry.data)) throw Error('无法识别 ' + account + ' 的价格提醒');
      if (entry) stored.set(account, entry.data);
      const old = legacy?.accounts && Object.hasOwn(legacy.accounts, account) ? legacy.accounts[account] : undefined;
      return [account, entry?.data ?? old] as const;
    }))).filter((entry): entry is readonly [string, AlertAccount] => Boolean(entry[1])));
    const data: AlertState = { version: 2, publicKey: push.publicKey, privateKeyBox: push.privateKeyBox, devices: legacy?.devices ?? {}, accounts };
    return { head, config, legacy, data, stored };
  }

  async function read() {
    const { head, data } = await load();
    return { head, data };
  }

  return {
    read,
    async update(change: (current: AlertState | undefined) => AlertState, accountsToRead?: readonly string[]) {
      for (let attempt = 0; ; attempt++) {
        const { head, config, legacy, data, stored } = await load(accountsToRead);
        const next = change(data);
        const changes = new Map<string, unknown>();
        if (!config) changes.set(pushFile, { publicKey: next.publicKey, privateKeyBox: next.privateKeyBox });
        const remaining = { ...legacy?.accounts };
        for (const [account, value] of Object.entries(next.accounts ?? {})) {
          if (!accountName.test(account)) throw Error('无效的云端名字');
          if (stored.get(account) !== value) changes.set(accountPath(account), value);
          delete remaining[account];
        }
        if (legacy && (Object.keys(legacy.accounts ?? {}).length !== Object.keys(remaining).length || legacy.devices !== next.devices)) {
          changes.set(legacyFile, Object.keys(next.devices).length || Object.keys(remaining).length
            ? { ...legacy, devices: next.devices, accounts: remaining } : null);
        } else if (legacy && !Object.keys(legacy.devices).length && !Object.keys(remaining).length) {
          changes.set(legacyFile, null);
        }
        if (!changes.size) return next;
        try {
          await archive.publish(head, changes);
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
  return updateAlertAccount({ ...state, devices: legacy ? devices : state.devices, accounts }, name, account => {
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
