import * as THREE from 'three'
import type { Engine } from '../../core/engine'
import type { TouchControls } from '../../ui/touch'
import { pickGround, rayDistanceToPoint } from '../../core/picking'
import type { HoldTarget } from './types'

/**
 * The hold gesture — the opening's shaping verb.
 *
 * Tap is a discrete act; hold is shaping (contract rule 1). No hold gesture
 * existed anywhere in the game before this: mouse committed on pointerdown,
 * touch on pointerup, and the two had nothing in common. This class unifies
 * them behind one target list so a press *feels* the same on both devices —
 * same commit time, same slop, same cancel grammar.
 *
 * Mouse path: capture-phase `pointerdown/up` listeners, registered on `window`
 * rather than the canvas itself. That placement is the whole mechanism, not a
 * convenience: the legacy `pointerdown → interactAt` handler lives on the same
 * canvas element, and at the event target listeners fire in registration order
 * regardless of the capture flag — a capture listener added *after* main.ts
 * booted could never reliably pre-empt it. One node up, the capture phase runs
 * strictly before the target's own listeners, so `stopPropagation()` here
 * guarantees the legacy click path never sees an opening press. Events are
 * filtered to `target === canvas`, left button, non-touch; everything else
 * (right-drag look, wheel zoom, UI clicks) passes untouched.
 *
 * Touch path: `TouchControls` owns the fingers — it has to, because a press in
 * the left half of the screen is *reserved for the joystick* the instant it
 * lands. So touch holds arrive via the three optional callbacks added to
 * touch.ts (`onHoldStart/Move/End`): touch.ts watches for a finger stationary
 * within its own TAP_SLOP past 350 ms, offers it here, and if a target
 * resolves we claim the finger — touch.ts releases its joystick/look role the
 * same way `beginPinch` does. The 350 ms of enforced stillness on the touch
 * side IS the hold-commit, so a claimed touch starts progressing immediately.
 *
 * Press → target resolution is by world-radius forgiveness, not pixel hit
 * boxes: the press ray is measured against each target position twice — once
 * as ray-to-point distance (so a press on a shovel's raised handle counts) and
 * once as ground-hit XZ distance (so a press on the sand beside it counts
 * too) — and the smaller wins. A target also has to be within arm's reach of
 * the farmer, or pressing a distant vine from across the beach would clear it;
 * an out-of-reach press degrades to the tap fallthrough, which the opening
 * routes to tap-to-move, so the same gesture walks you over instead.
 *
 * Cancel grammar (refusal, never failure): an early release fires the
 * target's `onCancel` — progress is simply lost, nothing is charged — and
 * *also* degrades to `onTapFallthrough`, so a quick press on something
 * tappable still taps it. While `enabled` is false every listener stands
 * down and legacy input behaves exactly as before the opening existed.
 */

/** Seconds of stationary press before a hold commits and progress starts.
 *  Mirrors the 350 ms the touch side waits (touch.ts HOLD_MS) — both sit
 *  safely under TAP_MS = 480, so nothing that commits could have been a tap. */
const HOLD_COMMIT = 0.35
/** A press that travels further than this before committing is a drag, not a
 *  hold and not a tap. Deliberately equal to touch.ts's TAP_SLOP — one number,
 *  one feel, both devices. */
const HOLD_SLOP_PX = 22
/** How close the farmer must stand for a target to be pressable at all, in
 *  world units from the target's position. Roughly two strides — matches the
 *  reach grammar of the crate (2.2u) and tideline (1.8u) taps with a little
 *  forgiveness for the hold's longer engagement. */
const PLAYER_REACH = 3.4
/** A hold in progress survives a bit more drift than a press needs to start,
 *  so the farmer easing half a step during the strain doesn't drop the vine. */
const BREAK_REACH = PLAYER_REACH + 0.8

/** One live press, mouse or claimed touch finger. */
interface Press {
  x: number
  y: number
  startX: number
  startY: number
  /** Seconds down. Touch presses are born at HOLD_COMMIT — see attachTouch. */
  held: number
  /** Latched once the pointer wandered past HOLD_SLOP_PX pre-commit: the
   *  press is a drag and can no longer become either a hold or a tap. */
  travelled: boolean
  target: HoldTarget | null
  fromTouch: boolean
}

export class HoldInput {
  /** W-INT gates this by beat. False = every listener stands down. */
  enabled = false

