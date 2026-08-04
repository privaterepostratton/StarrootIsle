import * as THREE from 'three'
import { GRID_W, GRID_H, TILE_SIZE } from './farm'

/**
 * Sprout Lane — the village layout.
 *
 * Six farms share one street: three along the west verge facing three along
 * the east verge, with a dirt lane running north–south between them. The
 * player owns the south-west plot, nearest the market square; the five
 * simulated neighbours fill the rest, ordered so the lowest-level farmer is
 * your immediate neighbour and the walk north is also a walk up the ladder.
 *
 * This module is the single source of truth for that geometry. Terrain
 * flattening, fencing, the lane mesh, vegetation exclusion, neighbour
 * placement and the shop/barn positions all derive from the constants here, so
 * moving a plot is a one-line change rather than a hunt through five files.
 *
 * Import direction is deliberately one-way: village → farm. Nothing here may
 * import terrain, or terrain's flat pads would become a cycle.
 */

// --- the lane ----------------------------------------------------------------

/**
 * Half-width of the dirt lane. Plot fences sit flush against these edges.
 *
 * Sized against the farmer, who is about 1.6 units tall: much wider than this
 * and the street stops reading as a village lane and starts reading as a road.
 */
export const LANE_HALF = 3.2

/** How far the lane runs. South end is the market square, north end the well. */
export const LANE_Z_MIN = -41
export const LANE_Z_MAX = 34

// --- plot footprint ----------------------------------------------------------

/**
 * Every plot — the player's and all five neighbours' — has the same footprint,
 * sized from the player's tile grid. Uniformity is what makes two rows of
 * farms read as a street rather than as scattered homesteads.
 *
 * The grid's long axis runs *away* from the lane, so each farm is a deep strip
 * with a narrow frontage. That keeps the street short enough to walk while
 * still giving six farms room to sit side by side.
 */
/** Half-extent across the plot, perpendicular to the lane. */
export const PLOT_HX = (GRID_W * TILE_SIZE) / 2
/** Half-extent along the lane — the plot's street frontage. */
export const PLOT_HZ = (GRID_H * TILE_SIZE) / 2

/** Grass border between the outermost tiles and the fence line. */
export const FENCE_MARGIN = 0.7
export const FENCE_HX = PLOT_HX + FENCE_MARGIN
export const FENCE_HZ = PLOT_HZ + FENCE_MARGIN

/** Distance from the lane centreline to a plot centre. Puts the inner fence
 *  exactly on the lane edge, so plots front directly onto the street. */
export const PLOT_CX = LANE_HALF + FENCE_HX

/** Centre-to-centre spacing of the three rows. */
export const ROW_SPACING = 19
export const ROW_Z = [-ROW_SPACING, 0, ROW_SPACING]

/** Width of the gate opening in the lane-side fence. */
export const GATE_WIDTH = 3.2

// --- the six slots -----------------------------------------------------------

export interface FarmSlot {
  /** Which verge this plot sits on. */
  side: 'west' | 'east'
  /** 0 = southernmost row. */
  row: number
  /** Plot centre. */
  x: number
  z: number
  /**
   * Which way the lane lies from this plot: +1 when the lane is at greater X
   * (west verge), -1 when it is at lesser X (east verge). Gates, mailboxes and
   * cottages are mirrored by this rather than rotated, which keeps every
   * plot's tile grid axis-aligned.
   */
  inward: 1 | -1
}

function slot(side: 'west' | 'east', row: number): FarmSlot {
  const inward = side === 'west' ? 1 : -1
  return { side, row, x: -inward * PLOT_CX, z: ROW_Z[row], inward }
}

/**
 * All six plots, south to north, west verge before east. Index 0 is the
 * player's — see PLAYER_SLOT — and the remaining five are handed to the
 * neighbour profiles in order.
 */
export const FARM_SLOTS: FarmSlot[] = [
  slot('west', 0),
  slot('east', 0),
  slot('west', 1),
  slot('east', 1),
  slot('west', 2),
  slot('east', 2),
]

/**
 * Where the player's own plot is remembered between sessions.
 *
 * Its own key rather than a field in the save, because the choice has to be
 * made at *module load* — PLAYER_SLOT, FARM_CENTRE and SPAWN are consumed as
 * constants by the world builder, the farm and the player, all of which are
 * constructed long before `Save.load()` resolves. A synchronous read is the
 * only thing available that early.
 */
const PLOT_KEY = 'sprout-valley-plot-v1'

