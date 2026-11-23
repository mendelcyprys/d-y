// Your account, automatic backup, and keeping your devices in step, through
// the backup service in worker/.
//
// You create an account (username and password) and log in on each device.
// Your record is backed up in pieces: one per daf you've touched ("Arakhin 5":
// when you learned it, your note, your passage reads) plus your starting
// point. A few seconds after a change, only the pieces that changed are sent;
// when the app opens, comes back into view or comes back online, it asks only
// for the pieces changed since it last looked. So each backup stays small
// however much you've learned.
//
// Each saved piece has a revision number. A device saving a piece says which
// revision it last saw; if another device has changed that piece since, the
// service sends its version back instead, the two are combined (nothing is
// lost) and saved again. A piece you haven't changed here simply takes the
// other device's version, so deletions (unmarking a daf, taking back a read,
// clearing a note) carry over too.
//
// Only your record is synced; display settings stay with each device.

import { normalizeState, mergeStates, emptyState } from './progress.js';
import { SYNC_URL } from './config.js';

const ACCOUNT_KEY = 'daf-yomi:account';
const URL_OVERRIDE_KEY = 'daf-yomi:sync-url'; // for testing against a local service
const SAVE_DELAY = 3000;
const RECHECK_EVERY = 5 * 60 * 1000;
const BATCH_BYTES = 500_000;
const BATCH_ITEMS = 1000;
const CLOSING_BYTES = 60_000; // the most a browser will send while a page closes

// ---------------------------------------------------------------------------
// Pieces of the record

/** The parts of your record that are synced. */
export function syncPayload(state) {
  const { version, start, learned, notes, reads } = state;
  return { version, start, learned, notes, reads };
}

/** JSON with object keys in a fixed order, so equal values always match. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A short fingerprint of some text (53-bit cyrb53). */
export function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const itemHash = (value) => hashString(stableStringify(value ?? null));

/**
 * Split a record into pieces: { start: {...}, 'Arakhin 5': { learned: { 14: date }, note, reads } }.
 * Dafim with nothing on them have no piece.
 */
export function toItems(state) {
  const items = {};
  if (state.start) items.start = { ...state.start };
  const piece = (key) => (items[key] ??= {});
  for (const [key, date] of Object.entries(state.learned)) {
    const [cycle, tractate, daf] = key.split('/');
    (piece(`${tractate} ${daf}`).learned ??= {})[cycle] = date;
  }
  for (const [key, note] of Object.entries(state.notes)) piece(key).note = note;
  for (const [key, reads] of Object.entries(state.reads)) piece(key).reads = reads;
  return items;
}

/** Put one piece into a record, replacing whatever it had for that daf (null removes it). */
export function applyItem(state, key, value) {
  if (key === 'start') {
    state.start = value || null;
    return;
  }
  const m = /^(.+) (\d+)$/.exec(key);
  if (!m) return;
  const [, tractate, daf] = m;
  for (const k of Object.keys(state.learned)) {
    const [, t, d] = k.split('/');
    if (t === tractate && d === daf) delete state.learned[k];
  }
  delete state.notes[key];
  delete state.reads[key];
  if (!value) return;
  for (const [cycle, date] of Object.entries(value.learned || {})) state.learned[`${cycle}/${tractate}/${daf}`] = date;
  if (value.note) state.notes[key] = value.note;
  if (value.reads) state.reads[key] = value.reads;
}

/** Combine two versions of a piece, keeping everything from both. */
export function mergeItem(key, a, b) {
  const one = emptyState();
  const two = emptyState();
  applyItem(one, key, a);
  applyItem(two, key, b);
  return toItems(mergeStates(one, two))[key] ?? null;
}

/** The pieces that differ from what was last agreed with the backup. */
export function dirtyKeys(items, hashes) {
  const keys = new Set([...Object.keys(items), ...Object.keys(hashes)]);
  return [...keys].filter((key) => itemHash(items[key]) !== (hashes[key] ?? itemHash(null)));
}

// ---------------------------------------------------------------------------
// The sync engine

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultServiceUrl() {
  try {
    return localStorage.getItem(URL_OVERRIDE_KEY) || SYNC_URL;
  } catch {
    return SYNC_URL;
  }
}

class ServiceError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * getState()          the app's current record
 * applyRemote(state)  replace the app's record with this one (from another device)
 * onStatus(status)    see status() below
 * fetch, storage, serviceUrl, now: replaceable for tests.
 */
