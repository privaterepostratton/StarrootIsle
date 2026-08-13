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
 * `playLeafBurst` (spec VFX #2) rides along because it shares the file's one
 * real discipline — scale and colour authored against the grade — and because
 * the clearing beat fires it more often than anything else on screen.
 *
 * Colour discipline: LOTTO_GOLD (0xf2c14e) appears in `playLottoTell` and
 * `createOddShimmer` and NOWHERE else in this file. Every other colour here is
 * held clear of the 45–55° hue band that gold owns — the breath's pale end was
 * measured back onto the green side for exactly that reason — so the two tells
 * can never be confused, even after the postfx grade pushes saturation by 1.2
 * (which is also why every colour below is authored slightly desaturated).
 *
 * A note on *scale*, because it is what broke the second pass. The opening's
 * camera came in from 8 units to 4.8, and everything here is either a point
 * sprite or a world-space quad — both scale as 1/distance, so a field tuned at
 * the farming boom doubled on screen without a line changing. The sizes below
 * are measured against the thing the effect is *about* (a mote against the
 * pocket, a shimmer against one fruit, a leaf against a torn frond), and the
 * two point fields additionally carry a hard pixel ceiling so no future camera
 * move can turn them back into bokeh.
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
 * Per-point size, which `PointsMaterial` does not offer, plus a hard ceiling
 * on how much of the screen one mote may own.
 *
 * A field of identically sized motes reads as a grid of dots however random
 * their positions are — the size spread is most of what makes it read as
 * *pollen*. One attribute and one shader-chunk replacement buys that for the
 * whole cloud; if the chunk ever moves, the field simply falls back to the
 * uniform size rather than breaking.
 *
 * The ceiling is the lesson of the first camera pass. Point sprites scale as
 * `1/distance`, and the opening's camera came *in* — from the farming boom at
 * 8 units to 4.8, and closer still on the goat. Every mote in these fields
 * doubled on screen overnight and the island's breath stopped reading as
 * breath: it became half a dozen soft white discs the size of a fist, which
 * the eye files as dirt on the lens, not as something the ground gave up.
 * A per-material pixel clamp makes the effect distance-proof — motes shrink
 * with depth as they should and simply refuse to grow past legibility as the
 * camera closes. It is applied after three's own size attenuation, which is
 * why the splice lands on `clipping_planes_vertex` rather than on the
 * `gl_PointSize = size` line (that value has not been attenuated yet).
 */
function patchPointSize(material: THREE.PointsMaterial, maxPx: number) {
  // gl_PointSize is framebuffer pixels, so the CSS-pixel budget has to be
  // taken up to device pixels (capped where the renderer caps its own DPR).
  const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMaxPointPx = { value: maxPx * dpr }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSize;\nuniform float uMaxPointPx;',
      )
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
      .replace(
        '#include <clipping_planes_vertex>',
        'gl_PointSize = min( gl_PointSize, uMaxPointPx );\n\t#include <clipping_planes_vertex>',
      )
  }
  material.customProgramCacheKey = () => `isle-vfx-point-size-${maxPx}`
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
/**
 * Colour band the motes are dealt across: leaf green → pale green-straw.
 *
 * Both ends sit clear of the 45–55° hue band that lotto gold owns (`#F2C14E`
 * sits at 42°): `#BFD98A` measures 78°, `#E8E4B0` 56° at a fifth of gold's
 * saturation. What the third pass had to fix was not the hue — it was that the
 * field *printed white*. Additive light climbs toward white wherever it
 * overlaps, and at the old count and brightness a two-hundred-mote cloud
 * overlapped everywhere; the frame showed a screen-wide dust of white dots and
 * the colour authored here never survived to the pixel. The band is warmer now
 * and the pile-up is what got fixed (see `BREATH_GLOW` and `BREATH_DENSITY`).
 */
const BREATH_COLOR_A = 0xbfd98a
const BREATH_COLOR_B = 0xe8e4b0
/**
 * Deal biased toward A. The breath must never be mistaken for the lotto tell,
 * so the field's average hue sits green; the pale end is a highlight, not the
 * body of it.
 */
