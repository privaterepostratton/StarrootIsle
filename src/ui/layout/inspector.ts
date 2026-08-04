/**
 * The inspector: the numbers behind the gizmo, plus the two things a gizmo
 * cannot express — which elements a rule applies to, and how a sprite is sliced.
 *
 * It reaches the editor only through `EditorApi`. That boundary is load-bearing:
 * the panel rebuilds itself from scratch on every render (simpler than
 * diffing, and it is a dev tool), so anything it held a reference to would go
 * stale. Asking for state through functions means it always reads the live one.
 */

import {
  ANCHOR_COLS,
  ANCHOR_ROWS,
  applyPreset,
  cloneRect,
  isFixed,
  presetOf,
  reanchorAxis,
  resolveSize,
  resolveStart,
  setAxisBox,
  type AnchorCol,
  type AnchorRow,
  type Box,
  type RectTransform,
} from './rect'
import { deriveSelector, describeElement, scoped, selectorMatchesUniquely } from './keys'
import { currentDoc } from './store'
import type { LayoutEntry, SliceData } from './doc'

export interface EditorApi {
  target(): HTMLElement | null
  rect(): RectTransform | null
  parent(): Box
  /** `commit: false` previews inline without touching the document. */
  setRect(rect: RectTransform, commit?: boolean): void
  entry(): LayoutEntry | null
  /**
   * Commit an entry. `quiet` applies the CSS without rebuilding this panel, which
   * continuous controls need — a rebuild mid-gesture destroys the slider or guide
   * the pointer is holding.
   */
  setEntry(entry: LayoutEntry, opts?: { quiet?: boolean }): void
  select(node: HTMLElement | null): void
  clear(): void
  save(): Promise<void>
  snapshot(): void
  status(message: string): void
}

/** The sprites the UI is built from. A path can also be typed by hand. */
const ASSETS = [
  'btn-green.png',
  'btn-green-pill.png',
  'btn-plot.png',
  'btn-plot-paid.png',
  'btn-gold.png',
  'btn-menu.png',
  'btn-square.png',
  'btn-close.png',
  'panel-header.png',
  'toast-panel.png',
  'chip-bg.png',
  'slot-frame.png',
  'parchment.png',
  'avatar-frame.png',
  'level-badge.png',
  'hud-level-badge.png',
  'xp-bar.png',
]

export class Inspector {
  readonly root: HTMLDivElement
  /** Kept across renders so reopening a widget does not reset the slice view. */
  private sliceZoom = 2
  /** Hierarchy filter text, kept across the panel's full re-renders. */
  private treeQuery = ''
  private sliceSrcDims: Record<string, { w: number; h: number }> = {}

  constructor(private readonly api: EditorApi) {
    this.root = document.createElement('div')
    this.root.className = 'sv-e-panel'
    this.render()
  }

  render(): void {
    const node = this.api.target()
    this.root.textContent = ''
    if (!node) {
      this.root.append(
        h3('Nothing selected'),
        p(
          'sv-e-empty',
          'Hover the HUD and click to select a widget. Click again in the same spot to drill into its children. [ and ] walk up and down the tree.',
        ),
        h3('Hierarchy'),
        this.hierarchy(),
      )
      return
    }
    this.root.append(this.header(node))
    const flow = this.flowWarning(node)
    if (flow) this.root.append(flow)
    this.root.append(h3('Rect Transform'), this.presetGrid(), ...this.rectRows())
    this.root.append(h3('Applies to'), ...this.selectorRows(node))
    this.root.append(h3('Sprite (9-slice)'), ...this.sliceRows(node))
    this.root.append(h3('Hierarchy'), this.hierarchy())
    const btns = div('sv-e-btns')
    btns.append(
      btn('Clear override', () => this.api.clear(), 'sv-e-danger'),
      btn('Save', () => void this.api.save(), 'sv-e-save'),
    )
    this.root.append(btns)
  }

  // ---- header -------------------------------------------------------------

