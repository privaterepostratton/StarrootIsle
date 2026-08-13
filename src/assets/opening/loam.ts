import * as THREE from 'three'
import { groundHeight } from '../../game/terrain'

/**
 * Dark volcanic loam — the ground the island shows once a pocket is cleared.
 *
 * The first pass drew cleared ground as flat near-black circles. On screen they
 * did not read as soil at all: hard-edged, unlit, valueless blobs that the eye
 * files as *shadow bugs* rather than as earth. Three things were wrong, and
 * this module fixes all three at once.
 *
 *  1. **Value.** The old colour was authored at the value we wanted to *see*.
 *     But the beach holds at hour 7.2, the sun is barely off the horizon, and a
 *     horizontal lambert surface there comes back at roughly 55 % of its albedo
 *     — so `#33281E` landed on screen at `#1D160C`, a third of the grass's
 *     luminance, which is the luminance of a hole. The ramp here is authored
 *     *pre-light*: `#4A3A2B → #7A6047` renders as `#292018 → #443628`, exactly
 *     the warm brown-black band the spec asks for. It is still the darkest
 *     value on screen; it is no longer a void. (The 1.2 saturation grade wants
 *     the chroma kept modest, so these sit a step toward grey of true soil.)
 *
 *  2. **Shape.** A circle is a decal; soil is a stain. The outline is a noisy
 *     radial blob and the outer third feathers to zero alpha through per-vertex
 *     alpha, so a patch dissolves into the grass instead of cutting it.
 *
 *  3. **Surface.** Two octaves of value noise in *world* space give broad damp
 *     blotches and fine grit, and a scatter of small crumb quads sits proud of
 *     the surface. Because the noise is sampled in world space, two overlapping
 *     patches share one continuous field — a cleared pocket reads as one bed of
 *     turned earth, not as a pile of discs.
 *
 * Terrain vertices are baked and must never be touched (contract §6, risk 6),
 * so the patch is a low-poly mesh whose every vertex samples `groundHeight`.
 * It drapes over the farm pad's slope the way a decal cannot.
 */

/* ------------------------------------------------------------------ palette */

/** Wet volcanic loam, the darkest tone. Renders ≈ #292018. */
const LOAM_DARK = 0x4a3a2b
/** The body colour of turned earth. Warmed a step — see RAMP_LOAM. */
const LOAM_MID = 0x6b5138
/** Dry crumbs and the sun-faded rim. Renders ≈ #443628. */
const LOAM_DRY = 0x846743

/**
 * A three-tone soil ramp: wet/dark → body → dry crumb.
 *
 * Exposed because the opening needs two different floors out of one builder.
 * The pocket is turned earth; the jungle around it is duff — the same
 * construction, a different ramp — and running both through the same noise
 * field is what stops the two from meeting in a seam.
 */
export interface LoamRamp {
  dark: number
  mid: number
  dry: number
}

/** Turned volcanic earth: the cleared pocket and the dug beds. */
export const RAMP_LOAM: LoamRamp = { dark: LOAM_DARK, mid: LOAM_MID, dry: LOAM_DRY }

/**
 * Jungle duff — the floor *inside* the treeline, before anybody clears it.
 *
 * Authored a step toward green from the loam ramp and a shade lighter, so the
 * two read as the same ground in two states: the pocket is where the litter has
 * been scraped off and the wet earth turned over. It is still much darker than
 * the valley's grass, which is the whole point — a jungle interior is a place
 * light does not reach, and the first build's mown emerald lawn is what this
 * exists to delete.
 *
 * Basalt grit is carried by the `grit` option rather than by a fourth tone
 * here: flecks of near-black are a scatter, not a band in a ramp.
 */
export const RAMP_DUFF: LoamRamp = { dark: 0x40382a, mid: 0x554932, dry: 0x6b5b3f }