const BREATH_MIX_BIAS = 1.8
/**
 * Blue trim on the written colour. Additive motes overlap, and overlapping
 * additive light climbs toward white — which would turn a green breath into
 * silver dust. Holding blue down means the pile-up saturates toward the
 * leaf-green the palette asked for instead.
 */
const BREATH_BLUE_TRIM = 0.8
/**
 * Motes per square unit of blessed area (clamped to a sane pool).
 *
 * Halved from the pass that doubled it, because the doubling is what broke the
 * effect. Two hundred and sixty additive motes over a 6×4 pocket means several
 * of them stack on almost every pixel, and stacked additive light is white by
 * arithmetic — the field stopped being golden-green motes and became a screen
 * of white dots, uniform because saturation is the first thing clipping takes.
 * A hundred and thirty still reads as a volume of air with something in it, and
 * each mote keeps the colour it was dealt.
 */
const BREATH_DENSITY = 5.5
const BREATH_MIN = 70
const BREATH_MAX = 160
/**
 * Seconds a mote lives, min..max.
 *
 * Shorter than the first pass. The breath is a single exhale that answers one
 * moment — it has to be visibly OVER before the beat moves on, and a six-second
 * mote born at the end of the spawn window was still drifting through the
 * planting beat. See `stop()` and `BREATH_TAIL` for the hard end.
 */
const BREATH_LIFE_MIN = 2.6
const BREATH_LIFE_MAX = 4.4
/** Fractions of a life spent fading in / fading out. */
const BREATH_FADE_IN = 0.22
const BREATH_FADE_OUT = 0.45
/**
 * Seconds a mote in flight is allowed after `stop()`.
 *
 * The caller's timer decides when the breath is *over*; this decides how long
 * "over" takes. Without it the tail is whatever life each mote happened to be
 * dealt, which is how motes from the clearing beat survived into the harvest.
 */
const BREATH_TAIL = 1.3
/** Lateral sway amplitude, units — trade-wind wander, not turbulence. */
const BREATH_SWAY = 0.16
/** Per-mote lateral drift, units/s — spreads the field as it rises. */
const BREATH_DRIFT = 0.035
/**
 * Fraction of the area's half-extent a mote may be born within.
 *
 * Tightened so the cloud sits ON the footprint the player just cleared rather
 * than spilling a fifth of its width past the edges: the tell means "this
 * ground approves", and ground it is not standing over cannot say that.
 */
const BREATH_SPREAD = 0.45
/**
 * Point size for a mote of average weight (~0.11 u on screen, see the file
 * header on the point/quad size discrepancy).
 *
 * Cut to a third of the first pass. At the opening's close camera the old
 * value put a single mote at seventy screen pixels — an inch of soft white on
 * a phone — and a field of those is bokeh, not pollen. A mote has to be small
 * enough that the player counts *the field* rather than the individual, and
 * `BREATH_MAX_PX` guarantees that stays true however close the lens gets.
 */
const BREATH_SIZE = 0.26
/**
 * Hard screen ceiling for one mote, CSS pixels. See `patchPointSize`.
 *
 * Down from 40: at the opening's close camera the ceiling was what the biggest
 * motes were actually rendering at, which flattened the size spread the field
 * depends on — a clamp every large mote hits is a clamp that makes them all the
 * same size, and a field of identical dots is the thing the spread exists to
 * prevent.
 */
const BREATH_MAX_PX = 26
/**
 * Fraction of the field that is low, wide, dim haze instead of a mote. The
 * haze is what makes the effect read as breath hugging the ground rather than
 * as confetti — it must stay dim or it turns into fog.
 *
 * It is the one element still allowed to be *wide*, and the only reason that
 * is safe is that its brightness is now a fifth of a mote's: a haze quad you
 * can see the edge of is a defect, a haze quad you can only see the *tint* of
 * is ground mist.
 */
