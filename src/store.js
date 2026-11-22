// Saving your record in this browser's local storage.
//
// Everything stays on your device. Use Export on the Progress page to keep a
// backup or move to another browser.

import { emptyState, normalizeState } from './progress.js';

const KEY = 'daf-yomi:v1';
let available = true;

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeState(JSON.parse(raw)) : emptyState();
  } catch {
    available = false;
    return emptyState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function storageAvailable() {
  return available;
}