  private header(node: HTMLElement) {
    const wrap = div('')
    const title = div('sv-e-title')
    title.textContent = describeElement(node)
    const r = node.getBoundingClientRect()
    const sub = p('sv-e-hint', `${Math.round(r.width)} × ${Math.round(r.height)} px · <${node.tagName.toLowerCase()}>`)
    wrap.append(title, sub)
    return wrap
  }

  /**
   * Warn when the parent lays its children out itself.
   *
   * An anchored rect means `position: absolute`, which removes the element from
   * flow — harmless for the HUD clusters (already absolute) and destructive for a
   * chip inside a flex row, where it would also collapse the row's remaining
   * items. The tool cannot tell which one you meant, so it says so plainly rather
   * than either refusing or quietly wrecking the layout.
   */
  private flowWarning(node: HTMLElement): HTMLElement | null {
    const parent = node.parentElement
    if (!parent) return null
    const display = getComputedStyle(parent).display
    if (!/flex|grid/.test(display)) return null
    const own = getComputedStyle(node).position
    if (own === 'absolute' || own === 'fixed') return null
    return p(
      'sv-e-flow',
      `Parent is a ${display} container. Anchoring this widget makes it absolute, which takes it out of the row — the siblings will reflow. Lay out the container instead, or accept it and reposition the row.`,
    )
  }

  // ---- rect ---------------------------------------------------------------

  private presetGrid() {
    const grid = div('sv-e-presets')
    const rect = this.api.rect()
    const active = rect ? presetOf(rect) : null
    for (const row of ANCHOR_ROWS) {
      for (const col of ANCHOR_COLS) {
        const b = document.createElement('button')
        b.title = `${row} / ${col}`
        b.append(...presetGlyph(row, col))
        if (active && active.row === row && active.col === col) b.classList.add('sv-e-on')
        b.addEventListener('click', () => {
          const r = this.api.rect()
          if (!r) return
          this.api.snapshot()
          this.api.setRect(applyPreset(r, row, col, this.api.parent()))
        })
        grid.appendChild(b)
      }
    }
    return grid
  }

