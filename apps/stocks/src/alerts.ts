import { githubAlertFiles, SyncConflict, type Encrypted } from './backup.ts';
import type { OrderKind } from './domain.ts';

export type PriceAlert = {
  id: string;
  symbol: string;
  name: string;
  kind: OrderKind;
  price: number;
  triggeredAt?: string;
};
export type PushDevice = { endpoint: string; keys: { p256dh: string; auth: string } };
export type DeviceAlerts = { subscription?: PushDevice; alerts: PriceAlert[] };
export type AlertState = { version: 2; publicKey: string; privateKeyBox: Encrypted; devices: Record<string, DeviceAlerts> };
const file = 'alerts.json';

export async function openAlerts(credential: string) {
  const archive = await githubAlertFiles(credential);
  async function read() {
    const head = await archive.head();
    const data = (await archive.read(file, head))?.data as AlertState | undefined;
    if (data && (data.version !== 2 || !data.publicKey || !data.privateKeyBox || !data.devices ||
      Array.isArray(data.devices) || Object.values(data.devices).some(device => !Array.isArray(device?.alerts)))) {
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

export function updateDevice(state: AlertState, id: string, change: (device: DeviceAlerts) => DeviceAlerts): AlertState {
  return { ...state, devices: { ...state.devices, [id]: change(state.devices[id] ?? { alerts: [] }) } };
}

export function matchesAlert(alert: PriceAlert, price: number): boolean {
  return !alert.triggeredAt && (alert.kind === 'buy' ? price <= alert.price : price >= alert.price);
}
