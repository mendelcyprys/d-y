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
import { readingPosition, passageAt } from './reading.js';
import { createSync, syncPayload } from './sync.js';

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
  sync.changed(state);
}

/** Save display settings only: they stay on this device, so there's nothing to back up. */
function persistSettings() {
  saveState(state);
  updateStorageWarning();
}

// ---------------------------------------------------------------------------
// Automatic backup (see src/sync.js and worker/)

const sync = createSync({
  getState: () => state,
  applyRemote,
  onStatus: showSyncStatus,
});
let syncStatus = sync.status();

/** Take a record synced from the backup, keeping this device's settings. */
function applyRemote(incoming) {
  const next = P.normalizeState(incoming);
  next.settings = state.settings;
  if (JSON.stringify(syncPayload(next)) === JSON.stringify(syncPayload(state))) return;
  state = next;
  saveState(state);
  // Don't pull the page out from under you while you're typing or reading.
  const typing = document.activeElement?.matches('input, textarea');
  const reading = ['learn', 'daf'].includes(parseRoute().view) && window.scrollY > 300;
  if (typing || reading) {
    toast('Updated with changes from your other device.', 8000, { label: 'Show', onClick: render });
  } else {
    render();
  }
}

function minutesAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour', 'hours')} ago`;
  return dates.full.format(new Date(iso));
}

function syncStatusText(status) {
  if (status.signedOut) return 'Logged out of your account on this device. Log in again to keep backing up.';
  if (!status.enabled) return null;
  switch (status.state) {
    case 'syncing': return 'Backing up…';
    case 'pending': return 'Will back up in a moment.';
    case 'offline': return "Offline: will back up when you're back online.";
    case 'error': return `Couldn't reach your backup (${status.message}). Will try again.`;
    default: return status.lastSynced ? `Backed up ${minutesAgo(status.lastSynced)}.` : 'Backed up.';
  }
}

// ---- The backup icon in the top bar, and the panel it opens.

const syncIndicator = document.getElementById('sync-indicator');
const syncButton = document.getElementById('sync-button');
const syncPanel = document.getElementById('sync-panel');

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const CLOUD = 'M17.5 19H7.2a4.7 4.7 0 0 1-.7-9.35A6.2 6.2 0 0 1 18.4 9.2 4.9 4.9 0 0 1 17.5 19Z';
const ICON_MARKS = {
  saved: () => [svg('path', { d: 'M9.2 14.2l2 2 3.8-3.9' })],
  pending: () => [svg('circle', { class: 'mark-dot', cx: '19', cy: '6.5', r: '3.4' })],
  syncing: () => [svg('g', { class: 'mark-spin' }, svg('path', { d: 'M9.6 13.6a2.6 2.6 0 0 1 4.6-1.4' }), svg('path', { d: 'M14.4 15.4a2.6 2.6 0 0 1-4.6 1.4' }), svg('path', { d: 'M14.4 10.6v1.8h-1.8' }), svg('path', { d: 'M9.6 18.4v-1.8h1.8' }))],
  offline: () => [svg('path', { d: 'M4 4.5l16 15' })],
  error: () => [svg('path', { d: 'M12.1 10.6v3.2' }), svg('path', { d: 'M12.1 16.4v.1' })],
  off: () => [svg('path', { d: 'M12.1 16.6v-4.8' }), svg('path', { d: 'M9.8 13.8l2.3-2.3 2.3 2.3' })],
};

function iconState(status) {
  if (status.signedOut) return 'error';
  if (!status.enabled) return 'off';
  return { saved: 'saved', pending: 'pending', syncing: 'syncing', offline: 'offline', error: 'error' }[status.state] || 'pending';
}

/** "Arakhin 5", "Arakhin 5 and Arakhin 6", "Arakhin 5, Arakhin 6 and 3 more". */
function describeUnsaved(keys) {
  const names = keys.map((k) => (k === 'start' ? 'your starting point' : k));
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

// `detail` lists which dafim are waiting; that means checking every daf, so
// it's only done when the panel is open, not on every change.
function syncSummary(status, { detail = false } = {}) {
  const unsaved = detail ? sync.unsavedKeys() : status.state === 'pending' ? ['?'] : [];
  const waiting = !unsaved.length ? '' : detail ? `Not backed up yet: ${describeUnsaved(unsaved)}.` : 'Some changes are not backed up yet.';
  if (status.signedOut) return { title: 'Logged out on this device', text: 'Log in again to keep backing up. Your progress here is safe.' };
  if (!status.enabled) return { title: 'Not backed up', text: 'Your progress is only saved on this device. Create a free account to back it up and use it on your other devices.' };
  switch (status.state) {
    case 'syncing': return { title: 'Backing up…', text: waiting };
    case 'offline': return { title: "You're offline", text: unsaved.length ? `${waiting} It will back up when you're back online.` : detail ? 'Everything was backed up before you went offline.' : "It will back up when you're back online." };
    case 'error': return { title: "Couldn't back up", text: `${status.message || ''} ${waiting} It will try again.`.trim() };
    default:
      if (unsaved.length) return { title: 'Changes not backed up yet', text: `${waiting} Backing up in a moment.` };
      return { title: 'All changes backed up', text: status.lastSynced ? `Last backed up ${minutesAgo(status.lastSynced)}.` : '' };
  }
}

function closeSyncPanel() {
  syncPanel.hidden = true;
  syncButton.setAttribute('aria-expanded', 'false');
}

function goToAccount() {
  closeSyncPanel();
  const scroll = () => document.querySelector('.data-card')?.scrollIntoView({ behavior: smooth(), block: 'start' });
  if (parseRoute().view === 'progress') scroll();
  else {
    location.hash = '#/progress';
    setTimeout(scroll, 80);
  }
}

function drawSyncPanel() {
  const status = sync.status();
  const { title, text } = syncSummary(status, { detail: true });
  syncPanel.replaceChildren(
    h('p', { class: 'sync-panel-title' }, title),
    text ? h('p', { class: 'small' }, text) : null,
    h('div', { class: 'sync-panel-actions' },
      status.enabled ? h('button', { type: 'button', class: 'btn', onclick: () => sync.syncNow() }, 'Back up now') : null,
      h('button', { type: 'button', class: 'link-button', onclick: goToAccount },
        status.enabled ? 'Account' : status.signedOut ? 'Log in' : 'Create an account'),
    ),
  );
}

syncButton.addEventListener('click', () => {
  if (!syncPanel.hidden) {
    closeSyncPanel();
    return;
  }
  drawSyncPanel();
  syncPanel.hidden = false;
  syncButton.setAttribute('aria-expanded', 'true');
});
document.addEventListener('click', (event) => {
  if (!syncIndicator.contains(event.target)) closeSyncPanel();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !syncPanel.hidden) {
    closeSyncPanel();
    syncButton.focus();
  }
});

