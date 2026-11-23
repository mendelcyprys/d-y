# Mishnah Arakhin — printable study booklet

[`Mishnah-Arakhin.pdf`](Mishnah-Arakhin.pdf) is a 56-page booklet in US Letter size. It contains:

- **Front matter**: an overview of the masechta, the Torah's valuations, coins and
  measures, key terms, and the chapters with their Gemara dafim and Daf Yomi
  dates (cycle 14).
- **The verses** Arakhin is built on, with vowels and ta'amim: all of Vayikra 27,
  Vayikra 25:8–34, and the other verses the Mishnah uses. Each group of verses has
  a note on how the Mishnah uses it.
- **The Mishnah**: all 9 chapters and 50 mishnayos with vowels. Each mishnah has
  the complete Bartenura in Rashi script, and English notes drawing on Tosafos Yom
  Tov, Tiferes Yisroel (Yachin and Boaz), Rambam's Peirush HaMishnayos, and
  sometimes Melechet Shlomo. Each mishnah heading gives the daf where the Gemara
  takes it up.

The English notes were written by Claude (an AI) from those commentaries. The
booklet says so on its first page: they are a study aid, not a ruling.

## Files

| File | What it is |
| --- | --- |
| `notes/ch1.md` … `ch9.md` | The notes on each chapter: `# intro`, then `# 1:1`, `# 1:2`… Markdown-lite (`**bold**`, `*italic*`); Hebrew can be written inline. |
| `notes/verses.md` | The notes on the verses, one section per group of verses, e.g. `# v_Leviticus_27 3-7`. |
| `front.html` | The front matter. `{{CHAPTER_ROWS}}` is filled in by the build. |
| `template.html` | Page layout, fonts and print styles. |
| `build.py` | Builds `build/arakhin.html` from `raw/` and `notes/`. It holds the list of verse passages (`PASSAGES`) and the chapter names. |
| `render.cjs` | Prints the HTML to PDF with Playwright's Chromium. |
| `fetch-all.sh`, `fetch.sh` | Download the texts from Sefaria into `raw/`. |
| `dafmap.py`, `daf-dates.mjs` | Called by `fetch-all.sh`: which daf takes up each mishnah, and the Daf Yomi dates (from the app's `src/schedule.js`). |
| `fonts.sh` | Downloads the fonts into `fonts/`. They are OFL-licensed, from Fontsource on npm. |
| `verify.py` | Checks the printed verses letter by letter against a second edition. |
| `dump.py`, `seq.py` | Reading aids for writing notes. They print a chapter with its commentaries, without vowels. |

`raw/`, `fonts/` and `build/` are not committed; the scripts re-create them.

## Rebuilding

You need Python 3, Node, Playwright with Chromium, and network access to
`www.sefaria.org` and the npm registry.

```bash
./fonts.sh
```

```bash
./fetch-all.sh
```

```bash
python3 -I verify.py
```

```bash
python3 -I build.py
```

```bash
node render.cjs build/arakhin.html Mishnah-Arakhin.pdf
```

`verify.py` should report no letter differences except the known ones. These are
the parashah markers (ס/פ), which only the second edition has. There are also two
spellings that differ in a *vav* or *yud* between the editions: Devarim 22:14
והוצא, and Bamidbar 13:32 ויציאו. The booklet prints the Aleppo-based spelling
and lists both in its front matter.

## Texts used (all from Sefaria)

- **Mishnah and Bartenura**: Torat Emet (vocalized).
- **Tosafos Yom Tov, Yachin, Boaz, Melechet Shlomo**: Mishnah, ed. Romm, Vilna 1913.
  These were read to write the notes and are not printed.
- **Rambam on the Mishnah**: Vilna edition.
- **Verses**: *Miqra according to the Masorah*, which is Aleppo-based. They are
  checked against *Tanach with Ta'amei Hamikra*, which is Leningrad-based.

## For another masechta

Copy the folder and change these:
- the refs in `fetch-all.sh`;
- `PASSAGES`, `VNOTE_FILE`, `PEREK_NAME`/`PEREK_EN` and the titles in `build.py`;
- the tractate name in `dafmap.py` and `daf-dates.mjs`;
- `front.html`;
- the notes.

The layout and the scripts carry over as they are.
