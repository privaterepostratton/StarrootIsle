import * as THREE from 'three'
import { getModels, modelGroup } from '../assets/models'
import { groundHeight, isSand, isWalkable, WALK_LIMIT } from './terrain'

/**
 * The tide keeps bringing things in.
 *
 * The beach taught the player, in the first minute of the game, that a barrel on
 * the sand is worth walking to — and then never used that again. This is the
 * follow-through: every few minutes another one washes up somewhere along the
 * shore with something useful in it, so the coast stays worth a look instead of
 * being a corridor between the farm and the village.
 *
 * Deliberately small stakes. A barrel is coins, a handful of seeds, occasionally
 * a sprinkler — enough that finding one is a good moment, never so much that a
 * player who ignores the sea falls behind one who patrols it.
 *
 * Collected by walking over it, exactly like the opening crates in
 * beach-seeds.ts: the game has already taught that verb on this exact prop, and
 * teaching a second one for the same object would be worse than teaching none.
 *
 * Not saved. What is on the sand at the moment you close the game is scenery,
 * not progress, and a barrel that survives a reload invites the player to bank
 * them rather than collect them.
 */

/** Never more than this lying around, however long the player is away. */
const MAX_ASHORE = 3
/** Seconds before the first one, then the gap between them. */
const FIRST_DELAY = 150
const GAP_MIN = 170
const GAP_MAX = 300
/** Walk this close and it is yours. Matches the opening crates. */
const PICKUP_RANGE = 1.7
/** Keep them apart, so two never wash up in a heap. */
const MIN_SEPARATION = 9

/** What was in it. Rolled by the caller — see main.ts. */
export interface FlotsamPrize {
  kind: 'coins' | 'seeds' | 'sprinkler'
  /** Coins, seeds, or sprinklers, depending on `kind`. */
  amount: number
  /** For `seeds`, which crop. For `sprinkler`, which tier. */
  id?: string
  /** Shown in the popup over the barrel: "+40 🪙". */
  label: string
}

interface Piece {
  object: THREE.Group
  x: number
  z: number
  prize: FlotsamPrize
  /** Phase offset, so several on the sand never bob in lockstep. */
  phase: number
}

export class Flotsam {
  readonly group = new THREE.Group()
  private readonly pieces: Piece[] = []
  private timer = FIRST_DELAY

  /** Fires when one lands, for the toast — the player may be nowhere near it. */
  onWashUp: ((at: THREE.Vector3) => void) | null = null
  /** Fires when one is walked over, with whatever was inside. */
  onCollect: ((at: THREE.Vector3, prize: FlotsamPrize) => void) | null = null

  constructor(
    private readonly rollPrize: () => FlotsamPrize,
    private readonly rng: () => number = Math.random,
  ) {}

  get ashore() {
    return this.pieces.length
  }

  /**
   * @param enabled False while the opening is still running. The tutorial has
   *   its own crates on this beach and points a trail at them; a bonus barrel
   *   turning up beside them during "gather the seed crates" is the one moment
   *   in the game where a second thing to walk to is actively unhelpful.
   */
  update(dt: number, elapsed: number, playerPos: THREE.Vector3, enabled: boolean) {
    if (enabled) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer = GAP_MIN + this.rng() * (GAP_MAX - GAP_MIN)
        if (this.pieces.length < MAX_ASHORE) this.washUp()
      }
    }

    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i]
      const ground = groundHeight(piece.x, piece.z)

      // The same slow bob and turn the opening crates have. Nothing else on an
      // empty beach moves, and that is most of what makes one catch the eye.
      piece.object.position.y = ground + Math.sin(elapsed * 2 + piece.phase) * 0.09
      piece.object.rotation.y += 0.7 * Math.min(0.05, dt || 0.016)

      if (Math.hypot(piece.x - playerPos.x, piece.z - playerPos.z) > PICKUP_RANGE) continue

      this.group.remove(piece.object)
      this.pieces.splice(i, 1)
      this.onCollect?.(new THREE.Vector3(piece.x, ground + 0.5, piece.z), piece.prize)
    }
  }

  /**
   * Land one right now, for QA.
   *
   * Waiting out a three-minute timer to look at a five-second pickup is the
   * kind of test nobody runs twice.
   */
  forceWashUp() {
    if (this.pieces.length >= MAX_ASHORE) return false
    this.washUp()
    return true
  }

  private washUp() {
    const spot = this.findSpot()
    if (!spot) return

    const object = modelGroup(getModels().barrel, 0.62)
    object.position.set(spot.x, groundHeight(spot.x, spot.z), spot.z)
    object.rotation.y = this.rng() * Math.PI * 2
    this.group.add(object)
    this.pieces.push({
      object,
      x: spot.x,
      z: spot.z,
      prize: this.rollPrize(),
      phase: this.rng() * Math.PI * 2,
    })

    this.onWashUp?.(new THREE.Vector3(spot.x, groundHeight(spot.x, spot.z) + 0.5, spot.z))
  }

  /**
   * A patch of sand as close to the water as the sampling finds.
   *
   * Rejection sampling over the whole valley rather than maths along the
   * shoreline: sand only exists on the beach, so "is it sand" already *is* the
   * shoreline test, and it stays right if the coast is ever recut. Of the
   * candidates that pass, the one furthest from the middle of the map wins —
   * that is the seaward edge, where something washed in would actually lie.
   */
  private findSpot() {
    let best: { x: number; z: number } | null = null
    let bestReach = -1

    for (let i = 0; i < 60; i++) {
      const angle = this.rng() * Math.PI * 2
      // sqrt keeps the sample even by area rather than crowding the middle.
      const reach = Math.sqrt(this.rng()) * WALK_LIMIT
      const x = Math.cos(angle) * reach
      const z = Math.sin(angle) * reach
      if (!isSand(x, z) || !isWalkable(x, z)) continue
      if (this.pieces.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_SEPARATION)) continue
      if (reach <= bestReach) continue
      bestReach = reach
      best = { x, z }
    }
    return best
  }
}
