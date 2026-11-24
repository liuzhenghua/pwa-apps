import Decimal from 'decimal.js';

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
const decimal = (value: Decimal.Value) => new Exact(value);
export const feeFields = ['commission', 'stamp', 'transfer', 'regulatory', 'other'] as const;
export type Fees = Record<typeof feeFields[number], number>;
export type Profile = {
  commission: string;
  minimum: number;
  stamp: string;
  transfer: string;
  regulatory: string;
  other: string;
  includesRegulatory: boolean;
};
export type Fill = { price: number; quantity: number };
export type PriceRecord = { price: number; time: string; quantity?: number };
export type TradePrice = PriceRecord & { kind: OrderKind };
export type RecentPrices = Record<OrderKind, PriceRecord[]>;
export type ClosedSummary = { realized: number; time: string; skipped: boolean };
export type CycleBoundary = { count: number; endedAt: string; matching?: 'recent-buy' };
export type Stock = {
  id: string;
  code: string;
  name: string;
  market: '沪市' | '深市';
  price: number;
  priceUpdatedAt: string;
  recent?: RecentPrices;
  history?: TradePrice[];
  closed?: ClosedSummary[];
  cycles?: CycleBoundary[];
};
type Order = {
  id: string;
  stockId: string;
  time: string;
  fills: Fill[];
  fees: Fees;
  feeSource: 'actual' | 'estimated';
  profile: Profile;
  note: string;
};
export type Buy = Order & { kind: 'buy' };
export type Sell = Order & { kind: 'sell'; matches: Match[] };
export type RuleMatch = 'any' | 'all';
export type ObservationRules = {
  activeBuyDrop: number;
  idleBuyDrop: number;
  buyBelowAverage?: number;
  buyMatch: RuleMatch;
  sellAboveAverage: number;
  sellAboveLastBuy: number;
  sellMatch: RuleMatch;
};
export const defaultObservationRules: ObservationRules = {
  activeBuyDrop: 1, idleBuyDrop: 2, buyMatch: 'any',
  sellAboveAverage: 2, sellAboveLastBuy: 1, sellMatch: 'any',
};

export function validateObservationRules(rules: ObservationRules): ObservationRules {
  const thresholds = [rules.activeBuyDrop, rules.idleBuyDrop, rules.sellAboveAverage, rules.sellAboveLastBuy];
  if (rules.buyBelowAverage !== undefined) thresholds.push(rules.buyBelowAverage);
  if (thresholds.some(value => !Number.isFinite(value) || value <= 0 || value > 100)) throw Error('阈值须大于 0%，且不超过 100%');
  if (![rules.buyMatch, rules.sellMatch].every(match => match === 'any' || match === 'all')) throw Error('请选择条件组合方式');
  return rules;
}

export type Ledger = {
  version: 1;
  revision: string;
  stocks: Stock[];
  orders: (Buy | Sell)[];
  profile: Profile;
  observationRules?: ObservationRules;
};
export type Match = {
  lotId: string;
  time: string;
  price: number;
  quantity: number;
  buyAmount: number;
  buyFees: Fees;
  sellAmount: number;
  sellFee: number;
  gross: number;
  net: number;
};
export type Lot = {
  id: string;
  orderId: string;
  stockId: string;
  time: string;
  price: number;
  quantity: number;
  remaining: number;
  fees: Fees;
  remainingFees: Fees;
};
export const defaultProfile: Profile = {
  commission: '0.012', minimum: 500, stamp: '0.05', transfer: '0.001',
  regulatory: '0', other: '0', includesRegulatory: true,
};

export function emptyLedger(): Ledger {
  return { version: 1, revision: 'empty', stocks: [], orders: [], profile: { ...defaultProfile } };
}

export function safeInteger(value: number, message = '金额或股数超出支持范围'): number {
  if (!Number.isSafeInteger(value)) throw Error(message);
  return value;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => safeInteger(total + value), 0);
}

