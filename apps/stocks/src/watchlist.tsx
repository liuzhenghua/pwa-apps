import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Bell, ChevronRight, Info, Plus, RefreshCw } from 'lucide-react';
import { AlertSheet } from './alert-sheet.tsx';
import type { SyncConfig } from './pages.tsx';
import { activeCycle, average, cents, compareSellPrice, cycleResult, buyObservationMatches, defaultObservationRules, percent, reachesBuyObservation, recentPrices, sellObservation, sum, shares, sharesForAmount, shareStep, sameTrade, tradePrices, type Ledger, type ObservationRules, type OrderKind, type PriceRecord, type Stock, type TradePrice } from './domain.ts';
import { money, tradeDateLabel } from './format.ts';
import { symbolFor, useQuotes, type Quote } from './quotes.ts';

const quickAmounts = [5_000, 10_000, 15_000, 20_000];
const number = new Intl.NumberFormat('zh-CN');
const sideLabels = { buy: '买', sell: '卖' };
const quoteTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

type Editor = { type: 'add' } | { type: 'record'; stock: Stock; kind: OrderKind }
  | { type: 'stock'; stock: Stock }
  | { type: 'alerts'; stock: Stock }
  | { type: 'detail'; stock: Stock; kind: OrderKind; index: number; entry: PriceRecord; tradeIndex?: number };
type Props = {
  ledger: Ledger;
  busy: boolean;
  add: (stock: Stock) => Promise<boolean>;
  record: (stock: Stock, kind: OrderKind, price: number, quantity: number) => Promise<boolean>;
  endCycle: (stock: Stock) => Promise<boolean>;
  removeTrade: (stockId: string, index: number, entry: TradePrice) => Promise<boolean>;
  remove: (stock: Stock) => Promise<boolean>;
  market: ReturnType<typeof useQuotes>;
  syncConfig: SyncConfig;
};

function isBackdropPress(event: MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
}

function PriceSide({ kind, records, open }: {
  kind: OrderKind;
  records: PriceRecord[];
  open: (entry: PriceRecord, index: number) => void;
}) {
  const label = sideLabels[kind];
  return <ol className="price-side" aria-label={kind === 'buy' ? '周期内买入' : '周期内卖出'}>
    {records.slice(0, 3).map((entry, index) => {
      const title = label + (index + 1);
      return <li key={index}><button type="button" className="price-row"
        aria-label={title + '详情'} onClick={() => open(entry, index)}>
        <span className={'entry-label ' + kind}>{title}</span>
        <strong>{money(entry.price)}</strong>
        {entry.quantity !== undefined && <span className="entry-quantity">{entry.quantity.toLocaleString('zh-CN')} 股</span>}
        <time dateTime={entry.time}>{tradeDateLabel(entry.time)}</time>
      </button></li>;
    })}
  </ol>;
}

function signedMoney(value: number): string {
  return (value > 0 ? '+' : '') + money(value);
}

