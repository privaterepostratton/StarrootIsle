import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { createAlertMarker } from '../assets/alert-marker'
import { rng } from '../assets/style'
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

// --- what can be built on cleared ground -------------------------------------

/**
 * What a bought plot can be turned into.
 *
 * Every one of these yields on a timer and is collected by walking up to it,
 * which is the loop the pasture already teaches — an animal fills, shows a
 * bubble, and is collected by hand. Land that produced nothing would make the
 * decision at the workbench a decorating choice, and a parcel costs thousands
 * of coins.
 *
 * They are told apart by *what they pay in* rather than by how fast: the
 * orchard is coins, the woodlot is timber, the meadow is fiber and blooms. A
 * player who needs wood for a fence and a player saving for the next parcel
 * want different ground, and that is the whole choice being offered.
 */
export type PlotBuildId = 'orchard' | 'woodlot' | 'meadow'

export interface PlotYield {
  /** Coins paid on collection. */
  coins: number
  /** Material stacked into the bag, if any. */
  material: { id: string; amount: number } | null
  xp: number
  /** How the haul is announced. */
  emoji: string
  label: string
}

export interface PlotBuildDef {
  id: PlotBuildId
  name: string
  emoji: string
  /** ui/icons id, with the emoji as the fallback. */
  icon: string
  price: number
  unlockLevel: number
  blurb: string
  /** Seconds to fill, at the base rate. */
  interval: number
  yield: PlotYield
}

export const PLOT_BUILDS: PlotBuildDef[] = [
  {
    id: 'meadow',
    name: 'Flower Meadow',
    emoji: '🌼',
    icon: 'flowerbed',
    price: 900,
    unlockLevel: 1,
    blurb: 'Beds of mixed blooms, cut for fiber and sold by the armful.',
    interval: 180,
    yield: { coins: 210, material: { id: 'fiber', amount: 4 }, xp: 14, emoji: '🌼', label: 'Cut flowers' },
  },
  {
    id: 'woodlot',
    name: 'Woodlot',
    emoji: '🌲',
    icon: 'wood',
    price: 2200,
    unlockLevel: 4,
    blurb: 'A stand of firs coppiced for timber. Never needs replanting.',
    interval: 300,
    yield: { coins: 120, material: { id: 'wood', amount: 8 }, xp: 22, emoji: '🪵', label: 'Cut timber' },
  },
  {
    id: 'orchard',
    name: 'Orchard',
    emoji: '🍎',
    icon: 'apple',
    price: 4800,
    unlockLevel: 6,
    blurb: 'Fruit trees in rows. The slowest ground to work, and the richest.',
    interval: 420,
    yield: { coins: 1150, material: null, xp: 40, emoji: '🍎', label: 'Picked fruit' },
  },
]

export const PLOT_BUILD_BY_ID = new Map(PLOT_BUILDS.map((b) => [b.id, b]))

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
  /** What was built here, or null while the ground is still bare. */
  build: PlotBuildDef | null
  /** The props that build put on the ground. */
  built: THREE.Group | null
  /** Seconds toward the next harvest. */
  timer: number
}

/**
 * The props a finished build puts on the ground.
 *
 * Laid out from a seed of the plot's own id, so the same parcel always grows
 * the same orchard and two neighbouring builds of one kind are not copies of
 * each other. Nothing here takes a collider: the player has to be able to walk
 * their own land, and a woodlot they cannot step into is a wall.
 */
function buildProps(kind: PlotBuildId, plot: WorldPlot): THREE.Group {
  const g = new THREE.Group()
  const r = rng(plot.id * 9176 + kind.charCodeAt(0) * 31)
  const models = getModels()

  /** A ring of positions inside the parcel, jittered off the grid. */
  const spots = (count: number, spread: number) => {
    const out: [number, number][] = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.5
      const d = spread * (0.35 + r() * 0.62)
      out.push([plot.x + Math.cos(a) * d, plot.z + Math.sin(a) * d])
    }
    return out
  }

  const place = (object: THREE.Object3D, x: number, z: number, yaw: number) => {
    object.position.set(x, groundHeight(x, z), z)
    object.rotation.y = yaw
    g.add(object)
  }

  if (kind === 'orchard') {
    // Rows, because an orchard is a planted thing — a scatter would read as the
    // woodland the player just paid to clear.
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x = plot.x + (col - 1) * (HALF * 0.62)
        const z = plot.z + (row - 0.5) * (HALF * 0.9)
        const tree = modelGroup(models.tree, PROP_HEIGHT.tree * (0.52 + r() * 0.08))
        place(tree, x + (r() - 0.5) * 0.6, z + (r() - 0.5) * 0.6, r() * Math.PI * 2)
      }
    }
  } else if (kind === 'woodlot') {
    for (const [x, z] of spots(9, HALF - 1.4)) {
      const fir = modelGroup(models.pine, PROP_HEIGHT.pine * (0.55 + r() * 0.3))
      place(fir, x, z, r() * Math.PI * 2)
    }
    for (const [x, z] of spots(3, HALF - 2.4)) {
      place(modelGroup(models.stump, PROP_HEIGHT.stump), x, z, r() * Math.PI * 2)
    }
  } else {
    for (const [x, z] of spots(7, HALF - 1.6)) {
      place(modelGroup(models.flowerBed, PROP_HEIGHT.flowerBed), x, z, r() * Math.PI * 2)
    }
    for (const [x, z] of spots(5, HALF - 1.2)) {
      place(modelGroup(models.bush, PROP_HEIGHT.bush * (0.7 + r() * 0.4)), x, z, r() * Math.PI * 2)
    }
  }
  return g
}

