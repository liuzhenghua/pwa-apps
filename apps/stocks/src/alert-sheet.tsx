import { useEffect, useState } from 'react';
import { cents, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import { openAlerts, requireAlerts, type AlertState, type PriceAlert } from './alerts.ts';
import { bundledToken, missingTokenBoxMessage } from './backup.ts';
import type { SyncConfig } from './pages.tsx';

type Props = {
  config: SyncConfig;
  symbol: string;
  name: string;
  close: () => void;
};

export function AlertSheet({ config, symbol, name, close }: Props) {
  const [state, setState] = useState<AlertState>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<OrderKind>();
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();

  useEffect(() => {
    let mounted = true;
    if (!bundledToken) {
      setError(missingTokenBoxMessage);
      return;
    }
    void navigator.serviceWorker?.ready.then(worker => {
      if (mounted) setRegistration(worker);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!config.folder || !config.credential || !config.secret) {
      setError('请先在设置中完成 GitHub 同步配置。');
      return;
    }
    setWorking(true);
    void openAlerts(config).then(remote => remote.read()).then(({ data }) => {
      if (mounted) setState(requireAlerts(data));
    }).catch((reason: Error) => {
      if (mounted) setError(reason.message);
    }).finally(() => {
      if (mounted) setWorking(false);
    });
    return () => { mounted = false; };
  }, [config]);

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
    return (await openAlerts(config)).update(current => action(requireAlerts(current)));
  }

  async function enable() {
    if (!state) return;
    const { publicKey } = state;
    await run(async () => {
      if (!('Notification' in window) || !('PushManager' in window) || !navigator.serviceWorker) {
        throw Error('请从 iPhone 主屏幕打开已安装的股票账簿，再启用通知');
      }
      if (!registration?.active) throw Error('推送服务正在安装，请重新打开已部署的账簿后重试');
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
      const device = { endpoint: subscription.endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } };
      return change(current => {
        if (current.publicKey !== publicKey) throw Error('推送配置已更新，请关闭弹窗后重试');
        return { ...current, device };
      });
    }, '已将此设备设为通知接收设备');
  }

  async function add() {
    if (!kind) return;
    await run(async () => {
      const alert: PriceAlert = { id: crypto.randomUUID(), symbol, name, kind, price: cents(price) };
      return change(current => ({ ...current, alerts: [...current.alerts, alert] }));
    }, '已保存价格提醒').then(saved => {
      if (saved) {
        setPrice('');
        setKind(undefined);
      }
    });
  }

  const alerts = state?.alerts.filter(alert => alert.symbol === symbol);
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
              void run(() => change(current => ({
                ...current, alerts: current.alerts.map(item => item.id === alert.id ? { ...item, id, triggeredAt: undefined } : item),
              })), '已重新启用提醒');
            }}>重新启用</button>}
          <button type="button" disabled={working} aria-label={'移除 ' + (alert.kind === 'buy' ? '买入 ' : '卖出 ') + money(alert.price) + ' 提醒'}
            onClick={() => void run(() => change(current => ({
              ...current, alerts: current.alerts.filter(item => item.id !== alert.id),
            })), '已移除提醒')}>移除</button>
        </li>)}
      </ul> : <p className="muted">这只股票还没有价格提醒。</p>)}
      {state && <div className="alert-device">
        <p className="muted">{state.device ? '已绑定通知设备。启用此设备会替换接收设备。' : '请在 iPhone 主屏幕打开账簿并启用通知。'}</p>
        <button type="button" disabled={working} onClick={() => void enable()}>在此设备启用通知</button>
      </div>}
      {kind && <label className="watch-input">{kind === 'buy' ? '买入' : '卖出'}提醒价格（元）
        <input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal" required disabled={working} />
      </label>}
      {working && <p className="muted" role="status">正在处理…</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {message && <p className="muted" role="status">{message}</p>}
    </div>
    {state && <div className="editor-footer alert-actions">
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
