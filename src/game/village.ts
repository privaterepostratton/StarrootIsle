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

/**
 * How far the lane runs, west to east.
 *
 * The street used to run north–south with the square at its south end. It now
 * runs across the map: the market square caps the *east* end, and the west end
 * stops at the player's own gate rather than carrying on into empty grass —
 * which is what allows their farm to sit at the head of the street instead of
 * marooned off to one side of it. See PLAYER_SLOT.
 *
 * The west end is derived from the player's fence rather than typed, so moving
 * the farm moves the end of the road with it.
 */
export const LANE_X_MAX = 40

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
export const PLOT_CZ = LANE_HALF + FENCE_HZ

/** Centre-to-centre spacing of the three rows, measured along the street. */
export const ROW_SPACING = 16
/*
 * Rows along the street, shifted east of centre.
 *
 * The player's farm caps the west end and is a full plot wide, so a row centred
 * on the origin put the nearest neighbours' fences *through* it — the router
 * tests caught it as routes crossing a foreign fence, which is exactly what it
 * was. Each row now clears the farm's east fence with a couple of units to
 * spare, and the last one stops short of the market square.
 */
export const ROW_X = [-16, 0, 16]

/** Width of the gate opening in the lane-side fence. */
export const GATE_WIDTH = 3.2

// --- the six slots -----------------------------------------------------------

export interface FarmSlot {
  /** Which verge this plot sits on. */
  side: 'north' | 'south'
  /** 0 = the western end of the street. */
  row: number
  /** Plot centre. */
  x: number
  z: number
  /**
   * Which way the lane lies from this plot along `axis`: +1 when the lane is at
   * the greater coordinate, -1 when it is at the lesser. Gates, mailboxes and
   * cottages are mirrored by this rather than rotated, which keeps every plot's
   * tile grid axis-aligned.
   */
  inward: 1 | -1
  /**
   * Which axis `inward` points along.
   *
   * Every plot on the street fronts it across the same axis, so this was an
   * assumption baked into the gate maths rather than a field. It stops being
   * true the moment one plot sits at the *end* of the lane instead of beside
   * it — that farm's gate faces down the street, not across it — and a hidden
   * assumption is a much worse place for that to surface than a field.
   */
  axis: 'x' | 'z'
}

function slot(side: 'north' | 'south', row: number): FarmSlot {
  // North of the street means a lesser Z, so the lane lies at greater Z: +1.
  const inward = side === 'north' ? 1 : -1
  return { side, row, x: ROW_X[row], z: -inward * PLOT_CZ, inward, axis: 'z' }
}

/** Half-extent of a plot's fence across whichever axis its gate faces. */
export function fenceHalfAlong(s: FarmSlot) {
  return s.axis === 'x' ? FENCE_HX : FENCE_HZ
}

/** Offset a plot centre by `d` in the direction of its gate. */
export function towardLane(s: FarmSlot, d: number) {
  return s.axis === 'x'
    ? new THREE.Vector3(s.x + s.inward * d, 0, s.z)
    : new THREE.Vector3(s.x, 0, s.z + s.inward * d)
}

/**
 * All six plots, south to north, west verge before east. Index 0 is the
 * player's — see PLAYER_SLOT — and the remaining five are handed to the
 * neighbour profiles in order.
 */
export const FARM_SLOTS: FarmSlot[] = [
  slot('north', 0),
  slot('south', 0),
  slot('north', 1),
  slot('south', 1),
  slot('north', 2),
  slot('south', 2),
]

/**
 * The player's farm: a clearing between the lane and the sea.
 *
 * It is no longer one of the six lane plots. The game now opens on the beach
 * and the first thing you do is cut a clearing out of the woods behind it, so
 * the farm has to be *there* — walking inland to a plot that already existed on
 * a street would undo the whole point of clearing it.
 *
 * Far enough west that the sea is in view from the fence and close enough that
 * the lane is a short walk east, which is what lets the seed stall and the barn
 * arrive on the square later and still feel like they arrived near you.
 *
 * Shaped like a lane plot — same FarmSlot, same fence extents, `inward` still
 * pointing at the lane — so the gate, the signpost, the fence builder and the
 * router all keep working without knowing it has moved off the street.
 */
/*
 * Six tiles east of where it used to stand.
 *
 * The yard is about to become a board of parcels the player claims one at a
 * time, and at x = -38 its western third was beach: the grass line runs about
 * 2.8 units west of the old centre, so the outermost column of parcels would
 * have been sand nobody can farm. Shifting east puts the whole board on grass
 * with a margin at both ends — roughly a unit and a half of turf before the
 * sand to the west, and two before the neighbours' plots to the east, which is
 * as much room as there is to have.
 */
export const PLAYER_SLOT: FarmSlot = { side: 'north', row: 1, x: -32, z: 0, inward: 1, axis: 'x' }

/**
 * Where the street stops in the west: at the player's gate.
 *
 * Derived rather than typed, so moving the farm moves the end of the road with
 * it and the two can never drift into each other.
 */
export const LANE_X_MIN = PLAYER_SLOT.x + FENCE_HX

/**
 * The five plots the neighbours live on.
 *
 * They keep their cottages, mailboxes and gardens; the crop plots are gone with
 * the six-farm layout. The player's farm is no longer among these, so this is a
 * straight slice rather than a filter — there is nothing to exclude.
 */
export const NEIGHBOUR_SLOTS = FARM_SLOTS.slice(0, 5)