  /**
   * Numeric fields for the rect, with the labels Unity swaps.
   *
   * A fixed axis is described by a position and a size; a stretched one by two
   * insets. Showing all four at once would mean two of them are always inert, and
   * an inert field that still accepts typing is a trap.
   */
  private rectRows(): HTMLElement[] {
    const rect = this.api.rect()
    if (!rect) return []
    const parent = this.api.parent()
    const rows: HTMLElement[] = []

    const axisRow = (which: 'x' | 'y') => {
      const axis = rect[which]
      const size = which === 'x' ? parent.width : parent.height
      const fixed = isFixed(axis)
      const start = resolveStart(axis, size)
      const len = resolveSize(axis, size)
      const labels = fixed
        ? which === 'x'
          ? ['Pos X', 'Width']
          : ['Pos Y', 'Height']
        : which === 'x'
          ? ['Left', 'Right']
          : ['Top', 'Bottom']
      const write = (a: number, b: number, auto?: boolean) => {
        const next = cloneRect(rect)
        if (fixed) {
          next[which] = setAxisBox(axis, a, b, size)
          if (auto !== undefined) next[which].auto = auto
        } else {
          // In stretch mode the two fields *are* the offsets, so they go
          // straight in — deriving them through a box would round-trip through
          // a subtraction and lose the exactness of a typed number.
          next[which] = { ...axis, s: a, e: b }
        }
        this.api.snapshot()
        this.api.setRect(next)
      }
      const first = num(fixed ? start : axis.s, (v) => write(v, fixed ? len : axis.e))
      // Typing a length is stating one, so it also stops the axis hugging.
      const second = num(fixed ? len : axis.e, (v) => write(fixed ? start : axis.s, v, false))
      if (fixed && axis.auto) {
        second.disabled = true
        second.title = 'sized by content — untick hug to set it'
      }
      return field(`${labels[0]} / ${labels[1]}`, first, second)
    }

    /**
     * The hug toggles, which are the DOM's answer to a content-size-fitter.
     *
     * Only offered per fixed axis, because a stretched one is already sized by
     * its anchors and a checkbox there would be inert.
     */
    const hugRow = () => {
      const boxes: HTMLElement[] = []
      for (const which of ['x', 'y'] as const) {
        const axis = rect[which]
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = !!axis.auto
        cb.disabled = !isFixed(axis)
        cb.title = isFixed(axis)
          ? `let the content set the ${which === 'x' ? 'width' : 'height'}`
          : 'stretched axes are sized by their anchors'
        cb.addEventListener('change', () => {
          const next = cloneRect(rect)
          next[which] = { ...axis, auto: cb.checked }
          this.api.snapshot()
          this.api.setRect(next)
        })
        const wrap = div('')
        wrap.style.display = 'flex'
        wrap.style.alignItems = 'center'
        wrap.style.gap = '4px'
        const tag = document.createElement('span')
        tag.textContent = which === 'x' ? 'W' : 'H'
        tag.style.opacity = '0.55'
        wrap.append(cb, tag)
        boxes.push(wrap)
      }
      return field('hug', ...boxes)
    }

    const anchorRow = (which: 'x' | 'y') => {
      const axis = rect[which]
      const size = which === 'x' ? parent.width : parent.height
      const set = (a0: number, a1: number) => {
        const next = cloneRect(rect)
        next[which] = reanchorAxis(axis, clamp01(a0), clamp01(Math.max(a0, a1)), axis.p, size)
        this.api.snapshot()
        this.api.setRect(next)
      }
      return field(
        `anchor ${which.toUpperCase()}`,
        num(axis.a0, (v) => set(v, axis.a1), 0.01),
        num(axis.a1, (v) => set(axis.a0, v), 0.01),
      )
    }

    const pivotRow = () => {
      const set = (px: number, py: number) => {
        const next = cloneRect(rect)
        next.x = reanchorAxis(rect.x, rect.x.a0, rect.x.a1, clamp01(px), parent.width)
        next.y = reanchorAxis(rect.y, rect.y.a0, rect.y.a1, clamp01(py), parent.height)
        this.api.snapshot()
        this.api.setRect(next)
      }
      return field(
        'pivot',
        num(rect.x.p, (v) => set(v, rect.y.p), 0.05),
        num(rect.y.p, (v) => set(rect.x.p, v), 0.05),
      )
    }

    rows.push(anchorRow('x'), anchorRow('y'), pivotRow(), axisRow('x'), axisRow('y'), hugRow())
    rows.push(
      p(
        'sv-e-hint',
        `Anchors are fractions of the parent (${Math.round(parent.width)} × ${Math.round(parent.height)} px). Equal min and max means fixed size; different means stretch. "Hug" leaves the length to the content, so a row that gains an item still fits.`,
      ),
    )
    return rows
  }

  // ---- selector -----------------------------------------------------------

  /**
   * The selector field, which is the whole per-placement story.
   *
   * The derived path targets exactly one widget, so tuning it tunes that
   * placement. Widen it to `.chip` and the same numbers cover every chip. One
   * text field spans both, which is why there is no separate notion of "asset
   * config" versus "placement config" anywhere in this system.
   */
  private selectorRows(node: HTMLElement): HTMLElement[] {
    const entry = this.api.entry()
    const derived = deriveSelector(node)
    const input = document.createElement('input')
    input.type = 'text'
    input.value = entry?.selector ?? derived
    const count = p('sv-e-hint', '')
    const update = () => {
      const value = input.value.trim()
      let matches = 0
      try {
        matches = document.querySelectorAll(scoped(value)).length
      } catch {
        count.textContent = 'invalid selector'
        return
      }
      count.textContent = `matches ${matches} element${matches === 1 ? '' : 's'} · saved as ${scoped(value)}`
    }
    input.addEventListener('input', update)
    input.addEventListener('change', () => {
      const value = input.value.trim()
      if (!value || !entry) return
      this.api.snapshot()
      this.api.setEntry({ ...entry, selector: value })
      this.api.status(`selector → ${value}`)
    })
    update()

    const row = div('sv-e-btns')
    row.append(
      btn('Just this one', () => {
        input.value = derived
        input.dispatchEvent(new Event('change'))
      }),
      btn('All like it', () => {
        const cls = Array.from(node.classList).find((c) => !c.startsWith('sv-e'))
        if (!cls) {
          this.api.status('no class to widen to')
          return
        }
        input.value = `.${cls}`
        input.dispatchEvent(new Event('change'))
      }),
    )
    const warn: HTMLElement[] = []
    if (!selectorMatchesUniquely(derived, node)) {
      warn.push(
        p(
          'sv-e-flow',
          'The derived path does not resolve back to this element uniquely — give it an id, or target it by class instead.',
        ),
      )
    }
    return [input, count, row, ...warn]
  }

