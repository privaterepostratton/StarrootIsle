import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import {
  swallowWorldClick,
  worldClicksSwallowed,
  swallowBackdropClick,
  backdropClickSwallowed,
} from '../click-guard'

/**
 * Both guards exist to absorb the *tail of one gesture*, so the only thing
 * worth asserting is the shape of the window: open immediately, shut on its own
 * shortly after. A guard that never expires would be a bug of the opposite kind
 * — panels that cannot be dismissed at all.
 */
describe('click guards', () => {
  /*
   * One clock for the whole file, installed once.
   *
   * Re-installing per test rewinds performance.now() to zero while the guards'
   * deadlines — module state, not test state — still hold timestamps from the
   * previous clock, so a window armed in one test reads as open forever after.
   * A single monotonic clock plus a wind-forward is the honest reset.
   */
  beforeAll(() => vi.useFakeTimers())
  afterAll(() => vi.useRealTimers())
  beforeEach(() => vi.advanceTimersByTime(10_000))

  it('is closed until something arms it', () => {
    expect(worldClicksSwallowed()).toBe(false)
    expect(backdropClickSwallowed()).toBe(false)
  })

  it('swallows the click that arrives with the same gesture', () => {
    swallowBackdropClick()
    // A synthesised click follows its pointerup by a few ms at most.
    vi.advanceTimersByTime(8)
    expect(backdropClickSwallowed()).toBe(true)
  })

  it('lets go in time for a deliberate second tap to dismiss', () => {
    swallowBackdropClick()
    vi.advanceTimersByTime(351)
    expect(backdropClickSwallowed()).toBe(false)
  })

  it('keeps the two directions independent', () => {
    swallowWorldClick()
    expect(worldClicksSwallowed()).toBe(true)
    expect(backdropClickSwallowed()).toBe(false)
  })
})
