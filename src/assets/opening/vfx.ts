import * as THREE from 'three'
import type { Audio } from '../../core/audio'
import { LOTTO_GOLD } from '../../game/opening/types'
import type { Bursts } from '../burst'
import { MINOR_LAYER } from '../style'

/**
 * The two permanent grammar VFX (docs/OPENING-CONTRACT.md §5.4).
 *
 * These are the opening's only exports that the rest of the game will reuse
 * forever, so their meanings are load-bearing:
 *
 *   island's breath  "the island approves" — soft golden-GREEN motes rising
 *                    off blessed ground. First seen when the chaos pocket is
 *                    cleared (landing together with music layer 2); later,
 *                    every blessing moment. Deliberately NOT lotto gold.
 *
 *   lotto tell       "luck happened" — a LOTTO_GOLD flash, ring and spark
 *                    burst, the lotto chime, and a 0.3 s slow-mo. Identical for
 *                    every roll, forever: odd crops, hatching eggs, tide
 *                    rarities. No text ever explains it; the grammar carries it.
 *
 * Colour discipline: LOTTO_GOLD (0xf2c14e) appears in `playLottoTell` and
 * `createOddShimmer` and NOWHERE else in this file. The breath motes sit in
 * the green-ivory band specifically so the two tells can never be confused,
 * even after the postfx grade pushes saturation by 1.2 (which is also why the
 * breath colours below are authored slightly desaturated).
 *
 * A note on *apparent* size, because it is what made the first pass invisible.
 * three sizes a point sprite as `size * (height/2) / dist`, with no term for
 * the field of view — so at our 52° camera a `Points` sprite renders at only
 * ~0.49× the screen size of a world-space quad of the same measurement. Every
 * point size in this file is therefore authored roughly 2× its intended world
 * footprint; the comments quote the footprint the player actually sees.
 */

/* ------------------------------------------------------------------------- *
 *  Shared texture and geometry singletons
 * ------------------------------------------------------------------------- */

let softTex: THREE.CanvasTexture | null = null
let starTex: THREE.CanvasTexture | null = null
let ringTex: THREE.CanvasTexture | null = null
let coreTex: THREE.CanvasTexture | null = null
let quadGeo: THREE.PlaneGeometry | null = null

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  paint(canvas.getContext('2d')!, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Soft radial dot. A hard-edged sprite reads as a pixel however small it is;
 * the gradient is what turns one into a mote of light (same reasoning as the
 * burst textures — see burst.ts `softTexture`).
 */
function moteTexture(): THREE.CanvasTexture {
  if (!softTex) {
    softTex = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.3, 'rgba(255,255,255,0.62)')
      g.addColorStop(0.62, 'rgba(255,255,255,0.16)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
  }
  return softTex
}

/**
 * Four-pointed twinkle. The shimmer has to be recognisable as *sparkle* at a
 * dozen pixels, and a star silhouette does that where a dot cannot.
 */
function twinkleTexture(): THREE.CanvasTexture {
  if (!starTex) {
    starTex = canvasTexture(64, (ctx, s) => {
      const c = s / 2
      const halo = ctx.createRadialGradient(c, c, 1, c, c, c * 0.55)
      halo.addColorStop(0, 'rgba(255,255,255,0.95)')
      halo.addColorStop(0.5, 'rgba(255,255,255,0.22)')
      halo.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, s, s)
      // Two crossed spikes, drawn as tapered gradients so the star has no
      // hard end — a clipped spike reads as a scratch on the lens.
      for (let i = 0; i < 2; i++) {
        ctx.save()
        ctx.translate(c, c)
        ctx.rotate((i * Math.PI) / 2)
        const spike = ctx.createLinearGradient(-c, 0, c, 0)
        spike.addColorStop(0, 'rgba(255,255,255,0)')
        spike.addColorStop(0.5, 'rgba(255,255,255,0.9)')
        spike.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = spike
        ctx.beginPath()
        ctx.moveTo(-c, 0)
        ctx.lineTo(0, -c * 0.12)
        ctx.lineTo(c, 0)
        ctx.lineTo(0, c * 0.12)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    })
  }
  return starTex
}

/** Soft annulus: bright at ~78% radius, falling off both ways. */
function shimmerRingTexture(): THREE.CanvasTexture {
  if (!ringTex) {
    ringTex = canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.52, 'rgba(255,255,255,0)')
      g.addColorStop(0.72, 'rgba(255,255,255,0.55)')
      g.addColorStop(0.82, 'rgba(255,255,255,1)')
      g.addColorStop(0.92, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
  }
  return ringTex
}

/** Hot, tight core — the bit that crosses the 0.8 bloom threshold. */
function coreFlashTexture(): THREE.CanvasTexture {
  if (!coreTex) {
    coreTex = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.18, 'rgba(255,255,255,0.95)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.3)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
  }
  return coreTex
}

function unitQuad(): THREE.PlaneGeometry {
  if (!quadGeo) quadGeo = new THREE.PlaneGeometry(1, 1)
  return quadGeo
}

/**
 * Per-point size, which `PointsMaterial` does not offer.
 *
 * A field of identically sized motes reads as a grid of dots however random
 * their positions are — the size spread is most of what makes it read as
 * *pollen*. One attribute and one shader-chunk replacement buys that for the
 * whole cloud; if the chunk ever moves, the field simply falls back to the
 * uniform size rather than breaking.
 */
function patchPointSize(material: THREE.PointsMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
  }
  material.customProgramCacheKey = () => 'isle-vfx-point-size'
}

