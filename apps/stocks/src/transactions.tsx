import { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { activeCycle, cycleResult, remainingPosition, sum, tradePrices, type Ledger, type OrderKind, type TradePrice } from './domain.ts';
import { money, tradeDateLabel } from './format.ts';
import { symbolFor, type Quote } from './quotes.ts';

function ProfitMetric({ label, value }: { label: string; value: number | undefined }) {
  const tone = value === undefined || value === 0 ? '' : value > 0 ? 'gain' : 'loss';
  return <div><dt>{label}</dt><dd className={tone}>
    {value === undefined ? '—' : (value > 0 ? '+' : '') + money(value)}
  </dd></div>;
}

function PositionSummary({ holdings, quotes, filtered }: {
  holdings: { stock: Ledger['stocks'][number]; history: ReturnType<typeof tradePrices> }[];
  quotes: Map<string, Quote>;
  filtered: boolean;
}) {
  let quantity: number | undefined;
  let profit: number | undefined;
  let realized: number | undefined;
  let issue = '';
  let skipped = false;
  try {
    const positions = holdings.map(({ stock, history }) => ({
      position: remainingPosition(history), quote: quotes.get(symbolFor(stock)),
    }));
    skipped = positions.some(({ position }) => position.skipped);
    quantity = sum(positions.map(({ position }) => position.quantity));
    realized = sum(positions.map(({ position }) => position.realized));
    if (positions.some(({ position, quote }) => position.quantity > 0 && !quote)) {
      issue = '持仓股票中有暂无最新价的，暂无法计算浮动盈亏。';
    } else {
      profit = sum(positions.map(({ position, quote }) => sum([
        position.quantity * (quote?.price ?? 0), -position.cost,
      ])));
    }
  } catch {
    issue = '金额或股数超出可计算范围。';
  }

  return <section className="panel position-summary" aria-label="持仓统计">
    <h2>持仓统计</h2>
    <dl>
      <div><dt>未卖出股数</dt><dd>{quantity === undefined ? '—' : quantity.toLocaleString('zh-CN') + ' 股'}</dd></div>
      <ProfitMetric label="浮动盈亏" value={profit} />
      <ProfitMetric label="已实现盈亏" value={realized} />
    </dl>
    <p className="muted">{issue || '卖出优先扣减最低买价。浮动盈亏按最新价估算，已实现盈亏按成交价计算。两者均未扣手续费。'}</p>
    {skipped && <p className="muted">缺少股数的记录和超出已记录买入的卖出股数已跳过。</p>}
    {filtered && <p className="muted">买卖方向只筛选下方列表，持仓按全部买卖计算。</p>}
  </section>;
}

export function Transactions({ ledger, quotes, busy, removeTrade }: {
  ledger: Ledger; quotes: Map<string, Quote>; busy: boolean;
  removeTrade: (stockId: string, index: number, entry: TradePrice) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<OrderKind | ''>('');
  const [stockId, setStockId] = useState('');
  const holdings = ledger.stocks.filter(stock => !stockId || stock.id === stockId)
    .map(stock => ({ stock, history: tradePrices(stock, ledger.orders) }));
  const trades = holdings.flatMap(({ stock, history }) => history.map((entry, index) => ({ stock, entry, index })))
    .filter(({ entry }) => !kind || entry.kind === kind)
    .sort((a, b) => b.entry.time.localeCompare(a.entry.time));

  return <>
    <div className="trade-filters">
      <div className="trade-filter-row" role="group" aria-label="按股票筛选">
        <button type="button" aria-pressed={!stockId} onClick={() => setStockId('')}>全部股票</button>
        {ledger.stocks.map(stock => <button type="button" key={stock.id} aria-pressed={stock.id === stockId}
          onClick={() => setStockId(stock.id)}>{quotes.get(symbolFor(stock))?.name ?? stock.name}</button>)}
      </div>
      <div className="trade-filter-row" role="group" aria-label="按买卖方向筛选">
        {([
          { id: '', label: '全部交易' },
          { id: 'buy', label: '买入' },
          { id: 'sell', label: '卖出' },
        ] as const).map(option => <button type="button" key={option.id} aria-pressed={kind === option.id}
          onClick={() => setKind(option.id)}>{option.label}</button>)}
      </div>
    </div>
    <PositionSummary holdings={holdings} quotes={quotes} filtered={!!kind} />
    {trades.length ? <ul className="panel trade-list editable-trades">
      {trades.map(({ stock, entry, index }) => <li key={stock.id + ':' + index}>
        <span className={'trade-badge ' + entry.kind}>{entry.kind === 'buy' ? '买入' : '卖出'}</span>
        <div><strong>{quotes.get(symbolFor(stock))?.name ?? stock.name}</strong><span className="muted">{stock.code} · {tradeDateLabel(entry.time)}</span></div>
        <div className="trade-amount"><strong>{money(entry.price)}</strong>
          {entry.quantity !== undefined && <span className="muted">{entry.quantity.toLocaleString('zh-CN')} 股</span>}
        </div>
        <button type="button" className="icon-button danger" aria-label={'删除这笔' + (entry.kind === 'buy' ? '买入' : '卖出')}
          disabled={busy} onClick={() => void removeTrade(stock.id, index, entry)}><Trash2 size={16} /></button>
      </li>)}
    </ul> : <section className="panel empty"><h2>暂无交易记录</h2></section>}
  </>;
}

type CycleEntry = {
  name: string;
  code: string;
  key: string;
  time: string;
  history: TradePrice[];
  active: boolean;
  result?: ReturnType<typeof cycleResult>;
};

function cycleTotal(entries: CycleEntry[]): number | undefined {
  if (!entries.some(entry => entry.result?.matched) || entries.some(entry => !entry.result)) return;
  try {
    return sum(entries.map(entry => entry.result!.realized));
  } catch {
    return undefined;
  }
}

function CycleGroup({ title, entries }: { title: string; entries: CycleEntry[] }) {
  if (!entries.length) return null;
  return <section className="cycle-group" aria-label={title}>
    <div className="cycle-group-heading"><h2>{title}</h2><span className="muted">{entries.length} 个周期</span></div>
    {entries.map(({ name, code, key, time, history, active, result }) => <details className="panel cycle-card" key={key}>
      <summary>
        <div className="cycle-card-identity">
          <strong>{name}</strong>
          <span className="muted">{code}{active ? '' : ' · 结束于 ' + tradeDateLabel(time)}</span>
        </div>
        <dl><ProfitMetric label="配对收益" value={result?.matched ? result.realized : undefined} /></dl>
        <ChevronDown size={17} className="cycle-chevron" aria-hidden="true" />
        <div className="cycle-card-stats">
          <span>{history.length} 笔交易</span>
          {result ? <>
            <span>已配对 {result.matched.toLocaleString('zh-CN')} 股</span>
            {result.unmatchedKind && <span>未配对{result.unmatchedKind === 'buy' ? '买入' : '卖出'} {result.unmatched.toLocaleString('zh-CN')} 股</span>}
          </> : <span>金额或股数超出可计算范围</span>}
        </div>
      </summary>
      {result?.skipped && <p className="muted">缺少股数的记录未计入收益。</p>}
      <ul className="cycle-records">
        {history.map((trade, index) => <li key={index}>
          <span><span className={'trade-badge ' + trade.kind}>{trade.kind === 'buy' ? '买入' : '卖出'}</span> <time className="muted" dateTime={trade.time}>{tradeDateLabel(trade.time)}</time></span>
          <strong>{money(trade.price)}{trade.quantity === undefined ? '' : ' · ' + trade.quantity.toLocaleString('zh-CN') + ' 股'}</strong>
        </li>)}
      </ul>
    </details>)}
  </section>;
}

export function Cycles({ ledger, quotes }: { ledger: Ledger; quotes: Map<string, Quote> }) {
  const entries: CycleEntry[] = ledger.stocks.flatMap(stock => {
    const history = tradePrices(stock, ledger.orders);
    const name = quotes.get(symbolFor(stock))?.name ?? stock.name;
    const active = activeCycle(stock, history);
    const current = active.length ? [{ key: stock.id, time: active[0].time, history: active, active: true }] : [];
    let end = history.length;
    const ended = (stock.cycles ?? []).map((cycle, index) => {
      const start = end - cycle.count;
      const records = history.slice(start, end);
      end = start;
      return { key: stock.id + ':' + index, time: cycle.endedAt, history: records, active: false };
    });
    return [...current, ...ended].map(entry => {
      let result: CycleEntry['result'];
      try { result = cycleResult(entry.history); } catch { /* Keep the cycle visible when its totals overflow. */ }
      return { ...entry, name, code: stock.code, result };
    });
  }).sort((a, b) => b.time.localeCompare(a.time));

  const active = entries.filter(entry => entry.active);
  const ended = entries.filter(entry => !entry.active);
  const legacy = ledger.stocks.flatMap(stock => (stock.closed ?? []).map((summary, index) => ({
    summary, key: stock.id + ':' + index, name: quotes.get(symbolFor(stock))?.name ?? stock.name,
  })));

  return <>
    <section className="panel cycle-overview" aria-label="周期收益汇总">
      <h2>周期收益汇总</h2>
      <dl>
        <ProfitMetric label="已结束周期收益" value={cycleTotal(ended)} />
        <ProfitMetric label="进行中已配对收益" value={cycleTotal(active)} />
      </dl>
      <p className="muted">按周期内已配对的买卖价差计算，未扣手续费。</p>
    </section>
    <CycleGroup title="进行中" entries={active} />
    <CycleGroup title="已结束" entries={ended} />
    {!entries.length && !legacy.length && <section className="panel empty"><h2>暂无做 T 周期</h2></section>}
    {legacy.length > 0 && <section className="panel">
      <h2>旧版清仓汇总</h2>
      <ul className="cycle-records">
        {legacy.map(({ summary, key, name }) => <li key={key}>
          <span>{name} · {tradeDateLabel(summary.time)}</span>
          <dl><ProfitMetric label="已实现盈亏" value={summary.realized} /></dl>
        </li>)}
      </ul>
    </section>}
  </>;
}
