import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { createAlertMarker } from '../assets/alert-marker'
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

/**
 * How far land can be claimed from ground you already hold.
 *
 * Expansion has to spread outward from home rather than letting a rich player
 * buy the far corner of the valley first: land you cannot walk to past land you
 * do not own is not an expansion, it is a teleport. Sized so the nearest parcel
 * is reachable from the farm and each one after that opens its neighbours.
 */
export const CLAIM_REACH = 34

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
  /**
   * How the player can tell this stand of trees is for sale.
   *
   * Without it a plot is twenty-six trees indistinguishable from the forest
   * around them, and the only way to discover one is to walk into its edge and
   * happen to see a prompt. Two marks, because they answer different questions
   * from different distances: a marker floating over the canopy says *there is
   * something here* from across the valley, and the signpost at the near edge
   * says *this ground is for sale* once you have walked over.
   */
  sign: THREE.Group
  marker: THREE.Group
}

/** How high above the stand the for-sale marker floats. */
const MARKER_Y = PROP_HEIGHT.tree * 1.15

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

      /*
       * The signpost goes on the edge facing the middle of the valley, which is
       * the side every approach comes from — the farm, the lane and the square
       * are all inboard of these parcels.
       */
      const inward = new THREE.Vector2(-plot.x, -plot.z).normalize()
      const sx = plot.x + inward.x * (HALF + 0.9)
      const sz = plot.z + inward.y * (HALF + 0.9)
      const sign = modelGroup(getModels().signpost, PROP_HEIGHT.signpost)
      sign.position.set(sx, groundHeight(sx, sz), sz)
      sign.rotation.y = Math.atan2(inward.x, inward.y)
      this.group.add(sign)
      obstacles.push({ x: sx, z: sz, r: 0.3 })

      // The same "!" the shop and the neighbours use, so one mark means one
      // thing everywhere in the game.
      const marker = createAlertMarker(1.7)
      // Alert markers ship hidden — their usual callers toggle them per request.
      // A plot for sale is always for sale, so it is up from the first frame.
      marker.visible = true
      marker.position.set(plot.x, groundHeight(plot.x, plot.z) + MARKER_Y, plot.z)
      this.group.add(marker)

      const bench = modelGroup(getModels().workbench, PROP_HEIGHT.workbench)
      bench.position.set(plot.x, groundHeight(plot.x, plot.z), plot.z)
      // Turned to face roughly homeward, so it reads as set up rather than dropped.
      bench.rotation.y = Math.atan2(-plot.x, -plot.z)
      bench.visible = false
      this.group.add(bench)

      this.group.add(group)
      this.stands.push({ plot, group, obstacles: mine, felling: null, bench, sign, marker })
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

  /**
   * Within reach of the farm or of land already owned.
   *
   * The frontier, in other words — which is both the rule and the thing the
   * land map draws.
   */
  canBuy(id: number, farmCentre: THREE.Vector3) {
    if (this.owned.has(id)) return false
    const plot = WORLD_PLOTS[id]
    if (!plot) return false
    if (Math.hypot(plot.x - farmCentre.x, plot.z - farmCentre.z) <= CLAIM_REACH) return true
    for (const owned of this.owned) {
      const o = WORLD_PLOTS[owned]
      if (Math.hypot(plot.x - o.x, plot.z - o.z) <= CLAIM_REACH) return true
    }
    return false
  }

  /** Every plot with its state, for the land map. */
  survey(farmCentre: THREE.Vector3) {
    return WORLD_PLOTS.map((plot) => ({
      plot,
      owned: this.owned.has(plot.id),
      buyable: this.canBuy(plot.id, farmCentre),
      distance: Math.hypot(plot.x - farmCentre.x, plot.z - farmCentre.z),
    }))
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
    // Bought: it is not for sale any more, so neither mark belongs.
    stand.sign.visible = false
    stand.marker.visible = false
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
      stand.sign.visible = false
      stand.marker.visible = false
      stand.felling = null
      for (const o of stand.obstacles) o.off = true
    }
  }

  serialize() {
    return [...this.owned].sort((a, b) => a - b)
  }

  /**
   * Show the for-sale marks only on land that can actually be claimed.
   *
   * A signpost on a parcel four expansions away advertises something the player
   * cannot buy, and eight at once turns the valley into a wall of markers. The
   * frontier alone is the useful set.
   */
  refreshMarks(farmCentre: THREE.Vector3) {
    for (const stand of this.stands) {
      const on = this.canBuy(stand.plot.id, farmCentre)
      stand.sign.visible = on
      stand.marker.visible = on
    }
  }

  update(dt: number, camera?: THREE.Camera, elapsed = 0) {
    for (const stand of this.stands) {
      if (stand.marker.visible) {
        // Billboarded and bobbing, exactly like the shop's.
        if (camera) stand.marker.quaternion.copy(camera.quaternion)
        stand.marker.position.y =
          groundHeight(stand.plot.x, stand.plot.z) + MARKER_Y + Math.sin(elapsed * 2 + stand.plot.id) * 0.35
      }
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
