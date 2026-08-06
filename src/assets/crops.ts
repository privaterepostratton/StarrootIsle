import * as THREE from 'three'
import { mat, ball, cyl, rng, PALETTE } from './style'
import { bakeGroup } from './bake'
import { cropDetailMap } from './crop-textures'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { peekModels, type LoadedModel } from './models'
import type { CropDef, FruitKind } from '../game/crops'
import { GROWTH_STAGES } from '../game/crops'

/**
 * Procedural crop models.
 *
 * Two things are being balanced here.
 *
 * *Readability*: every crop shares a silhouette language so ripeness reads at a
 * glance from the isometric angle —
 *   stage 0  a seedling: two small leaves, no fruit
 *   stage 1  the plant's full foliage mass, no fruit
 *   stage 2  foliage plus small, pale, unripe fruit
 *   stage 3  foliage plus fruit at full size and full colour — "harvest me"
 * `form` decides how that foliage is massed, and there are only six forms.
 *
 * *Identity*: five of the eighteen crops are bushes, so form alone leaves them
 * as recolours of one another. Each species therefore grows its own `fruit`
 * shape (see FruitKind) — a carrot's tapered root, a pumpkin's ribbed dome, a
 * starfruit's five ridges. The fruit is the part the player looks at, so that is
 * where the per-species detail is spent.
 *
 * The look is Animal Crossing: broad, cupped, slightly drooping leaf pads rather
 * than thin blades, chunky stems, and fruit large enough relative to the plant
 * to be the focal point. Leaves radiate from the base as a rosette, which is
 * what makes a young plant read as a plant rather than as a green smudge.
 */

// --- leaves ------------------------------------------------------------------

/**
 * One unit-sized leaf pad, shared by every leaf in the game.
 *
 * Built once and scaled per use: a sphere flattened into a blade, pinched at
 * both the stem and the tip so it reads as a leaf rather than a lens, then
 * cupped by lifting the edges above the midrib. The origin sits at the stem end
 * so a rotation about X pivots the leaf at its base, which is what lets the
 * rosettes below droop convincingly.
 */
const LEAF_PAD_GEO = (() => {
  const geo = new THREE.SphereGeometry(0.5, 9, 5)
  const p = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute

  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i)
    const y0 = p.getY(i)
    const z0 = p.getZ(i)

    // 0 at the stem, 1 at the tip. Narrow at the stem, widest about a third
    // along, and *rounded* rather than pointed at the tip — the square root is
    // what does that. A profile that tapers to a point gives spearheads, and a
    // rosette of spearheads reads as folded paper, not as a plant.
    const t = z0 + 0.5
    const width = Math.sqrt(Math.sin(Math.PI * Math.pow(t, 0.62)))
    // Deliberately well under 1: a pad wider than it is long stops reading as a
    // leaf, which is exactly what happens if this multiplier creeps up.
    const x = x0 * width * 0.52

    p.setX(i, x)
    /*
     * Flatten, lift the edges to cup the blade — gently, or the fold becomes the
     * silhouette instead of the blade — and drop the centre line so the fold has
     * a spine to run either side of.
     *
     * That dip is the midrib, and it is geometry rather than a painted line on
     * purpose: crop foliage bakes down to one mesh with one material, so any vein
     * drawn into the shared map would also be stretched over every stem and
     * collar merged alongside it. A crease catches the light on its own.
     */
    const spine = Math.exp(-(x * x) / 0.004) * 0.055
    p.setY(i, y0 * 0.2 + Math.abs(x) * 0.12 - spine)

    /*
     * Planar UVs across the blade, replacing the sphere's own.
     *
     * The detail map has to run *along* the leaf to look like a leaf; sampled
     * through spherical coordinates it wraps round the pad's rim and pinches to
     * nothing at the poles, which reads as a smudge at the tip. Length is
     * repeated twice so a small leaf still gets some grain.
     */
    uv.setXY(i, x0 * 0.5 + 0.5, t * 2)
  }

  geo.translate(0, 0, 0.5)
  geo.computeVertexNormals()
  return geo
})()

/**
 * A leaf. `len` is its length in world units, `tilt` how far it lifts from
 * horizontal, `spin` which way it points.
 */
function leafPad(len: number, color: number, tilt: number, spin: number, width = 1) {
  const m = new THREE.Mesh(LEAF_PAD_GEO, mat(color))
  m.castShadow = true
  m.receiveShadow = true
  m.scale.set(len * width, len, len)
  m.rotation.order = 'YXZ'
  m.rotation.set(-tilt, spin, 0)
  return m
}

/**
 * A paler version of a colour, for the inner ring of a rosette.
 *
 * Derived from the leaf's own colour rather than taken from the palette's green,
 * because one crop's foliage is not green: the moonbloom's leaves are navy, and
 * a hard-coded `leafLight` put bright green leaves in the middle of them.
 */
/*
 * Mixed on the raw sRGB bytes, deliberately, rather than through Color.lerp.
 *
 * three does its colour maths in *linear* space, so `Color.lerp(WHITE, 0.2)`
 * moves a fifth of the way to white in linear terms — which is very nearly half
 * way in the sRGB the value was authored in. Every call here was coming out far
 * paler than its number suggests, and it only became obvious on the tree crowns,
 * where a sunlit green lobe rendered as grey-white. Bytes in, bytes out: 0.2
 * means a fifth as far as anyone reading the call site would expect.
 */
function mix(color: number, target: number, amount: number) {
  const a = Math.max(0, Math.min(1, amount))
  let out = 0
  for (let shift = 16; shift >= 0; shift -= 8) {
    const from = (color >> shift) & 0xff
    const to = (target >> shift) & 0xff
    out |= Math.round(from + (to - from) * a) << shift
  }
  return out
}

function lighten(color: number, amount = 0.22) {
  return mix(color, 0xffffff, amount)
}

/**
 * The other direction, toward black.
 *
 * Its own function rather than `lighten` with a negative amount, which is what
 * this replaced: a negative alpha extrapolates *past* the source instead of
 * interpolating, and `Color.lerp` does not clamp — so any channel below a third
 * came out negative. The coconut's blue channel did exactly that.
 */
function darken(color: number, amount = 0.22) {
  return mix(color, 0x000000, amount)
}

/**
 * Ring of leaves fanning out from the base — the shared foliage primitive.
 *
 * Alternating lengths and a per-leaf droop are what stop a rosette looking like
 * a cog. `r` is threaded through so a plant's variant seed reaches the leaves.
 */
function leafRosette(
  g: THREE.Group,
  count: number,
  len: number,
  color: number,
  tilt: number,
  y: number,
  r: () => number,
  accent: number = lighten(color),
  /**
   * Leaf breadth. 1 is the house default — broad, closer to a spoon than a
   * spear. A narrow pad reads as a blade of grass, and a rosette of blades reads
   * as an aloe, which is what every root crop in the game used to look like.
   */
  width = 1,
) {
  for (let i = 0; i < count; i++) {
    // Every other leaf is shorter and a shade lighter, so the rosette has an
    // inner and an outer ring and some internal shading of its own — a fan of
    // one flat colour reads as a single blob however well shaped it is.
    const inner = i % 2 !== 0
    const spin = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.3
    const leaf = leafPad(
      len * (inner ? 0.74 : 1),
      inner ? accent : color,
      tilt + (r() - 0.5) * 0.26,
      spin,
      (1.02 + r() * 0.3) * width,
    )
    leaf.position.y = y + r() * 0.02
    g.add(leaf)
  }
}

/**
 * Each bush's own foliage character.
 *
 * Five crops share the `bush` form, and until now they shared its leaves too —
 * identical rosettes at identical widths, so a strawberry, a tomato, a
 * blueberry, a chilli and a dragonfruit were one plant wearing five different
 * fruit. That is fine while the fruit is the only thing anyone looks at and
 * wrong the moment it is: half the year a bush is *unripe*, and an unripe
 * strawberry and an unripe chilli were literally the same object.
 *
 * Keyed on `fruit` rather than crop id because that is already this file's
 * species discriminator, and every bush crop has its own.
 */
interface LeafStyle {
  /** Multiplier on the form's leaf breadth. */
  width: number
  /** Multiplier on its length. */
  len: number
  /** Added to every tier's tilt — positive stands the bush up. */
  tilt: number
  /** Multiplier on leaf count, rounded. */
  count: number
}

/**
 * Each tree's own crown character — the same argument as LEAF_STYLE, one form up.
 *
 * The apple and the starfruit were the identical green dome on the identical
 * trunk, distinguishable only by the colour of the fruit hanging off the rim.
 * The coconut escaped that only because it is built as a palm on a separate
 * branch entirely, which is the proof of the point: shape is what tells trees
 * apart at this distance, not what is hanging in them.
 */
interface CrownStyle {
  /** Multiplier on canopy radius. */
  rad: number
  /** Multiplier on trunk height. */
  trunk: number
  /** How squashed the crown is: below 1 is a wide dome, above is a tall egg. */
  squash: number
  /** Multiplier on the lobe count, so a looser crown shows more sky through it. */
  lobes: number
  /** How much lighter the sunlit lobes are than the species' leaf colour. */
  sun: number
}

const CROWN_STYLE: Partial<Record<FruitKind, CrownStyle>> = {
  // Apple: the archetype — a broad, dense, low dome on a short trunk.
  pome: { rad: 1.12, trunk: 0.92, squash: 0.86, lobes: 1.15, sun: 0.2 },
  // Starfruit: a tall, narrow, open crown on a taller trunk, and paler with it —
  // a tropical tree next to an orchard one.
  star: { rad: 0.86, trunk: 1.2, squash: 1.22, lobes: 0.95, sun: 0.2 },
}

/**
 * Each vine's own sprawl — the third and last form whose crops shared one look.
 *
 * Pumpkin, melon and grapes were the identical ring of pads, and unlike the
 * bushes they are not even saved by their fruit: two of the three carry one
 * large object sitting in the middle of that ring, so the *plant* is most of
 * what is on screen. Unripe they were indistinguishable down to the leaf count.
 *
 * The shapes are the real plants'. A pumpkin has enormous lobed leaves on a
 * sprawl that swamps its bed; a watermelon's are smaller, finer and denser; a
 * grapevine climbs, so its leaves are held up on a stem rather than laid on the
 * soil, and it is the one that has tendrils worth showing.
 */
interface VineStyle {
  /** Multiplier on pad length. */
  len: number
  /** Multiplier on pad breadth. */
  width: number
  /** Multiplier on the pad count. */
  count: number
  /** Multiplier on how far the ring sprawls from the crown. */
  reach: number
  /** Added lift, in radians. Positive stands the leaves up off the ground. */
  tilt: number
  /** How high the crown of foliage sits — a climber lifts its leaves clear. */
  rise: number
}

/**
 * And the root crops' tops, the last form still sharing one rosette.
 *
 * These three are the most different plants above ground of any form in the
 * game and were the most alike on screen: a carrot's top is a cloud of thread,
 * a turnip's is a few big crinkled paddles, and a potato's is a sprawl of
 * medium leaves. Reusing LeafStyle rather than inventing a fourth shape — the
 * knobs a rosette has are the same wherever it grows.
 */
const ROOT_STYLE: Partial<Record<FruitKind, LeafStyle>> = {
  // Turnip: few, broad, upright paddles.
  globe: { width: 1.3, len: 1.05, tilt: 0.1, count: 0.75 },
  // Carrot: many fine fronds. Narrow enough to read as thread at this size.
  // Shorter and fewer than the first pass. A carrot top is feathery, but at
  // 1.25 length and nearly twice the leaf count it was a fountain of green with
  // a small orange thing under it — the root is the crop, and the leaves were
  // out-competing it for the whole cell.
  taproot: { width: 0.42, len: 0.9, tilt: 0.05, count: 1.45 },
  // Potato: a middling sprawl, wider than the carrot and lower than the turnip.
  tuber: { width: 1.0, len: 0.95, tilt: -0.1, count: 1.15 },
}

const VINE_STYLE: Partial<Record<FruitKind, VineStyle>> = {
  gourd: { len: 1.3, width: 1.15, count: 0.85, reach: 1.2, tilt: 0, rise: 0 },
  striped: { len: 0.82, width: 0.85, count: 1.45, reach: 0.95, tilt: 0.1, rise: 0.02 },
  // Lifted, not stood on end: at 0.75 the leaves compounded with the young-vine
  // uplift into a near-vertical fan and the plant read as an agave.
  bunch: { len: 1.05, width: 1.2, count: 0.85, reach: 0.8, tilt: 0.4, rise: 0.26 },
}

