import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, sefariaUrl } from '../src/sefaria.js';

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
