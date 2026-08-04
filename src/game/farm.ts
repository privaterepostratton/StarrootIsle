import * as THREE from 'three'
import { MINOR_LAYER } from '../assets/style'
import { getGroundTextures, tiled } from '../assets/textures'
import { getModels } from '../assets/models'
import { createCropModel } from '../assets/crops'
import { createSparkle, type Sparkle } from '../assets/sparkle'
import { createPlotMarkers, type PlotMarkerField } from '../assets/plot-marker'
import { createPlotHighlight, type PlotHighlight } from '../assets/plot-highlight'
import { createSprinklerModel, createCoverageDecal, type SprinklerModel } from '../assets/sprinkler'
import { SPRINKLER_BY_ID, type SprinklerTier, type SprinklerTierId } from './sprinklers'
import {
  rollRarity,
  rollMutation,
  rollWeight,
  RARITY_BY_ID,
  type RarityId,
  type MutationContext,
  type MutationDef,
} from './mutations'
import {
  CROP_BY_ID,
  GROWTH_STAGES,
  WATER_DURATION,
  WATER_GROWTH_MULTIPLIER,
  growSecondsFor,
  stageForProgress,
  type CropDef,
} from './crops'

export const TILE_SIZE = 1.2
/**
 * Maximum extent of the farm. Only tiles the player has bought are usable, and
 * only those inside the cleared span (see `Farm.span`) can be bought at all.
 *
 * Odd on both axes so the span below is symmetrical about the centre — an even
 * grid cannot hold a centred 5x5 without favouring one side by half a tile.
 */
export const GRID_W = 13
export const GRID_H = 13

/**
 * The clearing you cut out of the forest, in tiles per side.
 *
 * The farm no longer starts as a block of beds handed over at spawn. You arrive
 * with nothing, clear trees to open a patch of ground, and that patch is what
 * bounds the farm — beds are bought inside it, and buying more *land* is a
 * separate, larger purchase that widens the clearing by a ring.
 *
 * Two axes of growth rather than one, because they answer different questions:
 * a bed is "I want another row of turnips this afternoon", a clearing is "my
 * farm is too small". Collapsing them into a single per-tile purchase is what
 * made expansion read as a formality once coins started flowing.
 */
export const PLOT_SPAN_START = 5
export const PLOT_SPAN_MAX = Math.min(GRID_W, GRID_H)
/** Each upgrade adds a ring — one tile on every side. */
export const PLOT_SPAN_STEP = 2

/** Cost of widening the clearing from `span` to the next size up. */
export function expansionCost(span: number) {
  const steps = Math.max(0, (span - PLOT_SPAN_START) / PLOT_SPAN_STEP)
  return Math.round(600 * Math.pow(2.15, steps))
}

/** Plots the player owns once the first clearing is cut. */
export const STARTING_PLOTS = 4

/** Cost of the next plot, given how many are already owned. Escalating so
 *  expansion stays a meaningful goal rather than a formality once coins flow. */
export function plotCost(owned: number) {
  const extra = Math.max(0, owned - STARTING_PLOTS)
  return Math.round(30 * Math.pow(1.28, extra))
}

export type TileState = 'grass' | 'tilled'

export interface PlantedCrop {
  def: CropDef
  /** 0..1 ripeness. */
  progress: number
  stage: number
  model: THREE.Group
  /** Set when the crop finishes, drives the little "ready" bounce. */
  readyAt: number
  /** Rolled once at planting; drives the fruit tint and the value multiplier. */
  rarity: RarityId
  /** Mutations picked up from the conditions this plant has lived through. */
  mutations: Set<string>
  /** Per-plant seed, so height, girth and fruit size survive stage rebuilds. */
  seed: number
  /**
   * Per-plant size multiplier, derived deterministically from the seed.
   *
   * Most plants land close to 1x; a lucky roll grows a visible giant. Derived
   * rather than stored so it costs nothing in the save format and can never
   * disagree with the seed it came from.
   */
  sizeRoll: number
  /** Orbiting motes shown once ripe. */
  sparkle: Sparkle | null
  /** Seconds until the next mutation roll. */
  mutationTimer: number
  /** Pickings left before the plant is spent. */
  harvestsLeft: number
  /** True while a multi-harvest plant is regrowing its fruit. */
  regrowing: boolean
  /** Elapsed time the current growth tween started, or -1 when settled. */
  tweenAt: number
  /** Scale the tween starts from, as a fraction of the plant's final size. */
  tweenFrom: number
}

/** Everything a harvest hands back. */
export interface HarvestResult {
  def: CropDef
  amount: number
  rarity: RarityId
  mutations: string[]
  /** Total kg picked across every fruit in this harvest. */
  weightKg: number
  /** Heaviest single fruit, for the "personal best" brag. */
  heaviestKg: number
  /** True if the plant survived and will regrow. */
  regrowing: boolean
}

/** How often a growing crop rolls for a new mutation. */
const MUTATION_TICK = 3.5

/**
 * Seconds a scale ease takes to settle.
 *
 * Used for the plant-in pop and for the settle after a regrow steps a stage
 * down. Growth itself is no longer a series of eases — see GROW_FROM_SCALE.
 */
const GROW_TWEEN = 0.55

/**
 * Continuous growth: how big a plant is at progress 0, as a fraction of its
 * final size.
 *
 * Stage meshes change the plant's *shape* a handful of times; this changes its
 * *size* every frame in between. Without it a crop spent each stage frozen at
 * one size and then jumped, so growth read as four discrete events rather than
 * as a plant getting bigger — which is the thing the player is actually waiting
 * for. A seedling at a third of final size still reads as a seedling.
 */
const GROW_FROM_SCALE = 0.32

/**
 * Ceiling on the size *lottery* — a multiplier, not a size.
 *
 * Separate from MAX_CROP_SCALE below because they limit different things, and
 * conflating them flattened every giant to one height: the roll multiplies a
 * model whose own jitter already reaches 1.82, so a cap set at the roll's scale
 * clamped almost every large plant to exactly the same final size and destroyed
 * the variety the roll exists to create.
 */
const MAX_SIZE_ROLL = 1.9

/**
 * Hard ceiling on a plant's final scale, on any axis.
 *
 * Unbounded, the tail of the lottery produced plants that clipped the camera
 * and covered neighbouring plots. Set above the natural jitter maximum (1.82)
 * so ordinary big plants are untouched and only the genuine extremes are
 * trimmed — the clamp is a safety rail, not the thing that sets plant size.
 */
export const MAX_CROP_SCALE = 3

export interface TileSprinkler {
  tier: SprinklerTier
  model: SprinklerModel
  coverage: THREE.Mesh
}

