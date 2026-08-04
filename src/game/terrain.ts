import * as THREE from 'three'
import { getGroundTextures, tiled } from '../assets/textures'
import { FLAT_PADS } from './village'

/**
 * Heightfield terrain for the valley.
 *
 * The world is an open valley ringed by mountains rather than an island: the
 * mountain wall is what bounds the player, so there is no invisible barrier
 * and no visible map edge. Rivers and lakes are *carved* out of the same
 * height function that raises the mountains, which is what keeps shorelines
 * consistent — water is simply a flat plane at WATER_LEVEL, and any terrain
 * dipping below it reads as submerged.
 *
 * The valley is sized around the village street (see village.ts): six farms in
 * two facing rows is a footprint roughly 75 units wide and 100 long, so the
 * wild land has to start well outside that or the map reads as one flat sheet.
 * Every river, lake and hill below is positioned clear of VILLAGE_BOUNDS —
 * moving one means re-checking it against that box.
 */

/** Side length of the terrain mesh. Generously larger than the walkable area
 *  so the mountain wall never ends inside the camera frustum. */
export const WORLD_SIZE = 300

/** Quads per side. One quad ≈ 1.15 world units, which is the faceting scale
 *  that reads as deliberate low-poly rather than as a rendering artifact.
 *  Grown with WORLD_SIZE rather than held fixed: a coarser quad on a larger
 *  sheet is a different-looking world, and the faceting is the art direction. */
const SEGMENTS = 260

/** Height of the water surface. Everything below is underwater. */
export const WATER_LEVEL = -0.9

/**
 * Hard clamp on how far the player can wander, well inside the mountains.
 *
 * The open valley between the village and the treeline is the room the game has
 * to breathe in, and at 84 the forest started almost as soon as the fences
 * ended — the walk to the far bank was over before it began. Widening the ring
 * rather than moving the village keeps every landmark where players know it and
 * spends the new space entirely on wild land.
 */
export const WALK_LIMIT = 106

// --- palette -----------------------------------------------------------------
/** Warm shore tint — must stay R/G-led over B so the sand-map mix recognises it. */
const C_SAND = new THREE.Color(0xe8d09a)
const C_GRASS = new THREE.Color(0x7ec850)
const C_GRASS_D = new THREE.Color(0x5fa83c)
const C_ROCK = new THREE.Color(0xa8a9a2)
const C_ROCK_D = new THREE.Color(0x8b8d86)
const C_SNOW = new THREE.Color(0xf2f4f7)

// --- noise -------------------------------------------------------------------

