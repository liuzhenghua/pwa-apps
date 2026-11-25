import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cents, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import { updateDevice, type PriceAlert } from './alerts.ts';
import type { AlertCloud } from './alert-cloud.ts';
import { AlertPriceForm, type AlertPriceContext } from './alert-price-form.tsx';

type StockAlertTarget = { symbol: string; name: string };
type Props = {
  cloud: AlertCloud;
  stock?: StockAlertTarget;
  close?: () => void;
  context?: AlertPriceContext;
};

const deviceKey = 'stocks:alert-device';
const installGuide = '在 iPhone 上，请先用 Safari 将股票账簿添加到主屏幕，再从主屏幕打开。';
const permissionGuide = '通知权限已关闭，请在系统或浏览器设置中允许通知，然后返回重新启用。';
const notificationRequired = new Error('此设备尚未启用通知。');

function saveDeviceId() {
  const existing = localStorage.getItem(deviceKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(deviceKey, id);
  return id;
}

function supportsPush() {
  return 'Notification' in window && 'PushManager' in window && Boolean(navigator.serviceWorker);
}

async function localEndpoint() {
  if (!supportsPush() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint;
}

export function AlertManager({ cloud, stock, close, context }: Props) {
  const { state, error: loadError, loading, saving } = useSyncExternalStore(cloud.subscribe, cloud.snapshot);
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem(deviceKey) ?? '');
  const [notification, setNotification] = useState<{ endpoint?: string; denied: boolean }>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<OrderKind>();
  const formDialog = useRef<HTMLDialogElement>(null);
  const [price, setPrice] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState('');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();

  useEffect(() => {
    if (kind && !formDialog.current?.open) formDialog.current?.showModal();
  }, [kind]);

  useEffect(() => {
    let mounted = true;
    void navigator.serviceWorker?.ready.then(worker => {
      if (mounted) setRegistration(worker);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void localEndpoint().catch(() => undefined).then(value => {
        if (request === current) setNotification({ endpoint: value, denied: supportsPush() && Notification.permission === 'denied' });
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [registration, state]);

  useEffect(() => { void cloud.refresh(); }, [cloud]);

  const pending = working || saving;
  const device = state?.devices[deviceId];
  const { endpoint, denied } = notification ?? {};
  const enabled = Boolean(endpoint && device?.subscription?.endpoint === endpoint);
  const supported = supportsPush();

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

  async function editAlerts(edit: (alerts: PriceAlert[]) => PriceAlert[], checkNotification = false) {
    const currentEndpoint = checkNotification ? await localEndpoint() : undefined;
    if (checkNotification && !currentEndpoint) {
      setNotification({ denied: supportsPush() && Notification.permission === 'denied' });
      throw notificationRequired;
    }
    const id = saveDeviceId();
    setDeviceId(id);
    try {
      await cloud.update(current => updateDevice(current, id, latest => {
        if (checkNotification && latest.subscription?.endpoint !== currentEndpoint) throw notificationRequired;
        return { ...latest, alerts: edit(latest.alerts) };
      }));
    } catch (reason) {
      if (reason === notificationRequired) setNotification({ denied: false });
      throw reason;
    }
  }

  async function enable() {
    if (!state) return;
    const { publicKey } = state;
    await run(async () => {
      if (!supported) throw Error(installGuide);
      if (denied) throw Error(permissionGuide);
      if (!registration?.active) throw Error('推送服务尚未就绪，请打开已部署的账簿后重试。');
      const id = saveDeviceId();
      setDeviceId(id);
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      let subscription: PushSubscription;
      try {
        // Safari must receive the subscription request directly from the tap handler.
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch (reason) {
        if (Notification.permission === 'denied') {
          setNotification({ denied: true });
          throw Error(permissionGuide);
        }
        throw reason;
      }
      const { keys } = subscription.toJSON();
      if (!keys?.auth || !keys.p256dh) throw Error('无法读取本机推送订阅');
      const pushDevice = { endpoint: subscription.endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } };
      await cloud.update(current => {
        if (current.publicKey !== publicKey) throw Error('推送配置已更新，请刷新后重试');
        return updateDevice(current, id, latest => ({ ...latest, subscription: pushDevice }));
      });
      setNotification({ endpoint: subscription.endpoint, denied: false });
      setConfirmSave(false);
    }, '已在此设备启用通知');
  }

  async function add(target: StockAlertTarget, direction: OrderKind, confirmed = false) {
    const saved = await run(async () => {
      const alert: PriceAlert = { ...target, id: crypto.randomUUID(), kind: direction, price: cents(price) };
      try {
        await editAlerts(alerts => [...alerts, alert], !confirmed);
      } catch (reason) {
        if (reason === notificationRequired) setConfirmSave(true);
        throw reason;
      }
    }, confirmed ? '已保存价格提醒，可稍后启用通知' : '已保存价格提醒');
    if (saved) formDialog.current?.close();
  }

  function openForm(direction: OrderKind) {
    setConfirmSave(false);
    setPrice('');
    setError('');
    setMessage('');
    setKind(direction);
  }

  const alerts = stock
    ? (device?.alerts ?? []).filter(alert => alert.symbol === stock.symbol).map(alert => ({ alert, owner: deviceId }))
    : Object.entries(state?.devices ?? {}).flatMap(([owner, { alerts: items }]) => items.map(alert => ({ alert, owner })));
  const content = <>
    {stock && <p className="muted">{stock.name} · {stock.symbol.slice(2)}</p>}
    {!stock && <div className="alert-device">
      <strong>{enabled ? '此设备已启用通知' : '此设备尚未启用通知'}</strong>
      {!enabled && <p className="muted">{denied ? permissionGuide : !supported ? installGuide : '启用后，此设备可以接收为它设置的价格提醒。'}</p>}
      {state && supported && !denied && <button type="button" className={enabled ? 'link-button alert-rebind' : ''}
        disabled={pending} onClick={() => void enable()}>{enabled ? '重新绑定此设备' : '在此设备启用通知'}</button>}
    </div>}
    {state && (alerts.length ? <ul className="alert-list">
      {alerts.map(({ alert, owner }) => <li key={owner + ':' + alert.id}>
        <div>
          {!stock && <strong className="alert-stock-name">{alert.name} · {alert.symbol.slice(2)}</strong>}
          <strong>{alert.kind === 'buy' ? '买入 ≤ ' : '卖出 ≥ '}{money(alert.price)}</strong>
          <span className="muted">{alert.triggeredAt ? '已触发' : '待触发'}{!stock && (owner === deviceId ? ' · 此设备' : ' · 其他设备')}</span>
        </div>
        {owner === deviceId && alert.triggeredAt && <button type="button" disabled={pending}
          onClick={() => {
            const id = crypto.randomUUID();
            void run(() => editAlerts(items => items.map(item => item.id === alert.id ? { ...item, id, triggeredAt: undefined } : item), true), '已重新启用提醒');
          }}>重新启用</button>}
        {owner === deviceId && <button type="button" disabled={pending} aria-label={'移除 ' + alert.name + ' ' + money(alert.price) + ' 提醒'}
          onClick={() => void run(() => editAlerts(items => items.filter(item => item.id !== alert.id)), '已移除提醒')}>移除</button>}
      </li>)}
    </ul> : <p className="muted">{stock ? '这只股票还没有价格提醒。' : '还没有设置价格提醒。'}</p>)}
    {!state && loading && <p className="muted" role="status">正在读取价格提醒…</p>}
    {loadError && <p className="form-message" role="alert">{loadError}</p>}
  </>;
  const feedback = error ? <p className="form-message" role="alert">{error}</p>
    : message && <p className="muted" role="status">{message}</p>;

  if (!stock) return <section className="panel alert-settings"><h2>价格提醒</h2>{content}{feedback}</section>;

  const enableButton = state && notification && !enabled && <button type="button" className="alert-enable" disabled={pending}
    onClick={() => void enable()}>启用通知</button>;

  return <>
    <div className="editor-layout">
      <div className="section-title editor-heading">
        <h2 id="watch-editor-title">价格提醒</h2>
        <button type="button" onClick={close}>关闭</button>
      </div>
      <div className="editor-content">{content}{!kind && feedback}</div>
      {state && <div className="editor-footer alert-list-actions alert-list-footer">
        <button type="button" className="tinted" disabled={pending} onClick={() => openForm('buy')}>买入</button>
        <button type="button" disabled={pending} onClick={() => openForm('sell')}>卖出</button>
        {enableButton}
      </div>}
    </div>
    <dialog ref={formDialog} className="sync-dialog entry-sheet alert-price-sheet" aria-labelledby="alert-price-title"
      onClose={event => { event.stopPropagation(); setKind(undefined); setConfirmSave(false); setError(''); }}
      onCancel={event => { event.stopPropagation(); if (pending) event.preventDefault(); }}>
      {kind && <form onSubmit={event => { event.preventDefault(); if (state && !pending && !confirmSave) void add(stock, kind); }}>
        <div className="section-title editor-heading">
          <h2 id="alert-price-title">{kind === 'buy' ? '买入提醒' : '卖出提醒'}</h2>
          <button type="button" disabled={pending} onClick={() => formDialog.current?.close()}>返回</button>
        </div>
        <div className="editor-content">
          <p className="muted">{stock.name} · {stock.symbol.slice(2)}</p>
          <AlertPriceForm kind={kind} price={price} setPrice={value => { setPrice(value); setConfirmSave(false); setError(''); setMessage(''); }} context={context} />
          {(!confirmSave || error !== notificationRequired.message) && feedback}
        </div>
        <div className="editor-footer alert-form-footer">
          {confirmSave && <p className="muted" role="status">此设备尚未启用通知。可以先保存规则，稍后启用通知。</p>}
          <div className="alert-list-actions">
            {enableButton}
            {confirmSave ? <button type="button" className="primary" disabled={pending}
              onClick={() => void add(stock, kind, true)}>{saving ? '保存中…' : '仍然保存'}</button>
              : <button className="primary" disabled={!state || pending || !price.trim()}>{saving ? '保存中…' : '保存提醒'}</button>}
          </div>
        </div>
      </form>}
    </dialog>
  </>;
}
