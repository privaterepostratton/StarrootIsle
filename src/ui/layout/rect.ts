/**
 * A RectTransform for the DOM.
 *
 * UGUI's insight is that a widget's position is not a number, it is a
 * *relationship*: an anchor rectangle in the parent, a pivot in the widget, and
 * offsets between the two. That is what makes one layout survive every aspect
 * ratio, and it is the thing hand-written CSS keeps re-deriving by hand with
 * `calc(100% - …)` and a translate. This module is that relationship, expressed
 * once, with a compiler down to CSS.
 *
 * Two deliberate departures from Unity:
 *
 * 1. **Y grows downward.** Unity puts the origin bottom-left. Every browser API
 *    this has to interoperate with — `getBoundingClientRect`, `top`, pointer
 *    events — puts it top-left. Flipping would buy familiarity for one person
 *    reading the inspector and cost a sign error in every function that touches
 *    a real element, so the maths matches the platform and only the *labels*
 *    imitate Unity.
 * 2. **Per-axis records instead of offsetMin/offsetMax.** CSS already has
 *    exactly two positioning modes per axis (start+end, or start+size), which is
 *    the same duality Unity's inspector shows when it swaps "Pos X / Width" for
 *    "Left / Right". Storing it that way means the compiler is one generic
 *    function applied twice, rather than four coupled numbers that have to be
 *    decoded before they mean anything.
 */

/** One axis of a rect. `x` uses left/right, `y` uses top/bottom. */
export interface RectAxis {
  /** Anchor start, 0..1 of the parent's content box. */
  a0: number
  /** Anchor end, 0..1. Equal to `a0` means the axis is fixed-size. */
  a1: number
  /** Pivot within the widget, 0..1. Only meaningful on a fixed axis. */
  p: number
  /** Offset inward from the `a0` edge, px. On a fixed axis this is Unity's anchoredPosition. */
  s: number
  /**
   * Offset inward from the `a1` *anchor line*, px. Ignored on a fixed axis.
   *
   * Measured from the anchor, not from the parent's far edge — those coincide
   * only when `a1` is 1, and conflating them is a silent off-by-a-percentage
   * that only shows up on partially-stretched widgets.
   */
  e: number
  /** Size in px. Ignored on a stretched axis, where the anchors dictate it. */
  size: number
  /**
   * Let the content size this axis instead of writing a pixel length — Unity's
   * content-size-fitter, and the one concept a DOM port genuinely needs to add.
   *
   * Half this UI is flex containers whose width is whatever their children come
   * to: a hotbar, a pill rail, a row of buttons. Baking the measured width of one
   * of those into a rule is silent damage — it looks identical the moment you
   * save it and clips the day a ninth slot appears. Defaulting to hugging
   * whenever the stylesheet did not author a size keeps the tool from taking that
   * decision on the author's behalf.
   *
   * Only meaningful on a fixed axis; a stretched one is already sized by its
   * anchors. `size` stays populated either way, because the editor measures the
   * real box every frame and the gizmo needs somewhere to put it.
   */
  auto?: boolean
}

export interface RectTransform {
  x: RectAxis
  y: RectAxis
}

/** A plain measured box. Lives here so the editor and inspector share one type. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** True when the anchors coincide, so the axis is sized rather than stretched. */
export function isFixed(axis: RectAxis): boolean {
  return Math.abs(axis.a1 - axis.a0) < 1e-6
}

export function cloneRect(r: RectTransform): RectTransform {
  return { x: { ...r.x }, y: { ...r.y } }
}

/**
 * Anchor presets, laid out as Unity's 4x4 picker: rows are the vertical
 * behaviour (top / middle / bottom / stretch) and columns the horizontal
 * (left / centre / right / stretch).
 */
