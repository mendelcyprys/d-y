// Your learning record, and everything worked out from it.
//
// Nothing here touches the browser, so it can be tested in Node.
//
// State shape:
//   {
//     version: 1,
//     start: { cycle: 14, tractate: 'Arakhin', daf: 2 } | null,
//     learned: { '14/Arakhin/2': '2026-11-22', ... },   // daf -> date learned
//     notes: { 'Arakhin 2': { text: '...', updated: '2026-11-22T18:00:00.000Z' } },
//     reads: { 'Arakhin 2': { '2a:3': ['2026-11-22', '2026-11-25'] } },  // passage -> each read
//     settings: { layout: 'both' | 'he' | 'en', fontScale: 1, rashi: true, rashiScript: false,
//                 textWidth: null | pixels }
//   }
//
// Learned dafim are kept per cycle, so learning Arakhin 2 now doesn't mark it
// as learned when it comes round again in seven and a half years. Notes and
// passage reads are about the daf itself, so they carry over between cycles.

import {
  TRACTATES, CYCLE_LENGTH, dafAtIndex, indexFor, findTractate,
  isoDate, parseIsoDate, addDays,
} from './schedule.js';

export const LAYOUTS = ['both', 'he', 'en'];

/** Narrowest the text column can be dragged to, in pixels. */
export const MIN_TEXT_WIDTH = 480;

export function emptyState() {
  return {
    version: 1,
    start: null,
    learned: {},
    notes: {},
    reads: {},
    settings: { layout: 'both', fontScale: 1, rashi: true, rashiScript: false, textWidth: null },
  };
}

// ---------------------------------------------------------------------------
// Keys

export function learnedKey(index) {
  const { cycle, tractate, daf } = dafAtIndex(index);
  return `${cycle}/${tractate.en}/${daf}`;
}

/** Index for a learned key, or null if the key isn't valid. */
export function indexFromLearnedKey(key) {
  const m = /^(\d+)\/([A-Za-z ]+)\/(\d+)$/.exec(key);
  if (!m) return null;
  const tractate = findTractate(m[2]);
  if (!tractate) return null;
  try {
    return indexFor(Number(m[1]), tractate, Number(m[3]));
  } catch {
    return null;
  }
}

export function noteKey(tractate, daf) {
  return `${tractate.en} ${daf}`;
}

/** { tractate, daf } for a key like "Arakhin 5", or null. */
function parseDafKey(key) {
  const m = /^(.+) (\d+)$/.exec(key);
  const tractate = m && findTractate(m[1]);
  const daf = m && Number(m[2]);
  return tractate && daf >= tractate.start && daf <= tractate.end ? { tractate, daf } : null;
}

// ---------------------------------------------------------------------------
// Learned

export function isLearned(state, index) {
  return Boolean(state.learned[learnedKey(index)]);
}

export function learnedDate(state, index) {
  return state.learned[learnedKey(index)] || null;
}

export function setLearned(state, index, learned, today) {
  const key = learnedKey(index);
  if (learned) state.learned[key] = isoDate(today);
  else delete state.learned[key];
}

// ---------------------------------------------------------------------------
// Where you are

export function startIndex(state) {
  if (!state.start) return null;
  const tractate = findTractate(state.start.tractate);
  if (!tractate) return null;
  try {
    return indexFor(state.start.cycle, tractate, state.start.daf);
  } catch {
    return null;
  }
}

export function setStart(state, index) {
  const { cycle, tractate, daf } = dafAtIndex(index);
  state.start = { cycle, tractate: tractate.en, daf };
}

/**
 * Your daf: the first daf from your starting point that you haven't learned
 * yet. Learning ahead or out of order is fine; this always points at the
 * earliest gap. Returns null until a starting point is chosen.
 */
export function position(state) {
  let index = startIndex(state);
  if (index == null) return null;
  const limit = index + 2 * CYCLE_LENGTH;
  while (index < limit && isLearned(state, index)) index++;
  return index;
}

/**
 * How many dafim you are behind the daily schedule.
 * 0 means your daf is today's daf; negative means you're ahead.
 */
export function behind(state, todayIndex) {
  const pos = position(state);
  return pos == null ? 0 : todayIndex - pos;
}