const easeOut = (u: number) => 1 - Math.pow(1 - u, 3)

/* ------------------------------------------------------------------------- *
 *  Island's breath
 * ------------------------------------------------------------------------- */

/**
 * Mote rise speed, units/s. Slow enough to read as an exhale rather than an
 * updraft, fast enough that over a mote's life it clears knee height and the
 * eye tracks the *direction* — the whole point of the tell is that the ground
 * gives something up.
 */
const BREATH_RISE = 0.42
/** Colour band the motes are dealt across: leaf-gold green → pale straw. */
const BREATH_COLOR_A = 0xbfd98a
const BREATH_COLOR_B = 0xe8e4b0
/**
 * Deal biased toward A. The breath must never be mistaken for the lotto tell,
 * so the field's average hue sits green; the straw end is a highlight, not the
 * body of it.
 */
const BREATH_MIX_BIAS = 1.8
/**
 * Blue trim on the written colour. Additive motes overlap, and overlapping
 * additive light climbs toward white — which would turn a golden-green breath
 * into silver dust. Holding blue down means the pile-up saturates toward the
 * green-gold the palette asked for instead.
 */
const BREATH_BLUE_TRIM = 0.72
/** Motes per square unit of blessed area (clamped to a sane pool). */
const BREATH_DENSITY = 5.5
const BREATH_MIN = 60
const BREATH_MAX = 220
/** Seconds a mote lives, min..max. Long lives keep the drift unhurried. */
const BREATH_LIFE_MIN = 3.4
const BREATH_LIFE_MAX = 6.2
/** Fractions of a life spent fading in / fading out. */
const BREATH_FADE_IN = 0.22
const BREATH_FADE_OUT = 0.45
/** Lateral sway amplitude, units — trade-wind wander, not turbulence. */
const BREATH_SWAY = 0.22
/** Per-mote lateral drift, units/s — spreads the field as it rises. */
const BREATH_DRIFT = 0.05
/**
 * Point size for a mote of average weight (~0.3 u on screen, see the file
 * header on the point/quad size discrepancy).
 */
const BREATH_SIZE = 0.62
/**
 * Fraction of the field that is low, wide, dim haze instead of a mote. The
 * haze is what makes the effect read as breath hugging the ground rather than
 * as confetti — it must stay dim or it turns into fog.
 */
