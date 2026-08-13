import * as THREE from 'three'
import { makeInstancedChunks, type Placement } from '../../assets/bake'
import { rng } from '../../assets/style'
import { groundHeight, isSand } from '../terrain'
import type { Obstacle } from '../world'
import {
  createLoamPatch,
  RAMP_SHADE_GREEN,
  type LoamPatch,
  type LoamRamp,
} from '../../assets/opening/loam'
import { fitToHeight, getModels, PROP_HEIGHT } from '../../assets/models'

/**
 * The opening's treeline (spec asset manifest, environment 5–8).
 *
 * **Read this before changing any number below.**
 *
 * This file used to build a *wall*: a horseshoe of procedurally generated
 * canopy masses, packed into eleven overlapping ranks with a dedicated
 * understory plug, so that no sky and no sea could be seen through it from the
 * beach. It was ~470 pieces of hand-generated foliage, and the review of it was
 * that the big low-poly leaf slabs read as paper cut-outs stacked into a
 * curtain rather than as jungle.
 *
 * Two owner rulings then landed, in order, and both of them are subtractions:
 *
 *  1. **"Remove all the procedural treeline, it should be the model GLBs only."**
 *     The parts kit (`assets/opening/jungle-props.ts`) is deleted. Everything
 *     green here is now one of the authored glTFs the rest of the map is
 *     planted with — the broadleaf, the conifer, the palm and the bush from
 *     `assets/models.ts`, plus the same rock pair.
 *
 *  2. **"The jungle around the clearing should look exactly like the rest of
 *     the map's jungle — same density, no denser."** So the ranks are gone too.
 *     Sky and sea *between the trunks is expected and correct*: that is what
 *     the valley's own forest does, and the closer this treeline is to
 *     indistinguishable from it, the more right it is.
 *
 * The consequence, spelled out so nobody re-densifies it by accident: this is
 * **not** an opaque wall and must not be made into one again. If a later frame
 * shows the meadow, the village roofs or the horizon through the trunks, that
 * is the ruling working as intended, not a bug. The doorway still reads,
 * because the guide trail, the butterflies and the gap in the collider chain
 * point at it — wayfinding by guidance, not by masonry.
 *
 * **Density is copied from `game/vegetation.ts` rather than invented.** That
 * file scatters 1400 trees, 820 bushes and 540 rocks across the walkable ring,
 * which works out at roughly one tree per 26 m², one bush per 45 m² and one
 * rock per 70 m². The scatter below spreads the same species, at the same
 * heights (`PROP_HEIGHT` × the same jitter ranges), over a band along the
 * spine, at those exact areal densities — see `AREA_PER`. Every instance also
 * registers the same size of obstacle circle vegetation.ts gives it, so the
 * camera boom pushes off these trees exactly the way it does off the valley's.
 *
 * They are drawn with the shared `LoadedModel` geometry *and its own material*,
 * unmodified: no cloned materials, no per-instance tint, no shader injection.
 * A copy that is shaded differently from the valley's copy is, by definition,
 * distinguishable from it.
 *
 * What is still deliberately different from open valley, and why:
 *
 *  - **The collider chain.** A continuous ring of overlapping circles runs the
 *    spine with one gap at `gapCentre`. It is load-bearing far beyond scenery:
 *    `main.ts` routes the guide trail and the player's walk waypoint through
 *    `gapCentre`, and the handover walks these entries back out of the world.
 *    The trees are valley-sparse; the *boundary* is not, and must not be.
 *  - **The floor.** Conforming loam patches in shaded jungle green under the
 *    horseshoe and along the verge. That is ground, not treeline — it is what
 *    stops the opening being played on a bright mown lawn — and neither ruling
 *    touched it.
 *
 * Lifetime: this is an **opening-only** prop. `setVisible(false)` hides it and
 * releases every collider; `dispose()` removes it from the scene for good. The
 * integrator must do one or the other at handover, or the treeline stands
 * between the finished farm and the village lane forever.
 */

/** Centre the horseshoe wraps — the pocket/farm pad, contract §4.1. */
const CENTRE = new THREE.Vector2(-32, 0)

