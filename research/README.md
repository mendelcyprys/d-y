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
| Arakhin 3a | question (5) | The kohen who isn't expert in nega'im: Rashi's wording, the Sifra's "shoteh", how the Rambam learns Ravina | answered | [arakhin-3a-non-expert-kohen.md](arakhin-3a-non-expert-kohen.md) |

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
    `<tractate>-<from>-<to>-<topic>.md`, e.g. `arakhin-2a-3b-hakol.md`.
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
daf: Arakhin 2a–3b
topic: One line saying what the sugya is about
written: YYYY-MM-DD
updated: YYYY-MM-DD
status: done
---

# Arakhin 2a–3b: topic

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