const BREATH_HAZE_SHARE = 0.3
const BREATH_HAZE_GLOW = 0.26
/** Peak brightness of an ordinary mote — see `BREATH_BLUE_TRIM` on pile-up. */
const BREATH_GLOW = 0.62
/** Seconds the first inhale is spread over — it must land WITH the mandolin. */
const BREATH_SWELL = 1.4

interface BreathMote {
  /** Local spawn position (relative to the area centre). */
  x: number
  z: number
  /** Height above the spawn plane at birth. */
  y0: number
  /** Individual rise speed — a little variance kills the lockstep read. */
  rise: number
  age: number
  life: number
  swayPhase: number
  swaySpeed: number
  driftX: number
  driftZ: number
  /** 0..1 deal along the A→B colour band. */
  mix: number
  /** Multiplier on the shared point size. */
  size: number
  /** Peak brightness — haze motes are deliberately held down. */
  peak: number
}

/**
 * "The island approves": a field of golden-green motes rising off an area of
 * ground. `start()` breathes it in (motes swell in over ~1.4 s rather than
 * popping), `stop()` lets the ones in flight finish and spawns no more. The
 * returned object is positioned at `area.centre`; add it to the scene and
 * drive `update` every frame — it costs one draw call (a Points cloud) and
 * hides itself entirely when no mote is alive.
 */