/**
 * The band where the jungle floor meets open valley grass — deep shade green.
 *
 * Authored pre-light: measured off a capture, the dawn rig plus the 1.2
 * saturation grade take these down by roughly a third, landing the body tone
 * near the spec's deep jungle `#2E6B3A`. Used as a skirt outside the wall so
 * the strip of lit lawn between the sand and the trees — the hem that made the
 * whole island read as mown — stops being the brightest green in frame.
 */
export const RAMP_SHADE_GREEN: LoamRamp = { dark: 0x3a6040, mid: 0x497c49, dry: 0x5b8f52 }

/** Near-black volcanic grit, scattered as flecks over any of the ramps. */
const GRIT = 0x2a2622

/**
 * Pale volcanic ash, thresholded into flecks the same way the grit is.
 *
 * Turned earth on a volcanic island is not one brown: it is dark wet crumb with
 * *light* mineral through it, and the light half is what the eye reads as
 * "somebody dug this" rather than as a stain. Grit alone can only ever make the
 * patch darker, which is why the bed under the beds photographed as a smear —
 * every note in it was below the floor's value and none of them separated.
 */
const ASH = 0xa89a80

/**
 * Leaf litter, dry to barely-fallen.
 *
 * Five tones rather than one: a forest floor's litter is a *value* scatter, and
 * a single ochre would land as texture noise instead of as individual leaves.
 * Authored pre-light like every other colour here.
 */
const LITTER_TONES = [0x9a8348, 0x7a6134, 0x8c8a45, 0x5f5730, 0x556f34]

/** Fallen frond blades — longer, drier, a step toward straw. */
const FROND_TONES = [0x9c8b4e, 0x847a45, 0x6e6234]

/** Small basalt stones: near-black body, salt-bleached crown. */
const STONE_DARK = 0x322e29
const STONE_TOP = 0x554e44

/**
 * Exposed roots — old wood, lighter than the soil they break, and deliberately
 * low in chroma: a saturated brown ribbon on a green floor reads as a worm.
 */
const ROOT_DARK = 0x494130
const ROOT_LIT = 0x7a7050

/** Default height above the sampled terrain, in world units. */
const LIFT = 0.03
/** Crumb quads ride a whisker higher again so they never z-fight the bed. */
const CRUMB_LIFT = 0.016
/** Fraction of the radius spent feathering out to nothing. */
const FEATHER = 0.42
/** Target world-space size of one grid cell. */
const CELL = 0.38

/* -------------------------------------------------------------------- noise */

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Smoothed value noise. Cheap, deterministic, and continuous across patches. */
function vnoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const tmpA = new THREE.Color()
const tmpB = new THREE.Color()

/* --------------------------------------------------------------------- api */