  // ---- slice --------------------------------------------------------------

  /**
   * Per-element 9-slice, with the guides dragged on the source image.
   *
   * The old tool keyed slices by *asset*, so tuning the Buy button's frame also
   * changed every other widget drawn from the same PNG — and the two are almost
   * never the same height, which is exactly when a slice needs different border
   * widths. Keying by selector instead means the source image is shared and the
   * slicing is not.
   */
  private sliceRows(node: HTMLElement): HTMLElement[] {
    const entry = this.api.entry()
    if (!entry) return []
    const inherited = inheritedSliceSrc(node)
    /*
     * Show the slice the widget is *actually* drawn with, saved or not.
     *
     * The picker used to open on "— none —" whenever there was no override, which
     * made a widget that plainly has a painted frame look like it had no sprite,
     * and left the guides unavailable until you hunted for the right file by name.
     * Falling back to the computed border-image means the section always reflects
     * reality, and the first edit is what creates the entry.
     */
    const existing =
      entry.slice ?? (inherited ? inheritedSlice(node, inherited, 24) : undefined)
    const rows: HTMLElement[] = []

    const picker = document.createElement('select')
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '— none —'
    picker.appendChild(none)
    for (const a of ASSETS) {
      const o = document.createElement('option')
      // Bare filename: the compiled sheet sits in public/ui/, so this is what
      // resolves beside it. See sliceUrl in doc.ts.
      o.value = a
      o.textContent = a
      picker.appendChild(o)
    }
    if (inherited && !ASSETS.some((a) => inherited.endsWith(a))) {
      const o = document.createElement('option')
      o.value = inherited
      o.textContent = `${inherited.split('/').pop()} (in use)`
      picker.appendChild(o)
    }
    picker.value = existing?.src ?? ''
    picker.addEventListener('change', () => {
      const src = picker.value
      this.api.snapshot()
      if (!src) {
        const next = { ...entry }
        delete next.slice
        this.api.setEntry(next)
        return
      }
      const dims = this.sliceSrcDims[src]
      const guess = dims ? Math.round(Math.min(dims.w, dims.h) * 0.25) : 24
      this.api.setEntry({
        ...entry,
        // Swapping the sprite on an existing config keeps the tuned numbers;
        // a first pick adopts whatever a stylesheet is already drawing, so
        // taking control changes nothing on screen.
        slice: existing ? { ...existing, src } : inheritedSlice(node, src, guess),
      })
    })
    rows.push(field('sprite', picker))

    if (!existing) {
      const suggestion = inherited
        ? `Currently drawn with ${inherited.split('/').pop()} by a stylesheet rule. Pick it above to take per-element control.`
        : 'Pick a sprite to give this widget its own 9-slice.'
      rows.push(p('sv-e-hint', suggestion))
      return rows
    }

    /*
     * `quiet` is for gestures still in progress. A normal commit rebuilds this
     * panel, which would delete the slider or guide the pointer is holding — the
     * drag then dies on its first move and the panel appears to vanish.
     */
    const write = (patch: Partial<SliceData>, quiet = false) => {
      if (!quiet) this.api.snapshot()
      this.api.setEntry({ ...entry, slice: { ...existing, ...patch } }, { quiet })
    }

    // Power: one handle for frame thickness. Corners only stay undistorted while
    // every border is the same fraction of its slice, so the useful control is
    // that single fraction rather than four independent numbers.
    const ratios = [
      [existing.t, existing.bt],
      [existing.r, existing.br],
      [existing.b, existing.bb],
      [existing.l, existing.bl],
    ]
      .filter(([s]) => s > 0)
      .map(([s, b]) => b / s)
    const power =
      ratios.length && ratios.every((x) => Math.abs(x - ratios[0]) < 0.02) ? ratios[0] : null

    rows.push(this.sliceCanvas(existing, write))
    rows.push(
      field(
        'slice T/R',
        num(existing.t, (v) => write(scaleBorders({ ...existing, t: v }, power))),
        num(existing.r, (v) => write(scaleBorders({ ...existing, r: v }, power))),
      ),
      field(
        'slice B/L',
        num(existing.b, (v) => write(scaleBorders({ ...existing, b: v }, power))),
        num(existing.l, (v) => write(scaleBorders({ ...existing, l: v }, power))),
      ),
    )

    const powerInput = document.createElement('input')
    powerInput.type = 'range'
    powerInput.min = '0.05'
    powerInput.max = '2'
    powerInput.step = '0.01'
    powerInput.value = String(power ?? 1)
    powerInput.disabled = power === null
    const powerNum = document.createElement('input')
    powerNum.type = 'number'
    powerNum.step = '0.05'
    powerNum.value = power === null ? '' : power.toFixed(2)
    powerNum.placeholder = power === null ? 'custom' : ''
    const setPower = (v: number, quiet = false) => {
      if (!Number.isFinite(v) || v <= 0) return
      write(
        {
          bt: Math.round(existing.t * v),
          br: Math.round(existing.r * v),
          bb: Math.round(existing.b * v),
          bl: Math.round(existing.l * v),
        },
        quiet,
      )
    }
    // `input` fires continuously while dragging, `change` once on release.
    powerInput.addEventListener('input', () => setPower(Number(powerInput.value), true))
    powerInput.addEventListener('change', () => setPower(Number(powerInput.value)))
    powerNum.addEventListener('change', () => setPower(Number(powerNum.value)))
    rows.push(field('power', powerInput, powerNum))
    rows.push(
      field(
        'border T/R',
        num(existing.bt, (v) => write({ bt: v })),
        num(existing.br, (v) => write({ br: v })),
      ),
      field(
        'border B/L',
        num(existing.bb, (v) => write({ bb: v })),
        num(existing.bl, (v) => write({ bl: v })),
      ),
    )

    const repeat = document.createElement('select')
    for (const r of ['stretch', 'repeat', 'round', 'space']) {
      const o = document.createElement('option')
      o.value = r
      o.textContent = r
      repeat.appendChild(o)
    }
    repeat.value = existing.repeat
    repeat.addEventListener('change', () => write({ repeat: repeat.value as SliceData['repeat'] }))
    const fill = document.createElement('input')
    fill.type = 'checkbox'
    fill.checked = existing.fill
    fill.addEventListener('change', () => write({ fill: fill.checked }))
    rows.push(field('repeat / fill', repeat, fill))
    rows.push(
      field(
        'outset',
        num(existing.outset, (v) => write({ outset: v })),
      ),
      p(
        'sv-e-hint',
        'Pill trick: set top and bottom slice to 0 and left/right to half the source width, so the round caps scale with the widget height instead of squashing into a thin border.',
      ),
    )
    return rows
  }