export function cents(value: string, allowZero = false): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw Error('金额需为非负数字，最多两位小数');
  const amount = safeInteger(decimal(value.trim()).times(100).toNumber());
  if (!allowZero && !amount) throw Error('价格必须大于零');
  return amount;
}

export function shares(value: string): number {
  const quantity = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(quantity) || quantity < 1) throw Error('股数必须是正整数');
  return quantity;
}

export const shareStep = 100;

export function sharesForAmount(amount: number, price: number): number {
  const lots = decimal(amount).div(price).div(shareStep).toDecimalPlaces(0).toNumber();
  return Math.max(1, lots) * shareStep;
}

export function amountOf(fills: Fill[]): number {
  return sum(fills.map(fill => safeInteger(fill.price * fill.quantity)));
}

export function feeTotal(fees: Fees): number {
  return sum(feeFields.map(field => fees[field]));
}

function feeMap(fn: (field: typeof feeFields[number]) => number): Fees {
  return { commission: fn('commission'), stamp: fn('stamp'), transfer: fn('transfer'), regulatory: fn('regulatory'), other: fn('other') };
}

export function validateProfile(profile: Profile): Profile {
  for (const field of feeFields) {
    if (typeof profile[field] !== 'string' || !/^\d+(\.\d{1,8})?$/.test(profile[field]) || decimal(profile[field]).gt(10)) {
      throw Error('费率以百分比输入，每项支持 0 至 10%，最多八位小数');
    }
  }
  nonnegative(profile.minimum);
  if (typeof profile.includesRegulatory !== 'boolean') throw Error('佣金配置无效');
  return { ...profile };
}

export function estimateFees(amount: number, profile: Profile, kind: OrderKind): Fees {
  const rate = (field: typeof feeFields[number]) => decimal(amount).times(profile[field]).div(100).toDecimalPlaces(0).toNumber();
  return {
    commission: Math.max(profile.minimum, rate('commission')),
    stamp: kind === 'sell' ? rate('stamp') : 0,
    transfer: rate('transfer'),
    regulatory: profile.includesRegulatory ? 0 : rate('regulatory'),
    other: rate('other'),
  };
}
export type OrderKind = 'buy' | 'sell';

function portion(amount: number, part: number, whole: number): number {
  return decimal(amount).times(part).div(whole).toDecimalPlaces(0).toNumber();
}

export function percent(value: number, basis: number): number {
  return basis ? decimal(value).times(100).div(basis).toDecimalPlaces(8).toNumber() : 0;
}

export function average(amount: number, quantity: number): string {
  return quantity ? decimal(amount).div(quantity).div(100).toFixed(4) : '—';
}

export function reachesBuyObservation(price: number, previousPrice: number, drop = 1): boolean {
  return decimal(price).times(100).lte(decimal(previousPrice).times(decimal(100).minus(drop)));
}

export function averageChange(beforeAmount: number, beforeShares: number, afterAmount: number, afterShares: number): number {
  return decimal(afterAmount).times(beforeShares).div(decimal(beforeAmount).times(afterShares))
    .minus(1).times(100).toDecimalPlaces(8).toNumber();
}

export function compareLots(a: Lot, b: Lot): number {
  return a.price - b.price || a.time.localeCompare(b.time);
}

export function eligibleLots(lots: Lot[], stockId: string, time: string): Lot[] {
  return lots.filter(lot => lot.stockId === stockId && lot.remaining > 0 && lot.time <= time).sort(compareLots);
}

