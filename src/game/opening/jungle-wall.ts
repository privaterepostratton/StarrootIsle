import * as THREE from 'three'
import { bakeGroup, makeInstancedChunks, type Placement } from '../../assets/bake'
import { MINOR_LAYER, rng } from '../../assets/style'
import { groundHeight } from '../terrain'
import type { Obstacle } from '../world'
import {
  createBasaltOutcrop,
  createBroadleafClump,
  createCanopyOverhang,
  createFernTuft,
  createFrondFan,
  createJungleCanopyA,
  createJungleCanopyB,
  createLightShaft,
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
 * The gap's light shafts. Dawn sun comes from the east and sits low, so the
 * beams lean west and land short — laid out along the corridor rather than
 * across it, which is what makes walking through the gap feel like walking
 * through them.
 */
const SHAFTS: { x: number; z: number; height: number; top: number; bot: number; tilt: number }[] = [
  { x: -40.9, z: -2.3, height: 5.6, top: 0.12, bot: 0.6, tilt: 0.34 },
  { x: -39.5, z: -0.9, height: 5.0, top: 0.1, bot: 0.45, tilt: 0.30 },
  { x: -40.6, z: 2.4, height: 5.8, top: 0.14, bot: 0.68, tilt: 0.36 },
]

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
}

const RANKS: RankSpec[] = [
  // Emergents — a handful of giants breaking the skyline.
  //
  // A wall of evenly tall trees produces a level top edge, and a level top edge
  // is a hedge again however deep the planting behind it. Six or seven of these
  // standing a third taller than everything else is what turns the outline into
  // a canopy with a story in it.
  {
    build: createJungleCanopyA,
    variants: 3,
    spacing: 9.5,
    offset: 2.9,
    jitter: 1.1,
    scaleMin: 1.3,
    scaleMax: 1.6,
    sink: 0.35,
    castShadow: false,
    phase: 2.2,
  },
  // Rear rank — the backing. Tall, dark, set back. Roughly twice the height of
  // the valley's own trees (5.6u), which is what "looms" costs.
  {
    build: createJungleCanopyA,
    variants: 3,
    spacing: 3.2,
    offset: 2.2,
    jitter: 0.8,
    scaleMin: 0.9,
    scaleMax: 1.24,
    sink: 0.3,
    castShadow: false,
    phase: 0.4,
  },
  // Second rank — module B, the other silhouette, half a step forward.
  {
    build: createJungleCanopyB,
    variants: 3,
    spacing: 2.5,
    offset: 1.1,
    jitter: 0.7,
    scaleMin: 0.92,
    scaleMax: 1.18,
    sink: 0.25,
    castShadow: false,
    phase: 1.5,
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
    scaleMax: 0.8,
    sink: 0.2,
    castShadow: false,
    phase: 0.9,
  },
  // The plug. Tight spacing and a jitter wider than the band it sits in, so
  // the pieces stagger across two depths instead of lining up into one row of
  // holes the player can look down as they walk past.
  {
    build: createUnderThicket,
    variants: 3,
    spacing: 0.7,
    offset: 0.35,
    jitter: 1.7,
    scaleMin: 0.85,
    scaleMax: 1.35,
    sink: 0.15,
    castShadow: false,
    phase: 0.3,
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
  material.customProgramCacheKey = () => 'jungle-sway'
  return material
}

/** Static foliage: double-sided because leaves are single-triangle strips. */
function createLeafMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  })
}

/** Cumulative-length walk over the spine, so pieces can be spaced by distance
 *  rather than by vertex — the polyline's segments are wildly uneven. */
class Spine {
  private readonly pts: THREE.Vector2[]
  private readonly cum: number[] = [0]
  readonly length: number

  constructor(points: [number, number][]) {
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
  private readonly scene: THREE.Group
  private visible = true
  private disposed = false

  constructor(scene: THREE.Group, obstacles: Obstacle[]) {
    this.scene = scene
    this.gapCentre = new THREE.Vector3(GAP_X, groundHeight(GAP_X, 0), 0)

    const spine = new Spine(SPINE)
    const r = rng(0x1a1e5)

    const swayMaterial = createSwayMaterial()
    const leafMaterial = createLeafMaterial()
    this.materials.push(swayMaterial, leafMaterial)

    for (const rank of RANKS) {
      const geos = Array.from({ length: rank.variants }, (_, v) => bakeGroup(rank.build(v)))
      this.geometries.push(...geos)
      const buckets: Placement[][] = geos.map(() => [])

      for (let d = rank.phase; d < spine.length; d += rank.spacing) {
        const { out } = spine.at(d)
        // Jitter runs along the wall as well as across it, so the ranks never
        // resolve into the rows the fixed spacing would otherwise produce.
        const along = (r() - 0.5) * rank.spacing * 0.8
        const { p: pj } = spine.at(d + along)
        const off = rank.offset + (r() - 0.5) * rank.jitter
        const x = pj.x + out.x * off
        const z = pj.y + out.y * off
        buckets[Math.floor(r() * geos.length)].push({
          x,
          y: groundHeight(x, z) - rank.sink,
          z,
          rotationY: r() * Math.PI * 2,
          scale: rank.scaleMin + r() * (rank.scaleMax - rank.scaleMin),
        })
      }

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
      const mesh = createLightShaft(s.top, s.bot, s.height)
      // Hung from the canopy, leaning west with the low eastern sun.
      mesh.position.set(s.x, groundHeight(s.x, s.z) + s.height * 0.92, s.z)
      mesh.rotation.z = s.tilt
      mesh.rotation.x = (i % 2 === 0 ? 1 : -1) * 0.1
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
   * Hide or show the whole wall. Colliders follow the mesh — an invisible wall
   * the player still bounces off is the worse half of both states.
   */
  setVisible(v: boolean) {
    if (this.disposed) return
    this.visible = v
    this.group.visible = v
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
    for (const geo of this.geometries) geo.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.length = 0
    this.materials.length = 0
    this.shafts.length = 0
  }
}