  /**
   * The source image with four draggable guides.
   *
   * The guides are the reason this belongs in the inspector rather than in a
   * separate page: you drag a slice line and watch the *actual widget* behind the
   * panel change, at its real size, in its real context. A standalone tool can
   * only ever show a mock-up of that.
   */
  private sliceCanvas(slice: SliceData, write: (patch: Partial<SliceData>, quiet?: boolean) => void) {
    const wrap = div('sv-e-slice-wrap')
    const img = document.createElement('img')
    img.src = slice.src
    const mid = div('sv-e-sg-mid')
    wrap.append(img, mid)

    const guides: Record<string, HTMLElement> = {}
    for (const [key, axis] of [
      ['t', 'h'],
      ['b', 'h'],
      ['l', 'v'],
      ['r', 'v'],
    ] as const) {
      const g = div(`sv-e-sg ${axis}`)
      guides[key] = g
      wrap.appendChild(g)
    }

    const paint = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w) return
      this.sliceSrcDims[slice.src] = { w, h }
      const z = this.sliceZoom
      img.style.width = `${w * z}px`
      img.style.height = `${h * z}px`
      guides.t.style.top = `${slice.t * z}px`
      guides.b.style.top = `${(h - slice.b) * z}px`
      guides.l.style.left = `${slice.l * z}px`
      guides.r.style.left = `${(w - slice.r) * z}px`
      mid.style.left = `${slice.l * z}px`
      mid.style.top = `${slice.t * z}px`
      mid.style.width = `${Math.max(0, w - slice.l - slice.r) * z}px`
      mid.style.height = `${Math.max(0, h - slice.t - slice.b) * z}px`
    }
    if (img.complete && img.naturalWidth) paint()
    else img.addEventListener('load', paint, { once: true })

    for (const [key, axis] of [
      ['t', 'y'],
      ['b', 'y'],
      ['l', 'x'],
      ['r', 'x'],
    ] as const) {
      guides[key].addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const node = guides[key]
        node.setPointerCapture(e.pointerId)
        const rect = img.getBoundingClientRect()
        const w = img.naturalWidth
        const h = img.naturalHeight
        // One snapshot for the whole drag, not one per pixel of travel.
        this.api.snapshot()
        let last: SliceData | null = null
        const move = (ev: PointerEvent) => {
          const z = this.sliceZoom
          const px = axis === 'y' ? (ev.clientY - rect.top) / z : (ev.clientX - rect.left) / z
          // Bottom and right guides are measured inward from their own edge,
          // which is what `border-image-slice` expects.
          const inward = key === 'b' ? h - px : key === 'r' ? w - px : px
          const limit = axis === 'y' ? h / 2 : w / 2
          const v = Math.round(Math.max(0, Math.min(limit, inward)))
          last = scaleBorders({ ...slice, [key]: v } as SliceData, currentPower(slice))
          /*
           * Quiet: a normal commit re-renders the panel, which replaces this very
           * guide element and ends the drag on its first move. The widget behind
           * still updates live, so the preview is unaffected.
           */
          write(last, true)
        }
        const done = () => {
          node.removeEventListener('pointermove', move)
          // One render at the end, so the numeric fields catch up with the drag.
          if (last) write(last)
        }
        node.addEventListener('pointermove', move)
        node.addEventListener('pointerup', done, { once: true })
        node.addEventListener('pointercancel', done, { once: true })
      })
    }

    const zoom = document.createElement('input')
    zoom.type = 'range'
    zoom.min = '1'
    zoom.max = '6'
    zoom.step = '1'
    zoom.value = String(this.sliceZoom)
    zoom.addEventListener('input', () => {
      this.sliceZoom = Number(zoom.value)
      paint()
    })

    const holder = div('')
    holder.append(wrap, field('zoom', zoom))
    return holder
  }

  // ---- hierarchy ----------------------------------------------------------

  /**
   * A flat, indented list of the UI tree.
   *
   * Flat rather than collapsible on purpose: the tree is shallow and mostly
   * static, and expand arrows would add state to maintain across the full
   * re-render this panel does anyway. Elements with a saved override are tinted,
   * which doubles as the answer to "what have I actually changed?"
   */
  private hierarchy() {
    const holder = div('')
    const wrap = div('sv-e-tree')
    const root = document.getElementById('ui')
    if (!root) return holder

    /*
     * Filter box.
     *
     * The tree runs to a couple of hundred rows once panels are open, and scrolling
     * it to find `.plot-action` is slower than clicking the widget. Typing narrows
     * it instead.
     *
     * Filtering hides rows in place rather than re-rendering: this panel rebuilds
     * itself wholesale on render, which would destroy the input and lose focus on
     * every keystroke. The query is held on the instance so it survives the
     * rebuilds that *do* happen, and reapplied below.
     */
    const search = document.createElement('input')
    search.type = 'text'
    search.className = 'sv-e-treefind'
    search.placeholder = 'filter…'
    search.value = this.treeQuery
    search.addEventListener('input', () => {
      this.treeQuery = search.value
      this.applyTreeFilter(wrap)
    })
    // Escape clears the filter before the editor's own Escape handling sees it.
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation()
        search.value = ''
        this.treeQuery = ''
        this.applyTreeFilter(wrap)
      }
    })

    const selected = this.api.target()
    const overridden = new Set(currentDoc().entries.map((e) => e.selector))
    const add = (node: HTMLElement, depth: number) => {
      const row = document.createElement('div')
      const r = node.getBoundingClientRect()
      const name = describeElement(node)
      row.textContent = `${'· '.repeat(depth)}${name}`
      // Matched against the name only, so the indent dots cannot satisfy a query.
      row.dataset.name = name.toLowerCase()
      row.title = `${Math.round(r.width)} × ${Math.round(r.height)}`
      if (node === selected) row.classList.add('sv-e-on')
      if (overridden.has(deriveSelector(node))) row.classList.add('sv-e-has')
      row.addEventListener('click', () => this.api.select(node))
      wrap.appendChild(row)
    }
    const walk = (parent: Element, depth: number) => {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement) || child.closest('.sv-e-root')) continue
        add(child, depth)
        /*
         * Depth is unlimited while filtering. The two-level cap keeps the unfiltered
         * list readable, but a search that cannot reach the row you are searching for
         * is not a search — and the deep rows are exactly the ones worth filtering to.
         */
        if (depth < 2 || this.treeQuery) walk(child, depth + 1)
      }
    }
    walk(root, 0)

    holder.append(search, wrap)
    this.applyTreeFilter(wrap)
    return holder
  }

  private applyTreeFilter(wrap: HTMLElement) {
    const q = this.treeQuery.trim().toLowerCase()
    let shown = 0
    for (const row of Array.from(wrap.children)) {
      if (!(row instanceof HTMLElement)) continue
      const hit = !q || (row.dataset.name ?? '').includes(q)
      row.style.display = hit ? '' : 'none'
      if (hit) shown++
    }
    wrap.dataset.shown = String(shown)
  }
}