function hash2(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function smootherstep(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function valueNoise(x: number, z: number) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = smootherstep(x - ix)
  const fz = smootherstep(z - iz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}

function fbm(x: number, z: number, octaves = 4) {
  let sum = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fz = z
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(fx, fz) * amp
    norm += amp
    amp *= 0.5
    fx *= 2.03
    fz *= 2.03
  }
  return sum / norm
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// --- world features ----------------------------------------------------------

/**
 * How strongly the village flattens the ground under it.
 *
 * Each pad in FLAT_PADS is a rounded rectangle — a box half-extent plus a
 * falloff the flattening eases out over. Boxes rather than discs because a
 * disc large enough to cover the street's corners would flatten a huge circle
 * of otherwise interesting land.
 *
 * The strongest pad wins rather than the sum, or overlapping pads would push
 * the mask past 1 and invert the terrain.
 */
function basinMask(x: number, z: number) {
  let mask = 0
  for (const pad of FLAT_PADS) {
    const dx = Math.max(0, Math.abs(x - pad.cx) - pad.hx)
    const dz = Math.max(0, Math.abs(z - pad.cz) - pad.hz)
    const m = 1 - smoothstep(0, pad.falloff, Math.hypot(dx, dz))
    if (m > mask) mask = m
  }
  return mask
}

/**
 * Sinuous river channels. Each is a centreline plus a cross-section.
 *
 * The section is a flat bed with sloped banks, not a smooth trough. A trough
 * (`1 - smoothstep(0, width, d)`, squared) only reaches full depth at the exact
 * centreline and climbs away from it immediately, so the part actually under
 * WATER_LEVEL was a strip about three units across — narrower than the bridge
 * plank over it, and read from the bank as a wet ditch. A bed that holds its
 * depth for `width` either side of centre and *then* climbs over `bank` puts a
 * river's worth of water on the surface, and confines the earthworks to
 * width + bank rather than smearing a shallow depression across the valley.
 */
interface River {
  /** Centreline position on the cross axis, given the along axis value. */
  centre: (a: number) => number
  /** 'x' means the river runs along X and `centre` returns a Z. */
  along: 'x' | 'z'
  /** Half-width of the flat bed. */
  width: number
  /** How far beyond the bed the bank climbs back to ground level. */
  bank: number
  depth: number
}

/**
 * Three rivers: one down each side of the village, both draining into a third
 * that runs across the south of the valley.
 *
 * There were four — one off each side, each straight along its own axis — and
 * seen from overhead they crossed at four right angles and read as a noughts-
 * and-crosses grid. Water does not do that. The fix is in two parts, and both
 * matter: there is no channel across the *north*, so the pattern is a Y rather
 * than a hash; and every centreline now carries a linear term as well as a
 * sine, so each one runs at a slant and the two confluences fall out in far
 * corners of the map instead of squarely beside the farms.
 *
 * Kept in from the mountain feet rather than pushed out with the wall when the
 * valley grew. A river against the treeline is scenery you never reach; a river
 * a short walk beyond the fences is a *place*, with a far bank, a crossing, and
 * a reason for the bridges to exist.
 *
 * Amplitudes are large relative to the channel width on purpose: at ±2 units a
 * river reads as a wobbly canal, and it takes a swing wider than the water
 * itself before the eye accepts it as a course something carved. Every centre
 * stays clear of VILLAGE_BOUNDS across its whole swing.
 *
 * Both side channels sit twelve units further out than they first did. At the
 * original offsets the east channel's *bank* began level with the pasture rail
 * — the water was a short walk from the farms, which was the intent, but the
 * earthworks reached the village and the plots looked like they had been built
 * on a riverbank. Out here the walk is still short (the walk limit is 106) and
 * the channels read as the edge of the valley rather than as the edge of the
 * farm.
 */
const RIVERS: River[] = [
  /*
   * There is no west channel any more. It ran at x = -74, which the ocean now
   * covers outright — a river carved along the sea bed is invisible, and its
   * bridge stood in open water. The coast does that side's job, and the south
   * channel below drains into it, which is a better story than the two of them
   * running in parallel ever was.
   */
  { along: 'z', centre: (z) => 72 - z * 0.18 + Math.sin(z * 0.042 + 1.4) * 8, width: 3.0, bank: 6.0, depth: 3.4 },
  { along: 'x', centre: (x) => -76 - x * 0.12 + Math.sin(x * 0.04 + 2.2) * 8, width: 2.8, bank: 6.0, depth: 3.2 },
]

interface Lake {
  x: number
  z: number
  r: number
  depth: number
}

/**
 * Lakes, most of them sitting *on* a river's centreline.
 *
 * A lake dropped on open ground is a puddle with no story — the eye asks where
 * the water came from and gets no answer. Centred on a channel it reads as the
 * river widening into a pool and narrowing out of it again, and the two carves
 * blend because they are the same subtraction from the same height function.
 * The coordinates below are the centreline evaluated at that z (or x); moving a
 * river means recomputing them or the pool detaches and becomes a puddle again.
 */
/**
 * Lakes, most of them sitting *on* a river's centreline.
 *
 * A lake dropped on open ground is a puddle with no story — the eye asks where
 * the water came from and gets no answer. Centred on a channel it reads as the
 * river widening into a pool and narrowing out of it again, and the two carves
 * blend because they are the same subtraction from the same height function.
 * The coordinates below are the centreline evaluated at that z; moving a river
 * means recomputing them or the pool detaches and becomes a puddle again.
 */
const LAKES: Lake[] = [
  // On the east channel, level with the square.
  { x: 75, z: 20, r: 12, depth: 3.6 },
  // The head of the valley: the one body of water big enough to be a landmark,
  // and the only one placed for the view rather than for the drainage.
  { x: 6, z: 82, r: 19, depth: 4.2 },
  // A tarn in the south, for water that is not on the way to anywhere.
  { x: -26, z: -78, r: 11, depth: 3.2 },
]

/**
 * Standalone hills outside the village so the valley is not a flat sheet.
 *
 * Pushed out and added to with the wider ring: the same four hills spread over
 * half again as much ground left long empty sightlines, and an empty sightline
 * in a valley this size reads as unfinished rather than as open.
 *
 * Wide and low rather than tall and tight. The first pass at this put ten units
 * of rise inside a seventeen-unit radius, which is a gradient over the walkable
 * limit for most of the flank — six hills the player could see and not climb,
 * which is scenery pretending to be terrain. Half again the radius for a little
 * less height keeps every one of them walkable over, and a hill you can stand
 * on top of is worth more than a taller one you cannot.
 */
const HILLS = [
  // These two sit *inside* the channels rather than beyond them. A hill whose
  // flank overlaps a river fills the bed — hills are added before the carve, so
  // the subtraction lands on raised ground and the water simply stops being
  // water for the length of the overlap.
  { x: 10, z: 72, r: 20, h: 8 },
  { x: 44, z: 56, r: 20, h: 7.5 },
  { x: -14, z: -84, r: 22, h: 7 },
  { x: 64, z: -22, r: 22, h: 7.5 },
  { x: 34, z: 84, r: 24, h: 9 },
  { x: 30, z: -92, r: 22, h: 8 },
]

/** Distance from the valley centre where the mountain wall starts to rise. */
const MOUNTAIN_START = 96
const MOUNTAIN_FULL = 132

/**
 * The skyline, as summits placed around the compass.
 *
 * A ring whose height depends only on distance is an extruded circle: from
 * inside it, it is a featureless band of rock filling the sky from horizon to
 * frustum top, with no silhouette and nowhere for sky to show through. What
 * makes a range read as mountains is the *variation along* it — distinct summits
 * with lower saddles between them.
 *
 * `at` is a compass bearing in radians, `height` a multiplier on MOUNTAIN_RISE,
 * and `width` the summit's angular half-width. The saddles between them are
 * still tall enough to block the player (see isWalkable), they just sit low
 * enough to let sky through.
 */
const SUMMITS: { at: number; height: number; width: number }[] = [
  /*
   * Re-cut as massifs rather than as an evenly spaced dozen.
   *
   * The old ring alternated tall-short-tall-short all the way round at roughly
   * equal spacing, and regular spacing is exactly what stops a range reading as
   * a range — it came out as scalloping, the same shape twelve times. These
   * come in groups instead: a peak with a lower shoulder right beside it, then
   * a genuinely wide gap before the next group. Each group reads as one massif
   * seen from an angle, and the gaps are where the sky gets in.
   */
  { at: 0.14, height: 1.62, width: 0.24 },
  { at: 0.46, height: 1.18, width: 0.17 },
  { at: 1.05, height: 0.74, width: 0.26 },
  { at: 1.46, height: 1.74, width: 0.22 },
  { at: 1.72, height: 1.3, width: 0.16 },
  { at: 2.34, height: 0.8, width: 0.28 },
  { at: 2.72, height: 1.48, width: 0.26 },
  { at: 3.36, height: 1.82, width: 0.2 },
  { at: 3.62, height: 1.44, width: 0.18 },
  { at: 4.02, height: 0.72, width: 0.24 },
  { at: 4.55, height: 1.56, width: 0.28 },
  { at: 4.88, height: 1.12, width: 0.16 },
  { at: 5.48, height: 0.78, width: 0.26 },
  { at: 5.86, height: 1.4, width: 0.2 },
]

/**
 * Height a summit of multiplier 1.0 reaches once the ramp is fully in.
 *
 * Raised with MOUNTAIN_START. A wall reads by the angle it subtends, not by its
 * height in metres, so moving the same 34-unit ring from 70 units out to 96
 * would have shrunk it by a third — the valley would have gained floor and lost
 * its horizon on the same edit.
 */
const MOUNTAIN_RISE = 46
/**
 * Floor on the profile, so the saddles are still a wall rather than a gateway.
 *
 * Lowered to 0.34 to let more sky through the gaps between massifs. Still well
 * clear of the barrier it has to be: 0.34 x 46 is a fraction over 15 units, and
 * isWalkable refuses anything above 13.
 */
const SADDLE = 0.34

function bearingDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Skyline multiplier for a compass bearing: 1.0 at a nominal summit. */
function summitProfile(bearing: number) {
  let m = SADDLE
  for (const s of SUMMITS) {
    const d = bearingDelta(s.at, bearing) / s.width
    const peak = s.height * Math.exp(-d * d)
    if (peak > m) m = peak
  }
  return m
}

/**
 * The open sea, as an arc of the compass where the mountain wall simply is not.
 *
 * The valley is otherwise a closed bowl, and a closed bowl has no horizon —
 * every sightline ends on rock at the same distance. Opening one side to water
 * gives the map a direction that means something: a wall you turn your back on,
 * and a view you walk toward.
 *
 * Expressed as a bearing window rather than a half-plane, so the coast curves
 * away at both ends and the mountains close in behind it. That is what makes it
 * read as a bay rather than as a map edge that stops being drawn. The feather is
 * the arc over which mountain gives way to water; too tight and the last summit
 * ends in a cliff standing in the sea.
 *
 * `heightAt` measures bearing as `atan2(z, x)`, so PI is due west (−x).
 */
export const OCEAN_BEARING = Math.PI
/** Half-width of the fully open arc, in radians — about 115 degrees of coast. */
export const OCEAN_HALF = 1.0
/**
 * Arc over which the wall gives way to the water.
 *
 * Widened from 0.45. At that width the ring went from nothing to its full
 * forty-six units inside about a quarter turn, which at this radius is forty
 * metres of arc — so the headlands either side of the bay reared straight out of
 * the beach at close to full height, and the coast was overshadowed by a cliff
 * from the moment you got there.
 *
 * Just over a radian spreads that climb across roughly a hundred metres of
 * coastline instead. The wall now *ramps*: low hills at the water, rising along
 * the shore, full mountains only well round the far side. The valley reads as a
 * bowl tipped toward the sea rather than as a crater with a bite taken out.
 *
 * Widening this does drop the north and south walls to around two thirds height,
 * which is fine for containment — WALK_LIMIT is the real boundary out here, and
 * the ramp only reaches a few units tall by the time it gets there anyway.
 */
export const OCEAN_FEATHER = 0.95

/** 1 out to sea, 0 where the mountain ring stands untouched. */
export function oceanMask(bearing: number) {
  const d = Math.abs(bearingDelta(OCEAN_BEARING, bearing))
  return 1 - smoothstep(OCEAN_HALF, OCEAN_HALF + OCEAN_FEATHER, d)
}

/**
 * Where the seaward ground starts to fall, and where it reaches the sea bed.
 *
 * These are much tighter than the mountain wall they replaced. Putting the
 * shore where the wall stood kept the valley's size but left the sea a hundred
 * units from the farms — visible from the plots and a genuinely long walk, so it
 * read as a painted backdrop rather than as somewhere to go. Bringing it in to
 * the mid-fifties puts the waterline about forty units past the west fence line,
 * which is the same distance the east river sits at.
 *
 * The fall is long and quadratic on purpose. The beach is the shallow head of
 * that curve — a slope steep enough to reach depth quickly gives a waterline
 * you cannot stand beside, which is the one thing a beach has to offer.
 */
const SHORE_START = 48
const SHORE_FULL = 100
const OCEAN_DEPTH = 14

export function heightAt(x: number, z: number): number {
  // Rolling ground.
  let h = (fbm(x * 0.026 + 100, z * 0.026 + 100) - 0.5) * 3.2

  // Interior hills.
  for (const hill of HILLS) {
    const d = Math.hypot(x - hill.x, z - hill.z)
    const t = 1 - smoothstep(0, hill.r, d)
    h += t * t * hill.h
  }

  // Mountain ring, everywhere the sea is not.
  const d = Math.hypot(x, z)
  const bearing = Math.atan2(z, x)
  const sea = oceanMask(bearing)

  if (sea < 1 && d > MOUNTAIN_START) {
    const t = smoothstep(MOUNTAIN_START, MOUNTAIN_FULL, d)
    const profile = summitProfile(bearing)
    const wall = 1 - sea
    h += wall * t * t * MOUNTAIN_RISE * profile
    // Craggy detail scaled by the ramp *and* the profile, so summits break up
    // into ridges and spurs while the saddles stay smooth. Scaled with the rise
    // for the same reason the rise itself grew — detail that stayed at 20 while
    // the peaks went to 46 would have sanded the range smooth.
    h += wall * (fbm(x * 0.055, z * 0.055, 5) - 0.5) * 26 * t * profile
  }

  /*
   * The seaward fall, on the same arc the wall gave up.
   *
   * Subtracted rather than assigned, so the rolling ground and any hill that
   * happens to sit near the coast still shape it — that is what turns the
   * headland at (-66, -48) into a headland instead of a bite out of a circle.
   */
  if (sea > 0 && d > SHORE_START) {
    const t = smoothstep(SHORE_START, SHORE_FULL, d)
    h -= sea * t * t * OCEAN_DEPTH
  }

  // Carve rivers. Flat bed out to `width`, banks climbing over `bank`.
  for (const r of RIVERS) {
    const along = r.along === 'x' ? x : z
    const cross = r.along === 'x' ? z : x
    const dist = Math.abs(cross - r.centre(along))
    if (dist < r.width + r.bank) {
      h -= (1 - smoothstep(r.width, r.width + r.bank, dist)) * r.depth
    }
  }

  // Carve lakes.
  for (const l of LAKES) {
    const dl = Math.hypot(x - l.x, z - l.z)
    if (dl < l.r * 1.5) {
      const t = 1 - smoothstep(l.r * 0.45, l.r * 1.25, dl)
      h -= t * l.depth
    }
  }

  // Flatten the village pads last so no river, lake or hill can intrude on the
  // ground the street is built on.
  const mask = basinMask(x, z)
  if (mask > 0) h = h * (1 - mask)

  return h
}

/** Steepness at a point, as a rise-over-run ratio. */
export function slopeAt(x: number, z: number, step = 1.1) {
  const dx = heightAt(x + step, z) - heightAt(x - step, z)
  const dz = heightAt(x, z + step) - heightAt(x, z - step)
  return Math.hypot(dx, dz) / (step * 2)
}

/**
 * Bridges. Axis-aligned decks that override the heightfield so the player can
 * cross a river channel instead of walking the long way around it.
 */
export interface Bridge {
  x: number
  z: number
  /** Half-extents. */
  hw: number
  hd: number
  /** Deck height. */
  y: number
  /** Which axis the deck runs along. */
  along: 'x' | 'z'
}

/**
 * One crossing per river, each on the straight line out of the village.
 *
 * Positions are the river's own centreline evaluated where the crossing sits —
 * `52 + sin(1.2) * 8` for the east channel at z = 0, and so on. A bridge placed
 * by eye lands a few units off a meandering course and leaves the player able to
 * walk round the end of it, which is worse than no bridge at all.
 */
export const BRIDGES: Bridge[] = [
  // East channel, due east: 72 - 0 * 0.18 + sin(1.4) * 8.
  { x: 80, z: 0, hw: 9, hd: 2.4, y: 0.9, along: 'x' },
  // South channel, straight down the lane: -76 - 0 * 0.12 + sin(2.2) * 8.
  { x: 0, z: -69.5, hw: 2.4, hd: 9, y: 0.9, along: 'z' },
]

export function bridgeAt(x: number, z: number): Bridge | null {
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) <= b.hw && Math.abs(z - b.z) <= b.hd) return b
  }
  return null
}

