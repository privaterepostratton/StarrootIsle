import * as THREE from 'three'
import { bakeGroup, makeInstancedChunks, type Placement } from '../../assets/bake'
import { MINOR_LAYER, rng } from '../../assets/style'
import { groundHeight, isSand } from '../terrain'
import type { Obstacle } from '../world'
import {
  createLoamPatch,
  RAMP_SHADE_GREEN,
  type LoamPatch,
  type LoamRamp,
} from '../../assets/opening/loam'
import {
  createBasaltOutcrop,
  createBroadleafClump,
  createCanopyOverhang,
  createFernTuft,
  createFrondFan,
  createJungleCanopyA,
  createJungleCanopyB,
  createJungleTrunk,
  createLightShaft,
  createMonsteraStand,
  createUnderThicket,
  createVineCurtain,
  FROND_MAX_HEIGHT,
} from '../../assets/opening/jungle-props'

/**
 * The jungle wall (spec asset manifest, environment 5–8).
 *
 * The opening's one-sentence brief is "a stranger making one small pocket of
 * order inside something vast, green, and alive" — and the vast green alive
 * thing has to be *on screen*, not implied. Without it the beach reads as a
 * mown lawn with a garden on it, which is exactly what the first build did.
 *
 * So: a horseshoe of dense foliage wrapped around the chaos pocket, open to
 * the sea at a single gap. Three things it has to achieve, in order:
 *
 *  1. **Impassable.** No sky and no sea through the treeline from the beach
 *     camera. That is a density problem, not a height problem: three ranks of
 *     canopy still left a knee-height band of lit grass showing between the
 *     trunks, and it took a dedicated understory *plug* rank to close it. The
 *     ranks behind that exist to fill each other's holes — the rear rank is set
 *     back and tall so its crowns show through the gaps in front of it. A chain
 *     of overlapping colliders backs the visual read up, because a wall you can
 *     stroll through is not a wall.
 *  2. **Looming.** The wall runs 8–11 units with emergents past 13, against a
 *     valley whose own trees are 5.6 and a camera that sits around six.
 *     Portrait framing puts the avatar low and the world above, and this is the
 *     world above.
 *  3. **One doorway.** The gap is the only way through — a three-unit walkable
 *     slot at z ≈ 0 — arched by two overhang modules, lit by shafts, and
 *     dressed with the opening's single splash of magenta (that dressing ships
 *     from chaos-pocket.ts). Wayfinding by architecture instead of by an arrow.
 *
 * Density is bought with instancing, the same bargain the valley's forest
 * makes: every module is baked once to a vertex-coloured geometry and drawn
 * with `makeInstancedChunks`, so ~470 pieces of jungle cost around 60 draw
 * calls and ~118k triangles. Only the front rank moves, and it moves in a
 * vertex shader (grass's trick), which is the only way sway and instancing can
 * coexist.
 *
 * Lifetime: this is an **opening-only** prop. `setVisible(false)` hides it and
 * releases every collider; `dispose()` removes it from the scene for good. The
 * integrator must do one or the other at handover, or the wall stands between
 * the finished farm and the village lane forever.
 */

/** Centre the horseshoe wraps — the pocket/farm pad, contract §4.1. */
const CENTRE = new THREE.Vector2(-32, 0)

/**
 * The wall's spine, from the south lip of the gap all the way round to the
 * north lip. It is a polyline, not an ellipse, because the two ends have to
 * land precisely on the gap mouth and the arms have to clear the farm's fence
 * footprint (x ∈ [-38.7, -25.3], z ∈ [-6.7, 6.7]) with two-odd units of grass
 * to spare — an ellipse fitted to those constraints ends up a much bigger ring
 * than the clearing wants to feel.
 *
 * Walking it in one direction (south → east → north) is what leaves the gap:
 * the polyline simply never crosses it.
 */
const SPINE: [number, number][] = [
  [-41.7, -3.2],
  [-41.4, -6.4],
  [-40.5, -9.0],
  [-38.6, -10.9],
  [-35.2, -11.8],
  [-31.3, -12.0],
  [-27.3, -11.6],
  [-23.8, -10.1],
  [-21.4, -7.0],
  [-20.8, -3.2],
  [-20.8, 3.2],
  [-21.4, 7.0],
  [-23.8, 10.1],
  [-27.3, 11.6],
  [-31.3, 12.0],
  [-35.2, 11.8],
  [-38.6, 10.9],
  [-40.5, 9.0],
  [-41.4, 6.4],
  [-41.7, 3.2],
]

/** Middle of the doorway, between the two lips. */
const GAP_X = -40.6

/**
 * The wings: the same jungle continued up and down the coast.
 *
 * The horseshoe alone is a copse. From the wake position — which is the one
 * framing the whole opening is staked on — the player looks past both of its
 * ends and sees the valley: bright meadow, the ordinary lollipop trees, and the
 * village's terracotta terraces sitting on the skyline of what is supposed to
 * be an uninhabited island the morning you washed up on it. No amount of
 * density inside the horseshoe fixes a view around it.
 *
 * So two arms run north and south from the ring, hugging the shoreline. They
 * are built by *finding* the shore rather than by hand-placed coordinates: at
 * each step, march seaward until the ground turns to sand, then stand the wall
 * a metre inland of that. The coast is an arc, and a straight line of trees
 * drawn along it either wades into the water at one end or leaves a wedge of
 * meadow at the other.
 *
 * Wings carry no colliders. They are scenery closing a sightline, not a fence,
 * and the player has no business up there in the first eight minutes.
 */
const WING_Z_START = 12.5
const WING_Z_END = 34
const WING_Z_STEP = 2.5
/** How far inland of the sand line the wing spine stands. */
const WING_INSET = 1.4
/** March range for finding the shore, in x. */
const WING_SEARCH = { from: -34, to: -60, step: 0.5 }

/**
 * The wings' "outward" is *inland*.
 *
 * Rank offsets are signed against it: positive is the back of the wall, where
 * the rear ranks and the emergents stand, and negative steps toward whatever
 * the wall faces. Round the horseshoe that is the clearing; along the coast it
 * is the sea. Getting this backwards stands the giants in the surf.
 */
const WING_OUTWARD = new THREE.Vector2(1, 0)

/**
 * Follow the coast: for each z, the x where the sand band begins.
 *
 * Returns a spine standing `inset` units inland of that line, or null if the
 * march found no sand — which means the coast has turned out of the search
 * band and the arm should simply stop rather than guess.
 */
function buildShoreSpine(zFrom: number, zTo: number, step: number, inset: number): Spine | null {
  const points: [number, number][] = []
  const dir = zTo >= zFrom ? 1 : -1
  for (let z = zFrom; dir > 0 ? z <= zTo : z >= zTo; z += step * dir) {
    let shore: number | null = null
    for (let x = WING_SEARCH.from; x > WING_SEARCH.to; x -= WING_SEARCH.step) {
      if (isSand(x, z)) {
        shore = x
        break
      }
    }
    if (shore === null) break
    points.push([shore + inset, z])
  }
  return points.length >= 2 ? new Spine(points, WING_OUTWARD) : null
}

