// The Daf Yomi study app: views, routing and interaction.
//
// Pages are chosen by the address after "#":
//   #/                       Learn: your daf, how you compare with the schedule
//   #/daf/arakhin/5          any daf (in the current cycle; add /c15 for another)
//   #/progress  #/notes  #/schedule

import * as S from './schedule.js';
import * as P from './progress.js';
import { loadDaf, loadRashi, hasRashi, splitDibbur, COMMENTATORS, sefariaUrl } from './sefaria.js';
import { textToFragment } from './sanitize.js';
import { loadState, saveState, storageAvailable } from './store.js';

let state = loadState();
const main = document.getElementById('main');

// ---------------------------------------------------------------------------
// Small helpers

/** Create an element: h('a', { href: '#/', class: 'x', onclick }, 'text', child) */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, String(v));
    } else if (key === 'value') el.value = value;
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const number = new Intl.NumberFormat();
const dates = {
  day: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  full: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  long: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
};
let hebrewCalendar = null;
try {
  hebrewCalendar = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });
} catch {
  // Older browsers without the Hebrew calendar just skip it.
}
const hebrewDate = (date) => (hebrewCalendar ? hebrewCalendar.format(date) : '');

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const todayIndex = () => S.indexForDate(today());
const currentCycle = () => S.dafAtIndex(todayIndex()).cycle;

const plural = (n, one, many) => `${number.format(n)} ${n === 1 ? one : many}`;
const dafim = (n) => plural(n, 'daf', 'dafim');

function relativeDay(date) {
  const diff = S.dayNumber(date) - S.dayNumber(today());
  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  return dates.full.format(date);
}

function dafName(index) {
  const { tractate, daf } = S.dafAtIndex(index);
  return `${tractate.en} ${daf}`;
}

function dafNameHe(index) {
  const { tractate, daf } = S.dafAtIndex(index);
  return `${tractate.he} ${S.hebrewNumeral(daf)}`;
}

function dafHref(index) {
  const { tractate, daf, cycle } = S.dafAtIndex(index);
  const suffix = cycle === currentCycle() ? '' : `/c${cycle}`;
  return `#/daf/${S.slug(tractate)}/${daf}${suffix}`;
}

function persist() {
  saveState(state);
  updateStorageWarning();
}

let toastTimer;
function toast(message, ms = 3500) {
  const el = document.getElementById('toast');
  el.replaceChildren(...[].concat(message));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function updateStorageWarning() {
  document.getElementById('storage-warning').hidden = storageAvailable();
}

function progressBar(learned, total, label) {
  const pct = total ? Math.round((learned / total) * 1000) / 10 : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(learned), 'aria-label': label },
    h('span', { style: { width: `${pct}%` } }),
  );
}

// ---------------------------------------------------------------------------
// Routing

function parseRoute() {
  const [view, ...rest] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (view === 'daf') {
    const tractate = S.TRACTATES.find((t) => S.slug(t) === rest[0]);
    const cycleMatch = /^c(\d+)$/.exec(rest[2] || '');
    const cycle = cycleMatch ? Number(cycleMatch[1]) : currentCycle();
    if (tractate) {
      try {
        return { view: 'daf', index: S.indexFor(cycle, tractate, Number(rest[1])) };
      } catch {
        // Not a daf in that tractate; fall through to the Learn page.
      }
    }
    return { view: 'learn' };
  }
  if (view === 'progress' || view === 'notes' || view === 'schedule') return { view };
  return { view: 'learn' };
}

let renderedDay = null;

function render() {
  const route = parseRoute();
  renderedDay = S.isoDate(today());
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === (route.view === 'daf' ? 'learn' : route.view);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  let page;
  if (route.view === 'progress') page = progressPage();
  else if (route.view === 'notes') page = notesPage();
  else if (route.view === 'schedule') page = schedulePage();
  else if (route.view === 'daf') page = dafPage(route.index, { home: false });
  else page = dafPage(P.position(state) ?? todayIndex(), { home: true });

  main.replaceChildren(page);
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// If the page was left open overnight, move on to the new day's daf.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && renderedDay !== S.isoDate(today())) render();
});

// Left and right arrow keys move between dafim on a daf page.
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest('input, textarea, select, [contenteditable]')) return;
  const link = document.querySelector(event.key === 'ArrowLeft' ? '[data-pager=prev]' : event.key === 'ArrowRight' ? '[data-pager=next]' : null);
  if (link) {
    event.preventDefault();
    link.click();
  }
});

// ---------------------------------------------------------------------------
// The daf page (also the Learn page, which shows your daf)