  /** Fires when a press ends before hold-commit (or a hold cancels early) and
   *  no target consumed it — the integrator routes this to the tap path. */
  onTapFallthrough?: (clientX: number, clientY: number) => void

  private readonly canvas: HTMLCanvasElement
  private targets: HoldTarget[] = []
  private press: Press | null = null
  private holdingTarget: HoldTarget | null = null
  private candidateTarget: HoldTarget | null = null
  private prog = 0
  private touch: TouchControls | null = null
  /** Farmer position at the last update — reach tests run against this. */
  private readonly playerPos = new THREE.Vector3()
  /** Until the first update() there is no farmer to measure from; reach
   *  checks pass so early staging (tests, jumpTo) cannot deadlock. */
  private playerKnown = false

  constructor(private readonly engine: Engine) {
    this.canvas = engine.renderer.domElement
    window.addEventListener('pointerdown', this.onDown, true)
    window.addEventListener('pointermove', this.onMove, true)
    window.addEventListener('pointerup', this.onUp, true)
    window.addEventListener('pointercancel', this.onUp, true)
  }

  /** Subscribe the three touch callbacks. touch may not exist at construction
   *  time (TouchControls is built later in main.ts's boot), hence the split. */
  attachTouch(touch: TouchControls): void {
    this.touch = touch
    touch.onHoldStart = (x, y) => {
      // A finger that went stationary for 350 ms is offering itself. Claim it
      // only if a target actually resolves — otherwise the finger keeps its
      // joystick/look role and a quick release still taps via onTap.
      if (!this.enabled || this.press) return false
      const target = this.resolve(x, y)
      if (!target) return false
      // The touch side's enforced stillness IS the commit: start holding now.
      this.press = { x, y, startX: x, startY: y, held: HOLD_COMMIT, travelled: false, target, fromTouch: true }
      this.holdingTarget = target
      this.prog = 0
      target.onProgress?.(0)
      return true
    }
    touch.onHoldMove = (x, y) => {
      const p = this.press
      if (p && p.fromTouch) {
        p.x = x
        p.y = y
      }
    }
    touch.onHoldEnd = (commit) => {
      const p = this.press
      // commit=false is a pointercancel — the system stole the touch, so the
      // release was not a deliberate act and must not degrade to a tap.
      if (p && p.fromTouch) this.finish(commit, p.x, p.y)
    }
  }

  /** Swap the live target set. A hold on a target that just vanished cancels
   *  cleanly — staging is idempotent, so beat changes can call this freely. */
  setTargets(targets: HoldTarget[]): void {
    this.targets = targets
    const h = this.holdingTarget
    if (h && !targets.includes(h)) {
      this.holdingTarget = null
      this.prog = 0
      // The press stays down but can no longer become anything.
      if (this.press) this.press.travelled = true
      h.onCancel?.()
    }
    if (this.candidateTarget && !targets.includes(this.candidateTarget)) this.candidateTarget = null
  }

  /** Nearest in-reach target — drives the one contextual prompt. */
  get candidate(): HoldTarget | null {
    return this.candidateTarget
  }

  get holding(): HoldTarget | null {
    return this.holdingTarget
  }

