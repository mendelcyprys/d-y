// Where you are in a daf, worked out from where its passages are on screen.
// Used by the reading bar along the top: its ticks, its fill, and where a
// tap on it should take you. No browser code here, so it can be tested.

/**
 * tops:   each passage's top edge, in pixels from any common origin
 * bottom: the bottom edge of the last passage
 * readAt: the reading line (a little way down the screen), same origin
 * atEnd:  the page is scrolled as far down as it goes
 *
 * Returns
 *   ticks:   where each passage starts along the bar, from 0 to 1
 *   current: the passage you're reading: the last one to start above the line
 *   fill:    how far along the bar the reading line is, from 0 to 1
 *   started: whether the reading line has reached the text yet
 * At the very end of the page the last passage counts as current, since the
 * line can't reach it if there isn't enough page below.
 */
export function readingPosition(tops, bottom, readAt, atEnd = false) {
  const height = Math.max(1, bottom - tops[0]);
  const ticks = tops.map((top) => (top - tops[0]) / height);
  let current = 0;
  for (let i = 1; i < tops.length && tops[i] <= readAt; i++) current = i;
  let fill = Math.min(1, Math.max(0, (readAt - tops[0]) / height));
  if (atEnd) {
    current = tops.length - 1;
    fill = 1;
  }
  return { ticks, current, fill, started: atEnd || tops[0] <= readAt };
}

/** The passage that a point along the bar (0 to 1) falls in. */
export function passageAt(ticks, fraction) {
  let i = 0;
  while (i + 1 < ticks.length && ticks[i + 1] <= fraction) i++;
  return i;
}