function dafPage(index, { home }) {
  const { tractate } = S.dafAtIndex(index);
  document.title = `${dafName(index)} · Daf Yomi`;

  const page = h('div', { class: 'daf-layout' });
  const column = h('div', { class: 'daf-main' });
  const side = h('aside', { class: 'daf-side' });

  let paceCard = home ? renderPace() : null;
  let headCard = renderHead();

  // Re-draw the cards that depend on what you've learned without touching the
  // text, so marking a daf doesn't lose your place in it.
  function refresh() {
    if (paceCard) {
      const next = renderPace();
      paceCard.replaceWith(next);
      paceCard = next;
    }
    const next = renderHead();
    headCard.replaceWith(next);
    headCard = next;
  }

  function renderHead() {
    return dafHeadCard(index, { home, onChange: refresh });
  }

  column.append(...[paceCard, headCard, textCard(index)].filter(Boolean));
  side.append(...[notesCard(tractate, S.dafAtIndex(index).daf), home ? reviewCard() : null, gotoCard(index)].filter(Boolean));
  page.append(column, side);
  return page;
}

function dafHeadCard(index, { home, onChange }) {
  const { tractate, daf, cycle } = S.dafAtIndex(index);
  const tIndex = todayIndex();
  const pos = P.position(state);
  const learnedOn = P.learnedDate(state, index);
  const date = S.dateForIndex(index);

  const tags = [];
  if (index === pos) tags.push(h('span', { class: 'tag tag-yours' }, 'Your daf'));
  if (index === tIndex) tags.push(h('span', { class: 'tag tag-today' }, "Today's daf"));

  // "Studied worldwide yesterday (Sat, 21 Nov 2026) · 11 Kislev 5787"
  const rel = relativeDay(date);
  const isWord = /^[a-z]/.test(rel);
  let when;
  if (index < tIndex) when = `Studied worldwide ${rel}`;
  else if (index === tIndex) when = 'Studied worldwide today';
  else when = `Comes up ${rel}`;
  if (isWord && index !== tIndex) when += ` (${dates.full.format(date)})`;
  const heb = hebrewDate(date);

  const { learned, total } = P.tractateProgress(state, cycle, tractate);

  function toggle() {
    const nowLearned = !P.isLearned(state, index);
    P.setLearned(state, index, nowLearned, today());
    if (nowLearned && !state.start) P.setStart(state, index);
    persist();
    if (nowLearned && P.tractateComplete(state, cycle, tractate)) {
      toast([
        h('strong', {}, `Mazal tov! You've finished ${tractate.en}.`), ' ',
        h('span', { lang: 'he', dir: 'rtl' }, `הדרן עלך מסכת ${tractate.he}`),
      ], 8000);
    } else if (nowLearned) {
      toast(`Marked ${dafName(index)} as learned.`);
    }
    onChange();
  }

  const nextIndex = index + 1;
  const prevIndex = index - 1;

  // After learning, offer the way on: on the Learn page that's your new
  // position; elsewhere it's simply the following daf.
  let continueButton = null;
  if (learnedOn) {
    const target = home ? P.position(state) : nextIndex;
    continueButton = home
      ? h('button', { type: 'button', class: 'btn', onclick: () => { render(); window.scrollTo(0, 0); } }, `Continue to ${dafName(target)} →`)
      : h('a', { class: 'btn', href: dafHref(target) }, `Next: ${dafName(target)} →`);
  }

  const startHere = state.start && index !== P.startIndex(state) && index !== pos
    ? h('button', {
      type: 'button',
      class: 'link-button',
      onclick: () => {
        P.setStart(state, index);
        persist();
        toast(`You'll now learn from ${dafName(index)}.`);
        location.hash = '#/';
      },
    }, 'Start learning from here')
    : null;

  return h('section', { class: 'card daf-head', 'aria-labelledby': 'daf-title' },
    tags.length ? h('p', { class: 'tags' }, tags) : null,
    h('h1', { id: 'daf-title', class: 'daf-title' },
      h('span', {}, dafName(index)),
      h('span', { class: 'he', lang: 'he', dir: 'rtl' }, dafNameHe(index)),
    ),
    h('p', { class: 'meta' }, when, heb ? ` · ${heb}` : ''),
    h('p', { class: 'meta' }, `Seder ${tractate.seder} · daf ${daf - tractate.start + 1} of ${tractate.days} in ${tractate.en} · cycle ${cycle}`),
    h('div', { class: 'tractate-progress' },
      progressBar(learned, total, `${tractate.en} progress`),
      h('span', { class: 'small' }, `You've learned ${learned} of ${dafim(total)} in ${tractate.en}`),
    ),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button',
        class: learnedOn ? 'btn btn-learned' : 'btn btn-primary',
        'aria-pressed': learnedOn ? 'true' : 'false',
        onclick: toggle,
      }, learnedOn ? `✓ Learned ${relativeDay(S.parseIsoDate(learnedOn))}` : 'Mark as learned'),
      continueButton,
    ),
    h('nav', { class: 'pager', 'aria-label': 'Nearby dafim' },
      prevIndex >= 0 ? h('a', { href: dafHref(prevIndex), 'data-pager': 'prev' }, `← ${dafName(prevIndex)}`) : h('span'),
      index !== tIndex ? h('a', { href: dafHref(tIndex), class: 'pager-today' }, "Today's daf") : null,
      h('a', { href: dafHref(nextIndex), 'data-pager': 'next' }, `${dafName(nextIndex)} →`),
    ),
    startHere,
  );
}

