import * as THREE from 'three'
import { ball, cyl, rng } from '../style'
import { bakeGroup } from '../bake'
import type { CropModelOptions } from '../crops'

/**
 * The Sun Tomato — the first thing the player ever grows, and the plant that
 * has to sell the harvest beat.
 *
 * Why this species does not come out of the crop tables
 * ----------------------------------------------------
 * Every other crop is massed by `form` and detailed by `fruit` in
 * assets/crops.ts, and that pipeline is tuned for a *field*: a ripe bush there
 * stands about 0.75 units, because a hundred and sixty of them have to read as
 * texture rather than as individuals. The opening has six plants, seen from a
 * low over-the-shoulder camera, and beat 8 asks the player to look at them one
 * at a time and pick. At field size they read as green nubs in a bed — which is
 * exactly what the first pass shipped. So this species is authored: a proper
 * Mediterranean bush, roughly two thirds the avatar's height, carrying fruit
 * big enough to want.
 *
 * The five states (spec §Flora)
 * -----------------------------
 *   sprout    — two seed-leaves and a first true leaf. Low, flat, two-lobed.
 *   vine      — young sprawl: two stems flopping outward, leaves already broad.
 *   flowering — the mound half-built, speckled with small pale star flowers.
 *   fruiting  — a low sprawling vine: broad soft leaves in a wide parasol with
 *               4–6 plump red fruit sitting out on the rim at bed height.
 *   odd       — the same plant, 1.42× across, its fruit veined with gold.
 *
 * The five are meant to be told apart from the game camera by silhouette alone:
 * flat cross → open V → low dome → low dome with red on its rim → the same
 * dome grown half again as big. Colour is the confirmation, not the read.
 *
 * Why a sprawl and not a bush
 * ---------------------------
 * The pass before this one stacked narrow leaf tiers up a central stem, and it
 * photographed as a conifer with tomatoes glued to it: rings of thin leaflets
 * read as needle whorls, and the spire pulled every fruit up off the soil where
 * a truss never sits. A real tomato left unstaked — which is what a castaway's
 * first crop is — flops. So the mass here is WIDE and LOW: broad folded blades
 * radiating from a short crown and drooping past horizontal, fruit resting out
 * near the leaf line where a hand would reach. Wider than tall is the whole
 * read, and it is what makes six of them look like a *bed* rather than a
 * hedgerow.
 *
 * Reserved-colour discipline (opening contract rule 4)
 * ---------------------------------------------------
 * LOTTO_GOLD (#f2c14e) appears on the 'odd' state and nowhere else in this
 * file — it is the first gold the player ever sees and it must mean luck. The
 * flowering state's petals are deliberately a pale primrose (#eedd88), far
 * enough from lotto gold in both hue and saturation to survive the automated
 * colour scan the verify plan runs over beats 1–7. The gold on the odd fruit is
 * *veining*: short, crooked, uneven streaks that wander over the shoulders like
 * something grew through the skin. Not meridians — evenly spaced gold ribs read
 * as a cage bolted around the fruit, which is a manufactured object, and the
 * one thing this fruit must never look like is manufactured.
 *
 * Grade note: postfx multiplies saturation by 1.2 and the scene is pinned to a
 * warm 7.2am, so every colour here is authored a step under where it should
 * land — the reds especially, which the dawn key light pushes orange.
 *
 * Contract with the farm pipeline (assets/crops.ts `createCropModel`, which
 * game/farm.ts `buildCropModel` is the seam for — see `createSunTomatoModel`):
 *   - origin at y = 0, sitting on the soil surface;
 *   - `userData.baseScale` = the group's own scale, so farm.ts can re-derive the
 *     per-plant girth jitter it must not overwrite;
 *   - `userData.stretch` = how tall the plant reaches per unit of girth, which
 *     is what farm.ts's MAX_CROP_SCALE clamp measures against;
 *   - `userData.update?: (elapsed) => void` for the odd fruit's faint shimmer.
 * Growth scaling is farm.ts's job and is left alone: each state is authored at
 * the size it should be at the *end* of its stage, and `applyCropScale` ramps
 * from 0.32 to 1 across the plant's life on top of that.
 */

export type SunTomatoState = 'sprout' | 'vine' | 'flowering' | 'fruiting' | 'odd'