/** How high above the stand the for-sale marker floats. */
const MARKER_Y = PROP_HEIGHT.tree * 1.15
/** And how high once the trees are down and something has been built. */
const BUILT_MARKER_Y = 3.6

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
      this.stands.push({
        plot,
        group,
        obstacles: mine,
        felling: null,
        bench,
        sign,
        marker,
        build: null,
        built: null,
        timer: 0,
      })
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

  // --- building ---------------------------------------------------------

  /** What stands on this plot, or null if it is bare ground. */
  buildOn(id: number): PlotBuildDef | null {
    return this.stands[id]?.build ?? null
  }

  /** How far this plot is toward its next harvest, 0..1. */
  progressOf(id: number) {
    const stand = this.stands[id]
    if (!stand?.build) return 0
    return Math.min(1, stand.timer / stand.build.interval)
  }

  /**
   * The nearest owned plot the player could act on, and what it wants.
   *
   * One query rather than three, because the answer is one prompt: bare ground
   * offers the workbench, a full plot offers its harvest, and a plot still
   * filling offers nothing at all. Splitting it left the caller asking the same
   * distance question three times and getting three different plots back.
   */
  atHand(pos: THREE.Vector3): { plot: WorldPlot; state: 'bare' | 'ready' | 'growing'; build: PlotBuildDef | null; progress: number } | null {
    const plot = this.nearest(pos)
    if (!plot || !this.owned.has(plot.id)) return null
    const stand = this.stands[plot.id]
    if (!stand.build) return { plot, state: 'bare', build: null, progress: 0 }
    const progress = Math.min(1, stand.timer / stand.build.interval)
    return { plot, state: progress >= 1 ? 'ready' : 'growing', build: stand.build, progress }
  }

  /** Put a building up. The caller has already taken the coins. */
  construct(id: number, buildId: PlotBuildId) {
    const stand = this.stands[id]
    const def = PLOT_BUILD_BY_ID.get(buildId)
    if (!stand || !def || !this.owned.has(id) || stand.build) return false
    stand.build = def
    stand.timer = 0
    // The bench was a promise that something would go here. Something has.
    stand.bench.visible = false
    stand.built = buildProps(def.id, stand.plot)
    this.group.add(stand.built)
    stand.marker.visible = false
    return true
  }

  /**
   * Take the harvest, if there is one. Returns what was collected.
   *
   * The timer restarts from zero rather than carrying the overflow: a plot left
   * full for a day would otherwise bank a queue of harvests and pay them out in
   * a row, which turns the walk out here into a chore to be batched rather than
   * a reason to visit.
   */
  collect(id: number): PlotBuildDef | null {
    const stand = this.stands[id]
    if (!stand?.build || stand.timer < stand.build.interval) return null
    stand.timer = 0
    stand.marker.visible = false
    return stand.build
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
   * What has been built, and how far along each one is.
   *
   * Kept apart from the owned list rather than folded into it so a save written
   * before anything could be built still loads: an owned plot with no entry
   * here is bare ground, which is exactly what those saves describe.
   */
  serializeBuilds(): [number, PlotBuildId, number][] {
    const out: [number, PlotBuildId, number][] = []
    for (const stand of this.stands) {
      if (stand.build) out.push([stand.plot.id, stand.build.id, Math.round(stand.timer)])
    }
    return out
  }

  restoreBuilds(entries: readonly [number, PlotBuildId, number][] | undefined) {
    for (const [id, buildId, timer] of entries ?? []) {
      if (!this.construct(id, buildId)) continue
      const stand = this.stands[id]
      stand.timer = Math.max(0, Math.min(stand.build!.interval, timer))
      // A plot that filled up while the player was away is waiting for them.
      if (stand.timer >= stand.build!.interval) stand.marker.visible = true
    }
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
      // Owned ground is not for sale, and its marker means something else now —
      // taking it down here would clear a harvest the player has not collected.
      if (this.owned.has(stand.plot.id)) continue
      const on = this.canBuy(stand.plot.id, farmCentre)
      stand.sign.visible = on
      stand.marker.visible = on
    }
  }

  update(dt: number, camera?: THREE.Camera, elapsed = 0) {
    for (const stand of this.stands) {
      /*
       * The same "!" serves two jobs, one after the other: for sale while the
       * trees are up, harvest ready once something is built. They can never
       * both apply to one plot — a parcel is either for sale or owned — so one
       * marker is honest rather than merely thrifty.
       */
      if (stand.build && stand.timer < stand.build.interval) {
        stand.timer += dt
        if (stand.timer >= stand.build.interval) stand.marker.visible = true
      }
      if (stand.marker.visible) {
        // Billboarded and bobbing, exactly like the shop's.
        if (camera) stand.marker.quaternion.copy(camera.quaternion)
        // Over the canopy while the stand is up; over head height once it is a
        // meadow, where a mark at treetop level would be floating in the sky.
        const y = stand.build ? BUILT_MARKER_Y : MARKER_Y
        stand.marker.position.y =
          groundHeight(stand.plot.x, stand.plot.z) + y + Math.sin(elapsed * 2 + stand.plot.id) * 0.35
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
