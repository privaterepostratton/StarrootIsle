import * as THREE from 'three'
import { rng } from './style'

/**
 * Sky dressing: distant mountain ranges and drifting clouds.
 *
 * The walkable valley is ringed by real heightfield mountains (see terrain.ts),
 * but a single ring gives a skyline with no depth — one silhouette and then sky.
 * These are layers *behind* that ring, at radii far outside anywhere the player
 * can reach, purely to give the horizon distance.
 *
 * Two decisions carry the whole look:
 *
 * *Fog is off.* Scene fog is distance-based, and these layers sit well past
 * FOG_FAR, so fog would erase them completely. Instead the aerial perspective is
 * painted into the vertex colours by hand — each layer is mixed further toward
 * the sky colour than the one in front of it. That is what reads as depth.
 *
 * *Lighting is off.* They use MeshBasicMaterial, because a lit backdrop would
 * shade against the sun direction and fight the haze baked into the vertices.
 * Time of day is applied instead as a flat tint via `setTint`, which keeps the
 * ranges consistent with the sky behind them from dawn to midnight.
 *
 * The result is a flat cutout — real parallax would need real geometry. That is
 * fine here: the camera is confined to a radius of about 110 and the nearest
 * layer is at 190, so the parallax being missed is very small.
 */

/** Rock, snow and the sky colour the haze mixes toward. */
const C_ROCK = new THREE.Color(0x7f8b9c)
const C_ROCK_LOW = new THREE.Color(0x6d7f7a)
const C_SNOW = new THREE.Color(0xf4f8ff)
const C_SKY = new THREE.Color(0x8fd4f2)

interface RangeLayer {
  radius: number
  segments: number
  /** Height of a nominal summit. */
  rise: number
  /** Floor multiplier — how high the saddles sit relative to a summit. */
  saddle: number
  summits: number
  /** 0 = crisp, 1 = fully dissolved into the sky. */
  haze: number
  seed: number
}

/**
 * Three ranges, each further, taller and hazier than the last.
 *
 * The heights look extreme because they have to clear the local mountain ring:
 * anything below its ridge line is occluded, so a distant range only reads at
 * all if it is tall enough to stand above it from a camera near the ground.
 */
const LAYERS: RangeLayer[] = [
  { radius: 190, segments: 190, rise: 78, saddle: 0.4, summits: 11, haze: 0.38, seed: 0x51f0a1 },
  { radius: 255, segments: 170, rise: 122, saddle: 0.38, summits: 9, haze: 0.6, seed: 0x2b71dd },
  { radius: 320, segments: 150, rise: 176, saddle: 0.36, summits: 7, haze: 0.78, seed: 0x9ac304 },
]

interface Summit {
  at: number
  height: number
  width: number
}

function makeSummits(count: number, r: () => number): Summit[] {
  const out: Summit[] = []
  for (let i = 0; i < count; i++) {
    // Evenly spaced then jittered, so no two summits collide and no arc is bare.
    const at = ((i + 0.5) / count) * Math.PI * 2 + (r() - 0.5) * (Math.PI / count)
    out.push({ at, height: 0.62 + r() * 0.62, width: 0.16 + r() * 0.16 })
  }
  return out
}

function bearingDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function profileAt(bearing: number, summits: Summit[], saddle: number) {
  let m = saddle
  for (const s of summits) {
    const d = bearingDelta(s.at, bearing) / s.width
    const peak = s.height * Math.exp(-d * d)
    if (peak > m) m = peak
  }
  return m
}

/**
 * An arc of the compass the ranges leave empty, so the sea has a horizon.
 *
 * The terrain's own mountain wall opens on one side (see terrain.ts), and a
 * painted range still standing behind that gap would put three rows of peaks on
 * the skyline above open water — the one place the eye is expecting nothing.
 * Passed in rather than imported so this file keeps its one-way dependency:
 * assets know nothing about the game layer, and world.ts hands it the numbers
 * terrain.ts already owns.
 */
export interface SkylineGap {
  at: number
  half: number
  feather: number
}