// --- palette -----------------------------------------------------------------

/** Deep tomato red. Authored under-saturated: the grade and the dawn key both
 *  push it, and the shop tomato's 0xe0442f came out fluorescent at this hour. */
const C_FRUIT = 0xc4402c
/** The shaded underside of the fruit, and its ribs. */
const C_FRUIT_DEEP = 0x9e2f20
/** Foliage. Mid, dark and sunlit, inside the spec's jungle range so the bed
 *  belongs to the island rather than sitting on it as a colour patch. */
const C_LEAF = 0x4a9a3c
const C_LEAF_DARK = 0x357a2e
const C_LEAF_LIGHT = 0x6cbe52
/** Stems and the fruit's calyx. */
const C_STEM = 0x3f8434
const C_STEM_DARK = 0x2f6628
/** Turned soil at the collar, where the stem breaks the surface. */
const C_COLLAR = 0x6f3d26
/** Flower petals. Pale primrose — see the reserved-colour note above. */
const C_PETAL = 0xeedd88
/** The flower's centre knot. Green, so the flower never reads as a gold speck. */
const C_PETAL_CORE = 0x7fae52
/** LOTTO_GOLD. Streaks on the odd fruit only. Duplicated as a literal rather
 *  than imported from game/opening/types so this asset stays a leaf module. */
const LOTTO_GOLD = 0xf2c14e
/** The stylised sheen cap. Lambert has no specular, so ripeness is sold with a
 *  small unlit highlight instead — the toy-plastic way to say "wet skin". */
const C_SHEEN = 0xfff4de

// --- proportions -------------------------------------------------------------

/**
 * How much bigger the odd plant is than its five neighbours.
 *
 * The spec's word is *oversized*, and the whole plant carries it, not just the
 * fruit: the odd one is the same silhouette grown half again, so the player's
 * eye finds it down the bed before a single gold pixel is resolved. Under 1.3
 * it reads as growth jitter; past 1.6 it reads as a different species.
 */
const ODD_SCALE = 1.42

/**
 * Authored height per state, in local units before the per-plant girth.
 *
 * The avatar is ~1.7 units and the beds are 1.2 apart. A ripe sprawl stands
 * 0.88 and spans a little over a metre: knee-high on the player, filling its
 * bed corner to corner, and — the point — WIDER THAN TALL, which is what an
 * unstaked tomato does and what keeps six of them reading as a planted bed
 * seen from a low camera instead of a hedge the camera has to see over.
 */
const HEIGHT: Record<SunTomatoState, number> = {
  sprout: 0.5,
  vine: 0.66,
  flowering: 0.8,
  fruiting: 0.88,
  odd: 0.88 * ODD_SCALE,
}

/**
 * How far the leaf mass sprawls, as a multiple of the plant's height. Over 1
 * means the plant is wider than it is tall — see the note above.
 *
 * Ceiling set by the bed, not by taste: tiles are TILE_SIZE 1.2 apart and the
 * farm's own girth jitter reaches ~1.18×, so 1.12 × 0.88 lands a ripe plant
 * just under a tile wide at its largest. Past that, six plants knit into one
 * hedge and every fruit is buried in a neighbour. (The odd plant deliberately
 * blows through this — it is supposed to be crowding the bed.)
 */
const SPREAD = 1.12

/**
 * Ordinary fruit radius: plump, but a quarter of the plant's width, not half.
 *
 * 0.19 was tried first and the plant photographed as two beach balls in a
 * salad — fruit that outweighs its foliage stops being fruit and becomes the
 * whole object. The green has to be able to frame the red.
 */
const R_FRUIT = 0.142
/** The odd fruit. The body scale already carries most of the difference; this
 *  adds the last 20% so its fruit is unmistakably the heaviest in the bed. */
const R_ODD = R_FRUIT * ODD_SCALE * 1.2

/** Foliage variants, matching the crop pipeline's own count. Three is enough
 *  that no two plants in a bed of six are twins. */
const VARIANTS = 3

/** How many fruit each variant hangs. Four is the floor: a bed where one plant
 *  carries three and another six still reads as one crop, but under four the
 *  plant stops looking like it is feeding anything. */
const FRUIT_COUNT = [5, 4, 6]

// --- small builders ----------------------------------------------------------

