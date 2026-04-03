/** Bridge to share the Ink render instance's clear() with React components. */

let _clear: () => void = () => {};

export function setInkClear(fn: () => void) {
  _clear = fn;
}

/** Reset log-update tracking + clear terminal so Ink repaints from scratch. */
export function inkClear() {
  _clear();
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen + cursor home (preserve scrollback)
}