// How you compare with the daily schedule, and how to catch up if you want to.
function renderPace() {
  const tIndex = todayIndex();
  const pos = P.position(state);

  if (pos == null) {
    const { tractate, cycle } = S.dafAtIndex(tIndex);
    const tractateStart = S.indexFor(cycle, tractate, tractate.start);
    const choose = (index) => () => {
      P.setStart(state, index);
      persist();
      render();
    };
    return h('section', { class: 'card pace onboarding', 'aria-labelledby': 'pace-title' },
      h('h2', { id: 'pace-title' }, 'Where would you like to begin?'),
      h('p', {}, "Learn at your own pace. The app keeps your place, shows how far you are from the daily schedule, and helps you catch up whenever you're ready."),
      h('div', { class: 'choices' },
        tractateStart !== tIndex
          ? h('button', { type: 'button', class: 'choice', onclick: choose(tractateStart) },
            h('strong', {}, `From the start of ${tractate.en}`),
            h('span', {}, `${dafName(tractateStart)} · ${dafim(tIndex - tractateStart)} behind today's daf`),
          )
          : null,
        h('button', { type: 'button', class: 'choice', onclick: choose(tIndex) },
          h('strong', {}, "With today's daf"),
          h('span', {}, `${dafName(tIndex)} · in step with learners worldwide`),
        ),
      ),
      h('p', { class: 'small' }, 'Or go to any daf and choose “Start learning from here”.'),
    );
  }

  const gap = tIndex - pos;
  const { tractate: posTractate, cycle: posCycle } = S.dafAtIndex(pos);
  const days = P.streak(state, today());
  const cycleCount = P.cycleProgress(state, posCycle).learned;

  let headline;
  let detail;
  if (gap > 0) {
    headline = `You're ${dafim(gap)} behind the daily schedule.`;
    detail = h('span', {}, 'Learners worldwide are on ', h('a', { href: dafHref(tIndex) }, dafName(tIndex)), ' today.');
  } else if (gap === 0) {
    headline = "You're on today's daf.";
    detail = 'Learning in step with Daf Yomi learners around the world.';
  } else if (gap === -1) {
    headline = "You're all caught up.";
    detail = `You've learned today's daf. Tomorrow is ${dafName(tIndex + 1)}.`;
  } else {
    headline = `You're ${dafim(-gap - 1)} ahead of the schedule.`;
    detail = h('span', {}, "Today's daf is ", h('a', { href: dafHref(tIndex) }, dafName(tIndex)), '.');
  }

  let plan = null;
  if (gap > 0) {
    const tractateEnd = S.indexFor(posCycle, posTractate, posTractate.end);
    const ownFinish = S.addDays(today(), tractateEnd - pos);
    const worldFinish = S.dateForIndex(tractateEnd);
    plan = h('details', { class: 'plan' },
      h('summary', {}, 'Ways to catch up'),
      h('ul', {},
        [2, 3].map((perDay) => {
          const k = P.catchUpDays(gap, perDay);
          return h('li', {},
            h('strong', {}, `${perDay} dafim a day`),
            ` for ${plural(k, 'day', 'days')} — caught up ${relativeDay(S.addDays(today(), k - 1))}.`,
          );
        }),
        h('li', {},
          h('strong', {}, 'Keep your own pace'),
          ` — at one daf a day you'll finish ${posTractate.en} ${relativeDay(ownFinish)}; the world finishes ${relativeDay(worldFinish)}.`,
        ),
      ),
      h('p', { class: 'small' }, 'Many people catch up on Shabbat or a day off. There is no wrong way to learn.'),
    );
  }

  return h('section', { class: 'card pace', 'aria-labelledby': 'pace-title' },
    h('h2', { id: 'pace-title', class: 'pace-headline' }, headline),
    h('p', {}, detail),
    cycleCount
      ? h('p', { class: 'pace-stats small' },
        days ? `${plural(days, 'day', 'days')} in a row · ` : '',
        `${dafim(cycleCount)} learned this cycle`)
      : null,
    plan,
  );
}

// ---------------------------------------------------------------------------
// The text, from Sefaria

function amudLabelHe(label) {
  const m = /^(\d+)([ab])$/.exec(label);
  if (!m) return null;
  return S.hebrewNumeral(Number(m[1])).replace(/[׳״]/g, '') + (m[2] === 'a' ? '.' : ':');
}