const LEAF_STYLE: Partial<Record<FruitKind, LeafStyle>> = {
  // Strawberry: broad, round, low trefoil leaves lying almost flat.
  heart: { width: 1.25, len: 0.9, tilt: -0.12, count: 1.15 },
  // Tomato: a sprawl of ragged mid-green leaves, held up and out.
  ribbed: { width: 0.95, len: 1.12, tilt: 0.12, count: 1 },
  // Blueberry: small neat ovals, lots of them, close to the stem.
  cluster: { width: 0.85, len: 0.78, tilt: 0.18, count: 1.4 },
  // Chilli: narrow pointed leaves on a leggy, open plant.
  pod: { width: 0.7, len: 1.2, tilt: 0.05, count: 0.85 },
  // Dragonfruit is a cactus: few, thick, upright paddles.
  scaled: { width: 1.35, len: 1.15, tilt: 0.5, count: 0.7 },
}

/** The root collar: a scrap of darker soil pushed up where the stem emerges. */
/**
 * `grown` is the plant's 0..1 maturity, and the collar shrinks with it.
 *
 * At full size this is a scrap of dark soil where the stem breaks the surface.
 * At stage 0 it was the same scrap beside a two-leaf sprout, which made every
 * seedling in the game look like a molehill with something growing out of it —
 * the mound was the largest object in the cell. A seedling has disturbed less
 * ground, so it gets less of it.
 */
function collar(g: THREE.Group, radius = 0.26, grown = 1) {
  const m = ball(radius * (0.5 + 0.5 * grown), PALETTE.soilWet, 1)
  m.scale.set(1, 0.2, 1)
  m.position.y = 0.012
  m.receiveShadow = true
  m.castShadow = false
  g.add(m)
}

// --- fruit -------------------------------------------------------------------

/**
 * A band wrapping a spherical body along one meridian — melon stripes, coconut
 * fibre, pumpkin ribs. A sphere flattened on one axis and set concentric with
 * the body shows only as a great-circle ridge, which is far cheaper than a
 * torus and matches the faceted look of everything around it.
 */
function meridian(radius: number, thickness: number, color: number, spin: number) {
  const m = ball(radius, color, 1)
  m.scale.set(1, 1, thickness)
  m.rotation.y = spin
  return m
}

/** Short chunky stem, the cue that says "this was growing until you picked it". */
function stub(len: number, radius: number, color: number) {
  const m = cyl(radius * 0.8, radius, len, color, 6)
  m.position.y = len / 2
  return m
}

/**
 * Every fruit is built at nominal radius 1 and scaled by the caller, so the six
 * forms can size their fruit independently without each factory knowing about
 * plot dimensions.
 *
 * `body` is already resolved to the ripe or unripe colour — unripe keeps the
 * species' shape and only loses its colour and size, so a half-grown row is
 * still identifiably a row of chillies.
 */
/*
 * Growing fruit wears its own colour.
 *
 * There used to be an UNRIPE constant here — a pale green every fruit was
 * repainted with until the moment it ripened, on the theory that colour is the
 * ripeness signal and shape is the identity. In practice that reads as a plant
 * covered in unrelated green lumps: you cannot tell what is coming, and a
 * half-grown tomato and a half-grown chilli are the same object.
 *
 * The cue survives without it. Growing fruit is still noticeably *smaller*
 * (0.6x) and there is still only half as much of it, which is what filling out
 * actually looks like — so ripeness now announces itself by the fruit reaching
 * full size rather than by changing species.
 *
 * The genuinely green crops keep being green because that is their colour: a
 * watermelon at stage 2 looks much as it does at stage 3, only smaller, and the
 * sunflower and moonbloom still open from a closed bud, which is a shape cue
 * rather than a colour one.
 */

/**
 * Many small blobs merged into one geometry, built once and shared.
 *
 * Fruit is not baked — rarity retints it and each plant scales it on its own —
 * so every sphere in a fruit factory is a live mesh and a draw call. That is
 * affordable for the five berries in a cluster and ruinous for the forty seeds
 * on a sunflower's face, which is the kind of detail that actually makes these
 * read as grown things. Merging the repeated part into one geometry buys the
 * detail for a single call, and because the merge carries no colour the caller
 * still picks the material — so a jackpot sunflower still retints.
 *
 * `flatten` squashes each blob on Y, for seeds and scales that lie against a
 * surface rather than sitting on it.
 */
function mergedBlobs(spots: [number, number, number, number][], detail = 0, flatten = 1) {
  const parts = spots.map(([x, y, z, r]) => {
    const geo = new THREE.IcosahedronGeometry(r, detail).toNonIndexed()
    if (flatten !== 1) geo.scale(1, flatten, 1)
    geo.translate(x, y, z)
    return geo
  })
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged ?? new THREE.BufferGeometry()
}

/** Placeholder for assemblies that exist only to be merged — see mergeShape. */
const MERGE_MAT = new THREE.MeshBasicMaterial()

/**
 * Merge a throwaway assembly into one geometry, materials discarded.
 *
 * The sibling of `mergedBlobs`, for detail that is not a cloud of spheres — the
 * melon's stripes and the turnip's root hairs are built from rotated, stretched
 * parts, which is far easier to author with the usual `ball`/`cyl` helpers and a
 * transform than as a list of centres. Same payoff: one draw call for detail
 * that would otherwise be twenty.
 */
function mergeShape(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry.clone().toNonIndexed()
    geo.applyMatrix4(mesh.matrixWorld)
    // Merging refuses a mismatched attribute set, and nothing downstream reads
    // anything but these three.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
    }
    parts.push(geo)
  })
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged ?? new THREE.BufferGeometry()
}

/**
 * One wavy melon stripe, running pole to pole on a unit sphere.
 *
 * A watermelon's stripe is not a straight band — it wanders, and the wander is
 * most of why the rind reads as a rind rather than as a beach ball. Built as a
 * chain of blobs sunk into the surface so only their caps show, which gives a
 * stripe with a little relief to catch the light instead of a decal.
 */
const MELON_STRIPE_GEO = (() => {
  const g = new THREE.Group()
  /*
   * Densely overlapping and sunk almost to the skin.
   *
   * Both numbers were wrong on the first attempt and the melon came back as a
   * barrel cactus for the second time. Fifteen blobs at a tenth of the radius
   * proud of the surface are *beads*: spaced far enough to read individually and
   * raised far enough to catch a rim light each, which is the exact description
   * of a cactus rib. Twice as many, overlapping, with three hundredths showing,
   * is a stripe — the relief is only there to keep it from looking printed on.
   */
  const N = 30
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1)
    const lat = (f - 0.5) * Math.PI * 0.94
    // The wander, widest at the equator where there is room for it.
    const lon = Math.sin(f * Math.PI * 2.1) * 0.17 * Math.cos(lat)
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 - Math.abs(f - 0.5) * 0.11, 0), MERGE_MAT)
    blob.position.set(
      Math.cos(lat) * Math.sin(lon) * 0.86,
      Math.sin(lat) * 0.86,
      Math.cos(lat) * Math.cos(lon) * 0.86,
    )
    g.add(blob)
  }
  return mergeShape(g)
})()

/**
 * Root hairs for the turnip — fine whiskers over the lower half of the bulb.
 *
 * The one detail that reads unmistakably as "pulled out of the ground". Without
 * them the bulb is a white ball with a purple hat, and no amount of work on the
 * silhouette changes that.
 */
const ROOT_HAIRS_GEO = (() => {
  const g = new THREE.Group()
  const N = 24
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996
    // Lower half only: hairs on a turnip's shoulder would read as mould.
    const lat = -0.15 - (i / N) * 1.15
    const len = 0.16 + (i % 3) * 0.07
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.016, len, 3), MERGE_MAT)
    const r = Math.cos(lat)
    const dir = new THREE.Vector3(Math.cos(a) * r, Math.sin(lat), Math.sin(a) * r).normalize()
    hair.position.copy(dir).multiplyScalar(0.97 + len * 0.4)
    // Point the cylinder's +Y down its own outward ray.
    hair.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    g.add(hair)
  }
  return mergeShape(g)
})()

/**
 * A blueberry's crown: the five-point calyx scar every berry wears.
 *
 * Cached and reused across the berries in a cluster — five points on five
 * berries is twenty-five meshes drawn as one.
 */
const BERRY_CROWN_GEO = (() => {
  const spots: [number, number, number, number][] = [[0, 0, 0, 0.13]]
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    spots.push([Math.cos(a) * 0.19, 0.02, Math.sin(a) * 0.19, 0.075])
  }
  return mergedBlobs(spots, 0, 0.4)
})()

/**
 * The strawberry's achenes, spiralled over the whole berry.
 *
 * Seven dots in a ring was what this replaces, and seven dots read as spots on
 * a red egg. A strawberry is *covered* — the seeds are its texture, not a
 * garnish — so there are forty, and they follow the berry's own profile: a
 * sphere down to the shoulder, a cone below it. Laid on a plain ovoid instead,
 * the ones near the tip float off the surface.
 */
const STRAWBERRY_SEEDS_GEO = (() => {
  const N = 40
  const spots: [number, number, number, number][] = []
  for (let i = 0; i < N; i++) {
    const f = (i + 0.5) / N
    const y = 1.02 - f * 1.85
    // Matches the shoulder sphere above y=0.28 and the cone below it.
    const profile =
      y >= 0.28
        ? Math.sqrt(Math.max(0, 1 - ((y - 0.28) / 0.85) ** 2))
        : (0.94 * (y + 0.875)) / 1.155
    const r = Math.max(0, profile) * 0.95
    const a = i * 2.39996
    spots.push([Math.sin(a) * r, y, Math.cos(a) * r, 0.062])
  }
  return mergedBlobs(spots, 0, 0.7)
})()

/**
 * A potato's eyes, spiralled over the whole tuber.
 *
 * Five hand-placed dents was what this replaces, and the trouble with a fixed
 * handful is that the plant is spun to a random heading — so on any given potato
 * most of them faced away and the visible side was blank skin. A spiral over the
 * whole surface guarantees the camera sees several from any angle, and the count
 * is what turns a pale lump into something with a texture.
 *
 * Two rings per eye: a dark dent and a paler lip a fraction larger behind it.
 * The lip is what makes the dent legible at all on a body this uniform.
 */
const TUBER_EYES = (() => {
  const N = 13
  const spots: [number, number, number, number][] = []
  for (let i = 0; i < N; i++) {
    const f = (i + 0.5) / N
    const y = 1 - f * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const a = i * 2.39996
    spots.push([Math.cos(a) * ring, y, Math.sin(a) * ring, 1])
  }
  return {
    eye: mergedBlobs(spots.map(([x, y, z]) => [x, y, z, 0.1] as [number, number, number, number]), 0, 0.5),
    lip: mergedBlobs(spots.map(([x, y, z]) => [x * 0.97, y * 0.97, z * 0.97, 0.17] as [number, number, number, number]), 0, 0.4),
  }
})()

/**
 * A sunflower's seed head, in a phyllotaxis spiral.
 *
 * The golden angle is not decoration here — it is the reason a sunflower face
 * looks like a sunflower face. Rings of seeds read as a dartboard, and a random
 * scatter reads as gravel; only the spiral gives the interlocking curves the eye
 * recognises without being able to name.
 *
 * Seeds sit *on* the domed face, so each one's height is solved against the
 * dome it lands on rather than laid flat — otherwise the outer ones sink into
 * the crown and the middle floats above it.
 */
const SEED_FIELD_GEO = (() => {
  const SEEDS = 46
  const DOME_R = 0.92
  const DOME_H = 0.276
  const DOME_Y = 0.12
  const spots: [number, number, number, number][] = []
  for (let i = 0; i < SEEDS; i++) {
    const f = (i + 0.5) / SEEDS
    // sqrt keeps the *area* per seed even; a linear radius crowds the middle.
    const rr = Math.sqrt(f) * DOME_R * 0.86
    const a = i * 2.39996
    const y = DOME_Y + DOME_H * Math.sqrt(Math.max(0, 1 - (rr / DOME_R) ** 2))
    spots.push([Math.sin(a) * rr, y, Math.cos(a) * rr, 0.075 - f * 0.022])
  }
  return mergedBlobs(spots, 0, 0.55)
})()

/**
 * A bunch of grapes: a tapering cone of berries on a golden-angle spiral.
 *
 * Eight berries in three flat rings was what this replaced, and at any size it
 * read as a purple blob with lumps. A bunch is *many* berries, and the count is
 * most of what makes it recognisable — merging is what makes twenty affordable.
 */
const GRAPE_BUNCH_GEO = (() => {
  const N = 22
  const spots: [number, number, number, number][] = []
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1)
    // Widest at the shoulder, tapering to a single berry at the tip.
    const ring = (0.52 - f * 0.46) * (0.75 + 0.25 * Math.sin(f * 9))
    const a = i * 2.39996
    spots.push([Math.cos(a) * ring, 0.5 - f * 1.75, Math.sin(a) * ring, 0.3 - f * 0.07])
  }
  return mergedBlobs(spots, 1)
})()