const BREATH_HAZE_SHARE = 0.18
const BREATH_HAZE_GLOW = 0.11
/**
 * Peak brightness of an ordinary mote — see `BREATH_BLUE_TRIM` on pile-up.
 *
 * Held down hard on the third pass. Additive brightness is the other half of
 * the white problem: at 0.6 a mote is already two-thirds of the way to clipping
 * on its own, so any two that overlap print white and take the field's colour
 * with them. At 0.42 a single mote is still unmistakable against dark loam and
 * a pair of them stays green.
 */
const BREATH_GLOW = 0.42
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
  patchPointSize(material, BREATH_MAX_PX)

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
    m.x = Math.cos(a) * r * area.w * BREATH_SPREAD
    m.z = Math.sin(a) * r * area.d * BREATH_SPREAD
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
      m.size = 2.2 + Math.random() * 0.8
      m.rise = BREATH_RISE * (0.3 + Math.random() * 0.25)
      m.mix = Math.random() * 0.4
      m.peak = BREATH_HAZE_GLOW
      m.y0 *= 0.5
    } else {
      // A wide size spread with most of the weight low: a field where a few
      // motes are twice their neighbours reads as depth, one where they are
      // all the same reads as a texture. Widened along with the pixel ceiling
      // cut — the spread only exists on screen if the top of it clears the
      // bottom by more than the clamp allows.
      m.size = 0.5 + Math.pow(Math.random(), 1.8) * 1.5
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
      active = false
      /*
       * And in-flight motes are given a deadline rather than left to finish
       * whatever life they were dealt.
       *
       * "Stops spawning" is not the same as "ends", and the difference showed:
       * a mote born a moment before the caller's timer expired could still be
       * drifting five seconds later, so the clearing beat's breath was visibly
       * hanging over the frame during planting and harvest — where it means
       * nothing, and where a permanent tell is no tell at all. Clamping the
       * remaining life keeps the fade-out ramp (`BREATH_FADE_OUT` is a fraction
       * of life, so a shortened life simply falls off faster) and guarantees
       * the field is empty within `BREATH_TAIL` of the request.
       */
      for (const m of motes) {
        const remain = m.life - m.age
        if (remain > BREATH_TAIL) m.life = m.age + BREATH_TAIL
      }
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

/**
 * Fast sparks / slow shimmer counts for the full-size tell.
 *
 * Third pass, and this one was measured rather than judged: the verifier's
 * reserved-gold scan reported **zero** pixels within its radius of LOTTO_GOLD
 * in the odd-pick frame, and a pixel probe of the capture found a 60-pixel
 * core sitting at (252, 252, 252) with only a thin amber fringe. The rig's
 * colours were already right; the arithmetic was not. Thirty-four additive
 * sparks born at `jitter: 0.1` are thirty-four quads stacked on one another at
 * t=0, and an additive stack that deep clips to white no matter what colour
 * each member is. The counts come down, the births spread out, and the sizes
 * shrink — the same shower, dealt across the corona instead of dealt onto one
 * pixel — so the frame prints gold where the spec says the player learns what
 * gold means.
 */
const TELL_SPARKS = 22
const TELL_SHIMMER = 10
/**
 * The pale gold companion colour — the highlight against LOTTO_GOLD.
 *
 * Pulled off near-white (`0xfff8d0`) for the same clipping reason: it was the
 * member of the palette with nowhere left to go. It still reads as the hot end
 * of the burst next to the flash gold, and it no longer drags the overlap to
 * white on its own.
 */
const TELL_PALE = 0xffe6a4
/**
 * The flash's own gold. Warmer and much less blue than TELL_PALE, because the
 * rig's quads stack additively on top of each other: with a pale colour the
 * overlap clips to white and the one moment in the game that must read GOLD
 * reads as a camera flash instead. Holding blue down keeps the pile-up amber.
 *
 * Deepened from `0xffd980` after the first review, which found the burst
 * landing as "one more yellow blob among yellows". The colour was never the
 * whole story — see `TELL_*` opacities below — but four additive quads whose
 * *brightest* member is near-white have nowhere to go but white, and the one
 * moment in the session that must be unmistakably GOLD cannot be the moment
 * the frame blows out.
 */
const TELL_FLASH = 0xffc85e
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
  // The core used to be the flash gold, which put the hottest, most bloom-prone
  // element on the palest colour in the rig. It is LOTTO_GOLD now: whatever the
  // bloom smears across the frame in that half-second is the reserved hue.
  const core = make(coreFlashTexture(), LOTTO_GOLD, 4)

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

    /*
     * Sizes and opacities below are the second pass, and both moved for the
     * same reason: the tell was a wide, pale event happening *near* the fruit
     * instead of a tight, saturated one happening *to* it.
     *
     *  - **Reach.** The rings used to sweep out past two world units — seven
     *    times the width of the tomato they were about. At that size the burst
     *    stops pointing at anything; it is weather. Every element is now sized
     *    against the fruit, so the whole tell fits inside a metre and the eye
     *    lands on the plant that was lucky.
     *  - **Weight.** Four additive quads at 0.4–0.85 alpha stack past 1.0 wherever
     *    they overlap, and a clipped additive pile is white by definition. Held
     *    down, the same rig prints amber at the overlap and gold at the edges —
     *    the colour survives the pile-up instead of being destroyed by it.
     */

    // Core: a hard pop that is gone almost before the eye resolves it, and the
    // only element authored to sit above the 0.8 bloom threshold.
    const cu = Math.min(1, t / 0.34)
    // 0.40, not 0.58: the core lands on top of the spark shell, and the two
    // together were what clipped. Alone, either one printed gold.
    core.material.opacity =
      0.4 * (t < 0.045 ? t / 0.045 : Math.pow(Math.max(0, 1 - (t - 0.045) / 0.295), 1.7))
    core.scale.setScalar(scale * (0.32 + 0.72 * easeOut(cu)))

    // Glow: dim, wide and slow — it is what the bloom smears into a halo and
    // what keeps gold on the frame for the whole slow-mo window.
    const gu = Math.min(1, t / 0.95)
    glow.material.opacity = 0.22 * Math.min(1, t / 0.06) * Math.pow(1 - gu, 1.3)
    glow.scale.setScalar(scale * (0.78 + 1.1 * easeOut(gu)))

    // Rings: the outward statement. Two, offset, so the shimmer reads as a
    // pulse travelling out rather than as a single expanding circle.
    const ru = t / 0.5
    if (ru < 1) {
      ringA.material.opacity = 0.52 * Math.min(1, ru / 0.08) * Math.pow(1 - ru, 1.4)
      ringA.scale.setScalar(scale * (0.3 + 1.1 * easeOut(ru)))
    } else ringA.material.opacity = 0

    const rb = (t - 0.11) / 0.62
    if (rb > 0 && rb < 1) {
      ringB.material.opacity = 0.4 * Math.min(1, rb / 0.1) * Math.pow(1 - rb, 1.5)
      ringB.scale.setScalar(scale * (0.28 + 1.45 * easeOut(rb)))
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
    speed: 2.4,
    life: 0.55,
    scale: 0.15 * k,
    // Wide enough that the shell is born as a ring of sparks rather than as
    // one point that happens to contain twenty-two of them. Still inside the
    // fruit's own hand-span, so the burst is unmistakably *about* the tomato.
    jitter: 0.26 * k,
  })
  // Slow shimmer: near-stationary motes that hang inside the slow-mo window,
  // so the frame still reads gold after the shell has flown.
  opts.bursts.emit(opts.at, Math.round(TELL_SHIMMER * k), [LOTTO_GOLD, TELL_PALE], {
    kind: 'spark',
    speed: 0.8,
    life: 1.15,
    scale: 0.12 * k,
    jitter: 0.2 * k,
  })

  opts.audio.play('lotto-chime')
  opts.slowMo(TELL_SLOWMO_SECONDS, TELL_SLOWMO_SCALE)
}

