import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './server.js';
import { MAX_BYTES } from '../worker/src/handler.js';
import { PAGE_SIZE } from '../worker/src/store.js';
import { hashPassword, verifyPassword } from '../worker/src/crypto.js';

const signup = (s, username = 'Mendel', password = 'correct horse') => s.call('POST', '/v1/signup', { username, password });

test('passwords are stored as salted hashes and checked correctly', async () => {
  const a = await hashPassword('secret one', 1000);
  const b = await hashPassword('secret one', 1000);
  assert.notEqual(a, b); // different salts
  assert.doesNotMatch(a, /secret/);
  assert.equal(await verifyPassword('secret one', a), true);
  assert.equal(await verifyPassword('secret two', a), false);
});

test('signing up gives a session and a recovery code', async () => {
  const s = testServer();
  const res = await signup(s);
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'mendel');
  assert.match(res.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.match(res.body.recoveryCode, /^([a-z0-9]{4}-){4}[a-z0-9]{4}$/);
  const me = await s.call('GET', '/v1/me', undefined, res.body.token);
  assert.deepEqual(me.body, { username: 'mendel' });
});

test('usernames are unique (ignoring case) and must be sensible; passwords at least 8 characters', async () => {
  const s = testServer();
  await signup(s);
  assert.equal((await signup(s, 'MENDEL')).status, 409);
  assert.equal((await signup(s, 'ab')).status, 400);
  assert.equal((await signup(s, 'has space')).status, 400);
  assert.equal((await signup(s, 'someone', 'short')).status, 400);
});

test('logging in and out', async () => {
  const s = testServer();
  await signup(s);
  assert.equal((await s.call('POST', '/v1/login', { username: 'mendel', password: 'wrong password' })).status, 401);
  assert.equal((await s.call('POST', '/v1/login', { username: 'nobody', password: 'correct horse' })).status, 401);
  const login = await s.call('POST', '/v1/login', { username: ' Mendel ', password: 'correct horse' });
  assert.equal(login.status, 200);
  const token = login.body.token;
  assert.equal((await s.call('GET', '/v1/me', undefined, token)).status, 200);
  assert.equal((await s.call('POST', '/v1/logout', {}, token)).status, 200);
  assert.equal((await s.call('GET', '/v1/me', undefined, token)).status, 401);
});

test('too many wrong passwords locks the username for a while', async () => {
  const s = testServer();
  await signup(s);
  for (let i = 0; i < 10; i++) await s.call('POST', '/v1/login', { username: 'mendel', password: `guess ${i}xxx` });
  const blocked = await s.call('POST', '/v1/login', { username: 'mendel', password: 'correct horse' });
  assert.equal(blocked.status, 429);
  s.clock.t += 16 * 60 * 1000;
  assert.equal((await s.call('POST', '/v1/login', { username: 'mendel', password: 'correct horse' })).status, 200);
});

test('too many sign-ups from one address are refused', async () => {
  const s = testServer();
  const from = { 'CF-Connecting-IP': '203.0.113.9' };
  for (let i = 0; i < 5; i++) {
    assert.equal((await s.call('POST', '/v1/signup', { username: `user${i}`, password: 'password1' }, null, from)).status, 200);
  }
  assert.equal((await s.call('POST', '/v1/signup', { username: 'user9', password: 'password1' }, null, from)).status, 429);
});

test('a recovery code sets a new password, ends other sessions and is replaced', async () => {
  const s = testServer();
  const { body: first } = await signup(s);
  const wrong = await s.call('POST', '/v1/recover', { username: 'mendel', recoveryCode: 'aaaa-bbbb-cccc-dddd-eeee', newPassword: 'new password' });
  assert.equal(wrong.status, 401);
  const res = await s.call('POST', '/v1/recover', { username: 'mendel', recoveryCode: first.recoveryCode.toUpperCase().replace(/-/g, ' '), newPassword: 'new password' });
  assert.equal(res.status, 200);
  assert.notEqual(res.body.recoveryCode, first.recoveryCode);
  assert.equal((await s.call('GET', '/v1/me', undefined, first.token)).status, 401);
  assert.equal((await s.call('POST', '/v1/login', { username: 'mendel', password: 'correct horse' })).status, 401);
  assert.equal((await s.call('POST', '/v1/login', { username: 'mendel', password: 'new password' })).status, 200);
  const reuse = await s.call('POST', '/v1/recover', { username: 'mendel', recoveryCode: first.recoveryCode, newPassword: 'another one' });
  assert.equal(reuse.status, 401);
});

test('changing your password needs the current one and ends other sessions', async () => {
  const s = testServer();
  const { body: { token } } = await signup(s);
  const other = (await s.call('POST', '/v1/login', { username: 'mendel', password: 'correct horse' })).body.token;
  assert.equal((await s.call('POST', '/v1/password', { password: 'nope nope', newPassword: 'brand new pw' }, token)).status, 401);
  const res = await s.call('POST', '/v1/password', { password: 'correct horse', newPassword: 'brand new pw' }, token);
  assert.equal(res.status, 200);
  assert.equal((await s.call('GET', '/v1/me', undefined, other)).status, 401);
  assert.equal((await s.call('GET', '/v1/me', undefined, res.body.token)).status, 200);
});

test('each account sees only its own backup', async () => {
  const s = testServer();
  const a = (await signup(s, 'alice')).body.token;
  const b = (await signup(s, 'bobby')).body.token;
  await s.call('POST', '/v1/changes', { items: [{ key: 'Arakhin 2', value: { note: { text: 'mine' } }, baseRev: 0 }] }, a);
  assert.equal((await s.call('GET', '/v1/changes?since=0', undefined, b)).body.items.length, 0);
  assert.equal((await s.call('GET', '/v1/changes?since=0', undefined, a)).body.items.length, 1);
  assert.equal((await s.call('GET', '/v1/changes?since=0')).status, 401);
  assert.equal((await s.call('GET', '/v1/changes?since=0', undefined, 'made-up-token-made-up-token')).status, 401);
});