export interface Tile {
  gx: number
  gz: number
  /** Has the player bought this plot? Unbought tiles are plain grass. */
  placed: boolean
  state: TileState
  crop: PlantedCrop | null
  /** Sprinkler standing on this plot. Occupies it — nothing can be planted. */
  sprinkler: TileSprinkler | null
  /** Seconds of moisture left. Zero means dry. */
  water: number
  soil: THREE.Mesh | null
  /** World-space centre of the tile. */
  pos: THREE.Vector3
}

/** What the player can do to a tile right now. */
export type TileAction = 'till' | 'plant' | 'water' | 'harvest' | 'none'

/** Slightly inset so neighbouring plots leave a visible grass seam between
 *  them — that gap is what makes the grid readable at a glance. */
const plotGeo = new THREE.PlaneGeometry(TILE_SIZE * 0.88, TILE_SIZE * 0.88)
plotGeo.rotateX(-Math.PI / 2)

let padMatLight: THREE.MeshLambertMaterial | null = null
let padMatDark: THREE.MeshLambertMaterial | null = null

/**
 * Placement of the authored planter tray on a tile.
 *
 * Derived from the model's own bounding box rather than hardcoded, so swapping
 * the GLB for a different tray does not silently leave it floating or sunk. The
 * scale fits the model's larger horizontal extent to a tile with a hair of
 * overlap, and TRAY_SURFACE reports where its top face ends up — which is where
 * crops have to be planted.
 */
let trayFit: { scale: number; originY: number; surfaceY: number } | null = null

function plotTrayFit() {
  if (!trayFit) {
    const box = getModels().plotTray.geometry.boundingBox!
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    // Exactly one tile, not a hair over. The tray has a raised rim, so oversizing
    // it makes the rims of neighbouring trays interpenetrate and z-fight.
    const scale = TILE_SIZE / width
    // Sit the model's underside on the tile, and report its top.
    const originY = -box.min.y * scale
    trayFit = { scale, originY, surfaceY: originY + box.max.y * scale }
  }
  return trayFit
}

/** Height of the planting surface above a tile's origin. */
export function soilSurfaceY() {
  return plotTrayFit().surfaceY
}

/** Scale and lift for placing the planter on a tile. Exported so the neighbours'
 *  beds sit exactly like the player's rather than re-deriving the numbers. */
export function plotTrayPlacement() {
  const fit = plotTrayFit()
  return { scale: fit.scale, originY: fit.originY }
}

let trayMatWet: THREE.Material | null = null

/**
 * The tray's own material, exactly as authored in the glTF.
 *
 * Watering uses a clone tinted darker rather than a separately built material:
 * `color` multiplies the baseColour map, so the wet state costs one extra
 * material and *no* extra texture upload, and it cannot drift out of step with
 * however the model happens to be shaded.
 */
function trayMaterial(wet: boolean) {
  const authored = getModels().plotTray.material
  if (!wet) return authored

  if (!trayMatWet) {
    const damp = authored.clone() as THREE.MeshStandardMaterial
    damp.color.setHex(0x8a7c72)
    trayMatWet = damp
  }
  return trayMatWet
}

/**
 * Soil palette.
 *
 * Warm and red rather than the grey-brown a "dirt" colour picker lands on. The
 * reddish cast is what makes a bed read as fertile turned earth next to
 * saturated green foliage; a neutral brown next to that green just goes muddy.
 *
 * The gap between the pad and the tilled colours is doing real work: an owned
 * but untilled plot and a tilled one are two different game states, and tilling
 * is a player action that has to visibly *do* something. When these values sat
 * close together the action looked like it had failed. Pads are pale dry dust;
 * tilled soil is markedly darker, the way turned earth actually is.
 */
const C_PAD_LIGHT = 0xdcb994
const C_PAD_DARK = 0xcba881

function plotPadMaterial(light: boolean) {
  if (light) {
    if (!padMatLight) {
      padMatLight = new THREE.MeshLambertMaterial({
        map: tiled(getGroundTextures().dirt, 1.35),
        color: C_PAD_LIGHT,
      })
    }
    return padMatLight
  }
  if (!padMatDark) {
    padMatDark = new THREE.MeshLambertMaterial({
      map: tiled(getGroundTextures().dirt, 1.35),
      color: C_PAD_DARK,
    })
  }
  return padMatDark
}


export class Farm {
  readonly group = new THREE.Group()
  readonly tiles: Tile[] = []

  /** Highlight quad that snaps to the tile the player is standing next to. */
  private readonly highlight: PlotHighlight
  /** Which tile the highlight is on, and how long it has been there. */
  private highlightTile: Tile | null = null
  private highlightAge = 0

  /** Mown-earth pads. Only visible on tiles the player owns and has not tilled. */
  private readonly plotPads: THREE.Mesh[] = []

  /** Ghost pad shown under the cursor while the shovel is out. */
  private readonly ghost: THREE.Mesh

  /** One marker per tile the shovel could buy right now. */
  private buySpots: PlotMarkerField | null = null
  /** Seconds the marker field has been up, for its appear and pulse. */
  private buySpotsAge = 0

  /**
   * Crop models mid-exit: squashed, popped and dropped rather than deleted.
   *
   * A plant that blinks out of existence the instant it is picked leaves the
   * harvest with no physical read at all — the produce flies to the player, but
   * the *plant* is simply gone between frames. Handing the model to this list
   * instead lets it stretch upward as if pulled, then collapse, which is what
   * makes picking feel like an action performed on something.
   */
  private readonly exiting: { object: THREE.Object3D; base: THREE.Vector3; age: number; life: number }[] = []

  /** Tile index -> best sprinkler luck bonus covering it. Rebuilt on change. */
  private readonly coverageLuck = new Map<number, number>()

  constructor(private readonly origin = new THREE.Vector3(0, 0, 2)) {
    for (let gz = 0; gz < GRID_H; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        this.tiles.push({
          gx,
          gz,
          placed: false,
          state: 'grass',
          crop: null,
          sprinkler: null,
          water: 0,
          soil: null,
          pos: this.tileWorldPos(gx, gz),
        })
      }
    }

    // Checkerboard the pads so an owned plot reads as a tended bed rather than
    // as a flat patch of colour.
    for (const tile of this.tiles) {
      const light = (tile.gx + tile.gz) % 2 === 0
      const pad = new THREE.Mesh(plotGeo, plotPadMaterial(light))
      pad.receiveShadow = true
      pad.position.copy(tile.pos)
      pad.position.y += 0.02
      pad.visible = false
      pad.layers.set(MINOR_LAYER)
      this.group.add(pad)
      this.plotPads.push(pad)
    }