export function createIslandBreath(area: { centre: THREE.Vector3; w: number; d: number }): {
  object: THREE.Object3D
  start(): void
  stop(): void
  update(dt: number, elapsed: number): void
} {
  const count = Math.max(BREATH_MIN, Math.min(BREATH_MAX, Math.round(area.w * area.d * BREATH_DENSITY)))

  const colorA = new THREE.Color(BREATH_COLOR_A)
  const colorB = new THREE.Color(BREATH_COLOR_B)
  const tmp = new THREE.Color()

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.PointsMaterial({
    map: moteTexture(),
    size: BREATH_SIZE,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    // Light, not matter: fog dimming an additive mote just greys the glow.
    fog: false,
  })
  patchPointSize(material)

  const points = new THREE.Points(geometry, material)
  points.position.copy(area.centre)
  // Positions churn every frame and the cloud is small; a cached bounding
  // sphere would be stale immediately (burst.ts carries the same rule).
  points.frustumCulled = false
  points.layers.set(MINOR_LAYER)
  points.visible = false

  const motes: BreathMote[] = []
  let active = false

  /** Deal a mote a fresh spawn. `swell` spreads first births over ~1.4 s. */
  const respawn = (m: BreathMote, swell: boolean) => {
    // Elliptical footprint rather than the literal rectangle: a rectangle of
    // motes has corners, and corners are the one thing a breath cannot have.
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random())
    m.x = Math.cos(a) * r * area.w * 0.56
    m.z = Math.sin(a) * r * area.d * 0.56
    m.y0 = 0.04 + Math.random() * 0.22
    m.swayPhase = Math.random() * Math.PI * 2
    m.swaySpeed = 0.4 + Math.random() * 0.4
    m.driftX = (Math.random() - 0.5) * 2 * BREATH_DRIFT
    m.driftZ = (Math.random() - 0.5) * 2 * BREATH_DRIFT
    m.life = BREATH_LIFE_MIN + Math.random() * (BREATH_LIFE_MAX - BREATH_LIFE_MIN)
    // Negative age = waiting to be born; the field breathes in gradually.
    m.age = swell ? -Math.random() * BREATH_SWELL : -Math.random() * 0.9

    if (Math.random() < BREATH_HAZE_SHARE) {
      // Ground haze: wide, slow, dim, and greener than the motes above it.
      m.size = 1.6 + Math.random() * 0.5
      m.rise = BREATH_RISE * (0.3 + Math.random() * 0.25)
      m.mix = Math.random() * 0.4
      m.peak = BREATH_HAZE_GLOW
      m.y0 *= 0.5
    } else {
      m.size = 0.8 + Math.random() * 0.75
      m.rise = BREATH_RISE * (0.72 + Math.random() * 0.6)
      m.mix = Math.pow(Math.random(), BREATH_MIX_BIAS)
      m.peak = BREATH_GLOW * (0.8 + Math.random() * 0.35)
    }
  }

  for (let i = 0; i < count; i++) {
    const m: BreathMote = {
      x: 0, z: 0, y0: 0, rise: 0, age: 0, life: 1,
      swayPhase: 0, swaySpeed: 0.5, driftX: 0, driftZ: 0,
      mix: 0, size: 1, peak: 1,
    }
    respawn(m, true)
    motes.push(m)
    sizes[i] = m.size
  }

  return {
    object: points,

    start() {
      if (active) return
      active = true
      points.visible = true
      for (let i = 0; i < count; i++) {
        respawn(motes[i], true)
        sizes[i] = motes[i].size
      }
      geometry.attributes.aSize.needsUpdate = true
    },

    stop() {
      // In-flight motes finish their lives; respawn simply stops.
      active = false
    },

    update(dt: number, elapsed: number) {
      if (!points.visible) return
      let anyAlive = false
      let sizesDirty = false

      for (let i = 0; i < count; i++) {
        const m = motes[i]
        m.age += dt

        if (m.age >= m.life) {
          if (active) {
            respawn(m, false)
            sizes[i] = m.size
            sizesDirty = true
          } else {
            // Dead and done: park it black — with additive blending, black
            // IS invisible, so no alpha attribute is needed.
            colors[i * 3] = 0
            colors[i * 3 + 1] = 0
            colors[i * 3 + 2] = 0
            positions[i * 3 + 1] = -999
            continue
          }
        }

        if (m.age < 0) {
          // Not born yet, but the field still counts as alive.
          anyAlive = true
          colors[i * 3] = 0
          colors[i * 3 + 1] = 0
          colors[i * 3 + 2] = 0
          continue
        }

        anyAlive = true
        const t = m.age / m.life

        // The sway widens as a mote climbs: near the soil it is still, higher
        // up the trade wind has had time to get hold of it.
        const swayAmp = BREATH_SWAY * (0.3 + t)
        positions[i * 3] =
          m.x + m.driftX * m.age + Math.sin(elapsed * m.swaySpeed + m.swayPhase) * swayAmp
        // Gently accelerating rise: the ground lets go, then the air takes it.
        positions[i * 3 + 1] = m.y0 + m.rise * m.age * (0.75 + 0.5 * t)
        positions[i * 3 + 2] =
          m.z + m.driftZ * m.age + Math.cos(elapsed * m.swaySpeed * 0.83 + m.swayPhase * 1.3) * swayAmp

        // Trapezoid envelope: breathe in at the soil, hold, dissolve at the top.
        const fadeIn = Math.min(1, t / BREATH_FADE_IN)
        const fadeOut = Math.min(1, (1 - t) / BREATH_FADE_OUT)
        const glow = fadeIn * fadeOut * fadeOut * m.peak

        tmp.lerpColors(colorA, colorB, m.mix)
        colors[i * 3] = tmp.r * glow
        colors[i * 3 + 1] = tmp.g * glow
        colors[i * 3 + 2] = tmp.b * glow * BREATH_BLUE_TRIM
      }

      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      if (sizesDirty) geometry.attributes.aSize.needsUpdate = true
      if (!anyAlive && !active) points.visible = false
    },
  }
}

/* ------------------------------------------------------------------------- *
 *  The lotto tell
 * ------------------------------------------------------------------------- */

/** Fast sparks / slow shimmer counts for the full-size tell. */
const TELL_SPARKS = 34
const TELL_SHIMMER = 12
/** The pale gold companion colour — hot core against LOTTO_GOLD. */
const TELL_PALE = 0xfff8d0
/**
 * The flash's own gold. Warmer and much less blue than TELL_PALE, because the
 * rig's quads stack additively on top of each other: with a pale colour the
 * overlap clips to white and the one moment in the game that must read GOLD
 * reads as a camera flash instead. Holding blue down keeps the pile-up amber.
 */