function signedRate(value: number): string {
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

function RecordDetail({ entry, quote, missing }: { entry: PriceRecord; quote?: Quote; missing: boolean }) {
  const difference = quote ? quote.price - entry.price : undefined;
  const result = quote ? compareSellPrice(entry, quote.price, entry.quantity) : undefined;
  const tone = difference === undefined || difference === 0 ? '' : difference > 0 ? 'gain' : 'loss';
  return <>
    <dl className="record-detail">
      <div><dt>记录日期</dt><dd><time dateTime={entry.time}>{tradeDateLabel(entry.time)}</time></dd></div>
      <div><dt>记录价格</dt><dd>{money(entry.price)}</dd></div>
      <div><dt>记录数量</dt><dd>{entry.quantity === undefined ? '—' : entry.quantity.toLocaleString('zh-CN') + ' 股'}</dd></div>
      <div><dt>最新价</dt><dd>{quote ? money(quote.price) : '—'}</dd></div>
      <div><dt>每股涨跌</dt><dd className={tone}>{difference === undefined ? '—' : signedMoney(difference)}</dd></div>
      <div><dt>涨跌幅</dt><dd className={tone}>{result ? signedRate(result.rate) : '—'}</dd></div>
      {entry.quantity !== undefined && <div><dt>按记录股数计算</dt><dd className={tone}>{result?.gross === undefined ? '—' : signedMoney(result.gross)}</dd></div>}
    </dl>
    <p className="muted">{quote ? '腾讯财经 · ' + quoteTime.format(new Date(quote.time)) + (missing ? ' · 更新失败，显示上次报价' : '') : '暂无行情，联网后可查看涨跌。'}</p>
  </>;
}

function priceComparison(label: string, price: number, reference: Pick<PriceRecord, 'price'>): string {
  const change = percent(price - reference.price, reference.price);
  return '较最近' + label + (change === 0 ? '持平' : (change > 0 ? '高 ' : '低 ') + Math.abs(change).toFixed(2) + '%');
}

function latestTrade(history: TradePrice[], kind: OrderKind): PriceRecord | undefined {
  return history.reduce<PriceRecord | undefined>((previous, trade) =>
    trade.kind === kind && (!previous || trade.time > previous.time) ? trade : previous, undefined);
}

function buyEstimate(quote?: Quote, reference?: PriceRecord) {
  const quantity = reference?.quantity;
  if (!quote || !reference || quantity === undefined) return;
  const cost = quote.price * quantity;
  const difference = (reference.price - quote.price) * quantity;
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(difference)) return;
  const tone = difference > 0 ? 'gain' : difference < 0 ? 'loss' : '';
  const rate = Math.abs(percent(quote.price - reference.price, reference.price)).toFixed(2);
  const impact = difference === 0 ? '与上次买入同价' :
    (difference > 0 ? '省 ' : '贵 ') + money(Math.abs(difference));
  const impactRate = difference === 0 ? '' : rate + '%';
  return { quantity, cost, impact, impactRate, tone };
}

function BuyImpact({ estimate }: { estimate: NonNullable<ReturnType<typeof buyEstimate>> }) {
  return <span className="decision-impact"><span>买 {number.format(estimate.quantity)} 股</span>
    <strong className={'decision-impact-values ' + estimate.tone}>
      <span>{estimate.impact}</span>
      {estimate.impactRate && <span><span aria-hidden="true">· </span>{estimate.impactRate}</span>}
    </strong></span>;
}

function cycleDecision(history: TradePrice[], quote: Quote | undefined, lastSell: PriceRecord | undefined, rules: ObservationRules) {
  if (!history.length) return;
  try {
    const result = cycleResult(history);
    const quantity = result.unmatchedKind === 'buy' ? result.unmatched : 0;
    if (!quote) return { result, quantity, headline: '等待最新报价', tone: '' };

    const profit = quantity ? sum([quote.price * quantity, -result.remainingBuyCost]) : undefined;
    const profitRate = profit === undefined ? undefined : percent(profit, result.remainingBuyCost);
    const latestBuy = latestTrade(history, 'buy');
    const buyDrop = rules.activeBuyDropFromBuy ?? defaultObservationRules.activeBuyDropFromBuy;
    const belowSell = buyObservationMatches(quote.price, lastSell, true, rules);
    const belowBuy = !!latestBuy && reachesBuyObservation(quote.price, latestBuy.price, buyDrop);
    const buyObservation = [
      belowSell && lastSell ? priceComparison('卖出', quote.price, lastSell) : '',
      belowBuy && latestBuy ? priceComparison('买入', quote.price, latestBuy) : '',
    ].filter(Boolean).join(' · ');
    const estimate = buyEstimate(quote, latestBuy);
    const sellSignal = sellObservation(result, quote.price, rules);
    const partialSell = sellSignal?.scope === 'last-buy';
    const headline = sellSignal ? '卖出观察' : buyObservation ? '' : '观望';
    const sellImpact = profit === undefined || profitRate === undefined ? '' :
      signedMoney(profit);
    const headlineMetric = sellSignal?.scope === 'all' ? '全卖 ' + signedRate(profitRate!) :
      partialSell ? '最近剩余批次 ' + number.format(sellSignal.quantity) + ' 股 · ' + priceComparison('剩余买价', quote.price, result.remainingBuyLots[0]) : '';
    return {
      result, quantity, profit, profitRate, estimate, buyObservation, headline, headlineMetric, sellImpact, sellImpactRate: sellSignal?.scope !== 'all' && profitRate !== undefined ? signedRate(profitRate) : '',
      labelTone: sellSignal ? 'gain' : 'neutral',
      tone: profit ? (profit > 0 ? 'gain' : 'loss') : '',
    };
  } catch {
    return;
  }
}