/**
 * One broad, soft leaf lying along +Z, hinged at its origin.
 *
 * A single wide blade, not a rachis of leaflets. The compound version this
 * replaces was botanically right and photographed wrong: at the size a leaf
 * occupies on screen here, six small leaflets are six flecks, and a plant made
 * of flecks has no surface for the light to sit on. What sells *soft* is one
 * big blade catching the dawn key across it.
 *
 * The blade is folded — two half-blades tipped up off the midrib — so it is
 * never a flat disc from above and its two halves take different light. That
 * single crease is most of the difference between a leaf and a lily pad.
 *
 * `tilt` lifts it out of the horizontal (positive = held up, negative = drooped
 * past level), `spin` yaws it around the crown. Built in YXZ order so the lift
 * happens in the yawed frame — otherwise every leaf tips toward world +Z no
 * matter which side of the plant it grows on, which is the mistake that makes
 * procedural foliage look combed.
 */
function broadLeaf(len: number, color: number, tilt: number, spin: number, r: () => number) {
  const g = new THREE.Group()

  const petiole = cyl(0.011, 0.017, len * 0.42, C_STEM, 5)
  petiole.rotation.x = Math.PI / 2
  petiole.position.z = len * 0.21
  g.add(petiole)

  // Two half-blades, folded up ~18° off the midrib and swept back toward the
  // stem so the outline tapers to a point instead of ending in a paddle.
  const shade = r() < 0.4 ? C_LEAF_DARK : color
  for (const side of [-1, 1]) {
    const half = ball(0.5, shade, 1)
    half.scale.set(len * 0.46, len * 0.1, len * 0.72)
    half.position.set(side * len * 0.16, len * 0.02, len * 0.6)
    half.rotation.order = 'YXZ'
    half.rotation.set(0, side * 0.16, -side * 0.32)
    g.add(half)
  }

  // Two small basal lobes: the ragged edge that says tomato rather than hosta,
  // for the price of two meshes on a baked mesh nobody counts.
  for (const side of [-1, 1]) {
    const lobe = ball(0.5, color, 1)
    lobe.scale.set(len * 0.22, len * 0.07, len * 0.3)
    lobe.position.set(side * len * 0.2, 0, len * 0.3)
    lobe.rotation.y = side * 0.6
    g.add(lobe)
  }

  const midrib = ball(0.5, C_STEM, 1)
  midrib.scale.set(len * 0.05, len * 0.05, len * 0.9)
  midrib.position.z = len * 0.5
  g.add(midrib)

  g.rotation.order = 'YXZ'
  g.rotation.set(-tilt, spin, 0)
  return g
}

/**
 * A ring of broad leaves radiating from the crown at one height.
 *
 * `tilt` is signed: the outer rings run negative — leaves held *below*
 * horizontal — which is the droop that turns a rosette into a sprawl.
 */
function leafTier(
  parent: THREE.Group,
  count: number,
  y: number,
  len: number,
  color: number,
  tilt: number,
  r: () => number,
) {
  const phase = r() * Math.PI * 2
  for (let i = 0; i < count; i++) {
    const spin = phase + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.35
    const leaf = broadLeaf(len * (0.82 + r() * 0.36), color, tilt + (r() - 0.5) * 0.26, spin, r)
    // Generous vertical scatter: leaves placed on an exact ring read as a stack
    // of discs, and the gaps between them are where the sky gets through.
    leaf.position.y = y + (r() - 0.5) * 0.07
    parent.add(leaf)
  }
}

/**
 * A five-petal star flower, ~1cm across at plant scale.
 *
 * Deliberately tiny and pale. Their job is to say "this plant is about to give
 * you something" from across the beach, not to be a second point of interest —
 * and at this size and value they cannot be confused for the gold that arrives
 * one beat later.
 */
function starFlower(size: number, r: () => number) {
  const g = new THREE.Group()
  for (let i = 0; i < 5; i++) {
    const petal = ball(0.5, C_PETAL, 1)
    petal.scale.set(size * 0.5, size * 0.16, size * 1.05)
    const a = (i / 5) * Math.PI * 2 + r() * 0.4
    petal.position.set(Math.cos(a) * size * 0.5, 0, Math.sin(a) * size * 0.5)
    petal.rotation.y = -a
    g.add(petal)
  }
  const core = ball(size * 0.26, C_PETAL_CORE, 1)
  core.scale.y = 0.7
  core.position.y = size * 0.05
  g.add(core)
  return g
}