/**
 * Root crops whose authored model brings its own leaves.
 *
 * The procedural body grows a two-tier rosette over every root, which is right
 * for a bulb modelled as a bare bulb and wrong for one modelled complete: the
 * turnip came out as a purple pebble under a bush, and the carrot wore two sets
 * of greens at once. Where this returns a model, the body leaves the foliage to
 * it — see rootBody.
 */
function authoredRootModel(def: CropDef) {
  const models = peekModels()
  if (!models) return undefined
  if (def.fruit === 'taproot') return models.carrot
  if (def.fruit === 'globe') return models.turnip
  return undefined
}

/**
 * An authored fruit model, standing in for the procedural one.
 *
 * Three crops now swap a glTF in once they ripen, and the dance is identical
 * every time: size the model against the procedural fruit it replaces (they are
 * all authored a unit across, where this file's convention is radius 1 — hence
 * roughly a doubling), hang it where the procedural one hung, and tint it if
 * this is a jackpot.
 *
 * `null` when the models are not loaded, which is the caller's cue to build the
 * procedural version — the test suite and the crop gallery both reach these
 * factories without a glTF in hand.
 */
function authoredFruit(
  model: LoadedModel | undefined,
  scale: number,
  y: number,
  rarity: number | null,
  /**
   * Euler XYZ, for models that were not authored standing up.
   *
   * Not every export arrives oriented the way this file assumes. The corn's ear
   * lies flat at an angle in the XZ plane, so hung unrotated it clamps itself
   * sideways to the stalk like a growth — the anchor's own tilt cannot fix that,
   * because the anchor orients where the fruit *leans*, not which way is up.
   */
  rotation?: [number, number, number],
): THREE.Mesh | null {
  if (!model) return null
  const mesh = new THREE.Mesh(model.geometry, model.material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.scale.setScalar(scale)
  mesh.position.y = y
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  if (rarity !== null) {
    // Multiplied over the baseColour, so a jackpot still reads as one.
    const tint = (model.material as THREE.MeshStandardMaterial).clone()
    tint.color.setHex(rarity)
    mesh.material = tint
  }
  return mesh
}

function buildFruit(
  kind: FruitKind,
  def: CropDef,
  body: number,
  ripe: boolean,
  r: () => number,
  /** The jackpot colour, or null for an ordinary crop. Only the authored
   *  models need it: the procedural fruit already has it folded into `body`. */
  rarity: number | null = null,
) {
  const g = new THREE.Group()
  const accent = def.accentColor

  switch (kind) {
    case 'globe': {
      /*
       * The authored root once ripe, the procedural bulb before that — the same
       * arrangement the carrot uses. Growing stages stay procedural because they
       * are half-buried and barely seen; the ripe one is what the player leans
       * in to look at, and an authored model earns its place there.
       */
      const authoredTurnip = ripe ? authoredFruit(authoredRootModel(def), 2.7, 0.3, rarity) : null
      if (authoredTurnip) {
        g.add(authoredTurnip)
        break
      }

      /*
       * Turnip: a pale bulb, purple where the sun reached it, tapering to a tail.
       *
       * The shape carries the identity, and it needs three parts to do it. The
       * previous version was a squashed sphere with a flat cap laid over the top
       * half, which from the game's camera showed as a purple *disc* lying in the
       * leaves — no volume, no white, no turnip.
       *
       * Now: a body wider at the shoulder than at the base (that taper is what
       * says root rather than ball), a shoulder that follows the body's curve
       * instead of capping it flat, and a tail. The tail is small and mostly
       * buried, but it is the difference between a vegetable pulled from the
       * ground and a marble sitting on it.
       */
      const bulb = ball(1, body, 1)
      bulb.scale.set(1, 0.92, 1)
      g.add(bulb)

      // Narrows toward the base — two stacked spheres rather than a cone, so the
      // silhouette stays soft and matches the rounded language of everything else.
      const waist = ball(0.78, body, 1)
      waist.scale.set(1, 0.8, 1)
      waist.position.y = -0.62
      g.add(waist)

      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 6), mat(body))
      tail.castShadow = true
      tail.rotation.x = Math.PI
      tail.position.y = -1.2
      g.add(tail)

      // Whiskers over the lower half — see ROOT_HAIRS_GEO. Pale earth rather
      // than the bulb's own colour, which on a near-white turnip would vanish.
      const hairs = new THREE.Mesh(ROOT_HAIRS_GEO, mat(lighten(PALETTE.soilWet, 0.42)))
      hairs.scale.set(1, 0.92, 1)
      g.add(hairs)

      if (ripe) {
        /*
         * The shoulder is a *band*, not a cap: a sphere of the same radius
         * clipped to the top third by scaling it down in Y and lifting it, so it
         * hugs the bulb's own curvature. A flat disc across the top is what made
         * the old one read as a plate.
         */
        for (const [y, s, rad] of [
          [0.5, 0.5, 1.005],
          [0.72, 0.36, 0.9],
        ] as const) {
          const shoulder = ball(rad, accent, 1)
          shoulder.scale.set(1, s, 1)
          shoulder.position.y = y
          g.add(shoulder)
        }
      }
      break
    }

    case 'taproot': {
      /*
       * Carrot: the authored root once ripe, procedural before that. Its long
       * axis was authored fifty degrees off vertical, so it is tipped upright —
       * measured the same way the corn's was.
       */
      // Lifted and enlarged so its tip meets the soil and its own leafy crown
      // reaches the plant's rosette. At the model's authored size the two sat
      // apart with a gap of daylight between root and leaves.
      const root2 = ripe ? authoredFruit(authoredRootModel(def), 4.6, 0.34, rarity, [0.6981, 0, 0]) : null
      if (root2) {
        g.add(root2)
        break
      }

      // Carrot: a cone point-down, ringed with growth grooves.
      // A cone standing point-down, capped by a dome at its shoulder.
      //
      // The dome is not decoration. A bare cone leaves its flat base disc as the
      // topmost surface, which from the game's camera angle is an orange
      // truncated cone with a rim — unmistakably a plant pot. The cap has to sit
      // exactly on the base, sharing its radius, so the two read as one root.
      /*
       * Proportion is the whole job here. The old cone was as wide as it was
       * tall once the plant's fruit scale was applied, and a short fat orange
       * cone under a dome is an orange, not a carrot — which is exactly how it
       * read in game. A carrot is long and narrow: roughly three times as tall
       * as it is wide, tapering the whole way, with the shoulder crowning it.
       */
      const H = 2.9
      const RAD = 0.62
      const SHOULDER_Y = 0.15 + H / 2

      const root = new THREE.Mesh(new THREE.ConeGeometry(RAD, H, 10), mat(body))
      root.castShadow = true
      root.rotation.x = Math.PI
      root.position.y = 0.15
      g.add(root)

      // Caps the cone's flat base, which would otherwise be the topmost surface
      // and read as the rim of a plant pot from this camera angle.
      const shoulder = ball(RAD, body, 1)
      shoulder.scale.set(1, 0.62, 1)
      shoulder.position.y = SHOULDER_Y
      g.add(shoulder)

      /*
       * Growth rings, each matched to the cone's radius at its own height, and
       * only on the part that will be above soil. A ring is a dark line at this
       * size — spend them where they are visible instead of underground.
       */
      for (let i = 0; i < 4; i++) {
        const y = SHOULDER_Y - 0.3 - i * 0.42
        const radiusHere = RAD * ((y - (0.15 - H / 2)) / H)
        const groove = ball(radiusHere, accent, 1)
        groove.scale.set(1.06, 0.06, 1.06)
        groove.position.y = y
        g.add(groove)
      }
      break
    }

    case 'tuber': {
      /*
       * Potato: the authored tuber once ripe, procedural before that. Authored
       * lying on its side — which is how a dug potato lies — so it needs no
       * rotation, only a nudge down so it half-buries the way the lumps did.
       */
      const spud = ripe ? authoredFruit(peekModels()?.potato, 1.9, -0.12, rarity) : null
      if (spud) {
        g.add(spud)
        break
      }

      // Potato: fused lumps, deliberately lopsided, dented with eyes.
      const lumps: [number, number, number, number][] = [
        [0, 0.1, 0, 0.86],
        [0.52, -0.1, 0.16, 0.6],
        [-0.4, 0.02, -0.22, 0.52],
        [0.16, 0.34, -0.3, 0.42],
      ]
      for (const [x, y, z, rad] of lumps) {
        const lump = ball(rad, body, 1)
        lump.scale.set(1.1, 0.9, 1)
        lump.position.set(x, y, z)
        g.add(lump)
      }
      if (ripe) {
        /*
         * Eyes, as sunken dents rather than studs.
         *
         * A darker sphere sitting proud of the skin reads as a barnacle; the
         * same sphere pushed *into* the lump so only its cap shows reads as the
         * dimple a potato eye actually is. The pale ring around it is the raised
         * lip of skin, and it is what makes the dent legible at all against a
         * body this uniform.
         */
        // Sized to the lumps' own envelope so the eyes land on the skin.
        for (const [geo, colour, s] of [
          [TUBER_EYES.lip, lighten(body, 0.24), 1.0],
          // Darker than the accent the rest of the crop uses: against a pale
          // beige skin the authored accent is nearly the same value, and the
          // dents were invisible at any distance.
          [TUBER_EYES.eye, darken(accent, 0.45), 1.02],
        ] as const) {
          const shell = new THREE.Mesh(geo, mat(colour))
          shell.scale.set(1.2 * s, 0.82 * s, 0.95 * s)
          shell.position.set(0.03, 0.06, -0.02)
          g.add(shell)
        }
      }
      break
    }

    case 'heart': {
      /*
       * Strawberry: the authored model once it is ripe, procedural before that.
       *
       * Split on ripeness rather than swapping wholesale, and the split earns
       * its keep twice. The authored berry is red and textured, so there is no
       * honest way to show it half-grown — recolouring a photographed surface
       * green gives a mouldy strawberry, not an unripe one. And the form's whole
       * ripeness language is that unripe fruit keeps the species' *shape* and
       * loses its colour, which the procedural cone does for free.
       */
      const berry = ripe ? authoredFruit(peekModels()?.strawberry, 2, -0.15, rarity) : null
      if (berry) {
        g.add(berry)
        break
      }

      const shoulder = ball(1, body, 1)
      shoulder.scale.set(1, 0.85, 1)
      shoulder.position.y = 0.28
      g.add(shoulder)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.94, 1.15, 8), mat(body))
      tip.castShadow = true
      tip.rotation.x = Math.PI
      tip.position.y = -0.3
      g.add(tip)
      if (ripe) {
        const seeds = new THREE.Mesh(STRAWBERRY_SEEDS_GEO, mat(accent))
        seeds.castShadow = true
        g.add(seeds)
        for (let i = 0; i < 5; i++) {
          const sepal = leafPad(0.62, PALETTE.leafDark, 0.55, (i / 5) * Math.PI * 2, 0.7)
          sepal.position.y = 0.86
          g.add(sepal)
        }
      }
      break
    }

    case 'ribbed': {
      // Tomato: the authored model once ripe, procedural before that.
      const fruitMesh = ripe ? authoredFruit(peekModels()?.tomato, 2, 0, rarity) : null
      if (fruitMesh) {
        g.add(fruitMesh)
        break
      }

      // Tomato: squashed globe, shallow creases, five-point calyx on the crown.
      const flesh = ball(1, body, 1)
      flesh.scale.set(1, 0.82, 1)
      g.add(flesh)
      for (let i = 0; i < 5; i++) {
        g.add(meridian(0.99, 0.1, body, (i / 5) * Math.PI))
      }
      if (ripe) {
        for (let i = 0; i < 5; i++) {
          const sepal = leafPad(0.72, accent, 0.28, (i / 5) * Math.PI * 2, 0.62)
          sepal.position.y = 0.76
          g.add(sepal)
        }
        const s = stub(0.34, 0.11, accent)
        s.position.y = 0.76
        g.add(s)
      }
      break
    }

    case 'cob': {
      // Corn: the authored ear once ripe, procedural before that.
      // Measured, not guessed: the ear's long axis runs at 155 degrees in the
      // XZ plane, so yawing it back to +Z and tipping that up gives a cob that
      // stands the way the procedural one did.
      const ear2 = ripe
        ? authoredFruit(peekModels()?.corn, 2.4, 0, rarity, [-Math.PI / 2, -2.7053, 0])
        : null
      if (ear2) {
        g.add(ear2)
        break
      }

      // Corn: a kernelled ear in a peeled husk, with silk at the tip.
      //
      // Fatter than it looks like it should be. An ear drawn at real-world
      // proportions is a thin rod, and next to a stalk it disappears — the husk
      // has to be wide enough to break the stalk's outline or the plant reads as
      // a bare reed with a yellow smear on it.
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.86, 2.3, 12), mat(body))
      ear.castShadow = true
      ear.geometry.computeVertexNormals()
      g.add(ear)
      const cap = ball(0.72, body, 1)
      cap.scale.set(1, 0.8, 1)
      cap.position.y = 1.15
      g.add(cap)
      /*
       * Rows of kernels read from the faceting; the husk is what sells the
       * shape. Peeled back to two thirds of the ear's length — at full length
       * the husk closed over the top and what showed was a green cone with a
       * yellow seam, which is a leek.
       */
      for (let i = 0; i < 4; i++) {
        const husk = leafPad(1.9, accent, 1.34, (i / 4) * Math.PI * 2 + 0.4, 0.9)
        husk.position.y = -1.1
        g.add(husk)
      }
      if (ripe) {
        for (let i = 0; i < 6; i++) {
          const silk = cyl(0.02, 0.07, 0.8, 0xc98a44, 4)
          silk.position.set((r() - 0.5) * 0.45, 1.6, (r() - 0.5) * 0.45)
          silk.rotation.z = (r() - 0.5) * 1.1
          g.add(silk)
        }
      }
      break
    }

    case 'cluster': {
      /*
       * Blueberries: the authored cluster once ripe, procedural before that —
       * the same split, and for the same reasons, as the strawberry above.
       */
      const knot = ripe ? authoredFruit(peekModels()?.blueberry, 1.9, 0, rarity) : null
      if (knot) {
        g.add(knot)
        break
      }

      // Blueberries: a tight knot, the outer ones dusted paler.
      const spots: [number, number, number, number][] = [
        [0, 0.35, 0, 0.66],
        [0.62, -0.1, 0.2, 0.58],
        [-0.55, 0.05, -0.3, 0.55],
        [0.18, -0.2, -0.62, 0.52],
        [-0.24, -0.3, 0.6, 0.5],
      ]
      spots.forEach(([x, y, z, rad], i) => {
        const berry = ball(rad, i % 3 === 0 && ripe ? def.accentColor : body, 1)
        berry.position.set(x, y, z)
        g.add(berry)
        if (ripe) {
          /*
           * The blossom scar — a five-point calyx, not a dot.
           *
           * It is the one marking a blueberry has, and it is what tells the eye
           * these are berries rather than beads. Sunk slightly into the crown so
           * the points sit in the skin.
           */
          const crown = new THREE.Mesh(BERRY_CROWN_GEO, mat(accent))
          crown.scale.setScalar(rad * 1.5)
          crown.position.set(x, y + rad * 0.82, z)
          crown.rotation.y = i * 1.3
          g.add(crown)
          // The dusty bloom a ripe blueberry wears, on the sunward shoulder.
          const dust = ball(rad * 0.55, lighten(body, 0.42), 0)
          dust.scale.set(1, 0.4, 1)
          dust.position.set(x + rad * 0.2, y + rad * 0.66, z + rad * 0.2)
          g.add(dust)
        }
      })
      break
    }

    case 'gourd': {
      // Pumpkin: the authored fruit once ripe, procedural before that.
      const gourd = ripe ? authoredFruit(peekModels()?.pumpkin, 2, 0, rarity) : null
      if (gourd) {
        g.add(gourd)
        break
      }

      // Pumpkin: a ring of fat lobes around a squat core, under a curled stem.
      //
      // Built from lobes rather than surface ridges on purpose. A flattened
      // sphere with meridian bands scored into it reads as a smooth pot; the
      // gourd shape comes from the *bulges between* the ribs, so those bulges
      // have to be real volumes that break the silhouette.
      /*
       * Three changes, because the version this replaces read as an orange
       * cushion at every distance.
       *
       * The lobes sat at 0.6 with a radius of 0.44 around a 0.78 core, which
       * means they cleared its surface by a quarter of their own radius — a
       * suggestion of a bulge rather than a bulge. They now sit further out and
       * are fatter, so each one is a distinct swell in the outline.
       *
       * The grooves between them are new and are what actually sells it: a
       * pumpkin is read from its *dark lines*, not its bumps, and there were
       * none. A darker wedge sunk into each seam gives the eye the ribs it is
       * looking for.
       *
       * And it is less squashed. At 0.74 the fruit was wider than it was tall by
       * half, which is a squash, not a pumpkin.
       */
      const shell = new THREE.Group()
      const core = ball(0.76, body, 1)
      core.scale.set(1, 0.9, 1)
      shell.add(core)

      const lobes = 8
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2
        const lobe = ball(0.5, body, 1)
        lobe.scale.set(1, 0.96, 1.06)
        lobe.position.set(Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66)
        lobe.rotation.y = -a
        shell.add(lobe)

        // The seam between this lobe and the next, sunk so only the crease shows.
        const seam = (a + Math.PI / lobes) % (Math.PI * 2)
        const groove = ball(0.34, accent, 1)
        groove.scale.set(0.34, 1.02, 0.34)
        groove.position.set(Math.cos(seam) * 0.72, 0, Math.sin(seam) * 0.72)
        groove.rotation.y = -seam
        shell.add(groove)
      }
      shell.scale.set(1, 0.84, 1)
      g.add(shell)

      // A proper woody stalk: five-sided, flared where it meets the fruit, and
      // ribbed. The old one was a smooth cone and read as a cork.
      const stalk = cyl(0.11, 0.22, 0.46, accent, 5)
      stalk.position.y = 0.7
      stalk.rotation.z = 0.14
      g.add(stalk)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        const ridge = cyl(0.022, 0.04, 0.42, lighten(accent, 0.18), 4)
        ridge.position.set(Math.cos(a) * 0.13, 0.7, Math.sin(a) * 0.13)
        ridge.rotation.z = 0.14
        g.add(ridge)
      }
      if (ripe) {
        const curl = cyl(0.05, 0.09, 0.34, accent, 5)
        curl.position.set(0.2, 0.92, 0.04)
        curl.rotation.z = 1.2
        g.add(curl)
      }
      break
    }

    case 'pod': {
      /*
       * Chilli: the authored pod once ripe, procedural before that. Authored
       * lying at forty-five degrees, so it is rolled round to hang point-down —
       * a pepper that sticks up reads as a flower bud.
       */
      const pod = ripe ? authoredFruit(peekModels()?.pepper, 1.65, -0.7, rarity, [0, 0, 3.927]) : null
      if (pod) {
        g.add(pod)
        break
      }

      // Chilli: a long pod tapering to a curved point, hanging from a green cap.
      const segs = 4
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1)
        const rad = 0.62 - t * 0.4
        const seg = ball(rad, body, 1)
        // Curved centreline, so the pod hooks rather than hanging straight.
        seg.position.set(Math.sin(t * 1.5) * 0.5, -t * 1.9, 0)
        g.add(seg)
      }
      const cap = ball(0.6, accent, 1)
      cap.scale.set(1, 0.5, 1)
      cap.position.y = 0.24
      g.add(cap)
      const s = stub(0.4, 0.1, accent)
      s.position.y = 0.3
      g.add(s)
      break
    }

    case 'striped': {
      // Melon: the authored fruit once ripe, procedural before that.
      const authoredMelon = ripe ? authoredFruit(peekModels()?.melon, 2, 0, rarity) : null
      if (authoredMelon) {
        g.add(authoredMelon)
        break
      }

      /*
       * Melon: a squat globe banded in a darker green.
       *
       * Two changes from the version that shared a plot with the cactus and lost:
       * fewer, wider bands, and a flattened body. Ten thin vertical stripes on a
       * true sphere is the exact description of a barrel cactus, and next to an
       * actual barrel cactus two crops down, that is what it read as. Six wide
       * ones on a melon that is broader than it is tall reads as a watermelon.
       */
      const flesh = ball(1, body, 1)
      flesh.scale.set(1.04, 0.82, 1.04)
      g.add(flesh)
      if (ripe) {
        // Six wandering stripes rather than three great-circle bands. The bands
        // were exactly symmetric, which is what made the rind look printed on.
        for (let i = 0; i < 6; i++) {
          const stripe = new THREE.Mesh(MELON_STRIPE_GEO, mat(accent))
          stripe.castShadow = true
          stripe.rotation.y = (i / 6) * Math.PI * 2
          stripe.scale.set(1.04, 0.82, 1.04)
          g.add(stripe)
        }
      }
      const s = stub(0.18, 0.1, PALETTE.leafDark)
      s.position.y = 0.72
      g.add(s)
      break
    }

    case 'bunch': {
      /*
       * Grapes: the authored bunch once ripe, procedural before that.
       *
       * The model hangs from its top, so it is dropped by half its height to
       * hang off the anchor rather than straddle it.
       */
      const authoredBunch = ripe ? authoredFruit(peekModels()?.grapes, 2.6, -0.5, rarity) : null
      if (authoredBunch) {
        g.add(authoredBunch)
        break
      }

      // Grapes: twenty-odd berries in a tapering cone, on a woody stalk.
      const berries = new THREE.Mesh(GRAPE_BUNCH_GEO, mat(body))
      berries.castShadow = true
      berries.receiveShadow = true
      g.add(berries)

      // A few pale berries near the top, where the light would catch them.
      if (ripe) {
        for (const [x, y, z] of [
          [0.3, 0.42, 0.18],
          [-0.26, 0.3, -0.24],
          [0.1, 0.1, 0.34],
        ] as const) {
          const lit = ball(0.26, lighten(body, 0.3), 1)
          lit.position.set(x, y, z)
          g.add(lit)
        }
      }

      const s = stub(0.4, 0.09, accent)
      s.position.y = 0.7
      g.add(s)
      if (ripe) {
        const leaf = leafPad(0.9, accent, 0.5, 0.8, 1.1)
        leaf.position.y = 0.95
        g.add(leaf)
        // A curling tendril off the stalk — the one thing that says *vine*.
        const curl = cyl(0.02, 0.035, 0.42, accent, 4)
        curl.position.set(-0.22, 0.82, 0.1)
        curl.rotation.set(0.5, 0, 1.15)
        g.add(curl)
      }
      break
    }

    case 'disc': {
      /*
       * Sunflower: the authored head once ripe, procedural before that. Its face
       * is a flat disc in the XY plane, so it is tipped back a quarter turn to
       * look up — `stalkBody` then nods it forward, and a head that starts
       * face-on to the horizon would end up staring at the ground.
       */
      // Sized well past the procedural head it replaces. A sunflower's whole
      // appeal is that the bloom is out of proportion to the plant — matched to
      // the old geometry it read as a daisy on a very tall stalk.
      const head = ripe ? authoredFruit(peekModels()?.sunflower, 3.4, 0, rarity, [-Math.PI / 2, 0, 0]) : null
      if (head) {
        g.add(head)
        break
      }

      /*
       * Sunflower: a seed disc ringed with petals, built facing *up*.
       *
       * It used to be built facing sideways along +Z, and since every plant is
       * given a random spin about Y, the head faced a random compass direction —
       * so most sunflowers in a field showed the game their edge and read as a
       * shaving brush on a stick. Facing up means the head is legible from any
       * spin, and `stalkBody` nods it forward just far enough to be a sunflower
       * rather than a daisy looking at the sky.
       *
       * The back matters too, for the ones that nod away from the camera: a green
       * calyx under the disc still says sunflower, where the bare cylinder wall
       * said nothing.
       */
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.86, 0.3, 16), mat(accent))
      disc.castShadow = true
      g.add(disc)
      // Domed seed head — a flat face is a coin, and it catches no light.
      const dome = ball(0.92, accent, 1)
      dome.scale.set(1, 0.3, 1)
      dome.position.y = 0.12
      g.add(dome)

      // And the seeds themselves, spiralling across it. See SEED_FIELD_GEO.
      if (ripe) {
        const seeds = new THREE.Mesh(SEED_FIELD_GEO, mat(0x3b2a16))
        seeds.castShadow = true
        g.add(seeds)
      }

      const petals = ripe ? 15 : 0
      for (let i = 0; i < petals; i++) {
        const spin = (i / petals) * Math.PI * 2
        // Alternating length and lift, so the ring has depth instead of being a
        // cog stamped out of card.
        const petal = leafPad(i % 2 ? 1.0 : 1.15, i % 2 ? PALETTE.gold : body, 0.1 + (i % 2) * 0.16, spin, 0.46)
        petal.position.set(Math.sin(spin) * 0.78, 0.04, Math.cos(spin) * 0.78)
        g.add(petal)
      }

      // Calyx: sepals swept back under the head. On an unripe bud they close
      // over the face instead, which is the one crop whose unripe read is a
      // different shape rather than a smaller one.
      for (let i = 0; i < 8; i++) {
        const spin = (i / 8) * Math.PI * 2 + 0.2
        const sepal = leafPad(ripe ? 0.66 : 1.05, PALETTE.leafDark, ripe ? -0.5 : 1.15, spin, 0.55)
        sepal.position.set(Math.sin(spin) * (ripe ? 0.6 : 0.2), ripe ? -0.1 : 0, Math.cos(spin) * (ripe ? 0.6 : 0.2))
        g.add(sepal)
      }
      break
    }

    case 'pome': {
      // Apple: the authored fruit once ripe, procedural before that.
      const pome = ripe ? authoredFruit(peekModels()?.apple, 2, 0, rarity) : null
      if (pome) {
        g.add(pome)
        break
      }

      // Apple: a globe dimpled at the top, with a woody stem and one leaf.
      const flesh = ball(1, body, 1)
      flesh.scale.set(1, 0.94, 1)
      g.add(flesh)
      const dimple = ball(0.34, body, 1)
      dimple.scale.set(1, 0.4, 1)
      dimple.position.y = 0.78
      g.add(dimple)
      const s = stub(0.52, 0.1, accent)
      s.position.y = 0.78
      s.rotation.z = 0.2
      g.add(s)
      if (ripe) {
        const leaf = leafPad(0.78, PALETTE.leafDark, 0.35, 1.2, 0.9)
        leaf.position.y = 1.2
        g.add(leaf)
      }
      break
    }

    case 'husk': {
      // Coconut: the authored nut once ripe, procedural before that.
      const nutModel = ripe ? authoredFruit(peekModels()?.coconut, 2, 0, rarity) : null
      if (nutModel) {
        g.add(nutModel)
        break
      }

      // Coconut: fibrous nut, flattened at both poles, wrapped in husk seams.
      const nut = ball(1, body, 1)
      nut.scale.set(1, 0.88, 1)
      g.add(nut)
      for (let i = 0; i < 3; i++) {
        g.add(meridian(1.01, 0.13, accent, (i / 3) * Math.PI))
      }
      const top = ball(0.42, accent, 1)
      top.scale.set(1, 0.32, 1)
      top.position.y = 0.8
      g.add(top)
      if (ripe) {
        /*
         * The three eyes — the one marking that makes a brown ball a coconut.
         * Grouped on one face rather than spread around it, which is where they
         * actually are and what stops them reading as generic spots.
         */
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5
          const eye = ball(0.16, darken(body, 0.5), 0)
          eye.scale.set(1, 1, 0.45)
          eye.position.set(Math.cos(a) * 0.26, 0.4 + Math.sin(a) * 0.16, 0.86)
          g.add(eye)
        }
      }
      break
    }

    case 'fig': {
      /*
       * Cactus: a ribbed green barrel with the edible fig budding on its crown.
       *
       * The barrel is the plant — `stalkBody` gives this species no stem at all —
       * so it carries the identity, and a smooth cylinder was carrying none of
       * it. Ribs are what say cactus: eight shallow columns standing proud of the
       * wall, with the spines sitting on the ridges where they catch the light.
       *
       * The fig is small on purpose. At its old size it was a pink egg wider than
       * the plant it grew on, and the read was "bottle with a cork".
       */
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.66, 2.1, 10), mat(def.leafColor))
      barrel.castShadow = true
      barrel.position.y = 0.15
      g.add(barrel)

      const ribs = 8
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 2.05, 5), mat(def.leafColor))
        rib.castShadow = true
        rib.position.set(Math.cos(a) * 0.7, 0.15, Math.sin(a) * 0.7)
        g.add(rib)
        /*
         * Areoles up each rib: the woolly pad a cactus grows its spines *from*.
         *
         * Spines sprouting straight out of smooth skin is the tell of a cactus
         * drawn by someone who has not looked at one. The pad is a small pale
         * tuft, and it is what turns a ribbed green cylinder into a plant — four
         * up each of eight ribs gives the surface a regular grid of detail that
         * the ribs alone could not.
         */
        for (let k = 0; k < 4; k++) {
          const y = -0.72 + k * 0.5
          const areole = ball(0.055, lighten(accent, 0.3), 0)
          areole.scale.set(1, 1, 0.5)
          areole.position.set(Math.cos(a) * 0.82, y, Math.sin(a) * 0.82)
          g.add(areole)
          // Two spines out of every other one, so the silhouette is prickly
          // without the barrel disappearing into a ball of needles.
          if (k % 2 !== 0) continue
          for (const lean of [-0.4, 0.4]) {
            const spine = cyl(0.006, 0.032, 0.3, accent, 4)
            spine.position.set(Math.cos(a) * 0.92, y + lean * 0.12, Math.sin(a) * 0.92)
            spine.rotation.z = -Math.sin(a) * 1.3 + lean
            spine.rotation.x = Math.cos(a) * 1.3
            g.add(spine)
          }
        }
      }

      const crown = ball(0.76, def.leafColor, 1)
      crown.scale.set(1, 0.5, 1)
      crown.position.y = 1.18
      g.add(crown)

      if (ripe) {
        /*
         * Three figs around the crown, not one on top.
         *
         * A prickly pear fruits in a ring around its rim — a single bud centred
         * on the apex reads as a cork in a bottle, which is what the last
         * version looked like once the barrel got its ribs.
         */
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.4
          const bud = ball(0.28, body, 1)
          bud.scale.set(1, 1.3, 1)
          bud.position.set(Math.cos(a) * 0.42, 1.42, Math.sin(a) * 0.42)
          g.add(bud)
          const crownDip = ball(0.13, def.leafColor, 1)
          crownDip.scale.set(1, 0.45, 1)
          crownDip.position.set(Math.cos(a) * 0.42, 1.78, Math.sin(a) * 0.42)
          g.add(crownDip)
        }
      }
      break
    }

    case 'star': {
      // Starfruit: the authored fruit once ripe, procedural before that.
      const star = ripe ? authoredFruit(peekModels()?.starfruit, 2, 0, rarity) : null
      if (star) {
        g.add(star)
        break
      }

      /*
       * Starfruit: an oval with five ribs running down its length.
       *
       * The ribs used to radiate horizontally, on the theory that a star seen
       * from above is the fruit's identity. It is — but the game never looks at a
       * tree from above, and from the side that arrangement is a set of yellow
       * spurs sticking out sideways, which reads as a claw. A carambola is a
       * ribbed oval; the star is what you get when you *cut* one, and hanging in
       * a canopy the oval is the shape that has to work.
       */
      const core = ball(0.55, body, 1)
      core.scale.set(1, 1.5, 1)
      g.add(core)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        const ridge = ball(0.42, body, 1)
        ridge.scale.set(0.55, 1.75, 0.9)
        ridge.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)
        ridge.rotation.y = -a + Math.PI / 2
        g.add(ridge)
      }
      if (ripe) {
        // Waxy edges catching the light along each rib's crest.
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2
          const crest = ball(0.12, accent, 0)
          crest.scale.set(1, 4.4, 1)
          crest.position.set(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72)
          g.add(crest)
        }
      }
      const s = stub(0.26, 0.08, PALETTE.leafDark)
      s.position.y = 0.62
      g.add(s)
      break
    }

    case 'scaled': {
      // Dragonfruit: the authored fruit once ripe, procedural before that.
      const scaled = ripe ? authoredFruit(peekModels()?.dragonfruit, 2, 0, rarity) : null
      if (scaled) {
        g.add(scaled)
        break
      }

      // Dragonfruit: a magenta oval sheathed in upturned green scales.
      const flesh = ball(1, body, 1)
      flesh.scale.set(0.92, 1.24, 0.92)
      g.add(flesh)
      const scales = ripe ? 9 : 6
      for (let i = 0; i < scales; i++) {
        const a = (i / scales) * Math.PI * 2 + (i % 2) * 0.3
        const tier = (i % 3) - 1
        const scale = leafPad(0.86, accent, -0.5, a, 0.62)
        scale.position.set(Math.cos(a) * 0.68, tier * 0.62, Math.sin(a) * 0.68)
        g.add(scale)
      }
      const s = stub(0.3, 0.12, accent)
      s.position.y = 1.16
      g.add(s)
      break
    }

    case 'bloom': {
      /*
       * Moonbloom: the authored flower once ripe, procedural before that. It was
       * authored as a flat blossom already facing up, so unlike the sunflower it
       * needs no tipping.
       */
      const blossom = ripe ? authoredFruit(peekModels()?.moonbloom, 2.4, 0, rarity) : null
      if (blossom) {
        g.add(blossom)
        break
      }

      // Moonbloom: petals opening around a core that glows through the bloom
      // pass at night. The only crop whose ripe read is light, not bulk.
      /*
       * Two rings of petals, not one, and narrower than they were.
       *
       * At width 0.62 and nine of them the petals overlapped edge to edge into
       * an unbroken white disc — a blob on a stick, with nothing to say it was
       * made of petals at all. Narrow enough to leave daylight between them and
       * the eye counts them; an inner ring offset by half a step fills the gaps
       * it would otherwise see straight through, which is how a real corolla
       * works.
       */
      const petals = ripe ? 10 : 6
      const len = ripe ? 1.2 : 0.7
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2
        // Alternating lift, so the ring has some thickness seen from the side.
        const petal = leafPad(len * (i % 2 ? 0.88 : 1), body, (ripe ? 0.14 : 0.9) + (i % 2) * 0.12, a, 0.4)
        g.add(petal)
      }
      if (ripe) {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + Math.PI / 10
          const inner = leafPad(0.72, lighten(body, 0.3), 0.42, a, 0.36)
          inner.position.y = 0.08
          g.add(inner)
        }
      }

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(ripe ? 0.3 : 0.2, 9, 7),
        mat(accent, { emissive: ripe ? accent : 0x000000 }),
      )
      core.scale.y = 0.8
      core.position.y = ripe ? 0.1 : 0.16
      g.add(core)

      if (ripe) {
        /*
         * Stamens — a ring of lit filaments standing out of the core.
         *
         * The one crop whose ripe read is *light* rather than bulk, and a single
         * smooth emissive ball is a bulb, not a bloom. Breaking the glow into
         * points gives the bloom pass something with structure to bleed around.
         */
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + 0.3
          const filament = cyl(0.018, 0.028, 0.26, accent, 4)
          filament.position.set(Math.cos(a) * 0.14, 0.24, Math.sin(a) * 0.14)
          filament.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4)
          g.add(filament)
          const tip = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 6, 5),
            mat(accent, { emissive: accent }),
          )
          tip.position.set(Math.cos(a) * 0.2, 0.37, Math.sin(a) * 0.2)
          g.add(tip)
        }
        // A green calyx cupping the flower from below, so it is attached to its
        // stem rather than balanced on it.
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.5
          const sepal = leafPad(0.42, def.leafColor, -0.55, a, 0.6)
          sepal.position.y = -0.06
          g.add(sepal)
        }
      }
      break
    }
  }

  return g
}

