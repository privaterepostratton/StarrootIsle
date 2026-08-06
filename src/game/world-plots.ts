import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { groundHeight } from './terrain'
import { TILE_SIZE } from './farm'
import type { Obstacle } from './world'

/**
 * Land beyond the farm, bought a plot at a time.
 *
 * The garden the player starts with grows to a fixed ceiling — see
 * GARDEN_LEVELS — and after that the only way to have more is to own more
 * *ground*. These are that ground: fixed parcels laid over the valley, each big
 * enough for an 8x8 garden or whatever else ends up being worth building, and
 * each covered in trees until it is paid for.
 *
 * Covered in trees rather than merely outlined, because that is the same
 * language the opening already teaches: land you do not own is woodland, and
 * owning it means clearing it. A dotted rectangle on the grass would be a UI
 * element pretending to be a place.
 *
 * Positions are baked rather than fitted at runtime. They were found by walking
 * a grid over the terrain and keeping every square entirely clear of sand,
 * water, slope, the lane, the market square, the pasture, the barn and every
 * fenced farm — see fit-plots against the same constants. Baking them keeps a
 * plot's identity stable across sessions, which a save file depends on.
 */

/** An 8x8 garden plus its fence margin. */
export const PLOT_SIZE = 8 * TILE_SIZE + 1.6
const HALF = PLOT_SIZE / 2

export interface WorldPlot {
  id: number
  x: number
  z: number
}

/**
 * The eight nearest legal parcels, in the order a player would meet them.
 *
 * Eight because the price ladder wants to stay meaningful: with twenty-three
 * the last few would be rounding errors on a late-game balance, and the point
 * of a plot is that buying one is a decision you remember.
 */
export const WORLD_PLOTS: WorldPlot[] = [
  { id: 0, x: -18.3, z: -27.4 },
  { id: 1, x: -4.6, z: -27.4 },
  { id: 2, x: -4.6, z: 27.4 },
  { id: 3, x: 9.1, z: -27.4 },
  { id: 4, x: 9.1, z: 27.4 },
  { id: 5, x: 9.1, z: -41.1 },
  { id: 6, x: 22.8, z: -27.4 },
  { id: 7, x: 22.8, z: 27.4 },
]

/**
 * What the next plot costs, given how many are already owned.
 *
 * Steeper than the bed ladder and shallower than the garden upgrades: a plot
 * should be a week's ambition rather than an afternoon's, and there are only
 * eight of them to sell.
 */
export function plotPrice(owned: number) {
  return Math.round(2500 * Math.pow(1.85, Math.max(0, owned)))
}

/** How close the player has to stand for the sale prompt. */
export const PLOT_REACH = 3.2

/** Trees per unbought plot. Dense enough to read as woodland, not as scenery. */
const TREES_PER_PLOT = 26
/** Seconds a felled stand takes to come down when a plot is bought. */
const FELL_SECONDS = 1.4

interface Stand {
  plot: WorldPlot
  group: THREE.Group
  obstacles: Obstacle[]
  /** Null unless this stand is mid-fall. */
  felling: number | null
  /**
   * The workbench that stands on the plot once it is cleared.
   *
   * Cleared ground with nothing on it reads as ground the game forgot about —
   * the player paid thousands of coins for a lawn. A workbench says the plot is
   * *theirs and awaiting a decision*, which is exactly what it is until there is
   * something to build here.
   */
  bench: THREE.Group
}

export class WorldPlots {
  readonly group = new THREE.Group()
  private readonly stands: Stand[] = []
  private readonly owned = new Set<number>()

  /** Fires when a plot is cleared, for the burst and the camera. */
  onCleared: ((plot: WorldPlot, at: THREE.Vector3) => void) | null = null