/** Height the player's feet rest at — terrain, or a bridge deck if on one. */
export function groundHeight(x: number, z: number) {
  const b = bridgeAt(x, z)
  if (b) return b.y
  return heightAt(x, z)
}

/** Can the player stand here? Water and cliffs say no; bridges say yes. */
export function isWalkable(x: number, z: number) {
  if (Math.hypot(x, z) > WALK_LIMIT) return false
  if (bridgeAt(x, z)) return true
  const h = heightAt(x, z)
  /*
   * Right down to the waterline, not a hand's breadth above it.
   *
   * The old margin of 0.25 was written for lake and river banks, where it keeps
   * the player from standing in the shallows and looking like they are walking
   * on water. On a beach it fenced off the wet sand — the strip between the dry
   * dune and the surf, which is the part of a beach anyone actually walks along
   * — and left an invisible wall a couple of metres short of the sea.
   *
   * Held a hair above WATER_LEVEL rather than at it, so the boundary lands on
   * sand rather than on the surface itself and there is no frame where the
   * farmer's feet are under the plane.
   */
  if (h < WATER_LEVEL + 0.02) return false
  if (h > 13) return false
  /*
   * Slope is not tested on the shore.
   *
   * The seaward fall is gentle by design, but the fbm roll on top of it puts
   * occasional patches over the cliff threshold, and on an otherwise flat beach
   * those read as nothing at all — the player simply stops, in the open, on
   * sand, for no visible reason. There is nothing to fall off here: the water
   * is the boundary, and it is already enforced above.
   */
  if (h < WATER_LEVEL + 2.4 && oceanMask(Math.atan2(z, x)) > 0.25) return true
  return slopeAt(x, z) < 0.72
}