/**
 * Per-species multiplier on the form's nominal fruit size.
 *
 * A form hands one size to every crop that uses it, which is what left a
 * strawberry and a dragonfruit — both bushes — exactly as wide as each other.
 * These are *relative* to the form's number, so retuning a form still moves all
 * of its crops together, which is the property that keeps the set coherent.
 */
const FRUIT_SCALE: Partial<Record<FruitKind, number>> = {
  heart: 0.66,
  cluster: 0.78,
  ribbed: 0.86,
  pod: 0.92,
  scaled: 1.2,
  bunch: 0.82,
  husk: 0.86,
  star: 1.15,
}

/**
 * How far a fruit hangs below its own origin, in fruit space.
 *
 * Only the forms that stand a fruit on the ground need it — a melon whose
 * origin is its centre sinks half of itself into the soil unless something
 * accounts for its radius, and every fruit buries a different amount.
 */
const FRUIT_DROP: Partial<Record<FruitKind, number>> = {
  striped: 1,
  gourd: 0.52,
  bunch: 1.35,
  fig: 0.95,
}

/**
 * Textured twins of style.ts's flat materials, cached by their source.
 *
 * Fruit stays as loose meshes rather than being baked — rarity retints it and
 * every plant scales it independently — so it keeps using the shared palette
 * materials, which the whole game draws from. Cloning here is what lets a
 * tomato have skin without also putting a mottle on every cottage and fence
 * post in the valley.
 */