  constructor(obstacles: Obstacle[], rand: () => number = Math.random) {
    for (const plot of WORLD_PLOTS) {
      const group = new THREE.Group()
      const mine: Obstacle[] = []

      for (let i = 0; i < TREES_PER_PLOT; i++) {
        // Inside the parcel with a margin, so the stand reads as filling it
        // rather than as a hedge around its edge.
        const x = plot.x + (rand() - 0.5) * 2 * (HALF - 1.2)
        const z = plot.z + (rand() - 0.5) * 2 * (HALF - 1.2)
        const conifer = rand() < 0.35
        const model = conifer ? getModels().pine : getModels().tree
        const height = (conifer ? PROP_HEIGHT.pine : PROP_HEIGHT.tree) * (0.8 + rand() * 0.45)
        const tree = modelGroup(model, height)
        tree.position.set(x, groundHeight(x, z), z)
        tree.rotation.y = rand() * Math.PI * 2
        group.add(tree)

        const o: Obstacle = { x, z, r: 0.55 }
        obstacles.push(o)
        mine.push(o)
      }

      const bench = modelGroup(getModels().workbench, PROP_HEIGHT.workbench)
      bench.position.set(plot.x, groundHeight(plot.x, plot.z), plot.z)
      // Turned to face roughly homeward, so it reads as set up rather than dropped.
      bench.rotation.y = Math.atan2(-plot.x, -plot.z)
      bench.visible = false
      this.group.add(bench)

      this.group.add(group)
      this.stands.push({ plot, group, obstacles: mine, felling: null, bench })
    }
  }

  get ownedCount() {
    return this.owned.size
  }

  isOwned(id: number) {
    return this.owned.has(id)
  }

  get nextPrice() {
    return plotPrice(this.owned.size)
  }

  /** The plot the player is standing on or beside, owned or not. */
  nearest(pos: THREE.Vector3): WorldPlot | null {
    let best: WorldPlot | null = null
    let bestDist = Infinity
    for (const plot of WORLD_PLOTS) {
      // Distance to the parcel's edge, not its middle — a plot is a place you
      // walk up to, and its middle is behind a wall of trees.
      const dx = Math.max(0, Math.abs(pos.x - plot.x) - HALF)
      const dz = Math.max(0, Math.abs(pos.z - plot.z) - HALF)
      const d = Math.hypot(dx, dz)
      if (d < bestDist) {
        bestDist = d
        best = plot
      }
    }
    return bestDist <= PLOT_REACH ? best : null
  }

  /** Buy and clear a plot. The caller has already taken the coins. */
  claim(id: number) {
    if (this.owned.has(id)) return false
    this.owned.add(id)
    const stand = this.stands[id]
    stand.felling = 0
    stand.bench.visible = true
    // The colliders go the moment it is bought: the player owns this ground now
    // and must not be shouldered out of it by trees that are still falling.
    for (const o of stand.obstacles) o.off = true
    this.onCleared?.(stand.plot, new THREE.Vector3(stand.plot.x, groundHeight(stand.plot.x, stand.plot.z), stand.plot.z))
    return true
  }

  /** Clear owned plots outright, for a restored save. */
  restore(ids: readonly number[]) {
    for (const id of ids) {
      if (id < 0 || id >= this.stands.length) continue
      this.owned.add(id)
      const stand = this.stands[id]
      stand.group.visible = false
      stand.bench.visible = true
      stand.felling = null
      for (const o of stand.obstacles) o.off = true
    }
  }

  serialize() {
    return [...this.owned].sort((a, b) => a - b)
  }

  update(dt: number) {
    for (const stand of this.stands) {
      if (stand.felling === null) continue
      stand.felling += dt / FELL_SECONDS
      if (stand.felling >= 1) {
        stand.group.visible = false
        stand.group.scale.setScalar(1)
        stand.felling = null
        continue
      }
      // Sinking rather than toppling: two dozen trees falling individually is a
      // fine effect for four of them and a mess for twenty-six.
      stand.group.scale.setScalar(1 - stand.felling)
    }
  }
}