/** One spine per wing, or none if the shore march finds nothing usable. */
function buildWingSpines(): Spine[] {
  const out: Spine[] = []
  for (const sign of [-1, 1]) {
    const spine = buildShoreSpine(WING_Z_START * sign, WING_Z_END * sign, WING_Z_STEP, WING_INSET)
    if (spine) out.push(spine)
  }
  return out
}

/**
 * Basalt at the jungle foot, hand-placed in world coordinates.
 *
 * Scattered by rule they end up evenly spaced, which is the one thing rocks
 * never are. These sit where the wall turns — the inside of a bend is where
 * loose rock actually collects — plus one at the threshold of the gap, well
 * clear of the walking corridor, to give the doorway a step.
 */
const BASALT: { x: number; z: number; variant: number; scale: number }[] = [
  { x: -40.0, z: -5.2, variant: 0, scale: 1.15 },
  { x: -37.4, z: -8.8, variant: 1, scale: 0.9 },
  { x: -30.6, z: -9.6, variant: 2, scale: 1.3 },
  { x: -24.2, z: -7.6, variant: 0, scale: 0.85 },
  { x: -22.6, z: -0.8, variant: 1, scale: 1.05 },
  { x: -23.0, z: 5.8, variant: 2, scale: 0.95 },
  { x: -29.0, z: 9.2, variant: 0, scale: 1.2 },
  { x: -37.8, z: 8.6, variant: 2, scale: 0.9 },
  { x: -40.2, z: 4.8, variant: 1, scale: 1.1 },
  { x: -41.4, z: -2.4, variant: 2, scale: 0.7 },
]

/**
 * The gap's light shafts, and the two rules that took three passes to learn.
 *
 * **They live on the shoulders of the doorway, never in it.** The last layout
 * ran a beam down the middle of the corridor on the theory that walking through
 * a shaft would feel good. What actually happens is that the gameplay camera
 * walks through it too, from the inside, at two metres — and the far side of a
 * beam seen from within is a full-screen veil. Beats 6 and 8 were both lost to
 * that. `WALK_CORRIDOR` below is the exclusion zone, asserted at build time so
 * a future edit to this table cannot quietly re-create the bug.
 *
 * **They hang, they do not stand.** `HANG` is the height of the canopy hole the
 * beam falls from and `height` is how far it falls; the card's own gradient
 * (see `createLightShaft`) has faded it to nothing well before the bottom, so
 * the visible beam is a streak up among the crowns rather than a column resting
 * on the floor. That is what dawn light through a canopy looks like, and it
 * also puts the whole effect above anywhere the camera can reach.
 *
 * `top`/`bot` are half-widths: hand's width at the mouth, under a metre where
 * it dies. Dawn sun is low in the east, so the beams lean *west* — negative
 * tilt, which walks the foot toward -x, toward the sea.
 */
const SHAFTS: { x: number; z: number; height: number; top: number; bot: number; tilt: number }[] = [
  { x: -40.2, z: -3.1, height: 7.4, top: 0.14, bot: 0.62, tilt: -0.30 },
  { x: -40.9, z: 3.4, height: 7.8, top: 0.16, bot: 0.7, tilt: -0.34 },
]

/** Where the beam's mouth hangs, above the ground under it. */
const SHAFT_HANG = 9.2

/**
 * The slot the player and the camera actually travel through, in world x/z.
 *
 * Any shaft whose axis lands inside it is dropped at build time rather than
 * shipped: the corridor is the one place in the scene where a translucent
 * effect is guaranteed to be met from the inside.
 */
const WALK_CORRIDOR = { x0: -44, x1: -37.5, z0: -2.2, z1: 2.2 }

/**
 * The jungle floor.
 *
 * The single loudest note in the first build's frames was the ground: a bright
 * kelly-green mown lawn with a tiled tuft texture, running from the sand right
 * through the treeline and out under the beds. Clearing chaos off a lawn is
 * mowing, not reclaiming — the order-from-chaos payoff and the Maui thesis died
 * on the same material.
 *
 * The valley's terrain is one baked mesh shared with the village twenty-five
 * units east, so its colours are not the opening's to repaint. Instead the wall
 * lays its own floor: conforming, feathered, opening-lifetime-only, and gone at
 * handover with everything else here.
 *
 * Three zones, all built from one noise field so they meet without a seam:
 *
 *  - **Interior** — the horseshoe's inside, in shaded jungle floor: dark green
 *    with olive leaf litter through it. This is the ground the pocket is choked
 *    on and the beds are dug into.
 *  - **Skirt** — a ring outside the wall in deep shade green, killing the lit
 *    verge that used to show between the trunks and the sand.
 *  - **Approach** — the same shade green run down the beach side, masked off
 *    the sand by `isSand` so it stops at the real shoreline rather than at a
 *    rectangle.
 */
const FLOOR_INTERIOR = { x: -31.4, z: 0, w: 25, d: 27, seed: 0x10a11 }

/**
 * The jungle floor's own colour — and the correction that matters most here.
 *
 * This field was previously drawn in the loam builder's *duff* ramp, a brown
 * litter tone chosen to sit a half-step from the cleared pocket. At twenty-five
 * units square that stopped being litter and became a mud plain: the goat's
 * arrival shot is an unbroken brown field from edge to edge, with the beds and
 * the cleared pocket invisible inside it. Which inverts the entire opening —
 * "one small pocket of order inside something vast, green and alive" only lands
 * if the pocket is *different from* what surrounds it. Cleared earth on brown
 * ground is not a clearing; it is more ground.
 *
 * So the floor is green: shaded, low-chroma, much darker than the valley's lawn
 * (it is under a canopy), with the noise's dry peaks and the crumb chips in a
 * dead olive-tan so what is scattered over it reads as fallen leaves. The
 * pocket's own loam patches — owned elsewhere — then land on this as the one
 * brown thing in the horseshoe, which is exactly the read the beat is for.
 *
 * Authored pre-light, like every ramp in loam.ts: the dawn rig plus the 1.2
 * saturation grade take these down by roughly a third.
 */
const RAMP_JUNGLE_FLOOR: LoamRamp = { dark: 0x2a4a30, mid: 0x437341, dry: 0x73894e }

/**
 * Damp earth: the hollows where the canopy drip lands and nothing dries out.
 *
 * A handful of small fields of this are scattered through the interior. They
 * are the one place the floor is allowed to be brown before the player clears
 * anything, and they are deliberately *small* — the lesson written into the
 * block above still stands, that a brown jungle floor makes the cleared pocket
 * invisible, so these are hollows within a green field rather than a second
 * ground colour. Green-brown, not soil-brown, and lower in chroma than the
 * pocket loam that has to out-read them.
 */
