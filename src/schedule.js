// Daf Yomi schedule calculator.
//
// The modern Daf Yomi cycle runs through 2,711 dafim, one per day. Cycle 8
// began on 24 June 1975 and every cycle since has the same length, so the
// daf for any date can be worked out with simple arithmetic.
//
// Each tractate is listed with its first and last daf as studied in Daf Yomi.
// Kinnim, Tamid and Middot are printed after Me'ilah in the Vilna Shas and
// continue its page numbering, so they start partway through the 20s and 30s.

export const TRACTATES = [
  // Seder Zeraim
  { en: 'Berakhot', he: 'ברכות', start: 2, end: 64, seder: 'Zeraim' },
  // Seder Moed
  { en: 'Shabbat', he: 'שבת', start: 2, end: 157, seder: 'Moed' },
  { en: 'Eruvin', he: 'עירובין', start: 2, end: 105, seder: 'Moed' },
  { en: 'Pesachim', he: 'פסחים', start: 2, end: 121, seder: 'Moed' },
  { en: 'Shekalim', he: 'שקלים', start: 2, end: 22, seder: 'Moed' },
  { en: 'Yoma', he: 'יומא', start: 2, end: 88, seder: 'Moed' },
  { en: 'Sukkah', he: 'סוכה', start: 2, end: 56, seder: 'Moed' },
  { en: 'Beitzah', he: 'ביצה', start: 2, end: 40, seder: 'Moed' },
  { en: 'Rosh Hashanah', he: 'ראש השנה', start: 2, end: 35, seder: 'Moed' },
  { en: 'Taanit', he: 'תענית', start: 2, end: 31, seder: 'Moed' },
  { en: 'Megillah', he: 'מגילה', start: 2, end: 32, seder: 'Moed' },
  { en: 'Moed Katan', he: 'מועד קטן', start: 2, end: 29, seder: 'Moed' },
  { en: 'Chagigah', he: 'חגיגה', start: 2, end: 27, seder: 'Moed' },
  // Seder Nashim
  { en: 'Yevamot', he: 'יבמות', start: 2, end: 122, seder: 'Nashim' },
  { en: 'Ketubot', he: 'כתובות', start: 2, end: 112, seder: 'Nashim' },
  { en: 'Nedarim', he: 'נדרים', start: 2, end: 91, seder: 'Nashim' },
  { en: 'Nazir', he: 'נזיר', start: 2, end: 66, seder: 'Nashim' },
  { en: 'Sotah', he: 'סוטה', start: 2, end: 49, seder: 'Nashim' },
  { en: 'Gittin', he: 'גיטין', start: 2, end: 90, seder: 'Nashim' },
  { en: 'Kiddushin', he: 'קידושין', start: 2, end: 82, seder: 'Nashim' },
  // Seder Nezikin
  { en: 'Bava Kamma', he: 'בבא קמא', start: 2, end: 119, seder: 'Nezikin' },
  { en: 'Bava Metzia', he: 'בבא מציעא', start: 2, end: 119, seder: 'Nezikin' },
  { en: 'Bava Batra', he: 'בבא בתרא', start: 2, end: 176, seder: 'Nezikin' },
  { en: 'Sanhedrin', he: 'סנהדרין', start: 2, end: 113, seder: 'Nezikin' },
  { en: 'Makkot', he: 'מכות', start: 2, end: 24, seder: 'Nezikin' },
  { en: 'Shevuot', he: 'שבועות', start: 2, end: 49, seder: 'Nezikin' },
  { en: 'Avodah Zarah', he: 'עבודה זרה', start: 2, end: 76, seder: 'Nezikin' },
  { en: 'Horayot', he: 'הוריות', start: 2, end: 14, seder: 'Nezikin' },
  // Seder Kodashim
  { en: 'Zevachim', he: 'זבחים', start: 2, end: 120, seder: 'Kodashim' },
  { en: 'Menachot', he: 'מנחות', start: 2, end: 110, seder: 'Kodashim' },
  { en: 'Chullin', he: 'חולין', start: 2, end: 142, seder: 'Kodashim' },
  { en: 'Bekhorot', he: 'בכורות', start: 2, end: 61, seder: 'Kodashim' },
  { en: 'Arakhin', he: 'ערכין', start: 2, end: 34, seder: 'Kodashim' },
  { en: 'Temurah', he: 'תמורה', start: 2, end: 34, seder: 'Kodashim' },
  { en: 'Keritot', he: 'כריתות', start: 2, end: 28, seder: 'Kodashim' },
  { en: 'Meilah', he: 'מעילה', start: 2, end: 22, seder: 'Kodashim' },
  { en: 'Kinnim', he: 'קינים', start: 23, end: 25, seder: 'Kodashim' },
  { en: 'Tamid', he: 'תמיד', start: 26, end: 33, seder: 'Kodashim' },
  { en: 'Middot', he: 'מדות', start: 34, end: 37, seder: 'Kodashim' },
  // Seder Tahorot
  { en: 'Niddah', he: 'נדה', start: 2, end: 73, seder: 'Tahorot' },
];