/** The scrap of turned soil where the stem breaks the surface. */
function collar(g: THREE.Group, radius: number) {
  const m = ball(radius, C_COLLAR, 1)
  m.scale.set(1, 0.18, 1)
  m.position.y = 0.012
  m.castShadow = false
  g.add(m)
}

// --- the fruit ---------------------------------------------------------------

/**
 * Where a fruit hangs, quoted in the plant's local frame.
 *
 * Baked alongside the foliage so a variant's fruit always lands on the same
 * branch ends its pedicels were built for.
 */
interface Anchor {
  pos: THREE.Vector3
  yaw: number
  tilt: number
}

/**
 * The fruit body at unit radius, ready to bake.
 *
 * Plump and nearly round, with two shallow creases pressed into the shoulders
 * rather than a ring of hard meridians. A tomato's ribs are dents in a soft
 * thing; drawn as raised ridges they turn it into a pumpkin, and drawn evenly
 * spaced they turn it into hardware.
 *
 * The odd fruit is the same globe VEINED with gold — short crooked streaks,
 * unevenly spaced, running only over the upper half like something that grew
 * out through the skin. Roughly a fifth of the surface: the fruit's colour is
 * still red, because the lesson the player must take from beat 8 is "you got
 * lucky", not "you grew a different crop".
 */
function buildFruitBody(odd: boolean, r: () => number) {
  const g = new THREE.Group()

  // The odd fruit's flesh is a shade deeper, so the gold on it has somewhere
  // dark to sit. Gold on bright red is two loud colours fighting; gold on deep
  // red is metal in fruit.
  const flesh = ball(1, odd ? C_FRUIT_DEEP : C_FRUIT, 2)
  flesh.scale.set(1, 0.92, 1)
  g.add(flesh)

  // Shaded belly: a second globe pushed down and in, showing only as the
  // darker underside. Cheaper than a gradient and reads at any angle.
  const belly = ball(0.94, odd ? 0x7d2418 : C_FRUIT_DEEP, 1)
  belly.scale.set(1, 0.72, 1)
  belly.position.y = -0.2
  g.add(belly)

  // Two shoulder creases, pressed IN — flattened spheres of the deeper flesh
  // tone sunk just under the skin, so they read as soft dents at the size this
  // fruit is actually seen and vanish politely when it is smaller than that.
  for (const spin of [0.4, 1.9]) {
    const crease = ball(0.99, C_FRUIT_DEEP, 2)
    crease.scale.set(1, 0.86, 0.05)
    crease.rotation.y = spin
    g.add(crease)
  }

  if (odd) {
    /*
     * The veining. Seven short streaks, each a thin sliver of gold sitting a
     * hair proud of the skin, scattered by the variant's own rng so no two odd
     * fruit carry the same map — and crucially never evenly spaced, because
     * even spacing is the one thing that would make this read as a cage.
     *
     * Weighted to the upper hemisphere: gold on the shoulders catches the dawn
     * key, and gold on the underside is invisible from any camera the player
     * will ever have.
     */
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2
      const lift = 0.1 + r() * 0.78
      const ring = Math.sqrt(Math.max(0.05, 1 - lift * lift))
      const normal = new THREE.Vector3(Math.cos(a) * ring, lift, Math.sin(a) * ring).normalize()

      /*
       * Each vein is a sliver laid FLAT ON the skin, not stuck through it.
       * The quaternion takes the sliver's local +Y onto the surface normal, so
       * its thin axis is the radial one and its length lies in the tangent
       * plane; a second spin about that normal points it any which way. Sunk to
       * 0.94 of the radius, it breaks the surface as a streak and its ends
       * disappear back under the skin, which is the whole difference between a
       * vein and a gold thorn.
       */
      const orient = new THREE.Quaternion().setFromUnitVectors(up, normal)
      orient.multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * Math.PI * 2))

      // Two segments, kinked: one long, one short off its end at an angle. A
      // straight streak reads as a machined line; the kink reads as growth.
      const len = 0.52 + r() * 0.5
      const main = ball(0.5, LOTTO_GOLD, 1)
      main.scale.set(0.1 + r() * 0.04, 0.12, len)
      main.position.copy(normal).multiplyScalar(0.92)
      main.quaternion.copy(orient)
      g.add(main)

      if (r() < 0.6) {
        const kink = ball(0.5, LOTTO_GOLD, 1)
        kink.scale.set(0.085, 0.12, len * 0.55)
        kink.position.copy(normal).multiplyScalar(0.92)
        kink.quaternion
          .copy(orient)
          .multiply(new THREE.Quaternion().setFromAxisAngle(up, 0.7 + r() * 0.5))
        // Shifted along its own new heading so it hangs off the main streak's
        // end rather than crossing it at the middle.
        kink.position.addScaledVector(
          new THREE.Vector3(0, 0, len * 0.3).applyQuaternion(kink.quaternion),
          1,
        )
        g.add(kink)
      }
    }
  }

  // Calyx: five sepals folded down over the shoulders, plus the cut stub. The
  // star is the other half of the tomato read, and it is what keeps a
  // gold-streaked fruit legible as the *same species* as its neighbours.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const sepal = ball(0.5, C_STEM, 1)
    sepal.scale.set(0.34, 0.1, 0.8)
    sepal.position.set(Math.cos(a) * 0.34, 0.74, Math.sin(a) * 0.34)
    sepal.rotation.order = 'YXZ'
    sepal.rotation.set(0.42, -a + Math.PI / 2, 0)
    g.add(sepal)
  }
  const stub = cyl(0.12, 0.17, 0.3, C_STEM_DARK, 6)
  stub.position.y = 0.9
  g.add(stub)

  return g
}