export function createSync({
  getState,
  applyRemote,
  onStatus = () => {},
  fetch: fetchImpl = (...args) => fetch(...args),
  storage = browserStorage(),
  serviceUrl = defaultServiceUrl,
  now = () => Date.now(),
}) {
  // { username, token, cursor, revs: { key: rev }, hashes: { key: hash }, lastSynced, recoveryCode }
  let account = {};
  try {
    account = JSON.parse(storage?.getItem(ACCOUNT_KEY)) || {};
  } catch {
    account = {};
  }
  let busy = false;
  let again = false;
  let timer = 0;
  let current = { state: account.token ? 'pending' : 'off' };

  const available = () => Boolean(serviceUrl());

  function save() {
    try {
      storage?.setItem(ACCOUNT_KEY, JSON.stringify(account));
    } catch {
      // Without storage the app can't remember anything anyway.
    }
  }

  function status() {
    return {
      ...current,
      enabled: Boolean(account.token),
      username: account.username || null,
      signedOut: !account.token && Boolean(account.username),
      lastSynced: account.lastSynced || null,
      recoveryCode: account.recoveryCode || null,
    };
  }

  function report(state, message) {
    current = { state, message };
    onStatus(status());
  }

  async function call(method, path, body, { auth = true, keepalive = false } = {}) {
    let res;
    try {
      res = await fetchImpl(`${serviceUrl()}${path}`, {
        method,
        cache: 'no-store',
        keepalive,
        headers: {
          ...(auth && account.token ? { Authorization: `Bearer ${account.token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ServiceError("Couldn't reach the backup service. Are you online?", { code: 'offline' });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401 && auth) {
      // The session has ended (password changed elsewhere, or logged out).
      account.token = null;
      save();
      throw new ServiceError('Please log in again.', { status: 401, code: 'signed_out' });
    }
    if (!res.ok) throw new ServiceError(data?.message || `The backup service answered ${res.status}.`, { status: res.status, code: data?.error });
    return data;
  }

  // ---- Taking in pieces from the backup (synchronous, so nothing you do in
  // the meantime can be overwritten).
  function takeIn(pieces) {
    const record = getState();
    const mine = toItems(record);
    const next = structuredClone(record);
    for (const { key, rev, value } of pieces) {
      const here = mine[key] ?? null;
      const unchangedHere = itemHash(here) === (account.hashes[key] ?? itemHash(null));
      applyItem(next, key, unchangedHere ? value : mergeItem(key, here, value));
      account.revs[key] = rev;
      account.hashes[key] = itemHash(value);
    }
    const clean = normalizeState(next);
    clean.settings = record.settings;
    applyRemote(clean);
  }

  async function pull() {
    for (;;) {
      const res = await call('GET', `/v1/changes?since=${account.cursor || 0}`);
      if (res.items.length) takeIn(res.items);
      account.cursor = res.rev;
      save();
      if (!res.more) return;
    }
  }

  function unsavedPieces() {
    const items = toItems(getState());
    return dirtyKeys(items, account.hashes).map((key) => ({ key, value: items[key] ?? null, baseRev: account.revs[key] ?? 0 }));
  }

  function batches(pieces) {
    const out = [];
    let batch = [];
    let size = 0;
    for (const piece of pieces) {
      const n = JSON.stringify(piece).length;
      if (batch.length && (size + n > BATCH_BYTES || batch.length >= BATCH_ITEMS)) {
        out.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(piece);
      size += n;
    }
    if (batch.length) out.push(batch);
    return out;
  }

  function saved(batch, res) {
    const sent = new Map(batch.map((p) => [p.key, p.value]));
    for (const { key, rev } of res.written) {
      account.revs[key] = rev;
      account.hashes[key] = itemHash(sent.get(key));
    }
    // If nobody else saved in between, there's no need to fetch these back.
    if (res.revBefore === account.cursor) account.cursor = res.rev;
  }

  /** Send the changed pieces. Returns how many came back changed by another device. */
  async function push() {
    let conflicts = 0;
    for (const batch of batches(unsavedPieces())) {
      const res = await call('POST', '/v1/changes', { items: batch });
      saved(batch, res);
      if (res.conflicts.length) {
        takeIn(res.conflicts);
        conflicts += res.conflicts.length;
      }
      save();
    }
    return conflicts;
  }

  let running = Promise.resolve();

  /** Back up now (and take in other devices' changes). Resolves when done. */
  function syncNow() {
    if (!account.token || !available()) return Promise.resolve();
    if (busy) {
      again = true;
      return running;
    }
    running = syncOnce();
    return running;
  }

  async function syncOnce() {
    busy = true;
    clearTimeout(timer);
    report('syncing');
    let ok = false;
    try {
      await pull();
      for (let round = 0; (await push()) > 0; round++) {
        if (round === 4) throw new ServiceError('Other devices kept saving at the same moment.');
      }
      account.lastSynced = new Date(now()).toISOString();
      save();
      ok = true;
      report(unsavedPieces().length ? 'pending' : 'saved');
    } catch (error) {
      if (error.code === 'signed_out') report('signed-out', error.message);
      else report(error.code === 'offline' ? 'offline' : 'error', error.message);
    } finally {
      busy = false;
    }
    if (again || (ok && unsavedPieces().length)) {
      again = false;
      schedule(ok ? SAVE_DELAY : 0);
    }
  }

  function schedule(delay = SAVE_DELAY) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, delay);
  }

  /** Call after every local save. */
  function changed() {
    if (!account.token) return;
    if (current.state !== 'syncing') report('pending');
    schedule();
  }

  // Leaving the page: send anything unsaved straight away, if it's small
  // enough for the browser to send while closing. If not, or if another
  // device changed the same daf, it's sorted out next time the app opens.
  function flush() {
    if (!account.token || busy) return;
    const pieces = unsavedPieces();
    if (!pieces.length || JSON.stringify(pieces).length > CLOSING_BYTES) return;
    call('POST', '/v1/changes', { items: pieces }, { keepalive: true }).then((res) => {
      saved(pieces, res);
      save();
    }).catch(() => {});
  }

  let lastCheck = 0;
  function check() {
    if (!account.token || now() - lastCheck < 15000) return;
    lastCheck = now();
    syncNow();
  }

  /** Begin: sync now, and whenever the app comes back into view or online. */
  function start() {
    if (!available()) return;
    report(account.token ? 'pending' : account.username ? 'signed-out' : 'off');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
      else flush();
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', () => {
      lastCheck = 0;
      check();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') syncNow();
    }, RECHECK_EVERY);
    if (account.token) syncNow();
  }

  // ---- Account

  // A fresh start with an account: everything already on this device is
  // combined with what's in the account.
  async function begin(res, extra = {}) {
    account = { username: res.username, token: res.token, cursor: 0, revs: {}, hashes: {}, lastSynced: null, ...extra };
    save();
    await syncNow();
  }

  async function signup(username, password) {
    const res = await call('POST', '/v1/signup', { username, password }, { auth: false });
    await begin(res, { recoveryCode: res.recoveryCode });
    return res.username;
  }

  async function login(username, password) {
    await begin(await call('POST', '/v1/login', { username, password }, { auth: false }));
  }

  async function recover(username, recoveryCode, newPassword) {
    const res = await call('POST', '/v1/recover', { username, recoveryCode, newPassword }, { auth: false });
    await begin(res, { recoveryCode: res.recoveryCode });
  }

  async function changePassword(password, newPassword) {
    const res = await call('POST', '/v1/password', { password, newPassword });
    account.token = res.token;
    save();
  }

  /** Log out on this device. Returns false (and stays logged in) if there are changes not yet backed up, unless forced. */
  async function logout({ force = false } = {}) {
    if (account.token) await syncNow();
    if (account.token && !force && unsavedPieces().length) return false;
    try {
      if (account.token) await call('POST', '/v1/logout', {});
    } catch {
      // Logging out here matters more than telling the service.
    }
    clearTimeout(timer);
    account = {};
    save();
    report('off');
    return true;
  }

  async function deleteAccount(password) {
    await call('POST', '/v1/delete-account', { password });
    clearTimeout(timer);
    account = {};
    save();
    report('off');
  }

  function acknowledgeRecoveryCode() {
    delete account.recoveryCode;
    save();
    onStatus(status());
  }

  return {
    start, syncNow, changed, available, status,
    signup, login, recover, changePassword, logout, deleteAccount, acknowledgeRecoveryCode,
    hasUnsavedChanges: () => Boolean(account.token) && unsavedPieces().length > 0,
    /** Which pieces have changes not yet backed up: daf names like "Arakhin 5", and "start". */
    unsavedKeys: () => (account.token ? unsavedPieces().map((p) => p.key) : []),
  };
}