export interface LoamPatchOptions {
  /** World centre. Only x/z are read — y comes from the terrain per vertex. */
  centre: THREE.Vector3
  /** Footprint width (x) and depth (z), in world units. */
  w: number
  d: number
  /** Seeds the blob outline and the crumb scatter. Same seed ⇒ same patch. */
  seed?: number
  /** Height above the sampled ground. Stagger it to order overlapping patches. */
  lift?: number
  /** 0..1 — fraction of the radius spent fading out. Bigger = softer edge. */
  feather?: number
  /** Soil ramp. Defaults to turned volcanic earth (`RAMP_LOAM`). */
  ramp?: LoamRamp
  /** Cap on grid cells per axis. Raise it for fields larger than a few units. */
  maxCells?: number
  /** 0..1 — how much near-black basalt grit speckles the surface. */
  grit?: number
  /** Multiplier on the crumb-quad count. 0 drops them (they cost verts). */
  crumbs?: number
  /**
   * Extra 0..1 alpha multiplier sampled per vertex in world space.
   *
   * The reason this exists: a ground field big enough to kill the lawn is also
   * big enough to run out over the sand, and a patch of jungle floor lying on a
   * beach is worse than the lawn was. Hand it `isSand` and the field stops at
   * the shoreline on its own, following the real coast rather than a rectangle
   * somebody guessed at.
   */
  mask?: (wx: number, wz: number) => number
  /**
   * 0..1 — dappled canopy light painted into the vertex colours.
   *
   * **The single most important option here.** Dawn through a canopy does not
   * light a floor evenly; it lays long pools of gold between long bars of
   * shade, and a jungle floor without that is a tarp. The scene cannot cast it
   * for real — the clearing is open to the sky and the wall's ranks are
   * instanced and shadowless by design — so it is authored, at a frequency low
   * enough to survive the coarse tessellation a twenty-five-unit field needs.
   *
   * Stretched along x on purpose: the key is low in the east, so everything it
   * throws runs seaward, and streaks read as cast shadow where round blotches
   * read as dirt.
   */
  dapple?: number
  /** 0..1 — how much light-mineral ash flecks through the soil. */
  ash?: number
  /** 0..1 — corrugation across the patch, the mark of a shovel worked over it. */
  tilled?: number
  /** Multiplier on the scattered leaf/frond litter count. 0 drops it. */
  litter?: number
  /** Multiplier on the scattered pebble count. 0 drops it. */
  stones?: number
  /** Multiplier on the surfaced-root count. 0 drops it. */
  roots?: number
}

export interface LoamPatch {
  /** The patch mesh. Add it to a scene group; it is a single draw call. */
  object: THREE.Object3D
  /** Same object, typed — the fade helper below wants the material. */
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  /** 0..1 reveal. Vertex alpha still shapes the feather underneath it. */
  setOpacity(o: number): void
  dispose(): void
}

/**
 * Build one patch of loam conforming to the terrain under it.
 *
 * The mesh is an indexed grid plus a handful of appended crumb quads, sharing
 * one position/colour buffer so the whole patch — bed, feathered rim and grit —
 * is a single draw call. Vertex colour carries alpha (three enables
 * `USE_COLOR_ALPHA` for a 4-component colour attribute), which is what lets the
 * rim dissolve while `material.opacity` stays free for the reveal fade.
 */
