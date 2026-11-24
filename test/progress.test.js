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
  assert.deepEqual(state.settings, { layout: 'both', fontScale: 1, rashi: true, rashiScript: false, rashiView: 'shown', textWidth: null, theme: 'auto' });
  assert.equal(P.normalizeState({ settings: { theme: 'dark' } }).settings.theme, 'dark');
  assert.equal(P.normalizeState({ settings: { theme: 'purple' } }).settings.theme, 'auto');
  assert.equal(P.normalizeState({ settings: { rashiView: 'buttons' } }).settings.rashiView, 'buttons');
  assert.equal(P.normalizeState({ settings: { rashiView: 'sideways' } }).settings.rashiView, 'shown');
  assert.deepEqual(state.bookmarks, {});
  assert.deepEqual(state.passageNotes, {});
  assert.deepEqual(state.recent, []);
  assert.equal(P.normalizeState({ settings: { textWidth: 1100.4 } }).settings.textWidth, 1100);
  assert.equal(P.normalizeState({ settings: { textWidth: 50 } }).settings.textWidth, null);
  assert.equal(P.normalizeState({ settings: { textWidth: 'wide' } }).settings.textWidth, null);
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

test('passages can be read again and again, and a read taken back', () => {
  const state = P.emptyState();
  P.addRead(state, arakhin, 2, '2a:3', day('2026-11-22'));
  P.addRead(state, arakhin, 2, '2a:3', day('2026-11-25'));
  assert.equal(P.readCount(state, arakhin, 2, '2a:3'), 2);
  assert.deepEqual(P.readDates(state, arakhin, 2, '2a:3'), ['2026-11-22', '2026-11-25']);
  assert.equal(P.readCount(state, arakhin, 2, '2a:4'), 0);
  P.removeRead(state, arakhin, 2, '2a:3');
  assert.deepEqual(P.readDates(state, arakhin, 2, '2a:3'), ['2026-11-22']);
  P.removeRead(state, arakhin, 2, '2a:3');
  P.removeRead(state, arakhin, 2, '2a:3'); // nothing left to take back
  assert.deepEqual(state.reads, {});
});

test('reading summary: times through, and passages ahead of that', () => {
  assert.deepEqual(P.readingSummary([0, 0, 0]), { total: 3, times: 0, ahead: 0, read: 0 });
  assert.deepEqual(P.readingSummary([1, 0, 2]), { total: 3, times: 0, ahead: 2, read: 2 });
  assert.deepEqual(P.readingSummary([1, 1, 1]), { total: 3, times: 1, ahead: 0, read: 3 });
  assert.deepEqual(P.readingSummary([2, 1, 3]), { total: 3, times: 1, ahead: 2, read: 3 });
  assert.deepEqual(P.readingSummary([]), { total: 0, times: 0, ahead: 0, read: 0 });
});

test('finishing a read-through tops up only the passages that need it', () => {
  const state = P.emptyState();
  const passages = ['2a:1', '2a:2', '2a:3'];
  P.addRead(state, arakhin, 2, '2a:2', TODAY);
  P.finishReading(state, arakhin, 2, passages, TODAY);
  assert.deepEqual(passages.map((p) => P.readCount(state, arakhin, 2, p)), [1, 1, 1]);
  P.finishReading(state, arakhin, 2, passages, TODAY);
  assert.deepEqual(passages.map((p) => P.readCount(state, arakhin, 2, p)), [2, 2, 2]);
});

test('passage reads survive loading and merge on import', () => {
  const loaded = P.normalizeState({
    reads: {
      'Arakhin 2': { '2a:1': ['2026-11-22', 'bad'], '2a:2': 'nope', '2a:3': [] },
      'Arakhin 99': { '2a:1': ['2026-11-22'] },
    },
  });
  assert.deepEqual(loaded.reads, { 'Arakhin 2': { '2a:1': ['2026-11-22'] } });

  const backup = P.emptyState();
  P.addRead(backup, arakhin, 2, '2a:1', TODAY);
  P.addRead(backup, arakhin, 2, '2a:1', TODAY);
  P.addRead(backup, arakhin, 3, '3a:1', TODAY);
  const merged = P.mergeStates(loaded, backup);
  assert.equal(P.readCount(merged, arakhin, 2, '2a:1'), 2);
  assert.equal(P.readCount(merged, arakhin, 3, '3a:1'), 1);
});

test('bookmarks: one per passage, with a label, newest first', () => {
  const state = P.emptyState();
  P.setBookmark(state, arakhin, 5, '5a:7', '', new Date('2026-11-22T10:00:00Z'));
  P.setBookmark(state, arakhin, 5, null, 'the whole daf', new Date('2026-11-22T11:00:00Z'));
  P.setBookmark(state, arakhin, 9, '9b:2', 'chatzi chatzi', new Date('2026-11-23T09:00:00Z'));
  P.setBookmark(state, arakhin, 5, '5a:7', 'erech vs damim', new Date('2026-11-24T09:00:00Z')); // relabel
  assert.equal(P.getBookmarks(state, arakhin, 5).length, 2);
  assert.equal(P.findBookmark(state, arakhin, 5, '5a:7').label, 'erech vs damim');
  assert.equal(P.findBookmark(state, arakhin, 5, '5a:8'), null);
  assert.deepEqual(P.allBookmarks(state).map((b) => `${b.tractate.en} ${b.daf} ${b.passage}`),
    ['Arakhin 9 9b:2', 'Arakhin 5 null', 'Arakhin 5 5a:7']);
  P.removeBookmark(state, arakhin, 5, '5a:7');
  P.removeBookmark(state, arakhin, 5, null);
  assert.equal(state.bookmarks['Arakhin 5'], undefined);
});

