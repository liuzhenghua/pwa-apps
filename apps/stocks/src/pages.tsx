import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Calculator, ChevronRight, Cloud, Download, Plus, Upload } from 'lucide-react';
import {
  amountOf, average, cents, feeFields, feeTotal, holding, percent, remainingCost, sum, validateProfile,
  type Buy, type Ledger, type Lot, type Profile, type Sale, type Stock,
} from './domain.ts';
import { bundledToken, repository, type SyncDirection } from './backup.ts';
import { count, dateLabel, localDate, money, priceInput, rateLabel, tone } from './format.ts';
import { feeLabels, FeesList, SaleMatches } from './orders.tsx';
import { BottomSheet } from './sheet.tsx';
import type { LocalState } from './store.ts';

export function Metric({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div><dt>{label}</dt><dd className={className}>{children}</dd></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="panel empty"><div className="empty-symbol"><Calculator size={25} /></div><h2>{title}</h2>{children}</div>;
}

type Projection = { lots: Lot[]; sales: Map<string, Sale> };

export function Portfolio({ ledger, lots, sales, add, detail, buy, sell }: Projection & {
  ledger: Ledger; add: () => void; detail: (id: string) => void; buy: (id: string) => void; sell: (id: string) => void;
}) {
  const holdings = ledger.stocks.map(stock => ({ stock, ...holding(stock, lots) }));
  const marketValue = sum(holdings.map(item => item.marketValue));
  const cost = sum(holdings.map(item => item.cost));
  const net = sum([...sales.values()].map(sale => sale.net));
  return <>
    <section className="overview">
      <div className="overview-main"><div>持仓总市值</div><strong>{money(marketValue)}</strong></div>
      <dl className="overview-metrics">
        <Metric label="持仓成本">{money(cost)}</Metric>
        <Metric label="浮动盈亏" className={tone(marketValue - cost)}>{money(marketValue - cost, true)}</Metric>
        <Metric label="已实现净收益" className={tone(net)}>{money(net, true)}</Metric>
      </dl>
    </section>
    <div className="section-title list-heading"><div><h2>我的持仓</h2><span className="muted">{ledger.stocks.length} 只股票</span></div><button className="primary" onClick={add}><Plus size={17} />添加股票</button></div>
    {!holdings.length && <Empty title="还没有股票"><p>添加股票并记录买入，即可按批次测算卖出收益。</p></Empty>}
    <div className="stock-grid">
      {holdings.map(({ stock, active, quantity, cost: basis, float }) =>
        <article className="panel stock-card" key={stock.id}>
          <div className="stock-head">
            <div><h3>{stock.name}</h3><p className="muted">{stock.market} · {stock.code}</p></div>
            <div className="quote"><strong>{money(stock.price)}</strong><span>手动报价</span></div>
          </div>
          <dl className="stock-metrics">
            <Metric label="持仓股数">{count(quantity)}</Metric>
            <Metric label="持仓均价">{average(basis, quantity)}</Metric>
            <Metric label="浮动盈亏" className={tone(float)}>{money(float, true)}<small>{rateLabel(percent(float, basis))}</small></Metric>
          </dl>
          <p className="lot-summary">{active.length} 个未清批次 <span>·</span> 最低买入价 {active.length ? money(active[0].price) : '—'}</p>
          <div className="card-actions">
            <button onClick={() => detail(stock.id)}>查看详情</button>
            <button className="tinted" onClick={() => buy(stock.id)}>买入</button>
            <button className="tinted" onClick={() => sell(stock.id)}>卖出</button>
          </div>
        </article>
      )}
    </div>
  </>;
}

export function StockDetail({ stock, ledger, lots, sales, edit, buy, sell, editPurchase, removePurchase }: Projection & {
  stock: Stock; ledger: Ledger; edit: () => void; buy: () => void; sell: () => void;
  editPurchase: (order: Buy) => void; removePurchase: (order: Buy) => void;
}) {
  const [selectedLotId, setSelectedLotId] = useState<string>();
  const [selectedSaleId, setSelectedSaleId] = useState<string>();
  const position = holding(stock, lots);
  const sellOrders = ledger.orders.filter(order => order.stockId === stock.id && order.kind === 'sell')
    .reverse().sort((a, b) => b.time.localeCompare(a.time));
  const net = sum(sellOrders.map(order => sales.get(order.id)!.net));
  const matchedPurchases = new Set(lots.filter(lot => lot.remaining < lot.quantity).map(lot => lot.orderId));
  const purchases = new Map(ledger.orders.filter(order => order.kind === 'buy').map(order => [order.id, order]));
  const closed = lots.filter(lot => lot.stockId === stock.id && lot.remaining === 0).length;
  const buyLots = lots.filter(lot => lot.stockId === stock.id && lot.remaining > 0)
    .reverse().sort((a, b) => b.time.localeCompare(a.time));
  const selectedLot = buyLots.find(lot => lot.id === selectedLotId);
  const selectedPurchase = selectedLot && purchases.get(selectedLot.orderId);
  const selectedSaleOrder = sellOrders.find(order => order.id === selectedSaleId);
  const selectedSale = selectedSaleOrder && sales.get(selectedSaleOrder.id);

  function actOnPurchase(action: (order: Buy) => void, order: Buy) {
    setSelectedLotId(undefined);
    action(order);
  }

  return <>
    <section className="panel">
      <div className="section-title">
        <div><h2>{stock.market} · {stock.code}</h2><span className="muted">报价更新于 {dateLabel(stock.priceUpdatedAt)}</span></div>
        <button onClick={edit}>编辑股票</button>
      </div>
      <dl className="detail-metrics">
        <Metric label="当前价格">{money(stock.price)}</Metric><Metric label="持仓股数">{count(position.quantity)}</Metric>
        <Metric label="持仓成本">{money(position.cost)}</Metric><Metric label="持仓均价">{average(position.cost, position.quantity)}</Metric>
        <Metric label="浮动盈亏" className={tone(position.float)}>{money(position.float, true)}</Metric>
        <Metric label="已实现净收益" className={tone(net)}>{money(net, true)}</Metric>
      </dl>
      <div className="trade-actions">
        <button type="button" className="tinted" onClick={buy}>登记买入</button>
        <button type="button" className="tinted" onClick={sell}>卖出</button>
      </div>
    </section>
    <section aria-labelledby="stock-purchases-heading">
      <div className="section-title list-heading">
        <div><h2 id="stock-purchases-heading">买入批次</h2><span className="muted">按买入时间从新到旧{closed ? ' · ' + closed + ' 个已清批次可在交易中查看' : ''}</span></div>
      </div>
      {buyLots.length === 0 && <div className="panel muted">暂无剩余买入批次。</div>}
      {buyLots.map(lot => {
        const profit = stock.price * lot.remaining - remainingCost(lot);
        return <div className="panel transaction" key={lot.id}>
          <button type="button" className="transaction-summary transaction-trigger" aria-haspopup="dialog"
            onClick={() => setSelectedLotId(lot.id)}>
            <span><strong>{localDate(new Date(lot.time))}</strong><small>剩余 {count(lot.remaining)} 股</small></span>
            <span className="transaction-value">
              <strong>{money(lot.price)} / 股</strong><small>浮动盈亏 <span className={tone(profit)}>{money(profit, true)}</span></small>
            </span>
            <ChevronRight className="transaction-arrow" size={16} />
          </button>
        </div>;
      })}
    </section>
    <section aria-labelledby="stock-sales-heading">
      <div className="section-title list-heading"><h2 id="stock-sales-heading">卖出记录</h2></div>
      {sellOrders.length === 0 && <div className="panel muted">暂无卖出记录。</div>}
      {sellOrders.map(order => {
        const sale = sales.get(order.id)!;
        return <div className="panel transaction" key={order.id}>
          <button type="button" className="transaction-summary transaction-trigger" aria-haspopup="dialog"
            onClick={() => setSelectedSaleId(order.id)}>
            <span><strong>{dateLabel(order.time)}</strong><small>卖出 {count(sale.quantity)} 股</small></span>
            <span className="transaction-value">
              <strong>{money(sale.proceeds)}</strong><small>{proceedsLabel(order)} · 净收益 <span className={tone(sale.net)}>{money(sale.net, true)}</span></small>
            </span>
            <ChevronRight className="transaction-arrow" size={16} />
          </button>
        </div>;
      })}
    </section>
    {selectedSaleId && <BottomSheet title="卖出记录" close={() => setSelectedSaleId(undefined)}>
      {selectedSaleOrder && selectedSale ? <>
        <p className="muted">{dateLabel(selectedSaleOrder.time)} · 净收益 <strong className={tone(selectedSale.net)}>{money(selectedSale.net, true)}（{rateLabel(selectedSale.netRate)}）</strong></p>
        <TransactionDetails order={selectedSaleOrder} sale={selectedSale} />
      </> : <p className="muted">这笔卖出记录已从本机账簿移除。</p>}
    </BottomSheet>}
    {selectedLotId && <BottomSheet title="买入批次" close={() => setSelectedLotId(undefined)}>
        {selectedLot && selectedPurchase ? <>
          <dl className="detail-metrics">
            <Metric label="买入日期">{localDate(new Date(selectedLot.time))}</Metric>
            <Metric label="买入单价">{money(selectedLot.price)}</Metric>
            <Metric label="原始股数">{count(selectedLot.quantity)}</Metric>
            <Metric label="剩余股数">{count(selectedLot.remaining)}</Metric>
            <Metric label="买入金额">{money(selectedLot.price * selectedLot.quantity)}</Metric>
            <Metric label="买入费用">{money(feeTotal(selectedLot.fees))}</Metric>
            <Metric label="剩余成本">{money(remainingCost(selectedLot))}</Metric>
            <Metric label="浮动盈亏" className={tone(stock.price * selectedLot.remaining - remainingCost(selectedLot))}>
              {money(stock.price * selectedLot.remaining - remainingCost(selectedLot), true)}
            </Metric>
          </dl>
          {selectedPurchase.note && <p className="note">{selectedPurchase.note}</p>}
          {matchedPurchases.has(selectedPurchase.id) ? <p className="muted">这笔买入订单已关联卖出。</p> : <>
            {selectedPurchase.fills.length > 1 && <p className="muted">整笔买入订单包含 {count(selectedPurchase.fills.length)} 笔分笔成交。</p>}
            <div className="purchase-sheet-actions">
              <button type="button" className="primary" onClick={() => actOnPurchase(editPurchase, selectedPurchase)}>编辑订单</button>
              <button type="button" className="danger" onClick={() => actOnPurchase(removePurchase, selectedPurchase)}>删除订单</button>
            </div>
          </>}
        </> : <p className="muted">当前没有可查看的批次。</p>}
    </BottomSheet>}
  </>;
}

export function StockEditor({ stock, ledger, save, busy }: {
  stock?: Stock; ledger: Ledger; save: (stock: Stock) => void; busy: boolean;
}) {
  const [name, setName] = useState(stock?.name ?? '');
  const [code, setCode] = useState(stock?.code ?? '');
  const [market, setMarket] = useState<Stock['market']>(stock?.market ?? '沪市');
  const [price, setPrice] = useState(stock ? priceInput(stock.price) : '');
  const [problem, setProblem] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (!name.trim() || !/^\d{6}$/.test(code.trim())) throw Error('请输入股票名称和六位股票代码');
      if (ledger.stocks.some(item => item.id !== stock?.id && item.market === market && item.code === code.trim())) throw Error('这只股票已经存在');
      const quote = cents(price);
      save({ id: stock?.id ?? crypto.randomUUID(), name: name.trim(), code: code.trim(), market, price: quote,
        priceUpdatedAt: stock?.price === quote ? stock.priceUpdatedAt : new Date().toISOString() });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '无法保存股票');
    }
  }
  return <form className="panel narrow stock-editor" onSubmit={submit}>
    <fieldset disabled={busy} className="fields">
      <label>股票名称<input maxLength={40} required value={name} onChange={event => setName(event.target.value)} /></label>
      <label>股票代码<input required inputMode="numeric" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></label>
      <label>交易市场<select value={market} onChange={event => setMarket(event.target.value as Stock['market'])}><option>沪市</option><option>深市</option></select></label>
      <label>当前价格（元）<input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
    </fieldset>
    {problem && <p className="form-message" role="alert">{problem}</p>}
    <button className="primary wide" disabled={busy}>保存股票</button>
  </form>;
}

