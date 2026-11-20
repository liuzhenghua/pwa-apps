import { useId, useState, type FormEvent } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import {
  amountOf, breakEven, calculateSale, cents, eligibleLots, estimateFees, feeFields, feeTotal,
  shares, sum, type Buy, type Fees, type Fill, type Lot, type OrderKind, type Profile, type Sale, type Stock,
} from './domain.ts';
import { count, localDate, localTime, money, priceInput, rateLabel, tone } from './format.ts';

export const feeLabels = {
  commission: '佣金', stamp: '印花税', transfer: '过户费', regulatory: '经手费及证管费', other: '其他费用',
};

export function FeesList({ fees }: { fees: Fees }) {
  return <dl className="lines">{feeFields.map(field =>
    <div key={field}><dt>{feeLabels[field]}</dt><dd>{money(fees[field])}</dd></div>
  )}</dl>;
}

export function SaleMatches({ sale }: { sale: Sale }) {
  return <div className="table-scroll"><table>
    <thead><tr><th>买入日期 / 价格</th><th>匹配股数</th><th>买入金额</th><th>卖出金额</th><th>价差收益</th></tr></thead>
    <tbody>{sale.matches.map(match => <tr key={match.lotId}>
      <td><strong>{money(match.price)}</strong><small>{localDate(new Date(match.time))}</small></td>
      <td>{count(match.quantity)}</td><td>{money(match.buyAmount)}</td>
      <td>{money(match.sellAmount)}</td><td className={tone(match.gross)}>{money(match.gross, true)}</td>
    </tr>)}</tbody>
  </table></div>;
}

type FillInput = { id: string; price: string; quantity: string };
type Draft = {
  time: string;
  fills: Fill[];
  fees: Fees;
  feeSource: 'actual' | 'estimated';
  note: string;
};
type Props = {
  stock: Stock;
  lots: Lot[];
  kind: OrderKind;
  profile: Profile;
  busy: boolean;
  purchase?: Buy;
  save: (draft: Draft) => void;
};