function allocateBuyFees(lot: Lot, quantity: number): Fees {
  if (quantity === lot.remaining) return lot.remainingFees;
  const total = Math.min(feeTotal(lot.remainingFees), portion(feeTotal(lot.fees), quantity, lot.quantity));
  let original = 0;
  const fees = feeMap(field => {
    const previous = original;
    original += lot.fees[field];
    const rounded = portion(original, quantity, lot.quantity) - portion(previous, quantity, lot.quantity);
    return Math.min(lot.remainingFees[field], rounded);
  });

  // If an earlier sale depleted a fee category, assign any unallocated part
  // to categories that still have fees so the rounded total is preserved.
  let unallocated = total - feeTotal(fees);
  for (const field of feeFields) {
    if (!unallocated) break;
    const extra = Math.min(unallocated, lot.remainingFees[field] - fees[field]);
    fees[field] += extra;
    unallocated -= extra;
  }
  return fees;
}

export function calculateSale(lots: Lot[], fills: Fill[], fees: Fees) {
  const quantity = sum(fills.map(fill => fill.quantity));
  if (!quantity) throw Error('卖出股数必须大于零');
  const sellAmount = amountOf(fills);
  const sellFee = feeTotal(fees);
  let remaining = quantity;
  let matched = 0;
  const matches: Match[] = [];
  for (const lot of lots) {
    if (!remaining) break;
    const count = Math.min(remaining, lot.remaining);
    const buyAmount = safeInteger(count * lot.price);
    const buyFees = allocateBuyFees(lot, count);
    const allocatedSale = portion(sellAmount, matched + count, quantity) - portion(sellAmount, matched, quantity);
    const allocatedSellFee = portion(sellFee, matched + count, quantity) - portion(sellFee, matched, quantity);
    const gross = allocatedSale - buyAmount;
    matches.push({
      lotId: lot.id, time: lot.time, price: lot.price, quantity: count, buyAmount, buyFees,
      sellAmount: allocatedSale, sellFee: allocatedSellFee, gross,
      net: sum([gross, -feeTotal(buyFees), -allocatedSellFee]),
    });
    remaining -= count;
    matched += count;
  }
  if (remaining) throw Error('卖出数量超过该时间可使用的剩余持仓');
  const buyAmount = sum(matches.map(match => match.buyAmount));
  const buyFees = feeMap(field => sum(matches.map(match => match.buyFees[field])));
  const basis = sum([buyAmount, feeTotal(buyFees)]);
  const gross = sellAmount - buyAmount;
  const net = sum([sellAmount, -sellFee, -basis]);
  return {
    quantity, sellAmount, buyAmount, basis, buyFees, fees, matches, gross, net,
    grossRate: percent(gross, buyAmount), netRate: percent(net, basis),
  };
}

export type Sale = ReturnType<typeof calculateSale>;

export function breakEven(quantity: number, basis: number, profile: Profile, actualFees?: Fees): number {
  // Each percentage fee rounds independently. Net proceeds can drop by a few
  // cents at a fee boundary. Start at the unrounded lower bound with a
  // three-cent allowance, then scan upward for the first qualifying price.
  const rate = feeFields.filter(field => field !== 'commission' && (field !== 'regulatory' || !profile.includesRegulatory))
    .reduce((total, field) => total.plus(profile[field]), decimal(0)).div(100);
  const commissionRate = decimal(profile.commission).div(100);
  const threshold = actualFees
    ? decimal(basis).plus(feeTotal(actualFees))
    : Exact.max(
      decimal(basis).plus(profile.minimum).minus(3).div(decimal(1).minus(rate)),
      decimal(basis).minus(3).div(decimal(1).minus(rate).minus(commissionRate)),
    );
  let price = Math.max(1, safeInteger(threshold.div(quantity).ceil().toNumber()));
  for (;;) {
    const amount = safeInteger(price * quantity);
    const fees = actualFees ?? estimateFees(amount, profile, 'sell');
    if (amount - feeTotal(fees) >= basis) return price;
    price++;
  }
}

export function registerSale(ledger: Ledger, order: Order): Sell {
  const { lots } = project(ledger.orders);
  const sale = calculateSale(eligibleLots(lots, order.stockId, order.time), order.fills, order.fees);
  return { ...order, kind: 'sell', matches: sale.matches };
}

