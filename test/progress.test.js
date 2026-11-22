import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/schedule.js';
import * as P from '../src/progress.js';

const arakhin = S.findTractate('Arakhin');
const at = (daf, cycle = 14) => S.indexFor(cycle, arakhin, daf);
const day = (iso) => S.parseIsoDate(iso);
const TODAY = day('2026-11-22'); // Arakhin 5

function learn(state, dafs, iso = '2026-11-22') {
  for (const d of dafs) P.setLearned(state, at(d), true, day(iso));
}

test('no position until you choose where to start', () => {
  const state = P.emptyState();
  assert.equal(P.position(state), null);
  assert.equal(P.behind(state, S.indexForDate(TODAY)), 0);
});

test('starting from the beginning of Arakhin puts you 3 dafim behind', () => {
  const state = P.emptyState();
  P.setStart(state, at(2));
  assert.deepEqual(state.start, { cycle: 14, tractate: 'Arakhin', daf: 2 });
  assert.equal(P.position(state), at(2));
  assert.equal(P.behind(state, S.indexForDate(TODAY)), 3);
});

test('your daf is the first one from your start you have not learned', () => {
  const state = P.emptyState();
  P.setStart(state, at(2));
  learn(state, [2, 3, 5]); // learned today's daf with everyone, skipped 4
  assert.equal(P.position(state), at(4));
  learn(state, [4]);
  assert.equal(P.position(state), at(6));
  assert.equal(P.behind(state, S.indexForDate(TODAY)), -1); // caught up, today included
});

test('your position carries on into the next tractate', () => {
  const state = P.emptyState();
  P.setStart(state, at(33));
  learn(state, [33, 34]);
  const r = S.dafAtIndex(P.position(state));
  assert.equal(`${r.tractate.en} ${r.daf}`, 'Temurah 2');
});

test('catch-up plans', () => {
  assert.equal(P.catchUpDays(0, 2), 0);
  assert.equal(P.catchUpDays(-2, 2), 0);
  assert.equal(P.catchUpDays(3, 2), 3); // 2 a day: 3 days
  assert.equal(P.catchUpDays(3, 3), 2); // 3 a day: 2 days
  assert.equal(P.catchUpDays(3, 1), Infinity);
});

test('a catch-up plan really does catch you up', () => {
  for (const gap of [1, 2, 3, 7, 20]) {
    for (const perDay of [2, 3]) {
      const k = P.catchUpDays(gap, perDay);
      // After k days you have learned up to (today - gap) + perDay*k - 1,
      // and the schedule is on today + k - 1.
      assert.ok(-gap + perDay * k - 1 >= k - 1, `gap ${gap}, ${perDay}/day`);
      assert.ok(-gap + perDay * (k - 1) - 1 < k - 2, `gap ${gap}, ${perDay}/day is the fewest days`);
    }
  }
});

test('learned dafim belong to a cycle', () => {
  const state = P.emptyState();
  learn(state, [2]);
  assert.equal(P.isLearned(state, at(2, 14)), true);
  assert.equal(P.isLearned(state, at(2, 15)), false);
  assert.deepEqual(P.tractateProgress(state, 14, arakhin), { learned: 1, total: 33 });
  assert.equal(P.cycleProgress(state, 14).learned, 1);
  assert.equal(P.cycleProgress(state, 15).learned, 0);
  P.setLearned(state, at(2), false, TODAY);
  assert.equal(P.isLearned(state, at(2)), false);
});

test('finishing a tractate', () => {
  const state = P.emptyState();
  learn(state, Array.from({ length: 32 }, (_, i) => i + 2));
  assert.equal(P.tractateComplete(state, 14, arakhin), false);
  learn(state, [34]);
  assert.equal(P.tractateComplete(state, 14, arakhin), true);
});

test('streak counts days with any learning, up to today or yesterday', () => {
  const state = P.emptyState();
  assert.equal(P.streak(state, TODAY), 0);
  learn(state, [2], '2026-11-19');
  learn(state, [3], '2026-11-20');
  learn(state, [4], '2026-11-21');
  assert.equal(P.streak(state, TODAY), 3); // not yet today: still counts
  learn(state, [5, 6], '2026-11-22');
  assert.equal(P.streak(state, TODAY), 4);
  assert.equal(P.streak(state, day('2026-11-24')), 0);
});

test('review suggestions come from a day, a week and a month ago', () => {
  const state = P.emptyState();
  learn(state, [2], '2026-10-23');
  learn(state, [3, 4], '2026-11-15');
  learn(state, [5], '2026-11-21');
  const r = P.reviewSuggestions(state, TODAY);
  assert.deepEqual(r.map((x) => x.label), ['Yesterday', 'A week ago', 'A month ago']);
  assert.deepEqual(r[1].indexes, [at(3), at(4)]);
});

test('notes are kept per daf, across cycles, in Shas order', () => {
  const state = P.emptyState();
  const berakhot = S.findTractate('Berakhot');
  P.setNote(state, arakhin, 5, 'Erech vs. damim');
  P.setNote(state, berakhot, 2, 'Kriat Shema at night');
  assert.equal(P.getNote(state, arakhin, 5), 'Erech vs. damim');
  assert.deepEqual(P.allNotes(state).map((n) => `${n.tractate.en} ${n.daf}`), ['Berakhot 2', 'Arakhin 5']);
  P.setNote(state, arakhin, 5, '   ');
  assert.equal(P.getNote(state, arakhin, 5), '');
});

test('saved state is cleaned up when loaded', () => {
  const state = P.normalizeState({
    start: { cycle: 14, tractate: 'Arakhin', daf: 99 },
    learned: { '14/Arakhin/2': '2026-11-22', '14/Arakhin/99': '2026-11-22', junk: 'x', '14/Arakhin/3': 'not a date' },
    notes: { 'Arakhin 2': { text: 'ok', updated: '2026-11-22T00:00:00Z' }, 'Nowhere 2': { text: 'x' } },
    settings: { layout: 'sideways', fontScale: 50 },
  });
  assert.equal(state.start, null);
  assert.deepEqual(Object.keys(state.learned), ['14/Arakhin/2']);
  assert.deepEqual(Object.keys(state.notes), ['Arakhin 2']);
  assert.deepEqual(state.settings, { layout: 'both', fontScale: 1, rashi: true, rashiScript: false });
  assert.equal(P.normalizeState({ settings: { rashi: false } }).settings.rashi, false);
  assert.equal(P.normalizeState({ settings: { rashiScript: true } }).settings.rashiScript, true);
  assert.deepEqual(P.normalizeState(null), P.emptyState());
});

test('importing a backup merges without losing anything', () => {
  const here = P.emptyState();
  learn(here, [2], '2026-11-22');
  P.setNote(here, arakhin, 2, 'newer', new Date('2026-11-22T10:00:00Z'));
  const backup = P.emptyState();
  P.setStart(backup, at(2));
  learn(backup, [2], '2026-11-19');
  learn(backup, [3], '2026-11-20');
  P.setNote(backup, arakhin, 2, 'older', new Date('2026-11-19T10:00:00Z'));
  P.setNote(backup, arakhin, 3, 'only in backup');

  const merged = P.mergeStates(here, backup);
  assert.equal(merged.learned['14/Arakhin/2'], '2026-11-19');
  assert.equal(merged.learned['14/Arakhin/3'], '2026-11-20');
  assert.equal(P.getNote(merged, arakhin, 2), 'newer');
  assert.equal(P.getNote(merged, arakhin, 3), 'only in backup');
  assert.deepEqual(merged.start, { cycle: 14, tractate: 'Arakhin', daf: 2 });
});