test('deleting an account needs the password and removes its backup', async () => {
  const s = testServer();
  const { body: { token } } = await signup(s);
  await s.call('POST', '/v1/changes', { items: [{ key: 'start', value: { cycle: 14 }, baseRev: 0 }] }, token);
  assert.equal((await s.call('POST', '/v1/delete-account', { password: 'wrong one!' }, token)).status, 401);
  assert.equal((await s.call('POST', '/v1/delete-account', { password: 'correct horse' }, token)).status, 200);
  assert.equal((await s.call('GET', '/v1/me', undefined, token)).status, 401);
  assert.equal((await s.call('POST', '/v1/login', { username: 'mendel', password: 'correct horse' })).status, 401);
  const again = (await signup(s)).body.token; // the name is free again, with an empty backup
  assert.equal((await s.call('GET', '/v1/changes?since=0', undefined, again)).body.items.length, 0);
});

test('saving items: only changes since, conflicts, deletions', async () => {
  const s = testServer();
  const { body: { token } } = await signup(s);
  const put = (items) => s.call('POST', '/v1/changes', { items }, token);
  let res = await put([{ key: 'Arakhin 2', value: { reads: { '2a:1': ['2026-11-23'] } }, baseRev: 0 }, { key: 'start', value: { cycle: 14, tractate: 'Arakhin', daf: 2 }, baseRev: 0 }]);
  assert.deepEqual(res.body, { revBefore: 0, rev: 2, written: [{ key: 'Arakhin 2', rev: 1 }, { key: 'start', rev: 2 }], conflicts: [] });
  res = await put([{ key: 'Arakhin 3', value: { note: { text: 'x' } }, baseRev: 0 }]);
  assert.equal(res.body.rev, 3);
  // Only what changed after revision 2.
  res = await s.call('GET', '/v1/changes?since=2', undefined, token);
  assert.deepEqual(res.body, { rev: 3, more: false, items: [{ key: 'Arakhin 3', rev: 3, value: { note: { text: 'x' } } }] });
  // Another device, which last saw Arakhin 2 before revision 1, is refused for that item.
  res = await put([{ key: 'Arakhin 2', value: { reads: {} }, baseRev: 0 }, { key: 'Arakhin 4', value: { note: { text: 'y' } }, baseRev: 0 }]);
  assert.deepEqual(res.body.conflicts, [{ key: 'Arakhin 2', rev: 1, value: { reads: { '2a:1': ['2026-11-23'] } } }]);
  assert.deepEqual(res.body.written, [{ key: 'Arakhin 4', rev: 4 }]);
  // Deleting keeps an empty item so other devices hear about it.
  res = await put([{ key: 'Arakhin 3', value: null, baseRev: 3 }]);
  res = await s.call('GET', '/v1/changes?since=4', undefined, token);
  assert.deepEqual(res.body.items, [{ key: 'Arakhin 3', rev: 5, value: null }]);
});

test('large backups come back a page at a time', async () => {
  const s = testServer();
  const { body: { token } } = await signup(s);
  const names = ['Shabbat', 'Eruvin', 'Pesachim', 'Yevamot', 'Ketubot', 'Chullin', 'Menachot', 'Zevachim'];
  const items = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ key: `${names[Math.floor(i / 150)]} ${(i % 150) + 2}`, value: { n: i }, baseRev: 0 }));
  for (let i = 0; i < items.length; i += 500) await s.call('POST', '/v1/changes', { items: items.slice(i, i + 500) }, token);
  const first = (await s.call('GET', '/v1/changes?since=0', undefined, token)).body;
  assert.equal(first.items.length, PAGE_SIZE);
  assert.equal(first.more, true);
  const second = (await s.call('GET', `/v1/changes?since=${first.rev}`, undefined, token)).body;
  assert.equal(second.items.length, 5);
  assert.equal(second.more, false);
  assert.equal(second.rev, PAGE_SIZE + 5);
});

test('requests are checked', async () => {
  const s = testServer();
  const { body: { token } } = await signup(s);
  const bad = async (items) => (await s.call('POST', '/v1/changes', { items }, token)).status;
  assert.equal(await bad([{ key: 'DROP TABLE', value: null, baseRev: 0 }]), 400);
  assert.equal(await bad([{ key: 'Arakhin 2', value: [1], baseRev: 0 }]), 400);
  assert.equal(await bad([{ key: 'Arakhin 2', value: null, baseRev: -1 }]), 400);
  assert.equal(await bad('nope'), 400);
  assert.equal((await s.call('POST', '/v1/changes', 'not json', token)).status, 400);
  assert.equal((await s.call('POST', '/v1/changes', JSON.stringify({ items: [], pad: 'a'.repeat(MAX_BYTES) }), token)).status, 413);
  assert.equal((await s.call('GET', '/v1/nowhere')).status, 404);
  assert.equal((await s.call('GET', '/v1/login')).status, 405);
});

test('only the app\'s own website may call it from a browser', async () => {
  const s = testServer();
  const ok = await s.call('POST', '/v1/login', { username: 'x', password: 'y' }, null, { Origin: 'https://mendelcyprys.github.io' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://mendelcyprys.github.io');
  const other = await s.call('POST', '/v1/login', { username: 'x', password: 'y' }, null, { Origin: 'https://evil.example' });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await s.call('OPTIONS', '/v1/changes', undefined, null, { Origin: 'http://localhost:8000' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /POST/);
});
