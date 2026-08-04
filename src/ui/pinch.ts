/**
 * Pinch-gesture recognition, as pure maths.
 *
 * Its own module because `touch.ts` reaches the whole input stack — importing
 * it to test a dot product pulls in a keydown listener registered at module
 * scope, which has no DOM to attach to under vitest. The discriminator here has
 * been wrong twice and is exactly the part that needs tests, so it must be
 * importable on its own.
 */

/**
 * How much *cooperative* radial travel commits a pinch, in CSS px.
 *
 * Not the change in separation, which was the previous test and was wrong in
 * principle: the joystick thumb alone travels up to STICK_RADIUS, so walking
 * while looking moved the fingers far more than any slop worth setting, and the
 * game decided you were zooming. Distance between two fingers cannot tell "one
 * thumb moved" from "two thumbs spread".
 *
 * What distinguishes a pinch is that *both* fingers move along the line joining
 * them, in opposite directions, at the same time. Only the smaller of the two
 * contributions is banked each frame, so one finger racing while the other sits
 * still scores nothing however far it goes — and a frame where they disagree
 * decays the score rather than adding to it. Walking and looking never
 * accumulates; a deliberate spread reaches this in a few frames.
 */
export const PINCH_COMMIT = 26

/** One live finger. `moved` latches — a touch that ever wandered is not a tap. */
export interface Touch {
  x: number
  y: number
  /** Position at the previous sample, for per-frame displacement. */
  lastX: number
  lastY: number
  startX: number
  startY: number
  startTime: number
  moved: boolean
}

/**
 * One frame of cooperative-radial scoring. Pure, and exported for testing.
 *
 * `u` is the unit vector from the first finger to the second. A finger adds to
 * the separation when it moves *against* u (the first) or *along* it (the
 * second), so those projections are each finger's contribution to a spread, and
 * their negatives to a close. Same sign means the fingers are working together;
 * only the smaller magnitude is banked, so the score measures what they did
 * *jointly* rather than what the busier one did alone. Disagreement decays it.
 *
 * That "smaller magnitude" is the whole discriminator, and the reason the
 * previous separation-based test could not work: a joystick thumb travelling
 * 56px past a stationary partner changes the separation enormously and
 * contributes nothing here, because the partner contributed nothing.
 */
/** How fast the score bleeds away on a frame where the fingers disagree. */
const PINCH_DECAY = 0.6

export function pinchStep(score: number, a: Touch, b: Touch): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const sep = Math.hypot(dx, dy)
  // Fingers on top of each other have no meaningful axis to project onto.
  if (sep < 24) return score
  const ux = dx / sep
  const uy = dy / sep

  const ca = -((a.x - a.lastX) * ux + (a.y - a.lastY) * uy)
  const cb = (b.x - b.lastX) * ux + (b.y - b.lastY) * uy

  if (ca > 0 === cb > 0) return score + Math.sign(ca) * Math.min(Math.abs(ca), Math.abs(cb))
  return score * PINCH_DECAY
}