const fruitCache = new Map<string, THREE.BufferGeometry>()
/** Vertex-colour material shared by every baked part in this file. */
const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })

/** Distinct vein maps baked for the odd fruit. Four is enough that no two
 *  fruit on the one odd plant are twins, and it costs four geometries. */
const ODD_VEIN_MAPS = 4

function fruitGeometry(odd: boolean, variant = 0) {
  const key = odd ? `odd|${variant % ODD_VEIN_MAPS}` : 'ordinary'
  let geo = fruitCache.get(key)
  if (!geo) {
    geo = bakeGroup(buildFruitBody(odd, rng((variant + 3) * 0x2545f491 + 17)))
    fruitCache.set(key, geo)
  }
  return geo
}

/**
 * One fruit, sized and hung.
 *
 * Two meshes: the baked body, and an unlit sheen cap. The cap is the whole of
 * the "slight specular sheen" the spec asks for — the game renders Lambert
 * everywhere on purpose (no specular, no hotspots), so a real highlight would
 * be the only shiny thing in the world. A painted one costs nothing, always
 * faces the same way as the dawn key, and is the same trick the rest of the
 * stylised set uses.
 */
const sheenGeo = new THREE.IcosahedronGeometry(0.26, 1)
const sheenMaterial = new THREE.MeshBasicMaterial({
  color: C_SHEEN,
  transparent: true,
  // Low. At 0.34 it read as a sticker stuck on the fruit rather than as light
  // on wet skin — the highlight has to let the red through.
  opacity: 0.24,
  depthWrite: false,
})

function createFruit(radius: number, odd: boolean, variant = 0) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(fruitGeometry(odd, variant), bakedMaterial)
  body.castShadow = true
  body.receiveShadow = true
  body.scale.setScalar(radius)
  g.add(body)

  const sheen = new THREE.Mesh(sheenGeo, sheenMaterial)
  sheen.scale.set(radius * 1.15, radius * 0.55, radius * 0.9)
  // Up and toward the sea, which is where the dawn light comes from.
  sheen.position.set(-radius * 0.4, radius * 0.48, radius * 0.42)
  g.add(sheen)

  return g
}

// --- the plant ---------------------------------------------------------------

interface BuiltBody {
  group: THREE.Group
  anchors: Anchor[]
}

/**
 * Build one state's foliage, plus the anchors its fruit will hang from.
 *
 * Everything here is baked, so it may be as many small meshes as the shape
 * wants: a ripe bush is about seventy leaflets and comes out of the bake as one
 * draw call. The fruit stays loose, because it is scaled per plant and the odd
 * one animates.
 */
