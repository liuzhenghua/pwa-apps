import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { emptyLedger } from '../src/domain.ts';
import { SyncConflict, syncGithub } from '../src/backup.ts';
import { readLocal, updateLocal } from '../src/store.ts';

test('GitHub sync encrypts snapshots, downloads them on another device and protects conflicts', async t => {
  const stock = { id: 'one', code: '600000', name: '私密股票', market: '沪市', price: 2379, priceUpdatedAt: '2026-11-20T05:00:00.000Z' };
  const initial = await updateLocal('empty', current => ({
    ...current, ledger: { ...emptyLedger(), revision: 'desktop', stocks: [stock] },
  }));
  let remote;
  let head = 0;
  let privateRepository = true;
  let rejectWrite = false;
  const path = 'https://api.github.com/repos/liuzhenghua/pwa-apps-data';

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    if (url === path) return Response.json({ private: privateRepository });
    assert.equal(url, path + '/contents/stocks/test-ledger/ledger.json');
    if (options.method !== 'PUT') return remote ? Response.json(remote) : new Response(null, { status: 404 });
    const body = JSON.parse(options.body);
    assert.equal(body.sha, remote?.sha);
    if (rejectWrite) return new Response(null, { status: 409 });
    const payload = JSON.parse(Buffer.from(body.content, 'base64').toString());
    assert.equal(payload.format, 'stocks-encrypted-v1');
    assert.ok(payload.ciphertext);
    assert.equal(Object.keys(payload).length, 4);
    assert.ok(!JSON.stringify(payload).includes(stock.name));
    remote = { sha: 'sha-' + ++head, content: body.content };
    return Response.json({ content: { sha: remote.sha } });
  });

  const sync = (local, direction = 'auto', confirm = () => false, secret = 'test-passphrase') =>
    syncGithub(local, 'test-ledger', 'mock-token', secret, direction, confirm);

  privateRepository = false;
  await assert.rejects(sync(initial), /Private/);
  assert.equal(head, 0);
  privateRepository = true;
  await assert.rejects(sync(initial, 'auto', () => false, ''), /口令/);

  const uploaded = await sync(initial);
  assert.equal(uploaded.local.sync['test-ledger'].sha, 'sha-1');
  assert.equal(head, 1);
  assert.equal((await sync(uploaded.local)).message, '本机与云端已同步');
  assert.equal(head, 1);
  await assert.rejects(sync(uploaded.local, 'auto', () => false, 'wrong-passphrase'), /无法解密/);

  const newDevice = await updateLocal('desktop', () => ({ ledger: emptyLedger() }));
  const downloaded = await sync(newDevice);
  assert.deepEqual(downloaded.local.ledger, initial.ledger);

  const changed = await updateLocal('desktop', current => ({
    ...current, ledger: { ...current.ledger, revision: 'mobile', stocks: [{ ...stock, price: 2410 }] },
  }));
  remote = { ...remote, sha: 'sha-external' };
  await assert.rejects(sync(changed), SyncConflict);
  assert.deepEqual(await readLocal(), changed);
  assert.equal(head, 1);

  const canceled = await sync(changed, 'download');
  assert.equal(canceled.message, '已取消同步');
  assert.deepEqual(await readLocal(), changed);
  rejectWrite = true;
  await assert.rejects(sync(changed, 'upload', () => true), SyncConflict);
  assert.deepEqual(await readLocal(), changed);
  rejectWrite = false;
  const resolved = await sync(changed, 'upload', () => true);
  assert.equal(resolved.local.sync['test-ledger'].revision, 'mobile');
  assert.equal(head, 2);
});