export function project(orders: Ledger['orders']) {
  const lots: Lot[] = [];
  const lotsById = new Map<string, Lot>();
  const sales = new Map<string, Sale>();
  for (const order of orders) {
    if (order.kind === 'buy') {
      const total = amountOf(order.fills);
      let previous = 0;
      order.fills.forEach((fill, index) => {
        const next = previous + amountOf([fill]);
        const fees = feeMap(field => portion(order.fees[field], next, total) - portion(order.fees[field], previous, total));
        const lot: Lot = {
          id: order.id + ':' + index, orderId: order.id, stockId: order.stockId, time: order.time,
          ...fill, remaining: fill.quantity, fees, remainingFees: fees,
        };
        lots.push(lot);
        lotsById.set(lot.id, lot);
        previous = next;
      });
      continue;
    }
    const sale = calculateSale(eligibleLots(lots, order.stockId, order.time), order.fills, order.fees);
    if (!Array.isArray(order.matches) || order.matches.length !== sale.matches.length ||
        sale.matches.some((match, index) => {
          const stored = order.matches[index];
          return !stored || match.lotId !== stored.lotId || match.quantity !== stored.quantity ||
            match.time !== stored.time || match.price !== stored.price || match.buyAmount !== stored.buyAmount ||
            match.sellAmount !== stored.sellAmount || match.sellFee !== stored.sellFee ||
            match.gross !== stored.gross || match.net !== stored.net ||
            feeFields.some(field => match.buyFees[field] !== stored.buyFees?.[field]);
        })) throw Error('卖出批次记录与交易流水不一致');
    for (const match of sale.matches) {
      const lot = lotsById.get(match.lotId)!;
      lot.remaining -= match.quantity;
      lot.remainingFees = feeMap(field => lot.remainingFees[field] - match.buyFees[field]);
    }
    sales.set(order.id, sale);
  }
  return { lots, sales };
}

export function holding(stock: Stock, lots: Lot[]) {
  const active = lots.filter(lot => lot.stockId === stock.id && lot.remaining > 0).sort(compareLots);
  const quantity = sum(active.map(lot => lot.remaining));
  const cost = sum(active.map(remainingCost));
  const marketValue = safeInteger(stock.price * quantity);
  return { active, quantity, cost, marketValue, float: marketValue - cost };
}

export function remainingCost(lot: Lot): number {
  return sum([safeInteger(lot.price * lot.remaining), feeTotal(lot.remainingFees)]);
}

function nonnegative(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw Error('备份含无效金额或股数');
}

function iso(value: string) {
  const instant = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(instant.getTime()) || instant.toISOString() !== value) throw Error('备份含无效时间');
}

export function compareSellPrice(buy: PriceRecord, price: number, sellQuantity?: number) {
  const difference = price - buy.price;
  const quantity = sellQuantity === undefined ? undefined : Math.min(sellQuantity, buy.quantity ?? sellQuantity);
  const gross = quantity === undefined ? undefined : difference * quantity;
  return { quantity, gross: Number.isSafeInteger(gross) ? gross : undefined, rate: percent(difference, buy.price) };
}

export function remainingPosition(trades: TradePrice[]) {
  const lots: Fill[] = [];
  let skipped = false;
  let realized = 0;
  const chronological = [...trades].reverse().sort((a, b) => a.time.localeCompare(b.time));
  for (const trade of chronological) {
    if (trade.quantity === undefined) {
      skipped = true;
      continue;
    }
    if (trade.kind === 'buy') {
      lots.push({ price: trade.price, quantity: trade.quantity });
      continue;
    }

    // Sort highest first so the cheapest lot can be removed from the end.
    let unsatisfied = trade.quantity;
    lots.sort((a, b) => b.price - a.price);
    while (unsatisfied && lots.length) {
      const lot = lots[lots.length - 1];
      const matched = Math.min(unsatisfied, lot.quantity);
      realized = sum([realized, safeInteger((trade.price - lot.price) * matched)]);
      unsatisfied -= matched;
      lot.quantity -= matched;
      if (!lot.quantity) lots.pop();
    }
    if (unsatisfied) skipped = true;
  }
  return { quantity: sum(lots.map(lot => lot.quantity)), cost: amountOf(lots), realized, skipped };
}