function buildBody(state: SunTomatoState, r: () => number): BuiltBody {
  const g = new THREE.Group()
  const h = HEIGHT[state]
  const anchors: Anchor[] = []

  if (state === 'sprout') {
    /*
     * Two seed-leaves and one true leaf. Flat and wide rather than tall — a
     * seedling that stands upright reads as a small version of the adult, and
     * then the player cannot tell stage 0 from stage 1 at a glance.
     */
    collar(g, 0.14)
    const stem = cyl(0.017, 0.026, h * 0.6, C_STEM, 5)
    stem.position.y = h * 0.3
    g.add(stem)

    /*
     * The seed-leaves are wide for the plant's height on purpose. At progress
     * zero the farm's growth ramp scales this whole thing to 0.32, so anything
     * delicate here is sub-pixel in the bed and the player who just planted six
     * seeds sees six empty holes. Wide and pale is what survives the ramp.
     */
    for (const side of [-1, 1]) {
      const seedLeaf = ball(0.5, C_LEAF_LIGHT, 1)
      seedLeaf.scale.set(0.09, 0.028, 0.2)
      seedLeaf.position.set(side * 0.13, h * 0.58, 0)
      seedLeaf.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
      g.add(seedLeaf)
    }
    const first = broadLeaf(0.19, C_LEAF, 0.5, r() * Math.PI * 2, r)
    first.position.y = h * 0.8
    g.add(first)
    return { group: g, anchors }
  }

  // --- everything from 'vine' up shares one armature ------------------------
  collar(g, 0.26)

  /*
   * A short thick trunk, and that is all the vertical there is.
   *
   * The crown sits low — a third of the plant's height — and everything above
   * it is leaf held out sideways. The previous armature ran a stem to 74% of
   * the height and hung four tiers off it, which is a shrub trained up a stake;
   * nobody staked this one.
   */
  const stemTop = h * (state === 'vine' ? 0.5 : 0.34)
  const stem = cyl(0.03, 0.055, stemTop, C_STEM, 6)
  stem.position.y = stemTop / 2
  stem.rotation.z = (r() - 0.5) * 0.08
  g.add(stem)

  /** Half-width of the leaf mass. Wider than the plant is tall — the read. */
  const spread = h * SPREAD * 0.5

  if (state === 'vine') {
    /*
     * The young sprawl: two runners already flopping outward off a short stem,
     * with the leaves broad from the start. Open, gappy, obviously unfinished —
     * the gaps are what make the next stage's fill read as *bulking up* rather
     * than as merely getting taller.
     */
    for (let i = 0; i < 2; i++) {
      const a = r() * Math.PI * 2 + i * Math.PI
      const len = h * 0.5
      const runner = cyl(0.014, 0.026, len, C_STEM, 5)
      runner.position.set(Math.cos(a) * len * 0.3, stemTop * 0.85, Math.sin(a) * len * 0.3)
      runner.rotation.order = 'YXZ'
      runner.rotation.set(0, -a, 0.95)
      g.add(runner)
    }
    leafTier(g, 4, stemTop * 0.75, spread * 0.62, C_LEAF, 0.08, r)
    leafTier(g, 3, stemTop * 1.05, spread * 0.5, C_LEAF_LIGHT, 0.3, r)
    return { group: g, anchors }
  }

  /*
   * The sprawl: three rings of broad leaves off a low crown, the outer ring
   * held BELOW horizontal so the mass tips down toward the soil at its edge —
   * a parasol collapsing under its own weight, which is what an unstaked
   * tomato looks like once it is carrying fruit.
   *
   * Held inside its tile: beds are TILE_SIZE 1.2 apart, so the mass tops out a
   * shade over a unit across. Past that, six plants merge into one hedge and
   * every fruit is buried in a neighbour.
   */
  const crown = h * 0.36

  /*
   * A dark mass buried in the middle of the plant.
   *
   * Not meant to be seen — it exists so the rings do not show sky through the
   * centre. Without it a procedural plant is a hollow shell of leaves and the
   * silhouette breaks into flecks at any distance. The crop pipeline learned
   * this the same way.
   */
  const core = ball(h * 0.2, C_LEAF_DARK, 1)
  core.scale.set(1.25, 0.62, 1.25)
  core.position.y = crown
  g.add(core)

  // Outer ring drooping, middle ring level, a small crown tuft on top: low,
  // wide, and rounded off rather than pointed.
  leafTier(g, 8, crown * 0.82, spread, C_LEAF_DARK, -0.24, r)
  leafTier(g, 7, crown * 1.12, spread * 0.86, C_LEAF, 0.02, r)
  leafTier(g, 5, crown * 1.5, spread * 0.6, C_LEAF_LIGHT, 0.3, r)

  if (state === 'flowering') {
    // Six flowers on short sprays out along the leaf line. Scattered, never
    // ringed — a ring would read as decoration rather than as growth.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r() * 0.6
      const rad = spread * (0.45 + r() * 0.3)
      const y = crown * (0.9 + r() * 0.7)
      const spray = cyl(0.006, 0.009, 0.09, C_STEM, 4)
      spray.position.set(Math.cos(a) * rad * 0.8, y - 0.03, Math.sin(a) * rad * 0.8)
      spray.rotation.z = Math.cos(a) * 0.5
      g.add(spray)
      const flower = starFlower(0.095, r)
      flower.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad)
      flower.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5)
      g.add(flower)
    }
    return { group: g, anchors }
  }

  /*
   * Fruiting and odd hang the same truss.
   *
   * The odd plant is not a different arrangement — it is this one grown 1.42×
   * with gold in the skin (see ODD_SCALE). Giving it a bespoke silhouette was
   * the last pass's mistake: a single jackpot fruit on a stalk above the crown
   * read as a *prop*, a slot machine planted in a bed, and the player learns
   * "the game put a thing there" instead of "one of my six came up wrong".
   *
   * Fruit rests OUT on the rim at the leaf line, low — that is where a truss
   * on a flopped vine actually sits, it is where a hand would reach, and from
   * the game's low camera it is the difference between red on the silhouette
   * and red buried in green.
   */
  const count = FRUIT_COUNT[Math.floor(r() * FRUIT_COUNT.length)] ?? 4
  const phase = r() * Math.PI * 2
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.4
    const rad = spread * (0.6 + r() * 0.2)
    const y = crown * (0.5 + r() * 0.42)
    const pos = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)

    // A short pedicel arcing down out of the crown to the fruit's shoulder.
    // Kept stubby and tucked inside the leaf mass: a long one pokes out past
    // the fruit and the plant sprouts green spikes.
    const pedicel = cyl(0.011, 0.017, h * 0.12, C_STEM, 5)
    pedicel.position.set(pos.x * 0.74, y + h * 0.1, pos.z * 0.74)
    pedicel.rotation.order = 'YXZ'
    pedicel.rotation.set(0, -a, -0.7)
    g.add(pedicel)

    anchors.push({ pos, yaw: a, tilt: (r() - 0.5) * 0.3 })
  }

  return { group: g, anchors }
}