const TELL_FLASH = 0xffd980
/** Slow-mo request: 0.3 s at quarter speed, the grammar's exact numbers. */
const TELL_SLOWMO_SECONDS = 0.3
const TELL_SLOWMO_SCALE = 0.25
/** The small variant (session-2 sea-glass) scales the burst, not the ritual. */
const TELL_SMALL = 0.55
/** Seconds the flash rig lives, on the REAL clock (see `TellRig`). */
const TELL_LIFE = 1.0
/** Rigs kept per `Bursts`. Three is more overlap than the grammar ever needs. */
const TELL_RIG_POOL = 3

/**
 * The anchored half of the tell: a hot core flash, two outward shimmer rings
 * and a slow bloom-catching glow, all camera-facing and all sitting exactly on
 * the fruit. The sparks alone were never enough — they leave the anchor point
 * immediately, so at the moment the slow-mo bites there is nothing left AT the
 * thing that was lucky.
 *
 * The rig animates on the REAL clock, deliberately. Everything else in the
 * frame is running at quarter speed inside the slow-mo window, so a flash that
 * keeps its own time is the one element that still *moves* — the sparks hang in
 * the air, the rings sweep through them. That contrast is the moment.
 *
 * It drives itself from `onBeforeRender` (each quad ticks the whole rig, which
 * is safe because the state is a pure function of elapsed time, not of deltas)
 * so it needs no per-frame update call from a caller that does not have one to
 * give. The rig is pooled and reused; it never removes itself mid-render.
 */
interface TellRig {
  object: THREE.Group
  fire(at: THREE.Vector3, k: number): void
}

function createTellRig(): TellRig {
  const group = new THREE.Group()
  group.visible = false

  const quads: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
  const make = (map: THREE.Texture, color: number, renderOrder: number) => {
    const mat = new THREE.MeshBasicMaterial({
      map,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // Light, not matter — the same rule the additive burst kinds follow.
      fog: false,
    })
    const mesh = new THREE.Mesh(unitQuad(), mat)
    mesh.renderOrder = renderOrder
    mesh.layers.set(MINOR_LAYER)
    // The rig must keep ticking even when the anchor is off-screen, or a
    // culled flash would freeze mid-animation and never hide itself.
    mesh.frustumCulled = false
    group.add(mesh)
    quads.push(mesh)
    return mesh
  }

  const glow = make(moteTexture(), LOTTO_GOLD, 2)
  const ringA = make(shimmerRingTexture(), TELL_FLASH, 3)
  const ringB = make(shimmerRingTexture(), LOTTO_GOLD, 3)
  const core = make(coreFlashTexture(), TELL_FLASH, 4)

  let startMs = -1
  let scale = 1

  /** Time-based, idempotent: safe to call many times in one frame. */
  const tick = () => {
    if (startMs < 0) return
    const t = (performance.now() - startMs) / 1000
    if (t >= TELL_LIFE) {
      group.visible = false
      startMs = -1
      return
    }

    // Core: a hard pop that is gone almost before the eye resolves it, and the
    // only element authored to sit above the 0.8 bloom threshold.
    const cu = Math.min(1, t / 0.34)
    core.material.opacity =
      0.8 * (t < 0.045 ? t / 0.045 : Math.pow(Math.max(0, 1 - (t - 0.045) / 0.295), 1.7))
    core.scale.setScalar(scale * (0.5 + 1.2 * easeOut(cu)))

    // Glow: dim, wide and slow — it is what the bloom smears into a halo and
    // what keeps gold on the frame for the whole slow-mo window.
    const gu = Math.min(1, t / 0.95)
    glow.material.opacity = 0.42 * Math.min(1, t / 0.06) * Math.pow(1 - gu, 1.3)
    glow.scale.setScalar(scale * (1 + 1.9 * easeOut(gu)))

    // Rings: the outward statement. Two, offset, so the shimmer reads as a
    // pulse travelling out rather than as a single expanding circle.
    const ru = t / 0.5
    if (ru < 1) {
      ringA.material.opacity = 0.85 * Math.min(1, ru / 0.08) * Math.pow(1 - ru, 1.4)
      ringA.scale.setScalar(scale * (0.35 + 1.85 * easeOut(ru)))
    } else ringA.material.opacity = 0

    const rb = (t - 0.11) / 0.62
    if (rb > 0 && rb < 1) {
      ringB.material.opacity = 0.5 * Math.min(1, rb / 0.1) * Math.pow(1 - rb, 1.5)
      ringB.scale.setScalar(scale * (0.3 + 2.3 * easeOut(rb)))
    } else ringB.material.opacity = 0
  }

  for (const quad of quads) {
    quad.onBeforeRender = (_renderer, _scene, camera) => {
      tick()
      // Self-billboarding: three computes modelViewMatrix *after* this hook,
      // so writing the matrix here lands on the current frame with no lag.
      quad.quaternion.copy(camera.quaternion)
      quad.updateMatrixWorld(true)
    }
  }

  return {
    object: group,
    fire(at: THREE.Vector3, k: number) {
      group.position.copy(at)
      group.updateMatrixWorld(true)
      scale = k
      startMs = performance.now()
      group.visible = true
      tick()
    },
  }
}