function textCard(index) {
  const settings = state.settings;
  const { tractate } = S.dafAtIndex(index);
  const body = h('div', {
    class: 'text-body',
    'data-layout': settings.layout,
    'data-rashi': settings.rashi ? 'on' : 'off',
    'data-rashi-script': settings.rashiScript ? 'on' : 'off',
    style: { '--scale': settings.fontScale },
  }, h('p', { class: 'loading' }, 'Loading the text from Sefaria…'));
  const credits = h('p', { class: 'credits small' });
  const rashiCredit = h('span');
  const rashiNote = h('p', { class: 'rashi-note small', hidden: true });

  // Rashi is loaded only when it's switched on, and only once the Gemara is
  // on the page, then slotted in beside each passage.
  let gemaraShown = false;
  let rashiStatus = 'idle'; // idle | loading | done | none

  function setRashiNote(...content) {
    rashiNote.replaceChildren(...content);
    rashiNote.hidden = !content.length || !settings.rashi;
  }

  async function showRashi() {
    if (!settings.rashi || !gemaraShown || rashiStatus !== 'idle') return;
    if (!hasRashi(tractate)) {
      rashiStatus = 'none';
      setRashiNote(`There's no Rashi on ${tractate.en}.`);
      return;
    }
    rashiStatus = 'loading';
    setRashiNote('Loading Rashi…');
    try {
      const rashi = await loadRashi(index);
      if (!rashi) {
        rashiStatus = 'none';
        setRashiNote("There's no Rashi on this daf.");
        return;
      }
      for (const slot of body.querySelectorAll('.rashi[data-amud]')) {
        const passages = rashi.byAmud[slot.dataset.amud] || [];
        const comments = slot.dataset.seg === 'all' ? passages.flat() : passages[Number(slot.dataset.seg)] || [];
        if (comments.length) slot.replaceChildren(...rashiView(comments));
      }
      rashiStatus = 'done';
      setRashiNote();
      rashiCredit.textContent = ` ${rashi.authors.join(' and ')}: ${rashi.versions.join(', ')}.`;
    } catch (error) {
      rashiStatus = 'idle';
      setRashiNote(`Couldn't load Rashi: ${error.message}. `,
        h('button', { type: 'button', class: 'link-button', onclick: showRashi }, 'Try again'));
    }
  }

  const rashiButton = h('button', {
    type: 'button',
    'aria-pressed': settings.rashi ? 'true' : 'false',
    title: 'Show Rashi beside the Gemara',
    onclick: () => {
      settings.rashi = !settings.rashi;
      persist();
      body.dataset.rashi = settings.rashi ? 'on' : 'off';
      rashiButton.setAttribute('aria-pressed', String(settings.rashi));
      scriptButton.hidden = !settings.rashi;
      rashiNote.hidden = !settings.rashi || !rashiNote.childNodes.length;
      showRashi();
    },
  }, 'Rashi');

  // Rashi script: the letters Rashi's commentary is printed in, with the
  // opening words in square letters, as on a page of the Vilna Shas.
  const scriptButton = h('button', {
    type: 'button',
    hidden: !settings.rashi,
    'aria-pressed': settings.rashiScript ? 'true' : 'false',
    title: 'Show Rashi in Rashi script, as in a printed Gemara',
    onclick: () => {
      settings.rashiScript = !settings.rashiScript;
      persist();
      body.dataset.rashiScript = settings.rashiScript ? 'on' : 'off';
      scriptButton.setAttribute('aria-pressed', String(settings.rashiScript));
    },
  }, 'Rashi script');

  const layoutButtons = [
    ['both', 'Both'],
    ['he', 'Original'],
    ['en', 'English'],
  ].map(([value, label]) => h('button', {
    type: 'button',
    'aria-pressed': settings.layout === value ? 'true' : 'false',
    onclick: (event) => {
      settings.layout = value;
      persist();
      body.dataset.layout = value;
      for (const b of event.currentTarget.parentElement.children) b.setAttribute('aria-pressed', b === event.currentTarget ? 'true' : 'false');
    },
  }, label));

  const resize = (step) => () => {
    settings.fontScale = Math.min(1.8, Math.max(0.8, Math.round((settings.fontScale + step) * 10) / 10));
    persist();
    body.style.setProperty('--scale', settings.fontScale);
  };

  // Footnote markers open and close their note.
  body.addEventListener('click', (event) => {
    const marker = event.target.closest('.fn-marker');
    if (!marker) return;
    const note = marker.nextElementSibling;
    if (note?.classList.contains('footnote')) {
      note.hidden = !note.hidden;
      marker.setAttribute('aria-expanded', String(!note.hidden));
    }
  });

  async function load() {
    body.replaceChildren(h('p', { class: 'loading' }, 'Loading the text from Sefaria…'));
    try {
      const text = await loadDaf(index);
      body.replaceChildren(...text.sections.map(sectionView));
      gemaraShown = true;
      showRashi();
      const { he, en } = text.versions;
      credits.replaceChildren(
        'Text from ', h('a', { href: sefariaUrl(text.ref), target: '_blank', rel: 'noopener noreferrer' }, 'Sefaria'),
        he ? `: ${he.title}${he.license ? ` (${he.license})` : ''}` : '',
        en ? `; ${en.title}${en.license ? ` (${en.license})` : ''}` : '',
        '.',
      );
      credits.append(rashiCredit);
      if (en?.title?.startsWith('William Davidson')) {
        credits.append(' In the English, ', h('b', {}, 'bold'), ' is a literal translation and plain text is explanation, following Rabbi Adin Even-Israel Steinsaltz.');
      }
    } catch (error) {
      body.replaceChildren(h('div', { class: 'error' },
        h('p', {}, `Couldn't load the text: ${error.message}.`),
        h('p', {},
          h('button', { type: 'button', class: 'btn', onclick: load }, 'Try again'), ' ',
          h('a', { href: sefariaUrl(dafName(index)), target: '_blank', rel: 'noopener noreferrer' }, 'Open on Sefaria'),
        ),
      ));
    }
  }
  load();

  return h('section', { class: 'card text-card', 'aria-labelledby': 'text-title' },
    h('div', { class: 'text-toolbar' },
      h('h2', { id: 'text-title' }, 'Text'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Language' }, layoutButtons),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Rashi' }, rashiButton, scriptButton),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Text size' },
        h('button', { type: 'button', onclick: resize(-0.1), 'aria-label': 'Smaller text' }, 'A−'),
        h('button', { type: 'button', onclick: resize(0.1), 'aria-label': 'Larger text' }, 'A+'),
      ),
    ),
    rashiNote,
    body,
    credits,
  );
}