function drawSyncIcon(status) {
  const state = iconState(status);
  syncIndicator.hidden = false;
  syncIndicator.dataset.state = state;
  syncButton.replaceChildren(svg('svg', { viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' },
    svg('path', { class: 'cloud', d: CLOUD }), ...ICON_MARKS[state]()));
  const { title, text } = syncSummary(status);
  syncButton.setAttribute('aria-label', `Backup: ${title}`);
  syncButton.title = [title, text].filter(Boolean).join('. ');
  if (!syncPanel.hidden) drawSyncPanel();
}

function showSyncStatus(status) {
  syncStatus = status;
  drawSyncIcon(status);
  const footer = document.getElementById('sync-footer');
  const text = syncStatusText(status);
  if (text) footer.replaceChildren(text);
  else if (sync.available()) footer.replaceChildren('Your progress and notes are only in this browser. ', h('a', { href: '#/progress' }, 'Create an account'), ' to back them up.');
  else footer.replaceChildren('Your progress and notes stay in this browser.');
  for (const el of document.querySelectorAll('[data-sync-status]')) el.textContent = text || '';
}

let toastTimer;
function toast(message, ms = 3500, action = null) {
  const el = document.getElementById('toast');
  el.replaceChildren(...[].concat(message));
  if (action) {
    el.append(' ', h('button', {
      type: 'button',
      class: 'toast-action',
      onclick: () => {
        el.classList.remove('show');
        action.onClick();
      },
    }, action.label));
  }
  el.classList.toggle('has-action', Boolean(action));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function updateStorageWarning() {
  document.getElementById('storage-warning').hidden = storageAvailable();
}

/** Mark a daf as learned (or not), with a mazal tov at the end of a tractate. */
function setDafLearned(index, learned) {
  const { tractate, cycle } = S.dafAtIndex(index);
  P.setLearned(state, index, learned, today());
  if (learned && !state.start) P.setStart(state, index);
  persist();
  if (learned && P.tractateComplete(state, cycle, tractate)) {
    toast([
      h('strong', {}, `Mazal tov! You've finished ${tractate.en}.`), ' ',
      h('span', { lang: 'he', dir: 'rtl' }, `הדרן עלך מסכת ${tractate.he}`),
    ], 8000);
  } else if (learned) {
    toast(`Marked ${dafName(index)} as learned.`);
  }
}

const timesWord = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${number.format(n)} times`);

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
  stopTracking?.();
  stopTracking = null;
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
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest('input, textarea, select, [contenteditable], [role="separator"], [role="slider"]')) return;
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
    keepReadingPlace(() => {
      if (paceCard) {
        const next = renderPace();
        paceCard.replaceWith(next);
        paceCard = next;
      }
      const next = renderHead();
      headCard.replaceWith(next);
      headCard = next;
    });
  }

  function renderHead() {
    return dafHeadCard(index, { home, onChange: refresh });
  }

  // Reading every passage offers to mark the daf as learned.
  function onReadThrough(times) {
    if (times === 1 && !P.isLearned(state, index)) {
      toast(`You've read every passage of ${dafName(index)}.`, 10000, {
        label: 'Mark daf as learned',
        onClick: () => {
          setDafLearned(index, true);
          refresh();
        },
      });
    } else {
      toast(`You've read ${dafName(index)} through ${timesWord(times)}.`);
    }
  }

  column.append(...[paceCard, headCard, textCard(index, { onReadThrough })].filter(Boolean));
  side.append(...[notesCard(tractate, S.dafAtIndex(index).daf), home ? reviewCard() : null, gotoCard(index)].filter(Boolean));
  page.append(column, resizeHandle(page, column), side);
  applyTextWidth(page);
  stopTracking = trackReading(page);
  return page;
}

