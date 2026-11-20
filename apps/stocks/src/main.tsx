import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ChartNoAxesCombined, ChartPie, History, RefreshCw, Settings2, Wallet } from 'lucide-react';
import { readStored, saveStored } from '@pwa-apps/shared';
import { bundledToken, downloadLedger, SyncConflict, syncGithub, type SyncDirection } from './backup.ts';
import { emptyLedger, project, registerSale, validateLedger, type Buy, type Ledger, type Stock } from './domain.ts';
import { OrderEditor } from './orders.tsx';
import { Portfolio, Settings, Statistics, StockDetail, StockEditor, Transactions, type SyncConfig } from './pages.tsx';
import { readLocal, updateLocal, type LocalState } from './store.ts';
import { BottomSheet } from './sheet.tsx';
import './style.css';

const navigation = [
  { id: 'portfolio', label: '持仓', icon: Wallet },
  { id: 'trades', label: '交易', icon: History },
  { id: 'stats', label: '统计', icon: ChartPie },
  { id: 'settings', label: '设置', icon: Settings2 },
] as const;
type Tab = typeof navigation[number]['id'];
type Screen = { name: Tab | 'add' } | { name: 'detail' | 'edit' | 'sell'; id: string };

function App() {
  const [local, setLocal] = useState<LocalState>();
  const [screen, setScreen] = useState<Screen>({ name: 'portfolio' });
  const [buySheet, setBuySheet] = useState<{ stockId: string; purchaseId?: string }>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [conflict, setConflict] = useState(false);
  const credentialKey = bundledToken ? 'stocks:cloud-passphrase' : 'stocks:token';
  const [config, setConfig] = useState<SyncConfig>(() => ({
    folder: readStored('stocks:sync-folder', ''),
    credential: readStored(credentialKey, ''),
    secret: readStored('stocks:secret', ''),
  }));
  const job = useRef(false);
  const channel = useRef<BroadcastChannel | undefined>(undefined);

  useEffect(() => {
    let live = true;
    function refresh() {
      if (job.current) return;
      void readLocal().then(value => { if (live && !job.current) setLocal(value); }).catch(error => {
        if (live) setFeedback({ text: error instanceof Error ? error.message : '无法打开本机数据库', error: true });
      });
    }
    refresh();
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('pwa-stocks');
      channel.current.onmessage = refresh;
    }
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      channel.current?.close();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const ledger = local?.ledger;
  const projection = useMemo(() => project(ledger?.orders ?? []), [ledger]);
  const stock = 'id' in screen ? ledger?.stocks.find(item => item.id === screen.id) : undefined;
  const buyStock = ledger?.stocks.find(item => item.id === buySheet?.stockId);
  const purchase = buySheet?.purchaseId
    ? ledger?.orders.find((order): order is Buy => order.kind === 'buy' && order.id === buySheet.purchaseId)
    : undefined;
  const tab = navigation.find(item => item.id === screen.name);
  const title = screen.name === 'add' ? '添加股票' : screen.name === 'edit' ? '编辑股票' :
    screen.name === 'sell' ? '卖出' :
      screen.name === 'detail' ? stock?.name : tab?.label;

  function go(next: Screen) {
    setScreen(next);
    setFeedback(undefined);
    window.scrollTo(0, 0);
  }

  async function run(operation: () => Promise<void>) {
    if (job.current) return;
    job.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await operation();
    } catch (error) {
      setConflict(error instanceof SyncConflict);
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
      const latest = await readLocal().catch(() => undefined);
      if (latest) setLocal(latest);
    } finally {
      job.current = false;
      setBusy(false);
    }
  }

  function change(update: (current: Ledger) => Ledger, message: string, afterSave?: Screen | (() => void), extra?: (current: LocalState) => LocalState) {
    if (!local) return;
    void run(async () => {
      const saved = await updateLocal(local.ledger.revision, current => ({
        ...(extra ? extra(current) : current),
        ledger: { ...update(current.ledger), revision: crypto.randomUUID() },
      }));
      setLocal(saved);
      channel.current?.postMessage('update');
      if (typeof afterSave === 'function') afterSave();
      else if (afterSave) go(afterSave);
      setFeedback({ text: message });
    });
  }

  function saveStock(value: Stock) {
    change(current => ({ ...current, stocks: stock
      ? current.stocks.map(item => item.id === value.id ? value : item)
      : [...current.stocks, value] }), '股票已保存', { name: 'detail', id: value.id });
  }

  function removeStock(target: Stock) {
    const hasOrders = ledger?.orders.some(order => order.stockId === target.id);
    if (!window.confirm('删除「' + target.name + '」？' + (hasOrders ? '其买入、卖出和收益记录也会一并删除。' : ''))) return;
    change(current => ({ ...current,
      stocks: current.stocks.filter(item => item.id !== target.id),
      orders: current.orders.filter(order => order.stockId !== target.id),
    }), '股票已删除', { name: 'portfolio' });
  }

  function openBuy(stockId: string, purchaseId?: string) {
    setFeedback(undefined);
    setBuySheet({ stockId, purchaseId });
  }

  function closeBuy() {
    setBuySheet(undefined);
    setFeedback(undefined);
  }

  function removePurchase(order: Buy) {
    if (!window.confirm('删除这笔买入订单及其全部分笔成交？')) return;
    change(current => ({ ...current, orders: current.orders.filter(item => item.id !== order.id) }), '买入已删除');
  }

  function updateConfig(next: SyncConfig) {
    if (next.folder.trim() !== config.folder.trim()) setConflict(false);
    setConfig(next);
    try {
      saveStored('stocks:sync-folder', next.folder.trim());
      saveStored('stocks:secret', next.secret);
      if (bundledToken || !next.credential) saveStored(credentialKey, next.credential);
    } catch { /* Settings remain available for this session. */ }
  }

  function synchronize(direction: SyncDirection) {
    if (!local) return;
    void run(async () => {
      const result = await syncGithub(local, config.folder, config.credential, config.secret, direction, action =>
        window.confirm(action === 'upload' ? '用本机股票账簿覆盖云端备份？' : '用云端备份覆盖本机股票账簿？')
      );
      if (result.canceled) {
        setFeedback({ text: result.message });
        return;
      }
      if (!bundledToken) {
        try { saveStored(credentialKey, config.credential.trim()); } catch { /* Sync is already complete. */ }
      }
      setLocal(result.local);
      channel.current?.postMessage('update');
      setConflict(false);
      setFeedback({ text: result.message });
    });
  }

  return <>
    <header className="topbar">
      <div className="top-inner">
        <div className="brand"><span className="brand-mark"><ChartNoAxesCombined size={22} /></span><strong>股票账簿</strong></div>
        <span className="top-caption">持仓与卖出收益</span>
      </div>
    </header>
    <main className="shell">
      <div className="page-heading">
        {!tab && <button type="button" className="back-button" aria-label="返回" disabled={busy} onClick={() =>
          go(stock && screen.name !== 'detail' ? { name: 'detail', id: stock.id } : { name: 'portfolio' })
        }><ArrowLeft size={20} /></button>}
        <div>
          <h1>{title || '股票详情'}</h1>
          {stock && screen.name !== 'detail' && <span className="muted">{stock.name} · {stock.market} {stock.code}</span>}
        </div>
        {busy && <span className="busy" role="status"><RefreshCw size={16} /> 处理中</span>}
      </div>
      {feedback && !buySheet && <div className={'feedback ' + (feedback.error ? 'error' : '')} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
      {!local || !ledger ? <div className="panel muted">{feedback?.error
        ? <button onClick={() => void run(async () => setLocal(await readLocal()))}>重新读取数据</button>
        : '正在读取本机数据…'}</div> : <>
        {screen.name === 'portfolio' && <Portfolio ledger={ledger} {...projection}
          add={() => go({ name: 'add' })} detail={id => go({ name: 'detail', id })}
          buy={openBuy} sell={id => go({ name: 'sell', id })} />}
        {screen.name === 'detail' && stock && <StockDetail ledger={ledger} stock={stock} {...projection}
          edit={() => go({ name: 'edit', id: stock.id })} buy={() => openBuy(stock.id)}
          sell={() => go({ name: 'sell', id: stock.id })} editPurchase={order => openBuy(order.stockId, order.id)} removePurchase={removePurchase} remove={() => removeStock(stock)} />}
        {(screen.name === 'add' || screen.name === 'edit' && stock) && <StockEditor key={stock?.id ?? 'new'} stock={stock} ledger={ledger} save={saveStock} busy={busy} />}
        {screen.name === 'sell' && stock && <OrderEditor key={stock.id} kind="sell"
          stock={stock} lots={projection.lots} profile={ledger.profile} busy={busy}
          save={draft => {
            const order = { ...draft, id: crypto.randomUUID(), stockId: stock.id, profile: ledger.profile };
            change(current => ({ ...current, orders: [...current.orders, registerSale(current, order)] }),
              '实际卖出已登记', { name: 'detail', id: stock.id });
          }} />}
        {buySheet && <BottomSheet title={buySheet.purchaseId ? '编辑买入' : '登记买入'} close={closeBuy} busy={busy}>
          {feedback?.error && <div className="feedback error" role="alert">{feedback.text}</div>}
          {buyStock && (!buySheet.purchaseId || purchase) ? <>
            <p className="muted">{buyStock.name} · {buyStock.market} {buyStock.code}</p>
            <OrderEditor key={purchase?.id ?? buyStock.id} kind="buy" stock={buyStock}
              lots={projection.lots} profile={purchase?.profile ?? ledger.profile} busy={busy} purchase={purchase}
              save={draft => {
                const afterSave = () => setBuySheet(undefined);
                if (purchase) {
                  change(current => ({ ...current, orders: current.orders.map(order =>
                    order.id === purchase.id ? { ...purchase, ...draft } : order
                  ) }), '买入已更新', afterSave);
                } else {
                  const order: Buy = { ...draft, kind: 'buy', id: crypto.randomUUID(), stockId: buyStock.id, profile: ledger.profile };
                  change(current => ({ ...current, orders: [...current.orders, order] }), '买入已登记', afterSave);
                }
              }} />
          </> : <p className="muted">{buyStock ? '这笔买入订单已从本机账簿移除。' : '这只股票已从本机账簿移除。'}</p>}
        </BottomSheet>}
        {'id' in screen && !stock && <div className="panel muted">这只股票已从本机账簿移除。</div>}
        {screen.name === 'trades' && <Transactions ledger={ledger} {...projection} />}
        {screen.name === 'stats' && <Statistics ledger={ledger} sales={projection.sales} />}
        {screen.name === 'settings' && <Settings local={local} busy={busy} conflict={conflict}
          config={config} setConfig={updateConfig} feedback={feedback}
          saveProfile={profile => change(current => ({ ...current, profile }), '费用配置已保存')}
          sync={synchronize} download={() => void run(async () => {
            const saved = await updateLocal(ledger.revision, current => ({ ...current, backupAt: Date.now() }));
            downloadLedger(saved.ledger);
            setLocal(saved);
            setFeedback({ text: '备份已导出' });
          })}
          restore={file => void run(async () => {
            const imported = validateLedger(JSON.parse(await file.text()));
            if (!window.confirm('用此备份覆盖本机股票、交易和费用配置？')) return;
            const saved = await updateLocal(ledger.revision, current => ({
              ...current, ledger: { ...imported, revision: crypto.randomUUID() },
            }));
            setLocal(saved);
            channel.current?.postMessage('update');
            setFeedback({ text: '本机备份已恢复' });
          })}
          clear={() => {
            if (window.confirm('清空所有本机股票、交易和费用设置？') &&
                window.confirm('再次确认清空本机数据？云端备份可单独管理。')) {
              change(emptyLedger, '本机数据已清空', undefined, () => ({ ledger: emptyLedger() }));
            }
          }} />}
      </>}
    </main>
    <nav className="nav" aria-label="主导航">
      <div>{navigation.map(item => {
        const Icon = item.icon;
        const selected = item.id === (tab?.id ?? 'portfolio');
        return <button type="button" key={item.id} className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined} disabled={busy}
          onClick={() => go({ name: item.id })}><Icon size={21} /><span>{item.label}</span></button>;
      })}</div>
    </nav>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