export function Transactions({ ledger, sales, lots }: Projection & { ledger: Ledger }) {
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const orders = ledger.orders.filter(order => {
    const day = localDate(new Date(order.time));
    return (!symbol || order.stockId === symbol) && (!kind || order.kind === kind) &&
      (!since || day >= since) && (!until || day <= until);
  }).reverse().sort((a, b) => b.time.localeCompare(a.time));
  const stocks = new Map(ledger.stocks.map(stock => [stock.id, stock]));
  return <>
    <section className="panel filters">
      <label>股票<select value={symbol} onChange={event => setSymbol(event.target.value)}><option value="">全部股票</option>
        {ledger.stocks.map(stock => <option value={stock.id} key={stock.id}>{stock.name} · {stock.code}</option>)}</select></label>
      <label>交易类型<select value={kind} onChange={event => setKind(event.target.value)}><option value="">全部交易</option><option value="buy">买入</option><option value="sell">卖出</option></select></label>
      <label>起始日期<input type="date" max={until || undefined} value={since} onChange={event => setSince(event.target.value)} /></label>
      <label>结束日期<input type="date" min={since || undefined} value={until} onChange={event => setUntil(event.target.value)} /></label>
    </section>
    {orders.length === 0 && <Empty title="暂无符合条件的交易" />}
    {orders.map(order => <Transaction key={order.id} order={order} sale={sales.get(order.id)}
      stock={stocks.get(order.stockId)!} orderLots={order.kind === 'buy' ? lots.filter(lot => lot.orderId === order.id) : []} />)}
  </>;
}

