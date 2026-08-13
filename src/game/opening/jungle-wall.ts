import * as THREE from 'three'
import { MINOR_LAYER, rng } from '../../assets/style'
import { groundHeight, isSand } from '../terrain'
import type { Obstacle } from '../world'
import {
  createLoamPatch,
  RAMP_SHADE_GREEN,
  type LoamPatch,
  type LoamRamp,
} from '../../assets/opening/loam'
import { fitToHeight, getModels, type LoadedModel } from '../../assets/models'

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
 *     camera. That is a density problem, not a height problem: ranks of canopy
 *     alone leave a knee-height band of lit sand showing between the trunks,
 *     and it takes a dedicated understory *plug* rank to close it. The ranks
 *     behind exist to fill each other's holes — the rear ranks are set back and
 *     tall so their crowns show through the gaps in front of them. A chain of
 *     overlapping colliders backs the visual read up, because a wall you can
 *     stroll through is not a wall.
 *  2. **Looming.** The wall runs 8–15 units with emergents past 20, against a
 *     valley whose own trees are 5.6 and a camera that sits around six.
 *     Portrait framing puts the avatar low and the world above, and this is the
 *     world above.
 *  3. **One doorway.** The gap is the only way through — a three-unit walkable
 *     slot at z ≈ 0 — arched by two leaning trees and dressed with the
 *     opening's single splash of magenta (that dressing ships from
 *     chaos-pocket.ts). Wayfinding by architecture instead of by an arrow.
 *
 * **Everything green here is an authored glTF.** The wall used to be built from
 * a procedural parts kit — lobed canopy masses, leaf cards, frond fans — and at
 * wall density those flat faceted slabs read as paper cut-outs stacked into a
 * curtain rather than as jungle. The kit is gone. The ranks below are the same
 * models the valley's forest is planted with (`assets/models.ts`): the
 * broadleaf, the conifer, the palm, the coconut palm and the bush, plus the
 * rock pair, the stump and the log at the foot. Nothing in this file generates
 * foliage geometry any more; it decides *where the authored models stand*, and
 * that is the whole design surface.
 *
 * Density is bought the same way the valley's forest buys it: geometry and
 * material come straight off the shared `LoadedModel`, every rank is drawn with
 * instanced meshes split into spatial chunks, and the value ladder that used to
 * be baked into vertex colours is now a per-instance tint. ~280 authored trees
 * and bushes cost roughly fifty draw calls. Only the front bush rank moves, and
 * it moves in a vertex shader (grass's trick), which is the only way sway and
 * instancing can coexist.
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
 * and the player has no business up there in the first eight minutes. They are
 * also planted at a fraction of the horseshoe's density (`wingSpacing`): an
 * authored tree costs about 2,300 triangles wherever it stands, and thirty
 * units away nobody is counting the trunks.
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
 * Rock at the jungle foot, hand-placed in world coordinates.
 *
 * These were procedural basalt outcrops with a salt crust — the only non-green
 * module in the old parts kit, and the one place the kit was doing something
 * the authored set could not. It turns out the authored set can: `rock` and
 * `rockCluster` are the valley's own boulders, they are the darkest, least
 * saturated things in the model library, and tinted down they anchor the value
 * range exactly the way the basalt was there to. So the kit went and these
 * stayed, at the same coordinates.
 *
 * Scattered by rule they end up evenly spaced, which is the one thing rocks
 * never are. These sit where the wall turns — the inside of a bend is where
 * loose rock actually collects — plus one at the threshold of the gap, well
 * clear of the walking corridor, to give the doorway a step.
 */
const ROCKS: { x: number; z: number; cluster: boolean; height: number }[] = [
  { x: -40.0, z: -5.2, cluster: false, height: 1.15 },
  { x: -37.4, z: -8.8, cluster: true, height: 0.8 },
  { x: -30.6, z: -9.6, cluster: false, height: 1.35 },
  { x: -24.2, z: -7.6, cluster: true, height: 0.7 },
  { x: -22.6, z: -0.8, cluster: false, height: 1.0 },
  { x: -23.0, z: 5.8, cluster: true, height: 0.85 },
  { x: -29.0, z: 9.2, cluster: false, height: 1.25 },
  { x: -37.8, z: 8.6, cluster: true, height: 0.75 },
  { x: -40.2, z: 4.8, cluster: false, height: 1.05 },
  { x: -41.4, z: -2.4, cluster: true, height: 0.6 },
]

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
 *
 * This is ground, not treeline, and it is built from the shared loam builder
 * rather than from the retired jungle parts kit — it stays.
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

/** The authored models this wall is planted with. Nothing else is registered. */
type SpeciesId =
  | 'tree'
  | 'pine'
  | 'palm'
  | 'coconutPalm'
  | 'bush'
  | 'stump'
  | 'log'
  | 'rock'
  | 'rockCluster'

/**
 * The ranks, back to front. `offset` is measured outward from the spine, so a
 * negative number is a step into the clearing.
 *
 * The spacings are the whole design, and they are wider than they look because
 * the authored crowns are wide: the broadleaf is as broad as it is tall and the
 * bush is half again broader than it is tall, so a fifteen-unit conifer covers
 * twelve units of frontage on its own. Three ranks at 3–4 units of spacing
 * therefore overlap three deep, which is what closes the sky. The rear ranks
 * look sparse on their own and are not meant to be seen on their own — they are
 * the backing that shows through the holes in front of them.
 *
 * Heights are in world units, against a 1.6-unit farmer. `fitToHeight` turns
 * each into a scale and a ground lift off the model's own bounding box, so
 * swapping a model can never silently leave a rank floating or buried.
 */
interface RankSpec {
  species: SpeciesId
  /** World units between pieces along the spine. */
  spacing: number
  /** Multiplier on `spacing` out along the coastal wings. */
  wingSpacing?: number
  /** Outward from the spine; negative steps into the clearing. */
  offset: number
  /** Random lateral wander, in units. */
  jitter: number
  /** World height of the piece, in units. */
  heightMin: number
  heightMax: number
  /** How far the piece is pushed into the ground, to kill float on slopes. */
  sink: number
  /** Maximum lean off vertical, in radians. Jungle trees are not orchard trees. */
  lean?: number
  /** Front rank only: draw with the trade-wind vertex shader. */
  sway?: boolean
  /** Small stuff skips the water's reflection and refraction passes. */
  minor?: boolean
  /** Phase along the spine, so ranks do not line up into rows. */
  phase: number
  /**
   * Per-rank multiplier on the model's own texture, as linear RGB.
   *
   * **This is the depth**, and on authored models it is also the palette. The
   * valley's broadleaf and conifer are tuned for a bright inland meadow at
   * midday; planted twenty deep on a beach at dawn they come back as one field
   * of lawn green with no front and no back. Aerial perspective is a *value*
   * ladder, and per-instance colour is the cheapest place to put one on
   * instanced geometry: darken and cool the ranks that are meant to be behind,
   * lift and warm the one the dawn actually reaches.
   *
   * Warmth carries as much of it as brightness. The front rank's tint is
   * lopsided toward red and away from blue, which is what turns a lit green
   * into the spec's sunlit `#8FCF6B` rather than into a paler version of the
   * same shade — and the far ranks lean the other way, because distance is
   * blue. Postfx multiplies saturation by 1.2 afterwards, so the tints are
   * deliberately gentler than they look like they need to be.
   *
   * This multiplies the *shared* model's texture through `instanceColor`, so
   * nothing here changes how the same tree looks in the valley. Retinting the
   * GLB itself (scripts/retint-glb.mjs) would.
   */
  tint: [number, number, number]
  /** Per-instance value spread around `tint`, so no two pieces match. */
  vary?: number
  /** Drop any piece that lands closer than this to the ring centre — keeps the
   *  inward-spilling ranks out of the farm pad the beds are dug into. */
  keepOut?: number
  /** Set false to keep a rank off the coastal wings (see WING_* below). */
  wing?: boolean
}

const RANKS: RankSpec[] = [
  /*
   * Emergents — the giants breaking the skyline, set well back.
   *
   * A wall of evenly tall trees produces a level top edge, and a level top edge
   * is a hedge however deep the planting behind it. These run 15–22 units,
   * which puts their crowns off the top of a low over-the-shoulder frame
   * entirely: you cannot see where the jungle stops, which is the only way
   * "impassable" ever reads. The conifer is the right species for it — it is
   * the tallest thing in the model library and its silhouette is a spire, so a
   * scatter of them behind the broadleaf mass reads as canopy poking through
   * canopy rather than as a second row of the same tree.
   *
   * Darkest and coolest on the wall: this is the value the whole ladder is
   * measured down from, near the spec's deep `#1E4A2A`.
   */
  {
    species: 'pine',
    spacing: 4.2,
    wingSpacing: 1.7,
    offset: 5.0,
    jitter: 1.6,
    heightMin: 16,
    heightMax: 24,
    sink: 0.5,
    lean: 0.05,
    phase: 2.2,
    tint: [0.29, 0.40, 0.36],
    vary: 0.14,
  },
  // Rear rank — the backing. Tall, dark, set back, and dense enough that its
  // crowns show through every hole the ranks in front leave.
  {
    species: 'pine',
    spacing: 3.6,
    wingSpacing: 2.4,
    offset: 3.1,
    jitter: 1.2,
    heightMin: 10,
    heightMax: 15,
    sink: 0.4,
    lean: 0.06,
    phase: 0.4,
    tint: [0.37, 0.49, 0.43],
    vary: 0.14,
  },
  /*
   * Canopy rank — the broadleaf, and the mass the wall is actually made of.
   *
   * The conifer is a spire and spires stack into a picket fence; the broadleaf
   * is a wide round crown, so this is the rank that joins up. Half a step
   * forward of the rear pines and a third shorter, which is what puts a second
   * layer of crowns *in front of* the first instead of beside it.
   */
  {
    species: 'tree',
    spacing: 3.0,
    wingSpacing: 2.2,
    offset: 2.4,
    jitter: 1.1,
    heightMin: 8.5,
    heightMax: 12,
    sink: 0.35,
    lean: 0.09,
    phase: 1.5,
    tint: [0.44, 0.57, 0.45],
    vary: 0.16,
  },
  /*
   * Mid rank — broadleaf again, on the spine, much smaller.
   *
   * This is the rank the player actually stands in front of, and it sets the
   * scale of the wall: undersized here, the two behind it read as further away
   * and therefore bigger, which is the whole trick.
   */
  {
    species: 'tree',
    spacing: 2.6,
    wingSpacing: 2.4,
    offset: -0.2,
    jitter: 0.9,
    heightMin: 5.2,
    heightMax: 8.2,
    sink: 0.3,
    lean: 0.11,
    phase: 0.9,
    tint: [0.62, 0.74, 0.54],
    vary: 0.16,
  },
  /*
   * Palms threaded through the mass — the species that says *tropical*.
   *
   * Sparse on purpose. The broadleaf/conifer pair is the valley's forest, and
   * a treeline built from nothing else reads as the valley moved to the coast
   * however dark it is tinted. A palm crown every seven metres, leaning harder
   * than anything else here, is what turns it into an island.
   */
  {
    species: 'palm',
    spacing: 6.4,
    wingSpacing: 2.0,
    offset: 1.0,
    jitter: 1.5,
    heightMin: 8,
    heightMax: 13.5,
    sink: 0.3,
    lean: 0.22,
    phase: 3.1,
    tint: [0.50, 0.63, 0.47],
    vary: 0.14,
  },
  /*
   * Coconut palms at the front edge, horseshoe only — the wall's scale rule.
   *
   * The wall has nothing in it whose size a player can guess at until one of
   * these stands at the front: a coconut is a known object, and a crown of them
   * six units up tells you how big everything behind them is. Warm-tinted,
   * because these are the pieces the low sun actually reaches.
   */
  {
    species: 'coconutPalm',
    spacing: 8.5,
    offset: -1.4,
    jitter: 1.2,
    heightMin: 5,
    heightMax: 7.5,
    sink: 0.15,
    lean: 0.26,
    phase: 5.0,
    wing: false,
    tint: [0.84, 0.88, 0.60],
    vary: 0.12,
  },
  /*
   * The plug, upper. Trees have trunks, and trunks have daylight between them:
   * every rank above still leaves a knee-to-chest band of lit sand showing
   * straight through the wall, which is precisely the "you can see the sea
   * through the treeline" failure the whole thing exists to fix.
   *
   * The authored bush is half again wider than it is tall, so at three units
   * high it is nearly five across — tight spacing plus a jitter wider than the
   * band it sits in staggers the pieces across two depths instead of lining
   * them up into one row of holes the player can look down as they walk past.
   *
   * Deepest value on the wall: what shows through the front gaps has to read as
   * depth, not as a hole.
   */
  {
    species: 'bush',
    spacing: 1.3,
    wingSpacing: 2.0,
    offset: 0.9,
    jitter: 2.0,
    heightMin: 2.4,
    heightMax: 4.2,
    sink: 0.25,
    phase: 0.3,
    minor: true,
    tint: [0.32, 0.43, 0.35],
    vary: 0.18,
  },
  // The plug, lower — the same trick a step forward and a size down, closing
  // whatever the upper plug's own gaps let through.
  {
    species: 'bush',
    spacing: 1.1,
    wingSpacing: 2.2,
    offset: -0.6,
    jitter: 1.5,
    heightMin: 1.5,
    heightMax: 2.8,
    sink: 0.2,
    phase: 1.7,
    minor: true,
    tint: [0.48, 0.60, 0.44],
    vary: 0.18,
  },
  /*
   * Front fringe — sunlit, and the only thing here that moves.
   *
   * Spilling a little further into the clearing so the line where jungle meets
   * ground is a tangle instead of a mown edge. The dawn rim light lives here
   * and nowhere else: everything behind is a step on the way down from this.
   */
  {
    species: 'bush',
    spacing: 1.4,
    wingSpacing: 2.6,
    offset: -1.9,
    jitter: 1.2,
    heightMin: 0.9,
    heightMax: 1.9,
    sink: 0.1,
    phase: 0.6,
    sway: true,
    minor: true,
    tint: [0.90, 0.92, 0.62],
    vary: 0.16,
  },
  /*
   * A thinning of small bushes three metres into the clearing.
   *
   * The floor field turns the interior to shaded duff, and bare duff over that
   * area is a car park. What a jungle interior actually has is scale on the
   * ground — clumps you walk around — and a scatter thinning inward gives the
   * eye that without putting anything in the player's way. Wide jitter and
   * small scales: this is a thinning, not a second hedge, and it stops well
   * short of the farm pad.
   */
  {
    species: 'bush',
    spacing: 2.4,
    offset: -3.4,
    jitter: 2.6,
    heightMin: 0.6,
    heightMax: 1.3,
    sink: 0.06,
    phase: 1.9,
    sway: true,
    minor: true,
    keepOut: 8.0,
    // Nothing to spill into up the coast — the wings face open beach.
    wing: false,
    tint: [0.76, 0.82, 0.56],
    vary: 0.16,
  },
  /*
   * Deadfall at the wall's foot: stumps and logs, horseshoe only.
   *
   * A treeline with no debris under it is a hedge that was planted. A cut stump
   * and a fallen trunk are the two shapes that say the jungle has been standing
   * here long enough for something to have come down, and they are the only
   * horizontals in a wall of verticals.
   */
  {
    species: 'stump',
    spacing: 9.5,
    offset: -1.5,
    jitter: 1.4,
    heightMin: 0.55,
    heightMax: 1.0,
    sink: 0.08,
    phase: 4.2,
    minor: true,
    wing: false,
    tint: [0.60, 0.58, 0.50],
    vary: 0.1,
  },
  {
    species: 'log',
    spacing: 11,
    offset: -2.4,
    jitter: 1.8,
    heightMin: 0.6,
    heightMax: 1.1,
    sink: 0.1,
    phase: 7.4,
    minor: true,
    wing: false,
    keepOut: 9.0,
    tint: [0.62, 0.60, 0.52],
    vary: 0.1,
  },
]

/**
 * The doorway's arch: two big broadleaves standing on the gap lips and leaning
 * across the mouth toward one another.
 *
 * The retired parts kit had a purpose-built overhang module for this — a trunk
 * authored leaning toward +X with its crown carried out over open ground. There
 * is no authored equivalent, so the lean is done at placement instead: a
 * quarter-radian tilt on an ordinary tree puts its crown out over the corridor
 * and turns a hole in a hedge into a *doorway*, which is the whole point. The
 * trunks stand on the lips, three-odd units either side of centre and well
 * clear of `COLLIDER_OFFSET`'s walking slot; only the canopy crosses.
 *
 * Four more are scattered round the ring at arc-length fractions so the arch
 * does not read as a one-off prop bolted to the gap.
 */
const ARCH_LEAN = 0.34
const ARCH_SPOTS: { at: number; height: number; lean: number }[] = [
  { at: 0, height: 12.5, lean: ARCH_LEAN },
  { at: 1, height: 13.5, lean: ARCH_LEAN },
  { at: 0.28, height: 10.5, lean: 0.24 },
  { at: 0.46, height: 11.5, lean: 0.2 },
  { at: 0.63, height: 10, lean: 0.26 },
  { at: 0.82, height: 12, lean: 0.22 },
]

/**
 * Colliders along the spine.
 *
 * Circles at 1.4-unit spacing with a 1.5 radius overlap to at least 1.3 units
 * of depth everywhere, which no amount of sliding gets a player through — and
 * they sit half a unit inside the spine so the player is stopped by the growth
 * they can see rather than by fresh air a metre short of it.
 */
const COLLIDER_SPACING = 1.4
const COLLIDER_RADIUS = 1.5
const COLLIDER_OFFSET = -0.6

/** Shared clock for the trade-wind sway, mirroring vegetation's grass uniform. */
const windTime = { value: 0 }

/** Tallest vertex the sway shader has to account for in the front rank. */
const SWAY_MAX_HEIGHT = 2.2

/**
 * Near-camera dissolve: where the wall gets between the lens and the player.
 *
 * The engine already collides the camera boom against obstacle circles
 * (`Engine.clearDistance`), and the spine plants one every 1.4 units — but a
 * circle on the spine only describes the *trunks*. This wall's whole design is
 * ranks that step INWARD of the spine (negative rank offsets) and six leaning
 * trees that reach out over the clearing on purpose, and none of that geometry
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
 * out to `NEAR_DISSOLVE_FULL` it thins out. Per-fragment matters because hiding
 * the *object* would pop a whole tree in and out as the camera drifts, while
 * dissolving the part of it that is actually in the lens leaves the rest of the
 * same tree standing.
 *
 * The threshold is stippled against interleaved-gradient noise rather than
 * alpha-blended: these are opaque instanced meshes sorted by nothing in
 * particular, and turning them transparent would cost a sort per frame and give
 * back a pile of ordering artefacts in a scene that is nothing but overlapping
 * foliage. Stipple keeps the material opaque, costs one fract per fragment, and
 * at this radius the holes are far too fine to read as a pattern.
 *
 * Deliberately NOT applied to the shadow pass (three uses its own depth
 * material, which this never touches): a leaf dissolving out of the lens should
 * not also take its shadow off the ground three metres away, where the player
 * can plainly see the light has not changed.
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
          // hatch laid over a quarter of the frame.
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
 * A wall material for one authored model.
 *
 * The model's own material is *cloned* rather than edited, because it is shared
 * with the valley's forest — the wall is allowed to look like a jungle, and the
 * meadow behind the village is not allowed to change with it. The clone keeps
 * the baseColour texture (the upload stays shared, so this is free on the GPU)
 * and gains three things:
 *
 *  - `vertexColors`, which is the only path three offers for `instanceColor` to
 *    reach the fragment shader. Without it every per-instance tint below is
 *    silently discarded and the whole wall comes back as valley green.
 *  - the near-camera dissolve.
 *  - optionally the trade-wind bend, for the one rank that moves.
 */
function createWallMaterial(model: LoadedModel, sway: boolean): THREE.Material {
  const material = model.material.clone()
  material.vertexColors = true
  if (sway) {
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
            // Quadratic in height: roots planted, tips whipping — and phased
            // off world position so the gust reads as one wave crossing the
            // treeline rather than every bush twitching on its own.
            float t = clamp(transformed.y / ${SWAY_MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);
            float bend = t * t * ${SWAY_MAX_HEIGHT.toFixed(3)};
            transformed.x += sway * bend * 0.10;
            transformed.z += sway * bend * 0.075;
            transformed.y -= abs(sway) * bend * 0.035;
          #endif
          `,
        )
    }
  }
  applyNearDissolve(material, sway ? 'jungle-glb-sway' : 'jungle-glb-static')
  return material
}

/**
 * Give a shared model geometry the white `color` attribute three needs before
 * `vertexColors` means anything.
 *
 * A missing attribute reads as black in WebGL, so a vertex-coloured material on
 * a geometry without one blackens the entire batch. This writes it once onto
 * the shared geometry — the same thing `instanceModel` does, and harmless to
 * every other user of the model, since a material with `vertexColors` off never
 * looks at it.
 */
function ensureVertexColorAttribute(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute('color')) return
  const count = geometry.attributes.position.count
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3))
}

/** One authored piece of the wall, with the lean the jungle read depends on. */
interface WallPlacement {
  x: number
  y: number
  z: number
  rotationY: number
  scale: number
  /** Lean off vertical, in radians. */
  lean: number
  /** Compass bearing the lean falls toward. */
  leanBearing: number
  /** Per-instance tint, linear RGB, already multiplied by the rank's. */
  tint: [number, number, number]
}

/**
 * Build instanced meshes for a set of authored placements, split into spatial
 * chunks.
 *
 * This is `bake.ts`'s `makeInstancedChunks` with one addition it cannot make:
 * `Placement` carries `rotationY` and nothing else, because everything the
 * valley plants stands up straight. A jungle does not. The lean is the single
 * cheapest thing that separates a treeline from an orchard, and it is also how
 * the doorway gets its arch, so the wall composes its own matrices.
 *
 * The chunking is the reason this is worth doing at all: a single InstancedMesh
 * spanning the whole wall has one bounding volume covering the whole wall, so
 * it is either fully drawn or fully culled. Chunked, the frustum test discards
 * the two-thirds of the horseshoe standing behind the camera.
 */
const CHUNK_SIZE = 22

function makeWallChunks(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: WallPlacement[],
  opts: { minor?: boolean; castShadow?: boolean },
): THREE.Group {
  const group = new THREE.Group()
  if (placements.length === 0) return group

  const buckets = new Map<string, WallPlacement[]>()
  for (const p of placements) {
    const key = `${Math.floor(p.x / CHUNK_SIZE)}:${Math.floor(p.z / CHUNK_SIZE)}`
    let bucket = buckets.get(key)
    if (!bucket) buckets.set(key, (bucket = []))
    bucket.push(p)
  }

  const m = new THREE.Matrix4()
  const yaw = new THREE.Quaternion()
  const tilt = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const colour = new THREE.Color()

  for (const bucket of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length)
    const colors = new Float32Array(bucket.length * 3)

    bucket.forEach((p, i) => {
      yaw.setFromAxisAngle(up, p.rotationY)
      // Rotating about the axis perpendicular to a bearing tips the model's
      // own up-vector over toward that bearing — see the Rodrigues expansion:
      // (0,1,0)cosθ + (cos b, 0, sin b)sinθ.
      axis.set(Math.sin(p.leanBearing), 0, -Math.cos(p.leanBearing))
      tilt.setFromAxisAngle(axis, p.lean)
      pos.set(p.x, p.y, p.z)
      scl.setScalar(p.scale)
      mesh.setMatrixAt(i, m.compose(pos, tilt.multiply(yaw), scl))
      colour.setRGB(p.tint[0], p.tint[1], p.tint[2])
      colors[i * 3] = colour.r
      colors[i * 3 + 1] = colour.g
      colors[i * 3 + 2] = colour.b
    })

    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
    mesh.instanceColor.needsUpdate = true
    /*
     * Nothing on this wall casts.
     *
     * Two hundred and eighty authored trees in the shadow pass is the single
     * most expensive thing the opening could ask for, and the ground under them
     * is already carrying painted dapple from the floor fields — a real shadow
     * map would only fight it. The rocks are the exception; see buildRocks.
     */
    mesh.castShadow = opts.castShadow ?? false
    mesh.receiveShadow = true
    if (opts.minor) mesh.layers.set(MINOR_LAYER)
    mesh.computeBoundingSphere()
    // The lean swings a crown outside the sphere the matrices imply; pad rather
    // than risk a chunk popping at the frustum edge.
    mesh.boundingSphere!.radius += 4
    // Static by construction, so opt out of the per-frame matrix walk.
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    group.add(mesh)
  }

  return group
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
  /** Cloned per model+sway, so the shared originals are never touched. */
  private readonly materials = new Map<string, THREE.Material>()
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

    for (const rank of RANKS) {
      const model = getModels()[rank.species]
      // Height→scale is linear in the model's own bounding box, so one fit at
      // unit height serves every instance in the rank.
      const unit = fitToHeight(model, 1)
      const placements: WallPlacement[] = []

      const walk = (sp: Spine, onWing: boolean) => {
        const step = rank.spacing * (onWing ? (rank.wingSpacing ?? 2.2) : 1)
        for (let d = rank.phase; d < sp.length; d += step) {
          const { out } = sp.at(d)
          // Jitter runs along the wall as well as across it, so the ranks never
          // resolve into the rows the fixed spacing would otherwise produce.
          const along = (r() - 0.5) * step * 0.8
          const { p: pj } = sp.at(d + along)
          const off = rank.offset + (r() - 0.5) * rank.jitter
          const x = pj.x + out.x * off
          const z = pj.y + out.y * off
          if (rank.keepOut !== undefined && Math.hypot(x - CENTRE.x, z - CENTRE.y) < rank.keepOut) {
            continue
          }
          /*
           * Nothing stands in the surf.
           *
           * The wings are drawn along a coastline the spine only approximates,
           * so anything that lands on open beach there is a tree growing out of
           * the sand and gets dropped rather than nudged. Round the horseshoe
           * the test is looser — the verge is technically still sand and is in
           * fact exactly where a treeline stands — but the back ranks now reach
           * five units seaward of the spine at the gap lips, which is far
           * enough to wade.
           */
          if (isSand(x, z) && groundHeight(x, z) < (onWing ? VERGE_HIGH : VERGE_LOW)) continue

          const height = rank.heightMin + r() * (rank.heightMax - rank.heightMin)
          const v = 1 + (r() - 0.5) * 2 * (rank.vary ?? 0)
          placements.push({
            x,
            y: groundHeight(x, z) + unit.groundY * height - rank.sink,
            z,
            rotationY: r() * Math.PI * 2,
            scale: unit.scale * height,
            lean: (rank.lean ?? 0) * r(),
            leanBearing: r() * Math.PI * 2,
            tint: [rank.tint[0] * v, rank.tint[1] * v, rank.tint[2] * v],
          })
        }
      }

      walk(spine, false)
      if (rank.wing !== false) for (const wing of wings) walk(wing, true)

      this.group.add(
        makeWallChunks(model.geometry, this.materialFor(rank.species, rank.sway === true), placements, {
          minor: rank.minor,
        }),
      )
    }

    this.buildArch(spine, r)
    this.buildRocks(r)
    this.buildColliders(spine, obstacles)

    scene.add(this.group)
  }

  /**
   * A cloned material for one species, built at most twice (static and sway).
   *
   * Cached rather than cloned per rank so the ranks that share a species also
   * share a shader program — the value ladder rides on `instanceColor`, which
   * costs nothing per material.
   */
  private materialFor(species: SpeciesId, sway: boolean): THREE.Material {
    const key = `${species}:${sway}`
    let material = this.materials.get(key)
    if (!material) {
      const model = getModels()[species]
      ensureVertexColorAttribute(model.geometry)
      material = createWallMaterial(model, sway)
      this.materials.set(key, material)
    }
    return material
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

  /** The doorway's arch, plus four leaners round the ring. See ARCH_SPOTS. */
  private buildArch(spine: Spine, r: () => number) {
    const model = getModels().tree
    const unit = fitToHeight(model, 1)
    const placements: WallPlacement[] = []

    ARCH_SPOTS.forEach((spot, i) => {
      const d = spot.at * spine.length
      const { p, out } = spine.at(d)
      // A little outward of the spine, so the trunk stands clear of the walking
      // slot and only the crown crosses it.
      const off = i < 2 ? 0.5 : 1.0
      const x = p.x + out.x * off
      const z = p.y + out.y * off
      // The two gap trees lean at each other across the mouth; the rest lean
      // inward over the clearing, which is where the player is looking from.
      const bearing = i === 0 ? Math.PI / 2 : i === 1 ? -Math.PI / 2 : Math.atan2(-out.y, -out.x)
      const height = spot.height * (0.94 + r() * 0.14)
      placements.push({
        x,
        y: groundHeight(x, z) + unit.groundY * height - 0.4,
        z,
        rotationY: r() * Math.PI * 2,
        scale: unit.scale * height,
        lean: spot.lean,
        leanBearing: bearing + (r() - 0.5) * 0.3,
        tint: [0.50, 0.63, 0.46],
      })
    })

    this.group.add(makeWallChunks(model.geometry, this.materialFor('tree', false), placements, {}))
  }

  /**
   * The rock at the jungle foot — the wall's darkest value and its only caster.
   *
   * A wall of nothing but green loses its scale, and a hard shadow off a hard
   * dark rock is what sells stone next to all that foliage. Ten of them is a
   * shadow bill the pass can afford; the trees' is not.
   */
  private buildRocks(r: () => number) {
    for (const cluster of [false, true]) {
      const species: SpeciesId = cluster ? 'rockCluster' : 'rock'
      const model = getModels()[species]
      const unit = fitToHeight(model, 1)
      const placements: WallPlacement[] = ROCKS.filter((s) => s.cluster === cluster).map((s) => ({
        x: s.x,
        y: groundHeight(s.x, s.z) + unit.groundY * s.height - 0.12,
        z: s.z,
        rotationY: r() * Math.PI * 2,
        scale: unit.scale * s.height,
        lean: r() * 0.12,
        leanBearing: r() * Math.PI * 2,
        // Down and cool: volcanic rock, not the valley's sunlit river stone.
        tint: [0.40, 0.42, 0.45],
      }))
      this.group.add(
        makeWallChunks(model.geometry, this.materialFor(species, false), placements, {
          castShadow: true,
        }),
      )
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

  update(dt: number, _elapsed: number) {
    if (this.disposed || !this.visible) return
    // The trade-wind sway on the front rank. One uniform; skipping a frame
    // freezes the treeline.
    windTime.value += dt
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const o of this.obstacles) o.off = true
    this.obstacles.length = 0
    this.scene.remove(this.group)
    for (const patch of this.floor) patch.dispose()
    this.floor.length = 0
    /*
     * Materials only — the geometries and the textures under them belong to the
     * shared model cache and are still planted all over the valley. Disposing
     * a `LoadedModel.geometry` here would take the forest out with the wall.
     */
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}