interface TellPool {
  rigs: TellRig[]
  next: number
}

/** One pool per `Bursts` — keyed weakly so a discarded scene takes it along. */
const tellPools = new WeakMap<Bursts, TellPool>()

function tellRigFor(bursts: Bursts): TellRig {
  let pool = tellPools.get(bursts)
  if (!pool) {
    pool = { rigs: [], next: 0 }
    for (let i = 0; i < TELL_RIG_POOL; i++) {
      const rig = createTellRig()
      // `bursts.group` is already in the scene at identity, which makes it the
      // one hook this signature gives us for world-space geometry.
      bursts.group.add(rig.object)
      pool.rigs.push(rig)
    }
    tellPools.set(bursts, pool)
  }
  const rig = pool.rigs[pool.next]
  pool.next = (pool.next + 1) % pool.rigs.length
  return rig
}

/**
 * "Luck happened": gold flash + shimmer rings + spark burst + lotto chime +
 * 0.3 s slow-mo, all anchored exactly at `at`. The one grammar for every roll,
 * forever — never used for anything else, and the chime is the only sound
 * allowed to pair with LOTTO_GOLD.
 *
 * `at` is world space at the height of the lucky thing (callers pass the bed
 * centre lifted to fruit height, or the washup itself); everything here is
 * built around that point rather than merely thrown from it.
 *
 * `slowMo` is W-INT's global dt-scale hook; audio deliberately runs through
 * the real-time clock, so the chime plays at full speed over slowed visuals.
 * `small` shrinks the visual burst (a modest find is a modest sparkle) but
 * keeps the chime and slow-mo identical: the ritual must always feel the same.
 */
export function playLottoTell(opts: {
  at: THREE.Vector3
  bursts: Bursts
  audio: Audio
  slowMo: (seconds: number, scale: number) => void
  small?: boolean
}): void {
  const k = opts.small ? TELL_SMALL : 1

  // The anchored flash: core, rings, glow — the part that stays AT the fruit.
  tellRigFor(opts.bursts).fire(opts.at, k)

  // Fast shell: bright, quick, radial. Tight jitter so every spark is born on
  // the anchor point and the burst reads as one event, not a scatter; the
  // speed is deliberately modest so the sparks stay a corona around the fruit
  // instead of leaving it behind as a geyser. Two golds to one pale, because
  // the pale reads brighter and an even deal turns the burst white.
  opts.bursts.emit(opts.at, Math.round(TELL_SPARKS * k), [LOTTO_GOLD, LOTTO_GOLD, TELL_PALE], {
    kind: 'spark',
    speed: 3.6,
    life: 0.62,
    scale: 0.32 * k,
    jitter: 0.14 * k,
  })
  // Slow shimmer: near-stationary motes that hang inside the slow-mo window,
  // so the frame still reads gold after the shell has flown.
  opts.bursts.emit(opts.at, Math.round(TELL_SHIMMER * k), [LOTTO_GOLD, TELL_PALE], {
    kind: 'spark',
    speed: 1.2,
    life: 1.15,
    scale: 0.26 * k,
    jitter: 0.1 * k,
  })

  opts.audio.play('lotto-chime')
  opts.slowMo(TELL_SLOWMO_SECONDS, TELL_SLOWMO_SCALE)
}

