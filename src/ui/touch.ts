import { Input } from '../core/input'
import type { Engine } from '../core/engine'
import { pinchStep, PINCH_COMMIT, type Touch } from './pinch'

/**
 * Touch controls, Grow a Garden style: the screen is split down the middle.
 *
 *   left half   a floating movement joystick that spawns *under the finger* —
 *               no fixed pad to hunt for with a thumb
 *   right half  drag to orbit the camera, exactly like right-mouse look
 *   two fingers pinch to zoom, matching the mouse wheel
 *
 * Taps still interact. The subtlety is that a drag and a tap start with the
 * same event, so touches never trigger the click path on pointerdown the way
 * a mouse does — instead a touch that ends quickly, without wandering, fires
 * the `onTap` callback from pointerup. Anything that moved or lingered was a
 * joystick pull, camera swipe, or pinch, and eats the tap.
 *
 * The joystick writes into Input.touchAxis rather than driving the player
 * directly, so the movement code keeps exactly one input path — keyboard and
 * thumb merge inside Input.moveAxis, and everything downstream (camera-relative
 * steering, click-cancel, modal locks) works untouched.
 */

/** Knob travel radius, CSS pixels. Also the drag distance that maxes speed. */
const STICK_RADIUS = 56
/**
 * A touch that moves further than this is a drag, not a tap.
 *
 * Twelve pixels is a *mouse* number. A thumb has a contact patch a centimetre
 * across and rolls as it presses, so a perfectly deliberate tap routinely
 * travels further than that — and every one of those was being discarded as a
 * camera swipe, which is what "tapping a plot does nothing" actually was. This
 * is close to the platform touch slop, and the joystick does not suffer for it
 * because the stick only engages past the same threshold.
 */
const TAP_SLOP = 22
/**
 * A touch held longer than this is not a tap, whatever it did.
 *
 * Also raised: 350ms is brisk for someone aiming at a plot they can barely see
 * past their own hand, and an over-careful tap should not be silently dropped.
 * Kept under the 500ms that usually means a long-press so it cannot swallow one
 * later.
 */
const TAP_MS = 480
const LOOK_SENSITIVITY = 0.0058
/**
 * A finger stationary within TAP_SLOP past this long is offered to the hold
 * system (see onHoldStart below). 350ms is safely under nothing — TAP_MS = 480
 * already refuses to call such a touch a tap, and the joystick/look roles only
 * engage on travel, so a still finger this old was in limbo anyway.
 */
const HOLD_MS = 350


export class TouchControls {
  /** Fired for qualifying taps anywhere; replaces the mouse click path. */
  onTap: ((clientX: number, clientY: number) => void) | null = null

  /**
   * The opening's hold gesture, subscribed by HoldInput.attachTouch.
   *
   * A finger that stays within TAP_SLOP for HOLD_MS is *offered* via
   * onHoldStart. Returning true claims it: its joystick/look role is released
   * for that pointer — mirroring beginPinch's role-dropping — and it can no
   * longer become a tap; onHoldMove then streams its position and onHoldEnd
   * reports the release (`commit` false only for a pointercancel, where the
   * system stole the touch and the release was not a deliberate act).
   * Returning false leaves the finger exactly as it was — unclaimed fingers
   * behave as if these callbacks did not exist.
   */
  onHoldStart?: (x: number, y: number) => boolean
  onHoldMove?: (x: number, y: number) => void
  onHoldEnd?: (commit: boolean) => void

  /** Pointer id claimed by a hold. -1 = none. Same shape as movePointer. */
  private holdPointer = -1
  /** Pending HOLD_MS timers, one per candidate finger, cleared on end. */
  private readonly holdTimers = new Map<number, number>()

  private readonly base: HTMLDivElement
  private readonly knob: HTMLDivElement

  /** Pointer ids claimed by each role. -1 = unclaimed. */
  private movePointer = -1
  private lookPointer = -1

  private originX = 0
  private originY = 0
  /**
   * Whether the left-hand finger has actually become a joystick yet.
   *
   * Claiming the role on touch-down is right — the finger has to be reserved
   * before anything else can take it — but *engaging* it there is not: a tap on
   * a plot in the left half of the screen popped the stick under the thumb and
   * nudged the farmer, for a gesture that turned out to be a tap. The stick
   * appears once the thumb has travelled far enough to not be a tap.
   */
  private stickLive = false

  private lastLookX = 0
  private lastLookY = 0

