/**
 * The in-game UI editor: pick a widget, drag it, anchor it, save it.
 *
 * This is the UGUI half of the system — rect.ts knows what an anchored rect
 * *is*, and this file is the pair of hands. Three decisions shape it:
 *
 * **It hit-tests geometrically instead of using `elementFromPoint`.** Half the
 * HUD is `pointer-events: none` so clicks fall through to the world, and the
 * browser's hit testing honours that — which would have made exactly the
 * clusters you most want to lay out (`#playerCard`, `#navRail`, the hotbar)
 * unselectable. Walking the tree and comparing rects sees everything that is
 * *drawn*, which is the right question for a layout tool.
 *
 * **Drags write inline styles; only a commit touches the document.** Retyping
 * the whole stylesheet on every pointermove would restyle the page dozens of
 * times a second for a gesture the user has not finished expressing. Inline
 * styles are the fast path and outrank the sheet, so the preview is exact; the
 * commit clears them and lets the real rule take over, which also proves the
 * rule reproduces what the drag showed.
 *
 * **Nothing here ships.** The module is dynamically imported behind a dev gate,
 * so a player's bundle never contains it, and it may only talk to the game
 * through the DOM it is editing.
 */

import { EDITOR_CSS } from './editor-css'
import { setEditingUi } from './editing'
import {
  cloneRect,
  isFixed,
  reanchorAxis,
  rectFromBox,
  rectToCss,
  resolveSize,
  resolveStart,
  setAxisBox,
  type AnchorCol,
  type AnchorRow,
  type Box,
  type RectTransform,
} from './rect'
import { deriveSelector, describeElement } from './keys'
import { authoredOffsets } from './authored'
import { findEntry, removeEntry, upsertEntry, type LayoutEntry } from './doc'
import { applyLayout, currentDoc, loadLayout, saveLayout } from './store'
import { Inspector } from './inspector'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

const SNAP_PX = 6
/** Session storage key for the last selection, so a reload lands where you left off. */
const LAST_KEY = 'sv-ui-edit-last'
const DOCK_KEY = 'sv-ui-edit-dock'
const MIN_KEY = 'sv-ui-edit-min'
/** Properties a drag writes inline, and a commit must therefore clear. */
const INLINE_PROPS = [
  'position',
  'margin',
  'left',
  'right',
  'top',
  'bottom',
  'width',
  'height',
  'transform',
]

/**
 * The containing block of an absolutely positioned child, in viewport px.
 *
 * Percentages in `left`/`width` resolve against the offset parent's *padding*
 * box, not its border box, so the borders have to come off — otherwise a
 * bordered parent puts every percentage-anchored child out by the border width,
 * which reads as the anchor maths being subtly wrong.
 */
export function parentBox(el: HTMLElement): Box {
  const op = el.offsetParent as HTMLElement | null
  if (!op) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  const r = op.getBoundingClientRect()
  const cs = getComputedStyle(op)
  const bl = parseFloat(cs.borderLeftWidth) || 0
  const bt = parseFloat(cs.borderTopWidth) || 0
  const br = parseFloat(cs.borderRightWidth) || 0
  const bb = parseFloat(cs.borderBottomWidth) || 0
  return {
    left: r.left + bl,
    top: r.top + bt,
    width: Math.max(1, r.width - bl - br),
    height: Math.max(1, r.height - bt - bb),
  }
}

/** The element's own box, expressed in its parent's coordinate space. */
function localBox(el: HTMLElement, parent: Box): Box {
  const r = el.getBoundingClientRect()
  return {
    left: r.left - parent.left,
    top: r.top - parent.top,
    width: r.width,
    height: r.height,
  }
}

export class UiEditor {
  private readonly root: HTMLDivElement
  private readonly pick: HTMLDivElement
  private readonly hover: HTMLDivElement
  private readonly hoverTag: HTMLSpanElement
  private readonly gizmo: HTMLDivElement
  private readonly anchorRect: HTMLDivElement
  private readonly pivotEl: HTMLDivElement
  private readonly tip: HTMLDivElement
  private readonly statusEl: HTMLSpanElement
  private readonly picker: HTMLSelectElement
  /** Backing list for the name dropdown; index is the option value. */
  private pickerNodes: HTMLElement[] = []
  private readonly guides: HTMLDivElement[] = []
  private readonly inspector: Inspector

  private target: HTMLElement | null = null
  private rect: RectTransform | null = null
  private history: string[] = []
  /** The open pick menu, if any. */
  private menu: HTMLDivElement | null = null
  /** What reveal() changed, so it can be put back exactly. */
  private revealed: { el: HTMLElement; hadHidden: boolean; display: string; visibility: string; opacity: string }[] = []
  private snap = true
  private dirty = false
  private raf = 0
  private dockLeft = localStorage.getItem(DOCK_KEY) === 'left'
  private minimised = localStorage.getItem(MIN_KEY) === '1'
  private minBtn!: HTMLButtonElement

  open = false

