import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cents, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import { alertAccount, enrollAlertDevice, updateAlertAccount, type PriceAlert } from './alerts.ts';
import type { AlertCloud } from './alert-cloud.ts';
import { AlertPriceForm, type AlertPriceContext } from './alert-price-form.tsx';

type StockAlertTarget = { symbol: string; name: string };
type AlertDraft = { target: StockAlertTarget; kind: OrderKind; original?: PriceAlert };
type Props = {
  cloud: AlertCloud;
  stock?: StockAlertTarget;
  close?: () => void;
  context?: AlertPriceContext;
};

const deviceKey = 'stocks:alert-device';
const bindingKey = 'stocks:alert-account';
const installGuide = '在 iPhone 上，请先用 Safari 将股票账簿添加到主屏幕，再从主屏幕打开。';
const permissionGuide = '通知权限已关闭，请在系统或浏览器设置中允许通知，然后返回重新启用。';
const notificationRequired = new Error('此账号没有启用通知的设备。');

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
  const [draft, setDraft] = useState<AlertDraft>();
  const formDialog = useRef<HTMLDialogElement>(null);
  const [price, setPrice] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState('');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();

  useEffect(() => {
    if (draft && !formDialog.current?.open) formDialog.current?.showModal();
  }, [draft]);

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

  useEffect(() => {
    const refresh = () => { void cloud.refresh(true); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [cloud]);

  const pending = working || saving;
  const account = state && alertAccount(state, cloud.account);
  const legacy = state?.devices[deviceId];
  const device = account?.devices[deviceId];
  const { endpoint, denied } = notification ?? {};
  const enabled = Boolean(endpoint && device?.endpoint === endpoint);
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

  function editAlerts(edit: (alerts: PriceAlert[]) => PriceAlert[], checkNotification = false) {
    return cloud.update(current => updateAlertAccount(current, cloud.account, latest => {
      if (checkNotification && !Object.keys(latest.devices).length) throw notificationRequired;
      return { ...latest, alerts: edit(latest.alerts) };
    }));
  }

  function migrateLegacy() {
    void run(() => cloud.update(current => enrollAlertDevice(current, cloud.account, deviceId,
      legacy?.subscription?.endpoint === endpoint ? legacy?.subscription : undefined)), '已合并此设备的旧提醒');
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
        return enrollAlertDevice(current, cloud.account, id, pushDevice);
      }, localStorage.getItem(bindingKey) ?? undefined);
      localStorage.setItem(bindingKey, cloud.account);
      setNotification({ endpoint: subscription.endpoint, denied: false });
      setConfirmSave(false);
    }, '已在此设备启用通知');
  }

  async function saveReminder({ target, kind, original }: AlertDraft, confirmed = false) {
    const saved = await run(async () => {
      const value = cents(price);
      if (original?.price === value) return;
      const alert: PriceAlert = { ...target, kind, price: value, id: crypto.randomUUID() };
      try {
        await editAlerts(alerts => {
          if (!original) return [...alerts, alert];
          if (!alerts.some(item => item.id === original.id)) throw Error('此提醒已在其他设备更新或移除，请返回列表后重试。');
          // A new ID keeps delivery receipts for the old threshold from affecting this rule.
          return alerts.map(item => item.id === original.id ? alert : item);
        }, !confirmed);
      } catch (reason) {
        if (reason === notificationRequired) setConfirmSave(true);
        throw reason;
      }
    }, confirmed ? '已保存价格提醒，可稍后启用通知' : '已保存价格提醒');
    if (saved) formDialog.current?.close();
  }

  function openForm(target: StockAlertTarget, direction: OrderKind, original?: PriceAlert) {
    setConfirmSave(false);
    setPrice(original ? (original.price / 100).toFixed(2) : '');
    setError('');
    setMessage('');
    setDraft({ target: { name: target.name, symbol: target.symbol }, kind: direction, original });
  }

  const alerts = (account?.alerts ?? []).filter(alert => !stock || alert.symbol === stock.symbol);
  const content = <>
    {stock && <p className="muted">{stock.name} · {stock.symbol.slice(2)}</p>}
    {!stock && <div className="alert-device">
      {account && <p className="muted">{cloud.account} · {Object.keys(account.devices).length} 台设备已启用通知</p>}
      <strong>{enabled ? '此设备已启用通知' : '此设备尚未启用通知'}</strong>
      {!enabled && <p className="muted">{denied ? permissionGuide : !supported ? installGuide : '启用后，此设备会收到同名账号的价格提醒。'}</p>}
      {state && supported && !denied && <button type="button" className={enabled ? 'link-button alert-rebind' : ''}
        disabled={pending} onClick={() => void enable()}>{enabled ? '重新绑定此设备' : '在此设备启用通知'}</button>}
    </div>}
    {legacy && <div className="alert-device">
      <p className="muted">此设备有旧版提醒或通知绑定，可合并到 {cloud.account}。</p>
      <button type="button" disabled={pending} onClick={migrateLegacy}>合并旧提醒</button>
    </div>}
    {state && (alerts.length ? <ul className="alert-list">
      {alerts.map(alert => <li key={alert.id}>
        <div>
          {!stock && <strong className="alert-stock-name">{alert.name} · {alert.symbol.slice(2)}</strong>}
          <strong>{alert.kind === 'buy' ? '买入 ≤ ' : '卖出 ≥ '}{money(alert.price)}</strong>
          <span className="muted">{alert.triggeredAt ? '已触发' : '待触发'}</span>
        </div>
        <button type="button" disabled={pending} aria-label={'编辑 ' + alert.name + ' ' + money(alert.price) + ' 提醒'}
          onClick={() => openForm(alert, alert.kind, alert)}>编辑</button>
        {alert.triggeredAt && <button type="button" disabled={pending}
          onClick={() => {
            const id = crypto.randomUUID();
            void run(() => editAlerts(items => items.map(item => item.id === alert.id ?
              { ...item, id, triggeredAt: undefined, notifiedDevices: undefined } : item)), '已重新启用提醒');
          }}>重新启用</button>}
        <button type="button" disabled={pending} aria-label={'移除 ' + alert.name + ' ' + money(alert.price) + ' 提醒'}
          onClick={() => void run(() => editAlerts(items => items.filter(item => item.id !== alert.id)), '已移除提醒')}>移除</button>
      </li>)}
    </ul> : <p className="muted">{stock ? '这只股票还没有价格提醒。' : '还没有设置价格提醒。'}</p>)}
    {!state && loading && <p className="muted" role="status">正在读取价格提醒…</p>}
    {loadError && <p className="form-message" role="alert">{loadError}</p>}
  </>;
  const feedback = error ? <p className="form-message" role="alert">{error}</p>
    : message && <p className="muted" role="status">{message}</p>;

  const enableButton = state && notification && !enabled && <button type="button" className="alert-enable" disabled={pending}
    onClick={() => void enable()}>启用通知</button>;

  return <>
    {stock ? <div className="editor-layout">
      <div className="section-title editor-heading">
        <h2 id="watch-editor-title">价格提醒</h2>
        <button type="button" onClick={close}>关闭</button>
      </div>
      <div className="editor-content">{content}{!draft && feedback}</div>
      {state && <div className="editor-footer alert-list-actions alert-list-footer">
        <button type="button" className="tinted" disabled={pending} onClick={() => openForm(stock, 'buy')}>买入提醒</button>
        <button type="button" disabled={pending} onClick={() => openForm(stock, 'sell')}>卖出提醒</button>
        {enableButton}
      </div>}
    </div> : <section className="panel alert-settings"><h2>价格提醒</h2>{content}{!draft && feedback}</section>}
    <dialog ref={formDialog} className="sync-dialog entry-sheet alert-price-sheet" aria-labelledby="alert-price-title"
      onClose={event => { event.stopPropagation(); setDraft(undefined); setConfirmSave(false); setError(''); }}
      onCancel={event => { event.stopPropagation(); if (pending) event.preventDefault(); }}>
      {draft && <form onSubmit={event => { event.preventDefault(); if (state && !pending && !confirmSave) void saveReminder(draft); }}>
        <div className="section-title editor-heading">
          <h2 id="alert-price-title">{draft.original ? '编辑' : ''}{draft.kind === 'buy' ? '买入提醒' : '卖出提醒'}</h2>
          <button type="button" disabled={pending} onClick={() => formDialog.current?.close()}>返回</button>
        </div>
        <div className="editor-content">
          <p className="muted">{draft.target.name} · {draft.target.symbol.slice(2)}</p>
          <AlertPriceForm kind={draft.kind} price={price} setPrice={value => { setPrice(value); setConfirmSave(false); setError(''); setMessage(''); }} context={context} />
          {(!confirmSave || error !== notificationRequired.message) && feedback}
        </div>
        <div className="editor-footer alert-form-footer">
          {confirmSave && <p className="muted" role="status">此账号还没有可接收通知的设备。可以先保存规则，稍后启用通知。</p>}
          <div className="alert-list-actions">
            {enableButton}
            {confirmSave ? <button type="button" className="primary" disabled={pending}
              onClick={() => void saveReminder(draft, true)}>{saving ? '保存中…' : '仍然保存'}</button>
              : <button className="primary" disabled={!state || pending || !price.trim()}>{saving ? '保存中…' : '保存提醒'}</button>}
          </div>
        </div>
      </form>}
    </dialog>
  </>;
}