interface BakedState {
  geometry: THREE.BufferGeometry
  anchors: Anchor[]
}

const bodyCache = new Map<string, BakedState>()

function bakedBody(state: SunTomatoState, variant: number): BakedState {
  const key = `${state}|${variant}`
  let entry = bodyCache.get(key)
  if (!entry) {
    const built = buildBody(state, rng((variant + 1) * 0x9e3779b1 + state.length * 977))
    entry = { geometry: bakeGroup(built.group), anchors: built.anchors }
    bodyCache.set(key, entry)
  }
  return entry
}

/** Seconds per shimmer breath on the odd fruit. Slow enough to be doubted. */
const SHIMMER_PERIOD = 2.2

/**
 * Build a Sun Tomato in one of its five states.
 *
 * Authored at final size for that state, origin on the soil, ready to drop into
 * a bed. Callers that go through the farm want `createSunTomatoModel` instead —
 * this is the direct handle, for the model gallery, the crate's stamped pouch
 * art and anything else that wants a plant without a tile under it.
 */
export function createSunTomato(state: SunTomatoState): THREE.Group {
  return buildPlant(state, 1, 1, null)
}

function buildPlant(
  state: SunTomatoState,
  variant: number,
  girth: number,
  r: (() => number) | null,
): THREE.Group {
  const group = new THREE.Group()
  const body = bakedBody(state, variant % VARIANTS)

  const foliage = new THREE.Mesh(body.geometry, bakedMaterial)
  foliage.castShadow = true
  foliage.receiveShadow = true
  group.add(foliage)

  const odd = state === 'odd'
  const radius = odd ? R_ODD : R_FRUIT
  // Per-plant fruit size lottery, small: the *weight* roll is the game's
  // jackpot channel and this must not pre-empt it.
  const jitter = r ? 0.92 + r() * 0.16 : 1

  const shimmerMats: THREE.MeshBasicMaterial[] = []
  for (const [i, anchor] of body.anchors.entries()) {
    const fruit = createFruit(radius * jitter, odd, i + variant)
    fruit.position.copy(anchor.pos)
    fruit.rotation.order = 'YXZ'
    fruit.rotation.y = anchor.yaw
    fruit.rotation.x = anchor.tilt
    group.add(fruit)

    if (odd) {
      /*
       * The odd plant's standing shimmer: an additive gold shell on each fruit
       * breathing just above zero. Deliberately *not* the lotto tell — that is
       * a burst fired once on the pick (assets/opening/vfx.ts); this is the
       * quiet hint that draws the eye down the bed before anything fires at
       * all. Low amplitude on purpose: past ~0.14 the fruit becomes a lamp, and
       * a lamp is a marker, not a plant.
       */
      const glowMat = new THREE.MeshBasicMaterial({
        color: LOTTO_GOLD,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * jitter * 1.14, 2), glowMat)
      glow.scale.set(1, 0.9, 1)
      fruit.add(glow)
      shimmerMats.push(glowMat)
    }
  }

  if (shimmerMats.length) {
    group.userData.update = (elapsed: number) => {
      for (const [i, m] of shimmerMats.entries()) {
        // Each fruit breathes on its own offset, so the plant glimmers rather
        // than pulsing as one block — an even pulse reads as a UI element.
        const t = (Math.sin((elapsed / SHIMMER_PERIOD + i * 0.17) * Math.PI * 2) + 1) / 2
        // Squared, so it dwells dim and swells briefly.
        m.opacity = 0.03 + 0.09 * t * t
      }
    }
  }

  group.scale.setScalar(girth)
  // The two fields farm.ts's applyCropScale reads. `stretch` is the plant's
  // local height, so `girth × stretch` is its true reach and the MAX_CROP_SCALE
  // clamp measures the axis that actually gets there.
  group.userData.baseScale = group.scale.clone()
  group.userData.stretch = HEIGHT[state]

  if (r) {
    group.rotation.y = r() * Math.PI * 2
    // A little lean, so a bed of six was not planted with a ruler.
    group.rotation.z = (r() - 0.5) * 0.1
    group.rotation.x = (r() - 0.5) * 0.1
  }

  return group
}

