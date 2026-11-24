import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartNoAxesCombined, CircleCheck, History, RefreshCw, Settings2, TrendingUp } from 'lucide-react';
import { readStored, saveStored } from '@pwa-apps/shared';
import { bundledToken, downloadLedger, loadArchiveYears, SyncConflict, syncGithub, type SyncDirection } from './backup.ts';
import { deleteTrade, emptyLedger, finishCycle, recordPrice, validateLedger, type Ledger, type OrderKind, type Stock, type TradePrice } from './domain.ts';
import { Settings, type SyncConfig } from './pages.tsx';
import { useQuotes } from './quotes.ts';
import { Cycles, Transactions } from './transactions.tsx';
import { Watchlist } from './watchlist.tsx';
import { readLocal, updateLocal, type LocalState } from './store.ts';
import './style.css';

const tabLabels = { holdings: '持仓', trades: '交易', closed: '收益', settings: '设置' } as const;
type Tab = keyof typeof tabLabels;
const tabIcons = { holdings: TrendingUp, trades: History, closed: CircleCheck, settings: Settings2 };

function App() {
  const [local, setLocal] = useState<LocalState>();
  const [tab, setTab] = useState<Tab>('holdings');
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
  const market = useQuotes(ledger?.stocks ?? [], tab !== 'settings');

  function navigate(next: Tab) {
    setTab(next);
    setFeedback(undefined);
    window.scrollTo(0, 0);
  }

  async function run(operation: () => Promise<void>) {
    if (job.current) return false;
    job.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await operation();
      return true;
    } catch (error) {
      setConflict(error instanceof SyncConflict);
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
      const latest = await readLocal().catch(() => undefined);
      if (latest) setLocal(latest);
      return false;
    } finally {
      job.current = false;
      setBusy(false);
    }
  }

  async function change(update: (current: Ledger) => Ledger, message: string, extra?: (current: LocalState) => LocalState) {
    if (!local) return false;
    return run(async () => {
      const saved = await updateLocal(local.ledger.revision, current => ({
        ...(extra ? extra(current) : current),
        ledger: { ...update(current.ledger), revision: crypto.randomUUID() },
      }));
      setLocal(saved);
      channel.current?.postMessage('update');
      setFeedback({ text: message });
    });
  }

  function saveStock(stock: Stock) {
    return change(current => ({ ...current, stocks: [...current.stocks, stock] }), '股票已添加');
  }

  function savePrice(stock: Stock, kind: OrderKind, price: number, quantity: number) {
    const entry = { price, quantity, time: new Date().toISOString() };
    return change(current => {
      if (!current.stocks.some(item => item.id === stock.id)) throw Error('这只股票已移除');
      return {
        ...current,
        stocks: current.stocks.map(item => item.id === stock.id ? recordPrice(item, current.orders, kind, entry) : item),
      };
    }, kind === 'buy' ? '买价已记录' : '卖价已记录');
  }

  function removeTrade(stockId: string, index: number, entry: TradePrice) {
    if (!window.confirm('删除这笔' + (entry.kind === 'buy' ? '买入' : '卖出') + '记录？持仓和周期收益会重新计算。')) {
      return Promise.resolve(false);
    }
    return change(current => {
      if (!current.stocks.some(stock => stock.id === stockId)) throw Error('这只股票已移除');
      return { ...current, stocks: current.stocks.map(stock =>
        stock.id === stockId ? deleteTrade(stock, current.orders, index, entry) : stock) };
    }, '交易记录已删除');
  }

  function endCycle(target: Stock) {
    if (!window.confirm('结束「' + target.name + '」的本次做 T 周期？交易流水会保留，下一笔开始新周期。')) {
      return Promise.resolve(false);
    }
    const endedAt = new Date().toISOString();
    return change(current => ({
      ...current,
      stocks: current.stocks.map(stock => stock.id === target.id ? finishCycle(stock, current.orders, endedAt) : stock),
    }), '本次做 T 周期已结束');
  }

  function removeStock(target: Stock) {
    if (!window.confirm('删除「' + target.name + '」？持仓卡片、最近买卖价、交易记录和周期汇总都会删除。')) {
      return Promise.resolve(false);
    }
    return change(current => ({
      ...current,
      stocks: current.stocks.filter(stock => stock.id !== target.id),
      orders: current.orders.filter(order => order.stockId !== target.id),
    }), '股票已删除');
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

  function loadYears(years: string[]) {
    if (!local) return;
    void run(async () => {
      const next = await loadArchiveYears(local, years, config.credential, config.secret);
      setLocal(next);
      channel.current?.postMessage('update');
    });
  }

  return <>
    <header className="topbar">
      <div className="top-inner">
        <div className="brand"><span className="brand-mark"><ChartNoAxesCombined size={22} /></span><strong>股票账簿</strong></div>
      </div>
    </header>
    <main className="shell">
      {(tab !== 'holdings' || !ledger) && <div className="page-heading">
        <h1>{tabLabels[tab]}</h1>
        {busy && <span className="busy" role="status"><RefreshCw size={16} /> 处理中</span>}
      </div>}
      {feedback && <div className={'feedback ' + (feedback.error ? 'error' : '')} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
      {!local || !ledger ? <div className="panel muted">{feedback?.error
        ? <button onClick={() => void run(async () => setLocal(await readLocal()))}>重新读取数据</button>
        : '正在读取本机数据…'}</div> : <>
        {tab === 'holdings' && <Watchlist ledger={ledger} busy={busy} add={saveStock} record={savePrice} endCycle={endCycle} removeTrade={removeTrade} remove={removeStock} market={market} />}
        {tab === 'trades' && <Transactions ledger={ledger} quotes={market.quotes} busy={busy} removeTrade={removeTrade}
          missingYears={local.archive?.missing} loadYears={loadYears} />}
        {tab === 'closed' && <Cycles ledger={ledger} quotes={market.quotes} busy={busy} missingYears={local.archive?.missing} loadYears={loadYears} />}
        {tab === 'settings' && <Settings local={local} busy={busy} conflict={conflict}
          config={config} setConfig={updateConfig} feedback={feedback}
          saveRules={rules => void change(current => ({ ...current, observationRules: rules }), '观察规则已保存')}
          sync={synchronize} download={() => void run(async () => {
            if (local.archive?.missing.length) {
              const complete = await loadArchiveYears(local, local.archive.missing, config.credential, config.secret);
              setLocal(complete);
              channel.current?.postMessage('update');
            }
            const saved = await updateLocal(ledger.revision, current => ({ ...current, backupAt: Date.now() }));
            downloadLedger(saved.ledger);
            setLocal(saved);
            setFeedback({ text: '备份已导出' });
          })}
          restore={file => void run(async () => {
            const imported = validateLedger(JSON.parse(await file.text()));
            if (!window.confirm('用此备份覆盖本机股票和记录？')) return;
            const saved = await updateLocal(ledger.revision, current => ({
              ...current, archive: undefined, ledger: { ...imported, revision: crypto.randomUUID() },
            }));
            setLocal(saved);
            channel.current?.postMessage('update');
            setFeedback({ text: '本机备份已恢复' });
          })}
          clear={() => {
            if (window.confirm('清空所有本机股票和记录？') &&
                window.confirm('再次确认清空本机数据？云端备份可单独管理。')) {
              void change(emptyLedger, '本机数据已清空', () => ({ ledger: emptyLedger() }));
            }
          }} />}
      </>}
    </main>
    <nav className="bottom-nav" aria-label="主菜单">
      <div>
        {(Object.keys(tabLabels) as Tab[]).map(item => {
          const Icon = tabIcons[item];
          return <button key={item} type="button" disabled={busy} aria-current={tab === item ? 'page' : undefined}
            onClick={() => navigate(item)}><Icon size={19} />{tabLabels[item]}</button>;
        })}
      </div>
    </nav>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
