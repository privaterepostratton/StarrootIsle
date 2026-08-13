import * as THREE from 'three'
import { groundHeight } from '../terrain'
import { ball, cyl } from '../../assets/style'
import { createGoatModel, GOAT_BODY_Y, type GoatRig } from '../../assets/opening/goat-model'

/**
 * Beat 9 — the arrival. The opening's cliffhanger.
 *
 * A scripted phase machine drives the hero goat from a treeline rustle to a
 * one-second look-at-the-player and back into the green. Everything is
 * transform-based on the procedural rig (crab/pasture school): leg swing,
 * head dips, body bob, weight shifts — no mixer, no clips.
 *
 * Choreography intent, in spec order:
 *   rustle  2.0 s  audio-first anticipation (onRustle fires at the treeline
 *                  BEFORE anything is visible — the ear finds the goat first)
 *   emerge  2.5 s  steps out of the treeline gap, checks the coast
 *   walk     var   cautious approach to the nearest bed along a bowed path —
 *                  short bursts with freeze-and-glance pauses, head low
 *   sniff   1.2 s  nose to the plant, small investigative bobs
 *   eat     2.0 s  eats one tomato (onEat — the PLANT REMAINS; the farm is
 *                  never mutated; this is a gift to the goat, not a loss)
 *   look    1.0 s  THE moment. Body freezes dead — breathing only — while
 *                  head and ears lock onto the player. Being seen.
 *   bleat   0.6 s  one head-toss bleat
 *   bound    var   arcing hops back into the treeline, gone
 *
 * The return visit (session 2) runs the same loop and leaves a tuft of coat
 * snagged at the treeline — the want-loop's first physical token.
 *
 * Nothing here costs, expires, punishes, or renders text.
 */

export type GoatPhase =
  | 'idle' | 'rustle' | 'emerge' | 'walk' | 'sniff' | 'eat' | 'look' | 'bleat' | 'bound' | 'done'

/** Treeline gap the goat materialises from (contract §4.1). */
const TREELINE = new THREE.Vector2(-26, -7)
/** Start of the emerge slide: a body-length deeper into the jungle (+x). */
const EMERGE_FROM = new THREE.Vector2(-24.6, -8.1)
/** Where the emerge ends: just clear of the treeline, facing the beds. */
const EMERGE_TO = new THREE.Vector2(-26.9, -6.1)
/** Bound-away exit — offset from the entrance so it reads as wild pathing. */
const EXIT = new THREE.Vector2(-24.3, -8.7)
/** Where the return-visit coat tuft snags, near the exit, collectable. */
const TUFT_POS = new THREE.Vector2(-25.3, -7.7)

// Contract-exact phase timings (seconds).
const RUSTLE_S = 2.0
const EMERGE_S = 2.5
const SNIFF_S = 1.2
const EAT_S = 2.0
const LOOK_S = 1.0
const BLEAT_S = 0.6

/** Cautious approach speed — a browse, not a trot. */
const WALK_SPEED = 1.05
/** Mid-walk freeze-and-glance length. Two of these punctuate the approach. */
const PAUSE_S = 0.6
/** Bound-away ground speed (hops carry it, so this reads much faster). */
const BOUND_SPEED = 3.4
/** onEat fires this far into the eat phase (head is committed by then). */
const EAT_FIRE_AT = 0.35
/** Tap-collect reach for the session-2 tuft (tideline grammar: 1.8 u). */
const TUFT_REACH = 1.8

/** Stop this short of the bed — the neck covers the rest. */
const APPROACH_GAP = 0.85

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t)
}

export class GoatArrival {
  private readonly rig: GoatRig
  private phase_: GoatPhase = 'idle'
  /** Seconds inside the current phase. */
  private t = 0
  private beds: THREE.Vector3[] = []
  private player: (() => THREE.Vector3) | null = null
  private returnVisit = false
  private eatFired = false
  private lookFired = false
  private leftTuft = false

  /** Ground-plane position (x, z in .x/.y) and facing. */
  private readonly pos = new THREE.Vector2()
  private heading = 0

