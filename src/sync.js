// Automatic backup, and keeping your devices in step, through the backup
// service in worker/.
//
// Every linked device shares one sync key, a long random code. A few seconds
// after each change the app fetches the backup and saves over it; it also
// checks for changes from your other devices when it opens, comes back into
// view, or comes back online. Each save names the backup revision it was
// based on. If another device has saved since, the service refuses and
// sends its copy; the two are combined (nothing is lost) and saved again.
// A device with no unsaved changes simply takes the backup as it is, so
// marking a daf unlearned or deleting a note on one device carries over to
// the others.
//
// Only your record is synced (start, learned, notes, reads); display settings
// stay with each device.

import { normalizeState, mergeStates } from './progress.js';
import { SYNC_URL } from './config.js';

const STORAGE_KEY = 'daf-yomi:sync';
const URL_OVERRIDE_KEY = 'daf-yomi:sync-url'; // for testing against a local service
const SAVE_DELAY = 4000;
const RECHECK_EVERY = 5 * 60 * 1000;
const KEY_ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789'; // no i, l, o, u: easy to read out

/** The parts of your record that are synced. */
export function syncPayload(state) {
  const { version, start, learned, notes, reads } = state;
  return { version, start, learned, notes, reads };
}

/**
 * What to do with the backup just fetched, given the revision this device
 * last synced and whether it has changes not yet saved:
 *   none     the backup and this device already agree
 *   push     save this device's record over the backup
 *   replace  take the backup's record (it's newer, and nothing here is unsaved)
 *   merge    both have changed: combine them, then save
 */
export function planPull({ rev, dirty }, remote) {
  if (!remote.data) return dirty || rev !== remote.rev ? 'push' : 'none';
  if (remote.rev === rev) return dirty ? 'push' : 'none';
  return dirty ? 'merge' : 'replace';
}

/** A new sync key: 32 characters, 160 random bits. */
export function newSyncKey(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(32)].map((b) => KEY_ALPHABET[b % 32]).join('');
}

/** Find a sync key in a pasted link or code (spaces and dashes are ignored). */
export function parseSyncKey(text) {
  const fromLink = /#\/sync\/([a-z0-9]+)/i.exec(text || '');
  const candidate = (fromLink ? fromLink[1] : String(text || '')).toLowerCase().replace(/[\s-]/g, '');
  return /^[a-z0-9]{24,64}$/.test(candidate) ? candidate : null;
}

/** The link that links another device: this page's address with the key after #. */
export function syncLink(key, base = `${location.origin}${location.pathname}`) {
  return `${base}#/sync/${key}`;
}

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function serviceUrl() {
  try {
    return localStorage.getItem(URL_OVERRIDE_KEY) || SYNC_URL;
  } catch {
    return SYNC_URL;
  }
}

const hasRecord = (state) => Boolean(state.start)
  || ['learned', 'notes', 'reads'].some((k) => Object.keys(state[k] || {}).length);

/**
 * getState()        the app's current record
 * applyRemote(s)    replace the app's record with s (synced from elsewhere)
 * onStatus(status)  { enabled, state: 'off'|'syncing'|'saved'|'pending'|'offline'|'error', lastSynced, message }
 */
