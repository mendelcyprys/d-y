import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSync, toItems, applyItem, mergeItem, dirtyKeys, itemHash, stableStringify, syncPayload,
} from '../src/sync.js';
import * as P from '../src/progress.js';
import * as S from '../src/schedule.js';
import { testServer } from './server.js';

const arakhin = S.findTractate('Arakhin');
const day = (iso) => S.parseIsoDate(iso);
const at = (daf) => S.indexFor(14, arakhin, daf);

// ---------------------------------------------------------------------------
// Pieces

function sample() {
  const s = P.emptyState();
  P.setStart(s, at(2));
  P.setLearned(s, at(2), true, day('2026-11-22'));
  P.setNote(s, arakhin, 2, 'Erech', new Date('2026-11-22T10:00:00Z'));
  P.addRead(s, arakhin, 2, '2a:1', day('2026-11-22'));
  P.addRead(s, arakhin, 3, '3a:4', day('2026-11-23'));
  return s;
}

test('a record splits into one piece per daf, plus the starting point', () => {
  const items = toItems(sample());
  assert.deepEqual(Object.keys(items).sort(), ['Arakhin 2', 'Arakhin 3', 'start']);
  assert.deepEqual(items['Arakhin 2'], {
    learned: { 14: '2026-11-22' },
    note: { text: 'Erech', updated: '2026-11-22T10:00:00.000Z' },
    reads: { '2a:1': ['2026-11-22'] },
  });
});

test('pieces put back together give the same record', () => {
  const original = sample();
  const rebuilt = P.emptyState();
  for (const [key, value] of Object.entries(toItems(original))) applyItem(rebuilt, key, value);
  assert.deepEqual(syncPayload(P.normalizeState(rebuilt)), syncPayload(original));
});

test('putting in a piece replaces that daf, and an empty piece removes it', () => {
  const s = sample();
  applyItem(s, 'Arakhin 2', { reads: { '2b:5': ['2026-11-24'] } });
  assert.equal(P.isLearned(s, at(2)), false);
  assert.equal(P.getNote(s, arakhin, 2), '');
  assert.equal(P.readCount(s, arakhin, 2, '2b:5'), 1);
  applyItem(s, 'Arakhin 3', null);
  assert.equal(P.readCount(s, arakhin, 3, '3a:4'), 0);
  assert.equal(P.readCount(s, arakhin, 2, '2b:5'), 1); // other dafim untouched
});

test('combining two versions of a daf keeps everything from both', () => {
  const merged = mergeItem('Arakhin 2',
    { reads: { '2a:1': ['2026-11-22'] }, learned: { 14: '2026-11-22' } },
    { reads: { '2a:2': ['2026-11-23'] }, note: { text: 'from phone', updated: '2026-11-23T00:00:00Z' } });
  assert.deepEqual(merged.reads, { '2a:1': ['2026-11-22'], '2a:2': ['2026-11-23'] });
  assert.deepEqual(merged.learned, { 14: '2026-11-22' });
  assert.equal(merged.note.text, 'from phone');
});

test('only pieces that changed are unsaved', () => {
  const items = toItems(sample());
  const hashes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, itemHash(v)]));
  assert.deepEqual(dirtyKeys(items, hashes), []);
  items['Arakhin 3'].reads['3a:5'] = ['2026-11-24'];
  delete items['Arakhin 2'];
  assert.deepEqual(dirtyKeys(items, hashes).sort(), ['Arakhin 2', 'Arakhin 3']);
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

// ---------------------------------------------------------------------------
// Devices syncing through the real service logic (in memory)

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

function device(server, record = P.emptyState()) {
  const dev = { record, requests: [], statuses: [] };
  dev.sync = createSync({
    getState: () => dev.record,
    applyRemote: (next) => { dev.record = next; },
    onStatus: (s) => dev.statuses.push(s.state),
    fetch: async (url, init) => {
      if (dev.offline) throw new TypeError('Failed to fetch');
      dev.requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return server.fetch(url, init);
    },
    storage: memoryStorage(),
    serviceUrl: () => server.base,
  });
  dev.change = (fn) => { fn(dev.record); return dev.sync.syncNow(); };
  return dev;
}

const reads = (dev) => Object.values(dev.record.reads).reduce((n, d) => n + Object.values(d).reduce((m, l) => m + l.length, 0), 0);

test('signing up backs up what is already on the device; logging in elsewhere brings it over', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  assert.equal(phone.sync.status().state, 'saved');
  assert.match(phone.sync.status().recoveryCode, /-/);

  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');
  assert.deepEqual(syncPayload(laptop.record), syncPayload(phone.record));
});

test('each backup sends only the dafim that changed, and fetches only what changed', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');

  phone.requests.length = 0;
  await phone.change((r) => P.addRead(r, arakhin, 5, '5a:1', day('2026-11-24')));
  const sent = phone.requests.filter((r) => r.method === 'POST');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.items.map((i) => i.key), ['Arakhin 5']);

  laptop.requests.length = 0;
  await laptop.sync.syncNow();
  assert.equal(P.readCount(laptop.record, arakhin, 5, '5a:1'), 1);
  assert.equal(laptop.requests.filter((r) => r.method === 'POST').length, 0);

  // Nothing changed: a check sends nothing and fetches nothing.
  phone.requests.length = 0;
  await phone.sync.syncNow();
  assert.equal(phone.requests.filter((r) => r.method === 'POST').length, 0);
});

