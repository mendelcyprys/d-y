import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingPosition, passageAt } from '../src/reading.js';

// Four passages: 0-100, 100-300, 300-350, 350-500.
const tops = [0, 100, 300, 350];
const bottom = 500;

test('ticks mark where each passage starts along the bar', () => {
  assert.deepEqual(readingPosition(tops, bottom, -50).ticks, [0, 0.2, 0.6, 0.7]);
});

test('before the text reaches the reading line', () => {
  const r = readingPosition(tops, bottom, -50);
  assert.equal(r.started, false);
  assert.equal(r.current, 0);
  assert.equal(r.fill, 0);
});

test('the current passage is the last to start above the reading line', () => {
  assert.equal(readingPosition(tops, bottom, 0).current, 0);
  assert.equal(readingPosition(tops, bottom, 99).current, 0);
  assert.equal(readingPosition(tops, bottom, 100).current, 1);
  assert.equal(readingPosition(tops, bottom, 320).current, 2);
  assert.equal(readingPosition(tops, bottom, 499).current, 3);
  assert.equal(readingPosition(tops, bottom, 250).fill, 0.5);
});

test('at the end of the page you are on the last passage', () => {
  const r = readingPosition(tops, bottom, 320, true);
  assert.deepEqual([r.current, r.fill, r.started], [3, 1, true]);
});

test('a point on the bar falls in the passage that starts at or before it', () => {
  const { ticks } = readingPosition(tops, bottom, 0);
  assert.equal(passageAt(ticks, 0), 0);
  assert.equal(passageAt(ticks, 0.19), 0);
  assert.equal(passageAt(ticks, 0.2), 1);
  assert.equal(passageAt(ticks, 0.65), 2);
  assert.equal(passageAt(ticks, 1), 3);
  assert.equal(passageAt([0], 0.8), 0);
});

test('jumping to a passage then reading it back gives the same passage', () => {
  // A jump puts the passage's top just above the reading line.
  for (let i = 0; i < tops.length; i++) {
    const readAt = tops[i] + 1;
    assert.equal(readingPosition(tops, bottom, readAt).current, i);
  }
});