export function createSync({ getState, applyRemote, onStatus }) {
  let config = loadConfig(); // { key, rev, dirty, lastSynced }
  let lastSyncedJson = null; // the record as last agreed with the backup, this visit
  let busy = false;
  let again = false;
  let timer = 0;
  let changes = 0;
  let current = { state: 'off' };

  const available = () => Boolean(serviceUrl());

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Without storage the app can't remember anything anyway.
    }
  }

  function report(next) {
    current = next;
    onStatus({ ...next, enabled: Boolean(config.key), lastSynced: config.lastSynced || null, key: config.key || null });
  }

  async function call(method, body, { keepalive = false } = {}) {
    const res = await fetch(`${serviceUrl()}/v1/state`, {
      method,
      cache: 'no-store',
      keepalive,
      headers: { Authorization: `Bearer ${config.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok || res.status === 409) return { status: res.status, body: await res.json() };
    throw new Error(`the backup service answered ${res.status}`);
  }

  function agreed(rev, payload) {
    config.rev = rev;
    config.lastSynced = new Date().toISOString();
    lastSyncedJson = JSON.stringify(payload);
    save();
  }

  async function syncNow() {
    if (!config.key || !available()) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    clearTimeout(timer);
    report({ state: 'syncing' });
    try {
      for (let attempt = 0; ; attempt++) {
        if (attempt === 4) throw new Error('other devices kept saving at the same moment');
        const remote = (await call('GET')).body;
        const plan = planPull({ rev: config.rev || 0, dirty: Boolean(config.dirty) }, remote);
        if (plan === 'none') {
          agreed(remote.rev, syncPayload(getState()));
          break;
        }
        if (plan === 'replace') {
          applyRemote(normalizeState(remote.data));
          agreed(remote.rev, syncPayload(getState()));
          break;
        }
        if (plan === 'merge') applyRemote(mergeStates(getState(), remote.data));
        const payload = syncPayload(getState());
        const seen = changes;
        if (remote.data && JSON.stringify(payload) === JSON.stringify(remote.data)) {
          agreed(remote.rev, payload);
        } else {
          const res = await call('PUT', { baseRev: remote.rev, data: payload });
          if (res.status === 409) continue; // another device saved in between: fetch again and combine
          agreed(res.body.rev, payload);
        }
        config.dirty = changes !== seen;
        save();
        break;
      }
      report({ state: config.dirty ? 'pending' : 'saved' });
    } catch (error) {
      report({ state: navigator.onLine === false ? 'offline' : 'error', message: error.message });
    } finally {
      busy = false;
    }
    if (again || config.dirty) {
      again = false;
      schedule(config.dirty ? SAVE_DELAY : 0);
    }
  }

  function schedule(delay = SAVE_DELAY) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, delay);
  }

  /** Call after every local save; does nothing if the synced record didn't change. */
  function changed(state) {
    if (!config.key) return;
    const json = JSON.stringify(syncPayload(state));
    if (json === lastSyncedJson && !config.dirty) return;
    changes++;
    config.dirty = true;
    save();
    if (current.state !== 'syncing') report({ state: 'pending' });
    schedule();
  }

  // Leaving the page: save straight away if there's anything unsaved. A
  // conflict here is fine; it'll be combined next time the app opens.
  function flush() {
    if (!config.key || !config.dirty || busy) return;
    const body = { baseRev: config.rev || 0, data: syncPayload(getState()) };
    if (JSON.stringify(body).length > 60000) return; // too big to send while closing
    call('PUT', body, { keepalive: true }).then((res) => {
      if (res.status === 200) {
        agreed(res.body.rev, body.data);
        config.dirty = false;
        save();
      }
    }).catch(() => {});
  }

  let lastCheck = 0;
  function check() {
    if (!config.key || Date.now() - lastCheck < 15000) return;
    lastCheck = Date.now();
    syncNow();
  }

  function start() {
    if (!available()) return;
    report({ state: config.key ? 'pending' : 'off' });
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
    if (config.key) syncNow();
  }

  /** Start backing up with a new key, or link to an existing backup with one. */
  function enable(key = newSyncKey()) {
    config = { key, rev: 0, dirty: hasRecord(getState()), lastSynced: null };
    lastSyncedJson = null;
    save();
    syncNow();
    return key;
  }

  /** Stop syncing on this device. The backup and this device's record both stay. */
  function disable() {
    clearTimeout(timer);
    config = {};
    lastSyncedJson = null;
    save();
    report({ state: 'off' });
  }

  return { start, enable, disable, changed, syncNow, available, status: () => ({ ...current, enabled: Boolean(config.key), lastSynced: config.lastSynced || null, key: config.key || null }) };
}