const RAMP_DAMP_EARTH: LoamRamp = { dark: 0x393524, mid: 0x504c2b, dry: 0x6c6a3a }

/**
 * Damp hollows, hand-placed relative to the ring centre.
 *
 * Off-centre and unevenly sized: scattered by rule they come out evenly spread,
 * which is the one thing puddled ground never is. Kept clear of the farm pad so
 * the beds are still dug into green.
 */
const DAMP_HOLLOWS: { dx: number; dz: number; w: number; d: number }[] = [
  { dx: -6.4, dz: -5.8, w: 4.2, d: 3.4 },
  { dx: 5.9, dz: -7.2, w: 3.1, d: 3.8 },
  { dx: 7.8, dz: 4.4, w: 4.6, d: 3.2 },
  { dx: -4.2, dz: 7.6, w: 3.4, d: 2.9 },
  { dx: 1.6, dz: -9.4, w: 3.8, d: 2.6 },
]

/**
 * Canopy dapple strength on the jungle floor.
 *
 * The largest surface in four of the nine beats, and until this pass it was a
 * single flat tone across every one of them — smooth sage green from the
 * treeline to the bottom of frame, with no detail at any scale. Painted dapple
 * is what breaks it: long seaward pools of gold between long bars of shade, at
 * a frequency the mesh can actually resolve. See `LoamPatchOptions.dapple`.
 */
const FLOOR_DAPPLE = 0.66

/**
 * The verge band, in world height.
 *
 * Terrain's coastal sand runs from the waterline up to about `WATER_LEVEL +
 * 3.3`, and its upper third is already tinted toward grass — that band is the
 * lit green hem the wall's floor has to cover. Below `VERGE_LOW` is open beach
 * and stays ivory.
 */
const VERGE_LOW = 1.55
const VERGE_HIGH = 2.35

/** Skirt fields, placed by arc-length along the spine at an outward offset. */
const SKIRT_SPACING = 6.5
const SKIRT_OFFSET = 2.4
const SKIRT_SIZE = 11

/** Foot-of-the-wall debris ring: small fields just *inside* the spine. */
const FOOT_SPACING = 4.2
const FOOT_OFFSET = -2.0
const FOOT_SIZE = 5.5

/**
 * The ranks, back to front. `offset` is measured outward from the spine, so a
 * negative number is a step into the clearing.
 *
 * The spacings are the whole design. The rear rank at 3.2 units looks sparse on
 * its own and is not meant to be seen on its own — it is the backing that shows
 * through the holes in front of it. The thicket at 0.7 plugs the base, the
 * broadleaf closes the waist, and the ferns at 0.6 make the line where jungle
 * meets grass a tangle rather than a hemline.
 */
interface RankSpec {
  build: (variant: number) => THREE.Group
  variants: number
  /** World units between pieces along the spine. */
  spacing: number
  /** Outward from the spine; negative steps into the clearing. */
  offset: number
  /** Random lateral wander, in units. */
  jitter: number
  scaleMin: number
  scaleMax: number
  /** How far the piece is pushed into the ground, to kill float on slopes. */
  sink: number
  castShadow: boolean
  /** Front rank only: draw with the trade-wind vertex shader. */
  sway?: boolean
  /** Small stuff skips the water's reflection and refraction passes. */
  minor?: boolean
  /** Phase along the spine, so ranks do not line up into rows. */
  phase: number
  /**
   * Per-rank multiplier on the baked vertex colours, as linear RGB.
   *
   * **This is the depth.** Every module in the parts kit authors its own
   * deep→lit gradient, but every rank was drawing that same gradient, so the
   * wall came back as one field of green with no front and no back — the
   * "flat curtain of polygon blobs" the review named. Aerial perspective is a
   * *value* ladder, and the cheapest place to put one on instanced geometry is
   * the colour buffer: darken and cool the ranks that are meant to be behind,
   * lift and warm the ones the dawn actually reaches.
   *
   * Warmth carries as much of it as brightness. The front rank's tint is
   * lopsided toward red and away from blue, which is what turns a lit green
   * into the spec's sunlit `#8FCF6B` rather than into a paler version of the
   * same shade — and the far ranks lean the other way, because distance is
   * blue. Postfx multiplies saturation by 1.2 afterwards, so the tints are
   * deliberately gentler than they look like they need to be.
   */
  tint?: [number, number, number]
  /**
   * 0..1 — how far the rank's normals are bent toward straight up.
   *
   * The sun is barely off the horizon and stands *behind* this wall: the side
   * facing the beach is the unlit side, so every sphere in the mass comes back
   * with a black western hemisphere and the whole treeline collapses to one
   * dark value. The parts kit already forces its leaf normals up for this
   * reason. Bending the lobes' normals the same way trades their (wrong, at
   * this scale) round shading for the sky's hemisphere light, and hands the
   * wall's whole value structure to the authored colours instead — which,
   * unlike the sun angle, is something this file controls.
   */
  normalUp?: number
  /** Drop any piece that lands closer than this to the ring centre — keeps the
   *  inward-spilling ranks out of the farm pad the beds are dug into. */
  keepOut?: number
  /** Set false to keep a rank off the coastal wings (see WING_* below). */
  wing?: boolean
}