export function createLoamPatch(opts: LoamPatchOptions): LoamPatch {
  const centre = opts.centre
  const w = opts.w
  const depth = opts.d
  const seed = opts.seed ?? 0
  const lift = opts.lift ?? LIFT
  const feather = Math.min(0.8, Math.max(0.05, opts.feather ?? FEATHER))
  const ramp = opts.ramp ?? RAMP_LOAM
  const maxCells = Math.max(5, Math.round(opts.maxCells ?? 18))
  /*
   * The defaults describe *turned volcanic earth under a dappled canopy*,
   * because that is what every caller who does not say otherwise is drawing:
   * the cleared pocket and the dug beds. Grit, ash and tilling are what turn
   * the bed from a muddy smear into something the player can see was worked —
   * dark crumb, pale mineral, a faint corrugation where the shovel went. Dapple
   * defaults on for a different reason: the pocket lies *inside* the jungle
   * floor, so it has to be crossed by the same bars of light and shade, or the
   * one patch of ground the player made is the one patch the sun does not
   * reach. The big green floor fields override all of these explicitly.
   */
  const gritAmount = Math.min(1, Math.max(0, opts.grit ?? 0.22))
  const dappleAmount = Math.min(1, Math.max(0, opts.dapple ?? 0.45))
  const ashAmount = Math.min(1, Math.max(0, opts.ash ?? 0.5))
  const tilledAmount = Math.min(1, Math.max(0, opts.tilled ?? 0.35))

  const cols = Math.min(maxCells, Math.max(5, Math.round(w / CELL)))
  const rows = Math.min(maxCells, Math.max(5, Math.round(depth / CELL)))
  const gw = cols + 1

  // Seed offsets keep two patches at the same spot from being twins, while the
  // colour noise stays keyed to world position so neighbours blend seamlessly.
  const so = (seed % 977) * 0.618
  const p1 = so * 1.7
  const p2 = so * 2.9 + 1.1
  const p3 = so * 0.7 + 2.3

  /** The irregular outline: three low harmonics, mean radius 1. */
  const blobRadius = (theta: number) =>
    1 + 0.19 * Math.sin(3 * theta + p1) + 0.12 * Math.sin(5 * theta + p2) + 0.07 * Math.sin(7 * theta + p3)

  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const mask = opts.mask

  /** Alpha at a normalised offset from the centre (nx, nz ∈ [-1, 1]). */
  const alphaAt = (nx: number, nz: number) => {
    const rr = Math.hypot(nx, nz)
    if (rr < 1e-5) return 1
    const t = rr / blobRadius(Math.atan2(nz, nx))
    return 1 - smoothstep(1 - feather, 1, t)
  }

  /** Blob alpha times the caller's world-space mask. */
  const alphaWorld = (nx: number, nz: number, wx: number, wz: number) => {
    const a = alphaAt(nx, nz)
    return mask ? a * Math.min(1, Math.max(0, mask(wx, wz))) : a
  }

  /**
   * The surface field at a world position: 0 = wet and dark, 1 = dry and pale.
   *
   * **Four octaves, and the low two are the fix for the flat blanket.** The
   * original pair ran at 1.7 and 6.9 — features 0.6 and 0.15 units across. On a
   * two-metre pocket, sampled every 0.2 units, that is grain. On the jungle's
   * twenty-five-unit floor, which cannot afford vertices closer than a quarter
   * of a metre, both octaves sit far above the sampling rate and average
   * themselves out: every vertex draws the same mid-tone and the field
   * photographs as one sheet of green felt. Adding octaves at 0.16 and 0.55 —
   * seven and two metres — puts damp hollows and dry rises at a size the mesh
   * can actually resolve, and leaves the fine pair to do grain where the
   * tessellation is tight enough to show it.
   *
   * The mix is re-expanded about the midpoint because averaging four
   * independent octaves narrows the distribution; without that the extra
   * octaves would buy structure and pay for it in contrast.
   */
  const surface = (wx: number, wz: number) => {
    const macro = vnoise(wx * 0.16 + so, wz * 0.16 - so)
    const meso = vnoise(wx * 0.55 - so, wz * 0.55 + so)
    const broad = vnoise(wx * 1.7 + so, wz * 1.7 - so)
    const fine = vnoise(wx * 6.9 - so, wz * 6.9 + so)
    const n = macro * 0.3 + meso * 0.26 + broad * 0.3 + fine * 0.14
    return Math.min(1, Math.max(0, 0.5 + (n - 0.5) * 1.5))
  }

  /**
   * Canopy dapple at a world position: 0 = full shade, 1 = a pool of dawn.
   *
   * Sampled anisotropically — a third the frequency across x that it has across
   * z — so the pools come out as long streaks lying seaward, the direction the
   * low eastern key throws everything else in the frame.
   */
  const dappleAt = (wx: number, wz: number) => {
    const s1 = vnoise(wx * 0.085 + so, wz * 0.3 - so)
    const s2 = vnoise(wx * 0.24 - so, wz * 0.82 + so)
    // A third, tighter octave: the broad pair alone give soft watercolour
    // washes, and a canopy also throws leaf-sized speckle. It is only worth
    // sampling on a field tessellated fine enough to carry it, which the
    // interior floor now is.
    const s3 = vnoise(wx * 0.62 + so, wz * 1.55 - so)
    const d = s1 * 0.52 + s2 * 0.31 + s3 * 0.17
    return smoothstep(0.3, 0.74, 0.5 + (d - 0.5) * 1.9)
  }

  /**
   * Fold the canopy dapple into whatever colour currently sits in `tmpA`.
   *
   * Warm light, cool shadow — and the direction of the blue term is the whole
   * difference between a forest floor and a mud flat. Every source in the dawn
   * rig is warm, so a shade that also loses blue leaves the entire field one
   * olive khaki: the lit half and the dark half differ only in brightness and
   * the green goes out of the jungle. Shade keeps its blue (sky, not sun, is
   * what reaches it) and the sun pools spend theirs going golden, which is what
   * separates the two halves by hue as well as by value.
   *
   * Everything scattered on the floor runs through this too, so a leaf lying in
   * a bar of shade is dark and a leaf in a sun pool is bright: without that the
   * litter floats above the ground it is supposed to be lying on.
   */
  const applyDapple = (wx: number, wz: number) => {
    if (dappleAmount <= 0) return
    const k = dappleAt(wx, wz)
    // Deliberately mean-neutral: full shade multiplies by ~0.6 and a sun pool
    // by ~1.8, which averages to a whisker over 1. An earlier pass had the pair
    // averaging 0.9 and the fix for a flat floor arrived as a *darker* floor —
    // dapple has to redistribute the light in the frame, not spend it. The
    // spread is wide because a timid one photographs as dirt: the pools have to
    // be bright enough to read as *sunlight* from across the clearing, which is
    // the distance beats 5, 6 and 9 actually frame this ground at.
    tmpA.setRGB(
      tmpA.r * (1 + (0.55 + k * 1.2 - 1) * dappleAmount),
      tmpA.g * (1 + (0.62 + k * 0.93 - 1) * dappleAmount),
      tmpA.b * (1 + (0.92 + k * 0.55 - 1) * dappleAmount),
    )
  }

  /** The soil ramp at a world position, pushed toward dry at the rim. */
  const pushColor = (wx: number, wz: number, alpha: number) => {
    let n = surface(wx, wz)
    if (tilledAmount > 0) {
      // Shovel corrugation: a low-amplitude ripple on a diagonal, so the bed
      // carries the memory of being worked over rather than being a poured
      // surface. Deliberately weak — a visible furrow pattern would read as a
      // texture tile, which is the failure this whole module exists to avoid.
      const furrow = Math.sin((wx * 0.82 + wz * 0.46) * Math.PI + so)
      n = Math.min(1, Math.max(0, n + furrow * 0.09 * tilledAmount))
    }
    tmpA.setHex(ramp.dark)
    tmpB.setHex(ramp.mid)
    tmpA.lerp(tmpB, smoothstep(0.22, 0.66, n))
    tmpB.setHex(ramp.dry)
    // Dry crumbs where the noise peaks, and along the feathered rim, where the
    // patch is thinning to scattered dust rather than ending in a cliff.
    tmpA.lerp(tmpB, Math.max(smoothstep(0.68, 1, n) * 0.85, (1 - alpha) * 0.55))
    if (gritAmount > 0) {
      // Basalt grit: a third octave thresholded hard, so it lands as flecks of
      // near-black rather than as a wash that just darkens the whole ramp. A
      // volcanic floor is a floor with rock in it, and rock is a different
      // *value*, not a slightly deeper brown.
      const speck = vnoise(wx * 17.3 + so, wz * 17.3 - so)
      tmpB.setHex(GRIT)
      tmpA.lerp(tmpB, smoothstep(0.62, 0.92, speck) * gritAmount)
    }
    if (ashAmount > 0) {
      // The light half of the mineral scatter. Rarer than the grit and pushed
      // further, because a handful of pale specks separates a dug bed from a
      // stain far more cheaply than any amount of extra brown.
      const fleck = vnoise(wx * 23.7 - so, wz * 23.7 + so)
      tmpB.setHex(ASH)
      tmpA.lerp(tmpB, smoothstep(0.78, 0.97, fleck) * 0.55 * ashAmount)
    }
    applyDapple(wx, wz)
    colors.push(tmpA.r, tmpA.g, tmpA.b, alpha)
  }

  // --- the bed -------------------------------------------------------------
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const border = i === 0 || j === 0 || i === cols || j === rows
      const u = i / cols - 0.5
      const v = j / rows - 0.5
      // A little in-plane jitter breaks the lattice read; the border stays put
      // (and at zero alpha) so the patch never grows past its stated footprint.
      const jx = border ? 0 : (hash2(i * 3.1 + so, j * 7.7) - 0.5) * (w / cols) * 0.55
      const jz = border ? 0 : (hash2(j * 5.3, i * 2.9 + so) - 0.5) * (depth / rows) * 0.55
      const ox = u * w + jx
      const oz = v * depth + jz
      const wx = centre.x + ox
      const wz = centre.z + oz
      const alpha = border ? 0 : alphaWorld(ox / (w / 2), oz / (depth / 2), wx, wz)
      const bump = (vnoise(wx * 6.9 - so, wz * 6.9 + so) - 0.5) * 0.02
      positions.push(wx, groundHeight(wx, wz) + lift + bump, wz)
      pushColor(wx, wz, alpha)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * gw + i
      const b = a + 1
      const c = a + gw
      indices.push(a, c, b, b, c, c + 1)
    }
  }

  // --- crumbs --------------------------------------------------------------
  // Small flat chips of turned earth, a shade lighter than the bed. They are
  // what stops a large patch from reading as a painted shape: real soil has a
  // scale you can see, and this is the cheapest way to put one there.
  const crumbScale = opts.crumbs ?? 1
  const crumbCount = Math.min(30, Math.max(0, Math.round(w * depth * 2.1 * crumbScale)))
  for (let k = 0; k < crumbCount; k++) {
    const u = (hash2(k * 1.7 + so, 11.3) - 0.5) * 1.7
    const v = (hash2(19.7, k * 2.3 + so) - 0.5) * 1.7
    const ox = (u * w) / 2
    const oz = (v * depth) / 2
    const wx = centre.x + ox
    const wz = centre.z + oz
    const alpha = alphaWorld(u, v, wx, wz)
    if (alpha < 0.35) continue
    const y = groundHeight(wx, wz) + lift + CRUMB_LIFT
    const size = 0.035 + hash2(k * 4.1, so) * 0.055
    const yaw = hash2(so, k * 6.7) * Math.PI * 2
    const ca = Math.cos(yaw)
    const sa = Math.sin(yaw)
    const base = positions.length / 3
    // An irregular quad, so the chips are not all the same little diamond.
    const quad: [number, number][] = [
      [-size, -size * 0.72],
      [size * 1.15, -size * 0.55],
      [size * 0.8, size * 0.9],
      [-size * 0.85, size * 0.6],
    ]
    for (const [qx, qz] of quad) {
      const rx = qx * ca - qz * sa
      const rz = qx * sa + qz * ca
      positions.push(wx + rx, y, wz + rz)
      // Crumbs read as the dry end of the ramp, held to the patch's own alpha.
      tmpA.setHex(ramp.dry)
      tmpB.setHex(ramp.mid)
      tmpA.lerp(tmpB, hash2(k * 8.9, so) * 0.6)
      applyDapple(wx, wz)
      colors.push(tmpA.r, tmpA.g, tmpA.b, alpha * 0.95)
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  /* ------------------------------------------------------- surface scatter */

  /**
   * Append one flat, ground-hugging polygon as a triangle fan.
   *
   * Everything scattered on the floor — leaves, frond blades, the caps of the
   * pebbles — is built through here so it all lands in the patch's single
   * buffer and the whole floor stays one draw call, which is the only reason a
   * field this size can afford a few hundred pieces of litter at all.
   */
  const pushFan = (
    wx: number,
    wz: number,
    y: number,
    shape: [number, number][],
    yaw: number,
    hex: number,
    alpha: number,
    rise = 0,
  ) => {
    const ca = Math.cos(yaw)
    const sa = Math.sin(yaw)
    const base = positions.length / 3
    tmpA.setHex(hex)
    applyDapple(wx, wz)
    const r = tmpA.r
    const g = tmpA.g
    const b = tmpA.b
    for (const [qx, qz] of shape) {
      positions.push(wx + (qx * ca - qz * sa), y, wz + (qx * sa + qz * ca))
      colors.push(r, g, b, alpha)
    }
    if (rise > 0) {
      // A crown vertex lifted off the plane turns the fan into a low dome —
      // the difference between a pebble and a sticker of a pebble.
      positions.push(wx, y + rise, wz)
      tmpA.setHex(STONE_TOP)
      applyDapple(wx, wz)
      colors.push(tmpA.r, tmpA.g, tmpA.b, alpha)
      const crown = base + shape.length
      for (let i = 0; i < shape.length; i++) {
        indices.push(crown, base + i, base + ((i + 1) % shape.length))
      }
      return
    }
    for (let i = 1; i < shape.length - 1; i++) indices.push(base, base + i, base + i + 1)
  }

  /** Scatter position + alpha, or null if the draw landed off the patch. */
  const spot = (k: number, salt: number) => {
    const u = (hash2(k * 1.93 + so + salt, 5.7 + salt) - 0.5) * 1.9
    const v = (hash2(13.1 + salt, k * 3.11 + so + salt) - 0.5) * 1.9
    const wx = centre.x + (u * w) / 2
    const wz = centre.z + (v * depth) / 2
    const alpha = alphaWorld(u, v, wx, wz)
    return alpha < 0.4 ? null : { wx, wz, alpha }
  }

  // --- leaf litter and fallen fronds ---------------------------------------
  // A forest floor is not a colour, it is a scale: things lying on it that the
  // eye can count. Sized in real units (a leaf is a hand's width, a fallen
  // frond blade is most of a metre) rather than scaled to the patch, so the
  // same option gives a two-metre pocket a few leaves and the jungle floor a
  // drift of them.
  const litterAmount = opts.litter ?? 0
  if (litterAmount > 0) {
    const count = Math.min(900, Math.round(w * depth * 0.62 * litterAmount))
    for (let k = 0; k < count; k++) {
      const at = spot(k, 0.13)
      if (!at) continue
      const y = groundHeight(at.wx, at.wz) + lift + CRUMB_LIFT * 1.6
      const yaw = hash2(so + 2.1, k * 5.9) * Math.PI * 2
      const pick = hash2(k * 7.3, so + 4.4)
      if (pick > 0.7) {
        // A fallen frond blade: long, narrow, slightly kinked.
        const len = 0.7 + hash2(k * 2.7, so) * 1.0
        const halfW = 0.06 + hash2(so, k * 9.1) * 0.055
        pushFan(
          at.wx,
          at.wz,
          y,
          [
            [-len * 0.5, 0],
            [-len * 0.12, -halfW],
            [len * 0.34, -halfW * 0.82],
            [len * 0.5, 0],
            [len * 0.3, halfW * 0.9],
            [-len * 0.15, halfW],
          ],
          yaw,
          FROND_TONES[Math.floor(hash2(k * 3.7, so + 1.9) * FROND_TONES.length) % FROND_TONES.length],
          at.alpha * 0.95,
        )
      } else {
        // A leaf: a pointed oval, wider than the crumbs by an order of size.
        const len = 0.17 + hash2(k * 1.3, so + 8.2) * 0.24
        const wid = len * (0.42 + hash2(so + 3.3, k * 4.7) * 0.3)
        pushFan(
          at.wx,
          at.wz,
          y,
          [
            [-len * 0.5, 0],
            [-len * 0.16, -wid * 0.5],
            [len * 0.28, -wid * 0.42],
            [len * 0.5, 0],
            [len * 0.24, wid * 0.46],
            [-len * 0.2, wid * 0.5],
          ],
          yaw,
          LITTER_TONES[Math.floor(hash2(k * 6.1, so + 0.7) * LITTER_TONES.length) % LITTER_TONES.length],
          at.alpha * 0.95,
        )
      }
    }
  }

  // --- small stones ---------------------------------------------------------
  // A few stones by default: turned earth on a volcanic island has rock in it,
  // and it is the cheapest thing on the surface with a real edge to catch light.
  const stoneAmount = opts.stones ?? 0.7
  if (stoneAmount > 0) {
    const count = Math.min(90, Math.round(w * depth * 0.16 * stoneAmount))
    for (let k = 0; k < count; k++) {
      const at = spot(k, 0.61)
      if (!at) continue
      const rad = 0.06 + hash2(k * 8.3, so + 6.1) * 0.13
      const y = groundHeight(at.wx, at.wz) + lift + CRUMB_LIFT
      const rim: [number, number][] = []
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const rr = rad * (0.74 + hash2(k * 2.2 + i, so) * 0.42)
        rim.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.82])
      }
      pushFan(at.wx, at.wz, y, rim, hash2(so, k * 1.4) * Math.PI * 2, STONE_DARK, at.alpha, rad * 0.55)
    }
  }

  // --- surfaced roots -------------------------------------------------------
  // Ribbons that break the soil, dip under it and break it again. Cheap, and
  // the one thing on this floor with a length to it — which is what stops the
  // scatter from reading as confetti evenly sprinkled over a flat plane.
  const rootAmount = opts.roots ?? 0
  if (rootAmount > 0) {
    const count = Math.min(40, Math.round(w * depth * 0.04 * rootAmount))
    for (let k = 0; k < count; k++) {
      const at = spot(k, 0.29)
      if (!at) continue
      const yaw = hash2(so + 5.5, k * 2.6) * Math.PI * 2
      const ca = Math.cos(yaw)
      const sa = Math.sin(yaw)
      const len = 0.9 + hash2(k * 4.9, so) * 1.5
      const halfW = 0.045 + hash2(so + 1.1, k * 3.3) * 0.045
      const segs = 6
      const base = positions.length / 3
      const y0 = groundHeight(at.wx, at.wz) + lift
      for (let i = 0; i <= segs; i++) {
        const t = i / segs
        const along = (t - 0.5) * len
        // Two humps: the root surfaces, dives and surfaces again.
        const arch = Math.max(0, Math.sin(t * Math.PI * 2.2 + hash2(k, so) * 2)) * 0.075
        const bow = Math.sin(t * Math.PI) * len * 0.12
        for (const side of [-1, 1]) {
          const ox = along
          const oz = bow + side * halfW
          positions.push(at.wx + (ox * ca - oz * sa), y0 + arch + 0.012, at.wz + (ox * sa + oz * ca))
          tmpA.setHex(ROOT_DARK)
          tmpB.setHex(ROOT_LIT)
          tmpA.lerp(tmpB, arch / 0.075)
          applyDapple(at.wx, at.wz)
          // Ends fade into the soil rather than stopping at a cut edge.
          colors.push(tmpA.r, tmpA.g, tmpA.b, at.alpha * smoothstep(0, 0.22, Math.min(t, 1 - t)))
        }
      }
      for (let i = 0; i < segs; i++) {
        const a = base + i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geo.setIndex(indices)
  geo.computeVertexNormals()

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    // Overlapping patches must blend rim-over-rim without one clipping the
    // other, and nothing is ever drawn behind a patch that needs its depth.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  mesh.castShadow = false
  // Ground decals sort under everything that stands on them.
  mesh.renderOrder = -1

  return {
    object: mesh,
    mesh,
    material,
    setOpacity(o: number) {
      material.opacity = Math.min(1, Math.max(0, o))
    },
    dispose() {
      mesh.removeFromParent()
      geo.dispose()
      material.dispose()
    },
  }
}
