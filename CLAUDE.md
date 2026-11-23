# Daf Yomi study app

Static web app: vanilla ES modules, no build step, no dependencies.
Run with `npm start` (python http.server on :8000). Test with `npm test` (node:test).

- Keep logic that doesn't need the DOM in `src/schedule.js` / `src/progress.js` and cover it with tests in `test/`.
- Dafim are identified by an index (days since 24 June 1975, cycle 8 day 0). Learned dafim are stored per cycle as
  `"14/Arakhin/5": "YYYY-MM-DD"`; notes are per daf across cycles as `"Arakhin 5"`.
- Tractate names follow Sefaria's spelling (Berakhot, Arakhin, Bekhorot, Meilah...). Kinnim (23–25), Tamid (26–33) and
  Middot (34–37) continue Meilah's page numbers.
- Sefaria texts are untrusted HTML: always render them through `textToFragment` in `src/sanitize.js`, never `innerHTML`.
- Sefaria's calendar only lists Daf Yomi for cycle 14, so calendar lookups use the matching cycle-14 date.
- Sefaria rate-limits (HTTP 429); avoid bursts of requests.
- `booklets/arakhin/` builds the printable Mishnah Arakhin booklet (PDF). See its README; its `raw/`, `fonts/` and
  `build/` folders are re-created by the scripts and not committed. Notes in `booklets/*/notes/` follow the same rules
  as `research/`: work from the texts and say what the sources are.

## Examining a question on the text

When asked to examine, check or look into a question about a text, or to follow one up, do these steps. Examples: a
difficult Rashi, a contradiction between sources, how a Rishon or the Rambam learns a sugya.

1. **Work from the texts, not from memory.** Fetch them from Sefaria and quote the exact words with reference and edition.
   Look for who already deals with the question: the commentaries linked to the ref, parallel sugyot, the Rambam and his
   commentators, and an exact-phrase search.
2. **Say what could not be checked.** That includes works that are not on Sefaria (e.g. Shitah Mekubetzes on Arakhin, the
   Bach's glosses) and anything known only second-hand.
3. **Record it in `research/`**, following the format, template and index in `research/README.md`.
   - Use one file per sugya: `research/<tractate>-<daf><amud>-<topic>.md`. A follow-up on the same sugya is the next
     numbered question in the same file.
   - Update the file's `updated`/`status` fields and the index row.
   - If an earlier answer was wrong, keep it and add a dated line under "Corrections".
4. **Commit** (e.g. `Research: Arakhin 3a, the non-expert kohen`) and push.

## Writing a sugya summary

When asked to summarize a sugya, or to add a summary note for one, do these steps.

1. **Read the whole sugya on Sefaria** before writing: the Gemara with Rashi and Tosafos, and other Rishonim or the
   Rambam where they matter. Find where it starts and ends, and the Mishnah or question it hangs on.
2. **Write `research/<tractate>-<from>-<to>-<topic>.md`** with `kind: summary`, using the template in
   `research/README.md`. It has these parts:
   - what the sugya does;
   - where it sits;
   - how it runs, step by step with daf references and the key words quoted (or as a table, for a sugya that is a list);
   - its main points and disputes;
   - what wasn't checked.
3. **Link it** to the question files in `research/` that fall within its range, and add a link back from each of them.
   Add the summary to the index.
4. **Commit** (e.g. `Research: summary of Arakhin 2a–4a, the "hakol" statements`) and push.

Sefaria endpoints for this. Wait about 2 s between requests.
- Text: `GET https://www.sefaria.org/api/v3/texts/<Ref>?version=hebrew` (`hebrew|all` lists every version). Refs use
  underscores, e.g. `Rashi_on_Arakhin.3a.12`, `Tosafot_on_Arakhin.3a.13`,
  `Kessef_Mishneh_on_Mishneh_Torah,_Defilement_by_Leprosy.9.1`, `Sifra,_Tazria_Parashat_Negaim,_Section_1.9`.
- Links: `GET https://www.sefaria.org/api/links/<Ref>?with_text=0`. This returns commentaries, parallels, and the Rambam
  (type `ein mishpat / ner mitsvah`).
- Exact phrase: `POST https://www.sefaria.org/api/search-wrapper` with
  `{"query": "...", "type": "text", "field": "exact", "size": 50}`.
- Some commentaries are misnumbered on Sefaria. For example, Yachin on Mishnah Arakhin is numbered by comment rather
  than by mishnah. Check what a segment actually says before citing its number.