/**
 * The treeline's spine, from the south lip of the gap all the way round to the
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
 * They are built by *finding* the shore rather than by hand-placed coordinates:
 * at each step, march seaward until the ground turns to sand, then stand the
 * spine a metre inland of that. The coast is an arc, and a straight line of
 * trees drawn along it either wades into the water at one end or leaves a wedge
 * of meadow at the other.
 *
 * Wings carry no colliders. They are scenery, not a fence, and the player has
 * no business up there in the first eight minutes. They are planted at exactly
 * the same areal density as the horseshoe and as the valley — see the header.
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
 * Band offsets are signed against it: positive runs away from whatever the
 * spine faces. Round the horseshoe that is inland/seaward by radius; along the
 * coast it is straight inland. Getting this backwards stands the trees in the
 * surf — which `isSand` below would then throw away, leaving an empty coast.
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
 * The band the scatter fills, measured outward from the spine.
 *
 * A forest is a field, not a hedge, and the density ruling is an *areal* one —
 * so the honest way to spend it is depth. Eleven units of band at valley
 * density is a stand of trees you can see into and past, which is exactly what
 * the valley looks like; the same number of trees crammed into a two-unit strip
 * would be a row, which is what the valley never looks like.
 *
 * The inner lip stops short of the clearing so the pocket and the beds keep
 * their room (see `KEEP_OUT`); the outer lip runs out over the beach and is
 * clipped by the sand test, which is the same rule that keeps the valley's own
 * forest off the shore.
 */
const BAND_INNER = -2.0
const BAND_OUTER = 9.0
const BAND_WIDTH = BAND_OUTER - BAND_INNER

/** Nothing grows inside this radius of the ring centre — the farm pad. */
const KEEP_OUT = 8.6

/** Nothing grows inside this radius of the doorway, which has to stay open. */
const GAP_CLEAR = 3.0

/**
 * Square metres of ground per instance, straight out of `game/vegetation.ts`.
 *
 * That file scatters TREE_COUNT 1400, BUSH_COUNT 820 and ROCK_COUNT 540 by
 * rejection sampling over the walkable ring; against the plantable area that
 * survives its filters those come out at about one tree per 26 m², one bush per
 * 45 m² and one rock per 70 m². Its species split is `conifer = h > 8 ? 85% :
 * 30%`, and this ground is all well below 8, so roughly seven broadleaf to
 * three conifer — which is what the two tree figures below encode.
 *
 * Palms are vegetation.ts's coastal exception (PALM_COUNT 150 along the sand
 * band, nowhere else). This is a beach, so they belong; they are the sparsest
 * thing here for the same reason they are there.
 *
 * **These numbers are the owner's ruling in numeric form. Lowering them —
 * making this treeline denser than the valley — is the specific change that is
 * not wanted.**
 */
const AREA_PER = {
  broadleaf: 26 / 0.7,
  conifer: 26 / 0.3,
  palm: 110,
  bush: 45,
} as const

/** One scattered species, with vegetation.ts's own height jitter. */
interface ScatterSpec {
  species: 'tree' | 'pine' | 'palm' | 'bush'
  /** Base height from PROP_HEIGHT; the jitter multiplies it. */
  height: number
  jitterMin: number
  jitterSpan: number
  /** Ground area each instance gets, in square metres. */
  areaPer: number
  /** Obstacle radius, before the height jitter scales it. */
  collide: number
  /** Phase along the spine, so the species do not line up with each other. */
  phase: number
  /** Only where the ground is genuinely coastal. */
  coastal?: boolean
}

/**
 * The scatter, with every jitter range copied from `game/vegetation.ts`.
 *
 * The heights are not a stylistic choice made here — they are the valley's, so
 * that a tree in this treeline and a tree fifty metres inland are the same
 * tree. `PROP_HEIGHT.tree` is 5.6 and vegetation jitters it 0.92–1.52, so the
 * broadleaf runs 5.2–8.5 units; the conifer runs 7.0–11.9 the same way. The
 * old wall ran 8–24, which is the single clearest tell that it was a wall.
 */
const SCATTER: ScatterSpec[] = [
  {
    species: 'tree',
    height: PROP_HEIGHT.tree,
    jitterMin: 0.92,
    jitterSpan: 0.6,
    areaPer: AREA_PER.broadleaf,
    collide: 0.5,
    phase: 0.4,
  },
  {
    species: 'pine',
    height: PROP_HEIGHT.pine,
    jitterMin: 0.9,
    jitterSpan: 0.62,
    areaPer: AREA_PER.conifer,
    collide: 0.5,
    phase: 2.7,
  },
  {
    species: 'palm',
    height: PROP_HEIGHT.palm,
    jitterMin: 0.82,
    jitterSpan: 0.55,
    areaPer: AREA_PER.palm,
    collide: 0.45,
    phase: 5.3,
    coastal: true,
  },
  {
    species: 'bush',
    height: PROP_HEIGHT.bush,
    jitterMin: 0.7,
    jitterSpan: 0.7,
    areaPer: AREA_PER.bush,
    collide: 0.42,
    phase: 1.6,
  },
]

