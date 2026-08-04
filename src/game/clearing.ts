import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { groundHeight, isWalkable, isSand } from './terrain'
import { PLAYER_SLOT, FENCE_HX, FENCE_HZ } from './village'
import type { Obstacle } from './world'

/**
 * The trees standing where the farm will be, and cutting them down.
 *
 * This is the opening move of the game. The player wakes on the beach owning
 * nothing — no plot, no beds, not even the ground — walks inland, and buys the
 * removal of a handful of trees. The last one to come down opens the clearing,
 * and *that* is what creates the farm (see Farm.openClearing).
 *
 * Doing it this way rather than handing over a plot at spawn is the whole point
 * of the redesign: the first thing you own is the first thing you made a
 * decision about. It also gives the starting coins a job, which they never had
 * when the farm arrived free and the shop was the only thing to spend on.
 *
 * The trees stand *inside* the future fence line, which is why nothing else
 * plants there — `inAnyPlot` already covers the player's clearing, so the
 * forest scatter leaves that ground alone and these are the only trees on it.
 */

/** What each tree costs to clear. Sized against the coins a new game starts with. */
export const CLEAR_COST = 15

/** How close the player must be for the prompt to appear. */
const REACH = 2.8

/**
 * Where the trees stand, as offsets from the farm centre in tiles-ish units.
 *
 * Hand-placed rather than scattered: four trees in a loose arc across the front
 * of the plot, so they read as a stand blocking the ground rather than as a
 * random sprinkle, and so the player can see all of them from the approach
 * without walking a circuit to find the last one.
 */
const POSITIONS: { x: number; z: number; scale: number }[] = [
  { x: -3.4, z: -2.2, scale: 1.05 },
  { x: 1.2, z: -3.6, scale: 0.9 },
  { x: 3.9, z: 0.4, scale: 1.12 },
  { x: -1.0, z: 2.6, scale: 0.96 },
]

interface Standing {
  object: THREE.Group
  x: number
  z: number
  obstacle: Obstacle
  cut: boolean
}

/**
 * The wood the clearing is cut out of.
 *
 * Trees packed in a band hugging the fence line, dense enough that the plot
 * reads as a hole someone made rather than as a fenced square in a meadow. The
 * global forest scatter cannot do this: it is uniform across the whole valley,
 * and at the density that makes a treeline look right at the map edge the
 * ground beside the farm is nearly bare.
 *
 * Outside the fence, never on it — these are scenery, not the four the player
 * fells, and a tree inside the rails would still be standing in the middle of
 * the farm afterwards.
 */
const SURROUND_COUNT = 90
const SURROUND_INNER = 1.2
const SURROUND_BAND = 11

export class Clearing {
  readonly group = new THREE.Group()
  private readonly trees: Standing[] = []

  /** Fires when the last tree comes down. */
  onOpened: (() => void) | null = null
  /** Fires for each tree, for the burst and the noise. */
  onCut: ((at: THREE.Vector3) => void) | null = null

  constructor(obstacles: Obstacle[], rand: () => number = Math.random) {
    // The wood first, so the four fellable trees draw over it if they overlap.
    for (let i = 0; i < SURROUND_COUNT; i++) {
      const a = rand() * Math.PI * 2
      const reach = SURROUND_INNER + Math.sqrt(rand()) * SURROUND_BAND
      // An ellipse around the plot rather than a circle: the plot is a rectangle
      // and a circular band leaves the long sides bare and the corners stacked.
      const x = PLAYER_SLOT.x + Math.cos(a) * (FENCE_HX + reach)
      const z = PLAYER_SLOT.z + Math.sin(a) * (FENCE_HZ + reach)
      if (Math.abs(x - PLAYER_SLOT.x) < FENCE_HX + 0.8 && Math.abs(z - PLAYER_SLOT.z) < FENCE_HZ + 0.8) continue
      if (!isWalkable(x, z) || isSand(x, z)) continue

      const conifer = rand() < 0.35
      const model = conifer ? getModels().pine : getModels().tree
      const height = (conifer ? PROP_HEIGHT.pine : PROP_HEIGHT.tree) * (0.82 + rand() * 0.42)
      const tree = modelGroup(model, height)
      tree.position.set(x, groundHeight(x, z), z)
      tree.rotation.y = rand() * Math.PI * 2
      this.group.add(tree)
      obstacles.push({ x, z, r: 0.55 })
    }

    for (const p of POSITIONS) {
      const x = PLAYER_SLOT.x + p.x
      const z = PLAYER_SLOT.z + p.z
      const object = modelGroup(getModels().tree, PROP_HEIGHT.tree * p.scale)
      object.position.set(x, groundHeight(x, z), z)
      object.rotation.y = p.x * 1.7 + p.z
      this.group.add(object)

      const obstacle: Obstacle = { x, z, r: 0.55 }
      obstacles.push(obstacle)
      this.trees.push({ object, x, z, obstacle, cut: false })
    }
  }

  /** True once every tree is down — i.e. the farm exists. */
  get opened() {
    return this.trees.every((t) => t.cut)
  }

  get remaining() {
    return this.trees.filter((t) => !t.cut).length
  }

  /** The tree the player is standing next to, or null. */
  targetNear(pos: THREE.Vector3): Standing | null {
    let best: Standing | null = null
    let bestDist = REACH
    for (const t of this.trees) {
      if (t.cut) continue
      const d = Math.hypot(t.x - pos.x, t.z - pos.z)
      if (d < bestDist) {
        bestDist = d
        best = t
      }
    }
    return best
  }

  /**
   * Fell the nearest tree. The caller has already taken the coins.
   *
   * The collider is disabled rather than removed: the obstacle array is shared
   * with every tree, rock and building in the world and is scanned by index
   * every frame, so splicing out of it mid-session would be a needless reshuffle
   * of several thousand entries to save four.
   */
  cutNear(pos: THREE.Vector3): boolean {
    const tree = this.targetNear(pos)
    if (!tree) return false

    tree.cut = true
    tree.obstacle.off = true
    this.group.remove(tree.object)
    this.onCut?.(new THREE.Vector3(tree.x, groundHeight(tree.x, tree.z), tree.z))
    if (this.opened) this.onOpened?.()
    return true
  }

  /**
   * Take every tree down at once, without payment or effects.
   *
   * For a restored save: the clearing is already cut, and the trees must not be
   * standing in the middle of a farm the player has been working for hours.
   */
  restoreOpened() {
    for (const tree of this.trees) {
      if (tree.cut) continue
      tree.cut = true
      tree.obstacle.off = true
      this.group.remove(tree.object)
    }
  }
}
