import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Bell, ChevronRight, Info, Plus, RefreshCw } from 'lucide-react';
import { AlertManager } from './alert-sheet.tsx';
import type { AlertCloud } from './alert-cloud.ts';
import { activeCycle, cents, compareSellPrice, cycleResult, boughtAfterSell, buyObservationMatches, defaultObservationRules, latestTrade, percent, recentPrices, sellObservation, sellObservationConditions, sum, shares, sharesForAmount, shareStep, sameTrade, tradePrices, type Ledger, type ObservationRules, type OrderKind, type PriceRecord, type Stock, type TradePrice } from './domain.ts';
import { money, tradeDateLabel } from './format.ts';
import { symbolFor, useQuotes, type Quote } from './quotes.ts';

const quickAmounts = [5_000, 10_000, 15_000, 20_000];
const number = new Intl.NumberFormat('zh-CN');
const sideLabels = { buy: '买', sell: '卖' };
const cycleTradeDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
});
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
  alertCloud: AlertCloud;
};

function isBackdropPress(event: MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
}

type CycleEntry = { trade: TradePrice; sideIndex: number };

function CycleTradeList({ entries, open, label }: {
  entries: CycleEntry[];
  open: (entry: CycleEntry) => void;
  label: string;
}) {
  return <ol className="cycle-trades" aria-label={label}>
    {entries.map(entry => {
      const { trade, sideIndex } = entry;
      const side = trade.kind === 'buy' ? '买入' : '卖出';
      return <li key={trade.kind + sideIndex}><button type="button" className="cycle-trade-row"
        aria-label={side + '第 ' + (sideIndex + 1) + ' 笔详情'} onClick={() => open(entry)}>
        <span className={'entry-label ' + trade.kind}>{side}</span>
        <strong>{money(trade.price)}</strong>
        <span className="muted">{trade.quantity === undefined ? '股数未知' : number.format(trade.quantity) + ' 股'}</span>
        <time className="muted" dateTime={trade.time} title={tradeDateLabel(trade.time)}>{cycleTradeDate.format(new Date(trade.time))}</time>
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

function latestRecordedTrade(history: TradePrice[], kind: OrderKind, cached?: PriceRecord) {
  const loaded = latestTrade(history, kind);
  return loaded && (!cached || Date.parse(loaded.time) >= Date.parse(cached.time)) ? loaded : cached;
}

function cycleDecision(history: TradePrice[], quote: Quote | undefined, buyObservation: boolean, rules: ObservationRules) {
  if (!history.length) return;
  try {
    const result = cycleResult(history);
    const quantity = result.unmatchedKind === 'buy' ? result.unmatched : 0;
    if (!quote) return { result, quantity };

    const profit = quantity ? sum([quote.price * quantity, -result.remainingBuyCost]) : undefined;
    const profitRate = profit === undefined ? undefined : percent(profit, result.remainingBuyCost);
    const sellSignal = sellObservation(result, quote.price, rules);
    return {
      result, quantity, profit, profitRate,
      buyObservation, sellObservation: !!sellSignal,
    };
  } catch {
    return;
  }
}

type ObservationRow = {
  action: string; basis: string; quantity?: number; rate: number; totalChange?: number; matched: boolean; boughtAfterSell?: boolean;
};

function comparisonRate(row: ObservationRow) {
  const change = row.totalChange || row.rate;
  if (!change) return { text: '持平', tone: undefined };
  const higher = change > 0;
  const buy = row.action === '买';
  const direction = buy ? (higher ? '贵' : '省') : (higher ? '多' : '少');
  return {
    text: direction + ' ' + Math.abs(row.rate).toFixed(2) + '%',
    tone: higher !== buy ? 'gain' : 'loss',
  };
}

function buyComparisonRow(price: number, trade: PriceRecord, basis: string, matched = false): ObservationRow {
  const difference = price - trade.price;
  return {
    action: '买', basis, quantity: trade.quantity, rate: percent(difference, trade.price),
    totalChange: trade.quantity === undefined ? undefined : difference * trade.quantity, matched,
  };
}

function ObservationRows({ rows }: { rows: ObservationRow[] }) {
  if (!rows.length) return null;
  return <span className="overview-rules">
    {rows.map(row => {
      const { text, tone } = comparisonRate(row);
      return <span className={'overview-rule' + (row.matched ? ' matched' : '')} key={row.action + row.basis}>
        <span className="overview-rule-action">{row.boughtAfterSell ? '卖出后已买入' : row.action + ' ' + (row.quantity === undefined ? '股数未知' : number.format(row.quantity) + ' 股')}</span>
        <span className="overview-rule-basis">较{row.basis}</span>
        <strong className={tone}>
          {row.matched && <span className="sr-only">已达标 </span>}
          {text}
          {row.totalChange !== undefined && row.totalChange !== 0 && Number.isSafeInteger(row.totalChange) && <span> · {money(Math.abs(row.totalChange))}</span>}
        </strong>
      </span>;
    })}
  </span>;
}

function observationRows(quote: Quote | undefined, buyRow: ObservationRow | undefined,
  decision: ReturnType<typeof cycleDecision>, rules: ObservationRules, recentTrade?: TradePrice): ObservationRow[] {
  if (!quote) return [];
  const price = quote.price;
  const rows = buyRow ? [buyRow] : [];
  if (decision?.quantity && decision.profitRate !== undefined && decision.profit !== undefined) {
    const conditions = sellObservationConditions(decision.result, price, rules);
    if (conditions) {
      const { lot, lowest, whole } = conditions;
      const sameSale = lot?.quantity === decision.quantity;
      const latestLot = recentTrade?.kind === 'buy' ? decision.result.remainingBuyLots.find(
        item => item.time === recentTrade.time && item.price === recentTrade.price,
      ) : undefined;
      const sellsAll = latestLot?.quantity === decision.quantity;
      if (latestLot) rows.unshift({
        action: '卖', basis: '最近成交（买）', quantity: latestLot.quantity,
        rate: percent(price - latestLot.price, latestLot.price), totalChange: (price - latestLot.price) * latestLot.quantity,
        matched: sellsAll ? !!decision.sellObservation : latestLot === lot && !!lowest,
      });
      if (!sellsAll) rows.push({ action: '全卖', basis: '剩余均价', quantity: decision.quantity, rate: decision.profitRate,
        totalChange: decision.profit, matched: sameSale ? !!decision.sellObservation : whole });
      if (lot && lot !== latestLot && !sameSale) rows.push({ action: '卖', basis: '剩余最低买价', quantity: lot.quantity,
        rate: percent(price - lot.price, lot.price), totalChange: (price - lot.price) * lot.quantity, matched: !!lowest });
    }
  }
  return rows;
}

function DecisionSignals({ decision, hasQuote, hasCycle, idleBuyObservation }: {
  decision?: ReturnType<typeof cycleDecision>;
  hasQuote: boolean;
  hasCycle: boolean;
  idleBuyObservation?: boolean;
}) {
  if (!hasQuote) return <span className="decision-label neutral">暂无行情</span>;
  const buy = decision?.buyObservation || idleBuyObservation;
  const sell = decision?.sellObservation;
  if (!buy && !sell) return <span className="decision-label neutral">{hasCycle && !decision ? '暂无法测算' : '观望'}</span>;
  return <>
    {sell && <span className="decision-label gain">卖出观察</span>}
    {buy && <span className="decision-label buy">买入观察</span>}
  </>;
}

function PositionIndicators(props: Parameters<typeof DecisionSignals>[0]) {
  const { decision, hasCycle } = props;
  return <>
    <span className="decision-quantity">{hasCycle && !decision
      ? '剩余股数未知' : '剩 ' + number.format(decision?.quantity ?? 0) + ' 股'}</span>
    <DecisionSignals {...props} />
  </>;
}

function CyclePosition({ decision, rows, hasQuote }: {
  decision: ReturnType<typeof cycleDecision>; rows: ObservationRow[]; hasQuote: boolean;
}) {
  return <div className="cycle-position">
    <span className="decision-title">
      <PositionIndicators decision={decision} hasQuote={hasQuote} hasCycle />
    </span>
    <ObservationRows rows={rows} />
  </div>;
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

export function Watchlist({ ledger, busy, add, record, endCycle, removeTrade, remove, market, alertCloud }: Props) {
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
  const lockEditor = busy && editor?.type !== 'stock' && editor?.type !== 'alerts';
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
    const dayChange = quote?.previousClose ? quote.price - quote.previousClose : undefined;
    const dayRate = quote?.previousClose && dayChange !== undefined ? percent(dayChange, quote.previousClose) : undefined;
    const dayTone = dayChange === undefined || dayChange === 0 ? '' : dayChange > 0 ? 'gain' : 'loss';
    const history = tradePrices(stock, ledger.orders);
    const cycle = activeCycle(stock, history);
    const recent = recentPrices(stock, ledger.orders);
    const lastRecordedBuy = latestRecordedTrade(history, 'buy', recent.buy[0]);
    const lastRecordedSell = latestRecordedTrade(history, 'sell', recent.sell[0]);
    const recentTrade = latestTrade(cycle);
    const reference = recentTrade ?? lastRecordedSell;
    const hasCycle = cycle.length > 0;
    const buyMatched = !!quote && buyObservationMatches(quote.price, reference, hasCycle, rules, lastRecordedBuy);
    const buyRow = quote && reference ? {
      ...buyComparisonRow(quote.price, reference, recentTrade ? '最近成交（' + sideLabels[recentTrade.kind] + '）' : '最近卖价', buyMatched),
      boughtAfterSell: !hasCycle && boughtAfterSell(reference, lastRecordedBuy),
    } : undefined;
    const decision = cycleDecision(cycle, quote, buyMatched, rules);
    const comparisons = observationRows(quote, buyRow, decision, rules, recentTrade);
    const primaryRows = recentTrade?.kind === 'buy' ? comparisons.filter(row => row !== buyRow) : comparisons;
    const primary = primaryRows[0];
    const oppositeTrade = recentTrade?.kind === 'buy' ? latestTrade(cycle, 'sell') : lastRecordedBuy;
    const supplement = quote && primary && oppositeTrade && (primary === buyRow || primary.basis.startsWith('最近成交'))
      ? {
        ...buyComparisonRow(quote.price, { ...oppositeTrade, quantity: primary.quantity },
          recentTrade?.kind === 'buy' ? '最近卖出' : '最近买入'),
        action: primary.action,
      }
      : undefined;
    const rows = supplement ? [primary, supplement, ...primaryRows.slice(1)] : primaryRows;
    const idleBuyObservation = !hasCycle && buyMatched;
    return {
      stock, symbol, quote, dayChange, dayRate, dayTone, history, cycle, rows, idleBuyObservation,
      name: quote?.name ?? stock.name,
      decision, lastRecordedBuy, lastRecordedSell,
    };
  });
  const alertCard = editor?.type === 'alerts' ? cards.find(card => card.stock.id === editor.stock.id) : undefined;
  const alertPosition = alertCard?.decision;
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
        {cards.map(({ stock, symbol, name, quote, dayRate, dayTone, decision, cycle, rows, idleBuyObservation }) => <li key={stock.id}>
          <button type="button" onClick={event => {
            const card = document.getElementById('holding-' + stock.id);
            card?.scrollIntoView({ block: 'start' });
            if (event.detail === 0) card?.focus({ preventScroll: true });
          }}>
            <span className="decision-overview-copy">
              <span className="decision-overview-heading">
                <span className="decision-title">
                  <strong>{name}</strong>
                  <PositionIndicators decision={decision} hasQuote={!!quote} hasCycle={!!cycle.length} idleBuyObservation={idleBuyObservation} />
                </span>
                {quote && <span className="decision-overview-quote">
                  {missing.has(symbol) && <span className="muted">上次报价</span>}
                  <strong className={dayTone} aria-label={(missing.has(symbol) ? '上次报价 ' : '最新价 ') + money(quote.price)}>{money(quote.price)}</strong>
                  {dayRate !== undefined && <span className={dayTone} aria-label={'当日涨跌幅 ' + signedRate(dayRate)}>{signedRate(dayRate)}</span>}
                </span>}
              </span>
              <ObservationRows rows={rows} />
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
      <p className="muted">各行百分比按对应参考价计算，未扣手续费。</p>
    </section>}
    <div className="stock-grid">
      {cards.map(({ stock, symbol, quote, dayChange, dayRate, dayTone, history, cycle, name, decision, rows, idleBuyObservation }) => {
        const lastEnded = stock.cycles?.at(-1);
        const counts = { buy: 0, sell: 0 };
        const trades = [...cycle].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
          .map(trade => ({ trade, sideIndex: counts[trade.kind]++ }));
        const openTrade = ({ trade, sideIndex }: CycleEntry) =>
          open({ type: 'detail', stock, kind: trade.kind, entry: trade, index: sideIndex });
        return <article className="panel watch-card" key={stock.id} id={'holding-' + stock.id} tabIndex={-1}>
          <div className="watch-heading">
            <div><h2>{name}</h2><p className="muted">{stock.market} · {stock.code}</p></div>
            <div className="watch-heading-actions">
              <button type="button" className="icon-button stock-detail-button" aria-label={name + '价格提醒'} title="价格提醒"
                onClick={() => open({ type: 'alerts', stock })}><Bell size={18} aria-hidden="true" /></button>
              <button type="button" className="icon-button stock-detail-button" aria-label={name + '详情'} title="股票详情"
                onClick={() => open({ type: 'stock', stock })}><Info size={18} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="watch-quote">
            <span className="muted">{quote && missing.has(symbol) ? '上次报价' : '最新价'}</span>
            <div className="watch-quote-values">
              <strong className={dayTone}>{quote ? money(quote.price) : '—'}</strong>
              {dayChange !== undefined && dayRate !== undefined && <span className={'watch-day-change ' + dayTone} aria-label={'当日涨跌 ' + signedMoney(dayChange) + ' ' + signedRate(dayRate)}>
                <span className="muted">当日</span><span>{signedMoney(dayChange)}</span><span>{signedRate(dayRate)}</span>
              </span>}
            </div>
            <span className="muted">{quote ? '腾讯财经 · ' + quoteTime.format(new Date(quote.time)) + (missing.has(symbol) ? ' · 更新失败' : '') : missing.has(symbol) ? '行情暂不可用' : '等待报价'}</span>
          </div>
          {cycle.length > 0 ? <>
            <CyclePosition decision={decision} rows={rows} hasQuote={!!quote} />
            <div className="cycle-trade-heading">
              <h3>本周期成交</h3>
              <span className="muted">买入 {counts.buy} 笔 · 卖出 {counts.sell} 笔</span>
            </div>
            <CycleTradeList entries={trades.slice(0, 6)} open={openTrade} label="本周期最近成交" />
            {trades.length > 6 && <details className="watch-cycle-more">
              <summary>展开更早的 {trades.length - 6} 笔成交</summary>
              <CycleTradeList entries={trades.slice(6)} open={openTrade} label="本周期更早成交" />
            </details>}
          </> : <>
            <p className="muted watch-cycle-count">暂无进行中的周期</p>
            {rows.length > 0 && <div className="cycle-position">
              <span className="decision-title">
                <PositionIndicators hasQuote={!!quote} hasCycle={false} idleBuyObservation={idleBuyObservation} />
              </span>
              <ObservationRows rows={rows} />
            </div>}
          </>}
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
      onClose={() => setEditor(undefined)} onCancel={event => { if (lockEditor) event.preventDefault(); }}
      onPointerDown={event => { pressedBackdrop.current = event.button === 0 && isBackdropPress(event); }}
      onClick={event => {
        const tappedBackdrop = pressedBackdrop.current && event.detail > 0 && isBackdropPress(event);
        pressedBackdrop.current = false;
        if (!addMode && !lockEditor && tappedBackdrop) event.currentTarget.close();
      }}>
      {editor?.type === 'alerts' ? <AlertManager cloud={alertCloud} stock={{ symbol: symbolFor(editor.stock), name: editorQuote?.name ?? editor.stock.name }}
        context={{
          quote: editorSymbol && !missing.has(editorSymbol) ? editorQuote : undefined,
          lastBuy: alertCard?.lastRecordedBuy?.price,
          lastSell: alertCard?.lastRecordedSell?.price,
          position: alertPosition?.quantity ? {
            quantity: alertPosition.quantity,
            cost: alertPosition.result.remainingBuyCost,
            highestBuy: alertPosition.result.remainingBuyLots.reduce((highest, lot) => Math.max(highest, lot.price), 0),
          } : undefined,
        }} close={() => dialog.current?.close()} />
        : editor && <form onSubmit={event => void submit(event)}>
        <div className="section-title editor-heading">
          <h2 id="watch-editor-title">{editor.type === 'add' ? '添加股票' : editor.type === 'stock' ? '股票详情' : detail ? sideLabels[detail.kind] + (detail.index + 1) + '详情' : '记录' + sideLabels[editor.kind] + '价'}</h2>
          <button type="button" disabled={lockEditor} onClick={() => dialog.current?.close()}>关闭</button>
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
