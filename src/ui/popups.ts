import * as THREE from 'three'
import type { Engine } from '../core/engine'

/**
 * World-anchored floating text — "+🪙975", "Level up!", "🌈 RAINBOW".
 *
 * These are DOM elements projected to screen space rather than sprites,
 * because text as geometry needs a font atlas and would still look worse than
 * the browser's own text rendering. The cost is one matrix project per popup
 * per frame, which is nothing at the handful that are ever on screen.
 *
 * Popups are the single cheapest way to make a game feel responsive: the
 * player gets an immediate, legible confirmation at the exact spot they acted.
 */

interface Popup {
  el: HTMLElement
  /** World position it is anchored to. */
  anchor: THREE.Vector3
  /** Seconds alive. */
  age: number
  life: number
  /** Upward drift in world units per second. */
  rise: number
  /** Horizontal scatter so a burst of popups doesn't overlap into mush. */
  drift: number
  /** Screen-space stack offset, in px — see the queueing note in spawn(). */
  stack: number
  /**
   * Measured height of the plate, in px.
   *
   * Stacking has to know it. Popups are plates that wrap at 260px, so a long
   * mutated name ("Windswept Moonlit Wet Corn") is two lines and half again as
   * tall as a coin readout — a fixed rung sized for the short one is guaranteed to
   * be too small for the tall one.
   */
  height: number
}

/** Clear air between stacked plates, px. */
const STACK_GAP = 6
/**
 * Peak of the pop-in overshoot, shared by the animation and the stacking.
 *
 * They have to agree. `offsetHeight` measures the unscaled box, but the plate is
 * drawn through a transform that overshoots to this before settling — so a 57px
 * plate briefly occupies 63px, and a stack that reserved only 57 let the next one
 * clip its top corner. Held as one constant so tuning the bounce cannot silently
 * reintroduce the overlap.
 */
const POP_PEAK = 1.1
/**
 * How far up a cluster may climb before new arrivals restart at the anchor.
 *
 * Only reachable by a pathological spree; without it a long enough burst walks
 * the stack off the top of the screen, which is worse than overlapping.
 */
const MAX_STACK = 320

const projected = new THREE.Vector3()

export class Popups {
  private readonly root: HTMLDivElement
  private readonly active: Popup[] = []

  constructor(private readonly engine: Engine) {
    this.root = document.createElement('div')
    this.root.id = 'popups'
    document.getElementById('ui')!.appendChild(this.root)
  }