function legacyPrices(stock: Stock, orders: Ledger['orders']): TradePrice[] {
  return orders.filter(order => order.stockId === stock.id).reverse().map(order => {
    const quantity = sum(order.fills.map(fill => fill.quantity));
    const price = decimal(amountOf(order.fills)).div(quantity).toDecimalPlaces(0).toNumber();
    return { price, quantity, time: order.time, kind: order.kind };
  }).sort((a, b) => b.time.localeCompare(a.time));
}

export function recentPrices(stock: Stock, orders: Ledger['orders']): RecentPrices {
  if (stock.recent) return stock.recent;
  const legacy = legacyPrices(stock, orders);
  const take = (kind: OrderKind) => legacy.filter(entry => entry.kind === kind).slice(0, 3)
    .map(({ price, quantity, time }) => ({ price, quantity, time }));
  return { buy: take('buy'), sell: take('sell') };
}

export function tradePrices(stock: Stock, orders: Ledger['orders']): TradePrice[] {
  if (stock.history) return stock.history;
  const legacy = legacyPrices(stock, orders);
  if (!stock.recent) return legacy;

  // Older versions kept up to three prices per side beside the original order
  // ledger. Match each copied record once before combining the two sources.
  const key = (entry: TradePrice) => JSON.stringify([entry.kind, entry.time, entry.price, entry.quantity]);
  const counts = new Map<string, number>();
  for (const trade of legacy) {
    const id = key(trade);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const recent = (['buy', 'sell'] as const).flatMap(kind => stock.recent![kind].map(record => ({ ...record, kind })));
  const additional = recent.filter(trade => {
    const id = key(trade);
    const count = counts.get(id) ?? 0;
    if (count) counts.set(id, count - 1);
    return !count;
  });
  return [...additional, ...legacy].sort((a, b) => b.time.localeCompare(a.time));
}

export function recordPrice(stock: Stock, orders: Ledger['orders'], kind: OrderKind, record: PriceRecord): Stock {
  const recent = recentPrices(stock, orders);
  return {
    ...stock,
    recent: { ...recent, [kind]: [record, ...recent[kind].slice(0, 2)] },
    history: [{ ...record, kind }, ...tradePrices(stock, orders)],
  };
}

export function sameTrade(a: TradePrice, b: TradePrice): boolean {
  return a.kind === b.kind && a.time === b.time && a.price === b.price && a.quantity === b.quantity;
}

export function deleteTrade(stock: Stock, orders: Ledger['orders'], index: number, expected: TradePrice): Stock {
  const history = tradePrices(stock, orders);
  if (!history[index] || !sameTrade(history[index], expected)) throw Error('这笔交易已变化，请重新打开后再删除');
  const remaining = history.filter((_, item) => item !== index);
  const recent = recentPrices(stock, orders);
  const preserved = recent[expected.kind].filter(entry =>
    !history.some(trade => sameTrade(trade, { ...entry, kind: expected.kind })));
  const nextRecent = [...remaining.filter(trade => trade.kind === expected.kind), ...preserved]
    .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 3);
  let offset = history.length - 1 - index;
  const cycles = stock.cycles?.flatMap(cycle => {
    const contains = offset >= 0 && offset < cycle.count;
    offset -= cycle.count;
    if (!contains) return [cycle];
    return cycle.count === 1 ? [] : [{ ...cycle, count: cycle.count - 1 }];
  });
  return {
    ...stock,
    history: remaining,
    recent: { ...recent, [expected.kind]: nextRecent },
    ...(cycles ? { cycles } : {}),
  };
}