export function OrderEditor({ stock, lots, kind, profile, busy, purchase, save }: Props) {
  const editorId = useId();
  const buying = kind === 'buy';
  const [register, setRegister] = useState(buying);
  const [date, setDate] = useState(() => purchase ? localDate(new Date(purchase.time)) : buying ? localDate() : localTime());
  const [inputs, setInputs] = useState<FillInput[]>(() => purchase ? purchase.fills.map((fill, index) => ({
    id: String(index), price: priceInput(fill.price), quantity: String(fill.quantity),
  })) : [{
    id: 'first', price: priceInput(stock.price),
    quantity: kind === 'sell' ? String(Math.min(100, sum(eligibleLots(lots, stock.id, new Date().toISOString()).map(lot => lot.remaining))) || '') : '',
  }]);
  const [custom, setCustom] = useState(purchase?.feeSource === 'actual');
  const [manual, setManual] = useState<Record<keyof Fees, string> | undefined>(() => purchase
    ? Object.fromEntries(feeFields.map(field => [field, priceInput(purchase.fees[field])])) as Record<keyof Fees, string>
    : undefined);
  const [note, setNote] = useState(purchase?.note ?? '');
  const dateInput = purchase && date === localDate(new Date(purchase.time))
    ? purchase.time : buying ? date + 'T00:00:00' : date;
  const time = register ? new Date(dateInput).getTime() : Date.now();
  const iso = Number.isFinite(time) ? new Date(time).toISOString() : '';
  const eligible = eligibleLots(lots, stock.id, iso);
  const available = sum(eligible.map(lot => lot.remaining));
  const stockQuantity = sum(lots.filter(lot => lot.stockId === stock.id).map(lot => lot.remaining));
  let draft: Draft | undefined;
  let sale: Sale | undefined;
  let floor: number | undefined;
  let estimate: Fees | undefined;
  let problem = '';
  try {
    if (!iso) throw Error(buying ? '请输入有效的成交日期' : '请输入有效的成交时间');
    if (register && time > Date.now()) throw Error(buying ? '成交日期不能晚于今天' : '成交时间不能晚于现在');
    const fills = inputs.map(input => ({ price: cents(input.price), quantity: shares(input.quantity) }));
    estimate = estimateFees(amountOf(fills), profile, kind);
    const fees = { ...estimate };
    if (custom && manual) {
      for (const field of feeFields) fees[field] = cents(manual[field], true);
    }
    if (kind === 'sell') {
      sale = calculateSale(eligible, fills, fees);
      sum([feeTotal(sale.buyFees), feeTotal(sale.fees)]);
      floor = breakEven(sale.quantity, sale.basis, profile, custom ? fees : undefined);
    }
    draft = { time: iso, fills, fees, feeSource: custom ? 'actual' : 'estimated', note: note.trim() };
  } catch (error) {
    problem = error instanceof Error ? error.message : '无法计算此订单';
  }

  function patchFill(id: string, patch: Partial<FillInput>) {
    setInputs(current => current.map(input => input.id === id ? { ...input, ...patch } : input));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (register && draft && !busy) save(draft);
  }

  return <form className="order-layout" onSubmit={submit}>
    <section className="panel order-parameters">
      {!buying && <div className="section-title">
        <h2>{register ? '实际卖出订单' : '卖出参数'}</h2>
        <span className="muted">可卖 {count(available)} 股</span>
      </div>}
      <fieldset disabled={busy}>
        {register && <label>{buying ? '成交日期' : '成交时间'}<input type={buying ? 'date' : 'datetime-local'} max={buying ? localDate() : undefined} value={date} onChange={event => setDate(event.target.value)} required /></label>}
        {inputs.map((input, index) => <div className="fill" key={input.id}>
          <label>{inputs.length > 1 ? '成交 ' + (index + 1) + ' 单价' : kind === 'buy' ? '买入单价（元）' : '卖出单价（元）'}
            <input inputMode="decimal" value={input.price} onChange={event => patchFill(input.id, { price: event.target.value })} />
          </label>
          <div className="field-label">
            <label htmlFor={editorId + input.id}>成交股数</label>
            <div className="stepper">
              {kind === 'sell' && inputs.length === 1 && <button type="button" aria-label="减少股数" onClick={() => patchFill(input.id, { quantity: String(Math.max(1, (Number(input.quantity) || 0) - 100)) })}><Minus size={16} /></button>}
              <input id={editorId + input.id} inputMode="numeric" value={input.quantity} onChange={event => patchFill(input.id, { quantity: event.target.value })} />
              {kind === 'sell' && inputs.length === 1 && <button type="button" aria-label="增加股数" disabled={available === 0} onClick={() => patchFill(input.id, { quantity: String(Math.min(available, (Number(input.quantity) || 0) + 100)) })}><Plus size={16} /></button>}
            </div>
          </div>
          {inputs.length > 1 && <button className="icon-button" type="button" aria-label={'移除成交 ' + (index + 1)} onClick={() => setInputs(current => current.filter(row => row.id !== input.id))}><Trash2 size={16} /></button>}
        </div>)}
        {kind === 'sell' && inputs.length === 1 && <div className="quick-choices">
          {[100, 200, 300, 500].map(quantity => <button type="button" key={quantity} disabled={quantity > available} className={inputs[0].quantity === String(quantity) ? 'selected' : ''} onClick={() => patchFill(inputs[0].id, { quantity: String(quantity) })}>{quantity} 股</button>)}
          <button type="button" disabled={!available} onClick={() => patchFill(inputs[0].id, { quantity: String(available) })}>全部</button>
        </div>}
        {register && <>
          <button className="link-button" type="button" onClick={() => setInputs(current => [...current, { id: crypto.randomUUID(), price: current.at(-1)?.price ?? '', quantity: '' }])}><Plus size={16} /> 添加同一委托的分笔成交</button>
          <label className="checkbox"><input type="checkbox" checked={custom} disabled={!custom && !estimate} onChange={event => {
            const checked = event.target.checked;
            if (checked && estimate) setManual(Object.fromEntries(feeFields.map(field => [field, priceInput(estimate![field])])) as Record<keyof Fees, string>);
            setCustom(checked);
          }} />按交割单填写实际费用</label>
          {custom && manual && <div className="fields">{feeFields.map(field => <label key={field}>{feeLabels[field]}（元）<input inputMode="decimal" value={manual[field]} onChange={event => setManual({ ...manual, [field]: event.target.value })} /></label>)}</div>}
          <label>备注（选填）<textarea rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
        </>}
      </fieldset>
      {problem && <p className="form-message" role="status">{problem}</p>}
      {kind === 'buy' && draft && <details className="disclosure"><summary>买入金额 {money(amountOf(draft.fills))} · 费用 {money(feeTotal(draft.fees))}</summary><FeesList fees={draft.fees} /></details>}
      {kind === 'buy' && <button className="primary wide" disabled={!draft || busy}>保存买入</button>}
    </section>
    {kind === 'sell' && <div className="order-result" aria-live="polite">
      {sale && floor !== undefined ? <>
        <section className="panel result-card">
          <div className="muted">{register && custom ? '本次到账' : '预计到账'}</div>
          <div className="result-number">{money(sale.proceeds)}</div>
          <dl className="result-metrics">
            <div><dt>净收益 / 收益率</dt><dd className={tone(sale.net)}>{money(sale.net, true)} <small>{rateLabel(sale.netRate)}</small></dd></div>
            <div><dt>保本卖出价</dt><dd>{money(floor)} <small>/ 股</small></dd></div>
            <div><dt>卖出后剩余</dt><dd>{count(stockQuantity - sale.quantity)} <small>股</small></dd></div>
          </dl>
          <details className="disclosure">
            <summary>卖出费用 {money(feeTotal(sale.fees))}</summary>
            <p className="muted">成交金额 {money(sale.sellAmount)}，扣除以下费用后到账。</p>
            <FeesList fees={sale.fees} />
          </details>
        </section>
        <section className="panel">
          <details className="disclosure match-disclosure">
            <summary>匹配批次 · {count(sale.matches.length)} 笔</summary>
            <p className="muted">最低买入价优先</p>
            <SaleMatches sale={sale} />
          </details>
        </section>
      </> : <section className="panel empty-result">输入有效的卖出价格和股数后查看收益。</section>}
      {register ? <div className="actions">
        <button type="button" disabled={busy} onClick={() => {
          setRegister(false);
          setCustom(false);
          setInputs(current => current.slice(0, 1));
        }}>返回测算</button>
        <button className="primary" disabled={!draft || busy}>确认登记卖出</button>
      </div> : <button type="button" className="primary wide" disabled={!draft || busy} onClick={() => { setDate(localTime()); setRegister(true); }}>登记实际卖出</button>}
    </div>}
  </form>;
}
