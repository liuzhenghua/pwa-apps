import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeCycle, cycleResult, deleteTrade, finishCycle, compareSellPrice, emptyLedger, reachesBuyObservation, recentPrices, remainingPosition, recordPrice, sharesForAmount, sellObservation, tradePrices, validateLedger } from '../src/domain.ts';
import { parseQuotes } from '../src/quotes.ts';

const stock = { id: 'test', name: '600000', code: '600000', market: '沪市', price: 0, priceUpdatedAt: '2026-11-23T01:30:00.000Z' };
const entry = (price, minute) => ({ price, time: `2026-11-23T01:${minute}:00.000Z` });

test('newest buy and sell prices are independent and each retain three records', () => {
  let saved = recordPrice(stock, [], 'sell', { ...entry(1100, 31), quantity: 600 });
  for (let index = 0; index < 4; index++) saved = recordPrice(saved, [], 'buy', { ...entry(1000 + index, 32 + index), quantity: 100 * (index + 1) });
  assert.deepEqual(saved.recent.buy.map(record => record.price), [1003, 1002, 1001]);
  assert.deepEqual(saved.recent.buy.map(record => record.quantity), [400, 300, 200]);
  assert.deepEqual(saved.recent.sell, [{ ...entry(1100, 31), quantity: 600 }]);
  const ledger = { ...emptyLedger(), stocks: [saved] };
  const restored = validateLedger(JSON.parse(JSON.stringify(ledger)));
  assert.deepEqual(restored.stocks[0].recent, saved.recent);
  assert.equal(tradePrices(restored.stocks[0], []).length, 5);
  assert.throws(() => validateLedger({ ...ledger, stocks: [{ ...saved, recent: { ...saved.recent, buy: [...saved.recent.buy, entry(1000, 31)] } }] }), /近期价格/);
});

test('old orders supply starting prices without modifying their fills', () => {
  const order = {
    stockId: stock.id, kind: 'buy', time: entry(0, 31).time,
    fills: [{ price: 1000, quantity: 75 }, { price: 2000, quantity: 25 }],
  };
  assert.deepEqual(recentPrices(stock, [order]).buy, [{ price: 1250, quantity: 100, time: order.time }]);
  const saved = recordPrice(stock, [order], 'buy', entry(1400, 32));
  assert.deepEqual(saved.recent.buy.map(record => record.price), [1400, 1250]);
  assert.equal(order.fills.length, 2);
});

test('decodes the quoted price and exchange time, dropping zero prices and mismatched symbols', () => {
  function response(symbol, code, price) {
    const fields = Array(31).fill('');
    [fields[0], fields[1], fields[2], fields[3], fields[30]] = ['1', '浦发银行', code, price, '20261123140657'];
    return `v_${symbol}="${fields.join('~')}";`;
  }
  const source = [
    response('sh600000', '600000', '10.73'),
    response('sz000001', '000001', '0.00'),
    response('sh600001', '600000', '11.03'),
  ].join('\r\n');
  assert.deepEqual([...parseQuotes(source, ['sh600000', 'sz000001', 'sh600001'])], [
    ['sh600000', { name: '浦发银行', price: 1073, time: '2026-11-23T06:06:57.000Z' }],
  ]);
});

test('sell preview compares each recent buy independently and limits matched shares', () => {
  const buy = { ...entry(1000, 31), quantity: 100 };
  assert.deepEqual(compareSellPrice(buy, 1150, 150), { gross: 15000, rate: 15, quantity: 100 });
  assert.deepEqual(compareSellPrice(buy, 900, 50), { gross: -5000, rate: -10, quantity: 50 });
  assert.deepEqual(compareSellPrice(entry(1000, 31), 1150, 150), { gross: 22500, rate: 15, quantity: 150 });
  assert.deepEqual(compareSellPrice(buy, 1150), { gross: undefined, rate: 15, quantity: undefined });
});

test('target amount rounds to the closest positive multiple of 100 shares', () => {
  assert.equal(sharesForAmount(1500000, 4065), 400);
  assert.equal(sharesForAmount(500000, 2379), 200);
  assert.equal(sharesForAmount(1000000, 2400), 400);
  assert.equal(sharesForAmount(500000, 200000), 100);
  assert.equal(sharesForAmount(500000, 1200000), 100);
});

test('position statistics match sales to the cheapest available buy and preserve the ledger', () => {
  const trades = [
    { ...entry(1300, 35), kind: 'sell', quantity: 150 },
    { ...entry(1000, 34), kind: 'buy', quantity: 100 },
    { ...entry(1200, 33), kind: 'buy', quantity: 100 },
  ];
  assert.deepEqual(remainingPosition(trades), { quantity: 50, cost: 60000, realized: 35000, skipped: false });
  assert.equal(trades[1].quantity, 100);
  assert.deepEqual(remainingPosition(trades.slice(0, 2)), { quantity: 0, cost: 0, realized: 30000, skipped: true });
  assert.deepEqual(remainingPosition([{ ...trades[1], quantity: undefined }]), { quantity: 0, cost: 0, realized: 0, skipped: true });
  assert.deepEqual(remainingPosition([...trades,
    { ...entry(1300, 32), kind: 'sell', quantity: 500 },
    { ...entry(1500, 31), kind: 'buy' },
  ]), { quantity: 50, cost: 60000, realized: 35000, skipped: true });
});

