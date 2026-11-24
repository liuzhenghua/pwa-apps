import { githubArchive, SyncConflict } from './backup.ts';
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
export type AlertState = { version: 1; publicKey: string; device?: PushDevice; alerts: PriceAlert[] };
const file = 'alerts.json';

export async function openAlerts(config: { folder: string; credential: string; secret: string }) {
  const archive = await githubArchive(config.folder, config.credential, config.secret);
  async function read() {
    const head = await archive.head();
    const data = (await archive.read(file, head))?.data as AlertState | undefined;
    if (data && (data.version !== 1 || !data.publicKey || !Array.isArray(data.alerts))) {
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
  if (!state) throw Error('请先在盯盘电脑上初始化价格提醒');
  return state;
}

export function matchesAlert(alert: PriceAlert, price: number): boolean {
  return !alert.triggeredAt && (alert.kind === 'buy' ? price <= alert.price : price >= alert.price);
}