// ---------------------------------------------------------------------------
// Where you are in a long daf. A bar along the bottom of the top bar has a
// tick for every passage (green once read) and the amudim marked; it fills as
// you read, with the passage number you're on at its end. Tap or drag along
// it to move through the daf. A label beside the logo says which amud and
// passage you're on; tapping it opens a menu to jump to the top, to an amud,
// or to your notes.

const topbar = document.querySelector('.topbar');
const readingNav = document.getElementById('reading-nav');
const readingStatus = document.getElementById('reading-status');
const readingMenu = document.getElementById('reading-menu');
const readingBar = document.getElementById('reading-bar');
const readingFill = readingBar.querySelector('.reading-fill');
const readingTicks = readingBar.querySelector('.reading-ticks');
const readingLabels = readingBar.querySelector('.reading-labels');
const readingHead = readingBar.querySelector('.reading-head');
const readingTip = readingBar.querySelector('.reading-tip');
let stopTracking = null;

// Keep the top bar's height in a CSS variable, so that jumping to a heading
// leaves it in view below the bar.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}).observe(topbar);

const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * Make a change to the page without moving the passage you're reading:
 * if you've scrolled into the text, the first passage that starts on screen
 * stays exactly where it is, even when Rashi or context loads in above it.
 * Browsers' own "scroll anchoring" does a rougher version of this (and still
 * covers things like fonts loading), but Safari doesn't have it, and it can
 * anchor to a passage half off the screen, which then grows when its Rashi
 * arrives and pushes the passage you're reading down.
 */
function keepReadingPlace(change) {
  const barBottom = topbar.getBoundingClientRect().bottom;
  const rows = [...document.querySelectorAll('.amud-section .seg-row')];
  if (!rows.length || rows[0].getBoundingClientRect().top >= barBottom) {
    change(); // not reading yet: let the text simply move down
    return;
  }
  // The first passage that starts on screen (anything added inside a passage
  // only grows it downwards), or failing that the one filling the screen.
  const anchor = rows.find((row) => row.getBoundingClientRect().top >= barBottom)
    || rows.findLast((row) => row.getBoundingClientRect().top < barBottom);
  const before = anchor.getBoundingClientRect().top;
  change();
  const shift = anchor.getBoundingClientRect().top - before;
  if (shift) window.scrollBy(0, shift);
}

function closeReadingMenu() {
  readingMenu.hidden = true;
  readingStatus.setAttribute('aria-expanded', 'false');
}

/** Name a passage row, e.g. "2a · 7" (or just "64a" when the amud is one). */
function passageName(row) {
  const { amud, number: n } = row.querySelector('.seg-mark').dataset;
  return n === 'all' ? amud : `${amud} · ${n}`;
}