/**
 * Beach: coastal ground low enough to be sand rather than meadow.
 *
 * One test, exported, because four different things plant trees — the global
 * forest scatter, the wood around the player's clearing, the thickets over the
 * unbuilt village, and the neighbours' plots — and each of them had to learn
 * separately not to put a pine on a beach. They did not, so the shore ended up
 * with conifers standing in the sand.
 *
 * Matches the band the terrain shader paints as sand (see createTerrainMesh) so
 * the rule and the look cannot drift apart. Palms are placed *against* this
 * rather than excluded by it — they are the one thing that belongs here.
 */
export function isSand(x: number, z: number) {
  const coast = oceanMask(Math.atan2(z, x)) * smoothstep(38, 56, Math.hypot(x, z))
  if (coast <= 0.05) return false
  return heightAt(x, z) < WATER_LEVEL + 0.7 + coast * 2.6
}

/** Good spot for scattered decoration: on land, not too steep, not in the farm. */
export function isPlantable(x: number, z: number) {
  const h = heightAt(x, z)
  return h > WATER_LEVEL + 0.5 && h < 17 && slopeAt(x, z) < 0.85
}

// --- meshes ------------------------------------------------------------------

export function createTerrainMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const { grass, sand } = getGroundTextures()
  // ~4 world units per tile keeps tufts readable from the iso camera.
  const grassMap = tiled(grass, WORLD_SIZE / 4)
  const sandMap = tiled(sand, WORLD_SIZE / 3.2)

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = heightAt(x, z)
    pos.setY(i, h)

    const slope = slopeAt(x, z)
    const tint = fbm(x * 0.09, z * 0.09, 2)

    /*
     * The sand band is far wider on the coast than around a pond.
     *
     * Inland, sand is a thin lip where the grass meets the water — that is what
     * a lake shore looks like. A beach is the opposite: metres of dry sand well
     * above the waterline, and holding it to the pond's 0.7 of a unit gave the
     * coast a green lawn running to the sea's edge. Widened by the same ocean
     * mask that removed the mountains, and only out where the shore actually is,
     * so nothing inland changes.
     */
    const coast = oceanMask(Math.atan2(z, x)) * smoothstep(38, 56, Math.hypot(x, z))
    const sandTop = WATER_LEVEL + 0.7 + coast * 2.6

    if (h < sandTop) {
      // Sandy shoreline, fading into grass just above the waterline.
      c.copy(C_SAND).lerp(C_GRASS, smoothstep(WATER_LEVEL + 0.1, sandTop, h))
    } else if (h > 30) {
      // Snow line sits above the saddles (0.34 x MOUNTAIN_RISE, about 15.6) so
      // it caps the summits rather than whitewashing the whole ring. Nothing
      // inside the valley comes close — the tallest interior hill tops out at 11.
      c.copy(C_ROCK_D).lerp(C_SNOW, smoothstep(30, 54, h))
    } else if (h > 13 || slope > 0.62) {
      const rocky = Math.max(smoothstep(13, 19, h), smoothstep(0.62, 0.95, slope))
      c.copy(C_GRASS_D).lerp(tint > 0.5 ? C_ROCK : C_ROCK_D, rocky)
    } else {
      c.copy(C_GRASS).lerp(C_GRASS_D, tint * 0.75)
    }

    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  // Grass albedo is the base map; shore vertices get a sand map mix via a
  // tiny shader patch so beaches don't keep the grass tuft pattern.
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    map: grassMap,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSandMap = { value: sandMap }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D uSandMap;
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec4 grassSample = texture2D(map, vMapUv);
          vec4 sandSample = texture2D(uSandMap, vMapUv);
          // Warm sand: high R+G and clearly warmer than its blue (beige shores
          // still carry real B — the old "low B" gate never fired, so sand.png
          // never mixed in and beaches stayed flat vertex colour).
          float sandW = smoothstep(0.55, 0.75, vColor.r)
            * smoothstep(0.50, 0.70, vColor.g)
            * smoothstep(0.05, 0.18, vColor.r - vColor.b);
          // Green dominance keeps tufts on meadows; rock/snow stay flat.
          //
          // No constant term. A floor here leaks grass detail onto every
          // surface whose green is *not* dominant — which is rock and snow —
          // and a third of a grass texture over white is what turned the
          // snowcaps grey-green. The gain is steep instead, so meadow greens
          // still saturate to a full tuft.
          float grassW = clamp((vColor.g - max(vColor.r, vColor.b)) * 8.0, 0.0, 1.0);
          sandW *= 1.0 - grassW;
          vec4 detail = mix(grassSample, sandSample, clamp(sandW, 0.0, 1.0));
          float detailW = max(grassW, sandW);
          vec4 sampledDiffuseColor = mix(vec4(1.0), detail, detailW);
          // Shores: prefer sand.png over vertexColour × map (the tint was
          // flattening the pebble grain into a solid beige slab).
          diffuseColor.rgb = mix(
            diffuseColor.rgb * sampledDiffuseColor.rgb,
            sandSample.rgb,
            clamp(sandW, 0.0, 1.0)
          );
          diffuseColor.a *= sampledDiffuseColor.a;
        #endif
        `,
      )
  }

  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}