/**
 * The two jambs: one broadleaf on each lip of the gap.
 *
 * The retired wall arched the doorway with a purpose-built overhang module at
 * thirteen units. This is what survives of that idea under the density ruling —
 * two ordinary trees at the *top* of the valley's own size range, standing
 * where the collider chain ends. Nothing here is bigger than something the
 * player will walk past inland ten minutes later; they simply happen to be
 * placed rather than scattered, so the mouth has two posts.
 */
const JAMB_HEIGHT = PROP_HEIGHT.tree * 1.5
const JAMB_OFFSET = 1.2

/**
 * Rock at the treeline's foot, hand-placed in world coordinates.
 *
 * These were procedural basalt outcrops with a salt crust — the only non-green
 * module in the old parts kit, and the one place the kit was doing something
 * the authored set could not. It turns out the authored set can: `rock` and
 * `rockCluster` are the valley's own boulders, and they sit at the same sizes
 * here that vegetation.ts gives them there.
 *
 * Ten of them over the horseshoe is, at the ring's area, close to the valley's
 * own one-per-70 m² — so they stayed hand-placed rather than scattered. Rocks
 * scattered by rule come out evenly spaced, which is the one thing rocks never
 * are: these sit where the treeline turns, because the inside of a bend is
 * where loose rock actually collects, plus one at the threshold of the gap,
 * well clear of the walking corridor, to give the doorway a step.
 */