function proceedsLabel(order: Ledger['orders'][number]) {
  return order.feeSource === 'actual' ? '本次到账' : '预计到账';
}

function Transaction({ order, sale, stock, orderLots }: {
  order: Ledger['orders'][number]; sale?: Sale; stock: Stock; orderLots: Lot[];
}) {
  return <details className="panel transaction">
    <summary className="transaction-summary">
      <span className={'trade-tag ' + (sale ? 'sell-tag' : '')}>{sale ? '卖出' : '买入'}</span>
      <span><strong>{stock.name} <small>{stock.code}</small></strong><small>{order.kind === 'buy' ? localDate(new Date(order.time)) : dateLabel(order.time)}</small></span>
      <span className="transaction-value">
        <strong className={sale ? tone(sale.net) : ''}>{sale ? money(sale.net, true) : money(amountOf(order.fills))}</strong>
        <small>{sale ? '净收益 · ' + rateLabel(sale.netRate) : '买入金额'}</small>
      </span>
      <ChevronRight className="transaction-arrow" size={16} />
    </summary>
    <TransactionDetails order={order} sale={sale} orderLots={orderLots} />
  </details>;
}

function TransactionDetails({ order, sale, orderLots = [] }: {
  order: Ledger['orders'][number]; sale?: Sale; orderLots?: Lot[];
}) {
  const quantity = sum(order.fills.map(fill => fill.quantity));
  const amount = amountOf(order.fills);
  return <div className="transaction-body">
    <dl className="detail-metrics">
      <Metric label="成交股数">{count(quantity)}</Metric>
      <Metric label="平均成交单价">{average(amount, quantity)}</Metric>
      <Metric label="成交金额">{money(amount)}</Metric>
      {sale && <Metric label={proceedsLabel(order)}>{money(sale.proceeds)}</Metric>}
    </dl>
    <h3>分笔成交</h3>
    <dl className="lines">{order.fills.map((fill, index) => <div key={index}><dt>{money(fill.price)} × {count(fill.quantity)} 股</dt>
      <dd>{sale ? money(amountOf([fill])) : '剩余 ' + count(orderLots[index].remaining) + ' 股'}</dd></div>)}</dl>
    <h3>订单费用 · {order.feeSource === 'actual' ? '交割单' : '估算'}</h3>
    <FeesList fees={order.fees} />
    {sale && <><h3>匹配批次</h3><SaleMatches sale={sale} /></>}
    {order.note && <p className="note">{order.note}</p>}
  </div>;
}