  /**
   * Every live touch, each judged for taphood on its own.
   *
   * These used to be four fields shared by all fingers, which is what made a
   * tap-while-walking impossible: the second finger's press was measured
   * against the *first* finger's start point, so a thumb parked on the joystick
   * marked every other touch as "moved" and ate its tap.
   */
  private readonly pointers = new Map<number, Touch>()
  private pinching = false
  private pinchDist = 0
  /** Banked cooperative radial travel. See PINCH_COMMIT. */
  private pinchScore = 0

  constructor(private readonly engine: Engine) {
    this.base = document.createElement('div')
    this.base.id = 'stickBase'
    this.knob = document.createElement('div')
    this.knob.id = 'stickKnob'
    this.base.appendChild(this.knob)
    document.getElementById('ui')!.appendChild(this.base)

    const canvas = engine.renderer.domElement

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        moved: false,
      })

      /*
       * A second finger only *arms* a pinch; it does not start one.
       *
       * Committing here was the bug behind all three complaints. It stole the
       * joystick mid-stride, it made walking and looking at once impossible
       * (two thumbs is two pointers), and it swallowed the tap — so trying to
       * harvest while moving stopped the farmer and did nothing. Arming instead
       * costs nothing until the fingers actually spread or close.
       */
      if (this.pointers.size === 2) this.pinchScore = 0

      if (e.clientX < innerWidth / 2 && this.movePointer === -1) {
        this.movePointer = e.pointerId
        this.originX = e.clientX
        this.originY = e.clientY
        // Reserved, not yet engaged — see stickLive.
        this.stickLive = false
      } else if (this.lookPointer === -1) {
        this.lookPointer = e.pointerId
        this.lastLookX = e.clientX
        this.lastLookY = e.clientY
      }

      // Arm the hold offer. The timer fires only if the finger is still down,
      // still still, and nothing else (pinch, another hold) has taken it.
      if (this.onHoldStart && this.holdPointer === -1) {
        const id = e.pointerId
        this.holdTimers.set(id, window.setTimeout(() => this.tryBeginHold(id), HOLD_MS))
      }
    })

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return
      const pt = this.pointers.get(e.pointerId)
      if (!pt) return
      pt.x = e.clientX
      pt.y = e.clientY
      if (Math.hypot(e.clientX - pt.startX, e.clientY - pt.startY) > TAP_SLOP) pt.moved = true

      // A claimed hold finger belongs entirely to the hold system: it has no
      // joystick/look role left to drive, and it must not feed a pinch score.
      if (e.pointerId === this.holdPointer) {
        this.onHoldMove?.(e.clientX, e.clientY)
        return
      }

      if (this.pinching) {
        this.updatePinch()
        return
      }

      // Armed but not committed: are both fingers pulling along the same line?
      // Never while a hold owns a finger — a strain-hold plus a stray second
      // finger must not zoom the camera out from under the gesture.
      if (this.holdPointer === -1 && this.pointers.size === 2 && this.scorePinch()) {
        this.beginPinch()
        return
      }

      if (e.pointerId === this.movePointer) {
        const dx = e.clientX - this.originX
        const dy = e.clientY - this.originY
        const len = Math.hypot(dx, dy)
        // Below the tap threshold this is still a tap in progress; showing the
        // stick now is what made every plot tap twitch the farmer.
        if (!this.stickLive) {
          if (len <= TAP_SLOP) return
          this.stickLive = true
          this.showStick(this.originX, this.originY)
        }
        const clamped = Math.min(len, STICK_RADIUS)
        const nx = len > 0 ? (dx / len) * clamped : 0
        const ny = len > 0 ? (dy / len) * clamped : 0
        this.knob.style.transform = `translate(${nx}px, ${ny}px)`
        // Screen-up is forward, matching W — moveAxis y is +forward.
        Input.setTouchAxis((nx / STICK_RADIUS) * 1, -(ny / STICK_RADIUS) * 1)
      } else if (e.pointerId === this.lookPointer) {
        const dx = e.clientX - this.lastLookX
        const dy = e.clientY - this.lastLookY
        this.lastLookX = e.clientX
        this.lastLookY = e.clientY
        this.engine.touchLook(dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY)
      }
    })

    const end = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const pt = this.pointers.get(e.pointerId)
      this.pointers.delete(e.pointerId)

      // A finger that lifts before HOLD_MS was never offered; kill its timer.
      const holdTimer = this.holdTimers.get(e.pointerId)
      if (holdTimer !== undefined) {
        clearTimeout(holdTimer)
        this.holdTimers.delete(e.pointerId)
      }
      if (e.pointerId === this.holdPointer) {
        this.holdPointer = -1
        // pointercancel means the system stole the touch — not a release.
        this.onHoldEnd?.(e.type !== 'pointercancel')
      }

      if (this.pinching && this.pointers.size < 2) {
        this.pinching = false
        this.pinchDist = 0
      }
      // Whichever finger is left starts a fresh score against its next partner.
      this.pinchScore = 0

      if (e.pointerId === this.movePointer) {
        this.movePointer = -1
        this.stickLive = false
        Input.setTouchAxis(0, 0)
        this.base.style.display = 'none'
      }
      if (e.pointerId === this.lookPointer) this.lookPointer = -1

      /*
       * A quick, still touch is a tap — the mobile equivalent of the click.
       *
       * Judged per finger. This used to bail out for *every* finger the moment
       * two were down, so a tap to harvest while the other thumb held the stick
       * was discarded. A committed pinch marks its fingers as moved (see
       * beginPinch), which is what still keeps a zoom from ending in a tap.
       */
      if (pt && !pt.moved && performance.now() - pt.startTime < TAP_MS) {
        this.onTap?.(e.clientX, e.clientY)
      }
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)

    // The browser must not scroll, zoom or long-press-menu the game surface.
    canvas.style.touchAction = 'none'
  }

  /**
   * Bank this frame's cooperative radial motion; true once it commits.
   *
   * Reads both fingers rather than the one whose event this is: displacement
   * comes from each finger's own last sample, so a stationary partner
   * contributes an honest zero instead of being skipped. See pinchStep.
   */
  private scorePinch() {
    const pts = [...this.pointers.values()]
    if (pts.length < 2) return false
    const [a, b] = pts

    this.pinchScore = pinchStep(this.pinchScore, a, b)
    for (const pt of [a, b]) {
      pt.lastX = pt.x
      pt.lastY = pt.y
    }
    return Math.abs(this.pinchScore) >= PINCH_COMMIT
  }

  /**
   * The HOLD_MS timer landed: offer this finger to the hold system.
   *
   * Everything is re-checked at fire time because 350ms is forever in touch
   * terms — the finger may have lifted, wandered into a drag, joined a pinch,
   * or lost the race to another finger's hold. Only a finger that is still
   * down and still still gets offered, and only a *claimed* one (onHoldStart
   * returning true) loses its roles — the same drops beginPinch performs, so
   * the stick never fights the strain pose for the thumb.
   */
  private tryBeginHold(id: number) {
    this.holdTimers.delete(id)
    const pt = this.pointers.get(id)
    if (!pt || pt.moved || this.pinching || this.holdPointer !== -1) return
    if (!this.onHoldStart?.(pt.x, pt.y)) return

    this.holdPointer = id
    // A claimed finger can never end in a tap — the hold system owns its
    // release grammar, including the degrade-to-tap on early cancel.
    pt.moved = true
    if (this.movePointer === id) {
      this.movePointer = -1
      this.stickLive = false
      Input.setTouchAxis(0, 0)
      this.base.style.display = 'none'
    }
    if (this.lookPointer === id) this.lookPointer = -1
  }

  private beginPinch() {
    this.pinching = true
    // Neither finger can still become a tap once they have pinched.
    for (const pt of this.pointers.values()) pt.moved = true
    // Drop single-finger roles so the stick/look don't fight the pinch.
    if (this.movePointer !== -1) {
      this.movePointer = -1
      this.stickLive = false
      Input.setTouchAxis(0, 0)
      this.base.style.display = 'none'
    }
    this.lookPointer = -1
    /*
     * Baseline is the separation *now*, not when the fingers landed. Zooming
     * from the original would apply the whole slop distance as one jump the
     * instant the gesture is recognised, which reads as the camera snapping.
     */
    this.pinchDist = this.fingerDistance()
  }

  private updatePinch() {
    const d = this.fingerDistance()
    if (d < 8 || this.pinchDist < 8) {
      this.pinchDist = d
      return
    }
    this.engine.touchZoom(this.pinchDist / d)
    this.pinchDist = d
  }

  private fingerDistance() {
    const pts = [...this.pointers.values()]
    if (pts.length < 2) return 0
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }

  private showStick(x: number, y: number) {
    this.base.style.display = 'block'
    this.base.style.left = `${x}px`
    this.base.style.top = `${y}px`
    this.knob.style.transform = 'translate(0px, 0px)'
  }
}