/**
 * Which state a farm growth stage shows.
 *
 * Four stages, five states: 'odd' is not a stage, it is what ripeness looks
 * like when the rarity roll came up gold. The opening scripts exactly one of
 * those (`farm.plantScripted(tile, 'sun-tomato', 'gold')`), and common rarity
 * carries a null tint — so a non-null `rarityColor` at full ripeness *is* the
 * odd one, with no extra plumbing.
 */
export function sunTomatoStateForStage(stage: number, rarityColor?: number | null): SunTomatoState {
  if (stage >= 3) return rarityColor != null ? 'odd' : 'fruiting'
  if (stage >= 2) return 'flowering'
  if (stage >= 1) return 'vine'
  return 'sprout'
}

/**
 * The farm-pipeline entry point — same shape as `createCropModel(def, stage,
 * opts)`, minus the def, because this species is its own def.
 *
 * `game/farm.ts` `buildCropModel` is the one seam every planted model passes
 * through, and it already interposes there for the mystery sprout. This is the
 * matching call for `'sun-tomato'`; everything downstream — tile state, growth
 * scaling, the ripe bob, save/restore, the harvest exit — then treats the plant
 * as an ordinary crop, which is the point.
 */
export function createSunTomatoModel(stage: number, opts: CropModelOptions = {}): THREE.Group {
  const r = rng((opts.seed ?? 1) * 2654435761)
  const variant = Math.floor(r() * VARIANTS)
  // Drawn before anything else consumes the stream, so a plant keeps its girth
  // across a stage rebuild — the same ordering trap assets/crops.ts documents.
  const girth = 0.98 + r() * 0.2
  return buildPlant(sunTomatoStateForStage(stage, opts.rarityColor), variant, girth, r)
}
