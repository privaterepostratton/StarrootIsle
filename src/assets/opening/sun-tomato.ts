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
 *   vine      — leggy: a bare stem with two sparse tiers. Open silhouette.
 *   flowering — filled out, speckled with small pale-yellow star flowers.
 *   fruiting  — plump bush, 3–5 ribbed red fruit hanging on the *outside*.
 *   odd       — ONE oversized gold-streaked fruit riding proud above the crown.
 *
 * The five are meant to be told apart from the game camera by silhouette alone:
 * flat cross → open V → dense dome → dense dome with red spots on its rim →
 * dome with one big thing on a stalk above it. Colour is the confirmation, not
 * the read.
 *
 * Reserved-colour discipline (opening contract rule 4)
 * ---------------------------------------------------
 * LOTTO_GOLD (#f2c14e) appears on the 'odd' state and nowhere else in this
 * file — it is the first gold the player ever sees and it must mean luck. The
 * flowering state's petals are deliberately a pale primrose (#eedd88), far
 * enough from lotto gold in both hue and saturation to survive the automated
 * colour scan the verify plan runs over beats 1–7. The odd fruit stays mostly
 * red: four gold meridians and a shoulder streak over a deep tomato body, never
 * a gold ball, because "the wrong one" has to still be recognisably a tomato.
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
 * Authored height per state, in local units before the per-plant girth.
 *
 * The avatar is ~1.7 units. A ripe bush at 1.18 × ~1.08 girth lands near 1.27:
 * chest-high on the player, proud in a 1.2-unit bed, and still short enough
 * that six of them do not wall off the camera. The odd plant is deliberately
 * the tallest tomato in the bed before its fruit is even counted.
 */
const HEIGHT: Record<SunTomatoState, number> = {
  sprout: 0.5,
  vine: 0.78,
  flowering: 1.02,
  fruiting: 1.18,
  odd: 1.34,
}

/** Ordinary fruit radius. 0.155 × 2 is a quarter of a tile — the smallest
 *  thing that still reads as pluckable from the default camera height. */
const R_FRUIT = 0.155
/** The odd fruit. Not double, but obviously wrong beside its neighbours. */
const R_ODD = 0.27

/** Foliage variants, matching the crop pipeline's own count. Three is enough
 *  that no two plants in a bed of six are twins. */
const VARIANTS = 3

/** How many fruit each variant hangs, inside the spec's 3–5. */
const FRUIT_COUNT = [4, 5, 3]

// --- small builders ----------------------------------------------------------

/**
 * One leaflet: a squashed sphere, long in Z, thin in Y.
 *
 * Local to this file rather than borrowed from the crop pipeline's leaf pad,
 * because a tomato leaf is *compound* — a rachis carrying paired leaflets — and
 * that ragged, many-lobed edge is most of what tells the plant apart from every
 * round-leaved bush in the game at silhouette distance.
 */
function leaflet(len: number, width: number, color: number) {
  const m = ball(0.5, color, 1)
  m.scale.set(width, len * 0.11, len)
  return m
}

/**
 * A compound leaf lying along +Z, hinged at its origin.
 *
 * `tilt` lifts it out of the horizontal (positive = held up), `spin` yaws it
 * around the stem. Built in the YXZ order so the lift happens in the yawed
 * frame — otherwise every leaf tips toward world +Z regardless of which side of
 * the plant it grows on, which is the mistake that makes procedural foliage
 * look combed.
 */
function compoundLeaf(len: number, color: number, tilt: number, spin: number, r: () => number) {
  const g = new THREE.Group()

  const rachis = cyl(0.008, 0.013, len, C_STEM, 5)
  rachis.rotation.x = Math.PI / 2
  rachis.position.z = len / 2
  g.add(rachis)

  /*
   * Three opposed pairs down the rachis, shrinking outward, plus a terminal
   * leaflet — the real leaf's arrangement, and the shrink is what keeps the
   * outline tapered instead of paddle-shaped.
   *
   * The leaflets are broad. The first pass drew them at less than half this
   * width and the bush came out a wire armature with confetti on it: from the
   * game camera the plant read as sticks, and sticks do not say *plump*. Leaf
   * mass is what makes a tomato plant look like it is feeding something.
   */
  for (let i = 0; i < 3; i++) {
    const t = 0.28 + i * 0.26
    const scale = 1 - i * 0.13
    for (const side of [-1, 1]) {
      const lf = leaflet(len * 0.46 * scale, len * 0.3 * scale, i % 2 ? color : C_LEAF_DARK)
      lf.position.set(side * len * 0.16 * scale, 0, len * t)
      lf.rotation.y = side * (0.72 + r() * 0.18)
      g.add(lf)
    }
  }
  const tip = leaflet(len * 0.5, len * 0.34, color)
  tip.position.z = len * 0.9
  g.add(tip)

  g.rotation.order = 'YXZ'
  g.rotation.set(-tilt, spin, 0)
  return g
}

/** A ring of compound leaves around the stem at one height. */
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
    const spin = phase + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.3
    const leaf = compoundLeaf(len * (0.85 + r() * 0.3), color, tilt + (r() - 0.5) * 0.3, spin, r)
    // Generous vertical scatter: tiers placed on exact rings read as a stack of
    // discs, and the gaps between them are where the sky gets through.
    leaf.position.y = y + (r() - 0.5) * 0.11
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
 * Ribbed rather than round: five meridians cut into a squashed globe. That
 * profile is what says *tomato* at fifteen pixels — a smooth sphere at this
 * size reads as a berry, and we already have five berries in the crop table.
 *
 * The odd fruit is the same shape with four of its meridians in lotto gold and
 * one gold streak across the shoulder. Same silhouette, wrong metal.
 */
function buildFruitBody(odd: boolean) {
  const g = new THREE.Group()

  // The odd fruit's flesh is a shade deeper, so the gold on it has somewhere
  // dark to sit. Gold on bright red is two loud colours fighting; gold on deep
  // red is metal in fruit.
  const flesh = ball(1, odd ? C_FRUIT_DEEP : C_FRUIT, 2)
  flesh.scale.set(1, 0.84, 1)
  g.add(flesh)

  // Shaded belly: a second globe pushed down and in, showing only as the
  // darker underside. Cheaper than a gradient and reads at any angle.
  const belly = ball(0.94, odd ? 0x7d2418 : C_FRUIT_DEEP, 1)
  belly.scale.set(1, 0.7, 1)
  belly.position.y = -0.16
  g.add(belly)

  /*
   * Meridian ribs. A sphere flattened to a wafer, concentric with the flesh:
   * it shows only as a great-circle ridge, which costs one mesh instead of a
   * torus.
   *
   * On the odd fruit these are the lotto gold, and they stand *proud* of the
   * skin (radius past 1). Thin gold hairlines disappeared into the ribbing at
   * the size this fruit is actually seen — and this is the first gold in the
   * entire game, the moment that teaches the player what gold means, so it has
   * to be unmistakable from across the bed.
   *
   * The budget is deliberate and was tuned by eye against the rule that this
   * fruit is *streaked*, never gilded: three ridges plus two short shoulder
   * breaks, over a deep red globe, is roughly a quarter of the surface. A first
   * pass with thicker ridges and a full crown cap came out a gold pumpkin with
   * red seams — the red has to stay the fruit's colour, or the player learns
   * that gold means "a different crop" instead of "you got lucky".
   */
  const ribCount = odd ? 3 : 5
  for (let i = 0; i < ribCount; i++) {
    const rib = ball(odd ? 1.05 : 1.01, odd ? LOTTO_GOLD : C_FRUIT_DEEP, 2)
    rib.scale.set(1, 0.85, odd ? 0.1 : 0.055)
    rib.rotation.y = (i / ribCount) * Math.PI
    g.add(rib)
  }

  if (odd) {
    // Two broken streaks off the shoulders, so the gold looks like it grew out
    // through the skin rather than like a decal ring painted on.
    for (const [x, y, z, spin] of [
      [0.46, 0.42, 0.56, 0.7],
      [-0.58, 0.2, -0.4, -1.9],
    ]) {
      const streak = ball(0.42, LOTTO_GOLD, 1)
      streak.scale.set(1, 0.3, 0.46)
      streak.position.set(x, y, z)
      streak.rotation.set(0.4, spin, -0.5)
      g.add(streak)
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

function fruitGeometry(odd: boolean) {
  const key = odd ? 'odd' : 'ordinary'
  let geo = fruitCache.get(key)
  if (!geo) {
    geo = bakeGroup(buildFruitBody(odd))
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

function createFruit(radius: number, odd: boolean) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(fruitGeometry(odd), bakedMaterial)
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
    const first = compoundLeaf(0.19, C_LEAF, 0.5, r() * Math.PI * 2, r)
    first.position.y = h * 0.8
    g.add(first)
    return { group: g, anchors }
  }

  // --- everything from 'vine' up shares one armature ------------------------
  collar(g, 0.26)

  const stemTop = h * (state === 'vine' ? 0.86 : 0.74)
  const stem = cyl(0.022, 0.045, stemTop, C_STEM, 6)
  stem.position.y = stemTop / 2
  stem.rotation.z = (r() - 0.5) * 0.06
  g.add(stem)

  if (state !== 'vine') {
    // Two side branches, which is what turns a stem into a bush. Their tips are
    // where the outer fruit hangs, so they earn their keep twice.
    for (let i = 0; i < 2; i++) {
      const a = r() * Math.PI * 2 + i * Math.PI
      const len = h * 0.42
      const branch = cyl(0.014, 0.024, len, C_STEM, 5)
      branch.position.set(Math.cos(a) * len * 0.28, h * 0.42, Math.sin(a) * len * 0.28)
      branch.rotation.order = 'YXZ'
      branch.rotation.set(0, -a, 0.62)
      g.add(branch)
    }
  }

  if (state === 'vine') {
    /*
     * Leggy on purpose: two sparse tiers with bare stem showing between them.
     * The gap is the whole silhouette — it is what makes the next stage's fill
     * read as the plant *bulking up* rather than merely getting taller.
     */
    leafTier(g, 5, h * 0.34, 0.26, C_LEAF, 0.2, r)
    leafTier(g, 4, h * 0.7, 0.22, C_LEAF_LIGHT, 0.44, r)
    return { group: g, anchors }
  }

  /*
   * Dense dome. Four tiers, widest low, tightening and lifting toward the
   * crown — the shape of a staked tomato in a Mediterranean kitchen garden.
   *
   * Held inside a tile: beds are TILE_SIZE 1.2 apart, so a bush wider than
   * about 1.0 world units starts growing through its neighbour and the six
   * beds merge into one hedge with the fruit buried inside it. The lowest tier
   * is also lifted clear of the soil — leaves lying in the dirt z-fight the
   * plot decal, and a plant that touches the ground reads as a weed.
   */
  const lush = state === 'odd' ? 1.06 : 1

  /*
   * A dark mass buried in the middle of the plant.
   *
   * Not meant to be seen — it exists so the tiers do not show sky through the
   * centre of the bush. Without it a procedural plant is a hollow shell of
   * leaves and the silhouette breaks up into flecks at any distance. The crop
   * pipeline learned this the same way.
   */
  const core = ball(h * 0.115, C_LEAF_DARK, 1)
  core.scale.set(1.2, 0.85, 1.2)
  core.position.y = h * 0.44
  g.add(core)

  // The crown tier is held nearly as flat as the ones below it. Lifting it
  // steeply turned the plant into a spire — a conifer, not a tomato bush; the
  // shape wanted here is a dome that rounds off, so the top leaves fold over
  // rather than point at the sky.
  leafTier(g, 7, h * 0.22, 0.37 * lush, C_LEAF_DARK, 0.16, r)
  leafTier(g, 8, h * 0.4, 0.39 * lush, C_LEAF, 0.26, r)
  leafTier(g, 7, h * 0.63, 0.35 * lush, C_LEAF, 0.4, r)
  leafTier(g, 6, h * 0.84, 0.29 * lush, C_LEAF_LIGHT, 0.48, r)

  if (state === 'flowering') {
    // Six flowers on short sprays around the upper half. Scattered, never
    // ringed — a ring would read as decoration rather than as growth.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r() * 0.6
      const rad = 0.2 + r() * 0.12
      const y = h * (0.45 + r() * 0.4)
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

  // --- fruiting and odd: hang the pedicels, record the anchors --------------
  if (state === 'odd') {
    /*
     * One fruit, and it rides above the crown.
     *
     * The spec's whole ask for this plant is that the player's eye finds it
     * without being told. Height does that: five neighbours carry their fruit
     * on the rim at chest height, and this one holds a single bigger fruit up
     * where nothing else is, on a stalk visibly bowed under it.
     */
    const a = r() * Math.PI * 2
    const rad = 0.13
    const y = h * 0.78
    const pos = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)

    // A thick arching pedicel from the crown out to the fruit, bent by the
    // weight — the bow is the tell that this fruit is heavier than it should be.
    const arch = cyl(0.018, 0.028, 0.26, C_STEM, 6)
    arch.position.set(pos.x * 0.5, y - 0.13, pos.z * 0.5)
    arch.rotation.order = 'YXZ'
    arch.rotation.set(0, -a, -0.32)
    g.add(arch)

    // One late flower left on the crown, so the plant still reads as alive
    // rather than as a prop holding a jackpot.
    const flower = starFlower(0.07, r)
    flower.position.set(-Math.cos(a) * 0.16, h * 0.6, -Math.sin(a) * 0.16)
    flower.rotation.set(0.3, r() * 3, 0.2)
    g.add(flower)

    anchors.push({ pos, yaw: a, tilt: 0.08 })
    return { group: g, anchors }
  }

  const count = FRUIT_COUNT[Math.floor(r() * FRUIT_COUNT.length)] ?? 4
  const phase = r() * Math.PI * 2
  for (let i = 0; i < count; i++) {
    /*
     * Fruit hangs on the OUTSIDE of the bush, at the leaf line, not inside it.
     * That is where a real truss sits, it is where a hand would reach, and at
     * this camera it is the difference between four red dots on a silhouette
     * and four red dots buried in green.
     */
    const a = phase + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.4
    const high = i === count - 1
    const rad = high ? 0.24 : 0.34 + r() * 0.05
    const y = high ? h * 0.66 : h * (0.3 + r() * 0.18)
    const pos = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)

    const pedicel = cyl(0.009, 0.014, 0.13, C_STEM, 5)
    pedicel.position.set(pos.x * 0.72, y + 0.11, pos.z * 0.72)
    pedicel.rotation.order = 'YXZ'
    pedicel.rotation.set(0, -a, -0.5)
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

  for (const anchor of body.anchors) {
    const fruit = createFruit(radius * jitter, odd)
    fruit.position.copy(anchor.pos)
    fruit.rotation.order = 'YXZ'
    fruit.rotation.y = anchor.yaw
    fruit.rotation.x = anchor.tilt
    group.add(fruit)

    if (odd) {
      /*
       * The odd fruit's own faint shimmer: an additive gold shell breathing
       * just above zero. Deliberately *not* the lotto tell — that is a burst
       * fired once on the pick (assets/opening/vfx.ts), and this is the standing
       * hint that draws the eye to the bed before anything fires at all. Kept
       * under 0.15 opacity so it never turns the fruit into a lamp.
       */
      const glowMat = new THREE.MeshBasicMaterial({
        color: LOTTO_GOLD,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * jitter * 1.16, 2), glowMat)
      glow.scale.set(1, 0.86, 1)
      fruit.add(glow)

      group.userData.update = (elapsed: number) => {
        const t = (Math.sin((elapsed / SHIMMER_PERIOD) * Math.PI * 2) + 1) / 2
        // Squared, so it dwells dim and swells briefly rather than pulsing
        // evenly — an even pulse reads as a UI marker, not as a shimmer.
        glowMat.opacity = 0.035 + 0.1 * t * t
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