// ---- helpers --------------------------------------------------------------

function currentPower(s: SliceData): number | null {
  const ratios = [
    [s.t, s.bt],
    [s.r, s.br],
    [s.b, s.bb],
    [s.l, s.bl],
  ]
    .filter(([sl]) => sl > 0)
    .map(([sl, bw]) => bw / sl)
  return ratios.length && ratios.every((x) => Math.abs(x - ratios[0]) < 0.02) ? ratios[0] : null
}

/**
 * Rescale the borders when a slice changes, so a proportional frame stays
 * proportional while the guides are dragged. A frame set by hand is left alone —
 * silently re-deriving it would throw away a deliberate choice.
 */
function scaleBorders(s: SliceData, power: number | null): SliceData {
  if (power === null) return s
  return {
    ...s,
    bt: Math.round(s.t * power),
    br: Math.round(s.r * power),
    bb: Math.round(s.b * power),
    bl: Math.round(s.l * power),
  }
}

/** The sprite a stylesheet is already drawing this element with, if any. */
function inheritedSliceSrc(node: HTMLElement): string | null {
  const src = getComputedStyle(node).borderImageSource
  const m = /url\(["']?([^"')]+)["']?\)/.exec(src)
  if (!m) return null
  try {
    return new URL(m[1], location.href).pathname
  } catch {
    return m[1]
  }
}