  constructor() {
    const style = document.createElement('style')
    style.textContent = EDITOR_CSS
    document.head.appendChild(style)

    this.root = el('div', 'sv-e-root')
    this.root.style.display = 'none'
    this.pick = el('div', 'sv-e-pick')
    this.hover = el('div', 'sv-e-hover')
    this.hoverTag = el('span', 'sv-e-hover-tag')
    this.hover.appendChild(this.hoverTag)
    this.hover.style.display = 'none'

    this.gizmo = el('div', 'sv-e-sel')
    this.gizmo.style.display = 'none'
    this.gizmo.appendChild(el('div', 'sv-e-move'))
    for (const h of HANDLES) {
      const node = el('div', 'sv-e-h')
      node.dataset.h = h
      this.gizmo.appendChild(node)
    }
    this.pivotEl = el('div', 'sv-e-pivot')
    this.gizmo.appendChild(this.pivotEl)

    this.anchorRect = el('div', 'sv-e-anchor-rect')
    this.anchorRect.style.display = 'none'
    for (const c of CORNERS) {
      const node = el('div', 'sv-e-anchor')
      node.dataset.c = c
      this.anchorRect.appendChild(node)
    }

    this.tip = el('div', 'sv-e-tip')
    this.tip.style.display = 'none'
    for (let i = 0; i < 4; i++) {
      const g = el('div', 'sv-e-guide')
      g.style.display = 'none'
      this.guides.push(g)
      this.root.appendChild(g)
    }

    const bar = el('div', 'sv-e-bar')
    const title = document.createElement('b')
    title.textContent = 'UI Editor'
    this.statusEl = el('span', 'sv-e-status')
    const snapBtn = button('Snap', () => {
      this.snap = !this.snap
      snapBtn.classList.toggle('sv-e-on', this.snap)
    })
    snapBtn.classList.add('sv-e-on')
    snapBtn.title = 'Snap to parent and sibling edges (hold Alt to suspend)'

    // Dock side is remembered: which edge is in the way is a property of the
    // screen you are working on, not of one session.
    const dockBtn = button('◧', () => this.setDock(!this.dockLeft))
    dockBtn.title = 'Move the inspector to the other side'

    /*
     * Minimise, distinct from Tab's hide-everything.
     *
     * The bar spans the full width across the top, which is exactly where the
     * resource pills and the gear button live — so laying those out means working
     * underneath it. Collapsing to a corner handle clears the row while leaving a
     * way back and the unsaved-changes marker visible; Tab still blanks the lot
     * when even the handle is in the way.
     */
    const minBtn = button('▴', () => this.setMinimised(!this.minimised), 'sv-e-keep')
    minBtn.title = 'Minimise the toolbar (Tab hides everything)'
    this.minBtn = minBtn
    // Its own class, not `sv-e-status`: two elements sharing that name made the
    // status line unaddressable, which matters for anything reading it back.
    /*
     * Select a widget by name.
     *
     * Lives in the toolbar, not the inspector, because the inspector rebuilds
     * itself from scratch on every render — a <select> in there would close and
     * lose its scroll position the instant anything changed. The toolbar is built
     * once and left alone.
     *
     * Repopulated when it is opened rather than kept live: the list depends on
     * which panels are on screen, and rebuilding a few dozen <option>s on demand
     * costs nothing next to doing it every frame.
     */
    this.picker = document.createElement('select')
    this.picker.className = 'sv-e-picker'
    this.picker.title = 'Select a widget by name'
    for (const evt of ['pointerdown', 'focus'] as const) {
      this.picker.addEventListener(evt, () => this.fillPicker())
    }
    this.picker.addEventListener('change', () => {
      const i = Number(this.picker.value)
      const node = this.pickerNodes[i]
      // Indices are only valid for the list built on the last open, so a stale
      // value selects nothing rather than the wrong widget.
      if (node?.isConnected) this.select(node)
    })

    const hint = el('span', 'sv-e-hintbar')
    // Kept short enough to survive alongside the dropdown; the full list is in the
    // element titles and the inspector's empty state.
    hint.textContent = 'click to select · again to drill in · [ ] tree · arrows nudge · Tab hide'
    hint.title =
      'click to select · click again to drill in · [ and ] walk the tree · arrows nudge (Shift 10px) · Alt+arrows resize · Tab hides the chrome · Ctrl+Z undo · Ctrl+S save · Delete clears the override'
    this.statusEl.classList.add('sv-e-keep')
    bar.append(
      minBtn,
      title,
      this.picker,
      snapBtn,
      dockBtn,
      button('Undo', () => this.undo()),
      hint,
      el('span', 'sv-e-spacer'),
      this.statusEl,
      button('Save', () => void this.save(), 'sv-e-save'),
      button('Close', () => void this.toggle()),
    )

    this.inspector = new Inspector({
      target: () => this.target,
      rect: () => this.rect,
      parent: () => (this.target ? parentBox(this.target) : { left: 0, top: 0, width: 1, height: 1 }),
      setRect: (r, commit) => this.setRect(r, commit),
      entry: () => this.entryFor(this.target),
      setEntry: (e, opts) => this.commitEntry(e, opts?.quiet),
      select: (node) => this.select(node),
      clear: () => this.clearOverride(),
      save: () => this.save(),
      snapshot: () => this.snapshot(),
      status: (m) => this.status(m),
    })

    this.root.append(this.pick, this.hover, this.anchorRect, this.gizmo, this.tip, bar, this.inspector.root)
    this.setDock(this.dockLeft)
    this.setMinimised(this.minimised)
    document.body.appendChild(this.root)

    this.pick.addEventListener('pointermove', (e) => this.onHover(e))
    this.pick.addEventListener('pointerleave', () => this.hideHover())
    this.pick.addEventListener('pointerdown', (e) => this.onPickDown(e))
    this.gizmo.querySelector('.sv-e-move')!.addEventListener('pointerdown', (e) =>
      this.beginMove(e as PointerEvent),
    )
    for (const node of Array.from(this.gizmo.querySelectorAll<HTMLElement>('.sv-e-h'))) {
      node.addEventListener('pointerdown', (e) => this.beginResize(e, node.dataset.h as Handle))
    }
    this.pivotEl.addEventListener('pointerdown', (e) => this.beginPivot(e))
    for (const node of Array.from(this.anchorRect.querySelectorAll<HTMLElement>('.sv-e-anchor'))) {
      node.addEventListener('pointerdown', (e) => this.beginAnchor(e, node.dataset.c as string))
    }
    window.addEventListener('keydown', (e) => this.onKey(e), true)
    /*
     * The gizmo needs no help here — the frame loop re-reads the element's box
     * every frame, and the anchors resolve against the new parent size on their
     * own, which is the entire point of storing fractions. Only the inspector's
     * numbers go stale, since it deliberately does not re-render per frame.
     */
    window.addEventListener('resize', () => {
      if (this.open) this.inspector.render()
    })
  }

  // ---- lifecycle ----------------------------------------------------------