  /**
   * Spawn floating text at a world position.
   * `kind` drives the styling — big gold text for a rare find, plain for a
   * routine harvest.
   */
  spawn(
    text: string,
    at: THREE.Vector3,
    kind: 'normal' | 'good' | 'rare' | 'epic' = 'normal',
    life = 1.5,
    /**
     * Extra class for popups that are a card rather than a line of text.
     *
     * Passed in rather than sniffed from the markup: the plate needs a wider
     * box and a squarer radius than the pill does, and a `:has()` rule keyed on
     * the content would make the container's shape depend on what happens to be
     * inside it — which is exactly the sort of thing that quietly breaks when a
     * caller adds a `<div>`.
     */
    variant = '',
  ) {
    const el = document.createElement('div')
    el.className = `popup popup-${kind}${variant ? ` ${variant}` : ''}`
    el.innerHTML = text
    this.root.appendChild(el)

    /*
     * Stack, don't stamp. A single harvest legitimately fires several popups at
     * the same tile (value, mutation label, weight record) in one frame, and
     * random drift alone left them printed through each other.
     *
     * A new plate is placed *above the top edge of the tallest one already at this
     * anchor*, measured rather than assumed. Two earlier bugs are why it works this
     * way:
     *
     *  - It used to count the live popups and multiply by a flat 44px. Counting
     *    recycles a rung the moment an older popup expires, so with two on screen
     *    and the first gone, the next arrival was handed the rung the second was
     *    still sitting on. Reading the occupied heights cannot collide.
     *  - 44px is fine for a one-line coin readout and too small for a two-line
     *    mutated name, which is exactly the pair that overlapped.
     *
     * `offsetHeight` forces a layout, which is why it is read once here on spawn
     * and cached, not per frame.
     */
    // Scaled by the overshoot, because that is the tallest the plate ever draws.
    const height = (el.offsetHeight || 32) * POP_PEAK
    /*
     * Half of each height, not the full height of the one below.
     *
     * Plates are centred on their position by `translate(-50%, -50%)`, so each
     * extends half its height either side. Spacing by the lower plate's full height
     * is only sufficient while the upper one is no taller — put a two-line epic
     * above a one-line coin readout and it overlaps by half the difference, which
     * is exactly the ~25px seen with a 93px plate stacked on a 32px one.
     */
    let stack = 0
    let below: Popup | null = null
    for (const p of this.active) {
      if (p.anchor.distanceToSquared(at) < 2.25) {
        const top = p.stack + p.height / 2 + height / 2 + STACK_GAP
        if (top >= stack) {
          stack = top
          below = p
        }
      }
    }
    if (stack > MAX_STACK) {
      stack = 0
      below = null
    }

    this.active.push({
      el,
      anchor: at.clone(),
      age: 0,
      life,
      /*
       * A stacked plate rises at exactly the rate of the one beneath it.
       *
       * The offsets that separate a cluster are in screen px, but the rise is in
       * world units — so giving each plate its own random speed let them converge
       * as they climbed. Spacing was correct for the first few frames and then
       * closed up, which is what made a harvest look fine and then clump. One rate
       * per cluster keeps it rigid the whole way up.
       */
      rise: below ? below.rise : 1.1 + Math.random() * 0.5,
      // Stacked plates stay on the anchor's centre line — drifting them sideways
      // as well turns a tidy list into a ragged scatter.
      drift: stack > 0 ? 0 : (Math.random() - 0.5) * 0.7,
      stack,
      height,
    })

    // A runaway harvest spree should not accumulate hundreds of nodes.
    while (this.active.length > 24) this.remove(0)
  }

  private remove(index: number) {
    const popup = this.active[index]
    popup.el.remove()
    this.active.splice(index, 1)
  }

  update(dt: number) {
    const camera = this.engine.camera
    const halfW = innerWidth / 2
    const halfH = innerHeight / 2

    for (let i = this.active.length - 1; i >= 0; i--) {
      const popup = this.active[i]
      popup.age += dt

      if (popup.age >= popup.life) {
        this.remove(i)
        continue
      }

      const t = popup.age / popup.life

      projected.copy(popup.anchor)
      projected.x += popup.drift * t
      projected.y += popup.rise * t
      projected.project(camera)

      // Behind the camera: hide rather than mirroring it to the wrong side.
      if (projected.z > 1) {
        popup.el.style.display = 'none'
        continue
      }
      popup.el.style.display = ''

      const x = projected.x * halfW + halfW
      const y = -projected.y * halfH + halfH - popup.stack

      // Pop in fast, hold, then fade — the hold is what makes it readable.
      const scale =
        t < 0.14
          ? 0.5 + (t / 0.14) * (POP_PEAK - 0.5)
          : POP_PEAK - Math.min(1, (t - 0.14) / 0.86) * 0.1
      const opacity = t < 0.1 ? t / 0.1 : t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1

      popup.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`
      popup.el.style.opacity = String(opacity)
    }
  }
}

/**
 * Short camera shake. Applied as an offset to the camera's focus, so it decays
 * naturally with the existing follow smoothing.
 */
export class Shake {
  private amount = 0
  private readonly offset = new THREE.Vector3()

  add(strength: number) {
    this.amount = Math.min(1.2, this.amount + strength)
  }

  update(dt: number, elapsed: number) {
    this.amount = Math.max(0, this.amount - dt * 2.2)
    if (this.amount <= 0) {
      this.offset.set(0, 0, 0)
      return this.offset
    }
    // Two incommensurate frequencies so the shake never looks like a loop.
    const a = this.amount * this.amount
    this.offset.set(
      Math.sin(elapsed * 41) * a * 0.16,
      Math.sin(elapsed * 37) * a * 0.11,
      Math.cos(elapsed * 29) * a * 0.16,
    )
    return this.offset
  }
}
