import * as THREE from 'three'
import { groundHeight } from '../terrain'
import { ball } from '../../assets/style'
import type { Obstacle } from '../world'
import type { HoldTarget } from './types'
import {
  createOpeningCrate,
  createOpeningShovel,
  createSeedPouch,
} from '../../assets/opening/beach-models'

/**
 * The two staged props of the opening's first minutes: the crate the seeds
 * arrive in and the shovel buried in the sand.
 *
 * Both are one-shot narrative furniture, not systems. The crate is a tap —
 * the first discrete act of the game — and the shovel is a hold, the first
 * shaping gesture, deliberately the iconic one: drawing the tool out of the
 * earth. This class owns their placement, their little animations (lid creak,
 * pouch lift, strain lean, pop-free) and their opened/pulled state; the
 * integrator owns everything that *results* (granting seeds, birthing the
 * satchel, handing the player the tool, startling the tern) via the two
 * callbacks, so no inventory or UI code leaks in here.
 *
 * State is intentionally re-derivable: `restore()` snaps either prop to its
 * consumed pose with no callbacks and no animation, so a mid-opening reload
 * or a dev `jumpTo` can replay beat staging idempotently (contract §3.1).
 */

/** Contract coordinates (§4.1): three units up-beach from the wake spot. */
const CRATE_X = -54.5
const CRATE_Z = 8.5
/** Ten steps inland from the crate, on the way toward the treeline. */
const SHOVEL_X = -49
const SHOVEL_Z = 3.5

/** Tap-open forgiveness around the crate (contract §2.5). */
const CRATE_TAP_RANGE = 2.2
/** Hold-target press forgiveness around the shovel. */
const SHOVEL_RADIUS = 2.0
/** Seconds of held press to draw the shovel free (contract §2.5). */
const SHOVEL_HOLD_SECONDS = 1.4

/** The shovel juts from the sand at 30° off vertical (spec beat 3). */
const SHOVEL_TILT = Math.PI / 6
/**
 * How far the buried blade sits below its handle-up resting height.
 *
 * Raised with the model: the shovel is now ~1.3 units tip to grip, and burying
 * it by the old 0.45 left the collar and half the blade above the sand, which
 * reads as *dropped* rather than as driven in. At this depth the sand line
 * cuts across the iron just under the collar — blade in the earth, olive-wood
 * grip up in the dawn light, which is the shot beat 3 is written around.
 */
const SHOVEL_SINK = 0.68
/** Dry sand, but shaded — the mound is displaced, still-damp sand. */
const SAND_MOUND = 0xdccbaa
const SAND_MOUND_SHADE = 0xc4b394
/** Seconds of pop-free animation before the world shovel disappears. */
const POP_TIME = 0.3

/** Lid swings ~0.55 s (see beach-models) — pouch waits for it, then rises. */
const POUCH_DELAY = 0.45
const POUCH_RISE_TIME = 0.75
/** Raised with the crate walls (0.64 → 0.86) so the pouch clears the rim by a
 *  clear margin instead of peeking over it. */
const POUCH_RISE_HEIGHT = 1.18

export class BeachProps {
  /** World position of the crate, on the ground (y = groundHeight). */
  readonly cratePos: THREE.Vector3
  /** World position of the shovel's burial spot, on the ground. */
  readonly shovelPos: THREE.Vector3

  private readonly scene: THREE.Group
  private readonly crate: ReturnType<typeof createOpeningCrate>
  private readonly pouch: THREE.Group
  private readonly shovel: THREE.Group
  private readonly shovelBaseY: number

  private _crateOpened = false
  private _shovelPulled = false

  /** 'shut' → tap → 'opening' (lid + pouch lift) → 'open'. */
  private crateState: 'shut' | 'opening' | 'open' = 'shut'
  /** Time since the crate was tapped; the pouch rises after POUCH_DELAY. */
  private pouchClock = 0

  /** Smoothed 0..1 strain while the hold is in progress; eases back on cancel. */
  private strain = 0
  private strainTarget = 0
  /** −1 = not popping; otherwise seconds into the pop-free animation. */
  private popClock = -1

  /** Stable HoldTarget identity — HoldInput compares candidates by object. */
  private holdTarget: HoldTarget | null = null

  /** W-INT: grant Sun Tomato ×6 + mystery seed, bornSatchel from this point. */
  onCrateOpened?: (pouchWorldPos: THREE.Vector3) => void
  /** W-INT: hand the player the tool, startle the tern, sand-sluff burst. */
  onShovelPulled?: (at: THREE.Vector3) => void