  async toggle(): Promise<void> {
    this.open = !this.open
    setEditingUi(this.open)
    this.root.style.display = this.open ? '' : 'none'
    if (this.open) {
      // Re-read from disk on open: another session (or a hand edit) may have
      // moved on, and silently overwriting it on the next save would be worse
      // than a moment's load.
      applyLayout(await loadLayout())
      this.history = []
      this.dirty = false
      this.select(null)
      // Populated up front as well as on focus — a dropdown that reads
      // "— select by name (0) —" until you click it looks broken.
      this.fillPicker()
      this.status('ready')
      this.loop()
    } else {
      cancelAnimationFrame(this.raf)
      this.closeMenu()
      this.unreveal()
      this.select(null)
      this.hideHover()
    }
  }

  /**
   * Track the selected widget every frame while open.
   *
   * The gizmo has to follow an element the *game* can also move — a panel
   * opening, a toast animating in, a hotbar rebuilding — and there is no event
   * for "your rect changed". A frame loop is the honest way to stay glued to it.
   */
  private loop = () => {
    if (!this.open) return
    if (this.target) {
      if (!this.target.isConnected) this.select(null)
      else this.layoutGizmo()
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  // ---- picking ------------------------------------------------------------

  /**
   * Every drawn `#ui` descendant containing the point, shallowest first.
   *
   * `visibility` and `opacity` are only consulted for elements that already
   * passed the cheap rect test, which keeps a full-tree walk affordable at
   * pointer-move rates; `display: none` needs no check at all because it has no
   * rect to match in the first place.
   */
  private hitTest(x: number, y: number): HTMLElement[] {
    const root = document.getElementById('ui')
    if (!root) return []
    const out: HTMLElement[] = []
    const walk = (parent: Element) => {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (child.closest('.sv-e-root')) continue
        const r = child.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          const cs = getComputedStyle(child)
          const shown = cs.visibility !== 'hidden' && cs.opacity !== '0'
          if (shown && !isInvisibleFullScreenWrapper(child, cs, r)) out.push(child)
        }
        walk(child)
      }
    }
    walk(root)
    return out
  }

  /**
   * Preview the deepest candidate under the cursor.
   *
   * Deepest, not shallowest: it is the element actually under the pixel, and it is
   * what a click most often wants. The count tells you a menu is coming.
   */
  private onHover(e: PointerEvent) {
    if (this.menu) return
    const list = this.hitTest(e.clientX, e.clientY)
    if (!list.length) {
      this.hideHover()
      return
    }
    this.showHover(list[list.length - 1], list.length)
  }

  private showHover(node: HTMLElement, stack = 0) {
    const r = node.getBoundingClientRect()
    Object.assign(this.hover.style, {
      display: '',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    })
    this.hoverTag.textContent =
      `${describeElement(node)}  ${Math.round(r.width)}×${Math.round(r.height)}` +
      (stack > 1 ? `  · ${stack} here` : '')
  }

  private hideHover() {
    this.hover.style.display = 'none'
  }

  /**
   * Click offers everything under the cursor rather than guessing.
   *
   * The old behaviour selected the outermost candidate and cycled inward on
   * repeated clicks in the same spot. That collapses as soon as a full-screen
   * element is in the stack — the shop overlay, a modal backdrop, `#ui` itself —
   * because the first click always landed on the thing covering the screen and
   * reaching the button under it meant clicking blind and reading the title to see
   * where you ended up.
   *
   * A single candidate still selects immediately; there is nothing to choose.
   */
  private onPickDown(e: PointerEvent) {
    if (e.button !== 0) return
    this.closeMenu()
    const list = this.hitTest(e.clientX, e.clientY)
    if (!list.length) {
      /*
       * A click on nothing keeps the selection.
       *
       * It used to deselect, which quietly threw away work: the inspector is
       * docked with an 8px margin, so the strip beside it and the sliver under it
       * are live pick layer, and reaching for the panel — or overshooting toward
       * the right edge — landed on one of them and emptied the panel. The widget
       * you were three edits into was simply gone.
       *
       * Deselection is now only ever deliberate: Escape. Selecting something else
       * still just means clicking it, so nothing is harder to reach.
       */
      this.status('nothing there · Escape to deselect')
      return
    }
    if (list.length === 1) {
      this.select(list[0])
      return
    }
    this.openMenu(e.clientX, e.clientY, list)
  }

  /**
   * Show the candidate stack, deepest first.
   *
   * Deepest first because that is almost always the intended target — the thing
   * actually under the pixel — while the containers above it are context. Entries
   * that cover most of the viewport are flagged, since "this is the full-screen
   * wrapper, not the button" is the single most useful thing to know here.
   */
  private openMenu(x: number, y: number, list: HTMLElement[]) {
    const menu = el('div', 'sv-e-menu')
    const head = el('div', 'sv-e-menu-head')
    head.textContent = `${list.length} under cursor`
    menu.appendChild(head)

    const vw = window.innerWidth
    const vh = window.innerHeight
    for (const node of [...list].reverse()) {
      const r = node.getBoundingClientRect()
      const covers = r.width > vw * 0.9 && r.height > vh * 0.9
      const row = document.createElement('button')
      row.innerHTML =
        `${escapeHtml(describeElement(node))}` +
        `<span class="sv-e-dim">  ${Math.round(r.width)}×${Math.round(r.height)}</span>` +
        (covers ? `<span class="sv-e-full">  full-screen</span>` : '')
      if (node === list[list.length - 1]) row.classList.add('sv-e-first')
      // Hovering a row previews it in place, so the list can be read against the
      // screen rather than by name alone.
      row.addEventListener('pointerenter', () => this.showHover(node))
      row.addEventListener('click', () => {
        this.closeMenu()
        this.select(node)
      })
      menu.appendChild(row)
    }

    this.root.appendChild(menu)
    this.menu = menu
    // Flip away from the edges so the list is never clipped.
    const mr = menu.getBoundingClientRect()
    menu.style.left = `${Math.min(x + 4, vw - mr.width - 8)}px`
    menu.style.top = `${Math.min(y + 4, vh - mr.height - 8)}px`
  }

  private closeMenu() {
    this.menu?.remove()
    this.menu = null
  }

  // ---- selection ----------------------------------------------------------