export const ANCHOR_ROWS = ['top', 'middle', 'bottom', 'stretch'] as const
export const ANCHOR_COLS = ['left', 'center', 'right', 'stretch'] as const
export type AnchorRow = (typeof ANCHOR_ROWS)[number]
export type AnchorCol = (typeof ANCHOR_COLS)[number]

/** `[a0, a1, pivot]` for each named position along one axis. */
const SPAN: Record<string, readonly [number, number, number]> = {
  left: [0, 0, 0],
  center: [0.5, 0.5, 0.5],
  right: [1, 1, 1],
  top: [0, 0, 0],
  middle: [0.5, 0.5, 0.5],
  bottom: [1, 1, 1],
  stretch: [0, 1, 0.5],
}

/**
 * Re-anchor without moving the widget on screen.
 *
 * This is the operation that makes the preset grid non-destructive, and it is
 * the whole reason anchors are worth having a UI for: choosing "bottom-right"
 * should mean "keep this exactly where it is, but from now on measure it from
 * that corner". Recomputing the offsets against the parent's current size is
 * what delivers that — without it, every click of the picker teleports the
 * widget and you tune the numbers back by hand.
 */
export function reanchorAxis(
  axis: RectAxis,
  a0: number,
  a1: number,
  pivot: number,
  parentSize: number,
): RectAxis {
  // Resolve where the widget currently is, in parent px, before changing anything.
  const start = resolveStart(axis, parentSize)
  const size = resolveSize(axis, parentSize)
  const next: RectAxis = { a0, a1, p: pivot, s: 0, e: 0, size, auto: axis.auto }
  if (isFixed(next)) {
    next.s = start + pivot * size - a0 * parentSize
  } else {
    next.s = start - a0 * parentSize
    next.e = a1 * parentSize - (start + size)
  }
  return next
}

/** Widget start edge in parent px. */
export function resolveStart(axis: RectAxis, parentSize: number): number {
  if (isFixed(axis)) return axis.a0 * parentSize + axis.s - axis.p * axis.size
  return axis.a0 * parentSize + axis.s
}

/** Widget length in px. */
export function resolveSize(axis: RectAxis, parentSize: number): number {
  if (isFixed(axis)) return axis.size
  const span = (axis.a1 - axis.a0) * parentSize
  return Math.max(0, span - axis.s - axis.e)
}

/**
 * Move and resize an axis to land on an explicit parent-space box, keeping the
 * anchors and pivot as they are.
 *
 * Dragging is expressed this way rather than by nudging `s`/`e` directly,
 * because what a drag *means* differs per mode — on a stretched axis a move has
 * to push both offsets, on a fixed axis a resize has to compensate for the
 * pivot. Funnelling both gestures through one "put it here" call keeps that
 * knowledge in this file instead of spread across the editor's pointer handlers.
 */
export function setAxisBox(
  axis: RectAxis,
  start: number,
  size: number,
  parentSize: number,
): RectAxis {
  const next: RectAxis = { ...axis }
  if (isFixed(axis)) {
    next.size = Math.max(0, size)
    next.s = start + axis.p * next.size - axis.a0 * parentSize
  } else {
    next.s = start - axis.a0 * parentSize
    next.e = axis.a1 * parentSize - (start + size)
    next.size = Math.max(0, size)
  }
  return next
}

export interface CssDecls {
  [prop: string]: string
}

/**
 * One axis to CSS declarations.
 *
 * Percentages are of the positioned parent, which is precisely what an anchor
 * fraction is, so `calc(<a0>% + <s>px)` is a direct transcription rather than an
 * approximation — no layout pass needed to bake it, and it keeps responding to
 * resizes the way the model says it should.
 */