  /** Gait state: phase accumulator + eased swing amplitude. */
  private gaitT = 0
  private legAmp = 0
  private pitch = 0

  private targetBed: THREE.Vector3 | null = null
  private walk: {
    a: THREE.Vector2; c: THREE.Vector2; b: THREE.Vector2
    travel: number; p1: number; p2: number
  } | null = null
  private boundPlan: { from: THREE.Vector2; to: THREE.Vector2; dur: number; hops: number } | null = null

  private tuft: THREE.Group | null = null

  onRustle?: (at: THREE.Vector3) => void
  onEat?: (bedPos: THREE.Vector3) => void
  onLook?: () => void
  onDone?: (leftTuft: boolean) => void

  private readonly lookTmp = new THREE.Vector3()
  private readonly v2a = new THREE.Vector2()
  private readonly v2b = new THREE.Vector2()

  constructor(private readonly scene: THREE.Group) {
    this.rig = createGoatModel()
    /*
     * Yaw first, then pitch — in that order, which the default XYZ does not do.
     * `pose` writes heading into rotation.y and the bound's nose-up/nose-down
     * arc into rotation.x, and under XYZ the x rotation is composed OUTSIDE the
     * y one, i.e. about the world's across-axis rather than the goat's. The
     * goat leaves the beat heading roughly north-west, so 0.4 rad of "pitch"
     * came out almost entirely as ROLL and the animal keeled over mid-hop.
     */
    this.rig.root.rotation.order = 'YXZ'
    this.rig.root.visible = false
    scene.add(this.rig.root)
  }

  get phase(): GoatPhase {
    return this.phase_
  }

  get done(): boolean {
    return this.phase_ === 'done'
  }

  /** Scripted beat-9 run. bedPositions from farm.tileWorldPos. */
  begin(bedPositions: THREE.Vector3[], playerPos: () => THREE.Vector3): void {
    this.start(bedPositions, playerPos, false)
  }

  /** Session-2 revisit; leaves a coat tuft at the treeline on exit. */
  beginReturnVisit(bedPositions: THREE.Vector3[], playerPos: () => THREE.Vector3): void {
    this.start(bedPositions, playerPos, true)
  }

  private start(beds: THREE.Vector3[], playerPos: () => THREE.Vector3, revisit: boolean): void {
    this.beds = beds.map((b) => b.clone())
    this.player = playerPos
    this.returnVisit = revisit
    this.eatFired = false
    this.lookFired = false
    this.leftTuft = false
    this.walk = null
    this.boundPlan = null
    this.targetBed = null
    this.gaitT = 0
    this.legAmp = 0
    this.pitch = 0
    this.pos.copy(EMERGE_FROM)
    // Faces out of the gap from the first frame it exists.
    this.heading = Math.atan2(EMERGE_TO.x - EMERGE_FROM.x, EMERGE_TO.y - EMERGE_FROM.y)
    this.rig.root.visible = false
    this.setPhase('rustle')
    // Audio-first: the treeline speaks two full seconds before the goat shows.
    this.onRustle?.(new THREE.Vector3(TREELINE.x, groundHeight(TREELINE.x, TREELINE.y), TREELINE.y))
  }

  /**
   * Camera focus while the sequence runs (W-INT drives the shot from this).
   *
   * From the sniff onward this is the goat's HEAD in world space, not its
   * root: the beat's payoff is a face, and a camera aimed at the middle of the
   * animal frames a barrel with a head poking out of the top of shot. Framing
   * the head also means a push-in on the look beat crops to eyes rather than
   * to torso, which is the whole ask of "it must feel like being seen".
   */
  focusPoint(): THREE.Vector3 | null {
    if (this.phase_ === 'idle' || this.phase_ === 'done') return null
    if (this.phase_ === 'rustle') {
      return new THREE.Vector3(TREELINE.x, groundHeight(TREELINE.x, TREELINE.y) + 0.6, TREELINE.y)
    }
    if (this.phase_ === 'sniff' || this.phase_ === 'eat' || this.phase_ === 'look' || this.phase_ === 'bleat') {
      return this.headPoint()
    }
    return this.rig.root.position.clone().add(new THREE.Vector3(0, 0.5, 0))
  }