/**
 * Days of learning `perDay` dafim a day needed to catch up with the schedule,
 * including each day's new daf. Starting today, after k days you have learned
 * perDay * k dafim while the schedule has moved on k, so you are caught up
 * once perDay * k >= gap + k.
 */
export function catchUpDays(gap, perDay) {
  if (gap <= 0) return 0;
  if (perDay <= 1) return Infinity;
  return Math.ceil(gap / (perDay - 1));
}

// ---------------------------------------------------------------------------
// Counts

export function tractateProgress(state, cycle, tractate) {
  const first = indexFor(cycle, tractate, tractate.start);
  let learned = 0;
  for (let i = 0; i < tractate.days; i++) if (isLearned(state, first + i)) learned++;
  return { learned, total: tractate.days };
}

export function cycleProgress(state, cycle) {
  const prefix = `${cycle}/`;
  let learned = 0;
  for (const key of Object.keys(state.learned)) if (key.startsWith(prefix)) learned++;
  return { learned, total: CYCLE_LENGTH };
}

/** True when every daf of the tractate is learned in that cycle. */
export function tractateComplete(state, cycle, tractate) {
  const { learned, total } = tractateProgress(state, cycle, tractate);
  return learned === total;
}

/**
 * Days in a row on which you learned at least one daf, counting back from
 * today (or from yesterday, if you haven't learned yet today).
 */
export function streak(state, today) {
  const days = new Set(Object.values(state.learned));
  let day = days.has(isoDate(today)) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(isoDate(day))) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** Indexes of the dafim you learned on a date, in order. */
export function learnedOn(state, date) {
  const iso = isoDate(date);
  return Object.entries(state.learned)
    .filter(([, d]) => d === iso)
    .map(([key]) => indexFromLearnedKey(key))
    .filter((i) => i != null)
    .sort((a, b) => a - b);
}

/**
 * Review (chazarah) suggestions: what you learned yesterday, a week ago and a
 * month ago. Reviewing at growing intervals is one of the best ways to
 * remember what you learn.
 */
export const REVIEW_INTERVALS = [
  { days: 1, label: 'Yesterday' },
  { days: 7, label: 'A week ago' },
  { days: 30, label: 'A month ago' },
];

export function reviewSuggestions(state, today) {
  return REVIEW_INTERVALS.map(({ days, label }) => ({
    label,
    date: addDays(today, -days),
    indexes: learnedOn(state, addDays(today, -days)),
  })).filter((r) => r.indexes.length > 0);
}

// ---------------------------------------------------------------------------
// Notes

export function getNote(state, tractate, daf) {
  return state.notes[noteKey(tractate, daf)]?.text || '';
}

export function setNote(state, tractate, daf, text, now = new Date()) {
  const key = noteKey(tractate, daf);
  if (text.trim()) state.notes[key] = { text, updated: now.toISOString() };
  else delete state.notes[key];
}

/** All notes in the order of the Shas: [{ tractate, daf, text, updated }]. */
export function allNotes(state) {
  const order = new Map(TRACTATES.map((t, i) => [t.en, i]));
  return Object.entries(state.notes)
    .map(([key, note]) => {
      const found = parseDafKey(key);
      return found ? { ...found, text: note.text, updated: note.updated } : null;
    })
    .filter(Boolean)
    .sort((a, b) => order.get(a.tractate.en) - order.get(b.tractate.en) || a.daf - b.daf);
}

// ---------------------------------------------------------------------------
// Reading passages
//
// Each passage of a daf (as Sefaria divides the text) can be marked as read
// as many times as you read it. A passage is named by its amud and number,
// e.g. "2a:3"; when the two languages don't line up the whole amud is one
// passage, "2a:all". Every read is kept with its date.

export function readDates(state, tractate, daf, passage) {
  return state.reads[noteKey(tractate, daf)]?.[passage] || [];
}

export function readCount(state, tractate, daf, passage) {
  return readDates(state, tractate, daf, passage).length;
}

export function addRead(state, tractate, daf, passage, today) {
  const reads = (state.reads[noteKey(tractate, daf)] ??= {});
  (reads[passage] ??= []).push(isoDate(today));
}

/** Take back the most recent read of a passage. */
export function removeRead(state, tractate, daf, passage) {
  const key = noteKey(tractate, daf);
  const list = state.reads[key]?.[passage];
  if (!list?.length) return;
  list.pop();
  if (!list.length) delete state.reads[key][passage];
  if (!Object.keys(state.reads[key]).length) delete state.reads[key];
}