/**
 * Every fenced plot in the world — the neighbours' and the player's.
 *
 * The player's clearing stopped being one of FARM_SLOTS when it moved off the
 * street, and anything that reasons about fences as obstacles has to see it
 * anyway. The waypoint router is the one that matters: built from FARM_SLOTS
 * alone it had no gate node for the player's own farm, so the guide trail could
 * route to the fence and stop there.
 */
export const FENCED_PLOTS: FarmSlot[] = [...NEIGHBOUR_SLOTS, PLAYER_SLOT]

/** Centre of the player's tile grid. */
export const FARM_CENTRE = new THREE.Vector3(PLAYER_SLOT.x, 0, PLAYER_SLOT.z)

/**
 * Where the game begins: on the sand, a few paces from the water.
 *
 * The old spawn put the player inside their own garden so the first thirty
 * seconds explained themselves. There is no garden yet — that is the tutorial
 * now — so the opening shot is the sea instead, and the walk inland is the
 * first thing the player chooses to do.
 */
export const SPAWN = new THREE.Vector3(-56, 0, 6)

/** Where a plot's gate opens onto the lane. */
export function gatePos(s: FarmSlot) {
  return towardLane(s, fenceHalfAlong(s))
}

/** Where the player is dropped when fast-travelling to a plot: on the lane,
 *  just outside the gate, so they walk in through it. */
export function approachPos(s: FarmSlot) {
  return towardLane(s, fenceHalfAlong(s) + 1.8)
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
export const SQUARE_CX = 33
export const SQUARE_HX = 6.5
export const SQUARE_HZ = 11

/** Seed stall, north side of the square. */
export const SHOP_POS = new THREE.Vector3(SQUARE_CX + 2.5, 0, -8)

/**
 * Animal store, at the *north* end of the lane, with its paddock beside it.
 *
 * It used to stand on the market square beside the seed stall, which put every
 * shop in the game within one screen of the spawn and left the lane — the
 * longest walk in the village — leading to nothing but a lantern. Splitting the
 * two stores to opposite ends gives the street a reason to exist: seeds at one
 * end, livestock at the other, and the farms in between.
 */
export const BARN_POS = new THREE.Vector3(LANE_X_MAX + 11, 0, -13)

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
export const PASTURE_CENTRE = new THREE.Vector3(LANE_X_MAX + 12, 0, 6)
export const PASTURE_RADIUS = 7.5

/**
 * The well, moved onto the market square.
 *
 * It used to cap the far end of the street from the square. There is no far end
 * any more — the west end is the player's own gate — and a well standing in
 * somebody's driveway is worse than no well. The middle of the square is where
 * a village well belongs anyway.
 */
export const WELL_POS = new THREE.Vector3(SQUARE_CX, 0, 0)

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
  // The street itself: all five neighbour plots plus the lane between them.
  {
    cx: 0,
    cz: 0,
    hx: ROW_SPACING + FENCE_HX + 0.5,
    hz: PLOT_CZ + FENCE_HZ + 0.5,
    falloff: 9,
  },
  // Market square at the east end.
  { cx: SQUARE_CX, cz: 0, hx: SQUARE_HX + 2, hz: SQUARE_HZ + 2, falloff: 9 },
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
  // The lane surface itself, west of the square.
  { cx: (LANE_X_MIN + LANE_X_MAX) / 2, cz: 0, hx: (LANE_X_MAX - LANE_X_MIN) / 2 + 2, hz: LANE_HALF + 3, falloff: 8 },
  /*
   * The player's clearing. Flattened like any other built ground — a farm on a
   * slope cannot have a square tile grid — and given a wide falloff so the
   * ground eases back into the woods rather than sitting on a plateau.
   */
  { cx: PLAYER_SLOT.x, cz: PLAYER_SLOT.z, hx: FENCE_HX + 2, hz: FENCE_HZ + 2, falloff: 11 },
]

// --- queries -----------------------------------------------------------------

/** Extent of everything the village occupies, used to keep wild features out. */
export const VILLAGE_BOUNDS = {
  // Reaches west to the player's clearing, which caps the end of the street.
  minX: PLAYER_SLOT.x - FENCE_HX - 3,
  /*
   * Reaches east past the square to whichever of the paddock or the barn ends
   * furthest out — anything short of them lets the forest scatter plant trees
   * through the paddock fence.
   */
  maxX: Math.max(LANE_X_MAX + 4, PASTURE_CENTRE.x + PASTURE_RADIUS + 2, BARN_POS.x + 8),
  minZ: Math.min(-(PLOT_CZ + FENCE_HZ), BARN_POS.z - 8) - 4,
  maxZ: Math.max(PLOT_CZ + FENCE_HZ, PASTURE_CENTRE.z + PASTURE_RADIUS, SQUARE_HZ) + 4,
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
  // The player's clearing is not one of the lane slots any more, so it has to
  // be named explicitly — without it the forest scatter plants trees inside the
  // player's own fence.
  return (
    inPlayerPlot(x, z, margin) ||
    NEIGHBOUR_SLOTS.some(
      (s) => Math.abs(x - s.x) < FENCE_HX + margin && Math.abs(z - s.z) < FENCE_HZ + margin,
    )
  )
}

/** True on the lane surface, including the market square and the north circle. */
export function onLane(x: number, z: number, margin = 0) {
  if (Math.abs(z) < LANE_HALF + margin && x > LANE_X_MIN - margin && x < LANE_X_MAX + margin) {
    return true
  }
  return Math.abs(x - SQUARE_CX) < SQUARE_HX + margin && Math.abs(z) < SQUARE_HZ + margin
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