export function Statistics({ ledger, sales }: { ledger: Ledger; sales: Projection['sales'] }) {
  const realized = [...sales.values()];
  const net = sum(realized.map(sale => sale.net));
  const averageRate = realized.length ? realized.reduce((total, sale) => total + sale.netRate, 0) / realized.length : 0;
  return <>
    <section className="overview">
      <div className="overview-main"><div>累计已实现净收益</div><strong className={tone(net)}>{money(net, true)}</strong></div>
      <dl className="overview-metrics">
        <Metric label="累计买入金额">{money(sum(ledger.orders.filter(order => order.kind === 'buy').map(order => amountOf(order.fills))))}</Metric>
        <Metric label="累计卖出金额">{money(sum(realized.map(sale => sale.sellAmount)))}</Metric>
        <Metric label="平均净收益率">{realized.length ? rateLabel(averageRate) : '—'}</Metric>
      </dl>
    </section>
    <section className="panel"><h2>卖出表现</h2><dl className="detail-metrics">
      <Metric label="盈利卖出">{count(realized.filter(sale => sale.net > 0).length)} 次</Metric>
      <Metric label="亏损卖出">{count(realized.filter(sale => sale.net < 0).length)} 次</Metric>
      <Metric label="持平卖出">{count(realized.filter(sale => sale.net === 0).length)} 次</Metric>
    </dl></section>
    <section className="panel"><h2>各股票已实现收益</h2>
      {ledger.stocks.length ? <dl className="lines">{ledger.stocks.map(stock => {
        const total = sum(ledger.orders.filter(order => order.stockId === stock.id && order.kind === 'sell').map(order => sales.get(order.id)!.net));
        return <div key={stock.id}><dt>{stock.name} <small>{stock.code}</small></dt><dd className={tone(total)}>{money(total, true)}</dd></div>;
      })}</dl> : <p className="muted">暂无股票。</p>}
    </section>
  </>;
}