/* ------------------------------------------------------------------------- *
 *  Odd-fruit shimmer
 * ------------------------------------------------------------------------- */

/** Motes in the orbit. Few enough to read as jewellery, not as a firework. */
const ODD_MOTES = 7
/**
 * Orbit radius / height, units — sized to ring a single plump fruit, and
 * re-measured against one. A plump Sun Tomato is roughly 0.16 u across and the
 * odd one 1.4× that; an orbit at 0.36 was circling empty air a hand's width
 * clear of the fruit, which is why the shimmer read as a separate object
 * hovering near the bed instead of as something *on* the tomato.
 */
const ODD_RADIUS = 0.24
const ODD_HEIGHT = 0.26
/** Base point size (~0.15 u on screen at the average twinkle). */
const ODD_SIZE = 0.3
/** Screen ceiling for one glint, CSS pixels. See `patchPointSize`. */
const ODD_MAX_PX = 26
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
  patchPointSize(material, ODD_MAX_PX)

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
        sizes[i] = 0.55 + twinkle * 0.65
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.attributes.aSize.needsUpdate = true
    },
  }
}

/* ------------------------------------------------------------------------- *
 *  Leaf burst
 * ------------------------------------------------------------------------- */

/**
 * Jungle greens for torn foliage, authored a step *below* the spec's range.
 *
 * The palette's `#2E6B3A → #8FCF6B` describes the jungle as the player should
 * see it after the grade; postfx then multiplies saturation by 1.2, so writing
 * the sunlit end literally is how the first pass ended up throwing fluorescent
 * lime. These are the same three greens pulled back to survive that push, with
 * the deep end carrying most of the weight: a vine that has just been ripped
 * open shows its shaded underside, not its canopy face.
 *
 * Two dry browns ride along with the greens. A vine that has been strangling
 * itself for a season shakes out dead matter as well as living leaf, and a
 * burst dealt in greens alone — however dark — comes off the prop as one flat
 * colour, which is most of what makes a spray read as *decoration* rather than
 * as something coming apart.
 */