test('deletions carry over', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');

  await laptop.change((r) => {
    P.setLearned(r, at(2), false, day('2026-11-24'));
    P.removeRead(r, arakhin, 3, '3a:4');
    P.setNote(r, arakhin, 2, '');
  });
  await phone.sync.syncNow();
  assert.equal(P.isLearned(phone.record, at(2)), false);
  assert.equal(P.readCount(phone.record, arakhin, 3, '3a:4'), 0);
  assert.equal(P.getNote(phone.record, arakhin, 2), '');
  assert.equal(P.readCount(phone.record, arakhin, 2, '2a:1'), 1); // the rest is untouched
});

test('changes to the same daf on two devices at once are combined', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');

  laptop.offline = true;
  await laptop.change((r) => P.addRead(r, arakhin, 2, '2a:2', day('2026-11-24')));
  assert.equal(laptop.sync.status().state, 'offline');
  await phone.change((r) => {
    P.addRead(r, arakhin, 2, '2a:3', day('2026-11-24'));
    P.setNote(r, arakhin, 2, 'Written on the phone', new Date('2026-11-24T09:00:00Z'));
  });
  laptop.offline = false;
  await laptop.sync.syncNow();
  await phone.sync.syncNow();
  for (const dev of [phone, laptop]) {
    assert.equal(P.readCount(dev.record, arakhin, 2, '2a:2'), 1);
    assert.equal(P.readCount(dev.record, arakhin, 2, '2a:3'), 1);
    assert.equal(P.getNote(dev.record, arakhin, 2), 'Written on the phone');
  }
  assert.deepEqual(syncPayload(phone.record), syncPayload(laptop.record));
});

test('a device that was logged out elsewhere keeps its changes and merges them on logging back in', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');

  await phone.sync.changePassword('correct horse', 'new password');
  await laptop.change((r) => P.addRead(r, arakhin, 9, '9a:1', day('2026-11-24')));
  assert.equal(laptop.sync.status().state, 'signed-out');
  assert.equal(laptop.sync.status().username, 'mendel');
  await laptop.sync.login('mendel', 'new password');
  await phone.sync.syncNow();
  assert.equal(P.readCount(phone.record, arakhin, 9, '9a:1'), 1);
});

test('logging out waits for changes to be backed up', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  phone.offline = true;
  P.addRead(phone.record, arakhin, 4, '4a:1', day('2026-11-24'));
  assert.equal(phone.sync.hasUnsavedChanges(), true);
  assert.equal(await phone.sync.logout(), false); // refused: it would lose that read
  phone.offline = false;
  assert.equal(await phone.sync.logout(), true);
  assert.equal(phone.sync.status().enabled, false);
  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');
  assert.equal(P.readCount(laptop.record, arakhin, 4, '4a:1'), 1);
});

test('the recovery code gets you back in, and a new one is shown', async () => {
  const server = testServer();
  const phone = device(server, sample());
  await phone.sync.signup('mendel', 'correct horse');
  const code = phone.sync.status().recoveryCode;
  phone.sync.acknowledgeRecoveryCode();
  assert.equal(phone.sync.status().recoveryCode, null);
  const laptop = device(server);
  await laptop.sync.recover('mendel', code, 'remembered now');
  assert.notEqual(laptop.sync.status().recoveryCode, code);
  assert.deepEqual(syncPayload(laptop.record), syncPayload(phone.record));
});

test('a whole cycle of learning backs up in batches and comes back whole', async () => {
  const server = testServer();
  const record = P.emptyState();
  P.setStart(record, S.cycleStartIndex(14));
  for (let i = 0; i < S.CYCLE_LENGTH; i++) {
    const r = S.dafAtIndex(S.cycleStartIndex(14) + i);
    P.setLearned(record, r.index, true, day('2026-11-22'));
    for (let n = 1; n <= 30; n++) P.addRead(record, r.tractate, r.daf, `${r.daf}a:${n}`, day('2026-11-22'));
  }
  const phone = device(server, record);
  await phone.sync.signup('mendel', 'correct horse');
  const posts = phone.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/v1/changes'));
  assert.ok(posts.length >= 3, `sent in ${posts.length} batches`);
  for (const post of posts) assert.ok(JSON.stringify(post.body).length < 1_000_000);

  const laptop = device(server);
  await laptop.sync.login('mendel', 'correct horse');
  assert.equal(reads(laptop), S.CYCLE_LENGTH * 30);
  assert.deepEqual(syncPayload(laptop.record), syncPayload(phone.record));

  // After all that, one more read is still a tiny backup.
  phone.requests.length = 0;
  await phone.change((r) => P.addRead(r, arakhin, 2, '2b:1', day('2026-11-24')));
  const post = phone.requests.find((r) => r.method === 'POST');
  assert.ok(JSON.stringify(post.body).length < 2000, `${JSON.stringify(post.body).length} bytes`);
});

test('wrong passwords and taken names come back as messages to show', async () => {
  const server = testServer();
  const phone = device(server);
  await phone.sync.signup('mendel', 'correct horse');
  const other = device(server);
  await assert.rejects(other.sync.signup('mendel', 'whatever1'), /taken/);
  await assert.rejects(other.sync.login('mendel', 'wrong pass'), /don't match/);
  await assert.rejects(other.sync.signup('x', 'whatever1'), /Usernames/);
  assert.equal(other.sync.status().enabled, false);
});
