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
- Rashi ("Rashi on Arakhin 5") is split into the same passages as the Gemara: comment list n on 5a belongs to passage n of
  5a. Bava Batra adds "Rashbam on Bava Batra"; Shekalim, Kinnim, Tamid and Middot have no Rashi.