const LEAF_COLORS = [0x2b5f34, 0x6e5a35, 0x3d7a40, 0x2b5f34, 0x63955a, 0x8a6f40]
/**
 * Leaf scale, world units. A torn frond fragment is a few centimetres of green
 * — at the opening's close camera the old default put 20-pixel slabs across the
 * frame, which read as confetti at a children's party rather than as something
 * tearing. Small and many is the shape of destruction; large and few is party
 * decoration.
 *
 * Halved again on the third pass, alongside a matching cut in the vine rig's
 * own chips (assets/opening/chaos-props.ts, `CHIP_COUNT`): these particles and
 * those meshes land in the same frame, so they have to be sized against each
 * other or the smaller of the two simply disappears under the larger.
 */
const LEAF_SCALE = 0.042
const LEAF_COUNT = 30

/**
 * "Something green just tore": the vine-snap / frond-sweep burst.
 *
 * Spec VFX #2. Not permanent grammar the way the breath and the tell are — it
 * is allowed to mean nothing beyond *this object came apart* — but it fires on
 * every clearable in the pocket, which makes it the effect the player sees more
 * often than any other in the opening, and the one whose scale and colour set
 * how violent the clearing feels.
 *
 * Two emissions rather than one: a fast shell of torn fragments thrown along
 * the tear, and a slower drift of a handful of whole leaves that flutter down
 * afterwards. The second one is the whole feeling — debris that settles reads
 * as matter, debris that vanishes at the top of its arc reads as a particle
 * system.
 *
 * Both are held inside about a second and inside a metre. The old drift ran to
 * 2.6 s at full life roll, which is long enough that a player who clears three
 * tangles in a row is never once looking at a clean frame — the leaves from the
 * first snap are still in the air when the third one goes, and a pocket with
 * permanent green in the air over it is a pocket that never reads as *cleared*.
 */
export function playLeafBurst(opts: { at: THREE.Vector3; bursts: Bursts; k?: number }): void {
  const k = opts.k ?? 1
  opts.bursts.emit(opts.at, Math.round(LEAF_COUNT * k), LEAF_COLORS, {
    kind: 'petal',
    speed: 1.6,
    life: 0.7,
    scale: LEAF_SCALE * k,
    jitter: 0.18 * k,
  })
  opts.bursts.emit(opts.at, Math.round(6 * k), LEAF_COLORS, {
    kind: 'petal',
    speed: 0.7,
    life: 0.95,
    scale: LEAF_SCALE * 1.4 * k,
    jitter: 0.24 * k,
  })
}