function trackReading(page) {
  let frame = 0;
  let dragging = false;
  let tickSignature = '';

  // This daf's own passages (not the context shown from the dafim either
  // side), and where they are right now.
  function measure() {
    const rows = [...page.querySelectorAll('.amud-section .seg-row')];
    if (!rows.length) return null;
    const barBottom = topbar.getBoundingClientRect().bottom;
    const readAt = barBottom + (window.innerHeight - barBottom) / 4;
    const tops = rows.map((row) => row.getBoundingClientRect().top);
    const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
    const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    return { rows, readAt, ...readingPosition(tops, bottom, readAt, atEnd) };
  }

  // One tick per passage, and a label where each amud starts. Rebuilt only
  // when the passages change; moved when the layout changes.
  function drawTicks({ rows, ticks }) {
    const signature = rows.map((row) => row.querySelector('.seg-mark').dataset.passage).join();
    if (signature !== tickSignature) {
      tickSignature = signature;
      readingTicks.replaceChildren(...rows.map((row) => {
        const amudStart = row === row.closest('.amud-section').querySelector('.seg-row');
        return h('span', { class: amudStart ? 'tick is-amud' : 'tick' });
      }));
      readingLabels.replaceChildren(...rows
        .filter((row) => row === row.closest('.amud-section').querySelector('.seg-row'))
        .map((row) => h('span', { 'data-row': String(rows.indexOf(row)) }, row.querySelector('.seg-mark').dataset.amud)));
    }
    rows.forEach((row, i) => {
      const tick = readingTicks.children[i];
      const left = `${(ticks[i] * 100).toFixed(2)}%`;
      if (tick.style.left !== left) tick.style.left = left;
      tick.classList.toggle('is-read', row.querySelector('.seg-mark').classList.contains('is-read'));
    });
    for (const label of readingLabels.children) label.style.left = `${(ticks[Number(label.dataset.row)] * 100).toFixed(2)}%`;
  }

  function update() {
    frame = 0;
    const m = measure();
    if (!m) {
      readingNav.hidden = true;
      readingBar.hidden = true;
      return;
    }
    const { rows, current, fill, started } = m;
    const pct = Math.round(fill * 100);
    readingBar.hidden = false;
    drawTicks(m);
    readingFill.style.width = `${fill * 100}%`;

    const row = rows[current];
    const { amud, number: n } = row.querySelector('.seg-mark').dataset;
    const total = row.closest('.amud-section').querySelectorAll('.seg-row').length;
    readingHead.hidden = !started;
    readingHead.style.left = `${fill * 100}%`;
    readingHead.textContent = n === 'all' ? amud : n;
    readingBar.setAttribute('aria-valuemin', '1');
    readingBar.setAttribute('aria-valuemax', String(rows.length));
    readingBar.setAttribute('aria-valuenow', String(current + 1));
    readingBar.setAttribute('aria-valuetext', n === 'all' ? amud : `${amud}, passage ${n} of ${total}`);

    if (!started) {
      readingNav.hidden = true;
      closeReadingMenu();
      return;
    }
    readingStatus.textContent = n === 'all' ? `${amud} · ${pct}%` : `${amud} · ${n}/${total} · ${pct}%`;
    readingStatus.setAttribute('aria-label', n === 'all'
      ? `You're on ${amud}, ${pct}% of the way through. Jump to…`
      : `You're on ${amud}, passage ${n} of ${total}, ${pct}% of the way through. Jump to…`);
    readingNav.hidden = false;
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  // ---- Moving through the daf with the bar.

  // Put a passage's start just above the reading line, so it's the one
  // you're on, with the end of the one before above it for context.
  function goToPassage(i) {
    const m = measure();
    if (!m) return;
    const index = Math.min(m.rows.length - 1, Math.max(0, i));
    const top = m.rows[index].getBoundingClientRect().top;
    window.scrollTo({ top: window.scrollY + top - (m.readAt - 1), behavior: 'auto' });
    return m.rows[index];
  }

  function fractionAt(clientX) {
    const r = readingBar.querySelector('.reading-track').getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  }

  function showTip(clientX, row) {
    const r = readingBar.getBoundingClientRect();
    readingTip.textContent = passageName(row);
    readingTip.style.left = `${Math.min(r.width - 30, Math.max(30, clientX - r.left))}px`;
    readingTip.hidden = false;
  }

  function scrubTo(clientX) {
    const m = measure();
    if (!m) return;
    const row = goToPassage(passageAt(m.ticks, fractionAt(clientX)));
    if (row) showTip(clientX, row);
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    readingBar.setPointerCapture(event.pointerId);
    dragging = true;
    readingBar.classList.add('is-dragging');
    scrubTo(event.clientX);
  };
  const onPointerMove = (event) => {
    if (dragging) {
      scrubTo(event.clientX);
    } else if (event.pointerType === 'mouse') {
      const m = measure();
      if (m) showTip(event.clientX, m.rows[passageAt(m.ticks, fractionAt(event.clientX))]);
    }
  };
  const onPointerEnd = () => {
    dragging = false;
    readingBar.classList.remove('is-dragging');
    readingTip.hidden = true;
  };
  const onPointerLeave = () => {
    if (!dragging) readingTip.hidden = true;
  };
  const onBarKey = (event) => {
    const m = measure();
    if (!m) return;
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (event.key in moves) goToPassage(m.current + moves[event.key]);
    else if (event.key === 'Home') goToPassage(0);
    else if (event.key === 'End') goToPassage(m.rows.length - 1);
    else return;
    event.preventDefault();
  };

  // ---- The label's menu.

  function openMenu() {
    const jump = (target, focus) => () => {
      closeReadingMenu();
      target.scrollIntoView({ behavior: smooth(), block: 'start' });
      focus?.focus({ preventScroll: true });
    };
    const amudim = [...page.querySelectorAll('.amud-section')];
    readingMenu.replaceChildren(
      h('button', { type: 'button', onclick: jump(page.querySelector('.daf-head')) }, 'Top of the daf'),
      ...amudim.map((section) => h('button', { type: 'button', onclick: jump(section.querySelector('.amud')) },
        section.dataset.label,
        h('span', { class: 'small' }, `${section.querySelectorAll('.seg-row').length} passages`))),
      h('button', { type: 'button', onclick: jump(page.querySelector('.notes-card'), page.querySelector('#note-text')) }, 'Your notes'),
    );
    readingMenu.hidden = false;
    readingStatus.setAttribute('aria-expanded', 'true');
    readingMenu.querySelector('button').focus({ preventScroll: true });
  }

  const onStatusClick = () => (readingMenu.hidden ? openMenu() : closeReadingMenu());
  const onDocumentClick = (event) => {
    if (!readingNav.contains(event.target)) closeReadingMenu();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !readingMenu.hidden) {
      closeReadingMenu();
      readingStatus.focus();
    }
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  readingStatus.addEventListener('click', onStatusClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKey);
  readingBar.addEventListener('pointerdown', onPointerDown);
  readingBar.addEventListener('pointermove', onPointerMove);
  readingBar.addEventListener('pointerup', onPointerEnd);
  readingBar.addEventListener('pointercancel', onPointerEnd);
  readingBar.addEventListener('pointerleave', onPointerLeave);
  readingBar.addEventListener('keydown', onBarKey);
  // The text arrives a moment after the page, then Rashi; read marks change
  // as you go. Any of these can move the ticks.
  const observer = new MutationObserver(schedule);
  observer.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-layout', 'data-rashi', 'data-rashi-script', 'style'] });
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    readingStatus.removeEventListener('click', onStatusClick);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKey);
    readingBar.removeEventListener('pointerdown', onPointerDown);
    readingBar.removeEventListener('pointermove', onPointerMove);
    readingBar.removeEventListener('pointerup', onPointerEnd);
    readingBar.removeEventListener('pointercancel', onPointerEnd);
    readingBar.removeEventListener('pointerleave', onPointerLeave);
    readingBar.removeEventListener('keydown', onBarKey);
    observer.disconnect();
    closeReadingMenu();
    readingNav.hidden = true;
    readingBar.hidden = true;
    readingTip.hidden = true;
    tickSignature = '';
  };
}

