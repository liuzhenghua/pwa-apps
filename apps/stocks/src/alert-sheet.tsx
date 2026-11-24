import { useEffect, useState } from 'react';
import { cents, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import { openAlerts, requireAlerts, updateDevice, type AlertState, type DeviceAlerts, type PriceAlert } from './alerts.ts';
import { bundledToken, missingTokenBoxMessage } from './backup.ts';

type Props = {
  credential: string;
  symbol: string;
  name: string;
  close: () => void;
};

const deviceKey = 'stocks:alert-device';

export function AlertSheet({ credential, symbol, name, close }: Props) {
  const [state, setState] = useState<AlertState>();
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem(deviceKey) ?? crypto.randomUUID());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<OrderKind>();
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

  useEffect(() => {
    let mounted = true;
    if (!bundledToken || !credential.trim()) {
      setError(!bundledToken ? missingTokenBoxMessage : '请先在同步配置中填写云端访问口令。');
      return;
    }
    setWorking(true);
    void openAlerts(credential).then(remote => remote.read()).then(({ data }) => {
      if (mounted) setState(requireAlerts(data));
    }).catch((reason: Error) => {
      if (mounted) setError(reason.message);
    }).finally(() => {
      if (mounted) setWorking(false);
    });
    return () => { mounted = false; };
  }, [credential]);

  async function run(action: () => Promise<AlertState>, success: string) {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      setState(await action());
      setMessage(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试');
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function change(action: (current: AlertState) => AlertState) {
    return (await openAlerts(credential)).update(current => action(requireAlerts(current)));
  }

  function editAlerts(edit: (alerts: PriceAlert[]) => PriceAlert[], needsSubscription = false) {
    return change(current => updateDevice(current, deviceId, device => {
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
      return change(current => {
        if (current.publicKey !== publicKey) throw Error('推送配置已更新，请关闭弹窗后重试');
        return updateDevice(current, id, device => ({ ...device, subscription: pushDevice }));
      });
    }, '已将此设备设为通知接收设备');
  }

  async function add() {
    if (!kind) return;
    await run(async () => {
      const alert: PriceAlert = { id: crypto.randomUUID(), symbol, name, kind, price: cents(price) };
      return editAlerts(alerts => [...alerts, alert], true);
    }, '已保存价格提醒').then(saved => {
      if (saved) {
        setPrice('');
        setKind(undefined);
      }
    });
  }

  const device: DeviceAlerts | undefined = state?.devices[deviceId];
  const alerts = state && (device?.alerts ?? []).filter(alert => alert.symbol === symbol);
  return <form onSubmit={event => { event.preventDefault(); if (!working) void add(); }}>
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
          {alert.triggeredAt && <button type="button" disabled={working}
            onClick={() => {
              const id = crypto.randomUUID();
              void run(() => editAlerts(alerts => alerts.map(item => item.id === alert.id ? { ...item, id, triggeredAt: undefined } : item), true), '已重新启用提醒');
            }}>重新启用</button>}
          <button type="button" disabled={working} aria-label={'移除 ' + (alert.kind === 'buy' ? '买入 ' : '卖出 ') + money(alert.price) + ' 提醒'}
            onClick={() => void run(() => editAlerts(alerts => alerts.filter(item => item.id !== alert.id)), '已移除提醒')}>移除</button>
        </li>)}
      </ul> : <p className="muted">这只股票还没有价格提醒。</p>)}
      {state && <div className="alert-device">
        <p className="muted">{device?.subscription ? '此设备已启用通知。此处添加的提醒会发到此设备。' : '请在 iPhone 主屏幕打开账簿并启用通知。'}</p>
        <button type="button" disabled={working} onClick={() => void enable()}>{device?.subscription ? '重新绑定此设备' : '在此设备启用通知'}</button>
      </div>}
      {kind && <label className="watch-input">{kind === 'buy' ? '买入' : '卖出'}提醒价格（元）
        <input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal" required disabled={working} />
      </label>}
      {working && <p className="muted" role="status">正在处理…</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {message && <p className="muted" role="status">{message}</p>}
    </div>
    {device?.subscription && <div className="editor-footer alert-actions">
      {kind ? <>
        <button type="button" disabled={working} onClick={() => { setKind(undefined); setPrice(''); }}>返回</button>
        <button className="primary" disabled={working}>保存{kind === 'buy' ? '买入' : '卖出'}订阅</button>
      </> : <>
        <button type="button" disabled={working} onClick={() => setKind('buy')}>买入订阅</button>
        <button type="button" disabled={working} onClick={() => setKind('sell')}>卖出订阅</button>
      </>}
    </div>}
  </form>;
}
