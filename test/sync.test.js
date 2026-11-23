import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPull, syncPayload, newSyncKey, parseSyncKey, syncLink } from '../src/sync.js';
import { emptyState } from '../src/progress.js';

test('deciding what to do with the backup', () => {
  const empty = { rev: 0, data: null };
  const saved = (rev) => ({ rev, data: { learned: {} } });
  // First device turning backup on: nothing stored yet.
  assert.equal(planPull({ rev: 0, dirty: true }, empty), 'push');
  assert.equal(planPull({ rev: 0, dirty: false }, empty), 'none');
  // The backup was lost: save this device's copy again.
  assert.equal(planPull({ rev: 7, dirty: false }, empty), 'push');
  // Nothing new anywhere.
  assert.equal(planPull({ rev: 3, dirty: false }, saved(3)), 'none');
  // Changes here only.
  assert.equal(planPull({ rev: 3, dirty: true }, saved(3)), 'push');
  // Changes on another device only: take them (deletions carry over too).
  assert.equal(planPull({ rev: 3, dirty: false }, saved(5)), 'replace');
  // A new device with nothing of its own.
  assert.equal(planPull({ rev: 0, dirty: false }, saved(5)), 'replace');
  // Changes in both places: combine.
  assert.equal(planPull({ rev: 3, dirty: true }, saved(5)), 'merge');
});

test('only the record is synced, not display settings', () => {
  const state = emptyState();
  state.settings.textWidth = 1400;
  assert.deepEqual(Object.keys(syncPayload(state)).sort(), ['learned', 'notes', 'reads', 'start', 'version']);
});

test('sync keys are long, random and easy to read', () => {
  const key = newSyncKey();
  assert.match(key, /^[a-hj-km-np-tv-z0-9]{32}$/);
  assert.notEqual(newSyncKey(), key);
  assert.equal(newSyncKey(() => new Uint8Array(32)), 'a'.repeat(32));
});

test('a key can be pasted as the link, or as a code with spaces or dashes', () => {
  const key = 'abcdefghjkmnpqrstvwxyz0123456789';
  assert.equal(parseSyncKey(`https://mendelcyprys.github.io/d-y/#/sync/${key}`), key);
  assert.equal(parseSyncKey(' ABCD-EFGH JKMN-PQRS tvwx-yz01 2345-6789 '), key);
  assert.equal(parseSyncKey('too short'), null);
  assert.equal(parseSyncKey(''), null);
  assert.equal(syncLink(key, 'https://mendelcyprys.github.io/d-y/'), `https://mendelcyprys.github.io/d-y/#/sync/${key}`);
});