const RANKS: RankSpec[] = [
  // Emergents — a handful of giants breaking the skyline.
  //
  // A wall of evenly tall trees produces a level top edge, and a level top edge
  // is a hedge again however deep the planting behind it. Six or seven of these
  // standing a third taller than everything else is what turns the outline into
  // a canopy with a story in it.
  //
  // Raised again after the second review: from the wake camera the treeline
  // still ended inside frame with sky over the top of it, and a treeline you
  // can see over is a hedge however deep it is. Emergents now run 1.6–2.05,
  // which puts their crowns past twenty units and off the top of a low
  // over-the-shoulder frame entirely — you cannot see where the jungle stops,
  // which is the only way "impassable" ever reads.
  //
  // Their scale spread was widened again for this pass: at 1.6–2.05 they were
  // all within a quarter of each other's height, and a row of near-identical
  // giants makes a *bumpy* skyline rather than an irregular one. 1.45–2.45 is
  // the same mean with two-thirds more spread, which is what puts real
  // difference between one crown and the next.
  {
    build: createJungleCanopyA,
    variants: 3,
    spacing: 6.4,
    offset: 3.4,
    jitter: 1.4,
    scaleMin: 1.45,
    scaleMax: 2.45,
    sink: 0.35,
    castShadow: false,
    phase: 2.2,
    // Furthest back: darkest and coolest. This is the value the interior of
    // the wall is measured against, near the spec's deep `#1E4A2A`.
    tint: [0.62, 0.72, 0.74],
    normalUp: 0.55,
  },
  // Rear rank — the backing. Tall, dark, set back. Roughly twice the height of
  // the valley's own trees (5.6u), which is what "looms" costs.
  {
    build: createJungleCanopyA,
    variants: 3,
    spacing: 2.6,
    offset: 2.2,
    jitter: 0.8,
    scaleMin: 1.0,
    scaleMax: 1.6,
    sink: 0.3,
    castShadow: false,
    phase: 0.4,
    tint: [0.7, 0.8, 0.8],
    normalUp: 0.55,
  },
  // Second rank — module B, the other silhouette, half a step forward.
  {
    build: createJungleCanopyB,
    variants: 3,
    spacing: 2.0,
    offset: 1.1,
    jitter: 0.7,
    scaleMin: 1.0,
    scaleMax: 1.38,
    sink: 0.25,
    castShadow: false,
    phase: 1.5,
    tint: [0.9, 0.97, 0.92],
    normalUp: 0.5,
  },
  // Third rank — module A again, on the spine, much smaller. This is the rank
  // the player actually stands in front of, and it sets the scale of the wall:
  // undersized here, the two behind it read as further away and therefore
  // bigger, which is the whole trick.
  {
    build: createJungleCanopyA,
    variants: 3,
    spacing: 2.1,
    offset: -0.1,
    jitter: 0.6,
    scaleMin: 0.6,
    scaleMax: 0.85,
    sink: 0.2,
    castShadow: false,
    phase: 0.9,
    tint: [1.14, 1.14, 0.98],
    normalUp: 0.5,
  },
  // The plug. Tight spacing and a jitter wider than the band it sits in, so
  // the pieces stagger across two depths instead of lining up into one row of
  // holes the player can look down as they walk past.
  {
    build: createUnderThicket,
    variants: 3,
    spacing: 0.55,
    offset: 0.35,
    jitter: 1.7,
    scaleMin: 0.95,
    scaleMax: 1.5,
    sink: 0.15,
    castShadow: false,
    phase: 0.3,
    // The deepest value on the wall and the one the whole ladder is anchored
    // to. What shows through the front rank's gaps has to read as *depth*.
    tint: [0.62, 0.7, 0.7],
    normalUp: 0.4,
  },
  // Trunks. Placed a step *into* the clearing, in front of the standing ranks,
  // because a trunk seen through foliage is not punctuation. Wide spacing: the
  // effect is columns cutting the mass into panels, and a column every two
  // metres is a palisade.
  {
    build: createJungleTrunk,
    variants: 3,
    spacing: 5.2,
    offset: -0.55,
    jitter: 1.0,
    scaleMin: 0.85,
    scaleMax: 1.3,
    sink: 0.25,
    castShadow: false,
    phase: 1.7,
    // Kept dark against everything behind it — a backlit trunk at dawn is a
    // silhouette, and the silhouette is the entire point of the rank.
    tint: [0.78, 0.78, 0.8],
    normalUp: 0.25,
  },
  // Vine curtains, hung against the third rank.
  {
    build: createVineCurtain,
    variants: 2,
    spacing: 4.6,
    offset: -0.4,
    jitter: 0.7,
    scaleMin: 0.85,
    scaleMax: 1.25,
    sink: 0.1,
    castShadow: false,
    minor: true,
    phase: 2.6,
    tint: [0.95, 1.0, 0.92],
    normalUp: 0.35,
  },
  // Mid rank — broadleaf, the wall's waist.
  {
    build: createBroadleafClump,
    variants: 3,
    spacing: 1.5,
    offset: -0.9,
    jitter: 0.5,
    scaleMin: 0.85,
    scaleMax: 1.5,
    sink: 0.1,
    castShadow: false,
    phase: 0.2,
    tint: [1.18, 1.14, 0.94],
    normalUp: 0.4,
  },
  // Monstera stands at the very front edge — the wall's scale rule.
  //
  // Sparse and dark: these are read as person-sized shapes against the lit
  // foliage behind them, which is the only thing in the treeline that tells the
  // player how big any of it is.
  {
    build: createMonsteraStand,
    variants: 3,
    spacing: 4.1,
    offset: -1.75,
    jitter: 1.1,
    scaleMin: 0.9,
    scaleMax: 1.45,
    sink: 0.06,
    castShadow: false,
    minor: true,
    phase: 2.9,
    tint: [0.84, 0.9, 0.82],
    normalUp: 0.3,
  },
  // Front rank — fronds. Sunlit, and the only thing here that moves.
  {
    build: createFrondFan,
    variants: 3,
    spacing: 0.85,
    offset: -1.1,
    jitter: 0.45,
    scaleMin: 1.0,
    scaleMax: 1.45,
    sink: 0.08,
    castShadow: false,
    sway: true,
    minor: true,
    phase: 1.1,
    // The dawn rim light, and the only warm tint on the wall. Everything else
    // here is a step on the way down from this.
    tint: [1.4, 1.28, 0.9],
    normalUp: 0.5,
  },
  // Ferns at the very foot, spilling a little further into the clearing so the
  // line where jungle meets grass is a tangle instead of a mown edge.
  {
    build: createFernTuft,
    variants: 3,
    spacing: 0.6,
    offset: -1.6,
    jitter: 0.75,
    scaleMin: 0.75,
    scaleMax: 1.4,
    sink: 0.05,
    castShadow: false,
    sway: true,
    minor: true,
    phase: 0.6,
    tint: [1.32, 1.24, 0.9],
    normalUp: 0.5,
  },
  // Fern mats, spilling three metres into the clearing.
  //
  // The floor field below turns the interior to duff, and bare duff over that
  // area is a car park. What a jungle interior actually has is scale on the
  // ground — clumps you walk around — and a scatter of small ferns thinning
  // inward gives the eye that without putting anything in the player's way.
  // Wide jitter and small scales: this is a thinning, not a second hedge.
  {
    build: createFernTuft,
    variants: 3,
    spacing: 1.5,
    offset: -3.2,
    jitter: 2.4,
    scaleMin: 0.45,
    scaleMax: 0.85,
    sink: 0.04,
    castShadow: false,
    sway: true,
    minor: true,
    phase: 1.9,
    keepOut: 8.0,
    // Nothing to spill into up the coast — the wings face open beach.
    wing: false,
    tint: [1.0, 1.02, 0.86],
    normalUp: 0.5,
  },
]

/**
 * Colliders along the spine.
 *
 * Circles at 1.4-unit spacing with a 1.5 radius overlap to at least 1.3 units
 * of depth everywhere, which no amount of sliding gets a player through — and
 * they sit half a unit inside the spine so the player is stopped by the fronds
 * they can see rather than by fresh air a metre short of them.
 */
const COLLIDER_SPACING = 1.4
const COLLIDER_RADIUS = 1.5
const COLLIDER_OFFSET = -0.6