  /**
   * World position of the goat's head, for the close shot on the look beat.
   *
   * Public because the camera owner needs a point to push in on that is not
   * the animal's centre of mass, and because the 1-second hold is the only
   * shot in the opening where the subject is smaller than the frame it has to
   * fill.
   */
  headPoint(): THREE.Vector3 {
    this.rig.head.updateWorldMatrix(true, false)
    return this.rig.head.getWorldPosition(new THREE.Vector3())
  }

  /** Facing of the goat's body, radians (0 = +z). Lets the camera place itself
   *  in front of the animal for the look beat instead of behind its shoulder. */
  get facing(): number {
    return this.heading
  }

  /** Session-2 coat tuft, tap-collect within reach. */
  tuftTargetNear(pos: THREE.Vector3): { collect: () => void } | null {
    if (!this.tuft) return null
    if (Math.hypot(pos.x - TUFT_POS.x, pos.z - TUFT_POS.y) > TUFT_REACH) return null
    return {
      collect: () => {
        if (this.tuft) {
          this.scene.remove(this.tuft)
          this.tuft = null
        }
      },
    }
  }

  update(dt: number, elapsed: number): void {
    if (this.phase_ === 'idle' || this.phase_ === 'done') return
    this.t += dt

    let look: THREE.Vector3 | null = null
    let moving = false
    let gaitHz = 7
    let amp = 0.5
    let hopY = 0
    let targetPitch = 0
    let breathe = false
    let tailWag = 0.12
    /*
     * How much the ears commit to whatever the head is looking at.
     *
     * Held low for everything the goat does on its own business — the ground
     * ahead, the plant it is eating — so that the look beat has somewhere to go.
     * "Ears forward" is the tell that makes being seen land, and a goat that
     * walks in with its ears already pricked has spent it before the moment.
     */
    let ears = 0.2

    switch (this.phase_) {
      case 'rustle': {
        // Nothing visible. The world (W-AV rustle VFX/SFX) carries this beat.
        if (this.t >= RUSTLE_S) {
          this.rig.root.visible = true
          this.setPhase('emerge')
        }
        break
      }

      case 'emerge': {
        const s = easeInOut(Math.min(1, this.t / EMERGE_S))
        this.pos.lerpVectors(EMERGE_FROM, EMERGE_TO, s)
        this.turnTo(Math.atan2(EMERGE_TO.x - EMERGE_FROM.x, EMERGE_TO.y - EMERGE_FROM.y), 6, dt)
        moving = s < 1
        gaitHz = 5
        amp = 0.35
        // First act on open ground: check the coast — a glance at the player,
        // then eyes on the path. Caution, established before a single step.
        if (this.t < 1.2 && this.player) {
          // The coast-check: a wary glance, ears half up.
          look = this.player()
          ears = 0.55
        } else look = this.aheadPoint(1.6)
        if (this.t >= EMERGE_S) {
          this.planWalk()
          this.setPhase('walk')
        }
        break
      }

      case 'walk': {
        const w = this.walk!
        const { s, paused } = this.walkProgress(this.t)
        this.bez(s, this.v2a)
        this.pos.copy(this.v2a)
        // Heading follows the bezier tangent.
        const u = 1 - s
        const dx = 2 * u * (w.c.x - w.a.x) + 2 * s * (w.b.x - w.c.x)
        const dz = 2 * u * (w.c.y - w.a.y) + 2 * s * (w.b.y - w.c.y)
        if (Math.hypot(dx, dz) > 1e-4) this.turnTo(Math.atan2(dx, dz), 5, dt)
        moving = !paused && s < 1
        gaitHz = 6.5
        amp = 0.5
        if (paused && this.player) {
          // Freeze-and-glance: head snaps up to the player mid-approach.
          look = this.player()
          ears = 0.6
        } else {
          // Head carried low, reading the ground just ahead — a browse walk.
          look = this.aheadPoint(1.4)
        }
        if (s >= 1) this.setPhase('sniff')
        break
      }

      case 'sniff': {
        const bed = this.targetBed!
        this.turnTo(Math.atan2(bed.x - this.pos.x, bed.z - this.pos.y), 5, dt)
        // Nose down to the plant with small investigative bobs.
        this.lookTmp.set(bed.x, groundHeight(bed.x, bed.z) + 0.2 + Math.sin(this.t * 9) * 0.05, bed.z)
        look = this.lookTmp
        if (this.t >= SNIFF_S) this.setPhase('eat')
        break
      }

      case 'eat': {
        const bed = this.targetBed!
        // Chewing tugs: the head works at the plant. The plant itself is
        // untouched — onEat is a gift the integrator narrates, not a mutation.
        this.lookTmp.set(
          bed.x,
          groundHeight(bed.x, bed.z) + 0.05 + Math.abs(Math.sin(this.t * 6.5)) * 0.09,
          bed.z,
        )
        look = this.lookTmp
        tailWag = 0.35 // the happy-tail tell
        ears = 0.15    // busy eating, not listening
        if (!this.eatFired && this.t >= EAT_FIRE_AT) {
          this.eatFired = true
          this.onEat?.(bed.clone())
        }
        if (this.t >= EAT_S) this.setPhase('look')
        break
      }

      case 'look': {
        /*
         * THE most important second in the opening. The body goes dead still
         * — no gait, no turn, no tail — with only a breathing pulse, while
         * the rig's head tracking and ear engagement lock onto the player.
         * Everything held back so the one moving thing is attention itself.
         */
        if (!this.lookFired) {
          this.lookFired = true
          this.onLook?.()
        }
        if (this.player) look = this.player()
        amp = 0
        breathe = true
        tailWag = 0.02
        ears = 1 // THE ears-forward beat
        if (this.t >= LOOK_S) this.setPhase('bleat')
        break
      }

      case 'bleat': {
        // One head-toss: nose thrown up and forward, a small chest recoil.
        const k = Math.sin((this.t / BLEAT_S) * Math.PI)
        this.lookTmp.set(
          this.pos.x + Math.sin(this.heading) * 2,
          groundHeight(this.pos.x, this.pos.y) + 1.2 + k * 1.4,
          this.pos.y + Math.cos(this.heading) * 2,
        )
        look = this.lookTmp
        this.rig.body.rotation.x = -k * 0.07
        ears = 0.8
        amp = 0
        if (this.t >= BLEAT_S) {
          this.planBound()
          this.setPhase('bound')
        }
        break
      }

      case 'bound': {
        const b = this.boundPlan!
        const p = Math.min(1, this.t / b.dur)
        this.v2a.lerpVectors(b.from, b.to, p)
        this.pos.copy(this.v2a)
        this.turnTo(Math.atan2(b.to.x - b.from.x, b.to.y - b.from.y), 10, dt)
        const hop = (p * b.hops) % 1
        hopY = Math.sin(hop * Math.PI) * 0.42
        targetPitch = Math.cos(hop * Math.PI) * 0.4
        // Airborne shape: fronts tucked back, rears trailing then reaching.
        const tuck = Math.sin(hop * Math.PI)
        this.rig.legs[0].rotation.x = 0.55 * tuck
        this.rig.legs[1].rotation.x = 0.55 * tuck
        this.rig.legs[2].rotation.x = -0.45 * tuck
        this.rig.legs[3].rotation.x = -0.45 * tuck
        moving = false
        amp = 0
        if (p >= 1) {
          this.finish()
          return
        }
        break
      }
    }

    this.pose(dt, elapsed, { look, moving, gaitHz, amp, hopY, targetPitch, breathe, tailWag, ears })
  }

