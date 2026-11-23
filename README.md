# Daf Yomi — learn at your own pace

A small web app for learning the daily daf of Talmud. It keeps your place,
shows the text with a translation, holds your notes, and tells you how you
compare with the worldwide Daf Yomi schedule, with no pressure if you fall
behind.

## What it does

- **Your daf, not just today's daf.** Choose where to start (for example
  the beginning of the current tractate) and the app keeps your place. It
  shows how many dafim you are behind or ahead of the daily schedule.
- **A catch-up plan, when you want one.** For example: "2 dafim a day for 3
  days, and you're caught up on Tuesday", or "at your own pace you'll finish
  Arakhin on 24 December".
- **The text.** The Aramaic/Hebrew with nikud and the English translation,
  side by side or one at a time. The English is the William Davidson
  edition, based on Rabbi Steinsaltz: **bold** is the literal translation and
  plain text is explanation. The text comes from [Sefaria](https://www.sefaria.org).
- **Notes on every daf.** They save as you type. The Notes page collects them
  all in the order of the Shas, with search.
- **Review (chazarah).** Shows what you learned yesterday, a week ago and a
  month ago, so you can go back over it.
- **Progress.** A daf-by-daf grid for each tractate, a count of days in a row,
  and your progress through the cycle.
- **Schedule.** The next two weeks, and the start and siyum date of every
  tractate in the cycle.

Your progress and notes are saved in your browser on your device. Use
**Progress → Export backup** to keep a copy or move to another device.

## Using it

The app is plain HTML, CSS and JavaScript with no build step.

**On your computer:**

```bash
npm start
```

Then open <http://localhost:8000>. Any static file server works; this one
uses Python's built-in server.

**On your phone, or anywhere:** host it with GitHub Pages. In the
repository on GitHub, go to **Settings → Pages**, set the source to
**Deploy from a branch**, and choose the branch and the `/ (root)` folder.
After a minute it will be at `https://<your-username>.github.io/d-y/`. On a
phone, use "Add to Home Screen" to open it like an app.

## How it works

| File | What it does |
| --- | --- |
| `src/schedule.js` | The Daf Yomi calendar: which daf falls on which date, for any cycle since 1975. Each daf has an *index*, the number of days since cycle 8 began, which makes "where I am" easy to compare with "where the schedule is". |
| `src/progress.js` | Your record: where you started, what you've learned and when, notes, streaks, review and catch-up plans. It has no browser code, so it can be tested in Node. |
| `src/sefaria.js` | Loads a daf's text from Sefaria's free API. Shekalim (from the Yerushalmi), Kinnim and Middot are looked up through Sefaria's Daf Yomi calendar. |
| `src/sanitize.js` | Rebuilds Sefaria's formatting (bold, footnotes, links) from an allowlist, so the text can't run anything on the page. |
| `src/store.js` | Saves to `localStorage`. |
| `src/app.js` | The pages and everything you click. |

The schedule has been checked against Sefaria's calendar at the first and
last daf of every tractate in the current cycle (cycle 14, 5 January 2020 to
7 June 2027).

## Research notes

`research/` holds notes made while learning. Some examine a question, such as a
difficult Rashi or a contradiction between sources. Others summarize a sugya. Each
note quotes its sources exactly. They are not part of the app; see
[`research/README.md`](research/README.md) for the index.

## Study booklets

`booklets/arakhin/` holds a printable booklet for Arakhin: the Torah verses, and the whole
Mishnah with Bartenura and notes. It contains the PDF and the scripts that build it; see
[`booklets/arakhin/README.md`](booklets/arakhin/README.md).

## Development

```bash
npm test
```

The tests use Node's built-in test runner, so there is nothing to install.
They cover the schedule (against Sefaria's dates), progress, catch-up math,
importing backups, and the reading of Sefaria's responses.