function DecisionSignals({ decision }: { decision: NonNullable<ReturnType<typeof cycleDecision>> }) {
  return <>
    {decision.headline && <span className={'decision-label ' + (decision.labelTone ?? 'neutral')}>{decision.headline}</span>}
    {decision.headlineMetric && <strong className={decision.labelTone ?? 'neutral'}>{decision.headlineMetric}</strong>}
    {decision.buyObservation && <span className="decision-signal buy">
      <span className="decision-label buy">买入观察</span><strong>{decision.buyObservation}</strong>
    </span>}
  </>;
}

function DecisionImpacts({ decision }: { decision: NonNullable<ReturnType<typeof cycleDecision>> }) {
  const { sellImpact, sellImpactRate, estimate, tone } = decision;
  if (!sellImpact && !estimate) return null;

  return <span className="decision-impacts">
    {sellImpact && <span className="decision-impact"><span>全卖预计</span><strong className={'decision-impact-values ' + tone}><span>{sellImpact}</span>
      {sellImpactRate && <span><span aria-hidden="true">· </span>{sellImpactRate}</span>}</strong></span>}
    {estimate && <BuyImpact estimate={estimate} />}
  </span>;
}

function CyclePosition({ decision }: { decision: ReturnType<typeof cycleDecision> }) {
  if (!decision) return <p className="muted">本周期金额或股数超出可计算范围。</p>;
  const { result, quantity, profit, profitRate, estimate } = decision;
  return <details className="cycle-position" aria-label="本周期持仓与买价比较">
    <summary>
      <span className="decision-title">
        {quantity > 0 && <strong>剩 {number.format(quantity)} 股</strong>}
        <DecisionSignals decision={decision} />
      </span><ChevronRight size={16} aria-hidden="true" />
      <DecisionImpacts decision={decision} />
    </summary>
    <p className="decision-current">{quantity ? '剩余均价 ¥' + average(result.remainingBuyCost, quantity) : '本周期无剩余买入股数'}</p>
    {result.remainingBuyLots[0] && <p className="muted">
      最近剩余批次 {money(result.remainingBuyLots[0].price)} · {number.format(result.remainingBuyLots[0].quantity)} 股
    </p>}
    <div className="decision-outcomes">
      <div>
        <h3>卖出 {number.format(quantity)} 股</h3>
        <p>{profit === undefined ? (quantity ? '暂无估算' : '当前无可配对的买入股数') :
          <><strong className={decision.tone}>{signedMoney(profit)}（{signedRate(profitRate!)}）</strong><br />卖出后本周期剩余 0 股</>}</p>
      </div>
      <div>
        <h3>{estimate ? '买 ' + number.format(estimate.quantity) + ' 股' : '买入测算'}</h3>
        {estimate ? <p>需 {money(estimate.cost)}<br />
          <strong className={estimate.tone}>{estimate.impact}{estimate.impactRate && '（' + estimate.impactRate + '）'}</strong> · 相对上次买入金额</p> :
          <p>需要最新报价和本周期最近买入的股数。</p>}
      </div>
    </div>
    {result.skipped && <p className="muted">缺少股数的记录未计入。</p>}
    <p className="muted">按最新报价估算，未扣手续费。</p>
  </details>;
}

