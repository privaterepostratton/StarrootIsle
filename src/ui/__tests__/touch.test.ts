import { describe, it, expect } from 'vitest'
import { pinchStep, PINCH_COMMIT, type Touch } from '../pinch'

/**
 * The pinch discriminator.
 *
 * Worth a test because it has been wrong twice and neither failure was visible
 * without a phone in hand. The first version committed to a pinch the moment a
 * second finger touched down, which stole the joystick and ate every tap. The
 * second measured the *change in separation*, which cannot distinguish one
 * thumb travelling from two thumbs spreading — so walking while looking read as
 * a zoom, because a joystick thumb alone moves up to 56 CSS pixels.
 *
 * The cases below are those two failures written down.
 */

const COMMIT = PINCH_COMMIT

/** A finger at rest at (x, y). */
const at = (x: number, y: number): Touch => ({
  x,
  y,
  lastX: x,
  lastY: y,
  startX: x,
  startY: y,
  startTime: 0,
  moved: false,
})

/** Move a finger and leave `last` where it was, as one frame's displacement. */
function step(pt: Touch, dx: number, dy: number) {
  pt.lastX = pt.x
  pt.lastY = pt.y
  pt.x += dx
  pt.y += dy
}

describe('pinch detection', () => {
  it('ignores one thumb travelling while the other holds still', () => {
    // The joystick thumb sweeps its full radius; the look thumb is parked.
    const stick = at(100, 300)
    const look = at(500, 300)
    let score = 0
    for (let i = 0; i < 12; i++) {
      step(stick, -6, 0)
      score = pinchStep(score, stick, look)
    }
    expect(stick.x).toBeLessThan(40) // it really did travel a long way
    expect(Math.abs(score)).toBeLessThan(COMMIT)
  })

  it('ignores walking and looking at once', () => {
    /*
     * Both thumbs busy, but not cooperating: the left drags the stick outward
     * while the right swings the camera around. Some frames happen to agree by
     * chance, which is exactly why disagreement has to *decay* the score rather
     * than merely fail to add to it.
     */
    const stick = at(120, 320)
    const look = at(520, 300)
    let score = 0
    const lookPath = [
      [7, 2], [6, -3], [-5, 4], [-8, 1], [4, 5],
      [9, -2], [-6, -4], [3, 6], [-7, 2], [8, 3],
    ]
    lookPath.forEach(([lx, ly], i) => {
      step(stick, i % 3 === 0 ? -5 : 3, i % 2 === 0 ? 4 : -2)
      step(look, lx, ly)
      score = pinchStep(score, stick, look)
    })
    expect(Math.abs(score)).toBeLessThan(COMMIT)
  })

  it('commits when both fingers genuinely spread', () => {
    const a = at(300, 300)
    const b = at(420, 300)
    let score = 0
    for (let i = 0; i < 6; i++) {
      step(a, -5, 0)
      step(b, 5, 0)
      score = pinchStep(score, a, b)
    }
    expect(score).toBeGreaterThanOrEqual(COMMIT)
  })

  it('commits when both fingers genuinely close, with the opposite sign', () => {
    const a = at(300, 300)
    const b = at(600, 300)
    let score = 0
    for (let i = 0; i < 6; i++) {
      step(a, 5, 0)
      step(b, -5, 0)
      score = pinchStep(score, a, b)
    }
    expect(score).toBeLessThanOrEqual(-COMMIT)
  })

  it('banks nothing while the fingers are too close to have an axis', () => {
    const a = at(300, 300)
    const b = at(310, 300)
    step(a, -4, 0)
    step(b, 4, 0)
    expect(pinchStep(0, a, b)).toBe(0)
  })
})