  // --- internals -------------------------------------------------------------

  private setPhase(p: GoatPhase): void {
    this.phase_ = p
    this.t = 0
  }

  /** Point on the ground a stride or two ahead of the nose. */
  private aheadPoint(dist: number): THREE.Vector3 {
    const x = this.pos.x + Math.sin(this.heading) * dist
    const z = this.pos.y + Math.cos(this.heading) * dist
    this.lookTmp.set(x, groundHeight(x, z) + 0.25, z)
    return this.lookTmp
  }

  /** Shortest-arc turn toward a heading, rate-limited. */
  private turnTo(target: number, rate: number, dt: number): void {
    let d = target - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.heading += d * Math.min(1, rate * dt)
  }

  /**
   * Approach plan: quadratic bezier from the treeline mouth to a stop point
   * one neck-length short of the nearest bed. The control point bows the
   * path toward whichever side sits farther from the old pocket centre —
   * the promised "simple obstacle avoidance": a wild animal skirts the
   * debris field rather than marching its centreline.
   */
  private planWalk(): void {
    let bed = this.beds[0] ?? new THREE.Vector3(-34, 0, 0)
    for (const b of this.beds) {
      if (
        Math.hypot(b.x - EMERGE_TO.x, b.z - EMERGE_TO.y) <
        Math.hypot(bed.x - EMERGE_TO.x, bed.z - EMERGE_TO.y)
      ) {
        bed = b
      }
    }
    this.targetBed = bed.clone()

    const a = EMERGE_TO.clone()
    this.v2a.set(bed.x, bed.z)
    this.v2b.copy(this.v2a).sub(a)
    const dir = this.v2b.clone().normalize()
    const stop = this.v2a.clone().addScaledVector(dir, -APPROACH_GAP)
    const mid = a.clone().add(stop).multiplyScalar(0.5)
    const perp = new THREE.Vector2(-this.v2b.y, this.v2b.x).normalize()
    const pocket = new THREE.Vector2(-34, 0)
    const optA = mid.clone().addScaledVector(perp, 2.1)
    const optB = mid.clone().addScaledVector(perp, -2.1)
    const c = optA.distanceTo(pocket) >= optB.distanceTo(pocket) ? optA : optB

    this.walk = { a, c, b: stop, travel: 1, p1: 0, p2: 0 }
    // Arc length by sampling; pause windows land at 32% / 68% of travel.
    let len = 0
    let px = a.x
    let py = a.y
    for (let i = 1; i <= 16; i++) {
      this.bez(i / 16, this.v2a)
      len += Math.hypot(this.v2a.x - px, this.v2a.y - py)
      px = this.v2a.x
      py = this.v2a.y
    }
    const travel = Math.max(0.5, len / WALK_SPEED)
    this.walk.travel = travel
    this.walk.p1 = travel * 0.32
    this.walk.p2 = travel * 0.68
  }