  select(node: HTMLElement | null) {
    // Put back whatever the last reveal forced open before touching the new one.
    this.unreveal()
    if (node) this.reveal(node)
    this.target = node
    if (node) sessionStorage.setItem(LAST_KEY, deriveSelector(node))
    // Keep the name dropdown pointing at whatever is selected, however it was
    // chosen — clicking in the scene, [ and ], or the hierarchy list.
    this.syncPicker()
    if (!node) {
      this.rect = null
      this.gizmo.style.display = 'none'
      this.anchorRect.style.display = 'none'
      this.inspector.render()
      return
    }
    this.rect = this.readRect(node)
    this.gizmo.style.display = ''
    this.anchorRect.style.display = ''
    this.layoutGizmo()
    this.inspector.render()
  }

  /**
   * The rect for an element: the saved one if it has an override, otherwise one
   * measured from where it currently sits.
   *
   * Measuring on first selection is what makes the tool non-destructive to use.
   * Selecting a widget must never move it, so the opening rect has to *reproduce*
   * the hand-written CSS rather than replace it with a default.
   */
  private readRect(node: HTMLElement): RectTransform {
    const saved = findEntry(currentDoc(), deriveSelector(node))?.rect
    if (saved) return cloneRect(saved)
    const parent = parentBox(node)
    const set = authoredOffsets(node)
    return rectFromBox(localBox(node, parent), parent, this.guessAnchors(node, parent), {
      // Hug on any axis the stylesheet left to the content. Writing the measured
      // length instead would look identical on save and clip the day the content
      // grows — see RectAxis.auto.
      x: !set.width,
      y: !set.height,
    })
  }

  /**
   * Open a fresh widget on the anchor preset its CSS already implies.
   *
   * A HUD element pinned with `right: 12px` is conceptually right-anchored, and
   * opening it as top-left would make the first resize drag pull it away from the
   * corner it was designed to hug. So the guess comes from which insets the
   * stylesheet *declares*, via authoredOffsets — computed style cannot answer it,
   * because an absolutely positioned box resolves every inset to a number whether
   * the author wrote it or not.
   *
   * Both insets declared means stretch; only the far one means far-anchored;
   * neither means fall back to geometry and check whether it happens to be
   * centred, which is how the flow-positioned clusters read.
   */
  private guessAnchors(node: HTMLElement, parent: Box): { row: AnchorRow; col: AnchorCol } {
    const set = authoredOffsets(node)
    const box = localBox(node, parent)
    const centredX = Math.abs(box.left + box.width / 2 - parent.width / 2) < 2
    const centredY = Math.abs(box.top + box.height / 2 - parent.height / 2) < 2
    const col: AnchorCol =
      set.left && set.right && !set.width
        ? 'stretch'
        : set.right && !set.left
          ? 'right'
          : centredX
            ? 'center'
            : 'left'
    const row: AnchorRow =
      set.top && set.bottom && !set.height
        ? 'stretch'
        : set.bottom && !set.top
          ? 'bottom'
          : centredY
            ? 'middle'
            : 'top'
    return { row, col }
  }

  private layoutGizmo() {
    const node = this.target
    if (!node || !this.rect) return
    const r = node.getBoundingClientRect()
    /*
     * An axis that hugs its content has no authoritative size in the model — the
     * content decides, and only the DOM knows the answer. Syncing the measurement
     * back each frame is what keeps the gizmo's handles and the inspector's size
     * field showing the real box rather than whatever it happened to be when the
     * widget was first selected.
     */
    if (this.rect.x.auto) this.rect.x.size = r.width
    if (this.rect.y.auto) this.rect.y.size = r.height
    Object.assign(this.gizmo.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    })
    const place = (sel: string, x: number, y: number) => {
      const h = this.gizmo.querySelector<HTMLElement>(sel)
      if (h) {
        h.style.left = `${x}px`
        h.style.top = `${y}px`
      }
    }
    const w = r.width
    const h = r.height
    const at: Record<Handle, [number, number]> = {
      nw: [0, 0],
      n: [w / 2, 0],
      ne: [w, 0],
      e: [w, h / 2],
      se: [w, h],
      s: [w / 2, h],
      sw: [0, h],
      w: [0, h / 2],
    }
    for (const k of HANDLES) place(`[data-h="${k}"]`, at[k][0], at[k][1])
    this.pivotEl.style.left = `${this.rect.x.p * w}px`
    this.pivotEl.style.top = `${this.rect.y.p * h}px`

