// Loading the text of a daf from Sefaria (https://www.sefaria.org).
//
// Sefaria's API is free, needs no key and allows requests from any website.
// For most tractates the reference is simply "Arakhin 5". Three are
// different: Shekalim is studied from the Jerusalem Talmud, and Kinnim and
// Middot have Mishnah but no Gemara. For those we ask Sefaria's own Daf Yomi
// calendar which passage belongs to that day. Its calendar only covers the
// current cycle, but every cycle since 1975 is laid out the same way, so we
// always ask about the matching day of cycle 14.
const CALENDAR_CYCLE = 14;

import { dateForIndex, dafAtIndex, cycleStartIndex } from './schedule.js';

const API = 'https://www.sefaria.org/api';
const VIA_CALENDAR = new Set(['Shekalim', 'Kinnim', 'Middot']);
const cache = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJSON(url, attempt = 0) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  // Sefaria limits how fast one visitor can ask for texts; wait and try again.
  if (res.status === 429 && attempt < 2) {
    await wait(2000 * (attempt + 1));
    return getJSON(url, attempt + 1);
  }
  if (!res.ok) {
    const error = new Error(`Sefaria answered ${res.status} ${res.statusText}`.trim());
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/** The Sefaria reference for the daf at an index, e.g. "Arakhin 5". */
export async function resolveRef(index) {
  const { tractate, daf, dayOfCycle } = dafAtIndex(index);
  if (!VIA_CALENDAR.has(tractate.en)) return `${tractate.en} ${daf}`;
  const date = dateForIndex(cycleStartIndex(CALENDAR_CYCLE) + dayOfCycle);
  const data = await getJSON(
    `${API}/calendars?year=${date.getFullYear()}&month=${date.getMonth() + 1}&day=${date.getDate()}`,
  );
  const item = (data.calendar_items || []).find((i) => i.title?.en === 'Daf Yomi');
  if (!item?.ref) throw new Error("Sefaria's calendar didn't list a Daf Yomi passage for that day");
  return item.ref;
}

/** Link to a reference on the Sefaria website. */
export function sefariaUrl(ref) {
  const m = /^(.*?) (\d.*)$/.exec(ref);
  const path = m ? `${m[1].replace(/ /g, '_')}.${m[2].replace(/:/g, '.')}` : ref.replace(/ /g, '_');
  return `https://www.sefaria.org/${encodeURI(path)}?lang=bi`;
}

const flatten = (x) => (Array.isArray(x) ? x.flatMap(flatten) : [x]);

/**
 * Reshape Sefaria's answer into
 *   { ref, heRef, sections: [{ label, he: [...], en: [...] }], versions: { he, en } }
 * A daf comes back as two amudim ("5a", "5b"), each a list of passages.
 * Other texts may come back as a flat list, or nested by chapter.
 */
export function normalizeText(data) {
  const he = (data.versions || []).find((v) => v.language === 'he');
  const en = (data.versions || []).find((v) => v.language === 'en');
  const heText = he?.text ?? [];
  const enText = en?.text ?? [];
  const nested = Array.isArray(heText[0]) || Array.isArray(enText[0]);

  const title = data.book || data.indexTitle || '';
  const shortLabel = (ref) => (title && ref.startsWith(`${title} `) ? ref.slice(title.length + 1) : ref);

  let sections;
  if (nested) {
    const count = Math.max(heText.length, enText.length);
    const labels = data.spanningRefs || [];
    sections = Array.from({ length: count }, (_, i) => ({
      label: shortLabel(labels[i] || `${data.ref} (${i + 1})`),
      he: flatten(heText[i] ?? []),
      en: flatten(enText[i] ?? []),
    }));
  } else {
    sections = [{ label: shortLabel(data.ref), he: flatten(heText), en: flatten(enText) }];
  }
  sections = sections.filter((s) => s.he.some(Boolean) || s.en.some(Boolean));

  const info = (v) => (v ? { title: v.versionTitle, license: v.license, source: v.versionSource } : null);
  return { ref: data.ref, heRef: data.heRef, sections, versions: { he: info(he), en: info(en) } };
}

/** Load the daf at an index, with the Aramaic/Hebrew text and an English translation. */
export function loadDaf(index) {
  if (!cache.has(index)) {
    const promise = (async () => {
      const ref = await resolveRef(index);
      const data = await getJSON(
        `${API}/v3/texts/${encodeURIComponent(ref)}?version=source&version=english`,
      );
      return normalizeText(data);
    })();
    cache.set(index, promise);
    promise.catch(() => cache.delete(index)); // let a retry try again
  }
  return cache.get(index);
}

// ---------------------------------------------------------------------------
// Rashi
//
// Sefaria splits Rashi into the same passages as the Gemara, so comment
// number n on 5a explains passage n of 5a. Rashi covers almost all of the
// Bavli; in Bava Batra his grandson the Rashbam takes over partway through
// 29a. Shekalim (Yerushalmi), Kinnim, Tamid and Middot have no Rashi.

export const COMMENTATORS = {
  Rashi: { he: 'רש״י' },
  Rashbam: { he: 'רשב״ם' },
};
const COMMENTARY_FOR = { 'Bava Batra': ['Rashi', 'Rashbam'] };
const NO_RASHI = new Set(['Shekalim', 'Kinnim', 'Tamid', 'Middot']);

export function hasRashi(tractate) {
  return !NO_RASHI.has(tractate.en);
}

/** Depth of nested lists down to the first string ("a" = 0, ["a"] = 1, ...). */
function depthOf(x) {
  if (!Array.isArray(x)) return 0;
  for (const item of x) {
    const d = depthOf(item);
    if (d > 0 || typeof item === 'string') return d + 1;
  }
  return 1;
}

/**
 * Reshape a commentary on a daf (or a single amud) into
 *   [{ label: '5a', passages: [[comment, ...], ...] }]
 * where passages[n] holds the comments on passage n of the Gemara.
 */
export function normalizeCommentary(data) {
  const version = (data.versions || []).find((v) => v.language === 'he') || (data.versions || [])[0];
  if (!version) return [];
  const title = data.book || data.indexTitle || '';
  const shortLabel = (ref) => (title && ref.startsWith(`${title} `) ? ref.slice(title.length + 1) : ref);
  const text = version.text || [];
  const amudim = depthOf(text) >= 3 ? text : [text];
  const labels = depthOf(text) >= 3 ? data.spanningRefs || [] : [data.ref];
  return amudim.map((passages, i) => ({
    label: shortLabel(labels[i] || ''),
    passages: (passages || []).map((comments) => (Array.isArray(comments) ? comments.filter(Boolean) : [comments].filter(Boolean))),
  }));
}

/**
 * Put several commentaries together, amud by amud and passage by passage:
 *   { '5a': [[{ author: 'Rashi', text }, ...], ...], ... }
 */
export function mergeCommentaries(list) {
  const byAmud = {};
  for (const { author, amudim } of list) {
    for (const { label, passages } of amudim) {
      byAmud[label] ??= [];
      passages.forEach((comments, n) => {
        byAmud[label][n] ??= [];
        for (const text of comments) byAmud[label][n].push({ author, text });
      });
    }
  }
  return byAmud;
}

/**
 * Split a comment into its opening words (the dibbur hamatchil, the words of
 * the Gemara being explained) and the explanation, which Sefaria's Vilna
 * text separates with " - ".
 */
export function splitDibbur(text) {
  const at = text.indexOf(' - ');
  if (at <= 0 || at > 200) return { dibbur: '', rest: text };
  return { dibbur: text.slice(0, at), rest: text.slice(at + 3) };
}

const rashiCache = new Map();

/**
 * Load Rashi (and Rashbam, in Bava Batra) for the daf at an index.
 * Resolves to { byAmud, authors, versions } or null when there is none.
 */
export function loadRashi(index) {
  if (!rashiCache.has(index)) {
    const promise = (async () => {
      const { tractate, daf } = dafAtIndex(index);
      if (!hasRashi(tractate)) return null;
      const found = [];
      for (const author of COMMENTARY_FOR[tractate.en] || ['Rashi']) {
        try {
          const data = await getJSON(
            `${API}/v3/texts/${encodeURIComponent(`${author} on ${tractate.en} ${daf}`)}?version=source`,
          );
          const version = (data.versions || [])[0];
          found.push({ author, amudim: normalizeCommentary(data), version: version?.versionTitle });
        } catch (error) {
          if (error.status !== 404) throw error; // 404: this commentator has nothing on this daf
        }
      }
      const total = found.reduce((n, f) => n + f.amudim.reduce((m, a) => m + a.passages.flat().length, 0), 0);
      if (!total) return null;
      return {
        byAmud: mergeCommentaries(found),
        authors: found.map((f) => f.author),
        versions: [...new Set(found.map((f) => f.version).filter(Boolean))],
      };
    })();
    rashiCache.set(index, promise);
    promise.catch(() => rashiCache.delete(index));
  }
  return rashiCache.get(index);
}
