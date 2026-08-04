import * as THREE from 'three'
import { createAnimalModel, type AnimalRig } from '../assets/animal'
import { ANIMALS, type AnimalDef, type AnimalSpecies } from './animals'
import { groundHeight, isWalkable, WALK_LIMIT } from './terrain'
import { inVillage } from './village'

/**
 * Wild animals, and taming them.
 *
 * The valley's livestock can be bought from the animal store, which is a pure
 * coin sink and asks nothing of the player but patience. This is the other
 * route: the same four species also live wild out past the fences, and one will
 * follow you home if you feed it what it wants.
 *
 * The design rule is that taming must never be the *obviously* better deal, or
 * the animal store stops meaning anything. What keeps it honest is the crop
 * each species craves — a chicken wants a turnip you can grow on day one, a pig
 * wants a dragonfruit. You can only tame what you can already farm, so the free
 * route unlocks in step with the paid one instead of undercutting it. See
 * CRAVING.
 *
 * Wild animals are deliberately *not* saved. They are scenery with a mechanic
 * attached rather than player property — the one that matters is the one you
 * tamed, and that is already persisted as pasture livestock. Respawning a fresh
 * set each session also quietly fixes the case where a player wanders off
 * mid-approach and leaves an animal frozen halfway through being fed.
 */

/**
 * What each species will follow you home for.
 *
 * Ordered by how far into the game the crop sits, matching the order the
 * species themselves unlock at the store. The pairing is flavour where it can
 * be — pigs and truffles, a chicken pecking at a root — and progression gating
 * where it has to be.
 */
export const CRAVING: Record<AnimalSpecies, string> = {
  chicken: 'turnip',
  sheep: 'strawberry',
  cow: 'pumpkin',
  pig: 'dragonfruit',
}

/** How many wild animals live in the valley at once. */
const POPULATION = 9

/** Inside this range of the player, a wild animal reacts at all. */
const NOTICE_RANGE = 9
/** Inside this, an animal being offered its craving will hold still to be fed. */
const FEED_RANGE = 2.2
/**
 * Inside this, an animal that is *not* being offered its craving backs away.
 *
 * Shorter than the notice range on purpose: an animal that flees the moment it
 * sees you can never be walked up to, and the walk up is the whole interaction.
 * It lets you get close, then keeps its distance until you are holding food.
 */
const SHY_RANGE = 3.4

/** Seconds the "walking home" animation lasts before the animal is handed over. */
const LEAVE_SECONDS = 2.4

interface Wild {
  def: AnimalDef
  rig: AnimalRig
  pos: THREE.Vector2
  target: THREE.Vector2
  facing: number
  /** Seconds to wait before choosing a new wander target. */
  idle: number
  /** Leg-swing phase, so the herd is not in lockstep. */
  phase: number
  /** Set when fed. Counts down while the animal trots off, then it is removed. */
  leaving: number
}

/** A wild animal the player is standing next to, and whether they can feed it. */
export interface TameTarget {
  def: AnimalDef
  /** The crop it wants. */
  cropId: string
  /** True when the player is holding one. */
  canFeed: boolean
  position: THREE.Vector3
}

export class Wildlife {
  readonly group = new THREE.Group()
  private readonly animals: Wild[] = []
  private readonly scratch = new THREE.Vector3()

  /** Called when an animal has finished walking off, to hand it to the pasture. */
  onTamed: ((def: AnimalDef, at: THREE.Vector3) => void) | null = null
  /** Called the moment food is accepted, for the burst and the noise. */
  onFed: ((def: AnimalDef, at: THREE.Vector3) => void) | null = null

  constructor(private readonly rng: () => number) {
    for (let i = 0; i < POPULATION; i++) this.spawn(i)
  }

  private spawn(i: number) {
    /*
     * Species cycle rather than roll.
     *
     * A random draw over nine animals routinely produces a valley with four
     * chickens and no cow, and a player who has just grown their first pumpkin
     * has no way to know whether cows are rare or simply absent. Cycling
     * guarantees at least two of each, so "I cannot find one" is always a
     * question of looking rather than of luck.
     */
    const def = ANIMALS[i % ANIMALS.length]
    const rig = createAnimalModel(def.id)
    this.group.add(rig.root)

    const home = this.wanderPoint(new THREE.Vector2(0, 0), WALK_LIMIT * 0.85)
    this.animals.push({
      def,
      rig,
      pos: home.clone(),
      target: this.wanderPoint(home, 12),
      facing: this.rng() * Math.PI * 2,
      idle: this.rng() * 3,
      phase: this.rng() * Math.PI * 2,
      leaving: 0,
    })
  }

  /**
   * A walkable spot within `spread` of an origin, well clear of the village.
   *
   * Rejection sampling rather than clamping, because the walkable region is a
   * ring with rivers cut through it — a clamped point lands in water or on a
   * cliff often enough to matter, and an animal standing in a river is worse
   * than one that took a few tries to place.
   */
  private wanderPoint(origin: THREE.Vector2, spread: number): THREE.Vector2 {
    for (let i = 0; i < 30; i++) {
      const a = this.rng() * Math.PI * 2
      const d = Math.sqrt(this.rng()) * spread
      const x = origin.x + Math.cos(a) * d
      const z = origin.y + Math.sin(a) * d
      if (Math.hypot(x, z) < 22) continue
      if (Math.hypot(x, z) > WALK_LIMIT - 4) continue
      if (inVillage(x, z, 6)) continue
      if (!isWalkable(x, z)) continue
      return new THREE.Vector2(x, z)
    }
    return origin.clone()
  }