/**
 * Which of the six plots the player farms, drawn once and then kept forever.
 *
 * It used to be fixed at FARM_SLOTS[0] — the south-west plot, first off the
 * market square — so every playthrough opened on the same view of the same
 * corner. Drawing it makes the walk up the lane, the neighbours you pass, and
 * which side the morning sun comes from different from one player to the next.
 *
 * Drawn *once*, though, and that matters more than the draw: rerolling per
 * session would move a returning player's farm out from under them. Crop state
 * survives a move (tiles serialise by index, so they rebuild around the new
 * centre) but anything holding a world position does not — placed decor would
 * stay behind, some of it now standing in a neighbour's garden.
 */
function chosenSlotIndex(): number {
  // The router tests and the dev contact sheets import this module with no DOM.
  // A fixed plot there is also what makes those tests reproducible.
  if (typeof localStorage === 'undefined') return 0
  try {
    /*
     * The raw string is tested before the number, because `Number(null)` is 0 —
     * not NaN. Converting first made "nothing stored yet" indistinguishable from
     * "stored plot 0", so the range check passed, the draw never ran, and every
     * player got the south-west plot exactly as before.
     */
    const raw = localStorage.getItem(PLOT_KEY)
    const stored = raw === null ? NaN : Number(raw)
    if (Number.isInteger(stored) && stored >= 0 && stored < FARM_SLOTS.length) return stored
    const drawn = Math.floor(Math.random() * FARM_SLOTS.length)
    localStorage.setItem(PLOT_KEY, String(drawn))
    return drawn
  } catch {
    // Private browsing, or storage disabled. Fall back to the old fixed plot
    // rather than rerolling on every load, which is the one outcome worse than
    // not randomising at all.
    return 0
  }
}

/** The plot the player farms. Drawn on first run — see chosenSlotIndex. */
export const PLAYER_SLOT = FARM_SLOTS[chosenSlotIndex()]