    this.highlight = createPlotHighlight(TILE_SIZE)
    this.highlight.mesh.visible = false
    this.highlight.mesh.layers.set(MINOR_LAYER)
    this.group.add(this.highlight.mesh)

    this.ghost = new THREE.Mesh(
      plotGeo,
      new THREE.MeshBasicMaterial({
        color: 0x7ce87c,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    )
    this.ghost.visible = false
    this.ghost.renderOrder = 3
    this.ghost.layers.set(MINOR_LAYER)
    this.group.add(this.ghost)

    /*
     * No starting beds.
     *
     * The farm used to hand over a block of eight the moment it was constructed,
     * which is right when the player wakes up standing in their own garden. They
     * now wake on a beach owning nothing, and the beds arrive with the clearing
     * — see openClearing, called when the last of the opening trees comes down.
     * Seeding them here as well would put a farm on the ground before the ground
     * was cleared, and the trees would be standing in the middle of it.
     */
  }

  /** A compact block in the middle of the grid, so the first plots are
   *  adjacent and the farm grows outward from a sensible core. */
  private placeStartingPlots() {
    const w = 2
    const h = Math.ceil(STARTING_PLOTS / w)
    const x0 = Math.floor((GRID_W - w) / 2)
    const z0 = Math.floor((GRID_H - h) / 2)

    let placed = 0
    for (let gz = z0; gz < z0 + h && placed < STARTING_PLOTS; gz++) {
      for (let gx = x0; gx < x0 + w && placed < STARTING_PLOTS; gx++) {
        const tile = this.tileAt(gx, gz)
        if (tile) {
          this.setPlaced(tile, true)
          // Tilled, like every other placed plot. Going through setPlaced alone
          // left the *starting* plots as bare ground with no planter, and since
          // nothing offers to till any more, they refused to be planted at all.
          this.till(tile)
          placed++
        }
      }
    }
  }

  private setPlaced(tile: Tile, placed: boolean) {
    tile.placed = placed
    this.plotPads[this.indexOf(tile)].visible = placed && tile.state === 'grass'
  }

  get placedCount() {
    return this.tiles.reduce((n, t) => n + (t.placed ? 1 : 0), 0)
  }

  /**
   * Return the whole plot to bare ground, for a retirement.
   *
   * Goes through the existing removal paths rather than clearing the group
   * wholesale, so sprinkler coverage, plot pads and crop geometry are all torn
   * down properly instead of leaking.
   */
  reset() {
    for (const tile of this.tiles) {
      if (tile.crop) {
        this.clearSparkle(tile.crop)
        this.group.remove(tile.crop.model)
        disposeTree(tile.crop.model)
        tile.crop = null
      }
      if (tile.sprinkler) this.removeSprinkler(tile)
      if (tile.soil) {
        // Removed but *not* disposed: the planter's geometry belongs to the
        // model cache and is shared by every tile — and by the neighbours'
        // instanced beds. Disposing it here would blank every planter in the
        // game the first time anyone retired.
        this.group.remove(tile.soil)
        tile.soil = null
      }
      tile.state = 'grass'
      tile.water = 0
      this.setPlaced(tile, false)
    }

    /**
     * Seed the starting block again before handing the farm back.
     *
     * New plots must touch an existing one, so a farm with nothing placed cannot
     * be expanded — not by a reward, and not by the player with a shovel and a
     * full purse. Retiring used to leave exactly that: zero plots and no legal
     * move. The caller then adds whatever legacy bonus plots are owed on top.
     */
    // A retirement returns the farm to its opening state: the clearing is still
    // cut — that was the tutorial, not a purchase — but every expansion bought
    // on top of it is gone with the rest of the run.
    this.span = PLOT_SPAN_START
    this.placeStartingPlots()
  }

  /**
   * Work out how much ground is cleared from the beds that are on it.
   *
   * Deliberately not a saved field. The span is a bounding box around land the
   * player already owns, so it can always be recovered from the tiles — and
   * recovering it keeps every save written before clearings existed loadable,
   * where adding a field would have needed a migration and a default that was
   * wrong for one of the two cases.
   *
   * Rounded up to the next odd size, because the clearing is symmetrical about
   * the grid centre and an even span cannot be.
   */
  private recoverSpan() {
    const cx = (GRID_W - 1) / 2
    const cz = (GRID_H - 1) / 2
    let reach = -1
    for (const tile of this.tiles) {
      if (!tile.placed) continue
      reach = Math.max(reach, Math.abs(tile.gx - cx), Math.abs(tile.gz - cz))
    }
    if (reach < 0) {
      // Nothing owned: the opening trees are still standing.
      this.span = 0
      return
    }
    const needed = Math.ceil(reach) * 2 + 1
    this.span = Math.min(PLOT_SPAN_MAX, Math.max(PLOT_SPAN_START, needed))
  }

  get nextPlotCost() {
    return plotCost(this.placedCount)
  }

  private indexOf(tile: Tile) {
    return tile.gz * GRID_W + tile.gx
  }

  private tileWorldPos(gx: number, gz: number) {
    return new THREE.Vector3(
      this.origin.x + (gx - (GRID_W - 1) / 2) * TILE_SIZE,
      this.origin.y,
      this.origin.z + (gz - (GRID_H - 1) / 2) * TILE_SIZE,
    )
  }

  tileAt(gx: number, gz: number): Tile | null {
    if (gx < 0 || gz < 0 || gx >= GRID_W || gz >= GRID_H) return null
    return this.tiles[gz * GRID_W + gx]
  }

  /** Nearest tile to a world position, or null if outside the plot + margin. */
  tileNear(world: THREE.Vector3, maxDist = TILE_SIZE * 1.1): Tile | null {
    const gx = Math.round((world.x - this.origin.x) / TILE_SIZE + (GRID_W - 1) / 2)
    const gz = Math.round((world.z - this.origin.z) / TILE_SIZE + (GRID_H - 1) / 2)
    const t = this.tileAt(gx, gz)
    if (!t) return null
    const dx = world.x - t.pos.x
    const dz = world.z - t.pos.z
    if (Math.hypot(dx, dz) > maxDist) return null
    return t
  }

  /**
   * Is this patch of ground one of the farm's beds?
   *
   * Takes loose coordinates rather than a Vector3 so callers outside the scene
   * graph — the decorator's placement rules — can ask without constructing one
   * per frame.
   */
  ownsGroundAt(x: number, z: number, margin = TILE_SIZE * 0.72) {
    const gx = Math.round((x - this.origin.x) / TILE_SIZE + (GRID_W - 1) / 2)
    const gz = Math.round((z - this.origin.z) / TILE_SIZE + (GRID_H - 1) / 2)
    const tile = this.tileAt(gx, gz)
    if (!tile?.placed) return false
    return Math.hypot(x - tile.pos.x, z - tile.pos.z) <= margin
  }

  /** The single contextual action available on this tile. */
  actionFor(tile: Tile | null): TileAction {
    if (!tile || !tile.placed) return 'none'
    // A placed plot is always tilled — see placePlot. The state is kept because
    // saves carry it and `till` still drives the planter's construction.
    if (tile.state === 'grass') return 'none'
    if (!tile.crop) return 'plant'
    if (tile.crop.progress >= 1) return 'harvest'
    if (tile.water <= 0) return 'water'
    return 'none'
  }

  // --- plot placement -----------------------------------------------------

  /** New plots must touch an existing one, so the farm stays a single field
   *  instead of a scatter of disconnected squares. */
  /**
   * The cleared ground, in tiles per side. Beds may only be built inside it.
   *
   * Starts at zero rather than at PLOT_SPAN_START: before the opening trees are
   * cleared the player owns no land at all, and a farm that exists from the
   * first frame would give the clearing nothing to do.
   */
  private span = 0

  get plotSpan() {
    return this.span
  }

  get nextExpansionCost() {
    return expansionCost(this.span)
  }

  get canExpand() {
    return this.span > 0 && this.span < PLOT_SPAN_MAX
  }

  /** Widen the clearing by a ring. Returns false at the maximum. */
  expandPlot() {
    if (!this.canExpand) return false
    this.span += PLOT_SPAN_STEP
    // The buyable-spot markers are cached; the new ring would not appear until
    // the shovel was put away and taken out again without this.
    this.buySpotsAge = 0
    return true
  }

  /**
   * Cut the first clearing. Called once, when the opening trees come down.
   *
   * Idempotent, because the FTUE and a restored save can both reach it and
   * neither should be able to reset a farm that already exists.
   */
  openClearing() {
    if (this.span > 0) return false
    this.span = PLOT_SPAN_START
    this.placeStartingPlots()
    return true
  }

  /** Inside the cleared square, which is centred on the grid. */
  private withinSpan(tile: Tile) {
    if (this.span <= 0) return false
    const half = (this.span - 1) / 2
    const cx = (GRID_W - 1) / 2
    const cz = (GRID_H - 1) / 2
    return Math.abs(tile.gx - cx) <= half && Math.abs(tile.gz - cz) <= half
  }

  canPlace(tile: Tile | null): tile is Tile {
    if (!tile || tile.placed) return false
    // Beds cannot be built on ground that has not been cleared yet.
    if (!this.withinSpan(tile)) return false
    const neighbours: [number, number][] = [
      [tile.gx - 1, tile.gz],
      [tile.gx + 1, tile.gz],
      [tile.gx, tile.gz - 1],
      [tile.gx, tile.gz + 1],
    ]
    return neighbours.some(([x, z]) => this.tileAt(x, z)?.placed)
  }

  /**
   * Buy a plot. It arrives ready to plant.
   *
   * Owning a plot and having it tilled are no longer separate states: there is
   * no reason to make the player perform a second step that has no decision in
   * it and cannot fail. `till` remains as the internal preparation — it is what
   * builds the planter — and is also what a save restores through.
   */
  placePlot(tile: Tile) {
    if (!this.canPlace(tile)) return false
    this.setPlaced(tile, true)
    this.till(tile)
    return true
  }

  /** Preview quad under the cursor while a placement tool is equipped. */
  setGhost(tile: Tile | null, valid: boolean) {
    if (!tile) {
      this.ghost.visible = false
      return
    }
    this.ghost.visible = true
    this.ghost.position.set(tile.pos.x, tile.pos.y + 0.05, tile.pos.z)
    ;(this.ghost.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x7ce87c : 0xe86a5c)
  }

  hideGhost() {
    this.ghost.visible = false
  }

  /**
   * Show (or clear) a marker on every tile the shovel could buy.
   *
   * One ghost under the cursor answers "can I put it here?", but the actual
   * decision the shovel poses is "where should the farm grow?" — and that needs
   * the whole frontier visible at once. Placement rules live in canPlace, so
   * this is purely a projection of them; rebuild after every purchase, because
   * each new plot extends the frontier around itself.
   */
  showBuyableSpots(show: boolean, origin?: THREE.Vector3) {
    if (this.buySpots) {
      this.group.remove(this.buySpots.mesh)
      this.buySpots.dispose()
      this.buySpots = null
      this.buySpotsAge = 0
    }
    if (!show) return

    const spots = this.tiles.filter((t) => this.canPlace(t))
    if (spots.length === 0) return

    this.buySpots = createPlotMarkers(
      spots.map((t) => t.pos),
      TILE_SIZE,
      // The ripple spreads from the player when we know where they are, so the
      // nearest plots — the ones actually worth buying — light up first.
      origin ?? spots[0].pos,
    )
    this.buySpotsAge = 0
    this.buySpots.mesh.layers.set(MINOR_LAYER)
    this.group.add(this.buySpots.mesh)
  }

  // --- sprinklers ---------------------------------------------------------

  /** A sprinkler needs a bought, empty, untilled plot to stand on. */
  canPlaceSprinkler(tile: Tile | null): tile is Tile {
    return !!tile && tile.placed && !tile.crop && !tile.sprinkler
  }

  placeSprinkler(tile: Tile, tier: SprinklerTier) {
    if (!this.canPlaceSprinkler(tile)) return false

    const model = createSprinklerModel(tier)
    model.object.position.copy(tile.pos)
    model.object.position.y += 0.02
    this.group.add(model.object)

    const coverage = createCoverageDecal(tier.radius, TILE_SIZE)
    coverage.position.set(tile.pos.x, tile.pos.y + 0.04, tile.pos.z)
    coverage.layers.set(MINOR_LAYER)
    this.group.add(coverage)

    tile.sprinkler = { tier, model, coverage }
    // Standing on a plot means the plot is spent — hide its pad and clear any
    // tilled soil so the state can't be half sprinkler, half seedbed.
    this.plotPads[this.indexOf(tile)].visible = false
    if (tile.soil) {
      // Shared model geometry — remove, never dispose. See reset().
      this.group.remove(tile.soil)
      tile.soil = null
      tile.state = 'grass'
    }

    this.rebuildCoverage()
    return true
  }

  removeSprinkler(tile: Tile) {
    const s = tile.sprinkler
    if (!s) return null
    this.group.remove(s.model.object)
    this.group.remove(s.coverage)
    disposeTree(s.model.object)
    s.coverage.geometry.dispose()
    tile.sprinkler = null
    this.plotPads[this.indexOf(tile)].visible = true
    // Hand the plot back as a working seedbed. Leaving it bare would strand it:
    // placed, untilled, and with nothing anywhere offering to till it.
    this.till(tile)
    this.rebuildCoverage()
    return s.tier
  }

  /**
   * Recompute which tiles are watered by which sprinkler.
   *
   * Cached rather than derived per-tile per-frame: with a few dozen sprinklers
   * and a few hundred plots that would be tens of thousands of distance checks
   * every frame, and coverage only ever changes when hardware is placed.
   * Overlapping sprinklers resolve to the best luck bonus.
   */
  private rebuildCoverage() {
    this.coverageLuck.clear()

    for (const source of this.tiles) {
      const tier = source.sprinkler?.tier
      if (!tier) continue

      for (let dz = -tier.radius; dz <= tier.radius; dz++) {
        for (let dx = -tier.radius; dx <= tier.radius; dx++) {
          const target = this.tileAt(source.gx + dx, source.gz + dz)
          if (!target) continue
          const index = this.indexOf(target)
          this.coverageLuck.set(index, Math.max(this.coverageLuck.get(index) ?? 0, tier.luck))
        }
      }
    }
  }

  /** Extra luck this tile enjoys from sprinkler coverage, or 0. */
  sprinklerLuck(tile: Tile) {
    return this.coverageLuck.get(this.indexOf(tile)) ?? 0
  }

  isSprinklered(tile: Tile) {
    return this.coverageLuck.has(this.indexOf(tile))
  }

  get sprinklerCount() {
    return this.tiles.reduce((n, t) => n + (t.sprinkler ? 1 : 0), 0)
  }

  // --- actions ------------------------------------------------------------

  /**
   * Can this plot be tilled right now?
   *
   * Exported so the UI asks the same question the action answers. Duplicating
   * the condition in plot-ui is how you end up offering a button that silently
   * does nothing — the model refuses, the panel re-renders identically, and the
   * player clicks forever.
   */
  canTill(tile: Tile | null): tile is Tile {
    return !!tile && tile.placed && !tile.sprinkler && tile.state === 'grass'
  }

  till(tile: Tile) {
    if (!this.canTill(tile)) return false

    /**
     * Build the mesh *before* mutating the tile.
     *
     * `getModels()` throws if the model set is not resident. Mutating first left
     * a tile marked tilled with its pad hidden and no soil built — permanently
     * wedged, because every later attempt then bailed on `state !== 'grass'` and
     * did nothing at all. Ordering it this way means a failure leaves the plot
     * exactly as it was, and the player can simply try again.
     */
    const fit = plotTrayFit()
    const soil = new THREE.Mesh(getModels().plotTray.geometry, trayMaterial(false))
    soil.receiveShadow = true
    soil.castShadow = true
    soil.scale.setScalar(fit.scale)
    soil.position.copy(tile.pos)
    soil.position.y += fit.originY
    // Quarter turns only, so the trays stay square to the grid while the log and
    // grain land differently on each — a bed of identical trays reads as a
    // texture atlas rather than as objects.
    soil.rotation.y = ((tile.gx * 3 + tile.gz * 7) % 4) * (Math.PI / 2)
    this.group.add(soil)

    // Only now commit the tile — nothing above this point can fail.
    tile.soil = soil
    tile.state = 'tilled'
    this.plotPads[this.indexOf(tile)].visible = false
    return true
  }

  /**
   * `elapsed` drives the spawn pop-in; deserialize passes -1 to skip it, because
   * a whole farm of crops bouncing on load reads as a glitch, not a greeting.
   */
  /**
   * Whether rarity is rolled at all, or every crop comes up common.
   *
   * Set from the player's level (see the `mutations` feature unlock). A flag on
   * the farm rather than a check at the call site because planting happens from
   * four places — the player, a quest reward, the catch-up pass and a restore —
   * and three of them would have forgotten it.
   */
  mutationsUnlocked = false

  plant(tile: Tile, cropId: string, luck = 1, elapsed = -1) {
    if (tile.state !== 'tilled' || tile.crop || tile.sprinkler) return false
    const def = CROP_BY_ID.get(cropId)
    if (!def) return false

    const seed = Math.floor(Math.random() * 1_000_000)
    // Sprinkler coverage improves the rarity roll as well as growth speed.
    const rarity = this.mutationsUnlocked ? rollRarity(luck + this.sprinklerLuck(tile)) : 'common'
    const sizeRoll = sizeRollFor(seed)

    const model = createCropModel(def, 0, { seed, rarityColor: RARITY_BY_ID.get(rarity)?.color })
    model.position.copy(tile.pos)
    model.position.y += soilSurfaceY()
    this.group.add(model)

    tile.crop = {
      def,
      progress: 0,
      stage: 0,
      model,
      readyAt: -1,
      // Freshly planted sprouts pop in from almost nothing — same overshoot
      // curve as a growth step, just starting lower.
      tweenAt: elapsed,
      tweenFrom: 0.06,
      rarity,
      mutations: new Set(),
      seed,
      sizeRoll,
      sparkle: null,
      mutationTimer: MUTATION_TICK,
      harvestsLeft: def.harvests,
      regrowing: false,
    }
    // Scale down *now*, not on the next update tick — one frame of the sprout
    // at full size before the tween grabs it is a visible pop.
    if (elapsed >= 0) this.applyCropScale(tile.crop, elapsed)
    return true
  }

  water(tile: Tile) {
    if (tile.state !== 'tilled') return false
    tile.water = WATER_DURATION
    this.applySoilColor(tile)
    return true
  }

  /** Rain tops up every tilled tile — the whole point of caring about weather. */
  waterAll() {
    for (const tile of this.tiles) {
      if (tile.state === 'tilled' && tile.water < WATER_DURATION) this.water(tile)
    }
  }

  /** Skip a crop straight to ripe. Used by the plot menu's instant-grow. */
  instantGrow(tile: Tile, elapsed: number) {
    const crop = tile.crop
    if (!crop || crop.progress >= 1) return false
    crop.progress = 1
    this.refreshCropModel(tile, GROWTH_STAGES - 1, elapsed)
    return true
  }

  /**
   * Pick the crop. Multi-harvest plants drop back to a regrowing state and
   * keep their rarity and mutations, so an established Rainbow Melon vine is
   * an asset you protect rather than a one-off payout.
   *
   * `bonuses` lets pets tilt the weight roll and duplicate the yield.
   */
  harvest(
    tile: Tile,
    elapsed: number,
    bonuses: { weight?: number; duplicate?: number } = {},
  ): HarvestResult | null {
    const crop = tile.crop
    if (!crop || crop.progress < 1) return null

    let amount = crop.def.yield
    if (bonuses.duplicate && Math.random() < bonuses.duplicate) amount *= 2

    // Weight is rolled per fruit, not per harvest, so a two-yield crop can
    // produce one runt and one monster.
    let weightKg = 0
    let heaviestKg = 0
    for (let i = 0; i < amount; i++) {
      const w = rollWeight(crop.def, (bonuses.weight ?? 0) + (crop.sizeRoll - 1))
      weightKg += w
      heaviestKg = Math.max(heaviestKg, w)
    }

    const result: HarvestResult = {
      def: crop.def,
      amount,
      rarity: crop.rarity,
      mutations: [...crop.mutations],
      weightKg,
      heaviestKg,
      regrowing: false,
    }

    crop.harvestsLeft--
    if (crop.harvestsLeft > 0) {
      // Rewind to the last pre-ripe stage and regrow on the shorter timer.
      crop.regrowing = true
      crop.progress = Math.max(0, 1 - crop.def.regrowSeconds / crop.def.growSeconds)
      crop.readyAt = -1
      this.refreshCropModel(tile, Math.max(1, GROWTH_STAGES - 2), elapsed)
      result.regrowing = true
      return result
    }

    this.clearSparkle(crop)
    this.beginExit(crop.model)
    tile.crop = null

    // The tile stays tilled so the player can replant immediately rather than
    // re-tilling every cycle.
    return result
  }

  /** Hand a crop model over to the exit animation. */
  private beginExit(model: THREE.Object3D) {
    // The model's *live* scale, not its recorded baseScale: sizing is owned by
    // applyCropScale now, so baseScale no longer reflects what is on screen and
    // a giant plant would have snapped down to stock size as it was pulled.
    const base = model.scale.clone()
    this.exiting.push({ object: model, base: base.clone(), age: 0, life: 0.28 })
  }

  /**
   * Advance the exit animation. Stretch tall and thin as if yanked out of the
   * soil, then collapse to nothing.
   */
  private updateExits(dt: number) {
    for (let i = this.exiting.length - 1; i >= 0; i--) {
      const e = this.exiting[i]
      e.age += dt
      const t = Math.min(1, e.age / e.life)
      if (t >= 1) {
        this.group.remove(e.object)
        disposeTree(e.object)
        this.exiting.splice(i, 1)
        continue
      }
      // Squash-and-stretch: the pull happens over the first third, the collapse
      // over the rest, so the eye reads cause then consequence.
      const pull = t < 0.34 ? t / 0.34 : 1
      const collapse = t < 0.34 ? 1 : 1 - (t - 0.34) / 0.66
      e.object.scale.set(
        e.base.x * (1 - pull * 0.35) * collapse,
        e.base.y * (1 + pull * 0.45) * collapse,
        e.base.z * (1 - pull * 0.35) * collapse,
      )
      e.object.position.y += dt * 1.6
    }
  }

  /**
   * The tile whose crop model contains `object`, or null.
   *
   * Ground picking alone cannot select a grown plant: the ray passes through
   * the canopy and lands on the ground *behind* the plot, so the taller the
   * crop, the harder it is to click — exactly backwards. Callers raycast the
   * crop meshes first and hand any hit here to be walked back up to its tile.
   */
  tileFromObject(object: THREE.Object3D): Tile | null {
    let cur: THREE.Object3D | null = object
    while (cur) {
      for (const tile of this.tiles) {
        if (tile.crop?.model === cur) return tile
      }
      cur = cur.parent
    }
    return null
  }

  /** Root the crop raycast aims at — every planted model lives under here. */
  get cropRaycastRoot() {
    return this.group
  }

  /** Every plot with a crop ready to pick. */
  get ripeTiles() {
    return this.tiles.filter((t) => t.crop && t.crop.progress >= 1)
  }

  /**
   * Harvest every ripe plot at once.
   *
   * This exists because clicking plots one at a time scales badly — a
   * fifty-plot farm is fifty menu round-trips for what is conceptually a
   * single decision. Results come back per-tile rather than aggregated so the
   * caller can still place a burst on each plot and total up the value itself.
   */
  /**
   * Pick everything ripe, up to `unitLimit` units of produce.
   *
   * The limit is the barn's remaining space, and it is enforced *before* each
   * plant is picked rather than after: harvesting is destructive, so a plant
   * picked into a full barn is produce deleted. Stopping early leaves the rest
   * ripe in the ground, which is exactly where the player wants them until they
   * have sold something.
   */
  harvestAll(
    elapsed: number,
    bonuses: { weight?: number; duplicate?: number } = {},
    unitLimit = Infinity,
  ): { tile: Tile; result: HarvestResult }[] {
    const picked: { tile: Tile; result: HarvestResult }[] = []
    let room = unitLimit
    for (const tile of this.ripeTiles) {
      // The yield is known from the crop before picking; duplicate pets can beat
      // it, so this is a floor, and the storage clamp catches the overshoot.
      if (room < (tile.crop?.def.yield ?? 1)) break
      const result = this.harvest(tile, elapsed, bonuses)
      if (!result) continue
      picked.push({ tile, result })
      room -= result.amount
    }
    return picked
  }

  private clearSparkle(crop: PlantedCrop) {
    if (!crop.sparkle) return
    crop.model.remove(crop.sparkle.object)
    crop.sparkle = null
  }

  private addSparkle(crop: PlantedCrop) {
    if (crop.sparkle) return
    const rarityColor = RARITY_BY_ID.get(crop.rarity)?.color
    crop.sparkle = createSparkle(rarityColor ?? null)
    crop.model.add(crop.sparkle.object)
  }

  private applySoilColor(tile: Tile) {
    if (!tile.soil) return
    tile.soil.material = trayMaterial(tile.water > 0)
  }

  private refreshCropModel(tile: Tile, stage: number, elapsed: number) {
    const crop = tile.crop
    if (!crop) return

    const previousStage = crop.stage
    this.clearSparkle(crop)
    this.group.remove(crop.model)
    disposeTree(crop.model)

    const model = createCropModel(crop.def, stage, {
      seed: crop.seed,
      rarityColor: RARITY_BY_ID.get(crop.rarity)?.color,
    })
    model.position.copy(tile.pos)
    model.position.y += soilSurfaceY()
    // Recomputed, not copied: a restored save has already overwritten the seed
    // this crop was planted with, and the roll must follow the seed. Sizing
    // itself is applied by applyCropScale, which is the single authority.
    crop.sizeRoll = sizeRollFor(crop.seed)
    this.group.add(model)
    crop.model = model
    crop.stage = stage

    // Swell into the new stage instead of appearing at full size. Regrowing
    // after a picking steps *down* a stage, so that eases from slightly above
    // its target — the plant settles rather than shrinking abruptly.
    /*
     * No punch when growing *up* a stage any more.
     *
     * The punch existed because scale was per-stage and the mesh swap was
     * otherwise a hard pop. Now that size is driven continuously from progress,
     * re-arming it at each boundary made the plant visibly shrink to 55% and
     * swell back — the plant went backwards twice on the way to ripe, which is
     * exactly the artefact continuous growth was meant to remove.
     *
     * Regrowing after a picking still steps *down* a stage, and that does want
     * an ease: it settles from slightly above its new target rather than
     * snapping smaller.
     */
    if (stage < previousStage) {
      crop.tweenAt = elapsed
      crop.tweenFrom = 1.18
    } else {
      crop.tweenAt = -1
    }
    this.applyCropScale(crop, elapsed)

    if (stage === GROWTH_STAGES - 1) {
      crop.readyAt = elapsed
      this.addSparkle(crop)
    }
  }

  /**
   * Size a plant for its current ripeness.
   *
   * Two factors multiply onto the base scale the model recorded at build time
   * (so per-plant girth jitter survives):
   *
   *  - `growth`, driven by `progress`, which climbs smoothly from
   *    GROW_FROM_SCALE to 1 across the plant's whole life. This is the one the
   *    player reads as the plant growing.
   *  - `punch`, a short overshoot fired on each stage change, decaying back to
   *    1. Without it the silhouette swap between stage meshes is a visible pop;
   *    with it the swap happens while the plant is already moving.
   *
   * The product is clamped so no combination of roll, jitter and overshoot can
   * push a plant past MAX_CROP_SCALE.
   *
   * Uniform, deliberately. Height jitter used to be applied here as a taller Y
   * scale, which stretched the plant's *fruit* along with its leaves; it now
   * lives on the foliage mesh inside the model, where it cannot reach them. What
   * is left for this to do is one number.
   */
  private applyCropScale(crop: PlantedCrop, elapsed: number) {
    const base = crop.model.userData.baseScale as THREE.Vector3 | undefined
    const girth = base?.x ?? 1
    // How much taller than wide the model is, so the ceiling still measures the
    // axis that actually reaches highest.
    const stretch = (crop.model.userData.stretch as number | undefined) ?? 1

    // Ease-out on progress: early growth is the visible part, and a linear ramp
    // makes a nearly-ripe plant look like it has stopped.
    const p = Math.min(1, Math.max(0, crop.progress))
    const growth = GROW_FROM_SCALE + (1 - GROW_FROM_SCALE) * (1 - (1 - p) * (1 - p))

    let punch = 1
    if (crop.tweenAt >= 0) {
      /*
       * Clamped at both ends. A tweenAt ahead of the clock (a save restored
       * across a pause, or any caller whose timestamp disagrees) drives t deep
       * negative, and the overshoot polynomial explodes cubically — one bad
       * frame scaled a crop by minus six hundred million and turned it into
       * unclickable garbage geometry.
       */
      const t = Math.min(1, Math.max(0, (elapsed - crop.tweenAt) / GROW_TWEEN))
      const eased = 1 + (1 - t) * (1 - t) * (-1.9 * (1 - t) + 1.35)
      punch = crop.tweenFrom + (1 - crop.tweenFrom) * (t >= 1 ? 1 : eased)
      if (t >= 1) crop.tweenAt = -1
    }

    /*
     * One clamp on the whole multiplier, so the cap holds on every axis at once
     * — clamping axes independently would squash a tall plant's proportions the
     * moment its height alone hit the ceiling.
     */
    const want = growth * punch * crop.sizeRoll
    const tallest = girth * stretch * want
    const k = tallest > MAX_CROP_SCALE ? want * (MAX_CROP_SCALE / tallest) : want
    crop.model.scale.setScalar(girth * k)
  }

  // --- per-frame ----------------------------------------------------------

  /**
   * `ctx` carries the current weather and hour so crops can mutate. `luck`
   * scales mutation odds. `onMutate` fires once per mutation gained, so the
   * caller can toast it.
   */
  update(
    dt: number,
    elapsed: number,
    ctx?: Omit<MutationContext, 'watered' | 'sprinklered' | 'pollinated'>,
    luck = 1,
    onMutate?: (crop: PlantedCrop, mutation: MutationDef) => void,
    growthBonus = 0,
    /** Is a beehive covering this tile? Owned by Placeables, not the Farm. */
    isPollinated?: (tile: Tile) => boolean,
    /** Season growth multiplier for a given crop. */
    seasonGrowth?: (crop: CropDef) => number,
  ) {
    /*
     * Drive the marker field's own clock rather than reading the world elapsed
     * time: its appear ripple has to start from zero each time the shovel is
     * raised, and a shared clock would have the field arriving mid-animation.
     */
    if (this.buySpots) {
      this.buySpotsAge += dt
      this.buySpots.setTime(this.buySpotsAge)
    }

    // Same reasoning for the action ring: its clock starts when it arrives on a
    // plot, so it always plays its pop-in from the top.
    if (this.highlight.mesh.visible) {
      this.highlightAge += dt
      this.highlight.setAge(this.highlightAge)
    }

    this.updateExits(dt)

    for (const tile of this.tiles) {
      tile.sprinkler?.model.update(elapsed)

      const sprinklered = this.isSprinklered(tile)
      if (sprinklered && tile.state === 'tilled' && tile.water < WATER_DURATION * 0.5) {
        // Topped up rather than pinned, so the soil still shows its wet colour
        // transition instead of being permanently saturated with no feedback.
        this.water(tile)
      }

      if (tile.water > 0) {
        tile.water -= dt
        if (tile.water <= 0) {
          tile.water = 0
          this.applySoilColor(tile)
        }
      }

      const crop = tile.crop
      if (!crop) continue

      const tileLuck = luck + this.sprinklerLuck(tile)

      // Mutations keep accruing after ripeness, so leaving a finished crop out
      // through a storm is a real (if risky) strategy rather than dead time.
      if (ctx) {
        crop.mutationTimer -= dt
        if (crop.mutationTimer <= 0) {
          crop.mutationTimer = MUTATION_TICK
          const gained = rollMutation(
            crop.mutations,
            { ...ctx, watered: tile.water > 0, sprinklered, pollinated: isPollinated?.(tile) ?? false },
            tileLuck,
          )
          if (gained) onMutate?.(crop, gained)
        }
      }

      // Every frame, not only during a stage punch: growth is continuous now.
      this.applyCropScale(crop, elapsed)

      if (crop.progress >= 1) {
        // Ripe crops bob gently so a finished field is visibly alive.
        if (crop.readyAt >= 0) {
          const t = elapsed - crop.readyAt
          crop.model.position.y = tile.pos.y + soilSurfaceY() + Math.sin(t * 2.6) * 0.03
          crop.sparkle?.update(elapsed)
        }
        continue
      }

      // Regrow progress is seeded so the remaining fraction takes exactly
      // regrowSeconds at rate 1 — see harvest(). That keeps one growth formula
      // for both the first fruiting and every one after it.
      const rate =
        (tile.water > 0 ? WATER_GROWTH_MULTIPLIER : 1) *
        (1 + growthBonus) *
        (seasonGrowth?.(crop.def) ?? 1)
      crop.progress = Math.min(1, crop.progress + (dt * rate) / growSecondsFor(crop.def))
      if (crop.progress >= 1) crop.regrowing = false

      const stage = stageForProgress(crop.progress)
      if (stage !== crop.stage) this.refreshCropModel(tile, stage, elapsed)
    }
  }

  /**
   * Ring the tile the player is about to act on.
   *
   * `hover` marks a tile picked with the cursor rather than one the player is
   * standing next to. It shows even when there is no action available, because
   * the point of hover feedback is to confirm *which* plot the cursor is on —
   * a plot that stops responding to the mouse because it happens to be busy
   * growing reads as the game ignoring the input.
   */
  setHighlight(tile: Tile | null, action: TileAction, hover = false) {
    if (!tile || (action === 'none' && !hover)) {
      this.highlight.mesh.visible = false
      this.highlightTile = null
      return
    }
    // Landing on a new plot restarts the pop-in, so the ring reads as jumping
    // there rather than as one shape sliding around the farm.
    if (tile !== this.highlightTile) {
      this.highlightTile = tile
      this.highlightAge = 0
      this.highlight.setAge(0)
    }
    this.highlight.mesh.visible = true
    // Just clear of the planter's rim: on the bed rather than hovering over it.
    this.highlight.mesh.position.set(tile.pos.x, tile.pos.y + soilSurfaceY() + 0.012, tile.pos.z)
    const col =
      action === 'till'
        ? 0xffe9a8
        : action === 'plant'
          ? 0x9ff29f
          : action === 'water'
            ? 0x8fd8ff
            : action === 'harvest'
              ? 0xffd24a
              : 0xfff6e0
    this.highlight.setColor(col)
    // Hovering is a lighter statement than "you can act here", so it rings the
    // plot faintly. At full strength every plot the cursor crossed shouted as
    // loudly as the one actually ready to harvest.
    this.highlight.setStrength(hover && action === 'none' ? 0.5 : 1)
  }

  // --- persistence --------------------------------------------------------

  serialize() {
    return this.tiles.map((t) => ({
      o: t.placed ? 1 : 0,
      s: t.state === 'tilled' ? 1 : 0,
      c: t.crop?.def.id ?? null,
      p: t.crop?.progress ?? 0,
      w: t.water,
      r: t.crop?.rarity ?? 'common',
      m: t.crop ? [...t.crop.mutations] : [],
      sd: t.crop?.seed ?? 0,
      hl: t.crop?.harvestsLeft ?? 0,
      rg: t.crop?.regrowing ? 1 : 0,
      sp: t.sprinkler?.tier.id ?? null,
    }))
  }

  deserialize(data: ReturnType<Farm['serialize']>, elapsed: number) {
    if (!Array.isArray(data) || data.length !== this.tiles.length) return
    // The span is *derived*, not stored — see recoverSpan.
    this.span = 0
    data.forEach((d, i) => {
      const tile = this.tiles[i]
      this.setPlaced(tile, d.o === 1)
      if (!tile.placed) return

      // Sprinklers first: they occupy the plot, so restoring one has to happen
      // before till/plant would otherwise claim the same tile.
      if (d.sp) {
        const tier = SPRINKLER_BY_ID.get(d.sp as SprinklerTierId)
        if (tier) {
          this.placeSprinkler(tile, tier)
          return
        }
      }

      /**
       * Always till, whatever the save says.
       *
       * "Placed implies tilled" is now an invariant (see placePlot), and this is
       * the line that makes it hold on load rather than only for plots bought in
       * this session. It also repairs saves written while tilling was a separate
       * step the player had to perform — those hold placed-but-untilled plots,
       * which under the current rules have no planter mesh and refuse every
       * action, because `plant` requires tilled soil and nothing offers to till.
       */
      this.till(tile)
      if (d.c) {
        this.plant(tile, d.c)
        if (tile.crop) {
          // Restore the rolled identity before rebuilding the model, or the
          // crop comes back as a fresh common plant with a different shape.
          tile.crop.rarity = (d.r as RarityId) ?? 'common'
          tile.crop.mutations = new Set(d.m ?? [])
          if (d.sd) tile.crop.seed = d.sd
          if (d.hl > 0) tile.crop.harvestsLeft = d.hl
          tile.crop.regrowing = d.rg === 1
          tile.crop.progress = Math.min(1, Math.max(0, d.p))
          this.refreshCropModel(tile, stageForProgress(tile.crop.progress), elapsed)
        }
      }
      if (d.w > 0) {
        tile.water = d.w
        this.applySoilColor(tile)
      }
    })

    // Last, once every tile knows whether it is owned.
    this.recoverSpan()
  }
}

/** Deterministic [0,1) hash. Must be pure: restores recompute the rolls. */
function hash01(seed: number, salt: number) {
  let h = (seed ^ salt) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}

/**
 * The size lottery: most plants near 1x, rare towers at ~2.4x.
 *
 * Cubing the hash is the distribution — a uniform roll would make half the
 * field giants and "giant" would stop meaning anything. Cubed, ~80% of plants
 * sit under 1.35x and roughly one in twelve clears 2x, which is scarce enough
 * that a monster turnip is an event worth walking over to look at.
 *
 * The same roll feeds the harvest's weight bonus, so the giant *is* worth
 * more — a huge plant that sold for average money would read as a lie.
 */
export function sizeRollFor(seed: number) {
  const u = hash01(seed, 0x9e3779b9)
  return Math.min(MAX_SIZE_ROLL, 1 + 1.45 * u * u * u)
}

/** Crops are rebuilt on every stage change, so their geometry must be freed
 *  or a long session leaks a few hundred buffers. Materials are shared and
 *  cached in style.ts, so they are deliberately left alone. */
function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry.dispose()
  })
}