test('a fully sold position has no remaining cost but retains the realized spread', () => {
  const trades = [
    { ...entry(3905, 35), kind: 'sell', quantity: 200 },
    { ...entry(3847, 34), kind: 'buy', quantity: 200 },
  ];
  assert.deepEqual(remainingPosition(trades), { quantity: 0, cost: 0, realized: 11600, skipped: false });
});

test('ending a cycle keeps all trades and starts a fresh cycle with the next record', () => {
  const sold = recordPrice(stock, [], 'sell', { ...entry(3905, 34), quantity: 250 });
  const bought = recordPrice(sold, [], 'buy', { ...entry(3847, 35), quantity: 200 });
  const ended = finishCycle(bought, [], entry(0, 36).time);
  assert.equal(tradePrices(ended, []).length, 2);
  assert.deepEqual(activeCycle(ended, tradePrices(ended, [])), []);
  assert.equal(finishCycle(ended, [], entry(0, 37).time), ended);
  const next = recordPrice(ended, [], 'buy', { ...entry(3747, 38), quantity: 30 });
  assert.equal(activeCycle(next, tradePrices(next, [])).length, 1);
  assert.deepEqual(cycleResult(tradePrices(bought, [])), {
    matched: 200, realized: 11600, skipped: false, unmatched: 50, unmatchedKind: 'sell', remainingBuyCost: 0, lastBuyLot: undefined,
  });
  assert.deepEqual(validateLedger(JSON.parse(JSON.stringify({ ...emptyLedger(), stocks: [next] }))).stocks[0], next);
});

test('a cycle pairs more than three buys with one sell in the order recorded', () => {
  const buys = Array.from({ length: 5 }, (_, index) => ({
    ...entry(1000 - index * 10, 30 + index), quantity: 100, kind: 'buy',
  })).reverse();
  const result = cycleResult([{ ...entry(1100, 36), quantity: 450, kind: 'sell' }, ...buys]);
  assert.deepEqual(result, { matched: 450, realized: 53000, skipped: false, unmatched: 50, unmatchedKind: 'buy', remainingBuyCost: 48000, lastBuyLot: { price: 960, quantity: 50 } });
});

test('deleting an old-cycle trade adjusts its boundary and leaves the current cycle intact', () => {
  const bought = recordPrice(stock, [], 'buy', { ...entry(1000, 31), quantity: 100 });
  const sold = recordPrice(bought, [], 'sell', { ...entry(1100, 32), quantity: 100 });
  const ended = finishCycle(sold, [], entry(0, 33).time);
  const next = recordPrice(ended, [], 'buy', { ...entry(900, 34), quantity: 200 });
  const history = tradePrices(next, []);
  const corrected = deleteTrade(next, [], 2, history[2]);
  assert.equal(corrected.cycles[0].count, 1);
  assert.deepEqual(activeCycle(corrected, tradePrices(corrected, [])), [history[0]]);
  assert.deepEqual(corrected.recent.buy.map(item => item.price), [900]);
  assert.throws(() => deleteTrade(corrected, [], 2, history[2]), /已变化/);
});

test('buy observation begins at a 1% price drop from the last fill', () => {
  assert.equal(reachesBuyObservation(990, 1000), true);
  assert.equal(reachesBuyObservation(991, 1000), false);
  assert.equal(reachesBuyObservation(2399, 2424), true);
  assert.equal(reachesBuyObservation(2400, 2424), false);
});

test('sell observation prefers the whole cycle above average and otherwise uses the latest unsold buy', () => {
  const history = [
    { ...entry(1000, 33), kind: 'buy', quantity: 200 },
    { ...entry(1200, 32), kind: 'buy', quantity: 200 },
  ];
  const position = cycleResult(history);
  assert.equal(sellObservation(position, 1009), undefined);
  assert.deepEqual(sellObservation(position, 1010), { scope: 'last-buy', quantity: 200 });
  assert.deepEqual(sellObservation(position, 1111), { scope: 'all', quantity: 400 });
  const partial = cycleResult([{ ...entry(1000, 34), kind: 'sell', quantity: 350 }, ...history]);
  assert.deepEqual(partial.lastBuyLot, { price: 1000, quantity: 50 });
  assert.deepEqual(sellObservation(partial, 1010), { scope: 'all', quantity: 50 });
});