// ---------------------------------------------------------------------------
// Making the text column wider or narrower (on screens wide enough to have
// the side panel beside it). The width is saved; double-click resets it.

function applyTextWidth(layout) {
  const width = state.settings.textWidth;
  layout.classList.toggle('has-width', width != null);
  if (width != null) layout.style.setProperty('--text-width', `${width}px`);
  else layout.style.removeProperty('--text-width');
}

function resizeHandle(layout, column) {
  const STEP = 40;
  const handle = h('div', {
    class: 'resize-handle',
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'vertical',
    'aria-label': 'Text width',
    title: 'Drag to make the text wider or narrower. Double-click to reset.',
  }, h('span', { class: 'grip' }));

  // Widest the text can be: the whole window less the side panel and margins.
  function clamp(width) {
    const others = layout.getBoundingClientRect().width - column.getBoundingClientRect().width;
    const max = document.documentElement.clientWidth - 32 - others;
    return Math.round(Math.max(P.MIN_TEXT_WIDTH, Math.min(max, width)));
  }

  function setWidth(width, save) {
    state.settings.textWidth = width == null ? null : clamp(width);
    applyTextWidth(layout);
    handle.setAttribute('aria-valuenow', String(Math.round(column.getBoundingClientRect().width)));
    if (save) persistSettings();
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = column.getBoundingClientRect().width;
    layout.classList.add('is-resizing');
    // The page stays centred, so it grows on both sides: twice the distance
    // moved keeps the handle under the pointer.
    const move = (e) => setWidth(startWidth + 2 * (e.clientX - startX), false);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      layout.classList.remove('is-resizing');
      persistSettings();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end, { once: true });
    handle.addEventListener('pointercancel', end, { once: true });
  });

  handle.addEventListener('dblclick', () => setWidth(null, true));

  handle.addEventListener('keydown', (event) => {
    const current = column.getBoundingClientRect().width;
    if (event.key === 'ArrowRight') setWidth(current + STEP, true);
    else if (event.key === 'ArrowLeft') setWidth(current - STEP, true);
    else if (event.key === 'Home') setWidth(null, true);
    else return;
    event.preventDefault();
  });

  return handle;
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
    setDafLearned(index, !P.isLearned(state, index));
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