  constructor(scene: THREE.Group, obstacles: Obstacle[]) {
    this.scene = scene
    this.cratePos = new THREE.Vector3(CRATE_X, groundHeight(CRATE_X, CRATE_Z), CRATE_Z)
    this.shovelPos = new THREE.Vector3(SHOVEL_X, groundHeight(SHOVEL_X, SHOVEL_Z), SHOVEL_Z)

    /*
     * The crate, half-buried where it washed in: sunk a hand's width into the
     * sand and heeled over a few degrees on two axes. A prop sitting perfectly
     * flat on a beach reads as *placed*; this one has to read as *arrived*.
     */
    this.crate = createOpeningCrate()
    this.crate.root.position.copy(this.cratePos).y -= 0.22
    this.crate.root.rotation.set(-0.06, -0.6, 0.1)
    scene.add(this.crate.root)

    // Solid enough to lean on: one collider, never spliced (world.ts rule).
    obstacles.push({ x: CRATE_X, z: CRATE_Z, r: 1.0 })

    /*
     * Sand banked against the crate's uphill side. A half-buried object with
     * no drift around it looks like it was set down and sunk straight through;
     * the drift is what says the beach has been working on it.
     */
    for (const drift of [
      { dx: -0.55, dz: -0.5, r: 0.62, s: 0.24, c: SAND_MOUND },
      { dx: 0.7, dz: 0.35, r: 0.5, s: 0.2, c: SAND_MOUND_SHADE },
      { dx: 0.1, dz: -0.7, r: 0.44, s: 0.17, c: SAND_MOUND },
    ]) {
      const heap = ball(drift.r, drift.c, 1)
      heap.scale.set(1.3, drift.s, 1.1)
      heap.castShadow = false
      heap.position.set(
        CRATE_X + drift.dx,
        groundHeight(CRATE_X + drift.dx, CRATE_Z + drift.dz) - drift.r * drift.s * 0.45,
        CRATE_Z + drift.dz,
      )
      scene.add(heap)
    }

    /*
     * The pouch starts inside the crate (a child, so the crate's tilt carries
     * it) and is invisible until the lid opens — the interior shadow hides
     * the swap. It lifts along the crate's local up, which on a tilted crate
     * looks *more* natural than a plumb rise, not less.
     */
    this.pouch = createSeedPouch()
    this.pouch.position.set(0, 0.16, 0.05)
    this.pouch.visible = false
    this.crate.root.add(this.pouch)

    /*
     * The shovel, blade-down at 30°. The model's origin is mid-shaft with the
     * blade tip at local −0.71, so raising the group and tilting it buries
     * the blade and leaves the olive-wood grip catching the dawn light.
     */
    this.shovel = createOpeningShovel()
    this.shovelBaseY = this.shovelPos.y + SHOVEL_SINK
    this.shovel.position.set(SHOVEL_X, this.shovelBaseY, SHOVEL_Z)
    this.shovel.rotation.set(0.06, 0.8, SHOVEL_TILT)
    scene.add(this.shovel)

    /*
     * The sand mound at the shovel's base.
     *
     * Two jobs. It sells the burial — a shaft entering flat sand looks stuck
     * through a floor, whereas a shaft entering a heap looks driven — and it
     * doubles the prop's footprint on screen, which is what actually makes a
     * thing ten steps away worth walking to. Flattened balls, no shadow
     * casting (they are ground, and a mound that casts on itself goes muddy),
     * offset down the tilt so the heap piles on the leaning side.
     */
    const lean = new THREE.Vector2(Math.sin(SHOVEL_TILT), 0).rotateAround(
      new THREE.Vector2(),
      -0.8,
    )
    for (const clump of [
      { dx: 0, dz: 0, r: 0.78, s: 0.3, c: SAND_MOUND },
      { dx: lean.x * 1.6, dz: lean.y * 1.6, r: 0.5, s: 0.22, c: SAND_MOUND_SHADE },
      { dx: -0.45, dz: 0.5, r: 0.42, s: 0.2, c: SAND_MOUND },
      { dx: 0.5, dz: -0.42, r: 0.34, s: 0.18, c: SAND_MOUND_SHADE },
    ]) {
      const x = SHOVEL_X + clump.dx
      const z = SHOVEL_Z + clump.dz
      const heap = ball(clump.r, clump.c, 1)
      heap.scale.set(1.25, clump.s, 1.15)
      heap.castShadow = false
      heap.position.set(x, groundHeight(x, z) - clump.r * clump.s * 0.35, z)
      scene.add(heap)
    }
  }

  get crateOpened() {
    return this._crateOpened
  }

  get shovelPulled() {
    return this._shovelPulled
  }