  /**
   * The animal the player could feed right now, or null.
   *
   * Returns the nearest within FEED_RANGE whatever the player is holding, and
   * reports separately whether they can actually feed it. Hiding an animal the
   * player cannot yet afford to tame would leave them with no way to learn what
   * it wants, and "this pig wants a dragonfruit" is the entire hook.
   */
  targetNear(player: THREE.Vector3, held: (cropId: string) => boolean): TameTarget | null {
    let best: Wild | null = null
    let bestDist = FEED_RANGE
    for (const a of this.animals) {
      if (a.leaving > 0) continue
      const d = Math.hypot(a.pos.x - player.x, a.pos.y - player.z)
      if (d < bestDist) {
        bestDist = d
        best = a
      }
    }
    if (!best) return null
    const cropId = CRAVING[best.def.id]
    return {
      def: best.def,
      cropId,
      canFeed: held(cropId),
      position: new THREE.Vector3(best.pos.x, groundHeight(best.pos.x, best.pos.y), best.pos.y),
    }
  }

  /**
   * Feed the nearest animal. Returns its definition on success.
   *
   * The animal is not handed over here — it trots away first and is delivered
   * by `update` when it arrives. A tamed cow that teleports into the paddock the
   * instant you press E reads as a menu transaction; one that walks off toward
   * the village reads as a cow deciding to come with you.
   */
  feedNear(player: THREE.Vector3): AnimalDef | null {
    let best: Wild | null = null
    let bestDist = FEED_RANGE
    for (const a of this.animals) {
      if (a.leaving > 0) continue
      const d = Math.hypot(a.pos.x - player.x, a.pos.y - player.z)
      if (d < bestDist) {
        bestDist = d
        best = a
      }
    }
    if (!best) return null

    best.leaving = LEAVE_SECONDS
    // Head for the village, which is where the paddock is.
    best.target.set(0, 0)
    this.scratch.set(best.pos.x, groundHeight(best.pos.x, best.pos.y), best.pos.y)
    this.onFed?.(best.def, this.scratch.clone())
    return best.def
  }

  update(dt: number, elapsed: number, player: THREE.Vector3) {
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i]
      const toPlayer = Math.hypot(a.pos.x - player.x, a.pos.y - player.z)

      let speed = a.def.speed * 0.75

      if (a.leaving > 0) {
        a.leaving -= dt
        // Trots off rather than strolling — it has somewhere to be now.
        speed = a.def.speed * 1.35
        if (a.leaving <= 0) {
          this.scratch.set(a.pos.x, groundHeight(a.pos.x, a.pos.y), a.pos.y)
          this.onTamed?.(a.def, this.scratch.clone())
          this.group.remove(a.rig.root)
          this.animals.splice(i, 1)
          // One leaves, one is born elsewhere: the valley keeps its population
          // without the player watching an animal pop into existence.
          this.spawn(this.animals.length + Math.floor(elapsed))
          continue
        }
      } else if (toPlayer < SHY_RANGE) {
        /*
         * Back off, but only to the edge of the shy range.
         *
         * Retargeting to a point *away* from the player each frame produced an
         * animal that sprinted to the horizon the moment you jogged at it. The
         * target is placed just outside arm's reach instead, so it sidles away
         * and stops — close enough that swapping to the right crop and stepping
         * in again still works.
         */
        const away = Math.atan2(a.pos.y - player.z, a.pos.x - player.x)
        a.target.set(
          player.x + Math.cos(away) * (SHY_RANGE + 1.2),
          player.z + Math.sin(away) * (SHY_RANGE + 1.2),
        )
        a.idle = 0
        speed = a.def.speed
      } else if (toPlayer > NOTICE_RANGE) {
        a.idle -= dt
        if (a.idle <= 0) {
          a.target = this.wanderPoint(a.pos, 10)
          a.idle = 2 + this.rng() * 5
        }
      }

      const dx = a.target.x - a.pos.x
      const dz = a.target.y - a.pos.y
      const dist = Math.hypot(dx, dz)

      if (dist > 0.25) {
        const step = Math.min(speed * dt, dist)
        const nx = a.pos.x + (dx / dist) * step
        const nz = a.pos.y + (dz / dist) * step
        // A tamed animal walks home through anything; a wild one stays on
        // ground it could actually stand on.
        if (a.leaving > 0 || isWalkable(nx, nz)) {
          a.pos.set(nx, nz)
        } else {
          a.target = this.wanderPoint(a.pos, 8)
        }
        a.facing = Math.atan2(dx, dz)
        a.phase += dt * speed * 4.5
        // Legs swing only while moving, so a grazing animal stands still
        // instead of marching on the spot.
        for (let l = 0; l < a.rig.legs.length; l++) {
          a.rig.legs[l].rotation.x = Math.sin(a.phase + l * Math.PI * 0.5) * 0.5
        }
      } else {
        for (const leg of a.rig.legs) leg.rotation.x *= 1 - Math.min(1, dt * 6)
      }

      a.rig.root.position.set(a.pos.x, groundHeight(a.pos.x, a.pos.y), a.pos.y)
      a.rig.root.rotation.y = a.facing
      // A slow head bob at rest reads as grazing without a second animation.
      a.rig.head.rotation.x = Math.sin(elapsed * 1.4 + a.phase) * 0.09
    }
  }
}
