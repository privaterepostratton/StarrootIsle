import * as THREE from 'three'
import { getModels, modelGroup } from '../assets/models'
import { groundHeight } from './terrain'
import { SPAWN } from './village'

/**
 * The seeds that washed up with you.
 *
 * The player used to start with five turnip seeds already in the bag, which is
 * fine when the game opens in a garden and invisible as a piece of design. It
 * opens on an empty beach now, and the first thing that should happen is the
 * player *finding* something — so the same five seeds are three crates on the
 * sand instead, scattered along the tideline within sight of where you wake.
 *
 * Collected by walking over them rather than by pressing anything. There is no
 * prompt yet, no UI, and nothing else in the world to confuse it with: at the
 * very start of the game the only verb the player is sure of is *move*, and
 * asking them to learn a key before they have found anything is backwards.
 */

/** Seeds in each crate, and which crop. Five turnips in total, as before. */
const CRATES: { dx: number; dz: number; seeds: number }[] = [
  { dx: 3.2, dz: -2.6, seeds: 2 },
  { dx: -4.1, dz: 1.4, seeds: 2 },
  { dx: 1.1, dz: 4.3, seeds: 1 },
]

export const BEACH_SEED_CROP = 'turnip'

/** Walk this close and it is yours. */
const PICKUP_RANGE = 1.6

interface Crate {
  object: THREE.Group
  x: number
  z: number
  seeds: number
  taken: boolean
  /** Phase offset so the three do not bob in lockstep. */
  phase: number
}

export class BeachSeeds {
  readonly group = new THREE.Group()
  private readonly crates: Crate[] = []

  /** Fires per crate collected, with the world position and the seed count. */
  onCollect: ((at: THREE.Vector3, seeds: number) => void) | null = null
  /** Fires once, when the last crate is picked up. */
  onEmptied: (() => void) | null = null

  constructor() {
    for (const c of CRATES) {
      const x = SPAWN.x + c.dx
      const z = SPAWN.z + c.dz
      // A barrel, small: the crate is flotsam, and the barrel is the only prop
      // in the set that already reads as something that floated ashore.
      const object = modelGroup(getModels().barrel, 0.62)
      object.position.set(x, groundHeight(x, z), z)
      object.rotation.y = c.dx * 1.3
      this.group.add(object)
      this.crates.push({ object, x, z, seeds: c.seeds, taken: false, phase: c.dx + c.dz })
    }
  }

  get remaining() {
    return this.crates.filter((c) => !c.taken).length
  }

  get emptied() {
    return this.remaining === 0
  }

  /**
   * Put every crate back on the sand.
   *
   * For the dev panel: the opening is one-way, so without this the only way to
   * see the pickup again is to wipe the save and replay to the beach.
   */
  respawn() {
    for (const crate of this.crates) {
      if (!crate.taken) continue
      crate.taken = false
      this.group.add(crate.object)
    }
  }

  /** Take every crate without effects, for a restored save. */
  restoreEmptied() {
    for (const c of this.crates) {
      if (c.taken) continue
      c.taken = true
      this.group.remove(c.object)
    }
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3) {
    void dt
    for (const crate of this.crates) {
      if (crate.taken) continue

      // A slow bob and turn, so they read as pickups rather than as scenery.
      // Nothing else on the beach moves, which is most of what draws the eye.
      crate.object.position.y = groundHeight(crate.x, crate.z) + Math.sin(elapsed * 2 + crate.phase) * 0.09
      crate.object.rotation.y += 0.7 * Math.min(0.05, dt || 0.016)

      if (Math.hypot(crate.x - playerPos.x, crate.z - playerPos.z) > PICKUP_RANGE) continue

      crate.taken = true
      this.group.remove(crate.object)
      this.onCollect?.(new THREE.Vector3(crate.x, groundHeight(crate.x, crate.z) + 0.5, crate.z), crate.seeds)
      if (this.emptied) this.onEmptied?.()
    }
  }
}