    const parent = parentBox(node)
    const ax0 = parent.left + this.rect.x.a0 * parent.width
    const ax1 = parent.left + this.rect.x.a1 * parent.width
    const ay0 = parent.top + this.rect.y.a0 * parent.height
    const ay1 = parent.top + this.rect.y.a1 * parent.height
    Object.assign(this.anchorRect.style, {
      left: `${ax0}px`,
      top: `${ay0}px`,
      width: `${Math.max(0, ax1 - ax0)}px`,
      height: `${Math.max(0, ay1 - ay0)}px`,
    })
    for (const c of CORNERS) {
      const node2 = this.anchorRect.querySelector<HTMLElement>(`[data-c="${c}"]`)!
      node2.style.left = c[1] === 'e' || c === 'ne' || c === 'se' ? '100%' : '0'
      node2.style.top = c[0] === 's' ? '100%' : '0'
    }
  }

  // ---- gestures -----------------------------------------------------------

  /**
   * Shared pointer-capture plumbing.
   *
   * Capture is what makes a drag survive the pointer leaving the handle — which
   * it always does, because the handle is 11px and the gesture is hundreds. The
   * `up` callback commits, so an interrupted drag (pointercancel) still lands the
   * value the user last saw rather than reverting it.
   */
  private drag(
    e: PointerEvent,
    onMove: (dx: number, dy: number, ev: PointerEvent) => void,
    label?: (ev: PointerEvent) => string,
  ) {
    if (!this.target || !this.rect) return
    e.preventDefault()
    e.stopPropagation()
    this.snapshot()
    const node = e.currentTarget as HTMLElement
    node.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const y0 = e.clientY
    const move = (ev: PointerEvent) => {
      onMove(ev.clientX - x0, ev.clientY - y0, ev)
      this.previewInline()
      this.layoutGizmo()
      this.inspector.render()
      if (label) this.showTip(ev.clientX, ev.clientY, label(ev))
    }
    const finish = () => {
      node.removeEventListener('pointermove', move)
      this.hideTip()
      this.hideGuides()
      this.commitRect()
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', finish, { once: true })
    node.addEventListener('pointercancel', finish, { once: true })
  }

  private beginMove(e: PointerEvent) {
    if (!this.target || !this.rect) return
    const parent = parentBox(this.target)
    const start = localBox(this.target, parent)
    this.drag(
      e,
      (dx, dy, ev) => {
        let left = start.left + dx
        let top = start.top + dy
        if (this.snap && !ev.altKey) {
          const s = this.snapBox({ ...start, left, top }, parent)
          left = s.left
          top = s.top
        }
        this.rect!.x = setAxisBox(this.rect!.x, left, start.width, parent.width)
        this.rect!.y = setAxisBox(this.rect!.y, top, start.height, parent.height)
      },
      () => this.boxLabel(),
    )
  }

  private beginResize(e: PointerEvent, handle: Handle) {
    if (!this.target || !this.rect) return
    const parent = parentBox(this.target)
    const start = localBox(this.target, parent)
    const west = handle.includes('w')
    const east = handle.includes('e')
    const north = handle.startsWith('n')
    const south = handle.startsWith('s')
    /*
     * Dragging a size handle is the author stating a size, so the axis stops
     * hugging its content. Only the axis actually being dragged: a west handle
     * says nothing about the height, and clearing both would quietly bake a
     * measured length into the axis the gesture never touched.
     */
    if (west || east) this.rect.x.auto = false
    if (north || south) this.rect.y.auto = false
    this.drag(
      e,
      (dx, dy, ev) => {
        let l = start.left
        let t = start.top
        let w = start.width
        let h = start.height
        if (west) {
          l = start.left + dx
          w = start.width - dx
        } else if (east) w = start.width + dx
        if (north) {
          t = start.top + dy
          h = start.height - dy
        } else if (south) h = start.height + dy
        // A resize past its opposite edge would invert the box; clamping the
        // dragged edge instead of allowing negative sizes keeps the gesture
        // reversible without the widget flipping inside out on the way.
        w = Math.max(1, w)
        h = Math.max(1, h)
        if (this.snap && !ev.altKey) {
          const snapped = this.snapEdges({ left: l, top: t, width: w, height: h }, parent, {
            west,
            east,
            north,
            south,
          })
          l = snapped.left
          t = snapped.top
          w = snapped.width
          h = snapped.height
        }
        this.rect!.x = setAxisBox(this.rect!.x, l, w, parent.width)
        this.rect!.y = setAxisBox(this.rect!.y, t, h, parent.height)
      },
      () => this.boxLabel(),
    )
  }

  /**
   * Anchor dragging re-frames without moving.
   *
   * That is the whole point of the gesture and the easy thing to get wrong: it
   * would be far simpler to set the fractions and let the widget jump, but then
   * the tool is useless — you would re-tune the offsets by hand after every
   * anchor change. When the axis is currently fixed, both fractions move
   * together, because a single anchor point is what "fixed" means and splitting
   * it silently on a drag would turn a nudge into a stretch.
   */
  private beginAnchor(e: PointerEvent, corner: string) {
    if (!this.target || !this.rect) return
    const parent = parentBox(this.target)
    const horizEnd = corner.includes('e')
    const vertEnd = corner.startsWith('s')
    this.drag(
      e,
      (_dx, _dy, ev) => {
        const fx = clamp01((ev.clientX - parent.left) / parent.width)
        const fy = clamp01((ev.clientY - parent.top) / parent.height)
        const step = ev.shiftKey ? 0.05 : 0
        const qx = step ? Math.round(fx / step) * step : fx
        const qy = step ? Math.round(fy / step) * step : fy
        const r = this.rect!
        if (isFixed(r.x)) r.x = reanchorAxis(r.x, qx, qx, r.x.p, parent.width)
        else {
          const a0 = horizEnd ? Math.min(r.x.a0, qx) : Math.min(qx, r.x.a1)
          const a1 = horizEnd ? Math.max(qx, r.x.a0) : Math.max(r.x.a1, qx)
          r.x = reanchorAxis(r.x, a0, a1, r.x.p, parent.width)
        }
        if (isFixed(r.y)) r.y = reanchorAxis(r.y, qy, qy, r.y.p, parent.height)
        else {
          const a0 = vertEnd ? Math.min(r.y.a0, qy) : Math.min(qy, r.y.a1)
          const a1 = vertEnd ? Math.max(qy, r.y.a0) : Math.max(r.y.a1, qy)
          r.y = reanchorAxis(r.y, a0, a1, r.y.p, parent.height)
        }
      },
      () => {
        const r = this.rect!
        return `anchors ${pct(r.x.a0)}–${pct(r.x.a1)} × ${pct(r.y.a0)}–${pct(r.y.a1)}`
      },
    )
  }

  private beginPivot(e: PointerEvent) {
    if (!this.target || !this.rect) return
    const parent = parentBox(this.target)
    this.drag(
      e,
      (_dx, _dy, ev) => {
        const r = this.target!.getBoundingClientRect()
        const px = clamp01((ev.clientX - r.left) / Math.max(1, r.width))
        const py = clamp01((ev.clientY - r.top) / Math.max(1, r.height))
        const step = ev.shiftKey ? 0.5 : 0
        const qx = step ? Math.round(px / step) * step : px
        const qy = step ? Math.round(py / step) * step : py
        this.rect!.x = reanchorAxis(this.rect!.x, this.rect!.x.a0, this.rect!.x.a1, qx, parent.width)
        this.rect!.y = reanchorAxis(this.rect!.y, this.rect!.y.a0, this.rect!.y.a1, qy, parent.height)
      },
      () => `pivot ${this.rect!.x.p.toFixed(2)}, ${this.rect!.y.p.toFixed(2)}`,
    )
  }

  // ---- snapping -----------------------------------------------------------

  /** Candidate snap lines in parent space: the parent's own edges and centre, plus every sibling's. */
  private snapLines(parent: Box): { xs: number[]; ys: number[] } {
    const xs = [0, parent.width / 2, parent.width]
    const ys = [0, parent.height / 2, parent.height]
    const node = this.target
    const host = node?.offsetParent as HTMLElement | null
    for (const sib of Array.from(host?.children ?? [])) {
      if (!(sib instanceof HTMLElement) || sib === node || sib.closest('.sv-e-root')) continue
      const r = sib.getBoundingClientRect()
      if (!r.width || !r.height) continue
      xs.push(r.left - parent.left, r.right - parent.left, r.left - parent.left + r.width / 2)
      ys.push(r.top - parent.top, r.bottom - parent.top, r.top - parent.top + r.height / 2)
    }
    return { xs, ys }
  }

  private hideGuides() {
    for (const g of this.guides) g.style.display = 'none'
  }

  private showGuide(i: number, axis: 'v' | 'h', at: number, parent: Box) {
    const g = this.guides[i]
    g.className = `sv-e-guide ${axis}`
    g.style.display = ''
    if (axis === 'v') {
      g.style.left = `${parent.left + at}px`
      g.style.top = `${parent.top}px`
      g.style.height = `${parent.height}px`
      g.style.width = '1px'
    } else {
      g.style.top = `${parent.top + at}px`
      g.style.left = `${parent.left}px`
      g.style.width = `${parent.width}px`
      g.style.height = '1px'
    }
  }

  /** Snap a moving box by its edges and centre, whichever is nearest. */
  private snapBox(box: Box, parent: Box): Box {
    const { xs, ys } = this.snapLines(parent)
    this.hideGuides()
    let gi = 0
    const fit = (candidates: number[], lines: number[]) => {
      let best: { delta: number; line: number } | null = null
      for (const c of candidates) {
        for (const line of lines) {
          const d = line - c
          if (Math.abs(d) <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.delta))) {
            best = { delta: d, line }
          }
        }
      }
      return best
    }
    const hx = fit([box.left, box.left + box.width / 2, box.left + box.width], xs)
    const hy = fit([box.top, box.top + box.height / 2, box.top + box.height], ys)
    if (hx) this.showGuide(gi++, 'v', hx.line, parent)
    if (hy) this.showGuide(gi++, 'h', hy.line, parent)
    return {
      ...box,
      left: box.left + (hx?.delta ?? 0),
      top: box.top + (hy?.delta ?? 0),
    }
  }

  /** Snap only the edges a resize is actually dragging. */
  private snapEdges(
    box: Box,
    parent: Box,
    which: { west: boolean; east: boolean; north: boolean; south: boolean },
  ): Box {
    const { xs, ys } = this.snapLines(parent)
    this.hideGuides()
    let gi = 0
    const near = (v: number, lines: number[]) => {
      let best: number | null = null
      for (const line of lines) {
        if (Math.abs(line - v) <= SNAP_PX && (best === null || Math.abs(line - v) < Math.abs(best - v))) {
          best = line
        }
      }
      return best
    }
    const out = { ...box }
    if (which.west) {
      const s = near(box.left, xs)
      if (s !== null) {
        out.width = box.left + box.width - s
        out.left = s
        this.showGuide(gi++, 'v', s, parent)
      }
    } else if (which.east) {
      const s = near(box.left + box.width, xs)
      if (s !== null) {
        out.width = s - box.left
        this.showGuide(gi++, 'v', s, parent)
      }
    }
    if (which.north) {
      const s = near(box.top, ys)
      if (s !== null) {
        out.height = box.top + box.height - s
        out.top = s
        this.showGuide(gi++, 'h', s, parent)
      }
    } else if (which.south) {
      const s = near(box.top + box.height, ys)
      if (s !== null) {
        out.height = s - box.top
        this.showGuide(gi++, 'h', s, parent)
      }
    }
    out.width = Math.max(1, out.width)
    out.height = Math.max(1, out.height)
    return out
  }

  // ---- preview and commit -------------------------------------------------

  /** Fast path during a drag: inline styles outrank the sheet, so this is exact. */
  private previewInline() {
    if (!this.target || !this.rect) return
    const decls = rectToCss(this.rect)
    for (const [k, v] of Object.entries(decls)) this.target.style.setProperty(k, v)
  }

  private clearInline() {
    if (!this.target) return
    for (const p of INLINE_PROPS) this.target.style.removeProperty(p)
  }

  private entryFor(node: HTMLElement | null): LayoutEntry | null {
    if (!node) return null
    const selector = deriveSelector(node)
    return (
      findEntry(currentDoc(), selector) ?? {
        selector,
        label: describeElement(node),
      }
    )
  }

  /**
   * Land the dragged rect in the document.
   *
   * Clearing the inline styles *before* applying the sheet is deliberate: if the
   * generated rule fails to reproduce what the drag showed, the widget visibly
   * jumps and the bug is in front of you. Leaving the inline styles on would
   * mask exactly that class of compiler error until the next reload.
   */
  private commitRect() {
    if (!this.target || !this.rect) return
    const entry = this.entryFor(this.target)!
    this.clearInline()
    this.commitEntry({ ...entry, rect: cloneRect(this.rect) })
  }

  /**
   * Land an entry in the document.
   *
   * `quiet` skips the inspector rebuild, and continuous controls depend on it. The
   * panel re-renders itself from scratch, so committing on every `input` event
   * destroyed the slider or guide the pointer was still holding — the drag died on
   * its first move and the panel appeared to vanish. Live controls commit quietly
   * and ask for one render when the gesture ends.
   */
  private commitEntry(entry: LayoutEntry, quiet = false) {
    applyLayout(upsertEntry(currentDoc(), entry))
    this.dirty = true
    this.status('unsaved changes')
    if (!quiet) this.inspector.render()
  }

  private setRect(r: RectTransform, commit = true) {
    this.rect = r
    if (commit) this.commitRect()
    else {
      this.previewInline()
      this.layoutGizmo()
    }
  }

  private clearOverride() {
    if (!this.target) return
    this.snapshot()
    const selector = deriveSelector(this.target)
    this.clearInline()
    applyLayout(removeEntry(currentDoc(), selector))
    this.dirty = true
    // Re-measure: with the override gone the widget is back where the stylesheet
    // puts it, and the gizmo has to agree with the screen.
    this.select(this.target)
    this.status(`cleared ${selector}`)
  }

  private snapshot() {
    this.history.push(JSON.stringify(currentDoc()))
    if (this.history.length > 60) this.history.shift()
  }

  private undo() {
    const prev = this.history.pop()
    if (!prev) {
      this.status('nothing to undo')
      return
    }
    this.clearInline()
    applyLayout(JSON.parse(prev))
    if (this.target) this.select(this.target)
    this.status(`undo · ${this.history.length} left`)
  }

  private async save() {
    this.status('saving…')
    const res = await saveLayout()
    if (res.ok) {
      this.dirty = false
      this.status(`✓ saved ${res.entries} override(s)`)
    } else {
      this.status(`✗ ${res.error}`)
    }
  }

  // ---- keyboard -----------------------------------------------------------

  private onKey(e: KeyboardEvent) {
    if (!this.open) return
    const typing =
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)
    if (typing) {
      // Escape still has to get out of a field, but nothing else may be stolen
      // from it — arrow keys in a number input are how you type a value.
      if (e.key === 'Escape') (e.target as HTMLElement).blur()
      return
    }
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape') {
      take()
      // Escape unwinds one layer at a time: menu, then selection, then the editor.
      if (this.menu) this.closeMenu()
      else if (this.target) this.select(null)
      else void this.toggle()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      take()
      this.undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      take()
      void this.save()
      return
    }
    if (e.key === 'Tab') {
      take()
      this.toggleBare()
      return
    }
    if (!this.target || !this.rect) return
    if (e.key === '[') {
      take()
      const up = this.target.parentElement
      if (up && up.id !== 'ui') this.select(up)
      return
    }
    if (e.key === ']') {
      take()
      const down = Array.from(this.target.children).find((c) => c instanceof HTMLElement)
      if (down) this.select(down as HTMLElement)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      take()
      this.clearOverride()
      return
    }
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const d = nudge[e.key]
    if (!d) return
    take()
    const step = e.shiftKey ? 10 : 1
    const parent = parentBox(this.target)
    // Measured, not resolved: on an axis that hugs its content the model's `size`
    // is a cache of the last measurement, and a nudge should act on the box that
    // is actually on screen.
    const now = localBox(this.target, parent)
    this.snapshot()
    if (e.altKey) {
      // Alt turns the nudge into a resize, the same convention the handles use —
      // and, like them, it states a size, so the axis stops hugging.
      if (d[0]) this.rect.x.auto = false
      if (d[1]) this.rect.y.auto = false
      const w = Math.max(1, now.width + d[0] * step)
      const h = Math.max(1, now.height + d[1] * step)
      this.rect.x = setAxisBox(this.rect.x, now.left, w, parent.width)
      this.rect.y = setAxisBox(this.rect.y, now.top, h, parent.height)
    } else {
      this.rect.x = setAxisBox(this.rect.x, now.left + d[0] * step, now.width, parent.width)
      this.rect.y = setAxisBox(this.rect.y, now.top + d[1] * step, now.height, parent.height)
    }
    this.commitRect()
    this.layoutGizmo()
  }

  // ---- chrome helpers -----------------------------------------------------

  private boxLabel(): string {
    if (!this.target || !this.rect) return ''
    const parent = parentBox(this.target)
    const l = resolveStart(this.rect.x, parent.width)
    const t = resolveStart(this.rect.y, parent.height)
    const w = resolveSize(this.rect.x, parent.width)
    const h = resolveSize(this.rect.y, parent.height)
    return `${Math.round(l)}, ${Math.round(t)}\n${Math.round(w)} × ${Math.round(h)}`
  }

  private showTip(x: number, y: number, text: string) {
    this.tip.textContent = text
    this.tip.style.display = ''
    this.tip.style.left = `${x + 14}px`
    this.tip.style.top = `${y + 14}px`
  }

  private hideTip() {
    this.tip.style.display = 'none'
  }

  private status(msg: string) {
    this.statusEl.textContent = this.dirty && !msg.startsWith('✓') ? `${msg} *` : msg
  }

  /**
   * Rebuild the name dropdown from what is currently on screen.
   *
   * Only elements that *have* a name are listed — an id, or at least one stable
   * class. The tree is full of anonymous wrapper divs and spans, and offering to
   * "select by name" a hundred entries called `div` would be worse than not
   * offering it: the ones worth reaching this way are exactly the ones someone
   * bothered to name.
   *
   * Indented by depth so the structure is still readable, and marked with a dot
   * where an override already exists, which doubles as the answer to "what have I
   * changed?". Native selects support type-to-search, so the label starts with the
   * name rather than the marker.
   */
  private fillPicker() {
    const root = document.getElementById('ui')
    if (!root) return
    const overridden = new Set(currentDoc().entries.map((e) => e.selector))
    this.pickerNodes = []
    const labels: string[] = []
    const walk = (parent: Element, depth: number) => {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement) || child.closest('.sv-e-root')) continue
        const named = !!child.id || describeElement(child).includes('.')
        const r = child.getBoundingClientRect()
        if (named && r.width >= 2 && r.height >= 2) {
          this.pickerNodes.push(child)
          const mark = overridden.has(deriveSelector(child)) ? ' ●' : ''
          labels.push(
            `${'  '.repeat(depth)}${describeElement(child)}${mark}  ${Math.round(r.width)}×${Math.round(r.height)}`,
          )
        }
        walk(child, depth + 1)
      }
    }
    walk(root, 0)

    this.picker.textContent = ''
    const head = document.createElement('option')
    head.value = ''
    head.textContent = `— select by name (${this.pickerNodes.length}) —`
    this.picker.appendChild(head)
    for (let i = 0; i < this.pickerNodes.length; i++) {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = labels[i]
      this.picker.appendChild(o)
    }
    this.syncPicker()
  }

  /** Point the dropdown at the current selection, however it was made. */
  private syncPicker() {
    const i = this.target ? this.pickerNodes.indexOf(this.target) : -1
    this.picker.value = i >= 0 ? String(i) : ''
  }

  /**
   * Force the selected widget into view, even if its panel is closed.
   *
   * Selecting something from the dropdown or the hierarchy list is the only way to
   * reach a widget inside a closed panel — and until now doing so gave you a
   * gizmo of nothing, because the element has no box while an ancestor is
   * `display: none`. Nothing about it could be inspected or laid out.
   *
   * Panels hide by taking a `hidden` class (`#shop.hidden { display: none }`), so
   * removing it is the game's own show path rather than a guess at what `display`
   * the panel wanted — which is the part an inline override cannot know. Anything
   * hidden by other means gets inline overrides instead. Every change is recorded
   * and undone on the next selection, so the game is left exactly as it was.
   */
  private reveal(node: HTMLElement) {
    for (let el: HTMLElement | null = node; el && el.id !== 'ui'; el = el.parentElement) {
      const cs = getComputedStyle(el)
      const hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0'
      if (!hidden) continue
      const record = {
        el,
        hadHidden: el.classList.contains('hidden'),
        display: el.style.display,
        visibility: el.style.visibility,
        opacity: el.style.opacity,
      }
      this.revealed.push(record)
      if (record.hadHidden) el.classList.remove('hidden')
      if (cs.visibility === 'hidden') el.style.visibility = 'visible'
      if (cs.opacity === '0') el.style.opacity = '1'
      // Only if dropping the class was not enough — an element hidden by a rule we
      // cannot name still needs *some* display, and block is the safest guess.
      if (getComputedStyle(el).display === 'none') el.style.display = 'block'
    }
    if (this.revealed.length) this.status(`revealed ${this.revealed.length} hidden ancestor(s)`)
  }

  private unreveal() {
    for (const r of this.revealed.reverse()) {
      if (r.hadHidden) r.el.classList.add('hidden')
      r.el.style.display = r.display
      r.el.style.visibility = r.visibility
      r.el.style.opacity = r.opacity
    }
    this.revealed = []
  }

  private setDock(left: boolean) {
    this.dockLeft = left
    this.root.classList.toggle('sv-e-dock-left', left)
    localStorage.setItem(DOCK_KEY, left ? 'left' : 'right')
  }

  private setMinimised(on: boolean) {
    this.minimised = on
    this.root.classList.toggle('sv-e-min', on)
    this.minBtn.textContent = on ? '▾' : '▴'
    this.minBtn.title = on ? 'Restore the toolbar' : 'Minimise the toolbar (Tab hides everything)'
    localStorage.setItem(MIN_KEY, on ? '1' : '0')
  }

  /** Hide the chrome but keep the gizmo, so you can see the widget you are moving. */
  private toggleBare() {
    this.root.classList.toggle('sv-e-bare')
  }
}