function textCard(index, { onReadThrough } = {}) {
  const settings = state.settings;
  const { tractate, daf } = S.dafAtIndex(index);
  const readSummary = h('div', { class: 'reading-summary small', hidden: true, 'aria-live': 'polite' });
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
    keepReadingPlace(() => {
      rashiNote.replaceChildren(...content);
      rashiNote.hidden = !content.length || !settings.rashi;
    });
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
      keepReadingPlace(() => {
        for (const slot of body.querySelectorAll('.rashi[data-amud]')) {
          const passages = rashi.byAmud[slot.dataset.amud] || [];
          const comments = slot.dataset.seg === 'all' ? passages.flat() : passages[Number(slot.dataset.seg)] || [];
          if (comments.length) slot.replaceChildren(...rashiView(comments));
        }
      });
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
      persistSettings();
      keepReadingPlace(() => { body.dataset.rashi = settings.rashi ? 'on' : 'off'; });
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
      persistSettings();
      keepReadingPlace(() => { body.dataset.rashiScript = settings.rashiScript ? 'on' : 'off'; });
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
      persistSettings();
      keepReadingPlace(() => { body.dataset.layout = value; });
      for (const b of event.currentTarget.parentElement.children) b.setAttribute('aria-pressed', b === event.currentTarget ? 'true' : 'false');
    },
  }, label));

  const resize = (step) => () => {
    settings.fontScale = Math.min(1.8, Math.max(0.8, Math.round((settings.fontScale + step) * 10) / 10));
    persistSettings();
    keepReadingPlace(() => body.style.setProperty('--scale', settings.fontScale));
  };

  // ---- Reading passages: marks beside each passage, a button on each amud,
  // and a summary for the whole daf.
  const passagesIn = (root) => [...root.querySelectorAll('.seg-mark')].map((m) => m.dataset.passage);
  const countsIn = (root) => passagesIn(root).map((p) => P.readCount(state, tractate, daf, p));

  function updateReading() {
    for (const mark of body.querySelectorAll('.seg-mark')) {
      const { passage, number: n, amud } = mark.dataset;
      const dates = P.readDates(state, tractate, daf, passage);
      const count = dates.length;
      const button = mark.querySelector('.read-btn');
      const name = n === 'all' ? amud : `passage ${n} of ${amud}`;
      mark.classList.toggle('is-read', count > 0);
      button.textContent = count === 0 ? '' : count === 1 ? '✓' : `${count}×`;
      button.setAttribute('aria-label', count
        ? `Read ${timesWord(count)}, last ${relativeDay(S.parseIsoDate(dates[count - 1]))}. Mark ${name} read again`
        : `Mark ${name} as read`);
      button.title = count
        ? `Read ${timesWord(count)}, last ${relativeDay(S.parseIsoDate(dates[count - 1]))}. Click when you read it again.`
        : 'Mark as read';
      mark.querySelector('.unread-btn').hidden = count === 0;
    }

    for (const section of body.querySelectorAll('.amud-section')) {
      const { total, times, ahead, read } = P.readingSummary(countsIn(section));
      const label = section.dataset.label;
      let text = '';
      if (times > 0) text = `Read ${timesWord(times)}${ahead ? ` · ${ahead} of ${total} again` : ''}`;
      else if (read > 0) text = `${read} of ${total} read`;
      section.querySelector('.amud-progress').textContent = text;
      const button = section.querySelector('.amud-read-btn');
      button.textContent = times > 0 ? `Read ${label} again` : `Mark ${label} read`;
    }

    const { total, times, ahead, read } = P.readingSummary(countsIn(body));
    readSummary.hidden = total === 0;
    if (times > 0) {
      readSummary.replaceChildren(h('strong', {}, `Read through ${timesWord(times)}`),
        ahead ? ` · ${ahead} of ${total} passages read again` : '');
    } else if (read > 0) {
      readSummary.replaceChildren(`${read} of ${total} passages read`);
    } else {
      readSummary.replaceChildren('Tap the circle beside each passage as you read it.');
    }
    readSummary.prepend(progressBar(times > 0 ? ahead : read, total, 'Passages read'));
  }

  function changeReads(change) {
    const before = P.readingSummary(countsIn(body)).times;
    change();
    persist();
    keepReadingPlace(updateReading);
    const after = P.readingSummary(countsIn(body)).times;
    if (after > before) onReadThrough?.(after);
  }

  body.addEventListener('click', (event) => {
    const mark = event.target.closest('.seg-mark');
    if (mark && event.target.closest('.read-btn')) {
      changeReads(() => P.addRead(state, tractate, daf, mark.dataset.passage, today()));
      return;
    }
    if (mark && event.target.closest('.unread-btn')) {
      changeReads(() => P.removeRead(state, tractate, daf, mark.dataset.passage));
      return;
    }
    const amud = event.target.closest('.amud-read-btn');
    if (amud) {
      changeReads(() => P.finishReading(state, tractate, daf, passagesIn(amud.closest('.amud-section')), today()));
    }
  });

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

  // ---- Context: the end of the previous daf above the text and the start of
  // the next below it, so a sugya that runs across the page isn't cut off.
  // Read-only, and loaded one at a time after the text and Rashi, to go easy
  // on Sefaria. Loading the next daf also makes moving on to it instant.
  async function loadContext() {
    for (const [near, where] of [[index - 1, 'before'], [index + 1, 'after']]) {
      if (near < 0 || S.dafAtIndex(near).tractate !== tractate) continue; // not across tractates
      try {
        const block = contextView(await loadDaf(near), near, where);
        if (!block || !body.isConnected || !body.querySelector('.amud-section')) continue;
        if (where === 'before') keepReadingPlace(() => body.prepend(block));
        else body.append(block);
      } catch {
        // Context is a nicety; if Sefaria won't give it, carry on without.
      }
    }
  }

  async function load() {
    body.replaceChildren(h('p', { class: 'loading' }, 'Loading the text from Sefaria…'));
    try {
      const text = await loadDaf(index);
      body.replaceChildren(...text.sections.map(sectionView));
      updateReading();
      gemaraShown = true;
      showRashi().finally(loadContext);
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
    readSummary,
    rashiNote,
    body,
    credits,
  );
}

function para(html, lang) {
  return h('p', lang === 'he' ? { lang: 'he', dir: 'rtl' } : { lang: 'en' }, textToFragment(html));
}

/**
 * The passages next to the page break from the daf before (its last) or
 * after (its first): shaded, read-only, and at first only the nearest
 * passage, cut off with a fade at the far end. "Show more" shows that
 * passage whole, then adds more passages.
 */
const CONTEXT_MORE = 2;