function sectionView(section) {
  const he = amudLabelHe(section.label);
  const heading = h('h3', { class: 'amud' },
    h('span', {}, section.label),
    he ? h('span', { class: 'he', lang: 'he', dir: 'rtl' }, he) : null,
  );
  const para = (html, lang) => h('p', lang === 'he' ? { lang: 'he', dir: 'rtl' } : { lang: 'en' }, textToFragment(html));

  // When both languages have the same number of passages, line them up side
  // by side; otherwise show each language as one block.
  // Each row also has an empty slot that Rashi's comments on that passage
  // are put into once they load.
  const rashiSlot = (seg) => h('div', { class: 'rashi', lang: 'he', dir: 'rtl', 'data-amud': section.label, 'data-seg': seg });
  let rows;
  if (section.he.length === section.en.length) {
    rows = section.he.map((heText, i) => (heText || section.en[i]
      ? h('div', { class: 'seg-row' },
        h('div', { class: 'he' }, para(heText, 'he')),
        h('div', { class: 'en' }, para(section.en[i], 'en')),
        rashiSlot(String(i)))
      : null));
  } else {
    rows = [h('div', { class: 'seg-row' },
      h('div', { class: 'he' }, section.he.map((t) => para(t, 'he'))),
      h('div', { class: 'en' }, section.en.map((t) => para(t, 'en'))),
      rashiSlot('all'))];
  }
  return h('section', { class: 'amud-section' }, heading, rows);
}