export function activeCycle(stock: Stock, history: TradePrice[]): TradePrice[] {
  const endedCount = sum((stock.cycles ?? []).map(cycle => cycle.count));
  return history.slice(0, history.length - endedCount);
}

export function finishCycle(stock: Stock, orders: Ledger['orders'], endedAt: string): Stock {
  const history = tradePrices(stock, orders);
  const count = activeCycle(stock, history).length;
  if (!count) return stock;
  return { ...stock, history, cycles: [...(stock.cycles ?? []), { count, endedAt, matching: 'recent-buy' }] };
}

export function cycleResult(history: TradePrice[], matchRecentBuys = true) {
  const pending: { price: number; quantity: number; kind: OrderKind; time: string }[] = [];
  let start = 0;
  let matched = 0;
  let realized = 0;
  let skipped = false;
  for (const trade of [...history].reverse().sort((a, b) => a.time.localeCompare(b.time))) {
    if (trade.quantity === undefined) {
      skipped = true;
      continue;
    }
    let quantity = trade.quantity;
    const newestFirst = matchRecentBuys && trade.kind === 'sell';
    while (quantity && start < pending.length && pending[start].kind !== trade.kind) {
      const lot = pending[newestFirst ? pending.length - 1 : start];
      const count = Math.min(quantity, lot.quantity);
      const delta = trade.kind === 'sell' ? trade.price - lot.price : lot.price - trade.price;
      realized = sum([realized, safeInteger(delta * count)]);
      matched = sum([matched, count]);
      quantity -= count;
      lot.quantity -= count;
      if (!lot.quantity) {
        if (newestFirst) pending.pop();
        else start++;
      }
    }
    if (quantity) pending.push({ ...trade, quantity });
  }
  const unmatchedKind = pending[start]?.kind;
  const remaining = pending.slice(start);
  const remainingBuyLots = unmatchedKind === 'buy'
    ? [...remaining].reverse().map(({ price, time, quantity }) => ({ price, time, quantity })) : [];
  return {
    matched, realized, skipped, unmatchedKind, remainingBuyLots,
    unmatched: sum(remaining.map(lot => lot.quantity)),
    remainingBuyCost: amountOf(remainingBuyLots),
  };
}

export function buyObservationMatches(
  price: number, reference: TradePrice | undefined, position: ReturnType<typeof cycleResult> | undefined, rules: ObservationRules,
) {
  const latest = !!reference && reachesBuyObservation(price, reference.price, position ? rules.activeBuyDrop : rules.idleBuyDrop);
  const averageEnabled = !!position && rules.buyBelowAverage !== undefined;
  const average = averageEnabled && position.unmatchedKind === 'buy' &&
    decimal(price).times(position.unmatched).times(100)
      .lte(decimal(position.remainingBuyCost).times(decimal(100).minus(rules.buyBelowAverage!)));
  const triggered = averageEnabled && rules.buyMatch === 'all' ? latest && average : latest || average;
  return { triggered, latest, average };
}

export function sellObservation(position: ReturnType<typeof cycleResult>, price: number, rules = defaultObservationRules) {
  if (position.unmatchedKind !== 'buy') return;
  const marketValue = decimal(price).times(position.unmatched);
  const whole = marketValue.times(100).gte(decimal(position.remainingBuyCost).times(decimal(100).plus(rules.sellAboveAverage)));
  const lot = position.remainingBuyLots[0];
  const last = lot && decimal(price).times(100).gte(decimal(lot.price).times(decimal(100).plus(rules.sellAboveLastBuy)));
  if (rules.sellMatch === 'all' && !(whole && last)) return;
  if (whole) return { scope: 'all' as const, quantity: position.unmatched };
  if (last) return { scope: 'last-buy' as const, quantity: lot.quantity };
}

function validatePriceRecord(record: PriceRecord) {
  nonnegative(record.price, true);
  if (record.quantity !== undefined) nonnegative(record.quantity, true);
  iso(record.time);
}