const skinCache = new Map<string, THREE.MeshLambertMaterial>()
function skinned(src: THREE.MeshLambertMaterial) {
  /*
   * An authored material is left exactly as it shipped.
   *
   * This assigns `map`, so running it over a glTF material would overwrite that
   * model's own baseColour with the mottle and throw away the texture the model
   * was chosen for. Anything that already has a map is not a flat palette
   * colour and needs nothing from here.
   */
  if (src.map) return src
  const key = `${src.color.getHex()}|${src.flatShading ? 1 : 0}|${src.emissive.getHex()}`
  let m = skinCache.get(key)
  if (!m) {
    m = src.clone()
    m.map = cropDetailMap()
    skinCache.set(key, m)
  }
  return m
}

/** One fruit, sized and marked so the plant's own scale jitter can find it. */
function createFruit(def: CropDef, ripe: boolean, size: number, r: () => number, rarity: number | null = null) {
  const body = def.fruitColor
  const g = buildFruit(def.fruit, def, body, ripe, r, rarity)
  g.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) mesh.material = skinned(mesh.material as THREE.MeshLambertMaterial)
  })
  g.scale.setScalar(size * (FRUIT_SCALE[def.fruit] ?? 1) * (ripe ? 1 : 0.6))
  g.userData.isFruit = true
  return g
}