/**
 * Finish a read-through of some passages (an amud, say): every passage that
 * hasn't yet been read as many times as this read-through gets one more read.
 */
export function finishReading(state, tractate, daf, passages, today) {
  if (!passages.length) return;
  const target = Math.min(...passages.map((p) => readCount(state, tractate, daf, p))) + 1;
  for (const p of passages) {
    if (readCount(state, tractate, daf, p) < target) addRead(state, tractate, daf, p, today);
  }
}

/**
 * Sum up read counts: how many times the whole thing has been read through
 * (the fewest reads of any passage), how many passages are ahead of that,
 * and how many have been read at all.
 */
export function readingSummary(counts) {
  const total = counts.length;
  const times = total ? Math.min(...counts) : 0;
  return {
    total,
    times,
    ahead: counts.filter((c) => c > times).length,
    read: counts.filter((c) => c > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Loading, importing and merging

/** Turn anything that might be saved state into valid state, dropping junk. */
export function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;

  if (raw.start && typeof raw.start === 'object') {
    const tractate = findTractate(raw.start.tractate);
    const cycle = Number(raw.start.cycle);
    const daf = Number(raw.start.daf);
    if (tractate && Number.isInteger(cycle) && cycle >= 8 && daf >= tractate.start && daf <= tractate.end) {
      state.start = { cycle, tractate: tractate.en, daf };
    }
  }

  for (const [key, date] of Object.entries(raw.learned || {})) {
    if (indexFromLearnedKey(key) != null && parseIsoDate(date)) state.learned[key] = date;
  }

  for (const [key, note] of Object.entries(raw.notes || {})) {
    const found = parseDafKey(key);
    if (!found || typeof note?.text !== 'string' || !note.text.trim()) continue;
    const { tractate, daf } = found;
    state.notes[noteKey(tractate, daf)] = {
      text: note.text,
      updated: typeof note.updated === 'string' ? note.updated : new Date(0).toISOString(),
    };
  }

  for (const [key, passages] of Object.entries(raw.reads || {})) {
    const found = parseDafKey(key);
    if (!found || !passages || typeof passages !== 'object') continue;
    for (const [passage, dates] of Object.entries(passages)) {
      if (passage.length > 60 || !Array.isArray(dates)) continue;
      const valid = dates.filter((d) => parseIsoDate(d)).slice(-1000);
      if (valid.length) (state.reads[noteKey(found.tractate, found.daf)] ??= {})[passage] = valid;
    }
  }

  const settings = raw.settings || {};
  if (LAYOUTS.includes(settings.layout)) state.settings.layout = settings.layout;
  const scale = Number(settings.fontScale);
  if (scale >= 0.7 && scale <= 2) state.settings.fontScale = scale;
  if (typeof settings.rashi === 'boolean') state.settings.rashi = settings.rashi;
  if (typeof settings.rashiScript === 'boolean') state.settings.rashiScript = settings.rashiScript;
  const width = Number(settings.textWidth);
  if (settings.textWidth != null && width >= MIN_TEXT_WIDTH && width <= 6000) state.settings.textWidth = Math.round(width);

  return state;
}

/**
 * Combine an imported backup with what's already here, keeping everything:
 * a daf learned in either is learned (with the earlier date), and for notes
 * on the same daf the more recently edited one wins.
 */
export function mergeStates(current, incoming) {
  const a = normalizeState(current);
  const b = normalizeState(incoming);
  const merged = normalizeState(a);

  for (const [key, date] of Object.entries(b.learned)) {
    if (!merged.learned[key] || date < merged.learned[key]) merged.learned[key] = date;
  }
  for (const [key, note] of Object.entries(b.notes)) {
    if (!merged.notes[key] || note.updated > merged.notes[key].updated) merged.notes[key] = note;
  }
  // For passage reads, keep whichever copy has more reads of each passage.
  for (const [key, passages] of Object.entries(b.reads)) {
    for (const [passage, dates] of Object.entries(passages)) {
      const mine = merged.reads[key]?.[passage] || [];
      if (dates.length > mine.length) (merged.reads[key] ??= {})[passage] = dates;
    }
  }
  if (!merged.start) merged.start = b.start;
  return merged;
}
