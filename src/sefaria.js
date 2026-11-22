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
  if (!res.ok) throw new Error(`Sefaria answered ${res.status} ${res.statusText}`.trim());
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
