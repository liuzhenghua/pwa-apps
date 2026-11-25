import { useState } from 'react';
import { cents, percent, type OrderKind } from './domain.ts';
import { money } from './format.ts';
import type { Quote } from './quotes.ts';

export type AlertPriceContext = {
  quote?: Quote;
  lastBuy?: number;
  lastSell?: number;
  position?: { quantity: number; cost: number; highestBuy: number };
};

const adjustmentStep = 50;
const basisLabels = { current: '当前价', highestBuy: '剩余最高买价', buy: '最近买价', sell: '最近卖价', average: '周期剩余均价' } as const;
type Basis = keyof typeof basisLabels;

function adjustment(value: string) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return;
  const points = Math.round(Number(value) * 100);
  return Number.isSafeInteger(points) ? points : undefined;
}
const shareCount = new Intl.NumberFormat('zh-CN');

function triggerPrice(value: string) {
  try { return cents(value); } catch { return undefined; }
}

function signedPercent(value: number) {
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

export function AlertPriceForm({ kind, price, setPrice, context }: {
  kind: OrderKind;
  price: string;
  setPrice: (price: string) => void;
  context?: AlertPriceContext;
}) {
  const [basis, setBasis] = useState<{ key: Basis; price: number }>();
  const [change, setChange] = useState('1');
  const buy = kind === 'buy';
  const { quote, lastBuy, lastSell, position } = context ?? {};
  const target = triggerPrice(price);
  const delta = quote && target !== undefined ? percent(target - quote.price, quote.price) : undefined;
  const reached = delta !== undefined && (buy ? delta >= 0 : delta <= 0);
  const profit = !buy && position && target !== undefined ? target * position.quantity - position.cost : undefined;

  const bases = [
    { key: buy ? 'current' : 'highestBuy', price: buy ? quote?.price : position?.highestBuy },
    { key: 'buy', price: lastBuy },
    { key: 'sell', price: lastSell },
    { key: 'average', price: position && position.cost / position.quantity },
  ] as const;
  const points = adjustment(change);
  const maximum = buy ? 9_999 : Number.MAX_SAFE_INTEGER;
  const validChange = points !== undefined && points <= maximum;

  function calculate(base: number, value: string) {
    const next = adjustment(value);
    if (next === undefined || next > maximum) return setPrice('');
    const raw = base * (10_000 + (buy ? -next : next)) / 10_000;
    const rounded = buy ? Math.floor(raw + 1e-8) : Math.ceil(raw - 1e-8);
    setPrice(Number.isSafeInteger(rounded) && rounded > 0 ? (rounded / 100).toFixed(2) : '');
  }

  function changeBy(delta: number) {
    const next = Math.min(maximum, Math.max(0, (points ?? 0) + delta));
    const value = String(next / 100);
    setChange(value);
    if (basis) calculate(basis.price, value);
  }

  return <>
    {context && <div className="alert-price-quote">
      <div><span className="muted">最新价</span><strong>{quote ? money(quote.price) : '暂无行情'}</strong></div>
      {quote?.previousClose && <span className="muted">当日 {signedPercent(percent(quote.price - quote.previousClose, quote.previousClose))}</span>}
    </div>}
    {bases.some(basis => basis.price !== undefined) && <fieldset className="alert-bases">
      <legend>价格基准</legend>
      <div className="alert-basis-options">
        {bases.map(({ key, price: available }) => {
          const selected = basis?.key === key;
          const displayed = selected ? basis.price : available;
          return <button key={key} type="button" disabled={!available} aria-pressed={selected}
            onClick={() => {
              if (!available) return;
              setBasis({ key, price: available });
              calculate(available, change);
            }}>
            <span>{basisLabels[key]}</span>
            <strong>{displayed === undefined ? '—' : money(Math.round(displayed))}</strong>
          </button>;
        })}
      </div>
      <label className="alert-adjustment-label" htmlFor="alert-adjustment">{buy ? '跌幅' : '涨幅'}</label>
      <div className="entry-stepper alert-adjustment">
        <button type="button" aria-label="减少 0.5 个百分点" disabled={points === 0} onClick={() => changeBy(-adjustmentStep)}>−</button>
        <div>
          <input id="alert-adjustment" value={change} inputMode="decimal" aria-invalid={!validChange}
            onChange={event => {
              const value = event.target.value;
              setChange(value);
              if (basis) calculate(basis.price, value);
            }} />
          <span aria-hidden="true">%</span>
        </div>
        <button type="button" aria-label="增加 0.5 个百分点" disabled={points === maximum} onClick={() => changeBy(adjustmentStep)}>＋</button>
      </div>
    </fieldset>}
    <label className="watch-input">提醒价（元）
      <input value={price} onChange={event => { setBasis(undefined); setPrice(event.target.value); }} inputMode="decimal" required />
    </label>
    <div className="alert-price-preview" aria-live="polite">
      <p className="muted">股价{buy ? '跌至或低于' : '涨至或高于'}{target === undefined ? '提醒价' : money(target)}时通知{delta === undefined ? '。' : '，较最新价 ' + signedPercent(delta) + '。'}</p>
      {reached && <p className="muted">最新价已达到条件，下次检查有效行情时可能触发。</p>}
      {position && profit !== undefined && Number.isSafeInteger(profit) && <p>按提醒价卖出 {shareCount.format(position.quantity)} 股预计 <strong className={profit > 0 ? 'gain' : profit < 0 ? 'loss' : ''}>{profit > 0 ? '+' : ''}{money(profit)}（{signedPercent(percent(profit, position.cost))}）</strong>，未扣手续费。</p>}
    </div>
  </>;
}
