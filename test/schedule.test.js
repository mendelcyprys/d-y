import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/schedule.js';

// Every tractate's first and last day in cycle 14, checked against Sefaria's
// Daf Yomi calendar.
const SEFARIA = `
2020-01-05 Berakhot 2|2020-03-07 Berakhot 64|2020-03-08 Shabbat 2|2020-08-10 Shabbat 157
2020-08-11 Eruvin 2|2020-11-22 Eruvin 105|2020-11-23 Pesachim 2|2021-03-22 Pesachim 121
2021-03-23 Shekalim 2|2021-04-12 Shekalim 22|2021-04-13 Yoma 2|2021-07-08 Yoma 88
2021-07-09 Sukkah 2|2021-09-01 Sukkah 56|2021-09-02 Beitzah 2|2021-10-10 Beitzah 40
2021-10-11 Rosh Hashanah 2|2021-11-13 Rosh Hashanah 35|2021-11-14 Taanit 2|2021-12-13 Taanit 31
2021-12-14 Megillah 2|2022-01-13 Megillah 32|2022-01-14 Moed Katan 2|2022-02-10 Moed Katan 29
2022-02-11 Chagigah 2|2022-03-08 Chagigah 27|2022-03-09 Yevamot 2|2022-07-07 Yevamot 122
2022-07-08 Ketubot 2|2022-10-26 Ketubot 112|2022-10-27 Nedarim 2|2023-01-24 Nedarim 91
2023-01-25 Nazir 2|2023-03-30 Nazir 66|2023-03-31 Sotah 2|2023-05-17 Sotah 49
2023-05-18 Gittin 2|2023-08-14 Gittin 90|2023-08-15 Kiddushin 2|2023-11-03 Kiddushin 82
2023-11-04 Bava Kamma 2|2024-02-29 Bava Kamma 119|2024-03-01 Bava Metzia 2|2024-06-26 Bava Metzia 119
2024-06-27 Bava Batra 2|2024-12-18 Bava Batra 176|2024-12-19 Sanhedrin 2|2025-04-09 Sanhedrin 113
2025-04-10 Makkot 2|2025-05-02 Makkot 24|2025-05-03 Shevuot 2|2025-06-19 Shevuot 49
2025-06-20 Avodah Zarah 2|2025-09-02 Avodah Zarah 76|2025-09-03 Horayot 2|2025-09-15 Horayot 14
2025-09-16 Zevachim 2|2026-01-12 Zevachim 120|2026-01-13 Menachot 2|2026-05-01 Menachot 110
2026-05-02 Chullin 2|2026-09-19 Chullin 142|2026-09-20 Bekhorot 2|2026-11-18 Bekhorot 61
2026-11-19 Arakhin 2|2026-11-22 Arakhin 5|2026-12-21 Arakhin 34|2026-12-22 Temurah 2
2027-01-23 Temurah 34|2027-01-24 Keritot 2|2027-02-19 Keritot 28|2027-02-20 Meilah 2
2027-03-12 Meilah 22|2027-03-16 Tamid 26|2027-03-23 Tamid 33|2027-03-28 Niddah 2
2027-06-07 Niddah 73`
  .trim().split(/[|\n]/).map((s) => {
    const [, date, name, daf] = /^(\S+) (.+) (\d+)$/.exec(s.trim());
    return { date, name, daf: Number(daf) };
  });

test('the cycle is 2,711 dafim', () => {
  assert.equal(S.CYCLE_LENGTH, 2711);
});

test('matches Sefaria at the start and end of every tractate in cycle 14', () => {
  for (const { date, name, daf } of SEFARIA) {
    const r = S.dafForDate(S.parseIsoDate(date));
    assert.equal(`${r.tractate.en} ${r.daf}`, `${name} ${daf}`, date);
    assert.equal(r.cycle, 14, date);
  }
});

test('the minor tractates after Meilah follow its page numbers', () => {
  const at = (iso) => { const r = S.dafForDate(S.parseIsoDate(iso)); return `${r.tractate.en} ${r.daf}`; };
  assert.equal(at('2027-03-13'), 'Kinnim 23');
  assert.equal(at('2027-03-15'), 'Kinnim 25');
  assert.equal(at('2027-03-24'), 'Middot 34');
  assert.equal(at('2027-03-27'), 'Middot 37');
});

test('cycles follow each other with no gap', () => {
  const r = S.dafForDate(new Date(2027, 5, 8));
  assert.equal(r.cycle, 15);
  assert.equal(r.tractate.en, 'Berakhot');
  assert.equal(r.daf, 2);
  const first = S.dafForDate(new Date(1975, 5, 24));
  assert.deepEqual([first.cycle, first.tractate.en, first.daf], [8, 'Berakhot', 2]);
  assert.throws(() => S.dafForDate(new Date(1975, 5, 23)), RangeError);
});

test('index, date and daf convert back and forth', () => {
  const arakhin = S.findTractate('Arakhin');
  const index = S.indexFor(14, arakhin, 2);
  assert.equal(S.isoDate(S.dateForIndex(index)), '2026-11-19');
  assert.equal(S.indexForDate(new Date(2026, 10, 19)), index);
  assert.equal(S.dafAtIndex(index + 3).daf, 5);
  assert.throws(() => S.indexFor(14, arakhin, 1), RangeError);
  assert.throws(() => S.indexFor(14, arakhin, 35), RangeError);
});

test('dates do not drift across daylight-saving changes', () => {
  for (let d = new Date(2026, 0, 1); d < new Date(2027, 0, 1); d = S.addDays(d, 1)) {
    assert.equal(S.isoDate(S.dateForIndex(S.indexForDate(d))), S.isoDate(d));
  }
});

test('finds tractates by name, slug and Hebrew', () => {
  assert.equal(S.findTractate('bava kamma').en, 'Bava Kamma');
  assert.equal(S.findTractate('Bava-Kamma').en, 'Bava Kamma');
  assert.equal(S.findTractate('ערכין').en, 'Arakhin');
  assert.equal(S.slug(S.findTractate('Rosh Hashanah')), 'rosh-hashanah');
  assert.equal(S.findTractate('Nonesuch'), undefined);
});

test('Hebrew numerals', () => {
  const cases = { 2: 'ב׳', 5: 'ה׳', 10: 'י׳', 15: 'ט״ו', 16: 'ט״ז', 34: 'ל״ד', 73: 'ע״ג', 100: 'ק׳', 115: 'קט״ו', 120: 'ק״כ', 157: 'קנ״ז', 176: 'קע״ו' };
  for (const [n, he] of Object.entries(cases)) assert.equal(S.hebrewNumeral(Number(n)), he, n);
});

test('ISO dates', () => {
  assert.equal(S.isoDate(new Date(2026, 10, 2)), '2026-11-02');
  assert.equal(S.parseIsoDate('2026-02-30'), null);
  assert.equal(S.parseIsoDate('nonsense'), null);
  assert.equal(S.isoDate(S.parseIsoDate('2026-11-22')), '2026-11-22');
});