  /**
   * Tap handler; opens if the player is within reach of the shut crate.
   * Returns whether the tap was consumed (so the router can fall through to
   * tap-to-move when it wasn't).
   *
   * `crateOpened` flips immediately — the *act* is the tap; the pouch lift
   * and the seed grant (onCrateOpened) are presentation that follows.
   */
  tapCrate(playerPos: THREE.Vector3): boolean {
    if (this._crateOpened) return false
    if (Math.hypot(playerPos.x - CRATE_X, playerPos.z - CRATE_Z) > CRATE_TAP_RANGE) return false
    this._crateOpened = true
    this.crateState = 'opening'
    this.pouchClock = 0
    this.crate.openLid()
    return true
  }

  /**
   * The first hold gesture in the game. One stable target object for the
   * shovel's whole life; null once it has been pulled.
   */
  shovelHoldTarget(): HoldTarget | null {
    if (this._shovelPulled) return null
    if (!this.holdTarget) {
      this.holdTarget = {
        id: 'shovel',
        kind: 'shovel',
        pos: this.shovelPos,
        radius: SHOVEL_RADIUS,
        duration: SHOVEL_HOLD_SECONDS,
        verb: 'pull',
        onProgress: (t) => {
          this.strainTarget = t
        },
        onComplete: () => this.pull(),
        onCancel: () => {
          this.strainTarget = 0
        },
      }
    }
    return this.holdTarget
  }

  private pull() {
    if (this._shovelPulled) return
    this._shovelPulled = true
    this.holdTarget = null
    this.strainTarget = 0
    this.popClock = 0
    // Fire now, at commit: the integrator puts the tool in the player's hands
    // while the world copy plays its brief pop-free and vanishes.
    this.onShovelPulled?.(this.shovelPos.clone())
  }

  update(dt: number, elapsed: number) {
    this.crate.update(dt)

    // Pouch lift: wait out the lid creak, then rise, spin gently, hand off.
    if (this.crateState === 'opening') {
      this.pouchClock += dt
      const t = (this.pouchClock - POUCH_DELAY) / POUCH_RISE_TIME
      if (t >= 0) {
        this.pouch.visible = true
        const k = Math.min(1, t)
        const ease = 1 - Math.pow(1 - k, 3)
        this.pouch.position.y = 0.16 + ease * POUCH_RISE_HEIGHT
        this.pouch.rotation.y += dt * 2.4
        if (k >= 1) {
          const at = new THREE.Vector3()
          this.pouch.getWorldPosition(at)
          this.crate.root.remove(this.pouch)
          this.crateState = 'open'
          // Handover to the DOM fly-to — the 3D pouch's job ends here.
          this.onCrateOpened?.(at)
        }
      }
    }

    // Strain lean while the hold is in progress; eases home on release.
    if (!this._shovelPulled) {
      this.strain += (this.strainTarget - this.strain) * Math.min(1, dt * 10)
      const s = this.strain
      // The shaft levers toward vertical and lifts as if coming loose...
      this.shovel.rotation.z = SHOVEL_TILT * (1 - 0.45 * s)
      this.shovel.position.y = this.shovelBaseY + s * 0.1
      // ...with a fine tremor that sells the two-handed effort.
      this.shovel.rotation.x = 0.06 + Math.sin(elapsed * 42) * 0.02 * s
    }

    // Pop-free: a quick rise-and-right, then the world copy is gone.
    if (this.popClock >= 0) {
      this.popClock += dt
      const k = Math.min(1, this.popClock / POP_TIME)
      this.shovel.position.y = this.shovelBaseY + 0.1 + k * 0.7
      this.shovel.rotation.z = SHOVEL_TILT * 0.55 * (1 - k)
      this.shovel.rotation.x = 0.06 * (1 - k)
      if (k >= 1) {
        this.scene.remove(this.shovel)
        this.popClock = -1
      }
    }
  }

  /**
   * Snap either prop to its consumed pose with no animation and no callbacks
   * — for resumed saves and dev jumps. Safe to call repeatedly.
   */
  restore(state: { crate: boolean; shovel: boolean }) {
    if (state.crate && this.crateState !== 'open') {
      this._crateOpened = true
      this.crateState = 'open'
      // Fast-forward the lid past its whole swing; remove the pouch quietly.
      this.crate.openLid()
      this.crate.update(10)
      this.crate.root.remove(this.pouch)
    }
    if (state.shovel && !this._shovelPulled) {
      this._shovelPulled = true
      this.holdTarget = null
      this.popClock = -1
      this.scene.remove(this.shovel)
    }
  }
}