/** One range: a closed ring of inward-facing quads under a summit profile. */
function buildRange(layer: RangeLayer, gap: SkylineGap | null): THREE.Mesh {
  const openness = (bearing: number) =>
    gap ? 1 - smoothstep(gap.half, gap.half + gap.feather, Math.abs(bearingDelta(gap.at, bearing))) : 0

  const r = rng(layer.seed)
  const summits = makeSummits(layer.summits, r)

  const positions: number[] = []
  const colors: number[] = []
  const base = -40

  const colourAt = (h: number, y: number) => {
    // Snow only near a summit's own crown, so a low hill does not get a white
    // cap it has not earned.
    const snowT = smoothstep(0.58, 0.95, y / Math.max(h, 1e-3))
    const rock = C_ROCK_LOW.clone().lerp(C_ROCK, smoothstep(0.1, 0.6, y / Math.max(h, 1e-3)))
    return rock.lerp(C_SNOW, snowT).lerp(C_SKY, layer.haze)
  }

  const push = (x: number, y: number, z: number, h: number) => {
    positions.push(x, y, z)
    const c = colourAt(h, y)
    colors.push(c.r, c.g, c.b)
  }

  for (let i = 0; i < layer.segments; i++) {
    const a0 = (i / layer.segments) * Math.PI * 2
    const a1 = ((i + 1) / layer.segments) * Math.PI * 2

    const o0 = openness(a0)
    const o1 = openness(a1)
    // Fully open: emit nothing at all rather than a zero-height sliver, which
    // would still draw a hairline of rock along the horizon.
    if (o0 > 0.995 && o1 > 0.995) continue

    const p0 = profileAt(a0, summits, layer.saddle) * (1 - o0)
    const p1 = profileAt(a1, summits, layer.saddle) * (1 - o1)
    const h0 = p0 * layer.rise
    const h1 = p1 * layer.rise

    // Radius wobbles with the profile so the silhouette is not a perfect circle.
    const r0 = layer.radius * (1 + (p0 - layer.saddle) * 0.06)
    const r1 = layer.radius * (1 + (p1 - layer.saddle) * 0.06)

    const x0 = Math.cos(a0) * r0
    const z0 = Math.sin(a0) * r0
    const x1 = Math.cos(a1) * r1
    const z1 = Math.sin(a1) * r1

    push(x0, base, z0, h0)
    push(x1, base, z1, h1)
    push(x1, h1, z1, h1)

    push(x0, base, z0, h0)
    push(x1, h1, z1, h1)
    push(x0, h0, z0, h0)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const mesh = new THREE.Mesh(
    geo,
    // Double-sided so the ring reads correctly regardless of winding — it is one
    // draw call for the whole horizon, so the cost of not caring is nil.
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }),
  )
  mesh.frustumCulled = false
  return mesh
}

/** One cloud: a clump of squashed blobs, deliberately lumpy. */
function buildCloud(seed: number, material: THREE.Material): THREE.Group {
  const r = rng(seed)
  const g = new THREE.Group()
  const puffs = 5 + Math.floor(r() * 4)

  for (let i = 0; i < puffs; i++) {
    const rad = 7 + r() * 9
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), material)
    puff.scale.set(1, 0.56 + r() * 0.2, 1)
    puff.position.set((r() - 0.5) * 34, (r() - 0.5) * 5, (r() - 0.5) * 18)
    g.add(puff)
  }
  return g
}

/**
 * The whole sky backdrop. Owns its own tint so the day cycle can drive it with
 * one call rather than reaching into a dozen materials.
 */
export class Skyline {
  readonly group = new THREE.Group()

  private readonly rangeMaterials: THREE.MeshBasicMaterial[] = []
  private readonly cloudMaterial: THREE.MeshBasicMaterial
  private readonly clouds: { object: THREE.Group; speed: number }[] = []

  constructor(gap: SkylineGap | null = null) {
    for (const layer of LAYERS) {
      const mesh = buildRange(layer, gap)
      this.rangeMaterials.push(mesh.material as THREE.MeshBasicMaterial)
      this.group.add(mesh)
    }

    this.cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })

    const r = rng(0xc10d5)
    for (let i = 0; i < 16; i++) {
      const cloud = buildCloud(i * 977 + 13, this.cloudMaterial)
      const a = (i / 16) * Math.PI * 2 + r() * 0.3
      const dist = 150 + r() * 130
      cloud.position.set(Math.cos(a) * dist, 78 + r() * 58, Math.sin(a) * dist)
      this.group.add(cloud)
      // Slow, and varied, so the sky is never quite still but never distracts.
      this.clouds.push({ object: cloud, speed: 0.9 + r() * 1.5 })
    }

    // Drawn before everything else. The ranges are genuinely distant so depth
    // sorting would handle them anyway, but the clouds are transparent and this
    // keeps them from fighting the alpha-blended foliage.
    this.group.renderOrder = -1
  }

  /**
   * Flat multiply over the baked haze — white at midday, warm at dusk, deep blue
   * at night. Keeps the ranges reading as part of the same sky.
   */
  setTint(color: THREE.Color) {
    for (const m of this.rangeMaterials) m.color.copy(color)
    this.cloudMaterial.color.copy(color)
  }

  update(dt: number) {
    for (const c of this.clouds) {
      c.object.position.x += c.speed * dt
      // Wrap around rather than drifting away for good.
      if (c.object.position.x > 300) c.object.position.x = -300
    }
  }
}