function axisCss(axis: RectAxis, startProp: string, endProp: string, sizeProp: string): CssDecls {
  const pct = (v: number) => `${round(v * 100)}%`
  const px = (v: number) => `${round(v)}px`
  const out: CssDecls = {}
  if (isFixed(axis)) {
    out[startProp] = `calc(${pct(axis.a0)} + ${px(axis.s)})`
    out[endProp] = 'auto'
    // A percentage translate resolves against the element's own box, so the
    // pivot still lands correctly on an axis whose length the content decides.
    out[sizeProp] = axis.auto ? 'auto' : px(axis.size)
  } else {
    out[startProp] = `calc(${pct(axis.a0)} + ${px(axis.s)})`
    out[endProp] = `calc(${pct(1 - axis.a1)} + ${px(axis.e)})`
    out[sizeProp] = 'auto'
  }
  return out
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * The full declaration set for a rect.
 *
 * `margin: 0` is not tidiness — a stray margin in the hand-written stylesheet
 * silently shifts a widget off the position the editor just showed, and a
 * WYSIWYG tool that lies about the result is worse than no tool. The translate
 * carries the pivot, and only for axes that have one.
 */
export function rectToCss(r: RectTransform): CssDecls {
  const out: CssDecls = { position: 'absolute', margin: '0' }
  Object.assign(out, axisCss(r.x, 'left', 'right', 'width'))
  Object.assign(out, axisCss(r.y, 'top', 'bottom', 'height'))
  const tx = isFixed(r.x) ? -r.x.p * 100 : 0
  const ty = isFixed(r.y) ? -r.y.p * 100 : 0
  if (tx || ty) out.transform = `translate(${round(tx)}%, ${round(ty)}%)`
  return out
}

export function cssText(decls: CssDecls, indent = '  '): string {
  return Object.entries(decls)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n')
}

/**
 * A rect that reproduces a measured on-screen box under the given anchors.
 *
 * `auto` marks axes whose length should keep coming from the content rather than
 * from the measurement — see `RectAxis.auto`. The measured size is still recorded
 * on the axis so the gizmo has a box to draw.
 */
export function rectFromBox(
  box: Box,
  parent: { width: number; height: number },
  anchors: { row: AnchorRow; col: AnchorCol } = { row: 'top', col: 'left' },
  auto: { x?: boolean; y?: boolean } = {},
): RectTransform {
  const [cx0, cx1, cpx] = SPAN[anchors.col]
  const [ry0, ry1, rpy] = SPAN[anchors.row]
  const x = reanchorAxis(
    { a0: 0, a1: 0, p: 0, s: box.left, e: 0, size: box.width, auto: auto.x },
    cx0,
    cx1,
    cpx,
    parent.width,
  )
  const y = reanchorAxis(
    { a0: 0, a1: 0, p: 0, s: box.top, e: 0, size: box.height, auto: auto.y },
    ry0,
    ry1,
    rpy,
    parent.height,
  )
  return { x, y }
}

/** Apply a named preset to a rect, preserving its on-screen box. */
export function applyPreset(
  r: RectTransform,
  row: AnchorRow,
  col: AnchorCol,
  parent: { width: number; height: number },
): RectTransform {
  const [cx0, cx1, cpx] = SPAN[col]
  const [ry0, ry1, rpy] = SPAN[row]
  return {
    x: reanchorAxis(r.x, cx0, cx1, cpx, parent.width),
    y: reanchorAxis(r.y, ry0, ry1, rpy, parent.height),
  }
}

/** Which preset cell a rect currently sits on, or null when it is custom. */
export function presetOf(r: RectTransform): { row: AnchorRow; col: AnchorCol } | null {
  const match = (axis: RectAxis, names: readonly string[]) =>
    names.find((n) => {
      const [a0, a1, p] = SPAN[n]
      return (
        Math.abs(axis.a0 - a0) < 1e-6 &&
        Math.abs(axis.a1 - a1) < 1e-6 &&
        Math.abs(axis.p - p) < 1e-6
      )
    })
  const col = match(r.x, ANCHOR_COLS) as AnchorCol | undefined
  const row = match(r.y, ANCHOR_ROWS) as AnchorRow | undefined
  return col && row ? { row, col } : null
}