// Number of days each tractate takes, and the day of the cycle it begins on.
let offset = 0;
for (const t of TRACTATES) {
  t.days = t.end - t.start + 1;
  t.offset = offset;
  offset += t.days;
}

export const CYCLE_LENGTH = offset; // 2711

// Cycle 8 began on 24 June 1975. Dates are handled as whole days in UTC so
// that time zones and daylight-saving changes never shift the result.
const FIRST_MODERN_CYCLE = 8;
const DAY_MS = 86400000;
const START_DAY = Date.UTC(1975, 5, 24) / DAY_MS;

// Every daf studied since then has an "index": the number of days between
// 24 June 1975 and the day it is (or was) studied. Index 0 is Berakhot 2 of
// cycle 8, and today's daf has the index of today's date. Working with
// indexes makes it easy to compare "where I am" with "where the schedule is".

/** Whole days since 1970-01-01 for a local calendar date. */
export function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** A local Date (at midnight) for a day number. */
export function dateFromDayNumber(n) {
  const d = new Date(n * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Local date as "YYYY-MM-DD". */
export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse "YYYY-MM-DD" as a local date, or null if it isn't one. */
export function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoDate(d) === s ? d : null;
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Index of the daf studied on a date. */
export function indexForDate(date) {
  const index = dayNumber(date) - START_DAY;
  if (index < 0) throw new RangeError('Dates before 24 June 1975 are not supported');
  return index;
}

/** The date a daf is studied, from its index. */
export function dateForIndex(index) {
  return dateFromDayNumber(START_DAY + index);
}

/**
 * The daf at an index: { tractate, daf, cycle, dayOfCycle, index }.
 * dayOfCycle is 0-based (0 = Berakhot 2).
 */
export function dafAtIndex(index) {
  const cycle = FIRST_MODERN_CYCLE + Math.floor(index / CYCLE_LENGTH);
  const dayOfCycle = index % CYCLE_LENGTH;
  let i = TRACTATES.length - 1;
  while (TRACTATES[i].offset > dayOfCycle) i--;
  const tractate = TRACTATES[i];
  return { tractate, daf: tractate.start + (dayOfCycle - tractate.offset), cycle, dayOfCycle, index };
}

/** The daf studied on a date. */
export function dafForDate(date) {
  return dafAtIndex(indexForDate(date));
}

/** Index of a tractate's daf in a given cycle. */
export function indexFor(cycle, tractate, daf) {
  if (!Number.isInteger(daf) || daf < tractate.start || daf > tractate.end) {
    throw new RangeError(`${tractate.en} runs from daf ${tractate.start} to ${tractate.end}`);
  }
  return (cycle - FIRST_MODERN_CYCLE) * CYCLE_LENGTH + tractate.offset + (daf - tractate.start);
}

/** Index of the first daf (Berakhot 2) of a cycle. */
export function cycleStartIndex(cycle) {
  return (cycle - FIRST_MODERN_CYCLE) * CYCLE_LENGTH;
}

/** The date on which a daf is studied in a given cycle. */
export function dateForDaf(tractate, daf, cycle) {
  return dateForIndex(indexFor(cycle, tractate, daf));
}

// ---------------------------------------------------------------------------
// Looking tractates up by name.

function simplify(name) {
  return String(name).toLowerCase().replace(/[^a-z]/g, '');
}

/** URL-friendly name, e.g. "Bava Kamma" -> "bava-kamma". */
export function slug(tractate) {
  return tractate.en.toLowerCase().replace(/[^a-z]+/g, '-');
}

export function findTractate(name) {
  const key = simplify(name);
  return TRACTATES.find((t) => simplify(t.en) === key || t.he === name);
}

// ---------------------------------------------------------------------------
// Hebrew numerals (gematria) for daf numbers, e.g. 15 -> ט״ו, 120 -> ק״כ.

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

export function hebrewNumeral(n) {
  let s = HUNDREDS[Math.floor(n / 100)];
  const rest = n % 100;
  if (rest === 15) s += 'טו';
  else if (rest === 16) s += 'טז';
  else s += TENS[Math.floor(rest / 10)] + ONES[rest % 10];
  return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
}
