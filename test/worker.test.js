import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, MAX_BYTES } from '../worker/src/handler.js';

const env = { ALLOWED_ORIGINS: 'https://mendelcyprys.github.io,http://localhost:8000' };
const KEY = 'abcdefghjkmnpqrstvwxyz0123456789';

// The same behaviour as the Durable Object, in memory.
function memoryStores() {
  const stores = new Map();
  return async (key) => {
    if (!stores.has(key)) {
      let row = null;
      stores.set(key, {
        read: () => (row ? { rev: row.rev, updated: row.updated, data: JSON.parse(row.data) } : { rev: 0, updated: null, data: null }),
        write(baseRev, data) {
          const current = row?.rev ?? 0;
          if (current !== baseRev) return { conflict: true, ...this.read() };
          row = { rev: current + 1, updated: '2026-11-23T00:00:00.000Z', data };
          return { rev: row.rev, updated: row.updated };
        },
      });
    }
    return stores.get(key);
  };
}

const request = (method, body, { key = KEY, origin = 'https://mendelcyprys.github.io', path = '/v1/state' } = {}) => new Request(`https://sync.example${path}`, {
  method,
  headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

test('an empty backup reads as revision 0', async () => {
  const res = await handle(request('GET'), env, memoryStores());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rev: 0, updated: null, data: null });
});

test('saving moves the revision on, and reads back what was saved', async () => {
  const open = memoryStores();
  let res = await handle(request('PUT', { baseRev: 0, data: { notes: { 'Arakhin 2': { text: 'x' } } } }), env, open);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, 1);
  res = await handle(request('GET'), env, open);
  assert.deepEqual((await res.json()).data, { notes: { 'Arakhin 2': { text: 'x' } } });
});

test('saving over a newer backup is refused and returns it, so the app can combine them', async () => {
  const open = memoryStores();
  await handle(request('PUT', { baseRev: 0, data: { a: 1 } }), env, open);
  await handle(request('PUT', { baseRev: 1, data: { a: 2 } }), env, open);
  const res = await handle(request('PUT', { baseRev: 1, data: { a: 3 } }), env, open);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { rev: 2, updated: '2026-11-23T00:00:00.000Z', data: { a: 2 } });
});

test('each sync key has its own backup', async () => {
  const open = memoryStores();
  await handle(request('PUT', { baseRev: 0, data: { mine: true } }), env, open);
  const res = await handle(request('GET', undefined, { key: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzz' }), env, open);
  assert.equal((await res.json()).rev, 0);
});

test('a missing or malformed key is refused', async () => {
  for (const key of [null, 'short', 'Has-Capitals-And-Dashes-1234567890']) {
    const res = await handle(request('GET', undefined, { key }), env, memoryStores());
    assert.equal(res.status, 401, String(key));
  }
});

test('bad bodies are refused', async () => {
  for (const body of ['not json', { data: {} }, { baseRev: -1, data: {} }, { baseRev: 0, data: [1] }, { baseRev: 0 }]) {
    const res = await handle(request('PUT', body), env, memoryStores());
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const big = await handle(request('PUT', JSON.stringify({ baseRev: 0, data: { x: 'a'.repeat(MAX_BYTES) } })), env, memoryStores());
  assert.equal(big.status, 413);
});

test('only the app\'s own website may call it from a browser', async () => {
  const ok = await handle(request('GET'), env, memoryStores());
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://mendelcyprys.github.io');
  const other = await handle(request('GET', undefined, { origin: 'https://evil.example' }), env, memoryStores());
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await handle(request('OPTIONS', undefined, { origin: 'http://localhost:8000' }), env, memoryStores());
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('other paths and methods', async () => {
  assert.equal((await handle(request('GET', undefined, { path: '/nope' }), env, memoryStores())).status, 404);
  assert.equal((await handle(request('DELETE'), env, memoryStores())).status, 405);
  assert.equal((await handle(request('GET', undefined, { path: '/' }), env, memoryStores())).status, 200);
});
