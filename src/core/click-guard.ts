/**
 * Suppress world clicks for a moment after a UI button is used.
 *
 * A panel button that closes its own panel leaves the rest of that physical
 * gesture landing on the canvas underneath — harvesting reopened the very plot
 * the player had just finished with. `modalOpen()` cannot catch it, because by
 * the time the stray event arrives the modal is legitimately closed. A short
 * deadline is the honest model: what is being suppressed is one click, not a
 * state.
 *
 * Its own module rather than a main.ts export so UI files can reach it without
 * importing the entry module (which would close an import cycle through
 * top-level await).
 */

let until = 0

/** Call from any UI handler whose gesture must not reach the world. */
export function swallowWorldClick(ms = 250) {
  until = performance.now() + ms
}

export function worldClicksSwallowed() {
  return performance.now() < until
}

/*
 * ...and the mirror of it, for the other direction.
 *
 * A touch produces `pointerdown`, `pointerup`, and *then* a synthesised
 * `click`. Tapping a plot opens its menu on the pointerup — so the click that
 * follows, part of the very same physical tap, lands on the backdrop the menu
 * just put under the finger and dismisses it again. The panel appeared and
 * vanished, which reads as the tap having done nothing at all.
 *
 * The same short-deadline model as above, for the same reason: what is being
 * suppressed is the tail of one gesture, not a state.
 */
let backdropUntil = 0

/** Call when a world gesture opens a panel, before the panel is shown. */
export function swallowBackdropClick(ms = 350) {
  backdropUntil = performance.now() + ms
}

export function backdropClickSwallowed() {
  return performance.now() < backdropUntil
}
