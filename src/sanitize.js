// Sefaria's texts include a little HTML: bold for the literal translation,
// italics, footnotes and links to sources. We rebuild that HTML from an
// allowlist rather than inserting it as-is, so nothing in a text can run
// script or load anything on this page.

import { sefariaUrl } from './sefaria.js';

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BIG', 'SMALL', 'SUP', 'SUB', 'BR', 'SPAN']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'TEMPLATE', 'LINK', 'META']);

export function textToFragment(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html ?? ''}`, 'text/html');
  const fragment = document.createDocumentFragment();
  copyChildren(doc.body, fragment);
  return fragment;
}

function copyChildren(from, to) {
  for (const node of from.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.append(node.data);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      copyElement(node, to);
    }
  }
}

function copyElement(node, to) {
  const tag = node.tagName;
  if (DROP.has(tag)) return;

  // Page markers such as <i data-overlay="Vilna Pages" data-value="2a"></i>.
  if (node.dataset.overlay) return;

  if (tag === 'SUP' && node.classList.contains('footnote-marker')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fn-marker';
    button.textContent = node.textContent;
    button.setAttribute('aria-expanded', 'false');
    button.title = 'Show note';
    to.append(button);
    return;
  }

  if (tag === 'I' && node.classList.contains('footnote')) {
    const note = document.createElement('span');
    note.className = 'footnote';
    note.hidden = true;
    copyChildren(node, note);
    to.append(note);
    return;
  }

  if (tag === 'A') {
    const ref = node.dataset.ref;
    if (ref) {
      const a = document.createElement('a');
      a.href = sefariaUrl(ref);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      copyChildren(node, a);
      to.append(a);
    } else {
      copyChildren(node, to);
    }
    return;
  }

  if (KEEP.has(tag)) {
    const el = document.createElement(tag.toLowerCase());
    copyChildren(node, el);
    to.append(el);
    return;
  }

  // Anything else: keep its text, lose the tag.
  copyChildren(node, to);
}