const ROCKS: { x: number; z: number; cluster: boolean; jitter: number }[] = [
  { x: -40.0, z: -5.2, cluster: false, jitter: 1.5 },
  { x: -37.4, z: -8.8, cluster: true, jitter: 1.2 },
  { x: -30.6, z: -9.6, cluster: false, jitter: 1.7 },
  { x: -24.2, z: -7.6, cluster: true, jitter: 0.9 },
  { x: -22.6, z: -0.8, cluster: false, jitter: 1.3 },
  { x: -23.0, z: 5.8, cluster: true, jitter: 1.1 },
  { x: -29.0, z: 9.2, cluster: false, jitter: 1.6 },
  { x: -37.8, z: 8.6, cluster: true, jitter: 1.0 },
  { x: -40.2, z: 4.8, cluster: false, jitter: 1.4 },
  { x: -41.4, z: -2.4, cluster: true, jitter: 0.7 },
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
 * units east, so its colours are not the opening's to repaint. Instead this
 * lays its own floor: conforming, feathered, opening-lifetime-only, and gone at
 * handover with everything else here.
 *
 * Three zones, all built from one noise field so they meet without a seam:
 *
 *  - **Interior** — the horseshoe's inside, in shaded jungle floor: dark green
 *    with olive leaf litter through it. This is the ground the pocket is choked
 *    on and the beds are dug into.
 *  - **Skirt** — a ring outside the treeline in deep shade green, killing the
 *    lit verge that used to show between the trunks and the sand.
 *  - **Approach** — the same shade green run down the beach side, masked off
 *    the sand by `isSand` so it stops at the real shoreline rather than at a
 *    rectangle.
 *
 * This is ground, not treeline. Neither owner ruling touched it, and with the
 * trees thinned to valley density it is doing *more* of the work of making the
 * clearing read as a clearing, not less.
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
/**
 * Whether the opening lays its own jungle floor at all. Owner ruling: no.
 * See the long note at the `buildFloor` call site before changing this.
 */
const FLOOR_ENABLED = false

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
 * lit green hem the floor has to cover. Below `VERGE_LOW` is open beach and
 * stays ivory.
 */
const VERGE_LOW = 1.55
const VERGE_HIGH = 2.35

/** Skirt fields, placed by arc-length along the spine at an outward offset. */
const SKIRT_SPACING = 6.5
const SKIRT_OFFSET = 2.4
const SKIRT_SIZE = 11

/** Foot-of-the-treeline debris ring: small fields just *inside* the spine. */
const FOOT_SPACING = 4.2
const FOOT_OFFSET = -2.0
const FOOT_SIZE = 5.5

/**
 * Colliders along the spine.
 *
 * The one place this is deliberately unlike open valley, and the reason is not
 * scenery. Circles at 1.4-unit spacing with a 1.5 radius overlap to at least
 * 1.3 units of depth everywhere, leaving exactly one mouth — at `gapCentre` —
 * and `main.ts` builds the opening's whole routing on that fact: the guide
 * trail vias through the gap, the player's walk waypoint is the gap, the
 * butterflies fly to the gap and the handover strikes these entries out of the
 * shared obstacle array by identity.
 *
 * So the trees thinned to valley density and this chain did not. It sits half a
 * unit inside the spine, so the player is stopped roughly where the growth is
 * rather than a metre short of it.
 */
const COLLIDER_SPACING = 1.4
const COLLIDER_RADIUS = 1.5
const COLLIDER_OFFSET = -0.6

/**
 * Chunk size for the instanced batches, matching `game/vegetation.ts`.
 *
 * Same reasoning as there: a chunk that is too small submits a handful of
 * triangles per draw call, which is nowhere near enough work to cover the cost
 * of issuing one, and a single batch spanning the whole treeline is either
 * fully drawn or fully culled.
 */
const CHUNK_SIZE = 68

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
  private readonly floor: LoamPatch[] = []
  /** Fast membership test for `setVisible`, which must skip the floor. */
  private readonly floorObjects = new Set<THREE.Object3D>()
  private readonly scene: THREE.Group
  private disposed = false

  constructor(scene: THREE.Group, obstacles: Obstacle[]) {
    this.scene = scene
    this.gapCentre = new THREE.Vector3(GAP_X, groundHeight(GAP_X, 0), 0)

    const spine = new Spine(SPINE)
    const wings = buildWingSpines()
    const r = rng(0x1a1e5)

    /*
     * The floor is not built.
     *
     * `buildFloor` laid a large conforming field of shaded jungle green across
     * the clearing's interior, plus skirt and foot fields along the treeline. It
     * existed to make the pocket read as a clearing inside something darker, and
     * with the trees at wall density it did.
     *
     * At valley density it stopped being the floor of a jungle and started being
     * a dark green stain on an ordinary lawn — the owner marked it in a
     * screenshot and ruled: it should be just the normal grass. That is the same
     * ruling as the density one, applied to the ground: the opening's ground is
     * the valley's ground, and anything that makes it distinguishable from the
     * valley's ground is wrong however good the reason was.
     *
     * The builder is kept behind the flag below, rather than deleted, because
     * everything it knows about conforming a field to this baked terrain is
     * hard-won. Do not flip it back without a new ruling. The pocket's OWN
     * loam — the cleared earth and the dug beds, owned by chaos-pocket.ts and
     * loam.ts — is untouched and is now the only thing on this ground that is
     * not grass, which is what makes the clearing read as something the player
     * made rather than somewhere they happen to stand.
     */
    if (FLOOR_ENABLED) this.buildFloor(spine, wings)

    for (const spec of SCATTER) {
      const model = getModels()[spec.species]
      // Height→scale is linear in the model's own bounding box, so one fit at
      // unit height serves every instance.
      const unit = fitToHeight(model, 1)
      const placements: Placement[] = []

      /*
       * Spacing along the spine is derived from the areal density, not chosen:
       * one instance per `areaPer` square metres over a band `BAND_WIDTH`
       * wide comes out to a step of areaPer / BAND_WIDTH. That is the whole
       * mechanism by which this treeline is as dense as the valley and no more.
       */
      const step = spec.areaPer / BAND_WIDTH

      const walk = (sp: Spine) => {
        for (let d = spec.phase; d < sp.length; d += step) {
          const { out } = sp.at(d)
          // Jitter runs along the spine as well as across it, so the scatter
          // never resolves into the row the fixed step would otherwise produce.
          const { p } = sp.at(d + (r() - 0.5) * step * 0.9)
          const off = BAND_INNER + r() * BAND_WIDTH
          const x = p.x + out.x * off
          const z = p.y + out.y * off

          // Out of the farm pad and out of the doorway.
          if (Math.hypot(x - CENTRE.x, z - CENTRE.y) < KEEP_OUT) continue
          if (Math.hypot(x - this.gapCentre.x, z - this.gapCentre.z) < GAP_CLEAR) continue

          /*
           * Nothing stands on the open beach, which is the same rule
           * vegetation.ts enforces with COAST_CLEAR — a forest growing down the
           * sand to the tideline is the one thing that would stop the seaward
           * side reading as a coast at all. The verge, technically still sand
           * and visually already the bank, is fair game and is in fact exactly
           * where a treeline stands. Palms are the exception there too: they
           * are the one species the eye accepts on sand, so they are *only*
           * placed on it.
           */
          const sand = isSand(x, z)
          const h = groundHeight(x, z)
          if (spec.coastal) {
            if (!sand || h < VERGE_LOW) continue
          } else if (sand && h < VERGE_HIGH) {
            continue
          }

          const jitter = spec.jitterMin + r() * spec.jitterSpan
          const height = spec.height * jitter
          placements.push({
            x,
            y: h + unit.groundY * height,
            z,
            rotationY: r() * Math.PI * 2,
            scale: unit.scale * height,
          })
          /*
           * One obstacle per trunk, at vegetation.ts's own radius for the
           * species. This is what makes the camera boom behave around these
           * trees exactly as it does around the valley's — which is why the
           * near-camera stipple dissolve the old wall needed is gone.
           */
          const obstacle: Obstacle = { x, z, r: spec.collide * jitter }
          obstacles.push(obstacle)
          this.obstacles.push(obstacle)
        }
      }

      walk(spine)
      for (const wing of wings) walk(wing)

      this.group.add(
        makeInstancedChunks(model.geometry, placements, {
          chunkSize: CHUNK_SIZE,
          material: model.material,
        }),
      )
    }

    this.buildJambs(spine, r)
    this.buildRocks(r)
    this.buildColliders(spine, obstacles)

    scene.add(this.group)
  }

  /** One broadleaf on each lip of the gap. See JAMB_HEIGHT. */
  private buildJambs(spine: Spine, r: () => number) {
    const model = getModels().tree
    const unit = fitToHeight(model, 1)
    const placements: Placement[] = []

    for (const d of [0, spine.length]) {
      const { p, out } = spine.at(d)
      const x = p.x + out.x * JAMB_OFFSET
      const z = p.y + out.y * JAMB_OFFSET
      const height = JAMB_HEIGHT * (0.94 + r() * 0.12)
      placements.push({
        x,
        y: groundHeight(x, z) + unit.groundY * height,
        z,
        rotationY: r() * Math.PI * 2,
        scale: unit.scale * height,
      })
    }

    this.group.add(
      makeInstancedChunks(model.geometry, placements, {
        chunkSize: CHUNK_SIZE,
        material: model.material,
      }),
    )
  }

  /** The boulders at the treeline's foot. See ROCKS. */
  private buildRocks(r: () => number) {
    for (const cluster of [false, true]) {
      const model = cluster ? getModels().rockCluster : getModels().rock
      const height = cluster ? PROP_HEIGHT.rockCluster : PROP_HEIGHT.rock
      const unit = fitToHeight(model, 1)
      const placements: Placement[] = ROCKS.filter((s) => s.cluster === cluster).map((s) => {
        const h = height * s.jitter
        return {
          x: s.x,
          y: groundHeight(s.x, s.z) + unit.groundY * h,
          z: s.z,
          rotationY: r() * Math.PI * 2,
          scale: unit.scale * h,
        }
      })
      this.group.add(
        makeInstancedChunks(model.geometry, placements, {
          chunkSize: CHUNK_SIZE,
          material: model.material,
        }),
      )
    }
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
     * The treeline's foot — roots, stones and drifted litter where the jungle
     * meets the clearing.
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

    // Skirt: deep shade green round the outside of the treeline.
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
    // treeline — a short chain there widens the mouth on one side and puts it
    // off centre from the gap the player is being led to.
    place(spine.length)
  }

  /**
   * Hide or show the treeline. Colliders follow the mesh — an invisible wall
   * the player still bounces off is the worse half of both states.
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
    this.group.visible = true
    for (const child of this.group.children) {
      if (!this.floorObjects.has(child)) child.visible = v
    }
    for (const o of this.obstacles) o.off = !v
  }

  /**
   * Nothing here animates.
   *
   * The old wall's front rank swayed in a vertex shader and its doorway shafts
   * breathed; both went with the parts kit, and the valley's own trees stand
   * still. The method stays because `main.ts` drives it every frame and because
   * a prop that cannot be ticked is a prop that can never grow an animation
   * back.
   */
  update(_dt: number, _elapsed: number) {}

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const o of this.obstacles) o.off = true
    this.obstacles.length = 0
    this.scene.remove(this.group)
    for (const patch of this.floor) patch.dispose()
    this.floor.length = 0
    /*
     * No geometry or material disposal, deliberately. Everything drawn here is
     * the shared `LoadedModel` straight out of the model cache, still planted
     * all over the valley — disposing any of it would take the forest out with
     * the opening.
     */
  }
}