function contextView(text, nearIndex, where) {
  const section = where === 'before' ? text.sections[text.sections.length - 1] : text.sections[0];
  if (!section) return null;
  const { tractate } = S.dafAtIndex(nearIndex);
  const name = /^\d+[ab]$/.test(section.label) ? `${tractate.en} ${section.label}` : dafName(nearIndex);
  const label = h('span', {}, where === 'before' ? 'From the end of ' : 'Continues on ', h('a', { href: dafHref(nearIndex) }, name));
  const row = (he, en) => h('div', { class: 'seg-row context-row' },
    h('div', { class: 'seg-content' }, h('div', { class: 'he' }, he), h('div', { class: 'en' }, en)));
  const list = h('div', { class: 'context-rows is-clipped' });
  const more = h('button', { type: 'button', class: 'link-button' }, 'Show more');

  // Passages as [Hebrew, English]; if the languages don't line up passage by
  // passage, the whole amud is one.
  const paired = section.he.length === section.en.length;
  const passages = paired
    ? section.he.map((he, i) => [[he], [section.en[i]]]).filter(([[he], [en]]) => he || en)
    : [[section.he, section.en]];
  let shown = 0;

  function add(count) {
    const next = Math.min(passages.length, shown + count);
    const rows = (where === 'before'
      ? passages.slice(passages.length - next, passages.length - shown)
      : passages.slice(shown, next)).map(([he, en]) => row(he.map((t) => para(t, 'he')), en.map((t) => para(t, 'en'))));
    if (where === 'before') list.prepend(...rows);
    else list.append(...rows);
    shown = next;
  }

  const clipped = () => list.classList.contains('is-clipped');
  const refreshButton = () => { more.hidden = !clipped() && shown >= passages.length; };
  more.addEventListener('click', () => {
    if (clipped()) list.classList.remove('is-clipped');
    else add(CONTEXT_MORE);
    refreshButton();
  });
  add(1);

  // A short passage may fit without cutting off; then there's nothing to fade.
  const fit = new ResizeObserver(() => {
    if (!clipped()) {
      fit.disconnect();
      return;
    }
    const content = [...list.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    if (list.clientHeight && content <= list.clientHeight + 1) {
      keepReadingPlace(() => list.classList.remove('is-clipped'));
      refreshButton();
      fit.disconnect();
    }
  });
  fit.observe(list);
  refreshButton();

  // Earlier passages appear above, so "Show more" goes at the top before the
  // daf, and at the bottom after it.
  const block = h('section', { class: `context context-${where}`, 'aria-label': `${name}, for context` });
  if (where === 'before') block.append(h('div', { class: 'context-head small' }, label, more), list);
  else block.append(h('div', { class: 'context-head small' }, label), list, h('div', { class: 'context-foot small' }, more));
  return block;
}

function sectionView(section) {
  const he = amudLabelHe(section.label);
  const heading = h('div', { class: 'amud' },
    h('h3', {}, section.label),
    h('span', { class: 'amud-progress small' }),
    h('button', { type: 'button', class: 'amud-read-btn' }, `Mark ${section.label} read`),
    he ? h('span', { class: 'he amud-he', lang: 'he', dir: 'rtl' }, he) : null,
  );

  // Beside each passage: a circle to tap each time you read it, and a small
  // button to take back a read tapped by mistake.
  const mark = (n) => h('div', {
    class: 'seg-mark',
    'data-passage': `${section.label}:${n}`,
    'data-amud': section.label,
    'data-number': String(n),
  },
  h('button', { type: 'button', class: 'read-btn' }),
  h('button', { type: 'button', class: 'unread-btn', 'aria-label': 'Take back one read', title: 'Take back one read', hidden: true }, '−'));
  const row = (n, ...cells) => h('div', { class: 'seg-row' }, mark(n), h('div', { class: 'seg-content' }, cells));

  // When both languages have the same number of passages, line them up side
  // by side; otherwise show each language as one block.
  // Each row also has an empty slot that Rashi's comments on that passage
  // are put into once they load.
  const rashiSlot = (seg) => h('div', { class: 'rashi', lang: 'he', dir: 'rtl', 'data-amud': section.label, 'data-seg': seg });
  let rows;
  if (section.he.length === section.en.length) {
    rows = section.he.map((heText, i) => (heText || section.en[i]
      ? row(i + 1,
        h('div', { class: 'he' }, para(heText, 'he')),
        h('div', { class: 'en' }, para(section.en[i], 'en')),
        rashiSlot(String(i)))
      : null));
  } else {
    rows = [row('all',
      h('div', { class: 'he' }, section.he.map((t) => para(t, 'he'))),
      h('div', { class: 'en' }, section.en.map((t) => para(t, 'en'))),
      rashiSlot('all'))];
  }
  return h('section', { class: 'amud-section', 'data-label': section.label }, heading, rows);
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
    accountSection(),
    h('h3', {}, 'Backup file'),
    h('p', {}, "You can also save a backup file, and import it in another browser. Importing adds to what's there; it never deletes anything."),
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
        onclick: async () => {
          const signedIn = sync.status().enabled;
          if (!confirm(signedIn
            ? 'Delete all your progress and notes from this browser? You will be logged out here; your account and its backup are kept.'
            : 'Delete all your progress and notes from this browser? This cannot be undone.')) return;
          if (signedIn) await sync.logout({ force: true });
          clearRecord();
          toast('Everything has been cleared from this browser.');
        },
      }, 'Delete everything'),
    ),
  );
}

/** Empty this device's record (keeping its display settings). */
function clearRecord() {
  const settings = state.settings;
  state = P.emptyState();
  state.settings = settings;
  saveState(state);
  render();
}

// ---- Account and backup: create an account, log in, see how the backup is
// going, change password, log out, delete the account.

/** A form that runs an async action, shows its error, and disables itself meanwhile. */
function accountForm(fields, submitLabel, action, { note = null } = {}) {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel);
  const inputs = fields.map(({ name, label, type = 'text', autocomplete, value = '', minLength, hint }) => {
    const input = h('input', { name, type, autocomplete, value, required: true, minLength, autocapitalize: 'none', spellcheck: false });
    return { name, input, el: h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'small' }, hint) : null) };
  });
  const form = h('form', {
    class: 'account-form',
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await action(Object.fromEntries(inputs.map(({ name, input }) => [name, input.value])));
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
      }
    },
  }, inputs.map((i) => i.el), note, error, h('div', { class: 'actions' }, submit));
  return form;
}

