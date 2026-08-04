import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  cloneRect,
  isFixed,
  presetOf,
  rectFromBox,
  rectToCss,
  resolveSize,
  resolveStart,
  setAxisBox,
  type RectTransform,
} from '../rect'

const PARENT = { width: 1000, height: 600 }

/** Resolve a rect back to the on-screen box it describes. */
function boxOf(r: RectTransform, parent = PARENT) {
  return {
    left: resolveStart(r.x, parent.width),
    top: resolveStart(r.y, parent.height),
    width: resolveSize(r.x, parent.width),
    height: resolveSize(r.y, parent.height),
  }
}

const BOX = { left: 120, top: 80, width: 240, height: 64 }

describe('rectFromBox', () => {
  it('round-trips a box under every preset', () => {
    for (const row of ['top', 'middle', 'bottom', 'stretch'] as const) {
      for (const col of ['left', 'center', 'right', 'stretch'] as const) {
        const r = rectFromBox(BOX, PARENT, { row, col })
        expect(boxOf(r), `${row}/${col}`).toEqual(BOX)
      }
    }
  })

  it('reports the preset it was built with', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'bottom', col: 'right' })
    expect(presetOf(r)).toEqual({ row: 'bottom', col: 'right' })
  })
})

describe('applyPreset', () => {
  /*
   * The point of the picker: re-anchoring is a change of reference frame, not a
   * move. If this drifts, every click of the grid nudges the widget and the tool
   * is unusable.
   */
  it('never moves the widget on screen', () => {
    let r = rectFromBox(BOX, PARENT, { row: 'top', col: 'left' })
    for (const [row, col] of [
      ['bottom', 'right'],
      ['middle', 'center'],
      ['stretch', 'stretch'],
      ['top', 'stretch'],
      ['stretch', 'center'],
      ['top', 'left'],
    ] as const) {
      r = applyPreset(r, row, col, PARENT)
      expect(boxOf(r), `${row}/${col}`).toEqual(BOX)
    }
  })
})

describe('responsiveness', () => {
  it('keeps a right-anchored widget the same distance from the right edge', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'top', col: 'right' })
    const gapBefore = PARENT.width - (BOX.left + BOX.width)
    const wide = { width: 1400, height: 600 }
    const b = boxOf(r, wide)
    expect(wide.width - (b.left + b.width)).toBeCloseTo(gapBefore, 6)
    expect(b.width).toBe(BOX.width)
  })

  it('grows a stretched widget with its parent, holding both insets', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'top', col: 'stretch' })
    const rightInset = PARENT.width - (BOX.left + BOX.width)
    const wide = { width: 1400, height: 600 }
    const b = boxOf(r, wide)
    expect(b.left).toBeCloseTo(BOX.left, 6)
    expect(wide.width - (b.left + b.width)).toBeCloseTo(rightInset, 6)
    expect(b.width).toBeCloseTo(BOX.width + 400, 6)
  })

  it('keeps a centred widget centred', () => {
    const centred = { left: 380, top: 80, width: 240, height: 64 }
    const r = rectFromBox(centred, PARENT, { row: 'top', col: 'center' })
    for (const w of [800, 1000, 1600]) {
      const b = boxOf(r, { width: w, height: 600 })
      expect(b.left + b.width / 2).toBeCloseTo(w / 2, 6)
    }
  })
})

describe('setAxisBox', () => {
  it('lands on the requested box on a fixed axis, whatever the pivot', () => {
    for (const p of [0, 0.5, 1]) {
      const axis = { a0: 0.5, a1: 0.5, p, s: 0, e: 0, size: 100 }
      const next = setAxisBox(axis, 333, 210, PARENT.width)
      expect(resolveStart(next, PARENT.width)).toBeCloseTo(333, 6)
      expect(resolveSize(next, PARENT.width)).toBeCloseTo(210, 6)
    }
  })

  it('lands on the requested box on a stretched axis', () => {
    const axis = { a0: 0, a1: 1, p: 0.5, s: 10, e: 10, size: 0 }
    const next = setAxisBox(axis, 44, 700, PARENT.width)
    expect(resolveStart(next, PARENT.width)).toBeCloseTo(44, 6)
    expect(resolveSize(next, PARENT.width)).toBeCloseTo(700, 6)
  })

  /*
   * A partial stretch is where the end offset's reference frame actually
   * matters: with a1 = 1 the anchor line and the parent's far edge coincide, so
   * measuring `e` from the wrong one still round-trips and the bug hides.
   */
  it('measures the end offset from the anchor line, not the parent edge', () => {
    const axis = { a0: 0, a1: 0.5, p: 0.5, s: 0, e: 0, size: 0 }
    const next = setAxisBox(axis, 100, 300, PARENT.width)
    expect(resolveStart(next, PARENT.width)).toBeCloseTo(100, 6)
    expect(resolveSize(next, PARENT.width)).toBeCloseTo(300, 6)
    // Anchor line sits at 500px; the widget ends at 400, so 100px inward of it.
    expect(next.e).toBeCloseTo(100, 6)
    // And the CSS inset is from the parent edge: 500 short of it, plus that 100.
    expect(rectToCss({ x: next, y: next }).right).toBe('calc(50% + 100px)')
  })

  it('half-anchored widgets track half the parent growth', () => {
    const r = rectFromBox(BOX, PARENT)
    r.x = setAxisBox({ ...r.x, a0: 0, a1: 0.5 }, BOX.left, BOX.width, PARENT.width)
    const b = boxOf(r, { width: 1400, height: 600 })
    expect(b.left).toBeCloseTo(BOX.left, 6)
    expect(b.width).toBeCloseTo(BOX.width + 200, 6)
  })
})