function PreviousCycle({ history, endedAt }: { history: TradePrice[]; endedAt: string }) {
  const buys = history.filter(entry => entry.kind === 'buy');
  const sells = history.filter(entry => entry.kind === 'sell');
  const lowestBuy = buys.reduce((lowest, entry) => Math.min(lowest, entry.price), Infinity);
  const highestSell = sells.reduce((highest, entry) => Math.max(highest, entry.price), -Infinity);
  const values = [
    ['最近买入', buys[0]?.price],
    ['最近卖出', sells[0]?.price],
    ['最低买入', buys.length ? lowestBuy : undefined],
    ['最高卖出', sells.length ? highestSell : undefined],
  ] as const;

  return <section className="previous-cycle" aria-label="上个周期">
    <div><h3>上个周期</h3><time dateTime={endedAt} className="muted">{tradeDateLabel(endedAt)}</time></div>
    <dl>
      {values.map(([label, price]) => <div key={label}><dt>{label}</dt><dd>{price === undefined ? '—' : money(price)}</dd></div>)}
    </dl>
  </section>;
}

function SellPreview({ buys, value, quantity }: { buys: PriceRecord[]; value: string; quantity: string }) {
  let price: number | undefined;
  let count: number | undefined;
  try { price = cents(value); } catch { /* Wait for a valid price. */ }
  try { count = shares(quantity); } catch { /* Revenue needs a valid share count. */ }

  return <section className="sell-preview" aria-label="卖出测算">
    <h3>对比最近剩余买入批次</h3>
    {buys.length === 0 ? <p className="muted">本周期暂无剩余买入股数</p> :
      price === undefined ? <p className="muted">输入有效卖价后查看盈亏和收益率。</p> : <>
        <table>
          <thead><tr><th scope="col">买入价</th><th scope="col">价差盈亏</th><th scope="col">收益率</th></tr></thead>
          <tbody>{buys.map((buy, index) => {
            const { gross, rate, quantity: compared } = compareSellPrice(buy, price, count);
            const tone = rate > 0 ? 'gain' : rate < 0 ? 'loss' : '';
            return <tr key={index}>
              <th scope="row">批次 {index + 1} <span>{money(buy.price)}</span></th>
              <td className={tone}>{gross === undefined ? '—' : signedMoney(gross)}
                {compared !== undefined && <small>{compared.toLocaleString('zh-CN')} 股</small>}</td>
              <td className={tone}>{signedRate(rate)}</td>
            </tr>;
          })}</tbody>
        </table>
        <p className="muted">每笔分别比较，按买卖股数较少的一方计算。买入股数未知时按卖出股数估算。未扣手续费。</p>
      </>}
  </section>;
}