/* ------------------------------------------------------------------------- *
 *  Odd-fruit shimmer
 * ------------------------------------------------------------------------- */

/** Motes in the orbit. Few enough to read as jewellery, not as a firework. */
const ODD_MOTES = 7
/** Orbit radius / height, units — sized to ring a single plump fruit. */
const ODD_RADIUS = 0.36
const ODD_HEIGHT = 0.34
/** Base point size (~0.3 u on screen at the average twinkle). */
const ODD_SIZE = 0.62
/** Revolutions per second — slow. The shimmer must never look busy. */
const ODD_SPIN = 0.55

/**
 * The persistent gold shimmer on an odd (lotto) object — the streaked tomato
 * this session, impossible sea-glass next. It has one job: the player must
 * notice the wrong tomato BEFORE they pick it, so the motes orbit slowly on a
 * tilted ring and twinkle out of phase, which the eye catches at the edge of
 * vision where a static tint does not.
 *
 * LOTTO_GOLD is the only sanctioned route to a gold sparkle here: ordinary
 * crops keep the default warm-white motes of `createSparkle`.
 *
 * Same contract as `createSparkle`: parent `object` to the shimmerer and call
 * `update(elapsedSeconds)` per frame. Unlike `createSparkle` it needs no
 * billboarding pass — point sprites always face the camera — so it is correct
 * whether or not the caller runs `billboardSparkles`.
 */
export function createOddShimmer(): { object: THREE.Group; update(t: number): void } {
  const group = new THREE.Group()

  const positions = new Float32Array(ODD_MOTES * 3)
  const colors = new Float32Array(ODD_MOTES * 3)
  const sizes = new Float32Array(ODD_MOTES)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.PointsMaterial({
    map: twinkleTexture(),
    size: ODD_SIZE,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    fog: false,
  })
  patchPointSize(material)

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.layers.set(MINOR_LAYER)
  group.add(points)

  const gold = new THREE.Color(LOTTO_GOLD)
  const pale = new THREE.Color(TELL_PALE)
  const tmp = new THREE.Color()
  const phases: number[] = []
  for (let i = 0; i < ODD_MOTES; i++) phases.push((i / ODD_MOTES) * Math.PI * 2)

  return {
    object: group,

    update(t: number) {
      for (let i = 0; i < ODD_MOTES; i++) {
        const phase = phases[i]
        const angle = t * ODD_SPIN + phase
        const radius = ODD_RADIUS + Math.sin(t * 0.9 + phase) * 0.05

        positions[i * 3] = Math.cos(angle) * radius
        // The orbit is tilted, not flat: a ring seen on the slant reads as
        // something circling the fruit rather than sliding past it.
        positions[i * 3 + 1] =
          ODD_HEIGHT + Math.sin(angle) * 0.09 + Math.sin(t * 1.15 + phase * 1.7) * 0.05
        positions[i * 3 + 2] = Math.sin(angle) * radius

        // Out-of-phase twinkle: two or three motes are bright at any moment,
        // the rest are embers — never all dark, or the fruit stops advertising
        // itself in the half-second the player is deciding what to pick.
        const w = Math.max(0, Math.sin(t * 1.6 + phase * 2.3))
        const twinkle = w * w
        const glow = 0.45 + 0.55 * twinkle
        // The hottest part of a glint goes pale, the way real specular does.
        tmp.lerpColors(gold, pale, twinkle * 0.5)
        colors[i * 3] = tmp.r * glow
        colors[i * 3 + 1] = tmp.g * glow
        colors[i * 3 + 2] = tmp.b * glow
        sizes[i] = 0.6 + twinkle * 0.8
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.attributes.aSize.needsUpdate = true
    },
  }
}