function accountSection() {
  if (!sync.available()) return h('p', {}, 'Your progress and notes are saved in this browser only.');
  const status = sync.status();
  const section = h('div', { class: 'sync-section' });

  // Just signed up (or reset a password): show the recovery code until saved.
  if (status.recoveryCode) {
    section.append(h('div', { class: 'recovery-card' },
      h('h3', {}, 'Save your recovery code'),
      h('p', {}, "If you ever forget your password, this code is the only way back into your account. Keep it somewhere safe: your password manager, a note, or a photo."),
      h('p', { class: 'recovery-code' }, status.recoveryCode),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(status.recoveryCode);
              toast('Recovery code copied.');
            } catch {
              toast('Select the code and copy it.');
            }
          },
        }, 'Copy'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { sync.acknowledgeRecoveryCode(); render(); } }, "I've saved it"),
      ),
    ));
  }

  if (status.enabled) {
    const changePassword = accountForm([
      { name: 'password', label: 'Current password', type: 'password', autocomplete: 'current-password' },
      { name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'At least 8 characters.' },
    ], 'Change password', async ({ password, newPassword }) => {
      await sync.changePassword(password, newPassword);
      render();
      toast('Password changed. Your other devices will ask you to log in again.');
    });
    const deleteAccount = accountForm([
      { name: 'password', label: 'Your password', type: 'password', autocomplete: 'current-password' },
    ], 'Delete my account', async ({ password }) => {
      if (!confirm('Delete your account and its backup? Your progress stays on this device, but your other devices will stop syncing. This cannot be undone.')) {
        throw new Error('Not deleted.');
      }
      await sync.deleteAccount(password);
      render();
      toast('Your account and its backup are deleted. Your progress is still on this device.');
    });
    deleteAccount.querySelector('.btn-primary').className = 'btn btn-danger';

    section.append(
      h('h3', {}, 'Account and backup'),
      h('p', {}, 'Logged in as ', h('strong', {}, status.username), '. Your progress, reads and notes back up automatically and stay in step on every device you log in on.'),
      h('p', { class: 'sync-status', 'data-sync-status': '' }, syncStatusText(syncStatus) || ''),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => sync.syncNow() }, 'Back up now'),
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            if (!confirm('Log out on this device? Your progress will be removed from this browser, but it is safe in your account. Log in again any time to get it back.')) return;
            let done = await sync.logout();
            if (!done) {
              if (!confirm("Some changes haven't been backed up yet (are you offline?). Log out anyway and lose them?")) return;
              done = await sync.logout({ force: true });
            }
            clearRecord();
            toast('Logged out.');
          },
        }, 'Log out'),
      ),
      h('details', { class: 'account-settings' },
        h('summary', {}, 'Account settings'),
        h('h4', {}, 'Change password'),
        changePassword,
        h('h4', {}, 'Delete account'),
        h('p', { class: 'small' }, 'Deletes your account and its online backup. Your progress stays on this device.'),
        deleteAccount,
      ),
    );
    return section;
  }

  // Logged out: create an account, log in, or recover with the code.
  const mode = { current: status.signedOut ? 'login' : 'signup' };
  const holder = h('div');
  const tabs = h('div', { class: 'segmented account-tabs', role: 'group', 'aria-label': 'Account' });
  const userField = (value = '') => ({ name: 'username', label: 'Username', autocomplete: 'username', value, hint: null });

  function draw() {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode.current));
    let form;
    if (mode.current === 'signup') {
      form = accountForm([
        { ...userField(), hint: '3 to 32 letters or numbers (dots, dashes and underscores are fine too).' },
        { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'At least 8 characters.' },
      ], 'Create account', async ({ username, password }) => {
        await sync.signup(username, password);
        render();
        toast('Your account is ready. Everything on this device is backed up.');
      });
    } else if (mode.current === 'login') {
      form = accountForm([
        userField(status.username || ''),
        { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
      ], 'Log in', async ({ username, password }) => {
        await sync.login(username, password);
        render();
        toast('Logged in. Your progress is in step with your other devices.');
      }, {
        note: h('p', { class: 'small' }, h('button', { type: 'button', class: 'link-button', onclick: () => { mode.current = 'recover'; draw(); } }, 'Forgot your password?')),
      });
    } else {
      form = accountForm([
        userField(status.username || ''),
        { name: 'recoveryCode', label: 'Recovery code', autocomplete: 'off', hint: 'The code you saved when you made your account.' },
        { name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'At least 8 characters.' },
      ], 'Set new password and log in', async ({ username, recoveryCode, newPassword }) => {
        await sync.recover(username, recoveryCode, newPassword);
        render();
        toast('New password set. You have a new recovery code; save it.');
      });
    }
    holder.replaceChildren(form);
  }

  tabs.append(
    h('button', { type: 'button', 'data-mode': 'signup', onclick: () => { mode.current = 'signup'; draw(); } }, 'Create account'),
    h('button', { type: 'button', 'data-mode': 'login', onclick: () => { mode.current = 'login'; draw(); } }, 'Log in'),
  );
  draw();

  section.append(
    h('h3', {}, 'Account and backup'),
    status.signedOut
      ? h('p', { class: 'sync-status warn' }, "You've been logged out on this device, perhaps because your password was changed. Log in again to keep backing up. Your progress here is safe.")
      : h('p', {}, 'Create a free account to back up your progress, reads and notes automatically, and use them on any phone or computer. Anything already on this device goes into your account.'),
    tabs,
    holder,
  );
  return section;
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
sync.start();