/** Expand a 1-to-4 value CSS edge shorthand into [top, right, bottom, left]. */
function expandEdges(parts: number[]): [number, number, number, number] {
  const [a, b = a, c = a, d = b] = parts
  return [a, b, c, d]
}

/**
 * Recover the slice a stylesheet is already applying, so taking per-element
 * control does not change what is on screen.
 *
 * The same principle as measuring a rect when a widget is first selected:
 * *adopting* something must be a no-op, or the tool damages the thing you asked
 * it to let you adjust. Without this, clicking a sprite in the picker replaced a
 * tuned 0/40/0/40 pill frame with a naive quarter-inset guess and the widget
 * visibly changed the instant you looked at it.
 *
 * Percentage slices are the one case this cannot recover, because converting them
 * needs the source's natural size and the image may not be decoded yet. Those
 * fall back to the caller's guess, which is why `fallback` is required rather
 * than optional.
 */
function inheritedSlice(node: HTMLElement, src: string, fallback: number): SliceData {
  const cs = getComputedStyle(node)
  const raw = cs.borderImageSlice || ''
  const fill = /\bfill\b/.test(raw)
  const nums = raw
    .replace(/\bfill\b/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const usable = nums.length > 0 && nums.every((n) => /^[\d.]+$/.test(n))
  const [t, r, b, l] = usable
    ? expandEdges(nums.map(Number))
    : [fallback, fallback, fallback, fallback]
  const px = (v: string) => Math.round(parseFloat(v) || 0)
  const repeat = (cs.borderImageRepeat || 'stretch').split(/\s+/)[0]
  return {
    src,
    t,
    r,
    b,
    l,
    bt: px(cs.borderTopWidth),
    br: px(cs.borderRightWidth),
    bb: px(cs.borderBottomWidth),
    bl: px(cs.borderLeftWidth),
    fill,
    repeat: (['stretch', 'repeat', 'round', 'space'].includes(repeat)
      ? repeat
      : 'stretch') as SliceData['repeat'],
    outset: px(cs.borderImageOutset),
  }
}

function div(cls: string) {
  const node = document.createElement('div')
  node.className = cls
  return node
}

function h3(text: string) {
  const node = document.createElement('h3')
  node.textContent = text
  return node
}

function p(cls: string, text: string) {
  const node = document.createElement('p')
  node.className = cls
  node.textContent = text
  return node
}

function btn(label: string, onClick: () => void, cls = '') {
  const b = document.createElement('button')
  b.textContent = label
  if (cls) b.className = cls
  b.addEventListener('click', onClick)
  return b
}

function field(label: string, ...controls: HTMLElement[]) {
  const row = div('sv-e-row')
  const name = document.createElement('span')
  name.textContent = label
  row.append(name, ...controls)
  if (controls.length === 1) row.style.gridTemplateColumns = '46px 1fr'
  return row
}

/**
 * A number input that commits on change, not on every keystroke.
 *
 * Committing per keystroke sounds more live but means typing "120" pushes 1,
 * then 12, then 120 into the document — three undo steps, and two frames of the
 * widget at absurd sizes. `change` fires on blur and Enter, which is when the
 * number is actually meant.
 */
function num(value: number, onChange: (v: number) => void, step = 1) {
  const input = document.createElement('input')
  input.type = 'number'
  input.step = String(step)
  input.value = String(Math.round(value * 1000) / 1000)
  input.addEventListener('change', () => {
    const v = Number(input.value)
    if (Number.isFinite(v)) onChange(v)
  })
  return input
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

/**
 * The little diagram inside each preset button.
 *
 * Drawn from spans rather than 16 hand-authored SVGs: the grid is a product of
 * two independent axes, so the glyph should be too. A stretched axis draws a bar
 * spanning the cell, a pinned one draws a mark at that edge.
 */
function presetGlyph(row: AnchorRow, col: AnchorCol): HTMLElement[] {
  const out: HTMLElement[] = []
  const mark = (style: Partial<CSSStyleDeclaration>) => {
    const i = document.createElement('i')
    Object.assign(i.style, style)
    out.push(i)
  }
  const H = { left: '18%', center: '41%', right: '64%', stretch: '18%' }[col]
  const V = { top: '18%', middle: '41%', bottom: '64%', stretch: '18%' }[row]
  const w = col === 'stretch' ? '64%' : '18%'
  const h = row === 'stretch' ? '64%' : '18%'
  mark({ left: H, top: V, width: w, height: h, borderRadius: '1px' })
  // A faint edge tick shows which side a pinned axis is measured from.
  if (col !== 'stretch') mark({ left: H, top: '8%', width: '1px', height: '84%', opacity: '0.35' })
  if (row !== 'stretch') mark({ top: V, left: '8%', height: '1px', width: '84%', opacity: '0.35' })
  return out
}