function FeeEditor({ profile, save, busy }: { profile: Profile; save: (profile: Profile) => void; busy: boolean }) {
  const [fields, setFields] = useState(profile);
  const [minimum, setMinimum] = useState(priceInput(profile.minimum));
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      save(validateProfile({ ...fields, minimum: cents(minimum, true) }));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '配置无效');
    }
  }
  return <form className="panel" onSubmit={submit}>
    <h2>交易费用</h2>
    <p className="muted">按成交订单计费。印花税仅在卖出时计算。已登记交易保留当时的费用。</p>
    <fieldset disabled={busy} className="fields">
      {feeFields.map(field => <label key={field}>{feeLabels[field]}费率（%）
        <input inputMode="decimal" disabled={field === 'regulatory' && fields.includesRegulatory} value={fields[field]} onChange={event => setFields({ ...fields, [field]: event.target.value })} />
      </label>)}
      <label>最低佣金（元）<input inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
      <label className="checkbox"><input type="checkbox" checked={fields.includesRegulatory} onChange={event => setFields({ ...fields, includesRegulatory: event.target.checked })} />佣金已包含经手费及证管费</label>
    </fieldset>
    {error && <p className="form-message" role="alert">{error}</p>}
    <div className="actions"><button className="primary" disabled={busy}>保存费用配置</button></div>
  </form>;
}