/** Shared clock for the trade-wind sway, mirroring vegetation's grass uniform. */
const windTime = { value: 0 }

/**
 * Near-camera dissolve: where the wall gets between the lens and the player.
 *
 * The engine already collides the camera boom against obstacle circles
 * (`Engine.clearDistance`), and the spine plants one every 1.4 units — but a
 * circle on the spine only describes the *trunks*. This wall's whole design is
 * ranks that step INWARD of the spine (negative rank offsets) and six overhang
 * modules that lean out over the clearing on purpose, and none of that geometry
 * has a collider by construction: it is the canopy, and giving it one would
 * wall the player out of their own pocket.
 *
 * So the boom stops politely short of the trunks and the canopy hanging a metre
 * inside them swallows the lens anyway. In the clearing beats that is not a
 * cosmetic blemish — the frame the core beat is staked on came back as two flat
 * dark slabs with the dig rings barely visible between them.
 *
 * The fix is per-fragment rather than per-object: anything within
 * `NEAR_DISSOLVE_GONE` of the camera is discarded outright, and across the band
 * out to `NEAR_DISSOLVE_FULL` it thins out. Per-fragment matters because the
 * offenders are single huge double-sided leaf quads — hiding the *object* would
 * pop a whole frond in and out as the camera drifts, while dissolving the part
 * of it that is actually in the lens leaves the rest of the same leaf standing.
 *
 * The threshold is stippled against interleaved-gradient noise rather than
 * alpha-blended: these are opaque instanced Lambert meshes sorted by nothing in
 * particular, and turning them transparent would cost a sort per frame and give
 * back a pile of ordering artefacts in a scene that is nothing but overlapping
 * foliage. Stipple keeps the material opaque, costs one fract per fragment, and
 * at this radius the holes are far too fine to read as a pattern.
 *
 * Deliberately NOT applied to the shadow pass (three uses its own depth
 * material, which this never touches): a leaf dissolving out of the lens should
 * not also take its shadow off the ground three metres away, where the player
 * can plainly see the light has not changed.
 */
/*
 * Where the wall stops existing, and where it is fully solid again.
 *
 * The first tuning put `GONE` at 0.85, on the theory that only what is
 * practically touching the lens should be deleted. That is right for a leaf
 * drifting past the camera and wrong for the case this exists to fix: in the
 * harvest frame the camera sits *inside* the front ranks, so several metres of
 * foliage fell in the 0.85–3.1 stipple band at once and the frame came back as
 * a coarse screen-door hatch over half its width — an opaque slab traded for a
 * translucent one.
 *
 * 2.0 is the boom's own geometry talking. The gameplay camera rides about 4.8
 * units behind the player, so anything inside 2.0 of the lens is, without
 * exception, between the camera and the subject: there is nothing there the
 * player could want to see, and deleting it outright costs nothing and leaves
 * no pattern. The stipple then only has to cover 2.0–3.0, a band narrow enough
 * that what survives reads as foliage thinning out at the frame edge.
 */
const NEAR_DISSOLVE_GONE = 2.0
const NEAR_DISSOLVE_FULL = 3.0

/**
 * Inject the dissolve into a material's shader pair.
 *
 * Chains onto whatever `onBeforeCompile` the material already has instead of
 * replacing it — the sway material's wind bend lives in one, and assigning over
 * it would silently stop the treeline moving.
 */
function applyNearDissolve(material: THREE.Material, cacheKey: string) {
  const prev = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vCamDist;\nvoid main() {')
      // `project_vertex` is where `mvPosition` is built, so view depth is free
      // here and correct under instancing (the include applies instanceMatrix).
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vCamDist = -mvPosition.z;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vCamDist;\nvoid main() {')
      // Earliest anchor inside main(): discard before any lighting work.
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `
        #include <clipping_planes_fragment>
        {
          float keep = smoothstep(${NEAR_DISSOLVE_GONE.toFixed(3)}, ${NEAR_DISSOLVE_FULL.toFixed(3)}, vCamDist);
          // Biased hard toward opaque. A linear ramp spends half the band at
          // roughly half coverage, and half coverage of a screen-stable
          // stipple is not "thinning foliage" — it is a fixed screen-door
          // hatch laid over a quarter of the frame, which the first pass
          // photographed doing exactly that in the top corners. The square
          // root collapses that: the band still reaches out to 3.1 units so a
          // leaf drifting toward the lens starts breaking up early, but it is
          // only near the inner edge, where the geometry genuinely is in the
          // lens, that enough fragments drop to read as a hole.
          keep = sqrt(keep);
          if (keep < 0.999) {
            // Interleaved gradient noise: stable in screen space, so the
            // stipple sits still while the camera moves instead of boiling.
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (keep < ign) discard;
          }
        }
        `,
      )
  }
  material.customProgramCacheKey = () => cacheKey
}

/**
 * Lambert with a wind bend injected, so the front rank still takes scene
 * lighting and fog. The bend is quadratic in height: roots planted, tips
 * whipping — and phased off world position so the gust reads as one wave
 * crossing the treeline rather than every frond twitching on its own.
 */
function createSwayMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windTime
    shader.vertexShader = shader.vertexShader
      // One replace for the declaration: `void main() {` occurs once, and a
      // second replace aimed at the same anchor silently does nothing.
      .replace('void main() {', 'uniform float uWind;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float wx = instanceMatrix[3][0];
          float wz = instanceMatrix[3][2];
          float travel = (wx * 0.11 + wz * 0.085) - uWind * 0.8;
          float gust = sin(travel) * 0.5 + 0.5;
          float flutter = sin(uWind * 2.15 + wx * 0.8 + wz * 0.62);
          float sway = gust * 0.6 + flutter * 0.24;
          float t = clamp(transformed.y / ${FROND_MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);
          float bend = t * t * ${FROND_MAX_HEIGHT.toFixed(3)};
          transformed.x += sway * bend * 0.15;
          transformed.z += sway * bend * 0.11;
          transformed.y -= abs(sway) * bend * 0.05;
        #endif
        `,
      )
  }
  applyNearDissolve(material, 'jungle-sway-dissolve')
  return material
}

/**
 * Apply a rank's value step and normal bend to its baked geometry, in place.
 *
 * Both edits belong here rather than in the parts kit: the kit authors *one*
 * jungle, and it is this file that decides which copy of it is fifteen metres
 * back in the shade and which one is catching the sun on the front edge. Doing
 * it after `bakeGroup` means it costs one pass over a few thousand vertices at
 * load and nothing at all per frame, which is the only way it can coexist with
 * instancing.
 *
 * Colours are already in linear space by the time they reach the buffer (three
 * converts on `setHex`), so the multiply is a plain exposure change and warm
 * tints stay warm. Values are allowed past 1: the clamp that matters happens
 * after lighting, and a front rank authored slightly hot is what survives being
 * multiplied by a low sun.
 */
function shadeGeometry(geo: THREE.BufferGeometry, tint?: [number, number, number], normalUp = 0) {
  const colors = geo.getAttribute('color') as THREE.BufferAttribute | undefined
  if (tint && colors) {
    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(
        i,
        colors.getX(i) * tint[0],
        colors.getY(i) * tint[1],
        colors.getZ(i) * tint[2],
      )
    }
    colors.needsUpdate = true
  }
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (normalUp > 0 && normals) {
    const k = Math.min(1, normalUp)
    for (let i = 0; i < normals.count; i++) {
      const x = normals.getX(i) * (1 - k)
      const y = normals.getY(i) * (1 - k) + k
      const z = normals.getZ(i) * (1 - k)
      const len = Math.hypot(x, y, z) || 1
      normals.setXYZ(i, x / len, y / len, z / len)
    }
    normals.needsUpdate = true
  }
  return geo
}

/** Static foliage: double-sided because leaves are single-triangle strips. */
function createLeafMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  })
  // The overhangs use this material, and they are the single worst offender
  // for burying the lens: six modules whose whole job is to lean in over the
  // clearing the player stands in.
  applyNearDissolve(material, 'jungle-leaf-dissolve')
  return material
}

/** Cumulative-length walk over the spine, so pieces can be spaced by distance
 *  rather than by vertex — the polyline's segments are wildly uneven. */
class Spine {
  private readonly pts: THREE.Vector2[]
  private readonly cum: number[] = [0]
  private readonly fixedOut: THREE.Vector2 | null
  readonly length: number

  /** `outward` overrides the radial normal — the wings run along the coast
   *  rather than around the ring, so "outward" there means *seaward*. */
  constructor(points: [number, number][], outward: THREE.Vector2 | null = null) {
    this.fixedOut = outward
    this.pts = points.map(([x, z]) => new THREE.Vector2(x, z))
    for (let i = 1; i < this.pts.length; i++) {
      this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]))
    }
    this.length = this.cum[this.cum.length - 1]
  }

  /** Position at arc-length `d`, plus the outward normal there. */
  at(d: number): { p: THREE.Vector2; out: THREE.Vector2 } {
    const clamped = Math.min(Math.max(d, 0), this.length)
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < clamped) i++
    const t = (clamped - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1])
    const p = this.pts[i - 1].clone().lerp(this.pts[i], t)
    if (this.fixedOut) return { p, out: this.fixedOut.clone() }
    // Outward from the ring's centre. The horseshoe is convex enough that this
    // beats a segment normal, which flips and stutters at the corners.
    const out = p.clone().sub(CENTRE)
    if (out.lengthSq() < 1e-6) out.set(1, 0)
    out.normalize()
    return { p, out }
  }
}

export class JungleWall {
  /** Middle of the doorway — the butterflies' destination, the goat's exit. */
  readonly gapCentre: THREE.Vector3

  private readonly group = new THREE.Group()
  private readonly obstacles: Obstacle[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly shafts: { mesh: THREE.Mesh; base: number; phase: number }[] = []
  private readonly floor: LoamPatch[] = []
  /** Fast membership test for `setVisible`, which must skip the floor. */
  private readonly floorObjects = new Set<THREE.Object3D>()
  private readonly scene: THREE.Group
  private visible = true
  private disposed = false

  constructor(scene: THREE.Group, obstacles: Obstacle[]) {
    this.scene = scene
    this.gapCentre = new THREE.Vector3(GAP_X, groundHeight(GAP_X, 0), 0)

    const spine = new Spine(SPINE)
    const wings = buildWingSpines()
    const r = rng(0x1a1e5)

    // Floor first: it is the only thing here drawn under everything else, and
    // building it before the ranks keeps its render order unambiguous.
    this.buildFloor(spine, wings)

    const swayMaterial = createSwayMaterial()
    const leafMaterial = createLeafMaterial()
    this.materials.push(swayMaterial, leafMaterial)

    for (const rank of RANKS) {
      const geos = Array.from({ length: rank.variants }, (_, v) =>
        shadeGeometry(bakeGroup(rank.build(v)), rank.tint, rank.normalUp),
      )
      this.geometries.push(...geos)
      const buckets: Placement[][] = geos.map(() => [])

      const walk = (sp: Spine, onWing: boolean) => {
        for (let d = rank.phase; d < sp.length; d += rank.spacing) {
          const { out } = sp.at(d)
          // Jitter runs along the wall as well as across it, so the ranks never
          // resolve into the rows the fixed spacing would otherwise produce.
          const along = (r() - 0.5) * rank.spacing * 0.8
          const { p: pj } = sp.at(d + along)
          const off = rank.offset + (r() - 0.5) * rank.jitter
          const x = pj.x + out.x * off
          const z = pj.y + out.y * off
          if (rank.keepOut !== undefined && Math.hypot(x - CENTRE.x, z - CENTRE.y) < rank.keepOut) {
            continue
          }
          // The wings are drawn along a coastline that the spine only
          // approximates; anything that lands on open beach is a tree growing
          // out of the sand and gets dropped rather than nudged. The verge —
          // technically still sand, visually already the bank — is fair game,
          // and is in fact exactly where a treeline stands.
          if (onWing && isSand(x, z) && groundHeight(x, z) < VERGE_HIGH) continue
          buckets[Math.floor(r() * geos.length)].push({
            x,
            y: groundHeight(x, z) - rank.sink,
            z,
            rotationY: r() * Math.PI * 2,
            scale: rank.scaleMin + r() * (rank.scaleMax - rank.scaleMin),
          })
        }
      }

      walk(spine, false)
      if (rank.wing !== false) for (const wing of wings) walk(wing, true)

      geos.forEach((geo, i) => {
        if (buckets[i].length === 0) return
        this.group.add(
          makeInstancedChunks(geo, buckets[i], {
            material: rank.sway ? swayMaterial : leafMaterial,
            // The wall spans about forty units; one or two chunks is the right
            // granularity — finer only buys draw calls.
            chunkSize: 200,
            castShadow: rank.castShadow,
            receiveShadow: true,
            layer: rank.minor ? MINOR_LAYER : undefined,
          }),
        )
      })
    }

    this.buildOverhangs(spine, r, leafMaterial)
    this.buildBasalt(r, leafMaterial)
    this.buildShafts()
    this.buildColliders(spine, obstacles)

    scene.add(this.group)
  }

  /**
   * The jungle floor — see the FLOOR_* block above for what it is for.
   *
   * Every field is a conforming, feathered patch from the loam builder, so they
   * drape over the pad's slope and dissolve into one another instead of tiling.
   * Every field is masked by `offSand` below, which is what keeps jungle floor
   * off the open beach while still covering the lit verge above it — the mask
   * follows the real coast, so the transition is the shoreline itself rather
   * than a straight edge somebody chose.
   */
  private buildFloor(spine: Spine, wings: Spine[]) {
    /**
     * 1 on jungle floor, 0 on open beach, ramped across the verge.
     *
     * `isSand` alone is not the test, and finding that out cost a pass: the
     * terrain's sand band runs a good way up the slope and its *top* is already
     * shaded toward grass in the vertex colours, so the bright lawn verge the
     * review objected to is, as far as `isSand` is concerned, beach. Masking on
     * `isSand` therefore protected the exact strip that most needed covering.
     *
     * Height decides it instead. Below the sand line's shoulder the ground is
     * ivory and stays ivory; across the last two thirds of a unit up to it, the
     * jungle floor fades in — which is also where the real transition is,
     * because that is where the terrain stops being flat beach and starts being
     * the bank the trees stand on.
     */
    const offSand = (x: number, z: number) => {
      if (!isSand(x, z)) return 1
      const h = groundHeight(x, z)
      const t = Math.min(1, Math.max(0, (h - VERGE_LOW) / (VERGE_HIGH - VERGE_LOW)))
      return t * t * (3 - 2 * t)
    }

    const add = (patch: LoamPatch) => {
      this.floor.push(patch)
      this.floorObjects.add(patch.object)
      this.group.add(patch.object)
    }

    /*
     * Interior: shaded jungle floor, dappled, with real litter lying on it.
     *
     * `maxCells` is the line that matters. At 46 the field's vertices stood
     * more than half a metre apart, which is coarser than every octave the
     * patch builder had — so the whole twenty-five-unit floor sampled the same
     * mid-tone at every vertex and photographed as a sheet of green felt laid
     * over the terrain. 90 lifts the clamp entirely (the builder's own 0.38 m
     * cell target takes over) and lets the two low octaves added for this pass
     * resolve into damp hollows and dry rises the eye can actually see.
     */
    add(
      createLoamPatch({
        centre: new THREE.Vector3(FLOOR_INTERIOR.x, 0, FLOOR_INTERIOR.z),
        w: FLOOR_INTERIOR.w,
        d: FLOOR_INTERIOR.d,
        seed: FLOOR_INTERIOR.seed,
        ramp: RAMP_JUNGLE_FLOOR,
        grit: 0.26,
        feather: 0.3,
        // Under the pocket's own discs and under the beds, so turned earth and
        // dug rings still read as darker, wetter marks made *on* this floor.
        lift: 0.012,
        maxCells: 90,
        dapple: FLOOR_DAPPLE,
        // Neither belongs on ground nobody has touched: ash is what a dug bed
        // turns up, and tilling is a shovel's signature.
        ash: 0,
        tilled: 0,
        // The crumb chips are soil-coloured and half a hand across; the litter
        // scatter is what a forest floor actually has on it.
        crumbs: 0.35,
        litter: 1.7,
        stones: 0.6,
        roots: 0.22,
        mask: offSand,
      }),
    )

    // Damp hollows — small, brown-green, and the only unturned brown in here.
    DAMP_HOLLOWS.forEach((h, n) => {
      add(
        createLoamPatch({
          centre: new THREE.Vector3(CENTRE.x + h.dx, 0, CENTRE.y + h.dz),
          w: h.w,
          d: h.d,
          seed: 0x9d0 + n * 53,
          ramp: RAMP_DAMP_EARTH,
          grit: 0.35,
          feather: 0.62,
          lift: 0.014,
          maxCells: 26,
          dapple: FLOOR_DAPPLE * 0.8,
          ash: 0,
          tilled: 0,
          crumbs: 0.5,
          litter: 0.8,
          stones: 0.6,
          mask: offSand,
        }),
      )
    })

    /*
     * The wall's foot — roots, stones and drifted litter where the jungle meets
     * the clearing.
     *
     * Debris does not lie evenly across a forest floor; it collects at the base
     * of what shed it. A ring of small heavily-scattered fields just inside the
     * spine puts the roots and the stones where the trunks are, which is both
     * where they belong and where they do the most work — it is the line the
     * eye follows all the way round the horseshoe in beats 5, 6 and 9.
     */
    let f = 0
    for (let d = 2.2; d < spine.length; d += FOOT_SPACING, f++) {
      const { p, out } = spine.at(d)
      const x = p.x + out.x * FOOT_OFFSET
      const z = p.y + out.y * FOOT_OFFSET
      add(
        createLoamPatch({
          centre: new THREE.Vector3(x, 0, z),
          w: FOOT_SIZE,
          d: FOOT_SIZE,
          seed: 0xf00 + f * 29,
          ramp: RAMP_JUNGLE_FLOOR,
          grit: 0.4,
          feather: 0.6,
          lift: 0.016,
          maxCells: 20,
          dapple: FLOOR_DAPPLE * 0.9,
          ash: 0,
          tilled: 0,
          crumbs: 0.4,
          litter: 2.2,
          stones: 2.0,
          roots: 1.5,
          mask: offSand,
        }),
      )
    }

    // Skirt: deep shade green round the outside of the wall.
    let i = 0
    for (let d = 1.5; d < spine.length; d += SKIRT_SPACING, i++) {
      const { p, out } = spine.at(d)
      const x = p.x + out.x * SKIRT_OFFSET
      const z = p.y + out.y * SKIRT_OFFSET
      add(
        createLoamPatch({
          centre: new THREE.Vector3(x, 0, z),
          w: SKIRT_SIZE,
          d: SKIRT_SIZE,
          seed: 0x5c0 + i * 37,
          ramp: RAMP_SHADE_GREEN,
          grit: 0.18,
          feather: 0.55,
          lift: 0.01,
          maxCells: 32,
          dapple: FLOOR_DAPPLE * 0.75,
          ash: 0,
          tilled: 0,
          crumbs: 0,
          litter: 0.5,
          mask: offSand,
        }),
      )
    }

    /*
     * The verge, followed rather than guessed.
     *
     * This is the hem the wake camera looks across, and it is the strip that
     * gave the review its "mown emerald lawn": the top of the terrain's sand
     * band, already tinted toward grass, lit square-on, running the whole width
     * of frame between the ivory and the trees. Hand-placed rectangles missed
     * it, because the coast is an arc. Marching to the sand line at each step
     * and dropping a patch there puts the cover exactly where the seam is, from
     * the far south wing round the gap to the far north wing.
     */
    let k = 0
    const front = buildShoreSpine(-WING_Z_START, WING_Z_START, 3, WING_INSET)
    for (const arm of [front, ...wings]) {
      if (!arm) continue
      for (let d = 1; d < arm.length; d += SKIRT_SPACING * 0.7, k++) {
        const { p, out } = arm.at(d)
        const x = p.x + out.x * 1.2
        const z = p.y + out.y * 1.2
        add(
          createLoamPatch({
            centre: new THREE.Vector3(x, 0, z),
            w: SKIRT_SIZE,
            d: SKIRT_SIZE,
            seed: 0x7a0 + k * 41,
            ramp: RAMP_SHADE_GREEN,
            grit: 0.15,
            feather: 0.55,
            lift: 0.009,
            maxCells: 30,
            dapple: FLOOR_DAPPLE * 0.6,
            ash: 0,
            tilled: 0,
            crumbs: 0,
            litter: 0.35,
            mask: offSand,
          }),
        )
      }
    }
  }

  /**
   * Module C, the overhangs.
   *
   * Two of them lean in over the gap so the doorway has a lintel, and four more
   * are spread round the wall so the arch does not read as a one-off prop. Each
   * is rotated to point its reach at the ring's centre — the module is authored
   * leaning toward +X, so the rotation is simply the bearing of the inward
   * normal.
   */
  private buildOverhangs(spine: Spine, r: () => number, material: THREE.Material) {
    const geos = [0, 1, 2].map((v) => bakeGroup(createCanopyOverhang(v)))
    this.geometries.push(...geos)
    const buckets: Placement[][] = geos.map(() => [])

    // The two gap lips first: arc-length 0 is the south lip, `length` the north.
    const spots = [0.9, spine.length - 0.9, spine.length * 0.28, spine.length * 0.46, spine.length * 0.63, spine.length * 0.82]
    spots.forEach((d, i) => {
      const { p, out } = spine.at(d)
      const inward = Math.atan2(-out.y, -out.x)
      const off = i < 2 ? 0.4 : 0.9
      const x = p.x + out.x * off
      const z = p.y + out.y * off
      buckets[i % geos.length].push({
        x,
        y: groundHeight(x, z) - 0.2,
        z,
        // Model reaches toward +X; -bearing turns +X onto the inward normal.
        rotationY: -inward + (r() - 0.5) * 0.35,
        scale: i < 2 ? 1.05 + r() * 0.2 : 0.85 + r() * 0.3,
      })
    })

    geos.forEach((geo, i) => {
      if (buckets[i].length === 0) return
      this.group.add(
        makeInstancedChunks(geo, buckets[i], {
          material,
          chunkSize: 200,
          castShadow: false,
          receiveShadow: true,
        }),
      )
    })
  }

  private buildBasalt(r: () => number, material: THREE.Material) {
    const geos = [0, 1, 2].map((v) => bakeGroup(createBasaltOutcrop(v)))
    this.geometries.push(...geos)
    const buckets: Placement[][] = geos.map(() => [])
    for (const spot of BASALT) {
      buckets[spot.variant].push({
        x: spot.x,
        y: groundHeight(spot.x, spot.z) - 0.12,
        z: spot.z,
        rotationY: r() * Math.PI * 2,
        scale: spot.scale,
      })
    }
    geos.forEach((geo, i) => {
      if (buckets[i].length === 0) return
      this.group.add(
        makeInstancedChunks(geo, buckets[i], {
          material,
          chunkSize: 200,
          // Basalt is the one thing here that casts: a hard black shadow off a
          // hard black rock is what sells it as stone next to all that foliage.
          castShadow: true,
          receiveShadow: true,
        }),
      )
    })
  }

  private buildShafts() {
    for (let i = 0; i < SHAFTS.length; i++) {
      const s = SHAFTS[i]
      // The exclusion zone, enforced rather than commented. A beam standing in
      // the walking slot is the exact defect this rebuild exists to remove, and
      // the table above is the kind of thing that gets nudged by hand later.
      if (
        s.x > WALK_CORRIDOR.x0 &&
        s.x < WALK_CORRIDOR.x1 &&
        s.z > WALK_CORRIDOR.z0 &&
        s.z < WALK_CORRIDOR.z1
      ) {
        continue
      }
      const mesh = createLightShaft(s.top, s.bot, s.height)
      // Hung from the canopy hole, leaning west with the low eastern sun. The
      // mouth is the origin, so this is where the beam *starts*, not its middle.
      mesh.position.set(s.x, groundHeight(s.x, s.z) + SHAFT_HANG, s.z)
      mesh.rotation.z = s.tilt
      mesh.rotation.x = (i % 2 === 0 ? 1 : -1) * 0.12
      mesh.layers.set(MINOR_LAYER)
      this.group.add(mesh)
      const material = mesh.material as THREE.MeshBasicMaterial
      this.materials.push(material)
      this.geometries.push(mesh.geometry)
      this.shafts.push({ mesh, base: material.opacity, phase: i * 1.7 })
    }
  }

  private buildColliders(spine: Spine, obstacles: Obstacle[]) {
    const place = (d: number) => {
      const { p, out } = spine.at(d)
      const obstacle: Obstacle = {
        x: p.x + out.x * COLLIDER_OFFSET,
        z: p.y + out.y * COLLIDER_OFFSET,
        r: COLLIDER_RADIUS,
      }
      obstacles.push(obstacle)
      this.obstacles.push(obstacle)
    }
    for (let d = 0; d < spine.length; d += COLLIDER_SPACING) place(d)
    // The far lip, explicitly: the stepped loop stops up to a full spacing short
    // of the end, and the end is one of the two jambs of the only doorway in the
    // wall — a short chain there widens the mouth on one side and puts it off
    // centre from the gap the player is being led to.
    place(spine.length)
  }

  /**
   * Hide or show the wall. Colliders follow the mesh — an invisible wall the
   * player still bounces off is the worse half of both states.
   *
   * The **floor stays**. Hiding it too would snap the clearing the player just
   * spent eight minutes making back to bright valley lawn at the exact moment
   * the HUD is being reborn — the one frame of the session where the player is
   * looking at the ground they earned. Cleared ground stays cleared; the trees
   * are what leave. `dispose()` still takes everything, for the case where the
   * opening is being torn out rather than handed over.
   */
  setVisible(v: boolean) {
    if (this.disposed) return
    this.visible = v
    this.group.visible = true
    for (const child of this.group.children) {
      if (!this.floorObjects.has(child)) child.visible = v
    }
    for (const o of this.obstacles) o.off = !v
  }

  update(dt: number, elapsed: number) {
    if (this.disposed || !this.visible) return
    windTime.value += dt
    for (const s of this.shafts) {
      const material = s.mesh.material as THREE.MeshBasicMaterial
      // Barely there, and breathing slower than anything else on screen — a
      // shaft that pulses at a rate the eye can count reads as a light effect
      // rather than as air.
      material.opacity = s.base * (0.72 + 0.28 * Math.sin(elapsed * 0.35 + s.phase))
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const o of this.obstacles) o.off = true
    this.obstacles.length = 0
    this.scene.remove(this.group)
    for (const patch of this.floor) patch.dispose()
    this.floor.length = 0
    for (const geo of this.geometries) geo.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.length = 0
    this.materials.length = 0
    this.shafts.length = 0
  }
}