  /** Map phase time to bezier progress, freezing inside the pause windows. */
  private walkProgress(t: number): { s: number; paused: boolean } {
    const w = this.walk!
    let mt = t
    let paused = false
    if (mt > w.p1) {
      if (mt < w.p1 + PAUSE_S) {
        mt = w.p1
        paused = true
      } else {
        mt -= PAUSE_S
      }
    }
    if (!paused && mt > w.p2) {
      if (mt < w.p2 + PAUSE_S) {
        mt = w.p2
        paused = true
      } else {
        mt -= PAUSE_S
      }
    }
    return { s: Math.min(1, mt / w.travel), paused }
  }

  private bez(s: number, out: THREE.Vector2): THREE.Vector2 {
    const w = this.walk!
    const u = 1 - s
    out.set(
      u * u * w.a.x + 2 * u * s * w.c.x + s * s * w.b.x,
      u * u * w.a.y + 2 * u * s * w.c.y + s * s * w.b.y,
    )
    return out
  }

  private planBound(): void {
    const from = this.pos.clone()
    const dist = from.distanceTo(EXIT)
    this.boundPlan = {
      from,
      to: EXIT.clone(),
      dur: Math.max(0.6, dist / BOUND_SPEED),
      hops: Math.max(3, Math.round(dist / 1.5)),
    }
  }

