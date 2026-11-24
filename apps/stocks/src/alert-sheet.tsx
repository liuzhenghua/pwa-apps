import { useEffect, useState, useSyncExternalStore } from 'react';
import { cents, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import { updateDevice, type AlertState, type DeviceAlerts, type PriceAlert } from './alerts.ts';
import type { AlertCloud } from './alert-cloud.ts';

type Props = {
  cloud: AlertCloud;
  symbol: string;
  name: string;
  close: () => void;
};

const deviceKey = 'stocks:alert-device';

export function AlertSheet({ cloud, symbol, name, close }: Props) {
  const { state, error: loadError, loading, saving } = useSyncExternalStore(cloud.subscribe, cloud.snapshot);
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem(deviceKey) ?? crypto.randomUUID());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<OrderKind>('buy');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();

  useEffect(() => {
    let mounted = true;
    void navigator.serviceWorker?.ready.then(worker => {
      if (mounted) setRegistration(worker);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => { void cloud.refresh(); }, [cloud]);

  const pending = working || saving;

  async function run(action: () => Promise<void>, success: string) {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试');
      return false;
    } finally {
      setWorking(false);
    }
  }

  function editAlerts(edit: (alerts: PriceAlert[]) => PriceAlert[], needsSubscription = false) {
    return cloud.update(current => updateDevice(current, deviceId, device => {
      if (needsSubscription && !device.subscription) throw Error('请先在此设备重新启用通知');
      return { ...device, alerts: edit(device.alerts) };
    }));
  }

  async function enable() {
    if (!state) return;
    const { publicKey } = state;
    await run(async () => {
      if (!('Notification' in window) || !('PushManager' in window) || !navigator.serviceWorker) {
        throw Error('请从 iPhone 主屏幕打开已安装的股票账簿，再启用通知');
      }
      if (!registration?.active) throw Error('推送服务正在安装，请重新打开已部署的账簿后重试');
      const id = localStorage.getItem(deviceKey) ?? deviceId;
      localStorage.setItem(deviceKey, id);
      setDeviceId(id);
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      let subscription: PushSubscription;
      try {
        // Safari must receive the subscription request directly from the tap handler.
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch (reason) {
        if (Notification.permission === 'denied') throw Error('通知权限未开启，请在系统设置中允许通知');
        throw reason;
      }
      const { keys } = subscription.toJSON();
      if (!keys?.auth || !keys.p256dh) throw Error('无法读取本机推送订阅');
      const pushDevice = { endpoint: subscription.endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } };
      return cloud.update(current => {
        if (current.publicKey !== publicKey) throw Error('推送配置已更新，请关闭弹窗后重试');
        return updateDevice(current, id, device => ({ ...device, subscription: pushDevice }));
      });
    }, '已将此设备设为通知接收设备');
  }

  async function add() {
    const saved = await run(async () => {
      const alert: PriceAlert = { id: crypto.randomUUID(), symbol, name, kind, price: cents(price) };
      return editAlerts(alerts => [...alerts, alert], true);
    }, '已保存价格提醒');
    if (saved) setPrice('');
  }

  const device: DeviceAlerts | undefined = state?.devices[deviceId];
  const alerts = state && (device?.alerts ?? []).filter(alert => alert.symbol === symbol);
  return <form onSubmit={event => { event.preventDefault(); if (device?.subscription && !pending) void add(); }}>
    <div className="section-title editor-heading">
      <h2 id="watch-editor-title">价格提醒</h2>
      <button type="button" onClick={close}>关闭</button>
    </div>
    <div className="editor-content">
      <p className="muted">{name} · {symbol.slice(2)}</p>
      {alerts && (alerts.length ? <ul className="alert-list">
        {alerts.map(alert => <li key={alert.id}>
          <div><strong>{alert.kind === 'buy' ? '买入 ≤ ' : '卖出 ≥ '}{money(alert.price)}</strong>
            <span className="muted">{alert.triggeredAt ? '已触发' : '待触发'}</span></div>
          {alert.triggeredAt && <button type="button" disabled={pending || !device?.subscription}
            onClick={() => {
              const id = crypto.randomUUID();
              void run(() => editAlerts(alerts => alerts.map(item => item.id === alert.id ? { ...item, id, triggeredAt: undefined } : item), true), '已重新启用提醒');
            }}>重新启用</button>}
          <button type="button" disabled={pending} aria-label={'移除 ' + (alert.kind === 'buy' ? '买入 ' : '卖出 ') + money(alert.price) + ' 提醒'}
            onClick={() => void run(() => editAlerts(alerts => alerts.filter(item => item.id !== alert.id)), '已移除提醒')}>移除</button>
        </li>)}
      </ul> : <p className="muted">这只股票还没有价格提醒。</p>)}
      {state && !device?.subscription && <div className="alert-device">
        <p className="muted">请在 iPhone 主屏幕打开账簿并启用通知。</p>
        <button type="button" disabled={pending} onClick={() => void enable()}>{pending ? '正在启用…' : '在此设备启用通知'}</button>
      </div>}
      {device?.subscription && <button type="button" className="link-button alert-rebind" disabled={pending}
        onClick={() => void enable()}>重新绑定此设备</button>}
      {!state && loading && <p className="muted" role="status">正在读取价格提醒…</p>}
      {loadError && <p className="form-message" role="alert">{loadError}</p>}
      {!device?.subscription && error && <p className="form-message" role="alert">{error}</p>}
    </div>
    {device?.subscription && <div className="editor-footer alert-actions">
      <div className="alert-directions" role="group" aria-label="提醒方向">
        <button type="button" disabled={pending} aria-pressed={kind === 'buy'} onClick={() => setKind('buy')}>买入 ≤</button>
        <button type="button" disabled={pending} aria-pressed={kind === 'sell'} onClick={() => setKind('sell')}>卖出 ≥</button>
      </div>
      <div className="alert-entry">
        <input aria-label="提醒价格（元）" placeholder="提醒价格（元）" value={price}
          onChange={event => { setPrice(event.target.value); setMessage(''); setError(''); }}
          inputMode="decimal" required disabled={pending} />
        <button className="primary" disabled={pending || !price.trim()}>{pending ? '保存中…' : '添加提醒'}</button>
      </div>
      {error ? <p className="form-message" role="alert">{error}</p> : message && <p className="muted" role="status">{message}</p>}
    </div>}
  </form>;
}
