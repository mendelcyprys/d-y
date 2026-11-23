# Research notes

Notes made while learning. These notes are not part of the app. There are two
kinds:

- **Questions**: something examined in depth, such as a difficult Rashi, a
  contradiction between sources, or how a Rishon or the Rambam learns a sugya.
- **Sugya summaries**: an overview of a stretch of Gemara, such as the long
  section at the start of Arakhin on the Tannaim's statements beginning "הכל...".
  A summary covers what the sugya does, how it is built, and its main points.

## Index

Listed in the order of the Shas.

| Daf | Kind | Topic | Status | File |
| --- | --- | --- | --- | --- |
| Arakhin 2a–4a | summary | The "הכל" statements: what each comes to include (the Mishnah's four verbs, then about twenty others), and the second pass, "כהנים לוים וישראלים — פשיטא!" | done | [arakhin-2a-4a-hakol.md](arakhin-2a-4a-hakol.md) |
| Arakhin 2a | question (2) | Does every "הכל" come to include something? (נודרין: "נידרין איצטריך ליה"; נידרין: "תני והדר מפרש"; 3b's "פשיטא!" as the mirror image.) Is "הכל" a literary heading that the Mishnah then spells out? (the "הכל... חוץ מ..." pattern; Mishnat Eretz Yisrael; Bar-Ilan) | answered | [arakhin-2a-does-hakol-include.md](arakhin-2a-does-hakol-include.md) |
| Arakhin 3a | question (5) | The kohen who isn't expert in nega'im: Rashi's wording, the Sifra's "shoteh", how the Rambam learns Ravina | answered | [arakhin-3a-non-expert-kohen.md](arakhin-3a-non-expert-kohen.md) |
| Arakhin 3b | question (2) | "הכל מעלין לארץ ישראל — לאתויי עבדים": Rashi here (the slave compels, only when he is being sold) against Rashi in Kesubos (the master compels a Hebrew slave); Ri and the Rambam. Where Rashi's narrower case comes from (Penei Yehoshua, the Ran via later sources, Rashi's two editions in the Shitah Mekubetzes) | answered | [arakhin-3b-hakol-maalin-avadim.md](arakhin-3b-hakol-maalin-avadim.md) |
| Arakhin 3b | question (1) | "כהנים ולוים מוכרין לעולם": Rashi on 3b (even in the Yovel year) against Rashi on 33b, Tosafos, the Rambam, the Kesef Mishneh, Yachin and the Meiri ("even close to Yovel", or "מוכרין" said only alongside the other phrases) | answered | [arakhin-3b-mochrin-leolam.md](arakhin-3b-mochrin-leolam.md) |
| Arakhin 4a | question (3) | Ben Buchri and "הכל מעריכין — כהנים". The Sha'ar HaMelech on Rava's premise "כל דליתיה בשקלים ליתיה בערכין"; R' Amiel (a kohen is a donor, not a partner); women and slaves: the Ma'asai LaMelech (women who give are partners) against the Minchas Chinuch | answered | [arakhin-4a-ben-buchri.md](arakhin-4a-ben-buchri.md) |
| Arakhin 4a | question (2) | Is the baraisa "בערכך — להביא ערך סתום" (4a:17–4b:5, up to "אמר מר") from the Sifra? Yes: Bechukosai, Section 3:5–9, in the same order. Differences: the Sifra's "ס"א" matches the Bavli; "נדר בערכך"; "ופחות מבן חדש" | answered | [arakhin-4a-bearkecha-sifra.md](arakhin-4a-bearkecha-sifra.md) |
| Arakhin 4b | question (3) | "ערך סתום — כמפרש דמי": Rashi's reason (the amount is known) against Tosafos (a gezeiras hakasuv for an erech tied to a person). The Rambam rules like the "איכא דאמרי": an unspecified erech is judged by hasagas yad (Arachin 3:8–10, the Kesef Mishneh, the Ra'avad). Why the Rambam leaves out Tosafos' "ערך זכר" (the Minchas Chinuch: "וז"פ"; the Tosefta's five sela'im). Did Mishnat Eretz Yisrael ("ספק ערכין להקל") use this sugya? | answered | [arakhin-4b-erech-satum-hasagas-yad.md](arakhin-4b-erech-satum-hasagas-yad.md) |

Status is one of:
- `open`
- `answered` (for a summary: `done`)
- `partly answered` (something important is still unchecked)

## Format

These rules apply to both kinds:

- **File names.** Spell the tractate as on Sefaria, in lowercase with hyphens
  (`arakhin`, `bava-kamma`).
  - A question is filed under the daf where it arises:
    `<tractate>-<daf><amud>-<topic>.md`, e.g. `arakhin-3a-non-expert-kohen.md`.
    Follow-up questions on the same sugya go into the same file as the next
    numbered question.
  - A summary is filed under its range:
    `<tractate>-<from>-<to>-<topic>.md`, e.g. `arakhin-2a-4a-hakol.md`.
- **Link the two kinds.** A summary lists the question files that fall within
  its range under "Related". Each of those question files links back to the
  summary.
- **Work from the text, and quote it.** Give the exact words of every source,
  with its reference and, where it matters, the edition. Quote each key text
  once and refer back to it. A summary quotes the key lines and gives the
  reference for each step. It does not need to quote everything.
- **Say what wasn't checked.** That covers works not on Sefaria, and anything
  known only second-hand (for example, "the Rosh, as quoted by the Kesef
  Mishneh").
- **Never silently rewrite something that turned out wrong.** Leave it and add
  a dated line under "Corrections".
- Notes are in English. Hebrew and Aramaic are quoted without nikud.

### Template: question

```markdown
---
kind: question
daf: Arakhin 3a
topic: One line saying what the thread is about
asked: YYYY-MM-DD
updated: YYYY-MM-DD
status: answered
---

# Arakhin 3a: topic

**Summary.** Where things stand, in a few sentences.

## The texts

**Gemara** (edition):
> exact text

## 1. The question, close to how it was asked (YYYY-MM-DD)

**Answer.** ...

**Sources.** Exact quotes with references.

**Not checked.** ...

## Corrections

- YYYY-MM-DD: what was wrong, and what is right.
```

### Template: sugya summary

```markdown
---
kind: summary
daf: Arakhin 2a–4a
topic: One line saying what the sugya is about
written: YYYY-MM-DD
updated: YYYY-MM-DD
status: done
---

# Arakhin 2a–4a: topic

**In brief.** What the sugya does and why, in a few sentences.

## Where it sits

The Mishnah or question it hangs on, and what comes before and after it.

## How it runs

The steps of the argument in order, each with its daf and line reference and
the key words quoted. For a sugya that is a list, use a table instead, with
columns such as: statement | source | what it comes to include | derivation.

## Main points

The ideas, distinctions and disputes worth remembering: Rashi and Tosafos,
other Rishonim, the Rambam's ruling where relevant.

## Related

- Question threads in this folder that fall within this range.
- Parallel sugyos elsewhere in the Shas.

## Not checked

## Corrections
```
