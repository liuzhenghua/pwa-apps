import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  amountOf, breakEven, calculateSale, cents, defaultProfile, eligibleLots, emptyLedger, estimateFees,
  feeTotal, holding, project, registerSale, validateLedger,
} from '../src/domain.ts';
import { readLocal, updateLocal } from '../src/store.ts';

const time = day => new Date(Date.UTC(2026, 10, day, 5)).toISOString();
const stock = { id: 'stock', code: '600000', name: '示例股票', market: '沪市', price: 2379, priceUpdatedAt: time(20) };
const ledger = orders => ({ ...emptyLedger(), revision: 'initial', stocks: [stock], orders });
const order = (id, day, fills, kind = 'buy', profile = defaultProfile) => ({
  id, stockId: stock.id, time: time(day), fills, kind, profile, note: '',
  fees: estimateFees(amountOf(fills), profile, kind), feeSource: 'estimated',
});
const buy = (id, day, price, quantity) => order(id, day, [{ price, quantity }]);
const sell = (id, day, price, quantity) => order(id, day, [{ price, quantity }], 'sell');
const preview = (data, order) =>
  calculateSale(eligibleLots(project(data.orders).lots, order.stockId, order.time), order.fills, order.fees);

function example() {
  const initial = ledger([buy('high', 18, 2449, 300), buy('mid', 19, 2344, 300), buy('low', 20, 2275, 500)]);
  return { ...initial, orders: [...initial.orders, registerSale(initial, sell('earlier-sale', 20, 2379, 300))] };
}

test('spec example matches the cheapest lots and yields ¥294.82 at 2.54%', () => {
  const data = example();
  const sale = preview(data, sell('current-sale', 20, 2379, 500));
  assert.deepEqual(sale.matches.map(match => [match.lotId, match.quantity, match.gross]), [
    ['low:0', 200, 20800], ['mid:0', 300, 10500],
  ]);
  assert.equal(sale.sellAmount, 1189500);
  assert.equal(sale.buyAmount, 1158200);
  assert.equal(sale.gross, 31300);
  assert.equal(feeTotal(sale.buyFees), 711);
  assert.equal(feeTotal(sale.fees), 1107);
  assert.equal(sale.net, 29482);
  assert.equal(sale.netRate.toFixed(2), '2.54');
  assert.equal(sale.basis, 1158911);
});

test('simulation is pure and registering a partial sale consumes only the matched lot', () => {
  const data = example();
  const before = structuredClone(data);
  const { lots } = project(data.orders);
  const originalLots = structuredClone(lots);
  const eligible = eligibleLots(lots, stock.id, time(20));
  const actual = sell('current-sale', 20, 2379, 100);
  calculateSale(eligible, actual.fills, actual.fees);
  preview(data, sell('alternate', 20, 1500, 400));
  assert.deepEqual(lots, originalLots);
  assert.deepEqual(data, before);
  const persisted = registerSale(data, actual);
  assert.equal(persisted.matches.length, 1);
  const projected = project([...data.orders, persisted]);
  assert.deepEqual(projected.lots.map(lot => lot.remaining), [300, 300, 100]);
  assert.equal(holding(stock, projected.lots).quantity, 700);
});

test('same price prefers the earlier trade and excludes future purchases', () => {
  const data = ledger([buy('same-later', 19, 1000, 75), buy('future', 21, 10, 800), buy('same-earlier', 18, 1000, 60)]);
  assert.deepEqual(preview(data, sell('historic', 20, 2000, 100)).matches.map(match => match.lotId), ['same-earlier:0', 'same-later:0']);
  assert.throws(() => preview(data, sell('over', 20, 2000, 136)), /超过/);
});

test('commission and stamp are estimated once on the full order even for multiple fills and lots', () => {
  assert.equal(estimateFees(100, defaultProfile, 'buy').commission, 500);
  assert.equal(estimateFees(100, defaultProfile, 'sell').commission, 500);
  const groupedBuy = order('grouped-buy', 20, [{ price: 999, quantity: 80 }, { price: 1005, quantity: 40 }]);
  assert.equal(feeTotal(groupedBuy.fees), 501);
  const data = ledger([groupedBuy, buy('next', 20, 1088, 60)]);
  assert.equal(project(data.orders).lots.slice(0, 2).reduce((fees, lot) => fees + feeTotal(lot.fees), 0), 501);
  const groupedSale = order('grouped-sale', 20, [{ price: 1234, quantity: 70 }, { price: 1400, quantity: 91 }], 'sell');
  const sale = preview(data, groupedSale);
  assert.equal(sale.matches.length, 3);
  assert.equal(sale.fees.commission, 500);
  assert.equal(sale.fees.stamp, 107);
  assert.equal(sale.sellAmount, 213780);
  assert.equal(sale.matches.reduce((total, match) => total + match.sellFee, 0), feeTotal(sale.fees));
  assert.equal(sale.matches.reduce((total, match) => total + match.net, 0), sale.net);
});