// ---- small helpers --------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  return node
}

function button(label: string, onClick: () => void, cls = '') {
  const b = el('button', cls)
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

/**
 * A full-screen container that paints nothing of its own.
 *
 * These are the layers that "take the whole click": `#popups` and `#toasts` exist
 * only to position floating children, cover the entire viewport, and draw nothing.
 * Every pick anywhere on screen used to include them, so they padded the candidate
 * list and — back when a click selected the outermost match — reliably stole the
 * first click from whatever you were aiming at.
 *
 * Identified by behaviour rather than by name: covers essentially the whole
 * viewport *and* has no background, border, sprite or shadow to show for it. A
 * modal's dim backdrop has a background colour and so is still selectable, which
 * is right — that one you may genuinely want to lay out.
 */
function isInvisibleFullScreenWrapper(
  node: HTMLElement,
  cs: CSSStyleDeclaration,
  r: DOMRect,
): boolean {
  const covers = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
  if (!covers) return false
  const transparentBg =
    cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent'
  const paintsNothing =
    transparentBg &&
    cs.backgroundImage === 'none' &&
    cs.borderImageSource === 'none' &&
    cs.boxShadow === 'none' &&
    parseFloat(cs.borderTopWidth) === 0 &&
    parseFloat(cs.borderLeftWidth) === 0
  // Never filter the element itself out of reach if it is the UI root's own child
  // *and* something is anchored to it — but that is what the name dropdown and the
  // hierarchy list are for, so picking can afford to be opinionated.
  return paintsNothing && node.id !== 'ui'
}

/** Element names come from the DOM, so they go through this before innerHTML. */
function escapeHtml(text: string) {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function pct(v: number) {
  return `${Math.round(v * 100)}%`
}

let instance: UiEditor | null = null

/**
 * Lazily construct and toggle. Called from the dev gate in main.ts.
 *
 * The selector defaults to whatever was last selected, so opening the editor
 * after a reload puts you back on the widget you were tuning. HMR reloads the
 * page on most edits, and re-finding your widget every time is what makes an
 * in-page editor tiring rather than quick.
 */
export async function toggleUiEditor(select?: string): Promise<void> {
  instance ??= new UiEditor()
  await instance.toggle()
  if (!instance.open) return
  const wanted = select ?? sessionStorage.getItem(LAST_KEY) ?? ''
  if (!wanted) return
  let node: HTMLElement | null = null
  try {
    node = document.querySelector<HTMLElement>(wanted)
  } catch {
    // A stored selector that no longer parses is not worth failing the open over.
    return
  }
  /*
   * Only restore something that is actually on screen.
   *
   * The last selection can easily belong to a panel that is now closed — a dev-panel
   * button, a shop row — and reopening on it selected a 0x0 element, so the editor
   * came up showing a gizmo of nothing with a rect full of zeroes. A hidden element
   * has no box to edit, so there is nothing useful to restore.
   */
  if (!node?.isConnected) return
  const r = node.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return
  instance.select(node)
}
