import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { calendarYear, splitLedger } from '../src/archive.ts';
import { matchesAlert, openAlerts } from '../src/alerts.ts';
import { emptyLedger, finishCycle, recordPrice, tradePrices } from '../src/domain.ts';
import { loadArchiveYears, SyncConflict, syncGithub } from '../src/backup.ts';
import { readLocal, updateLocal } from '../src/store.ts';

const stock = { id: 'one', code: '600000', name: '私密股票', market: '沪市', price: 2379, priceUpdatedAt: '2026-11-20T05:00:00.000Z' };
const api = 'https://api.github.com/repos/liuzhenghua/pwa-apps-data';
const prefix = api + '/contents/stocks/test-ledger/';
const secret = 'test-passphrase';
const sync = (local, direction = 'auto', confirm = () => false, passphrase = secret) =>
  syncGithub(local, 'test-ledger', 'mock-token', passphrase, direction, confirm);

test('encrypted yearly sync uses stable paths and publishes complete snapshots atomically', async t => {
  const reads = [];
  const publications = [];
  const trees = new Map([['tree-initial', new Map()]]);
  const commits = new Map([['initial', { tree: 'tree-initial', paths: [] }]]);
  const blobs = new Map();
  const files = () => trees.get(commits.get(head).tree);
  let sequence = 0;
  let head = 'initial';
  let privateRepository = true;
  let rejectUpdate = false;
  const missing = () => new Response(null, { status: 404 });

  function externalUpdate(file, data) {
    const tree = 'tree-external-' + ++sequence;
    const copy = new Map(files());
    copy.set(file, data);
    trees.set(tree, copy);
    const commit = 'external-' + sequence;
    commits.set(commit, { tree, parent: head, paths: [file] });
    head = commit;
  }

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    if (url === api) return Response.json({ private: privateRepository, default_branch: 'main' });
    if (url === api + '/git/ref/heads/main') return Response.json({ object: { sha: head } });
    if (url.startsWith(prefix)) {
      const target = new URL(url);
      const file = target.pathname.split('/').at(-1);
      const commit = target.searchParams.get('ref');
      reads.push([file, commit]);
      const payload = trees.get(commits.get(commit)?.tree)?.get(file);
      return payload ? Response.json(payload) : missing();
    }
    if (url.startsWith(api + '/git/commits/')) {
      const commit = commits.get(url.split('/').at(-1));
      return commit ? Response.json({ tree: { sha: commit.tree } }) : missing();
    }
    const body = JSON.parse(options.body);
    if (url === api + '/git/blobs') {
      assert.equal(options.method, 'POST');
      assert.equal(body.encoding, 'base64');
      const payload = JSON.parse(Buffer.from(body.content, 'base64').toString());
      assert.equal(payload.format, 'stocks-encrypted-v1');
      assert.ok(payload.ciphertext);
      assert.ok(!JSON.stringify(payload).includes(stock.name));
      const sha = 'blob-' + ++sequence;
      blobs.set(sha, { sha, content: body.content });
      return Response.json({ sha });
    }
    if (url === api + '/git/trees') {
      const paths = [];
      const next = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) {
        assert.equal(entry.type, 'blob');
        assert.ok(entry.path.startsWith('stocks/test-ledger/'));
        const file = entry.path.split('/').at(-1);
        paths.push(file);
        if (entry.sha === null) next.delete(file);
        else next.set(file, blobs.get(entry.sha));
      }
      const sha = 'tree-' + ++sequence;
      trees.set(sha, next);
      trees.set(sha + '-paths', paths);
      return Response.json({ sha });
    }
    if (url === api + '/git/commits') {
      const sha = 'commit-' + ++sequence;
      commits.set(sha, { tree: body.tree, parent: body.parents[0], paths: trees.get(body.tree + '-paths') });
      return Response.json({ sha });
    }
    assert.equal(url, api + '/git/refs/heads/main');
    assert.equal(options.method, 'PATCH');
    assert.equal(body.force, false);
    const next = commits.get(body.sha);
    if (rejectUpdate || next.parent !== head) return new Response(null, { status: 409 });
    head = body.sha;
    publications.push(next.paths);
    return Response.json({ object: { sha: head } });
  });

  const year = calendarYear();
  const past = String(Number(year) - 1);
  const fill = (year, day) => ({
    price: 2000 + day, quantity: 100, time: year + '-02-0' + day + 'T10:00:00.000Z',
  });
  const prior = finishCycle(recordPrice(stock, [], 'buy', fill(past, 1)), [], fill(past, 2).time);
  const current = finishCycle(recordPrice(prior, [], 'buy', fill(year, 1)), [], fill(year, 2).time);
  const tracked = recordPrice(current, [], 'buy', fill(year, 3));
  const initial = await updateLocal('empty', state => ({
    ...state, ledger: { ...emptyLedger(), revision: 'desktop', stocks: [tracked] },
  }));

  privateRepository = false;
  await assert.rejects(sync(initial), /Private/);
  assert.equal(head, 'initial');
  privateRepository = true;
  await assert.rejects(sync(initial, 'auto', () => false, ''), /口令/);

  // Seed a v1 snapshot independently so the production reader must migrate it.
  const b64 = item => Buffer.from(item).toString('base64');
  async function encodeSnapshot(data, sha) {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const password = await webcrypto.subtle.importKey('raw', Buffer.from(secret), 'PBKDF2', false, ['deriveKey']);
    const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, password, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(JSON.stringify(data)));
    return { sha, content: b64(JSON.stringify({
      format: 'stocks-encrypted-v1', salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext),
    })) };
  }
  files().set('ledger.json', await encodeSnapshot(initial.ledger, 'legacy'));

  const migrated = await sync(initial);
  const pastFile = migrated.local.archive.years[past].file;
  const currentFile = migrated.local.archive.years[year].file;
  assert.equal(pastFile, 'year-' + past + '.json');
  assert.equal(currentFile, 'year-' + year + '.json');
  assert.equal(publications.length, 1);
  assert.deepEqual(new Set(publications[0]), new Set(['open.json', pastFile, currentFile, 'ledger.json']));
  assert.equal(files().has('ledger.json'), false);
  await assert.rejects(sync(migrated.local, 'auto', () => false, 'wrong-passphrase'), /无法解密/);
  reads.length = 0;
  assert.equal((await sync(migrated.local)).message, '本机与云端已同步');
  assert.deepEqual(reads, [['open.json', head]]);

  const newDevice = await updateLocal('desktop', () => ({ ledger: emptyLedger() }));
  reads.length = 0;
  const downloaded = await sync(newDevice);
  assert.deepEqual(downloaded.local.archive.missing, [past]);
  assert.ok(reads.some(([file]) => file === currentFile));
  assert.ok(!reads.some(([file]) => file === pastFile));
  assert.equal(tradePrices(downloaded.local.ledger.stocks[0], []).length, 2);

  const changed = await updateLocal('desktop', state => ({
    ...state, ledger: {
      ...state.ledger, revision: 'mobile', stocks: [recordPrice(state.ledger.stocks[0], [], 'sell', fill(year, 4))],
    },
  }));
  const original = new Map(files());
  const oldHead = head;
  rejectUpdate = true;
  await assert.rejects(sync(changed), SyncConflict);
  assert.equal(head, oldHead);
  assert.deepEqual(files(), original);
  assert.deepEqual(await readLocal(), changed);
  rejectUpdate = false;
  reads.length = 0;
  const uploaded = await sync(changed);
  assert.deepEqual(publications.at(-1), ['open.json']);
  assert.equal(uploaded.local.archive.years[past].file, pastFile);
  assert.deepEqual(uploaded.local.archive.missing, [past]);

  const pinned = uploaded.local.archive.commit;
  const pastContents = files().get(pastFile);
  externalUpdate(pastFile, { sha: 'different', content: 'bad-current-version' });
  reads.length = 0;
  const complete = await loadArchiveYears(uploaded.local, [past], 'mock-token', secret);
  assert.deepEqual(reads, [[pastFile, pinned]]);
  assert.notEqual(head, pinned);
  externalUpdate(pastFile, pastContents);
  assert.deepEqual(complete.archive.missing, []);
  assert.equal(tradePrices(complete.ledger.stocks[0], []).length, 4);
  assert.equal(splitLedger(complete.ledger).years[past][0].boundary.endedAt, fill(past, 2).time);

  const ended = await updateLocal('mobile', state => ({
    ...state, ledger: { ...state.ledger, revision: 'ended', stocks: [
      finishCycle(state.ledger.stocks[0], [], fill(year, 5).time),
    ] },
  }));
  const archived = await sync(ended);
  assert.deepEqual(new Set(publications.at(-1)), new Set(['open.json', currentFile]));
  assert.equal(files().has('open.json'), true);
  assert.equal(archived.local.archive.commit, head);
  assert.equal(archived.local.archive.years[year].file, currentFile);

  const oversized = {
    ...archived.local,
    ledger: { ...archived.local.ledger, revision: 'oversized', stocks: [{ ...archived.local.ledger.stocks[0], name: 'x'.repeat(750_000) }] },
  };
  const intactIndex = files().get('open.json');
  await assert.rejects(sync(oversized, 'upload', () => true), /950 KB/);
  assert.deepEqual(files().get('open.json'), intactIndex);

  const localEdit = await updateLocal('ended', state => ({
    ...state, ledger: { ...state.ledger, revision: 'local-edit' },
  }));
  externalUpdate('open.json', { ...files().get('open.json'), sha: 'updated-externally' });
  await assert.rejects(sync(localEdit), SyncConflict);
  assert.equal((await sync(localEdit, 'download')).message, '已取消同步');
  assert.deepEqual(await readLocal(), localEdit);

  // Devices on the previous fixed-name layout had the index and open trades in separate files.
  const previous = splitLedger(archived.local.ledger);
  const oldState = { ...previous.core, revision: 'v2' };
  const ref = data => webcrypto.subtle.digest('SHA-256', Buffer.from(JSON.stringify(data)))
    .then(hash => Buffer.from(hash).toString('hex'));
  const openV2 = await encodeSnapshot(previous.open, 'old-open-array');
  externalUpdate('open.json', openV2);
  externalUpdate('ledger.json', await encodeSnapshot({
    format: 'stocks-index-v2', core: oldState, open: { file: 'open.json', digest: await ref(previous.open) },
    years: archived.local.archive.years,
  }, 'old-separate-index'));
  const restored = await sync(localEdit, 'download', () => true);
  assert.equal(restored.local.ledger.revision, 'v2');
  assert.equal(restored.local.ledger.stocks[0].history.length, 4);
  assert.equal(await sync(restored.local).then(result => result.message), '已加密上传到 GitHub');
  assert.equal(files().has('ledger.json'), false);
  assert.equal(files().has('open.json'), true);

  const localIndex = files().get('open.json');
  const reminders = await openAlerts({ folder: 'test-ledger', credential: 'mock-token', secret });
  assert.equal((await reminders.read()).data, undefined);
  const first = { id: 'a', symbol: 'sh600000', name: stock.name, kind: 'buy', price: 2300 };
  const second = { ...first, id: 'b', kind: 'sell', price: 2400 };
  await reminders.update(() => ({ version: 1, publicKey: 'test-public-key', alerts: [first] }));
  let attempts = 0;
  await reminders.update(state => {
    // Simulate an unrelated ledger commit after reading the alerts snapshot.
    if (++attempts === 1) externalUpdate('open.json', localIndex);
    return { ...state, alerts: [...state.alerts, second] };
  });
  assert.equal(attempts, 2);
  assert.deepEqual((await reminders.read()).data.alerts, [first, second]);
  assert.deepEqual(files().get('open.json'), localIndex);
  assert.deepEqual(publications.at(-1), ['alerts.json']);
  assert.equal(matchesAlert(first, 2300), true);
  assert.equal(matchesAlert(first, 2301), false);
  assert.equal(matchesAlert(second, 2400), true);
  assert.equal(matchesAlert(second, 2399), false);
  assert.equal(matchesAlert({ ...second, triggeredAt: stock.priceUpdatedAt }, 2400), false);
});