test('partial fee rounding conserves the original fees and final sale consumes the remainder', () => {
  const purchased = buy('small', 19, 150, 3);
  purchased.fees = { commission: 2, stamp: 0, transfer: 4, regulatory: 0, other: 0 };
  let data = ledger([purchased]);
  for (let index = 1; index <= 3; index++) {
    const sale = registerSale(data, sell('partial-' + index, 20, 200, 1));
    assert.equal(feeTotal(sale.matches[0].buyFees), 2);
    data = { ...data, orders: [...data.orders, sale] };
  }
  assert.equal(feeTotal(project(data.orders).lots[0].remainingFees), 0);
  assert.equal(project(data.orders).lots[0].remaining, 0);

  purchased.fees = { ...purchased.fees, commission: 0, transfer: 1 };
  const penny = ledger([purchased]);
  const first = registerSale(penny, sell('first', 20, 200, 1));
  const last = registerSale({ ...penny, orders: [...penny.orders, first] }, sell('last', 20, 200, 2));
  assert.equal(feeTotal(first.matches[0].buyFees), 0);
  assert.equal(feeTotal(last.matches[0].buyFees), 1);

  const split = ledger([{ ...purchased, fills: [{ price: 150, quantity: 2 }],
    fees: { ...purchased.fees, commission: 1, transfer: 1 },
  }]);
  assert.equal(feeTotal(preview(split, sell('half', 20, 200, 1)).buyFees), 1);
});

test('break-even solver returns the very first valid cent with minimum, variable and actual fees', () => {
  const profiles = [defaultProfile, { ...defaultProfile,
    commission: '10', minimum: 5, stamp: '9.5', transfer: '8.22', regulatory: '9.21', other: '7.45', includesRegulatory: false,
  }];
  for (const profile of profiles) {
    for (const quantity of [1, 7, 500]) {
      for (const basis of [15, 101, 677]) {
        const floor = breakEven(quantity, basis, profile);
        for (let price = 1; price <= floor; price++) {
          const amount = price * quantity;
          assert.equal(amount - feeTotal(estimateFees(amount, profile, 'sell')) >= basis, price === floor);
        }
      }
    }
  }
  const sale = preview(example(), sell('actual', 20, 2379, 500));
  assert.equal(breakEven(500, sale.basis, defaultProfile, sale.fees), 2321);
  assert.equal(cents('23.79'), 2379);
});

test('historical settings and backfilled purchases do not change earlier sales', () => {
  const data = example();
  const expected = project(data.orders).sales.get('earlier-sale');
  const backup = JSON.parse(JSON.stringify({
    ...data, profile: { ...data.profile, commission: '1.8', minimum: 0 },
    orders: [...data.orders, buy('back-filled', 18, 100, 42)],
  }));
  assert.deepEqual(project(validateLedger(backup).orders).sales.get('earlier-sale'), expected);
});

test('IndexedDB saves and restores trade, allocations and remainder in one transaction', async () => {
  const data = example();
  await updateLocal('empty', current => ({ ...current, ledger: data }));
  const order = registerSale(data, sell('persisted-sale', 20, 2379, 500));
  const persisted = await updateLocal(data.revision, current => ({
    ...current, ledger: { ...data, revision: 'persisted', orders: [...data.orders, order] },
  }));
  assert.deepEqual(await readLocal(), persisted);
  assert.equal(project(persisted.ledger.orders).sales.get('persisted-sale').net, 29482);
  const restored = validateLedger(JSON.parse(JSON.stringify(persisted.ledger)));
  assert.deepEqual(project(restored.orders), project(persisted.ledger.orders));
  await assert.rejects(updateLocal('initial', () => persisted), /其他标签页/);
  const broken = structuredClone(persisted);
  broken.ledger.orders.at(-1).matches[0].quantity = 201;
  await assert.rejects(updateLocal('persisted', () => broken), /不一致/);
  assert.deepEqual(await readLocal(), persisted);
  const attempts = await Promise.allSettled(['same-time-1', 'same-time-2'].map(revision =>
    updateLocal('persisted', current => ({ ...current, ledger: { ...current.ledger, revision } }))
  ));
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
});