// Rashi's comments on one passage, each starting with the words of the
// Gemara it explains (the dibbur hamatchil) in bold.
function rashiView(comments) {
  const out = [];
  let author = null;
  for (const comment of comments) {
    if (comment.author !== author) {
      author = comment.author;
      out.push(h('span', { class: 'rashi-label' }, COMMENTATORS[author]?.he || author));
    }
    const { dibbur, rest } = splitDibbur(comment.text);
    out.push(h('p', { class: 'rashi-comment' },
      dibbur ? [h('b', {}, textToFragment(dibbur)), ' '] : null,
      textToFragment(rest)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Side cards: notes, review, go to

function notesCard(tractate, daf) {
  const status = h('span', { class: 'save-status small', 'aria-live': 'polite' });
  let timer;
  const area = h('textarea', {
    id: 'note-text',
    rows: 7,
    placeholder: 'What did you learn? The main question, the answer, a chiddush, something to ask about…',
    value: P.getNote(state, tractate, daf),
    oninput: () => {
      status.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(() => {
        P.setNote(state, tractate, daf, area.value);
        persist();
        status.textContent = storageAvailable() ? 'Saved' : 'Not saved';
      }, 500);
    },
  });
  return h('section', { class: 'card notes-card' },
    h('div', { class: 'card-title' }, h('h2', {}, h('label', { for: 'note-text' }, 'Your notes')), status),
    area,
    h('p', { class: 'small' }, 'Saved on this device. ', h('a', { href: '#/notes' }, 'See all your notes'), '.'),
  );
}

function reviewCard() {
  const suggestions = P.reviewSuggestions(state, today());
  return h('section', { class: 'card review-card' },
    h('h2', {}, 'Review'),
    suggestions.length
      ? h('ul', { class: 'review-list' },
        suggestions.map(({ label, indexes }) => h('li', {},
          h('span', { class: 'small' }, label),
          h('span', {}, indexes.map((i, n) => [n ? ', ' : '', h('a', { href: dafHref(i) }, dafName(i))])),
        )))
      : h('p', { class: 'small' }, 'As you learn, dafim to review will show up here.'),
    h('p', { class: 'small' }, 'Going back over a daf a day, a week and a month after learning it helps it stay with you.'),
  );
}

function tractateSelect(selected) {
  const bySeder = new Map();
  for (const t of S.TRACTATES) {
    if (!bySeder.has(t.seder)) bySeder.set(t.seder, []);
    bySeder.get(t.seder).push(t);
  }
  return h('select', { name: 'tractate', 'aria-label': 'Tractate' },
    [...bySeder].map(([seder, list]) => h('optgroup', { label: `Seder ${seder}` },
      list.map((t) => h('option', { value: t.en, selected: t === selected }, t.en)))),
  );
}

function gotoCard(index) {
  const { tractate, daf } = S.dafAtIndex(index);
  const select = tractateSelect(tractate);
  const dafInput = h('input', { type: 'number', name: 'daf', inputMode: 'numeric', 'aria-label': 'Daf', value: String(daf) });
  const setRange = () => {
    const t = S.findTractate(select.value);
    dafInput.min = String(t.start);
    dafInput.max = String(t.end);
  };
  setRange();
  select.addEventListener('change', () => {
    setRange();
    dafInput.value = dafInput.min;
  });

  const dateInput = h('input', { type: 'date', name: 'date', id: 'goto-date', value: S.isoDate(S.dateForIndex(index)) });

  return h('section', { class: 'card goto-card' },
    h('h2', {}, 'Go to a daf'),
    h('form', {
      class: 'goto-form',
      onsubmit: (event) => {
        event.preventDefault();
        const t = S.findTractate(select.value);
        const n = Math.min(t.end, Math.max(t.start, Math.round(Number(dafInput.value) || t.start)));
        location.hash = `#/daf/${S.slug(t)}/${n}`;
      },
    }, select, dafInput, h('button', { type: 'submit', class: 'btn' }, 'Go')),
    h('form', {
      class: 'goto-form',
      onsubmit: (event) => {
        event.preventDefault();
        const date = S.parseIsoDate(dateInput.value);
        if (!date) return;
        try {
          location.hash = dafHref(S.indexForDate(date));
        } catch (error) {
          toast(error.message);
        }
      },
    }, h('label', { class: 'small goto-label', for: 'goto-date' }, 'Or the daf for a date:'), dateInput, h('button', { type: 'submit', class: 'btn' }, 'Go')),
  );
}

// ---------------------------------------------------------------------------
// Progress page

function progressPage() {
  document.title = 'Progress · Daf Yomi';
  const tIndex = todayIndex();
  const pos = P.position(state);
  const cycle = S.dafAtIndex(pos ?? tIndex).cycle;
  const { learned: cycleLearned, total: cycleTotal } = P.cycleProgress(state, cycle);
  const gap = pos == null ? null : tIndex - pos;

  const tile = (label, value, sub) => h('div', { class: 'tile' },
    h('span', { class: 'tile-label' }, label),
    h('span', { class: 'tile-value' }, value),
    sub ? h('span', { class: 'small' }, sub) : null,
  );

  let paceValue = 'Not started';
  if (gap != null) {
    if (gap > 0) paceValue = `${dafim(gap)} behind`;
    else if (gap === 0) paceValue = "On today's daf";
    else if (gap === -1) paceValue = 'Caught up';
    else paceValue = `${dafim(-gap - 1)} ahead`;
  }

  const tiles = h('div', { class: 'tiles' },
    tile('Your daf', pos == null ? '—' : h('a', { href: '#/' }, dafName(pos)), pos == null ? h('a', { href: '#/' }, 'Choose where to start') : null),
    tile('Compared with the schedule', paceValue, `Today's daf: ${dafName(tIndex)}`),
    tile('Days in a row', number.format(P.streak(state, today()))),
    tile(`Cycle ${cycle}`, `${number.format(cycleLearned)} / ${number.format(cycleTotal)}`, percentOfShas(cycleLearned, cycleTotal)),
  );

  // The tractate you're learning (and today's, if different) come first, open.
  const current = [...new Set([pos != null ? S.dafAtIndex(pos) : null, S.dafAtIndex(tIndex)]
    .filter(Boolean).map((r) => `${r.cycle}/${r.tractate.en}`))]
    .map((key) => { const [c, name] = key.split('/'); return { cycle: Number(c), tractate: S.findTractate(name) }; });

  const bySeder = new Map();
  for (const t of S.TRACTATES) {
    if (!bySeder.has(t.seder)) bySeder.set(t.seder, []);
    bySeder.get(t.seder).push(t);
  }

  const seders = [...bySeder].map(([seder, list]) => h('section', { class: 'seder' },
    h('h2', {}, `Seder ${seder}`),
    list.map((t) => tractateRow(t, cycle, { open: false, pos, tIndex })),
  ));

  return h('div', { class: 'page' },
    h('h1', {}, 'Progress'),
    tiles,
    h('div', { class: 'legend small', 'aria-hidden': 'true' },
      h('span', {}, h('i', { class: 'cell is-learned' }), 'Learned'),
      h('span', {}, h('i', { class: 'cell is-pos' }), 'Your daf'),
      h('span', {}, h('i', { class: 'cell is-today' }), "Today's daf"),
      h('span', {}, h('i', { class: 'cell is-due' }), 'To catch up'),
    ),
    h('section', { class: 'seder' },
      h('h2', {}, 'Now learning'),
      current.map(({ cycle: c, tractate }) => tractateRow(tractate, c, { open: true, pos, tIndex })),
    ),
    h('h2', { class: 'section-title' }, 'All of Shas'),
    seders,
    dataCard(),
  );
}

function percentOfShas(learned, total) {
  const pct = (learned / total) * 100;
  return `${learned && pct < 0.1 ? 'under 0.1' : pct.toFixed(1)}% of Shas`;
}

function tractateRow(tractate, cycle, { open, pos, tIndex }) {
  const { learned, total } = P.tractateProgress(state, cycle, tractate);
  const first = S.indexFor(cycle, tractate, tractate.start);
  const grid = h('div', { class: 'grid' });

  function fillGrid() {
    if (grid.childElementCount) return;
    for (let i = 0; i < tractate.days; i++) {
      const index = first + i;
      const daf = tractate.start + i;
      const learnedOn = P.learnedDate(state, index);
      const classes = ['cell'];
      if (learnedOn) classes.push('is-learned');
      else if (pos != null && index > pos && index <= tIndex) classes.push('is-due');
      if (index === pos) classes.push('is-pos');
      if (index === tIndex) classes.push('is-today');
      const title = `${tractate.en} ${daf}${learnedOn ? ` · learned ${dates.full.format(S.parseIsoDate(learnedOn))}` : ''}${P.getNote(state, tractate, daf) ? ' · has notes' : ''}`;
      grid.append(h('a', { class: classes.join(' '), href: dafHref(index), title, 'aria-label': title }, String(daf)));
    }
  }

  const details = h('details', { class: 'tractate', open, ontoggle: () => details.open && fillGrid() },
    h('summary', {},
      h('span', { class: 'tractate-name' }, tractate.en, h('span', { class: 'he', lang: 'he', dir: 'rtl' }, tractate.he)),
      h('span', { class: 'tractate-count small' }, `${learned} / ${total}`),
      progressBar(learned, total, `${tractate.en} progress`),
    ),
    grid,
  );
  if (open) fillGrid();
  return details;
}

function dataCard() {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const incoming = JSON.parse(await file.text());
        const before = { learned: Object.keys(state.learned).length, notes: Object.keys(state.notes).length };
        state = P.mergeStates(state, incoming);
        persist();
        render();
        toast(`Imported ${dafim(Object.keys(state.learned).length - before.learned)} and ${plural(Object.keys(state.notes).length - before.notes, 'note', 'notes')}.`);
      } catch {
        toast("That file isn't a Daf Yomi backup.");
      }
      fileInput.value = '';
    },
  });

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: 'daf-yomi', exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `daf-yomi-backup-${S.isoDate(today())}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return h('section', { class: 'card data-card' },
    h('h2', {}, 'Your data'),
    h('p', {}, "Your progress and notes are saved in this browser only. Export a backup now and then, and import it to carry on in another browser. Importing adds to what's here; it never deletes anything."),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: exportBackup }, 'Export backup'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Import backup'),
      fileInput,
    ),
    h('div', { class: 'actions' },
      state.start
        ? h('button', {
          type: 'button',
          class: 'link-button',
          onclick: () => {
            state.start = null;
            persist();
            location.hash = '#/';
            render();
          },
        }, 'Choose a different starting point')
        : null,
      h('button', {
        type: 'button',
        class: 'link-button danger',
        onclick: () => {
          if (!confirm('Delete all your progress and notes from this browser? This cannot be undone.')) return;
          state = P.emptyState();
          persist();
          render();
          toast('Everything has been cleared.');
        },
      }, 'Delete everything'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Notes page

function notesPage() {
  document.title = 'Notes · Daf Yomi';
  const notes = P.allNotes(state);
  const list = h('div', { class: 'notes-list' });
  const search = h('input', {
    type: 'search',
    placeholder: 'Search your notes',
    'aria-label': 'Search your notes',
    oninput: () => draw(search.value.trim().toLowerCase()),
  });

  function draw(query) {
    const shown = query
      ? notes.filter((n) => n.text.toLowerCase().includes(query) || `${n.tractate.en} ${n.daf}`.toLowerCase().includes(query))
      : notes;
    list.replaceChildren(...(shown.length
      ? shown.map((n) => {
        const index = S.indexFor(currentCycle(), n.tractate, n.daf);
        return h('article', { class: 'card note' },
          h('div', { class: 'card-title' },
            h('h2', {}, h('a', { href: dafHref(index) }, `${n.tractate.en} ${n.daf}`), h('span', { class: 'he', lang: 'he', dir: 'rtl' }, dafNameHe(index))),
            h('span', { class: 'small' }, `Edited ${dates.full.format(new Date(n.updated))}`),
          ),
          h('p', { class: 'note-text' }, n.text),
        );
      })
      : [h('p', { class: 'empty' }, notes.length ? 'No notes match.' : 'No notes yet. Write notes on any daf and they will all be collected here, in the order of the Shas.')]));
  }
  draw('');

  return h('div', { class: 'page' },
    h('h1', {}, 'Notes'),
    notes.length ? search : null,
    list,
  );
}

// ---------------------------------------------------------------------------
// Schedule page

function schedulePage() {
  document.title = 'Schedule · Daf Yomi';
  const tIndex = todayIndex();
  const { cycle } = S.dafAtIndex(tIndex);
  const cycleStart = S.cycleStartIndex(cycle);
  const cycleEnd = cycleStart + S.CYCLE_LENGTH - 1;
  const daysLeft = cycleEnd - tIndex;

  const upcoming = Array.from({ length: 14 }, (_, i) => tIndex + i);

  const cycleCard = h('section', { class: 'card' },
    h('h2', {}, `Cycle ${cycle}`),
    h('p', {},
      `Began ${dates.long.format(S.dateForIndex(cycleStart))}. `,
      'The Siyum HaShas is on ', h('strong', {}, dates.long.format(S.dateForIndex(cycleEnd))),
      daysLeft > 0 ? `, in ${plural(daysLeft, 'day', 'days')}. ` : '. ',
      `Cycle ${cycle + 1} begins with Berakhot 2 on ${dates.long.format(S.dateForIndex(cycleEnd + 1))}.`,
    ),
  );

  const upcomingTable = h('section', { class: 'card' },
    h('h2', {}, 'Coming up'),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'hide-narrow' }, 'Hebrew date'), h('th', {}, 'Daf'), h('th', {}, h('span', { class: 'visually-hidden' }, 'Learned')))),
      h('tbody', {}, upcoming.map((i) => {
        const date = S.dateForIndex(i);
        return h('tr', { class: i === tIndex ? 'is-current' : null },
          h('td', {}, i === tIndex ? 'Today' : dates.day.format(date)),
          h('td', { class: 'hide-narrow' }, hebrewDate(date)),
          h('td', {}, h('a', { href: dafHref(i) }, dafName(i)), ' ', h('span', { class: 'he small', lang: 'he', dir: 'rtl' }, dafNameHe(i))),
          h('td', { class: 'check' }, P.isLearned(state, i) ? h('span', { title: 'Learned', 'aria-label': 'Learned' }, '✓') : ''),
        );
      })),
    ),
  );

  const tractateTable = h('section', { class: 'card' },
    h('h2', {}, 'Tractates in this cycle'),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Tractate'), h('th', {}, 'Dafim'), h('th', { class: 'hide-narrow' }, 'Begins'), h('th', {}, 'Siyum'), h('th', {}, 'You'))),
        h('tbody', {}, S.TRACTATES.map((t) => {
          const first = S.indexFor(cycle, t, t.start);
          const last = S.indexFor(cycle, t, t.end);
          const { learned, total } = P.tractateProgress(state, cycle, t);
          const rowClass = tIndex > last ? 'is-past' : tIndex >= first ? 'is-current' : null;
          return h('tr', { class: rowClass },
            h('td', {}, h('a', { href: dafHref(first) }, t.en), ' ', h('span', { class: 'he small', lang: 'he', dir: 'rtl' }, t.he)),
            h('td', {}, `${t.start}–${t.end}`),
            h('td', { class: 'hide-narrow' }, dates.full.format(S.dateForIndex(first))),
            h('td', {}, dates.full.format(S.dateForIndex(last))),
            h('td', {}, learned ? `${learned}/${total}` : ''),
          );
        })),
      ),
    ),
  );

  return h('div', { class: 'page' }, h('h1', {}, 'Schedule'), cycleCard, upcomingTable, tractateTable);
}

// ---------------------------------------------------------------------------

updateStorageWarning();
render();