test('bookmarks are cleaned up when loaded and combined on import', () => {
  const loaded = P.normalizeState({
    bookmarks: {
      'Arakhin 5': [{ passage: '5a:7', label: 'x', created: '2026-11-22T10:00:00Z' }, { passage: '5a:7', label: 'dup' }, { passage: 'x'.repeat(99) }],
      'Nowhere 2': [{ passage: null }],
    },
  });
  assert.deepEqual(loaded.bookmarks, { 'Arakhin 5': [{ passage: '5a:7', label: 'x', created: '2026-11-22T10:00:00Z', updated: '2026-11-22T10:00:00Z' }] });
  const other = P.emptyState();
  P.setBookmark(other, arakhin, 5, '5a:7', 'newer label', new Date('2026-11-25T00:00:00Z'));
  P.setBookmark(other, arakhin, 6, null, '', new Date('2026-11-25T00:00:00Z'));
  const merged = P.mergeStates(loaded, other);
  assert.equal(P.findBookmark(merged, arakhin, 5, '5a:7').label, 'newer label');
  assert.ok(P.findBookmark(merged, arakhin, 6, null));
});

test('recent dafim: newest first, no repeats, keeping the passage you reached', () => {
  let list = [];
  list = P.addRecent(list, { index: 1, passage: '2a:4', at: 1 });
  list = P.addRecent(list, { index: 2, at: 2 });
  list = P.addRecent(list, { index: 1, at: 3 }); // back to the first: passage kept
  assert.deepEqual(list, [{ index: 1, passage: '2a:4', at: 3 }, { index: 2, passage: null, at: 2 }]);
  list = P.addRecent(list, { index: 1, passage: '2b:1', at: 4 });
  assert.equal(list[0].passage, '2b:1');
  for (let i = 10; i < 30; i++) list = P.addRecent(list, { index: i, at: i });
  assert.equal(list.length, P.RECENT_MAX);
});

test('notes on single passages, listed with the daf notes in page order', () => {
  const state = P.emptyState();
  const berakhot = S.findTractate('Berakhot');
  P.setPassageNote(state, arakhin, 5, '5b:1', 'b1');
  P.setPassageNote(state, arakhin, 5, '5a:12', 'a12');
  P.setPassageNote(state, arakhin, 5, '5a:7', 'a7');
  P.setNote(state, arakhin, 5, 'on the whole daf');
  P.setPassageNote(state, berakhot, 2, '2a:1', 'first');
  assert.equal(P.getPassageNote(state, arakhin, 5, '5a:7'), 'a7');
  assert.deepEqual(P.allNotes(state).map((n) => `${n.tractate.en} ${n.daf} ${n.passage}: ${n.text}`), [
    'Berakhot 2 2a:1: first',
    'Arakhin 5 null: on the whole daf',
    'Arakhin 5 5a:7: a7',
    'Arakhin 5 5a:12: a12',
    'Arakhin 5 5b:1: b1',
  ]);
  P.setPassageNote(state, arakhin, 5, '5a:7', '  ');
  assert.equal(P.getPassageNote(state, arakhin, 5, '5a:7'), '');
  for (const p of ['5a:12', '5b:1']) P.setPassageNote(state, arakhin, 5, p, '');
  assert.equal(state.passageNotes['Arakhin 5'], undefined);
});

test('passage notes are cleaned up when loaded and combined on import', () => {
  const loaded = P.normalizeState({ passageNotes: { 'Arakhin 5': { '5a:7': { text: 'kept', updated: '2026-11-22T00:00:00Z' }, '5a:8': { text: '  ' }, '5a:9': 'junk' }, 'Nowhere 2': { '1': { text: 'x' } } } });
  assert.deepEqual(loaded.passageNotes, { 'Arakhin 5': { '5a:7': { text: 'kept', updated: '2026-11-22T00:00:00Z' } } });
  const other = P.emptyState();
  P.setPassageNote(other, arakhin, 5, '5a:7', 'newer', new Date('2026-11-25T00:00:00Z'));
  P.setPassageNote(other, arakhin, 6, '6a:1', 'only there');
  const merged = P.mergeStates(loaded, other);
  assert.equal(P.getPassageNote(merged, arakhin, 5, '5a:7'), 'newer');
  assert.equal(P.getPassageNote(merged, arakhin, 6, '6a:1'), 'only there');
});

test('recent dafim from two devices combine: the latest visit to each, newest first', () => {
  const phone = [{ index: 5, passage: '2a:7', at: 300 }, { index: 4, passage: null, at: 100 }];
  const laptop = [{ index: 5, passage: '2a:3', at: 200 }, { index: 9, passage: '9b:1', at: 250 }];
  assert.deepEqual(P.mergeRecent(phone, laptop), [
    { index: 5, passage: '2a:7', at: 300 },
    { index: 9, passage: '9b:1', at: 250 },
    { index: 4, passage: null, at: 100 },
  ]);
  const many = Array.from({ length: 15 }, (_, i) => ({ index: i, passage: null, at: i }));
  assert.equal(P.mergeRecent(many, []).length, P.RECENT_MAX);
});

test('recent dafim are cleaned up when loaded, and kept on import', () => {
  const loaded = P.normalizeState({ recent: [{ index: 3, passage: '3a:1', at: 10 }, { index: -1, at: 5 }, { index: 2, at: 'x' }, 'junk', { index: 3, passage: null, at: 4 }] });
  assert.deepEqual(loaded.recent, [{ index: 3, passage: '3a:1', at: 10 }]);
  const merged = P.mergeStates(loaded, { recent: [{ index: 7, passage: null, at: 20 }] });
  assert.deepEqual(merged.recent.map((r) => r.index), [7, 3]);
});