  /** 0..1 while a hold is progressing; 0 otherwise. */
  get progress(): number {
    return this.holdingTarget ? this.prog : 0
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.playerPos.copy(playerPos)
    this.playerKnown = true

    // Candidate: the nearest target the farmer could press right now. Computed
    // from the farmer, not the pointer — it exists to aim the prompt before
    // any press happens.
    let best: HoldTarget | null = null
    let bestD = Infinity
    if (this.enabled) {
      for (const t of this.targets) {
        const d = Math.hypot(playerPos.x - t.pos.x, playerPos.z - t.pos.z)
        if (d <= Math.max(t.radius, PLAYER_REACH) && d < bestD) {
          best = t
          bestD = d
        }
      }
    }
    this.candidateTarget = best

    const p = this.press
    if (p && !this.holdingTarget && !p.fromTouch) {
      p.held += dt
      // Commit: stationary past the threshold with a live, reachable target.
      if (!p.travelled && p.held >= HOLD_COMMIT && p.target && this.targets.includes(p.target) && this.withinReach(p.target, PLAYER_REACH)) {
        this.holdingTarget = p.target
        this.prog = 0
        p.target.onProgress?.(0)
      }
    }

    const h = this.holdingTarget
    if (!h) return

    if (!this.withinReach(h, BREAK_REACH)) {
      // The farmer walked away mid-strain (keyboard can move during a mouse
      // hold). Cancel — and make sure the eventual release is not a tap.
      this.holdingTarget = null
      this.prog = 0
      if (this.press) this.press.travelled = true
      h.onCancel?.()
      return
    }

    this.prog = Math.min(1, this.prog + dt / Math.max(0.001, h.duration))
    h.onProgress?.(this.prog)
    if (this.prog >= 1) {
      // Clear state *before* onComplete: completion handlers commonly call
      // setTargets with the survivor list, and must not see a stale hold.
      this.press = null
      this.holdingTarget = null
      this.prog = 0
      h.onComplete()
    }
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onDown, true)
    window.removeEventListener('pointermove', this.onMove, true)
    window.removeEventListener('pointerup', this.onUp, true)
    window.removeEventListener('pointercancel', this.onUp, true)
    if (this.touch) {
      this.touch.onHoldStart = undefined
      this.touch.onHoldMove = undefined
      this.touch.onHoldEnd = undefined
      this.touch = null
    }
    this.press = null
    this.holdingTarget = null
    this.candidateTarget = null
    this.targets = []
  }

  // --- mouse listeners (capture phase, window) ------------------------------

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return // touch flows through TouchControls
    if (!this.enabled) return
    if (e.target !== this.canvas || e.button !== 0) return
    // From here the press is ours: the legacy pointerdown → interactAt path
    // on the canvas must never see it.
    e.stopPropagation()
    if (this.press) return
    this.press = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      held: 0,
      travelled: false,
      target: this.resolve(e.clientX, e.clientY),
      fromTouch: false,
    }
  }

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const p = this.press
    if (!p || p.fromTouch) return
    p.x = e.clientX
    p.y = e.clientY
    // Slop is judged against the press origin, pre-commit only: once a hold
    // has committed, a rolling fingertip or shaky mouse must not drop it.
    if (!this.holdingTarget && Math.hypot(p.x - p.startX, p.y - p.startY) > HOLD_SLOP_PX) {
      p.travelled = true
    }
  }

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const onCanvas = e.target === this.canvas
    const p = this.press
    if (p && !p.fromTouch) {
      // Only the left button's release (or a cancel) ends the press — a
      // right-click let go mid-hold must not drop the vine.
      if (e.type !== 'pointercancel' && e.button !== 0) return
      if (onCanvas) e.stopPropagation()
      this.finish(e.type !== 'pointercancel', e.clientX, e.clientY)
    } else if (this.enabled && onCanvas && e.button === 0) {
      // A completed hold clears the press before the button comes back up —
      // the trailing release still belongs to the opening, not to legacy.
      e.stopPropagation()
    }
  }

  // --- shared endgame -------------------------------------------------------

  /** End the live press. `clean` = a deliberate release (not a cancel event):
   *  only those may degrade to the tap fallthrough. */
  private finish(clean: boolean, x: number, y: number) {
    const p = this.press
    if (!p) return
    const h = this.holdingTarget
    this.press = null
    this.holdingTarget = null
    this.prog = 0
    if (h) {
      // Early release mid-hold: refusal, never failure — progress is simply
      // lost, and the press degrades to a tap so nothing feels swallowed.
      h.onCancel?.()
      if (clean) this.onTapFallthrough?.(x, y)
    } else if (!p.travelled && clean) {
      this.onTapFallthrough?.(x, y)
    }
  }

  /**
   * World-radius press forgiveness: the press ray measured against each
   * target's position (catches raised geometry like the shovel handle), and
   * the ground hit measured in XZ (catches presses on the sand around it).
   * The smaller distance is compared to the target's own radius.
   */
  private resolve(clientX: number, clientY: number): HoldTarget | null {
    const ground = pickGround(this.engine, clientX, clientY)
    let best: HoldTarget | null = null
    let bestD = Infinity
    for (const t of this.targets) {
      let d = rayDistanceToPoint(this.engine, clientX, clientY, t.pos)
      if (ground) {
        const g = Math.hypot(ground.x - t.pos.x, ground.z - t.pos.z)
        if (g < d) d = g
      }
      if (d <= t.radius && d < bestD && this.withinReach(t, PLAYER_REACH)) {
        best = t
        bestD = d
      }
    }
    return best
  }

  private withinReach(t: HoldTarget, reach: number) {
    if (!this.playerKnown) return true
    return Math.hypot(this.playerPos.x - t.pos.x, this.playerPos.z - t.pos.z) <= reach
  }
}