// --- plant bodies ------------------------------------------------------------

/**
 * Where one fruit sits on the plant, and how it hangs there.
 *
 * Orientation belongs to the anchor rather than to the fruit factory, because
 * the same fruit hangs differently on different plants — and because what makes
 * an ear of corn read as an ear of corn is that it leans out of the stalk, which
 * is a fact about the stalk.
 */
interface Anchor {
  pos: THREE.Vector3
  /** Lean from vertical, radians, in the direction of `yaw`. */
  tilt?: number
  /** Compass direction the fruit faces and leans toward. Random when omitted. */
  yaw?: number
}

/**
 * A ring of anchors, each leaning outward.
 *
 * Leaning outward is the whole trick for bushes and trees: a fruit sitting
 * upright on the shoulder of a leaf mass is *inside* it from any camera angle
 * above the horizon, and tipping it out by twenty degrees is what puts it in
 * front of the foliage instead of behind it.
 */
function ring(count: number, radius: number, y: number, tilt = 0, phase = 0.6): Anchor[] {
  const out: Anchor[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + phase
    out.push({
      pos: new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius),
      tilt,
      // Puts the fruit's own +Z along the outward direction, so `tilt` leans it
      // away from the plant rather than in some arbitrary direction.
      yaw: Math.PI / 2 - a,
    })
  }
  return out
}

/**
 * A form's foliage, plus where its fruit hangs.
 *
 * Anchors are in the plant's local space. Returning them rather than adding the
 * fruit inline is what lets the body be baked into one mesh while the fruit
 * stays as separate objects — see createCropModel.
 */
interface Body {
  group: THREE.Group
  anchors: Anchor[]
  /** Nominal fruit radius for this form. */
  fruitSize: number
}

/**
 * Root crops: a bulb pushing up out of the soil, leaves springing from its crown.
 *
 * The old version anchored the root at soil level and laid a flat rosette over
 * it, which hid the whole vegetable — a ripe turnip showed as a purple lid lying
 * in a pile of leaves, and the carrot as a floating orange ball. The fix is
 * staging, not modelling: lift the root so its shoulder clears the ground, and
 * raise the rosette to sit on that shoulder rather than on the dirt.
 *
 * The lift grows with the stage, so the root visibly *heaves itself out of the
 * ground* as it ripens. That is the single strongest ripeness cue this form has,
 * and it costs nothing — no extra geometry, just where things sit.
 */
function rootBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)
  collar(g, 0.32, t)

  /*
   * Where the crown ends up. Ripe roots stand proudest.
   *
   * A taproot is staged differently from a bulb, and it has to be: a carrot's
   * whole identity is its *length*, and a long root anchored at the crown shows
   * only its widest end with the taper buried — which is why the first pass came
   * out looking like an orange sitting in a salad. So the carrot stands on the
   * soil with its tip at ground level and its leaves lifted clear of its
   * shoulder, the way every farming game draws a pulled carrot. A turnip is the
   * opposite: it *is* the bulb, so it nestles into the mound.
   */
  const taproot = def.fruit === 'taproot'
  const tuber = def.fruit === 'tuber'
  /*
   * A taproot needs a far smaller scale factor than a bulb for the same physical
   * size, because the cone is nearly three units tall in fruit space where a
   * bulb is two wide and one tall. Sharing one number produced a carrot the
   * height of the farmer's knee standing on its point — correct code, absurd
   * result, and only visible by looking at it.
   */
  // The taproot's number is small because the cone is nearly three units long
  // in fruit space where a bulb is two wide — but it was small enough that the
  // root read as a garnish on its own leaves. Raised at both ends.
  const size = taproot ? 0.115 + t * 0.038 : tuber ? 0.15 + t * 0.05 : 0.2 + t * 0.06
  /*
   * How high the root rides.
   *
   * Half the root's own height for a carrot: the cone spans 2.6 units in fruit
   * space, and standing it on its tip is the whole point of the form. A turnip's
   * globe is centred on its own origin, so anchoring it at soil level buries
   * everything but a cap and leaves a purple pancake in the dirt — a third of a
   * radius up is what shows the shoulder *and* the white below it. Potatoes stay
   * lower still: they are supposed to look half dug out.
   */
  /*
   * A taproot only lifts its crown once there is a root to lift it.
   *
   * Fruit does not exist before stage 2, so until then the carrot was hovering
   * its leaves at the height the grown root's shoulder *will* reach, with a
   * hand's width of daylight underneath and nothing holding them up. Before it
   * emerges the leaves come straight out of the soil, which is what a young
   * carrot looks like.
   */
  /*
   * ...and it lifts them by however much root there actually is.
   *
   * `createFruit` shrinks unripe fruit to 0.6, so a stage-2 carrot is a shorter
   * cone than a stage-3 one — but the crown was lifted by the *full* height
   * either way, which put the leaf fan a clear gap above the root it is
   * supposed to be growing out of. Matching the same factor closes it, and the
   * leaves rise with the root as it swells.
   */
  const rooted = stage >= 2 ? (stage === GROWTH_STAGES - 1 ? 1 : 0.6) : 0
  const stand = taproot ? 1.3 * size * rooted : tuber ? 0.24 * size : 0.36 * size
  const crown = taproot ? stand + (rooted ? 1.35 * size * rooted : 0.04) : 0.05 + t * 0.1

  /*
   * Two tiers, both springing from the crown.
   *
   * A single flat rosette is what buried the vegetable. The lower tier still
   * splays out over the soil, but the upper one lifts and stands more upright,
   * so the leaves frame the root instead of lying across it — and the gap
   * between the tiers is where the bulb shows through.
   */
  const top = ROOT_STYLE[def.fruit] ?? { width: 1, len: 1, tilt: 0, count: 1 }
  const many = (n: number) => Math.max(3, Math.round(n * top.count))

  /*
   * A ripe root with an authored model wears that model's own leaves.
   *
   * Growing the rosette anyway put two sets of greens on the carrot and buried
   * the turnip under a bush several times its own size — the plant read as
   * foliage with a vegetable hidden in it. The tiers stay for every unripe
   * stage, because until the model swaps in the leaves are the whole plant.
   */
  const authoredTop = stage === GROWTH_STAGES - 1 && !!authoredRootModel(def)

  if (!authoredTop) leafRosette(
    g,
    stage === 0 ? 4 : many(9),
    (0.24 + t * 0.22) * top.len,
    def.leafColor,
    // A carrot top sprays upward from a single point; a turnip top splays flat.
    (taproot ? 1.15 : 0.46 - t * 0.1) + top.tilt,
    taproot ? crown : crown * 0.5,
    r,
    undefined,
    top.width,
  )
  if (stage >= 1 && !authoredTop) {
    // The upper tier stands, but not to attention. At 1.0 rad these were broad
    // vertical spears and every root crop in the game read as an aloe.
    leafRosette(
      g,
      many(7),
      (0.18 + t * 0.18) * top.len,
      PALETTE.leafLight,
      (taproot ? 1.45 : 0.74) + top.tilt,
      crown,
      r,
      def.leafColor,
      top.width,
    )
  }

  // A potato plant lifts more than one tuber, and two half-buried lumps beside
  // each other read as a dug crop where a single lump read as a stone.
  const anchors = tuber
    ? [
        { pos: new THREE.Vector3(-0.15, stand, 0.08) },
        { pos: new THREE.Vector3(0.14, stand * 0.8, -0.1) },
      ]
    : [{ pos: new THREE.Vector3(0, stand, 0) }]
  return { group: g, anchors, fruitSize: size }
}

/**
 * Bushes: a dome of overlapping leaf tiers with the fruit hung on its outside.
 *
 * The old bush was one flat skirt with a dark ball perched on it, and because
 * the fruit anchored *above* that ball, every berry floated over the plant like
 * a balloon on a string — five crops all reading as "green sphere with things
 * on top". What a bush needs is mass: tiers that overlap into a dome, and fruit
 * on the outside at mid-height, where it silhouettes against the leaves below it
 * rather than against the sky.
 */
function bushBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)
  collar(g, 0.26, t)

  const h = 0.24 + t * 0.3

  /*
   * Small, and buried on purpose — it exists to stop the tiers showing daylight
   * through the middle of the plant, not to be seen. Which is exactly why a
   * seedling does not get one: with a single sparse tier there is nothing to
   * hide behind it, so all it did was sit there being a green ball with four
   * little leaves stuck to it. Four of the five bushes looked like a pea.
   */
  if (stage > 0) {
    const core = ball(0.1 + t * 0.06, PALETTE.leafDark, 1)
    core.scale.set(1.15, 0.95, 1.15)
    core.position.y = h * 0.45
    g.add(core)
  }

  // The species' own leaf character, or the house default for anything new.
  const leaf = LEAF_STYLE[def.fruit] ?? { width: 1, len: 1, tilt: 0, count: 1 }
  const many = (n: number) => Math.max(3, Math.round(n * leaf.count))

  leafRosette(
    g, stage === 0 ? 4 : many(9), (0.2 + t * 0.18) * leaf.len,
    def.leafColor, 0.2 + leaf.tilt, 0.04, r, undefined, leaf.width,
  )
  if (stage >= 1) {
    leafRosette(
      g, many(8), (0.19 + t * 0.19) * leaf.len,
      PALETTE.leaf, 0.55 + leaf.tilt, h * 0.42, r, def.leafColor, leaf.width,
    )
    leafRosette(
      g, many(6), (0.15 + t * 0.15) * leaf.len,
      PALETTE.leafLight, 1.0 + leaf.tilt, h * 0.78, r, PALETTE.leaf, leaf.width,
    )
  }

  // A heavier cropper carries a fourth fruit. Any more than that and they merge
  // into a band around the plant instead of reading as individual pickings.
  const n = def.yield >= 4 ? 4 : 3
  return { group: g, anchors: ring(n, 0.2 + t * 0.05, h * 0.56, 0.45), fruitSize: 0.115 }
}

function stalkBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)

  /*
   * The cactus is the exception this form has to make.
   *
   * Its fruit factory builds the entire barrel — trunk, spines and all — so
   * giving it a stalk *as well* produced a green pole with a pink tip on it, and
   * no cactus anywhere in the silhouette. It gets a low clump of pads at the
   * soil instead, and its barrel stands on the ground.
   */
  if (def.fruit === 'fig') {
    collar(g, 0.28, t)
    leafRosette(g, stage === 0 ? 3 : 6, 0.17 + t * 0.13, def.leafColor, 0.32, 0.04, r)
    const size = 0.15 + t * 0.05
    /*
     * A young cactus needs a body of its own.
     *
     * Fruit is only built from stage 2, and for this species the fruit factory
     * builds the barrel — so for the first half of its life the plot held a
     * couple of pads and nothing else, and a growing cactus was invisible. This
     * nub is what the barrel grows out of.
     */
    if (stage < 2) {
      const nubH = 0.12 + t * 0.2
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.07 + t * 0.05, 0.08 + t * 0.05, nubH, 8), mat(def.leafColor))
      nub.castShadow = true
      nub.receiveShadow = true
      nub.position.y = nubH / 2
      g.add(nub)
      const cap = ball(0.07 + t * 0.05, def.leafColor, 1)
      cap.scale.y = 0.6
      cap.position.y = nubH
      g.add(cap)
    }
    return { group: g, anchors: [{ pos: new THREE.Vector3(0, FRUIT_DROP.fig! * size, 0) }], fruitSize: size }
  }

  // Shorter than it was. Both crops on this form carry one big thing at the top
  // or the middle, and a 1.2-unit stalk made that thing a fifth of the plant.
  const h = 0.3 + t * 0.82
  collar(g, 0.24, t)

  // Chunky, because it has to look like it could hold up what it is carrying.
  // At the old radius this was a wire with a cob hanging off it.
  const stem = cyl(0.055, 0.095, h, def.leafColor, 8)
  stem.position.y = h / 2
  g.add(stem)

  /*
   * Blades spiral up the stalk: longest at the bottom, arching over further the
   * higher they start.
   *
   * Long and comparatively narrow, unlike every other leaf in the game. A corn
   * leaf is a strap, and drawn at the rosette's broad spoon proportions the
   * plant came out as a fistful of green fingers pointing at the camera.
   */
  const blades = stage === 0 ? 2 : 5 + stage
  for (let i = 0; i < blades; i++) {
    const f = i / blades
    const blade = leafPad(
      0.5 + (1 - f) * 0.44,
      i % 2 ? def.leafColor : PALETTE.leaf,
      // All of them lifted, fanning like a fountain. Sweeping the top ones down
      // past horizontal left them sticking straight out at the camera, where a
      // foreshortened pad is a stubby green finger and nothing else.
      0.58 - f * 0.26,
      /*
       * Spin per *leaf*, not per fraction of the stalk.
       *
       * This used to be `f * 4.1`, and since f is i/blades the whole set only
       * ever swept 4.1 radians total — every leaf on one side of the plant, none
       * on the other. Corn has looked like a hand of green fingers held up beside
       * a stalk for as long as the form has existed, and this one character is
       * why. 2.4 rad is the golden angle, which is what a real stalk does.
       */
      i * 2.399 + r() * 0.2,
      // Not narrower than this. The leaf pad is a flattened sphere, so its
      // thickness is fixed by its length — squeeze the width down and the ratio
      // stops reading as a blade and starts reading as a sausage, which is what
      // a 0.5-wide corn leaf looked like.
      0.78,
    )
    blade.position.y = h * (0.16 + f * 0.72)
    g.add(blade)
  }

  if (def.fruit === 'cob') {
    // Corn: a tassel crowns the stalk, and the ear leans out of it at half height
    // where nothing else competes with it.
    if (stage >= 1) {
      for (let i = 0; i < 5; i++) {
        const spike = leafPad(0.17 + t * 0.08, PALETTE.leafLight, 1.35, (i / 5) * Math.PI * 2, 0.28)
        spike.position.y = h - 0.02
        g.add(spike)
      }
    }
    /*
     * Three ears, alternating sides up the stalk.
     *
     * One ear on a stalk this tall left most of the plant as bare stem, and a
     * corn plant carrying a single cob does not read as a crop worth 84 coins.
     * Real maize carries two or three, each in the crook where a leaf leaves the
     * stem — so they alternate around the stalk rather than stacking on one
     * side, and the lowest sits proudest because it has had longest to fill.
     */
    const EARS = stage >= 3 ? 3 : 2
    const anchors: Anchor[] = []
    for (let i = 0; i < EARS; i++) {
      // Roughly opposite each other, but off a half turn so the third does not
      // land back on top of the first.
      const yaw = 0.9 + i * 2.2
      // Kept to the lower two thirds. Higher than that and the top ear crowds
      // the tassel, which turns the crown into a yellow-and-green muddle.
      const up = 0.26 + i * 0.17
      anchors.push({
        // Well clear of the stalk: the blades radiate far enough that an ear
        // tucked against it is behind a leaf from most angles.
        pos: new THREE.Vector3(Math.sin(yaw) * 0.2, h * up, Math.cos(yaw) * 0.2),
        tilt: 0.5,
        yaw,
      })
    }
    return { group: g, anchors, fruitSize: 0.17 }
  }

  /*
   * Sunflower: the head crowns the stalk and nods forward.
   *
   * The nod is small on purpose. The head is built face-up so it reads from any
   * spin, and the plant's spin is random — so any nod steeper than about twenty
   * degrees turns the face away from a camera sitting at the game's own 17° and
   * shows its back instead. This is the most it can lean and still always be a
   * sunflower.
   */
  return { group: g, anchors: [{ pos: new THREE.Vector3(0, h + 0.03, 0), tilt: 0.34 }], fruitSize: 0.27 }
}

/**
 * Vines sprawl rather than climb: pads pressed flat to the soil in a ring, with
 * the fruit standing in the clearing they leave.
 *
 * Both halves of that matter. The old pads were stacked at the centre and the
 * fruit anchored 0.04 above the soil, so a melon sank half of itself into the
 * ground and what showed was a striped dome sitting in a nest of cabbage. Push
 * the leaves outward and stand the fruit on the surface and the same geometry
 * reads correctly.
 */
function vineBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)
  collar(g, 0.24, t)

  // Grapes trail several small bunches; a pumpkin or a melon is one big fruit,
  // and the plant exists to frame it.
  const single = def.fruit !== 'bunch'
  const size = single ? (def.fruit === 'gourd' ? 0.3 : 0.27) : 0.2

  const vine = VINE_STYLE[def.fruit] ?? { len: 1, width: 1, count: 1, reach: 1, tilt: 0, rise: 0 }
  // A climber grows a short stem to hold its leaves off the soil.
  const rise = vine.rise * (0.3 + t * 0.7)
  if (rise > 0.01) {
    const stem = cyl(0.03, 0.045, rise, PALETTE.leafDark, 6)
    stem.position.y = rise / 2
    g.add(stem)
  }

  const pads = stage === 0 ? 4 : Math.max(6, Math.round(11 * vine.count))
  for (let i = 0; i < pads; i++) {
    const spin = (i / pads) * Math.PI * 2 + (r() - 0.5) * 0.3
    const reach = ((single ? 0.19 + t * 0.14 : 0.12 + t * 0.08) + r() * 0.04) * vine.reach
    // Young vines stand their leaves up and only flatten out as they sprawl —
    // a seedling laid flat on the soil is a green smear you cannot see is there.
    const pad = leafPad(
      (0.27 + t * 0.14) * vine.len,
      i % 2 ? def.leafColor : PALETTE.leafLight,
      0.12 + (1 - t) * 0.5 + vine.tilt,
      spin,
      1.2 * vine.width,
    )
    pad.position.set(Math.sin(spin) * reach, 0.03 + rise, Math.cos(spin) * reach)
    g.add(pad)
  }

  /*
   * Tendrils, and only the grapevine gets a proper set of them.
   *
   * A curl of green wire is the signature of a *climber* — the thing that
   * reaches for a trellis. A pumpkin does put out tendrils, but nobody pictures
   * one when they picture a pumpkin, and the single stray curl every vine used
   * to grow read as a stray piece of geometry rather than as a feature.
   */
  const curls = def.fruit === 'bunch' ? 4 : stage >= 2 ? 1 : 0
  for (let i = 0; i < curls; i++) {
    const a = (i / Math.max(1, curls)) * Math.PI * 2 + 0.9
    const reachOut = 0.24 * vine.reach
    const tendril = cyl(0.01, 0.02, 0.2 + t * 0.14, PALETTE.leafDark, 4)
    tendril.position.set(Math.cos(a) * reachOut, 0.1 + rise, Math.sin(a) * reachOut)
    tendril.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9 + 0.5)
    g.add(tendril)
  }

  // Lifted by the fruit's own drop so it rests on the soil instead of in it.
  const y = size * (FRUIT_DROP[def.fruit] ?? 1) + rise
  const anchors = single
    ? [{ pos: new THREE.Vector3(0, y, 0) }]
    : ring(3, (0.24 + t * 0.06) * vine.reach, y, 0)
  return { group: g, anchors, fruitSize: size }
}

/**
 * Trees: a short tapered trunk under a broad canopy, fruit hung on its rim.
 *
 * Two problems were being solved. The trunk was 1.2 units of bare pole under a
 * 0.3-radius ball, which is a lollipop, not a tree — a fruit tree's canopy is
 * wider than its trunk is tall. And the fruit anchored *inside* that ball, so
 * all three tree crops rendered as the same green blob and you could not tell an
 * apple from a coconut. Fruit now hangs on the canopy's lower outer edge, where
 * it breaks the silhouette.
 */
function treeBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)
  // The species' crown character, or the house default for anything new.
  const crownStyle = CROWN_STYLE[def.fruit] ?? { rad: 1, trunk: 1, squash: 1, lobes: 1, sun: 0.22 }
  const h = (0.28 + t * 0.52) * crownStyle.trunk
  collar(g, 0.2, t)

  /*
   * The trunk, in three parts rather than one cylinder.
   *
   * A single tapered cylinder is a post, and it is what made all three tree
   * crops read as lollipops however good their canopies got. A tree meets the
   * ground in a *flare* — the base spreads out into its roots — and it does not
   * grow perfectly plumb. Both are cheap: one squashed sphere at the foot, and a
   * lean of a few degrees carried by the whole crown so the canopy sits over it.
   */
  const lean = (r() - 0.5) * 0.16
  // Slimmer than it was. A fruit tree's trunk is thin next to its crown, and at
  // the old girth the canopy looked like a shrub balanced on a fence post.
  const trunk = cyl(0.042 + t * 0.018, 0.062 + t * 0.028, h, PALETTE.bark, 8)
  trunk.position.y = h / 2
  trunk.rotation.z = lean
  g.add(trunk)

  /*
   * The base spreads into the ground rather than meeting it at a line.
   *
   * Built from a ring of small buttresses, not from one dark disc: a squashed
   * sphere at the foot reads as a *collar* — a band of a different colour around
   * the trunk — and the previous root spurs, being cylinders angled outward,
   * read as a bracket bolted on. Overlapping lumps that get lower as they get
   * further out is what actually looks like wood spreading.
   */
  const buttresses = 6
  for (let i = 0; i < buttresses; i++) {
    const a = (i / buttresses) * Math.PI * 2 + r() * 0.4
    const reach = 0.055 + t * 0.03 + r() * 0.012
    const root = ball(0.035 + t * 0.016, PALETTE.bark, 1)
    root.scale.set(1.5, 0.85, 1)
    root.position.set(Math.cos(a) * reach, 0.022, Math.sin(a) * reach)
    root.rotation.y = -a
    g.add(root)
  }

  // Where the crown ends up once the lean is accounted for. Everything above
  // this point is offset by it, so the canopy stays over the top of the trunk.
  const tipX = -Math.sin(lean) * h

  if (stage === 0) {
    /*
     * A sapling is a twig with two leaves — no canopy to speak of yet.
     *
     * The twig has to be a twig, though. It was sharing the mature trunk's
     * radius, which at this height is a fence post with a pair of leaves nailed
     * to the top, and all three tree crops looked like the same offcut. Thinner,
     * with leaves big enough to be the thing you notice.
     */
    trunk.scale.set(0.62, 1, 0.62)
    leafRosette(g, 3, 0.3, def.leafColor, 0.55, h * 0.94, r, undefined, 1.15)
    return { group: g, anchors: [], fruitSize: 0.11 }
  }

  /*
   * The coconut is a palm, and that is the one thing that tells it apart from
   * the apple at a glance. Long fronds arching off a bare crown, nuts clustered
   * in the joint underneath them — no canopy ball at all.
   */
  if (def.fruit === 'husk') {
    /*
     * The palm. Fronds are built as a shaft with leaflets rather than as one
     * pad: a coconut palm's frond is the most recognisable leaf shape in the
     * game's whole catalogue, and a smooth blade throws that away.
     */
    const fronds = 4 + stage
    for (let i = 0; i < fronds; i++) {
      const spin = (i / fronds) * Math.PI * 2 + r() * 0.3
      const droop = 0.34 - (i % 3) * 0.3
      const len = 0.42 + t * 0.26
      const frond = leafPad(len, i % 2 ? def.leafColor : PALETTE.leaf, droop, spin, 0.34)
      frond.position.set(tipX, h + 0.02, 0)
      g.add(frond)
      // Leaflets down each side, shortening toward the tip.
      for (let j = 1; j <= 4; j++) {
        const f = j / 5
        for (const side of [-1, 1]) {
          const leaflet = leafPad(len * (0.4 - f * 0.16), PALETTE.leafLight, droop - 0.25, spin + side * 0.75, 0.3)
          leaflet.position.set(
            tipX + Math.sin(spin) * len * f * Math.cos(droop),
            h + 0.02 + Math.sin(droop) * len * f,
            Math.cos(spin) * len * f * Math.cos(droop),
          )
          g.add(leaflet)
        }
      }
    }
    // Small: it is the joint the fronds spring from, and at the old size it was
    // a lid that hid every nut hanging underneath it.
    const crown = ball(0.06 + t * 0.03, PALETTE.barkDark, 1)
    crown.position.set(tipX, h, 0)
    g.add(crown)
    // Nuts clustered in the crook under the fronds. Pushed well clear of the
    // trunk: at a radius near the trunk's own, three quarters of each nut is
    // inside the wood and what shows is a brown freckle.
    const nuts = ring(3, 0.24, h - 0.04, 0.5)
    for (const a of nuts) a.pos.x += tipX
    return { group: g, anchors: nuts, fruitSize: 0.19 }
  }

  /*
   * Branches, then a canopy in two layers.
   *
   * The branches are the reason this reads as a tree rather than as a hedge on a
   * stick: they connect the trunk to the leaf mass, so the crown looks *carried*
   * instead of balanced. They also give the fruit somewhere to hang from — each
   * one ends where an anchor is, which is not a coincidence.
   */
  const rad = (0.26 + t * 0.15) * crownStyle.rad
  const phase = 0.7
  // Where fruit hangs: out at the canopy's rim, below its middle.
  const fruitRing = rad * 1.0
  const fruitY = h + rad * 0.36

  const BOUGHS = 3
  for (let i = 0; i < BOUGHS; i++) {
    const a = (i / BOUGHS) * Math.PI * 2 + phase
    const rise = fruitY - h
    const bough = cyl(0.018, 0.038 + t * 0.014, Math.hypot(fruitRing, rise), PALETTE.bark, 5)
    bough.position.set(tipX + Math.cos(a) * fruitRing * 0.5, h + rise * 0.5, Math.sin(a) * fruitRing * 0.5)
    // Lay the cylinder along the branch: tilt away from vertical by the angle
    // the reach makes with the rise, in the direction of the branch.
    const tilt = Math.atan2(fruitRing, rise)
    bough.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)
    g.add(bough)
  }

  /*
   * The canopy: one core, then a shell of smaller lobes over a hemisphere.
   *
   * The version this replaces was two big spheres with a couple of lobes wedged
   * between them, and at any real size it read as green boulders — a smooth
   * low-poly outline with nothing leafy about it. The silhouette is the whole
   * job at this camera distance, and a bumpy outline is what makes a mass of
   * geometry read as foliage. Many small lobes give that; two big ones cannot,
   * however they are arranged.
   *
   * Placed on a golden-angle spiral rather than a ring, because a ring of lobes
   * has a period and the eye finds it immediately — the tree ends up looking
   * turned on a lathe.
   */
  const centreY = h + rad * 0.62 * crownStyle.squash
  const core = ball(rad * 0.95, def.leafColor, 1)
  core.scale.y = 0.88 * crownStyle.squash
  core.position.set(tipX, centreY, 0)
  g.add(core)

  /*
   * Lobes that bulge *just past* the core, not spheres orbiting it.
   *
   * The distance from the centre is the whole control here, and it is easy to
   * get wrong in both directions. Two large spheres set close together gave a
   * smooth low-poly outline that read as green boulders; pushing lobes out to
   * near a full radius, which was the correction, made them separate objects and
   * the tree became a bunch of avocados. Sitting them at six tenths of a radius
   * with a radius of four tenths means every lobe overlaps the core deeply and
   * clears its surface by a little — one mass, with a bumpy edge.
   */
  const LOBES = Math.max(5, Math.round(8 * crownStyle.lobes))
  const GOLD = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < LOBES; i++) {
    // Crown down to just past the equator: the underside stays closed, and the
    // canopy is a dome rather than a ball.
    const y = 0.85 - (i / (LOBES - 1)) * 1.15
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const a = GOLD * i
    // Upper lobes catch the sun, lower ones sit in the crown's shade. Two tones
    // are what give the mass any depth — one flat green is a cut-out.
    // Sunlit lobes are the species' own colour lifted, not a shared palette
    // green — a paler crown is half of what separates the two orchard trees.
    const lobe = ball(
      rad * (0.38 + r() * 0.09),
      y > 0.2 ? lighten(def.leafColor, crownStyle.sun) : def.leafColor,
      1,
    )
    lobe.scale.y = 0.9 * crownStyle.squash
    lobe.position.set(
      tipX + Math.cos(a) * ring * rad * 0.6,
      centreY + y * rad * 0.58,
      Math.sin(a) * ring * rad * 0.6,
    )
    g.add(lobe)
  }

  /*
   * A fringe of leaves under the rim, and only there.
   *
   * Pads over the whole canopy was the other failed correction: a leaf pad
   * points along its own axis, so scattered over a dome they stick out radially
   * like a horse chestnut and the tree grows spikes. Under the rim they hang the
   * way leaves hang, they soften the one edge the fruit is silhouetted against,
   * and none of them points at the camera.
   */
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 1.1 + r() * 0.3
    const pad = leafPad(rad * (0.55 + r() * 0.25), i % 2 ? def.leafColor : PALETTE.leafDark, -0.35 - r() * 0.3, a, 1)
    pad.position.set(tipX + Math.cos(a) * rad * 0.5, centreY - rad * 0.42, Math.sin(a) * rad * 0.5)
    g.add(pad)
  }

  /*
   * On the rim, and *outside* it.
   *
   * The canopy reaches about 1.5 radii from the trunk once the offset lobes are
   * counted, so a fruit hung at 0.86 of one radius is inside the leaves with
   * only its cheek showing — which is how an apple, a coconut and a starfruit
   * all came to look like the same green ball. Hung past the rim and level with
   * the canopy's underside, the fruit breaks the outline instead — and lands on
   * the end of a bough, since both use the same ring and phase.
   */
  const anchors = ring(3, fruitRing, fruitY, 0.34, phase)
  for (const a of anchors) a.pos.x += tipX
  // Smaller than it was: at 0.15 an apple was a third of the canopy's width and
  // the tree read as a hat-stand with two beach balls on it.
  return { group: g, anchors, fruitSize: 0.115 }
}

