import assert from 'node:assert/strict';
import test from 'node:test';
import { alertAccount, applySharedAlertResults, enrollAlertDevice, sharedAlertTargets } from '../src/alerts.ts';

const reminder = { id: 'alert', name: '紫金矿业', symbol: 'sh601899', kind: 'buy', price: 2249 };
const phone = { endpoint: 'https://push.example/phone', keys: { p256dh: 'phone', auth: 'phone' } };
const desktop = { endpoint: 'https://push.example/desktop', keys: { p256dh: 'desktop', auth: 'desktop' } };
const sentAt = '2026-11-25T02:00:00Z';
const key = (...parts) => JSON.stringify(parts);

test('migrates a device rule and sends only to subscribed devices of the matching cloud name', () => {
  const legacy = { devices: { desktop: { subscription: desktop, alerts: [reminder] } } };
  let state = enrollAlertDevice(legacy, 'shared', 'desktop', desktop);
  state = enrollAlertDevice(state, 'shared', 'phone', phone);
  state = enrollAlertDevice(state, 'another', 'another-phone', phone);
  assert.deepEqual(state.devices, {});
  assert.deepEqual(alertAccount(state, 'shared').alerts, [reminder]);
  assert.deepEqual(sharedAlertTargets(state).map(({ account, id }) => [account, id]),
    [['shared', 'desktop'], ['shared', 'phone']]);
  state = enrollAlertDevice(state, 'another', 'desktop', desktop);
  assert.deepEqual(sharedAlertTargets(state).map(({ id }) => id), ['phone']);
});

test('partial delivery retries only remaining devices and completes after expiration or delivery', () => {
  const state = { devices: {}, accounts: { shared: { alerts: [reminder], devices: { phone, desktop } } } };
  const partial = applySharedAlertResults(state, new Map([[key('shared', 'alert', 'phone'), sentAt]]), new Map());
  assert.deepEqual(sharedAlertTargets(partial).map(({ id }) => id), ['desktop']);
  const completed = applySharedAlertResults(partial, new Map([[key('shared', 'alert', 'desktop'), sentAt]]), new Map());
  assert.equal(alertAccount(completed, 'shared').alerts[0].triggeredAt, sentAt);
  assert.deepEqual(sharedAlertTargets(completed), []);
  const expired = applySharedAlertResults(partial, new Map(), new Map([[key('shared', 'desktop'), desktop.endpoint]]));
  assert.ok(alertAccount(expired, 'shared').alerts[0].triggeredAt);
  assert.deepEqual(alertAccount(expired, 'shared').devices, { phone });
});
