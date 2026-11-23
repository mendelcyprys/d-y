// The backup service running in memory for tests: the real handler, account
// and store logic, on Node's built-in SQLite instead of Durable Objects.
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../worker/src/handler.js';
import { accounts } from '../worker/src/accounts.js';
import { userStore } from '../worker/src/store.js';

function nodeDb() {
  const db = new DatabaseSync(':memory:');
  return {
    all: (query, ...params) => db.prepare(query).all(...params),
    run: (query, ...params) => {
      db.prepare(query).run(...params);
    },
  };
}

export function testServer({ now } = {}) {
  const clock = { t: Date.UTC(2026, 10, 23) };
  const api = accounts(nodeDb(), { iterations: 1000, now: now || (() => clock.t) });
  const stores = new Map();
  const deps = {
    accounts: () => api,
    store: (id) => {
      if (!stores.has(id)) stores.set(id, userStore(nodeDb()));
      return stores.get(id);
    },
  };
  const env = { ALLOWED_ORIGINS: 'https://mendelcyprys.github.io,http://localhost:8000' };
  const base = 'https://sync.test';
  return {
    clock,
    stores,
    base,
    // A fetch that goes straight to the handler.
    fetch: (url, init = {}) => handle(new Request(url, init), env, deps),
    async call(method, path, body, token, headers = {}) {
      const res = await handle(new Request(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }), env, deps);
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, body: data, headers: res.headers };
    },
  };
}
