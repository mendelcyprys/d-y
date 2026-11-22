import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, sefariaUrl, normalizeCommentary, mergeCommentaries, splitDibbur } from '../src/sefaria.js';

const version = (language, text) => ({ language, text, versionTitle: `${language} edition`, license: 'CC-BY' });

test('a daf comes back as two amudim', () => {
  const r = normalizeText({
    ref: 'Arakhin 5', heRef: 'ערכין ה׳', book: 'Arakhin', spanningRefs: ['Arakhin 5a', 'Arakhin 5b'],
    versions: [version('he', [['א', 'ב'], ['ג']]), version('en', [['a', 'b'], ['c']])],
  });
  assert.deepEqual(r.sections, [
    { label: '5a', he: ['א', 'ב'], en: ['a', 'b'] },
    { label: '5b', he: ['ג'], en: ['c'] },
  ]);
  assert.equal(r.versions.he.title, 'he edition');
});

test('a single amud or a Yerushalmi passage comes back flat', () => {
  const r = normalizeText({
    ref: 'Jerusalem Talmud Shekalim 1:1:1-15', book: 'Jerusalem Talmud Shekalim',
    versions: [version('he', ['א', 'ב']), version('en', ['a', 'b'])],
  });
  assert.deepEqual(r.sections, [{ label: '1:1:1-15', he: ['א', 'ב'], en: ['a', 'b'] }]);
});

test('a missing translation or empty amud is handled', () => {
  const r = normalizeText({
    ref: 'Tamid 26', book: 'Tamid', spanningRefs: ['Tamid 26a', 'Tamid 26b'],
    versions: [version('he', [['א'], []])],
  });
  assert.deepEqual(r.sections, [{ label: '26a', he: ['א'], en: [] }]);
  assert.equal(r.versions.en, null);
});

test('links to Sefaria', () => {
  assert.equal(sefariaUrl('Arakhin 5'), 'https://www.sefaria.org/Arakhin.5?lang=bi');
  assert.equal(sefariaUrl('Bava Kamma 2a'), 'https://www.sefaria.org/Bava_Kamma.2a?lang=bi');
  assert.equal(sefariaUrl('Jerusalem Talmud Shekalim 1:1:1-15'), 'https://www.sefaria.org/Jerusalem_Talmud_Shekalim.1.1.1-15?lang=bi');
});

test('Rashi on a daf lines up with the Gemara passage by passage', () => {
  const amudim = normalizeCommentary({
    ref: 'Rashi on Arakhin 5', book: 'Rashi on Arakhin', spanningRefs: ['Rashi on Arakhin 5a', 'Rashi on Arakhin 5b'],
    versions: [{ language: 'he', text: [[[], ['א - ב', 'ג - ד'], []], [['ה - ו']]] }],
  });
  assert.deepEqual(amudim, [
    { label: '5a', passages: [[], ['א - ב', 'ג - ד'], []] },
    { label: '5b', passages: [['ה - ו']] },
  ]);
});

test('Rashi on a single amud', () => {
  const amudim = normalizeCommentary({
    ref: 'Rashi on Berakhot 64a', book: 'Rashi on Berakhot',
    versions: [{ language: 'he', text: [[], ['א - ב'], ['ג - ד', '']] }],
  });
  assert.deepEqual(amudim, [{ label: '64a', passages: [[], ['א - ב'], ['ג - ד']] }]);
});

test('Rashi and Rashbam are merged on the same passages', () => {
  const merged = mergeCommentaries([
    { author: 'Rashi', amudim: [{ label: '29a', passages: [['r1'], []] }] },
    { author: 'Rashbam', amudim: [{ label: '29a', passages: [[], ['b1']] }, { label: '29b', passages: [['b2']] }] },
  ]);
  assert.deepEqual(merged, {
    '29a': [[{ author: 'Rashi', text: 'r1' }], [{ author: 'Rashbam', text: 'b1' }]],
    '29b': [[{ author: 'Rashbam', text: 'b2' }]],
  });
});

test('the opening words of a comment are split from the explanation', () => {
  assert.deepEqual(splitDibbur('חוץ מדמי אבר - שלא יקבל דמה:'), { dibbur: 'חוץ מדמי אבר', rest: 'שלא יקבל דמה:' });
  assert.deepEqual(splitDibbur('no separator here'), { dibbur: '', rest: 'no separator here' });
});