/**
 * The moonbloom's form: a single stem carrying one flower.
 *
 * It was a navy wire nearly a metre and a half tall with three leaves at the
 * bottom and a bloom the size of a coin on top — a lollipop stick. Shorter,
 * thicker, and with a second pair of leaves partway up so the eye has somewhere
 * to stop between the soil and the flower.
 */
function flowerBody(def: CropDef, stage: number, r: () => number): Body {
  const g = new THREE.Group()
  const t = stage / (GROWTH_STAGES - 1)
  const h = 0.2 + t * 0.52
  collar(g, 0.2, t)

  const stem = cyl(0.042, 0.062, h, def.leafColor, 7)
  stem.position.y = h / 2
  g.add(stem)

  leafRosette(g, stage === 0 ? 2 : 6, 0.22 + t * 0.2, def.leafColor, 0.5, 0.05, r)
  if (stage >= 1) leafRosette(g, 3, 0.17 + t * 0.14, def.leafColor, 0.75, h * 0.45, r)

  return { group: g, anchors: [{ pos: new THREE.Vector3(0, h + 0.02, 0), tilt: 0.3 }], fruitSize: 0.23 }
}

function buildBody(def: CropDef, stage: number, r: () => number): Body {
  switch (def.form) {
    case 'root':
      return rootBody(def, stage, r)
    case 'bush':
      return bushBody(def, stage, r)
    case 'stalk':
      return stalkBody(def, stage, r)
    case 'vine':
      return vineBody(def, stage, r)
    case 'tree':
      return treeBody(def, stage, r)
    case 'flower':
      return flowerBody(def, stage, r)
  }
}

// --- baking ------------------------------------------------------------------

/**
 * Baked foliage, cached per species, stage and variant.
 *
 * A plant is now twenty-odd small meshes of leaves, and a filled farm is a
 * hundred and sixty plants — left loose that is thousands of draw calls for
 * geometry that never moves relative to its own plant. Baking the foliage into
 * one vertex-coloured mesh makes the detail affordable; the fruit stays loose
 * because rarity retints it and each plant scales it independently.
 *
 * Three variants per stage is enough that no two plants in a row match, and the
 * variant is picked from the plant's own seed so it survives a stage rebuild.
 */
const VARIANTS = 3

interface BakedBody {
  geometry: THREE.BufferGeometry
  anchors: Anchor[]
  fruitSize: number
}

const bodyCache = new Map<string, BakedBody>()
/**
 * One material for every crop's foliage: vertex colours carry the species, the
 * shared detail map carries the surface. See crop-textures.ts for why one map
 * has to serve leaves, stems and trunks alike.
 */
const bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, map: cropDetailMap() })

function bakedBody(def: CropDef, stage: number, variant: number): BakedBody {
  const key = `${def.id}|${stage}|${variant}`
  let entry = bodyCache.get(key)
  if (!entry) {
    const built = buildBody(def, stage, rng((variant + 1) * 0x9e3779b1 + stage * 131))
    entry = {
      // UVs kept: unlike every other baked prop, this one samples a map.
      geometry: bakeGroup(built.group, true),
      anchors: built.anchors,
      fruitSize: built.fruitSize,
    }
    bodyCache.set(key, entry)
  }
  return entry
}

export interface CropModelOptions {
  /** Per-plant seed. The same seed always produces the same silhouette, so a
   *  crop keeps its identity as it grows through stages. */
  seed?: number
  /** Rarity tint applied to the fruit, or null for a normal crop. */
  rarityColor?: number | null
}

/**
 * Build the model for one crop at one growth stage.
 * Returned group sits on the soil surface with its origin at y=0.
 *
 * Each plant gets its own foliage variant, height, girth, fruit size and lean
 * from its seed, so a field of one crop still reads as a field of individuals
 * rather than as a stamped-out grid.
 */
export function createCropModel(def: CropDef, stage: number, opts: CropModelOptions = {}): THREE.Group {
  const seed = opts.seed ?? 1
  const r = rng(seed * 2654435761)
  const group = new THREE.Group()

  // Rarity recolours the fruit but never the foliage — the leaves are how you
  // identify the crop, the fruit is how you spot the jackpot.
  const tinted: CropDef = opts.rarityColor ? { ...def, fruitColor: opts.rarityColor } : def

  const variant = Math.floor(r() * VARIANTS)

  /*
   * Per-plant size, drawn before anything else consumes the stream.
   *
   * Order matters here and has bitten this file before. Everything below draws
   * from `r` a stage-dependent number of times — a stage-2 plant carries half as
   * many fruit as a ripe one — so a size drawn at the end lands on different
   * values at each stage and the plant changes proportions as it grows. Drawn
   * first, it is a property of the seed alone, which is what lets `farm.ts`
   * trust `baseScale` instead of re-deriving its own copy.
   */
  const girth = 1.0 + r() * 0.24
  const height = 1.32 + r() * 0.5
  /*
   * The foliage carries only the part the uniform scale does not.
   *
   * Dividing matters: the group scales *everything* by girth, so a stretch of
   * `height` on top of it would give a plant of girth × height — and the size
   * lottery multiplies that again, which took a jackpot corn from three times
   * the farmer's height to four. This way the plant ends up exactly `height`
   * tall and `girth` wide, the same two numbers as before.
   */
  const stretch = height / girth

  const body = bakedBody(tinted, stage, variant)

  /*
   * The stretch lives on the foliage, not on the whole plant.
   *
   * It used to be the group's Y scale, which meant every fruit was stretched by
   * it too — up to 1.8x taller than wide. A melon came out an egg, a turnip a
   * lightbulb, a coconut a rugby ball, and no amount of work on the fruit
   * factories could fix it because the distortion was applied after they ran.
   * Foliage is the part that should vary: a taller plant is a taller plant, but
   * a melon is a melon.
   */
  const foliage = new THREE.Mesh(body.geometry, bodyMaterial)
  foliage.castShadow = true
  foliage.receiveShadow = true
  foliage.scale.set(1, stretch, 1)
  group.add(foliage)

  // Fruit is scaled independently so a short plant can still carry a big crop.
  const fruitScale = 0.85 + r() * 0.4
  if (stage >= 2 && body.anchors.length > 0) {
    const ripe = stage === GROWTH_STAGES - 1
    // An unripe plant carries fewer, smaller fruit — a partial set reads as
    // "still filling out" without needing a separate silhouette.
    const count = ripe ? body.anchors.length : Math.max(1, Math.ceil(body.anchors.length / 2))
    for (let i = 0; i < count; i++) {
      const anchor = body.anchors[i]
      const fruit = createFruit(tinted, ripe, body.fruitSize, r, opts.rarityColor ?? null)
      // Anchors are quoted in the *unstretched* body, so the height has to be
      // carried across by hand now that the group no longer applies it.
      fruit.position.set(anchor.pos.x, anchor.pos.y * stretch, anchor.pos.z)
      // YXZ so the lean is applied in the yawed frame — otherwise a fruit tips
      // toward world +Z whichever way round the plant it is hanging.
      fruit.rotation.order = 'YXZ'
      fruit.rotation.y = anchor.yaw ?? r() * Math.PI * 2
      fruit.rotation.x = anchor.tilt ?? 0
      fruit.scale.multiplyScalar(fruitScale)
      group.add(fruit)
    }
  }

  group.scale.setScalar(girth)
  // Remembered so a caller can scale the whole plant for a growth tween without
  // having to re-derive the per-plant jitter it would otherwise overwrite.
  group.userData.baseScale = group.scale.clone()
  // How much taller than wide this plant is, so a caller can still work out how
  // far it reaches — the group's own scale no longer says.
  group.userData.stretch = stretch
  group.rotation.y = r() * Math.PI * 2
  // A slight lean stops a row from looking like it was placed with a ruler.
  group.rotation.z = (r() - 0.5) * 0.14
  group.rotation.x = (r() - 0.5) * 0.14

  return group
}