  private finish(): void {
    this.rig.root.visible = false
    if (this.returnVisit && !this.tuft) {
      this.spawnTuft()
      this.leftTuft = true
    }
    this.setPhase('done')
    this.onDone?.(this.leftTuft)
  }

  /**
   * The session-2 token: a tuft of cream coat — with one sea-foam wisp, the
   * same foam as the swirl — snagged on a leaning branch stub at the
   * treeline. Collect via tuftTargetNear.
   */
  private spawnTuft(): void {
    const g = new THREE.Group()
    const snag = cyl(0.018, 0.032, 0.55, 0x6b4a33, 6)
    snag.position.y = 0.26
    snag.rotation.z = 0.42
    g.add(snag)
    const core = ball(0.055, 0xf1e9d8, 1)
    core.scale.set(1.2, 0.8, 0.9)
    core.position.set(-0.11, 0.52, 0)
    g.add(core)
    const wisp = ball(0.035, 0xf1e9d8, 1)
    wisp.scale.set(1.4, 0.5, 0.7)
    wisp.position.set(-0.16, 0.56, 0.03)
    wisp.rotation.z = 0.5
    g.add(wisp)
    const foam = ball(0.028, 0x9fd8cf, 1)
    foam.scale.set(1.1, 0.6, 0.8)
    foam.position.set(-0.08, 0.55, -0.03)
    g.add(foam)
    g.position.set(TUFT_POS.x, groundHeight(TUFT_POS.x, TUFT_POS.y), TUFT_POS.y)
    g.rotation.y = -0.6
    this.scene.add(g)
    this.tuft = g
  }

  /** Shared per-frame body write: gait, bob, weight shift, breath, tail. */
  private pose(
    dt: number,
    elapsed: number,
    o: {
      look: THREE.Vector3 | null
      moving: boolean
      gaitHz: number
      amp: number
      hopY: number
      targetPitch: number
      breathe: boolean
      tailWag: number
      ears: number
    },
  ): void {
    const rig = this.rig

    // Eased swing amplitude: legs settle rather than stopping dead...
    this.legAmp += ((o.moving ? o.amp : 0) - this.legAmp) * Math.min(1, dt * 8)
    if (o.moving) this.gaitT += dt * o.gaitHz

    // ...except in bound, whose tuck already owns the legs this frame.
    if (this.phase_ !== 'bound') {
      const sw = Math.sin(this.gaitT) * this.legAmp
      rig.legs[0].rotation.x = sw
      rig.legs[1].rotation.x = -sw
      rig.legs[2].rotation.x = -sw * 0.9
      rig.legs[3].rotation.x = sw * 0.9
    }

    // Body bob + lateral weight shift while stepping.
    const bob = Math.abs(Math.sin(this.gaitT)) * 0.028 * this.legAmp
    const breath = o.breathe ? Math.sin(this.t * 3.2) : 0
    rig.body.position.y = GOAT_BODY_Y + bob
    rig.body.rotation.z = Math.sin(this.gaitT * 0.5) * 0.05 * this.legAmp
    if (this.phase_ !== 'bleat') {
      rig.body.rotation.x += (0 - rig.body.rotation.x) * Math.min(1, dt * 6)
    }
    rig.body.scale.y += (1 + breath * 0.012 - rig.body.scale.y) * Math.min(1, dt * 10)

    // Tail: alive at all times, loudest while eating, near-still while seen.
    rig.tail.rotation.z = Math.sin(elapsed * 2.1) * o.tailWag

    // Root transform: ground-conformed, plus the bound hop arc and pitch.
    this.pitch += (o.targetPitch - this.pitch) * Math.min(1, dt * 12)
    const y = groundHeight(this.pos.x, this.pos.y)
    rig.root.position.set(this.pos.x, y + o.hopY, this.pos.y)
    rig.root.rotation.y = this.heading
    rig.root.rotation.x = this.pitch

    // Head + ears, every frame, so tracking blends stay smooth.
    rig.lookAt(o.look, dt, o.ears)
  }
}