describe('rectToCss', () => {
  it('emits size + translate for fixed axes', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'middle', col: 'center' })
    const css = rectToCss(r)
    expect(css.width).toBe('240px')
    expect(css.height).toBe('64px')
    expect(css.right).toBe('auto')
    expect(css.transform).toBe('translate(-50%, -50%)')
    expect(css.margin).toBe('0')
    expect(css.position).toBe('absolute')
  })

  it('emits both insets and no translate for stretched axes', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'stretch', col: 'stretch' })
    const css = rectToCss(r)
    expect(css.width).toBe('auto')
    expect(css.height).toBe('auto')
    expect(css.transform).toBeUndefined()
    expect(css.left).toBe('calc(0% + 120px)')
    expect(css.right).toBe('calc(0% + 640px)')
    expect(css.top).toBe('calc(0% + 80px)')
    expect(css.bottom).toBe('calc(0% + 456px)')
  })

  it('anchors a bottom-right widget off the far edges', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'bottom', col: 'right' })
    const css = rectToCss(r)
    // pivot 1,1 with a translate of -100% means left/top land on the far corner.
    expect(css.left).toBe('calc(100% + -640px)')
    expect(css.top).toBe('calc(100% + -456px)')
    expect(css.transform).toBe('translate(-100%, -100%)')
  })
})

describe('hug content (auto sizing)', () => {
  it('emits auto instead of a pixel length', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'bottom', col: 'center' }, { x: true, y: true })
    const css = rectToCss(r)
    expect(css.width).toBe('auto')
    expect(css.height).toBe('auto')
    // Position and pivot still apply — a percentage translate resolves against
    // the element's own box, so centring survives an unknown width.
    expect(css.transform).toBe('translate(-50%, -100%)')
  })

  it('can hug one axis and pin the other', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'top', col: 'left' }, { x: true })
    const css = rectToCss(r)
    expect(css.width).toBe('auto')
    expect(css.height).toBe('64px')
  })

  it('is ignored on a stretched axis, which its anchors already size', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'top', col: 'stretch' }, { x: true })
    const css = rectToCss(r)
    expect(css.left).toBe('calc(0% + 120px)')
    expect(css.right).toBe('calc(0% + 640px)')
    expect(css.width).toBe('auto')
  })

  /*
   * The flag has to survive every operation that rebuilds an axis, or the tool
   * silently bakes a measured width back in — which looks correct the instant you
   * save it and clips the day the content grows.
   */
  it('survives re-anchoring through the preset grid', () => {
    let r = rectFromBox(BOX, PARENT, { row: 'top', col: 'left' }, { x: true, y: true })
    for (const [row, col] of [
      ['bottom', 'right'],
      ['middle', 'center'],
      ['top', 'left'],
    ] as const) {
      r = applyPreset(r, row, col, PARENT)
      expect(rectToCss(r).width, `${row}/${col}`).toBe('auto')
      expect(rectToCss(r).height, `${row}/${col}`).toBe('auto')
    }
  })

  it('survives a move, which states a position and not a size', () => {
    const r = rectFromBox(BOX, PARENT, { row: 'top', col: 'left' }, { x: true, y: true })
    r.x = setAxisBox(r.x, 300, BOX.width, PARENT.width)
    r.y = setAxisBox(r.y, 200, BOX.height, PARENT.height)
    expect(rectToCss(r).width).toBe('auto')
    expect(resolveStart(r.x, PARENT.width)).toBeCloseTo(300, 6)
  })
})

describe('housekeeping', () => {
  it('isFixed tracks the anchors', () => {
    expect(isFixed({ a0: 0.5, a1: 0.5, p: 0, s: 0, e: 0, size: 0 })).toBe(true)
    expect(isFixed({ a0: 0, a1: 1, p: 0, s: 0, e: 0, size: 0 })).toBe(false)
  })

  it('cloneRect does not share axis objects', () => {
    const r = rectFromBox(BOX, PARENT)
    const c = cloneRect(r)
    c.x.s = 999
    expect(r.x.s).toBe(BOX.left)
  })

  it('presetOf returns null for hand-tuned anchors', () => {
    const r = rectFromBox(BOX, PARENT)
    r.x.a0 = 0.3
    r.x.a1 = 0.3
    expect(presetOf(r)).toBeNull()
  })
})