export function validateLedger(raw: unknown): Ledger {
  const data = raw as Ledger;
  if (data?.version !== 1 || typeof data.revision !== 'string' || !data.revision ||
      !Array.isArray(data.stocks) || !Array.isArray(data.orders)) throw Error('无法识别股票备份格式');
  validateProfile(data.profile);
  if (data.observationRules !== undefined) validateObservationRules(data.observationRules);
  const stocks = new Set<string>();
  const symbols = new Set<string>();
  for (const stock of data.stocks) {
    const symbol = stock.market + stock.code;
    if (!stock.id || typeof stock.id !== 'string' || stocks.has(stock.id) || symbols.has(symbol) ||
        typeof stock.name !== 'string' || !stock.name.trim() || typeof stock.code !== 'string' || !/^\d{6}$/.test(stock.code) ||
        !['沪市', '深市'].includes(stock.market)) throw Error('股票代码无效或重复');
    iso(stock.priceUpdatedAt);
    nonnegative(stock.price);
    if (stock.recent !== undefined) {
      for (const kind of ['buy', 'sell'] as const) {
        const records = stock.recent?.[kind];
        if (!Array.isArray(records) || records.length > 3) throw Error('备份含无效的近期价格');
        for (const record of records) validatePriceRecord(record);
      }
    }
    if (stock.history !== undefined) {
      if (!Array.isArray(stock.history)) throw Error('备份含无效交易记录');
      for (const record of stock.history) {
        if (record.kind !== 'buy' && record.kind !== 'sell') throw Error('备份含无效交易方向');
        validatePriceRecord(record);
      }
    }
    if (stock.cycles !== undefined) {
      if (!Array.isArray(stock.cycles) || !Array.isArray(stock.history)) throw Error('备份含无效周期');
      for (const cycle of stock.cycles) {
        nonnegative(cycle.count, true);
        iso(cycle.endedAt);
        if (cycle.matching !== undefined && cycle.matching !== 'recent-buy') throw Error('备份含无效周期配对方式');
      }
      if (sum(stock.cycles.map(cycle => cycle.count)) > stock.history.length) throw Error('周期超出交易记录范围');
    }
    if (stock.closed !== undefined) {
      if (!Array.isArray(stock.closed)) throw Error('备份含无效清仓汇总');
      for (const summary of stock.closed) {
        safeInteger(summary.realized);
        iso(summary.time);
        if (typeof summary.skipped !== 'boolean') throw Error('备份含无效清仓汇总');
      }
    }
    stocks.add(stock.id);
    symbols.add(symbol);
  }
  const orders = new Set<string>();
  for (const order of data.orders) {
    if (!order.id || typeof order.id !== 'string' || orders.has(order.id) || !stocks.has(order.stockId) ||
        !['buy', 'sell'].includes(order.kind) || !['actual', 'estimated'].includes(order.feeSource) ||
        typeof order.note !== 'string' || !Array.isArray(order.fills) || !order.fills.length) throw Error('备份含无效交易');
    iso(order.time);
    validateProfile(order.profile);
    for (const fill of order.fills) {
      nonnegative(fill.price, true);
      nonnegative(fill.quantity, true);
    }
    amountOf(order.fills);
    sum(order.fills.map(fill => fill.quantity));
    for (const field of feeFields) nonnegative(order.fees[field]);
    feeTotal(order.fees);
    orders.add(order.id);
  }
  const { lots, sales } = project(data.orders);
  const holdings = data.stocks.map(stock => holding(stock, lots));
  sum(holdings.map(item => item.marketValue));
  sum(holdings.map(item => item.cost));
  sum(data.orders.filter(order => order.kind === 'buy').map(order => amountOf(order.fills)));
  sum([...sales.values()].map(sale => sale.sellAmount));
  sum([...sales.values()].map(sale => Math.abs(sale.net)));
  return data;
}