export type SyncConfig = { folder: string; credential: string; secret: string };
export function Settings({ local, busy, conflict, config, setConfig, feedback, saveProfile, sync, download, restore, clear }: {
  local: LocalState; busy: boolean; conflict: boolean; config: SyncConfig; setConfig: (config: SyncConfig) => void; feedback?: { text: string; error?: boolean };
  saveProfile: (profile: Profile) => void; sync: (direction: SyncDirection) => void; download: () => void;
  restore: (file: File) => void; clear: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cleared, setCleared] = useState(false);
  const folder = config.folder.trim();
  const point = local.sync?.[folder];
  const ready = Boolean(folder && config.credential.trim() && config.secret);

  function openConfig() {
    setCleared(false);
    dialog.current?.showModal();
  }

  function editConfig(next: SyncConfig) {
    setCleared(false);
    setConfig(next);
  }

  const conflictActions = conflict && <>
    <button type="button" disabled={busy} onClick={() => sync('download')}>保留云端</button>
    <button type="button" disabled={busy} onClick={() => sync('upload')}>保留本机</button>
  </>;
  return <>
    <FeeEditor key={JSON.stringify(local.ledger.profile)} profile={local.ledger.profile} save={saveProfile} busy={busy} />
    <section className="panel">
      <div className="section-title"><h2><Cloud size={19} /> 数据同步与备份</h2><span className="muted">{point?.revision === local.ledger.revision ? '已与云端同步' : point ? '本地有更新待同步' : '未同步'}</span></div>
      {point && <p className="muted">上次同步 {dateLabel(point.time)}</p>}
      <div className="actions">
        {conflictActions}
        <button type="button" className="primary" disabled={busy} onClick={() => ready ? sync('auto') : openConfig()}>立即同步</button>
        <button type="button" disabled={busy} onClick={openConfig}>同步配置</button>
      </div>
    </section>
    <dialog ref={dialog} className="sync-dialog" aria-labelledby="sync-config-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); setCleared(false); sync('auto'); }}>
        <div className="section-title">
          <h2 id="sync-config-title">同步配置</h2>
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button>
        </div>
        <p className="muted sync-path">私有仓库 {repository} / stocks/{folder || '<名字>'}/ledger.json</p>
        <fieldset disabled={busy}>
          <label>云端名字
            <input value={config.folder} onChange={event => editConfig({ ...config, folder: event.target.value })}
              placeholder="例如 liuzhenghua" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>{bundledToken ? '云端访问口令' : 'GitHub Token'}
            <input type="password" autoComplete="off" required value={config.credential}
              placeholder={bundledToken ? '用于解锁 GitHub 访问凭证' : 'Contents: Read and write'}
              onChange={event => editConfig({ ...config, credential: event.target.value })} />
          </label>
          <label>数据加密口令
            <input type="password" autoComplete="off" required value={config.secret}
              placeholder="用于加密和解密备份数据"
              onChange={event => editConfig({ ...config, secret: event.target.value })} />
          </label>
        </fieldset>
        <button className="link-button" type="button" disabled={busy} onClick={() => {
          setConfig({ ...config, credential: '', secret: '' });
          setCleared(true);
        }}>清除已保存的口令</button>
        {conflict && <div className="actions">{conflictActions}</div>}
        <button className="primary wide" disabled={busy}>{busy ? '同步中…' : '保存并同步'}</button>
        {cleared ? <p className="muted sync-message" role="status">已清除此浏览器保存的口令</p> :
          busy ? <p className="muted sync-message" role="status">正在同步…</p> :
          feedback && <p className={feedback.error ? 'form-message sync-message' : 'muted sync-message'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      </form>
    </dialog>
    <section className="panel">
      <h2>本机备份</h2>
      <p className="muted">清除浏览器数据可能导致记录丢失。导出的 JSON 包含完整交易记录，请妥善保管。</p>
      <p className="muted">上次导出 {local.backupAt ? dateLabel(local.backupAt) : '暂无'}</p>
      <div className="actions spread">
        <button className="danger" disabled={busy} onClick={clear}>清空本机数据</button>
        <div className="actions">
          <label className={'button upload ' + (busy ? 'disabled' : '')}><Upload size={16} />导入<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) restore(file);
          }} /></label>
          <button disabled={busy} onClick={download}><Download size={16} />导出</button>
        </div>
      </div>
    </section>
  </>;
}
