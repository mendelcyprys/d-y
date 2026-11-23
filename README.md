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
- **Rashi beside the Gemara.** Each passage has Rashi's comments on it next to
  it (or under it on a phone), with the opening words in bold. In Bava Batra
  the Rashbam takes over, as in a printed Gemara. Choose **Off**, **Shown**
  or **Buttons**: in Buttons, each passage with Rashi has a small button
  showing how many comments there are, and tapping it opens them under the
  passage. Press **Rashi script** to read it in the traditional Rashi
  letters.
- **Context across the page break.** A sugya often starts on one daf and
  ends on the next. Above the text you see the end of the previous daf, and
  below it the start of the next, shaded and read-only, with "Show more" to
  read further. (Not across tractates.)
- **Know where you are in a long daf.** A bar along the top has a tick for
  every passage (with a green dot once you've marked it read) and the amudim marked. It fills
  as you read, with the passage number you're on at its end. Tap anywhere
  on it to jump to that passage, or drag along it to move through the daf.
  A label shows the amud, passage and percentage (e.g. "2a · 7/17 · 38%");
  tap it to jump to the top, to either amud, or to your notes.
- **Make the text as wide as you like.** On a wide screen, drag the handle
  between the text and the side panel. Your width is remembered;
  double-click the handle to reset it.
- **Mark each passage as you read it.** Tap the circle beside a passage each
  time you read it and it keeps count (✓, 2×, 3×…). The button on each amud
  marks the whole amud read at once. The top of the text shows how many
  times you've read the whole daf through, and reading every passage offers
  to mark the daf as learned.
- **Bookmarks and recent dafim, one tap away.** The ribbon button in the top
  bar opens Recent (the dafim you opened lately, each remembering the
  passage you'd reached: tap one to go straight back there) and your
  Bookmarks. "Bookmark this place" bookmarks the passage you're on, or tap
  the ribbon beside any passage; add a label if you like. Bookmarked
  passages are marked on the reading bar, and bookmarks back up with your
  account. Recent stays on each device.
- **Copy a passage.** Right-click a passage (or long-press on Android) to
  copy it: Hebrew and English, either one, with its Rashi, or a link straight
  to it. Pasted into a document it keeps its bold and Hebrew direction. With
  text selected, the browser's own menu shows instead.
- **Notes on every daf, and on any passage.** Write general notes on the
  daf beside the text, or tap the note button beside a passage to write a
  note right under it. They save as you type. The Notes page collects them
  all in the order of the Shas, each daf's note followed by its passage
  notes (each one a link straight to its passage), with search.
- **Review (chazarah).** Shows what you learned yesterday, a week ago and a
  month ago, so you can go back over it.
- **Progress.** A daf-by-daf grid for each tractate, a count of days in a row,
  and your progress through the cycle.
- **Schedule.** The next two weeks, and the start and siyum date of every
  tractate in the cycle.

**Account and automatic backup.** Under **Progress → Your data**, create a
free account (a username and password) and your progress, reads and notes
back up automatically: a few seconds after you stop, at most every 20
seconds while you keep going, and straight away when you leave the app. Log in on your phone
and computer and they stay in step. Each backup sends only the dafim that
changed, so it stays small however much you learn. A cloud icon in the top bar shows whether everything is backed up
(a green tick), there are changes waiting (an orange dot), it's saving, or
you're offline; tap it to see which dafim are waiting. When you sign up you
get a recovery code: keep it, it's the only way back in if you forget your
password. Display settings (layout, text width, Rashi) stay with each device.
The backup service is in `worker/` and runs on a free Cloudflare account. You
can also export a backup file and import it elsewhere.

## Using it

The app is plain HTML, CSS and JavaScript with no build step.

**On your computer:**

```bash
npm start
```

Then open <http://localhost:8000>. Any static file server works; this one
uses Python's built-in server.

**On your phone, or anywhere:** the app is online in two places, with the
same files:

- <https://daf-yomi.mmcyprys.workers.dev> on Cloudflare, served by a small
  Worker (`site/`) that has the app's files packed into it. Update it with
  `npm run deploy:site` (needs `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`).
- <https://mendelcyprys.github.io/d-y/> on GitHub Pages, from the `main`
  branch (**Settings → Pages → Deploy from a branch → `main`, `/ (root)`**).
  Anything merged into `main` goes live there a minute or two later.

Each address keeps its own copy of your progress in the browser, so use your
account to have the same progress on both. On a phone, use "Add to Home
Screen" to open it like an app.

## How it works

| File | What it does |
| --- | --- |
| `src/schedule.js` | The Daf Yomi calendar: which daf falls on which date, for any cycle since 1975. Each daf has an *index*, the number of days since cycle 8 began, which makes "where I am" easy to compare with "where the schedule is". |
| `src/progress.js` | Your record: where you started, what you've learned and when, notes, streaks, review and catch-up plans. It has no browser code, so it can be tested in Node. |
| `src/sefaria.js` | Loads a daf's text, and Rashi, from Sefaria's free API. Shekalim (from the Yerushalmi), Kinnim and Middot are looked up through Sefaria's Daf Yomi calendar. Sefaria splits Rashi into the same passages as the Gemara, which is how each comment is placed beside its passage. |
| `src/reading.js` | Where you are in a daf from where its passages are on screen: the reading bar's ticks and fill, and which passage a tap on it means. |
| `src/sanitize.js` | Rebuilds Sefaria's formatting (bold, footnotes, links) from an allowlist, so the text can't run anything on the page. |
| `src/store.js` | Saves to `localStorage`. |
| `src/sync.js` | Your account, and automatic backup that sends only what changed, through the service in `worker/`. |
| `src/config.js` | The backup service's address. |
| `worker/` | The backup service: accounts and backups on a Cloudflare Worker with Durable Objects. See `worker/README.md`. |
| `site/` | Serves the app itself from Cloudflare: `build.mjs` packs the files into a module for `worker.js`. |
| `src/app.js` | The pages and everything you click. |

The schedule has been checked against Sefaria's calendar at the first and
last daf of every tractate in the current cycle (cycle 14, 5 January 2020 to
7 June 2027).

## Development

```bash
npm test
```

The tests use Node's built-in test runner, so there is nothing to install.
They cover the schedule (against Sefaria's dates), progress, catch-up math,
importing backups, and the reading of Sefaria's responses.
