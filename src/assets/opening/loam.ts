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
/** The body colour of turned earth. Renders ≈ #372B1F. */
const LOAM_MID = 0x634c37
/** Dry crumbs and the sun-faded rim. Renders ≈ #443628. */
const LOAM_DRY = 0x7a6047

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

  const cols = Math.min(18, Math.max(5, Math.round(w / CELL)))
  const rows = Math.min(18, Math.max(5, Math.round(depth / CELL)))
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

  /** Alpha at a normalised offset from the centre (nx, nz ∈ [-1, 1]). */
  const alphaAt = (nx: number, nz: number) => {
    const rr = Math.hypot(nx, nz)
    if (rr < 1e-5) return 1
    const t = rr / blobRadius(Math.atan2(nz, nx))
    return 1 - smoothstep(1 - feather, 1, t)
  }

  /** The soil ramp at a world position, pushed toward dry at the rim. */
  const pushColor = (wx: number, wz: number, alpha: number) => {
    const broad = vnoise(wx * 1.7 + so, wz * 1.7 - so)
    const grit = vnoise(wx * 6.9 - so, wz * 6.9 + so)
    const n = broad * 0.72 + grit * 0.28
    tmpA.setHex(LOAM_DARK)
    tmpB.setHex(LOAM_MID)
    tmpA.lerp(tmpB, smoothstep(0.22, 0.66, n))
    tmpB.setHex(LOAM_DRY)
    // Dry crumbs where the noise peaks, and along the feathered rim, where the
    // patch is thinning to scattered dust rather than ending in a cliff.
    tmpA.lerp(tmpB, Math.max(smoothstep(0.68, 1, n) * 0.85, (1 - alpha) * 0.55))
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
      const alpha = border ? 0 : alphaAt(ox / (w / 2), oz / (depth / 2))
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
  const crumbCount = Math.min(30, Math.max(4, Math.round(w * depth * 2.1)))
  for (let k = 0; k < crumbCount; k++) {
    const u = (hash2(k * 1.7 + so, 11.3) - 0.5) * 1.7
    const v = (hash2(19.7, k * 2.3 + so) - 0.5) * 1.7
    const alpha = alphaAt(u, v)
    if (alpha < 0.35) continue
    const ox = (u * w) / 2
    const oz = (v * depth) / 2
    const wx = centre.x + ox
    const wz = centre.z + oz
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
      tmpA.setHex(LOAM_DRY)
      tmpB.setHex(LOAM_MID)
      tmpA.lerp(tmpB, hash2(k * 8.9, so) * 0.6)
      colors.push(tmpA.r, tmpA.g, tmpA.b, alpha * 0.95)
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
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