export function Watchlist({ ledger, busy, add, record, endCycle, removeTrade, remove, market, syncConfig }: Props) {
  const { quotes, missing, loading, refresh } = market;
  const [editor, setEditor] = useState<Editor>();
  const [value, setValue] = useState<string>();
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
  }, [editor]);

  function open(next: Editor) {
    pressedBackdrop.current = false;
    setError('');
    const price = next.type === 'record' ? quotes.get(symbolFor(next.stock))?.price : undefined;
    setValue(price === undefined ? undefined : (price / 100).toFixed(2));
    setQuantity('');
    if (next.type === 'detail') {
      const expected = { ...next.entry, kind: next.kind };
      const history = tradePrices(next.stock, ledger.orders);
      const tradeIndex = history.findIndex(trade => sameTrade(trade, expected));
      setEditor({ ...next, tradeIndex });
    } else {
      setEditor(next);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.type === 'detail' || editor.type === 'stock' || editor.type === 'alerts' || busy) return;
    setError('');
    try {
      let saved: boolean;
      if (editor.type === 'add') {
        const code = (value ?? '').trim();
        if (!/^(60|68|00|30)\d{4}$/.test(code)) throw Error('请输入沪深 A 股的六位股票代码');
        const market = code.startsWith('6') ? '沪市' : '深市';
        if (ledger.stocks.some(stock => stock.code === code && stock.market === market)) throw Error('这只股票已经添加');
        saved = await add({ id: crypto.randomUUID(), code, market, name: code, price: 0, priceUpdatedAt: new Date().toISOString() });
      } else {
        saved = await record(editor.stock, editor.kind, cents(value ?? ''), shares(quantity));
      }
      if (saved) dialog.current?.close();
      else setError('保存失败，请关闭后检查提示并重试');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '无法保存');
    }
  }

  const addMode = editor?.type === 'add';
  const detail = editor?.type === 'detail' ? editor : undefined;
  const editorSymbol = editor && editor.type !== 'add' ? symbolFor(editor.stock) : undefined;
  const editorQuote = editorSymbol ? quotes.get(editorSymbol) : undefined;
  const quotePrice = editor?.type === 'record' ? editorQuote?.price : undefined;
  useEffect(() => {
    if (quotePrice !== undefined) setValue(previous => previous ?? (quotePrice / 100).toFixed(2));
  }, [editor, quotePrice]);
  const editorStock = editor && (editor.type === 'stock' || editor.type === 'record')
    ? ledger.stocks.find(stock => stock.id === editor.stock.id) ?? editor.stock
    : undefined;
  const stockDetail = editor?.type === 'stock' ? editorStock : undefined;
  const editorCycle = editorStock ? activeCycle(editorStock, tradePrices(editorStock, ledger.orders)) : [];
  const editorBuys = editorCycle.filter(entry => entry.kind === 'buy');
  const editorSells = editorCycle.filter(entry => entry.kind === 'sell');
  const transactionCount = editorCycle.length;
  const sellMode = editor?.type === 'record' && editor.kind === 'sell';
  let sellLots: PriceRecord[] = [];
  if (sellMode) {
    try { sellLots = cycleResult(editorCycle).remainingBuyLots.slice(0, 3); } catch { /* Imported totals can exceed the supported range. */ }
  }
  let enteredPrice: number | undefined;
  let enteredShares: number | undefined;
  try { enteredPrice = cents(value ?? ''); } catch { /* Wait for valid input. */ }
  try { enteredShares = shares(quantity); } catch { /* Wait for valid input. */ }
  const amount = enteredPrice === undefined || enteredShares === undefined ? undefined : enteredPrice * enteredShares;
  const rules = ledger.observationRules ?? defaultObservationRules;
  const cards = ledger.stocks.map(stock => {
    const symbol = symbolFor(stock);
    const quote = quotes.get(symbol);
    const history = tradePrices(stock, ledger.orders);
    const cycle = activeCycle(stock, history);
    const latest = missing.has(symbol) ? undefined : quote;
    const cachedSell = cycle.length ? undefined : recentPrices(stock, ledger.orders).sell[0];
    const loadedSell = latestTrade(cycle.length ? cycle : history, 'sell');
    const loadedBuy = cycle.length ? undefined : latestTrade(history, 'buy');
    const cachedBuy = cycle.length ? undefined : recentPrices(stock, ledger.orders).buy[0];
    const lastBuy = loadedBuy && (!cachedBuy || loadedBuy.time >= cachedBuy.time) ? loadedBuy : cachedBuy;
    const idleEstimate = cycle.length ? undefined : buyEstimate(latest, lastBuy);
    const lastSell = loadedSell && (!cachedSell || loadedSell.time >= cachedSell.time) ? loadedSell : cachedSell;
    const idleComparison = latest && lastSell ? priceComparison('卖出', latest.price, lastSell) : '';
    const buyObservation = latest && !cycle.length && buyObservationMatches(latest.price, lastSell, false, rules) ? idleComparison : '';
    return {
      stock, symbol, quote, history, cycle, idleComparison, idleEstimate, buyObservation,
      name: quote?.name ?? stock.name,
      decision: cycleDecision(cycle, latest, lastSell, rules),
    };
  });
  return <>
    <div className="watch-toolbar">
      <h1>持仓</h1>
      <div className="watch-toolbar-actions">
        <button type="button" disabled={loading || !ledger.stocks.length} onClick={refresh}><RefreshCw size={16} />{loading ? '更新中…' : '刷新行情'}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => open({ type: 'add' })}><Plus size={17} />添加股票</button>
      </div>
    </div>
    {ledger.stocks.length === 0 && <section className="panel empty"><h2>还没有股票</h2><p>输入股票代码，开始记录最近的买卖价格。</p></section>}
    {cards.length > 1 && <section className="panel decision-overview" aria-label="持仓速览">
      <h2>持仓速览</h2>
      <ul>
        {cards.map(({ stock, name, decision, cycle, idleComparison, idleEstimate, buyObservation }) => <li key={stock.id}>
          <button type="button" onClick={() => {
            const card = document.getElementById('holding-' + stock.id);
            const details = card?.querySelector('details.cycle-position');
            if (details instanceof HTMLDetailsElement) details.open = true;
            card?.scrollIntoView({ block: 'start' });
            card?.focus({ preventScroll: true });
          }}>
            <span className="decision-overview-copy">
              <span className="decision-title">
                <strong>{name}</strong>
                {decision && decision.quantity > 0 && <span className="decision-quantity">剩 {number.format(decision.quantity)} 股</span>}
                {decision ? <DecisionSignals decision={decision} /> : <>
                  <span className={'decision-label ' + (buyObservation ? 'buy' : 'neutral')}>
                    {buyObservation ? '买入观察' : cycle.length ? '暂无法测算' : '观望'}
                  </span>
                  {buyObservation && <strong className="buy">{buyObservation}</strong>}
                </>}
              </span>
              {decision && <DecisionImpacts decision={decision} />}
              {idleEstimate && <span className="decision-impacts decision-impacts-single"><BuyImpact estimate={idleEstimate} /></span>}
              {!cycle.length && !buyObservation && idleComparison && <span className="decision-comparison muted">{idleComparison}</span>}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
      <p className="muted">收益率按本周期价差估算，未扣手续费。</p>
    </section>}
    <div className="stock-grid">
      {cards.map(({ stock, symbol, quote, history, cycle, name, decision, idleComparison, idleEstimate, buyObservation }) => {
        const lastEnded = stock.cycles?.at(-1);
        const dayChange = quote?.previousClose ? quote.price - quote.previousClose : undefined;
        const dayRate = quote?.previousClose && dayChange !== undefined ? percent(dayChange, quote.previousClose) : undefined;
        const dayTone = dayChange === undefined || dayChange === 0 ? '' : dayChange > 0 ? 'gain' : 'loss';
        const buys = cycle.filter(item => item.kind === 'buy');
        const sells = cycle.filter(item => item.kind === 'sell');
        return <article className="panel watch-card" key={stock.id} id={'holding-' + stock.id} tabIndex={-1}>
          <div className="watch-heading">
            <div><h2>{name}</h2><p className="muted">{stock.market} · {stock.code}</p></div>
            <div className="watch-heading-actions">
              <button type="button" className="icon-button stock-detail-button" aria-label={name + '价格提醒'} title="价格提醒" disabled={busy}
                onClick={() => open({ type: 'alerts', stock })}><Bell size={18} aria-hidden="true" /></button>
              <button type="button" className="icon-button stock-detail-button" aria-label={name + '详情'} title="股票详情" disabled={busy}
                onClick={() => open({ type: 'stock', stock })}><Info size={18} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="watch-quote">
            <span className="muted">最新价</span>
            <div className="watch-quote-values">
              <strong>{quote ? money(quote.price) : '—'}</strong>
              {dayChange !== undefined && dayRate !== undefined && <span className={'watch-day-change ' + dayTone} aria-label={'当日涨跌 ' + signedMoney(dayChange) + ' ' + signedRate(dayRate)}>
                <span className="muted">当日</span><span>{signedMoney(dayChange)}</span><span>{signedRate(dayRate)}</span>
              </span>}
            </div>
            <span className="muted">{quote ? '腾讯财经 · ' + quoteTime.format(new Date(quote.time)) + (missing.has(symbol) ? ' · 更新失败' : '') : missing.has(symbol) ? '行情暂不可用' : '等待报价'}</span>
          </div>
          <p className="muted watch-cycle-count">{cycle.length ? '本周期 · 买入 ' + buys.length + ' 笔 · 卖出 ' + sells.length + ' 笔' : '暂无进行中的周期'}</p>
          {!cycle.length && buyObservation ? <p className="decision-title watch-cycle-count">
            <span className="decision-label buy">买入观察</span><strong className="buy">{buyObservation}</strong>
          </p> : !cycle.length && idleComparison && <p className="muted watch-cycle-count">最新价{idleComparison}</p>}
          {idleEstimate && <span className="decision-impacts decision-impacts-single"><BuyImpact estimate={idleEstimate} /></span>}
          {cycle.length > 0 && <>
            <CyclePosition decision={decision} />
            <div className="price-headings" aria-hidden="true"><span>周期内买入</span><span>周期内卖出</span></div>
            <div className="price-sides">
              <PriceSide kind="buy" records={buys} open={(entry, index) => open({ type: 'detail', kind: 'buy', stock, entry, index })} />
              <PriceSide kind="sell" records={sells} open={(entry, index) => open({ type: 'detail', kind: 'sell', stock, entry, index })} />
            </div>
          </>}
          {(buys.length > 3 || sells.length > 3) && <details className="watch-cycle-more">
            <summary>展开本周期全部 {cycle.length} 笔记录</summary>
            <ul className="cycle-records">
              {cycle.map((item, index) => <li key={index}>
                <button type="button" className="cycle-entry" onClick={() => open({
                  type: 'detail', stock, kind: item.kind, entry: item,
                  index: (item.kind === 'buy' ? buys : sells).indexOf(item),
                })}>
                  <span>{item.kind === 'buy' ? '买入' : '卖出'} · {tradeDateLabel(item.time)}</span>
                  <strong>{money(item.price)}{item.quantity === undefined ? '' : ' · ' + number.format(item.quantity) + ' 股'}</strong>
                </button>
              </li>)}
            </ul>
          </details>}
          {!cycle.length && lastEnded && <PreviousCycle endedAt={lastEnded.endedAt}
            history={history.slice(cycle.length, cycle.length + lastEnded.count)} />}
          <div className="card-actions">
            <button type="button" className="tinted" disabled={busy} onClick={() => open({ type: 'record', stock, kind: 'buy' })}>记买价</button>
            <button type="button" disabled={busy} onClick={() => open({ type: 'record', stock, kind: 'sell' })}>记卖价</button>
          </div>
        </article>;
      })}
    </div>
    <dialog ref={dialog} className={editor && !addMode ? 'sync-dialog entry-sheet' : 'sync-dialog'} aria-labelledby="watch-editor-title" data-side={stockDetail ? 'stock' : detail ? 'detail' : editor?.type === 'record' ? editor.kind : editor?.type}
      onClose={() => setEditor(undefined)} onCancel={event => { if (busy) event.preventDefault(); }}
      onPointerDown={event => { pressedBackdrop.current = event.button === 0 && isBackdropPress(event); }}
      onClick={event => {
        const tappedBackdrop = pressedBackdrop.current && event.detail > 0 && isBackdropPress(event);
        pressedBackdrop.current = false;
        if (!addMode && !busy && tappedBackdrop) event.currentTarget.close();
      }}>
      {editor?.type === 'alerts' ? <AlertSheet config={syncConfig} symbol={symbolFor(editor.stock)}
        name={editorQuote?.name ?? editor.stock.name} close={() => dialog.current?.close()} />
        : editor && <form onSubmit={event => void submit(event)}>
        <div className="section-title editor-heading">
          <h2 id="watch-editor-title">{editor.type === 'add' ? '添加股票' : editor.type === 'stock' ? '股票详情' : detail ? sideLabels[detail.kind] + (detail.index + 1) + '详情' : '记录' + sideLabels[editor.kind] + '价'}</h2>
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button>
        </div>
        <div className="editor-content">
          {editor.type !== 'add' && <p className="muted">{editorQuote?.name ?? editor.stock.name} · {editor.stock.code}</p>}
          {stockDetail ? <>
            <dl className="record-detail">
              <div><dt>最新价</dt><dd>{editorQuote ? money(editorQuote.price) : '—'}</dd></div>
              <div><dt>本周期交易</dt><dd>{number.format(transactionCount)} 笔</dd></div>
              <div><dt>本周期最近买价</dt><dd>{editorBuys[0] ? money(editorBuys[0].price) : '—'}</dd></div>
              <div><dt>本周期最近卖价</dt><dd>{editorSells[0] ? money(editorSells[0].price) : '—'}</dd></div>
            </dl>
            <p className="muted">可随时结束当前做 T 周期。已配对的收益归入本周期，交易流水和实际持仓统计会保留。</p>
          </> : detail ? <RecordDetail entry={detail.entry} quote={editorQuote} missing={!!editorSymbol && missing.has(editorSymbol)} /> : <>
            {addMode ? <label className="watch-input">股票代码
              <input value={value ?? ''} onChange={event => setValue(event.target.value)} required disabled={busy}
                inputMode="numeric" maxLength={6} />
            </label> : <div className="watch-input">
              <label htmlFor="watch-price">价格（元）</label>
              <div className="entry-stepper">
                <button type="button" aria-label="价格减 0.01 元" disabled={busy || enteredPrice === undefined || enteredPrice <= 1}
                  onClick={() => { if (enteredPrice !== undefined) setValue(((enteredPrice - 1) / 100).toFixed(2)); }}>−</button>
                <input id="watch-price" value={value ?? ''} onChange={event => setValue(event.target.value)} required disabled={busy} inputMode="decimal" />
                <button type="button" aria-label="价格加 0.01 元" disabled={busy || enteredPrice === Number.MAX_SAFE_INTEGER}
                  onClick={() => setValue((((enteredPrice ?? 0) + 1) / 100).toFixed(2))}>＋</button>
              </div>
            </div>}
            {!addMode && <>
              <div className="watch-input">
                <label htmlFor="watch-quantity">数量（股）</label>
                <div className="entry-stepper">
                  <button type="button" aria-label="减少100股" disabled={busy || !enteredShares || enteredShares <= shareStep}
                    onClick={() => setQuantity(String(enteredShares! - shareStep))}>−100</button>
                  <input id="watch-quantity" value={quantity} onChange={event => setQuantity(event.target.value)} required disabled={busy} inputMode="numeric" />
                  <button type="button" aria-label="增加100股" disabled={busy || (enteredShares ?? 0) > Number.MAX_SAFE_INTEGER - shareStep}
                    onClick={() => setQuantity(String((enteredShares ?? 0) + shareStep))}>+100</button>
                </div>
              </div>
              <div className="quick-amounts" role="group" aria-label="按目标金额换算股数">
                {quickAmounts.map(target => <button key={target} type="button" disabled={busy || enteredPrice === undefined}
                  onClick={() => { if (enteredPrice !== undefined) setQuantity(String(sharesForAmount(target * 100, enteredPrice))); }}>
                  ¥{number.format(target)}
                </button>)}
              </div>
              <div className="estimate-amount"><span>预计成交金额</span><strong>{amount !== undefined && Number.isSafeInteger(amount) ? money(amount) : '—'}</strong></div>
            </>}
            {sellMode && <SellPreview
              buys={sellLots}
              value={value ?? ''} quantity={quantity} />}
            {error && <p className="form-message sync-message" role="alert">{error}</p>}
          </>}
        </div>
        {stockDetail ? <div className="editor-footer stock-actions">
          <button type="button" className="danger" disabled={busy}
            onClick={async () => { if (await remove({ ...stockDetail, name: editorQuote?.name ?? stockDetail.name })) dialog.current?.close(); }}>删除股票</button>
          <button type="button" className="danger" disabled={busy || !transactionCount}
            onClick={async () => { if (await endCycle({ ...stockDetail, name: editorQuote?.name ?? stockDetail.name })) dialog.current?.close(); }}>结束周期</button>
        </div>
          : detail ? detail.tradeIndex !== undefined && detail.tradeIndex >= 0 && <div className="editor-footer">
            <button type="button" className="danger wide" disabled={busy} onClick={async () => {
              if (await removeTrade(detail.stock.id, detail.tradeIndex!, { ...detail.entry, kind: detail.kind })) dialog.current?.close();
            }}>删除这笔</button>
          </div> : <div className="editor-footer"><button className="primary wide" disabled={busy}>保存</button></div>}
      </form>}
    </dialog>
  </>;
}