/** Forget the drawn plot, so the next load draws again. Called on save wipe. */
export function clearPlotChoice() {
  try {
    localStorage.removeItem(PLOT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * The five plots the simulated neighbours occupy, in profile order.
 *
 * Filtered rather than sliced: the player's plot is no longer guaranteed to be
 * the first one, and `slice(1)` would have handed a neighbour the player's own
 * garden and left one plot empty.
 */
export const NEIGHBOUR_SLOTS = FARM_SLOTS.filter((s) => s !== PLAYER_SLOT)

/** Centre of the player's tile grid. */
export const FARM_CENTRE = new THREE.Vector3(PLAYER_SLOT.x, 0, PLAYER_SLOT.z)

/** Where a plot's gate opens onto the lane. */
export function gatePos(s: FarmSlot) {
  return new THREE.Vector3(s.x + s.inward * FENCE_HX, 0, s.z)
}

/** Where the player is dropped when fast-travelling to a plot: on the lane,
 *  just outside the gate, so they walk in through it. */
export function approachPos(s: FarmSlot) {
  return new THREE.Vector3(s.x + s.inward * (FENCE_HX + 1.8), 0, s.z)
}

// --- market square -----------------------------------------------------------

/**
 * The square at the south end of the lane. Both shops face north up the street
 * so the player walks out of them straight towards the farms.
 *
 * Kept only just big enough for the two shop fronts. An oversized plaza is a
 * slab of bare dirt that swallows the bottom of the frame whenever the camera
 * looks up the street from the entrance.
 */
export const SQUARE_CZ = -34
export const SQUARE_HX = 11
export const SQUARE_HZ = 6.5

/** Seed stall, west side of the square. */
export const SHOP_POS = new THREE.Vector3(-8, 0, SQUARE_CZ - 2.5)

/**
 * Animal store, at the *north* end of the lane, with its paddock beside it.
 *
 * It used to stand on the market square beside the seed stall, which put every
 * shop in the game within one screen of the spawn and left the lane — the
 * longest walk in the village — leading to nothing but a lantern. Splitting the
 * two stores to opposite ends gives the street a reason to exist: seeds at one
 * end, livestock at the other, and the farms in between.
 */
export const BARN_POS = new THREE.Vector3(11, 0, LANE_Z_MAX + 8)

/**
 * Which way the barn's doors face, as a sign on Z.
 *
 * Everything around the barn — the keeper, the dirt apron, the stacked bales,
 * the collider row — is positioned as an offset from BARN_POS along Z, because
 * for as long as the barn stood on the south square there was only ever one
 * answer. At the north end the player arrives from the *other* side, so the
 * whole arrangement has to mirror or they walk up to the back wall and find the
 * keeper standing in a field behind it.
 *
 * A sign rather than six edited literals: the offsets stay readable as
 * "1.5 units in front of the doors", and moving the barn again is one line.
 */
export const BARN_FRONT = -1

/** Grazing paddock, beside the animal store. */
export const PASTURE_CENTRE = new THREE.Vector3(24.5, 0, LANE_Z_MAX + 9)
export const PASTURE_RADIUS = 7.5

/**
 * Where the player starts and respawns: *inside their own garden*, beside the
 * starting bed. Waking up on your farm makes the first thirty seconds
 * self-explanatory — the plots are right there — where the old lane spawn
 * opened on scenery and left the tutorial pointing at things off-screen.
 */
export const SPAWN = new THREE.Vector3(PLAYER_SLOT.x + 2.6, 0, PLAYER_SLOT.z + 3.4)

/** The well capping the north end of the lane. */
export const WELL_POS = new THREE.Vector3(0, 0, LANE_Z_MAX - 3)

// --- flat ground -------------------------------------------------------------

/**
 * Rounded-rectangle pads the terrain is flattened against.
 *
 * Terrain consumes these to build its basin mask. Each is a half-extent box
 * plus a falloff radius over which the flattening eases out — a box rather
 * than a disc because a disc large enough to cover the street's corners would
 * flatten a huge circle of otherwise interesting land.
 */
export interface FlatPad {
  cx: number
  cz: number
  hx: number
  hz: number
  falloff: number
}

export const FLAT_PADS: FlatPad[] = [
  // The street itself: all six plots plus the lane between them.
  {
    cx: 0,
    cz: 0,
    hx: PLOT_CX + FENCE_HX + 0.5,
    hz: ROW_SPACING + FENCE_HZ + 0.5,
    falloff: 9,
  },
  // Market square at the south end.
  { cx: 0, cz: SQUARE_CZ, hx: SQUARE_HX + 2, hz: SQUARE_HZ + 2, falloff: 9 },
  // Paddock beside the animal store.
  {
    cx: PASTURE_CENTRE.x,
    cz: PASTURE_CENTRE.z,
    hx: PASTURE_RADIUS + 2,
    hz: PASTURE_RADIUS + 2,
    falloff: 8,
  },
  // The animal store's own ground. It used to share the square's pad; at the
  // north end it stands on open valley floor and needs its own.
  { cx: BARN_POS.x, cz: BARN_POS.z, hx: 8, hz: 7, falloff: 8 },
  // The turning circle at the north end of the lane.
  { cx: 0, cz: LANE_Z_MAX - 2, hx: 9, hz: 6, falloff: 8 },
]

// --- queries -----------------------------------------------------------------

/** Extent of everything the village occupies, used to keep wild features out. */
export const VILLAGE_BOUNDS = {
  minX: -(PLOT_CX + FENCE_HX),
  maxX: PASTURE_CENTRE.x + PASTURE_RADIUS + 2,
  minZ: SQUARE_CZ - 9,
  /*
   * Reaches past the lane to whichever of the paddock or the barn ends furthest
   * north. Left at `LANE_Z_MAX + 4` when the store moved up here, the box
   * stopped short of both of them and the forest scatter planted trees through
   * the paddock fence.
   */
  maxZ: Math.max(LANE_Z_MAX + 4, PASTURE_CENTRE.z + PASTURE_RADIUS + 2, BARN_POS.z + 8),
}

/**
 * Inside the player's own fence.
 *
 * Working a plot requires standing on the farm, not reaching over the rails
 * from the lane — the fence is a real boundary, and the gate matters because
 * of it.
 */
export function inPlayerPlot(x: number, z: number, margin = 0) {
  return (
    Math.abs(x - PLAYER_SLOT.x) < FENCE_HX + margin && Math.abs(z - PLAYER_SLOT.z) < FENCE_HZ + margin
  )
}

/** True inside any fenced plot, with an optional margin. */
export function inAnyPlot(x: number, z: number, margin = 0) {
  return FARM_SLOTS.some(
    (s) => Math.abs(x - s.x) < FENCE_HX + margin && Math.abs(z - s.z) < FENCE_HZ + margin,
  )
}

/** True on the lane surface, including the market square and the north circle. */
export function onLane(x: number, z: number, margin = 0) {
  if (Math.abs(x) < LANE_HALF + margin && z > LANE_Z_MIN - margin && z < LANE_Z_MAX + margin) {
    return true
  }
  return Math.abs(x) < SQUARE_HX + margin && Math.abs(z - SQUARE_CZ) < SQUARE_HZ + margin
}

/** True anywhere the village has built on — nothing wild may generate here. */
export function inVillage(x: number, z: number, margin = 0) {
  return (
    x > VILLAGE_BOUNDS.minX - margin &&
    x < VILLAGE_BOUNDS.maxX + margin &&
    z > VILLAGE_BOUNDS.minZ - margin &&
    z < VILLAGE_BOUNDS.maxZ + margin
  )
}
