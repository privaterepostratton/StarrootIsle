import * as THREE from 'three'
import type { Engine } from '../core/engine'

/**
 * Day/night cycle. Drives the sun angle, sky colour, and light intensity.
 * One in-game day is DAY_LENGTH real seconds; the day starts at 6am so a
 * fresh save opens on a sunrise rather than in the dark.
 */

export const DAY_LENGTH = 240
const START_HOUR = 6

/** Hour the isle opening pins the clock to (opening contract §4.2). */
export const OPENING_HOUR = 7.2

interface SkyKey {
  hour: number
  sky: number
  sun: number
  sunIntensity: number
  hemiIntensity: number
  ambient: number
  /**
   * Sky half of the hemisphere fill.
   *
   * The hemisphere light is the strongest source in the rig and it was a fixed
   * cool blue all day, which meant every up-facing surface — the whole beach,
   * the whole clearing floor — was lit at 6 a.m. by the same daylight it gets at
   * noon. Nothing else in the grade could make dawn read as dawn against that.
   * Keyed here, warm at the ends of the day and unchanged at midday, it is what
   * puts the warm cast on the ivory sand that the spec asks the ambient to
   * take its colour from.
   */
  hemiSky: number
}

// Keyframes are interpolated in order and wrap from the last back to the first.
/**
 * Daytime keys are high-key on purpose: fill (hemi + ambient) stays strong
 * relative to the sun so shadowed faces never go near black, which is the
 * single biggest thing separating this look from a generic outdoor scene. Night
 * keeps the old contrast — that is where the mood is supposed to live.
 */
/**
 * The 7 a.m. key is the isle opening's *entire* lighting rig.
 *
 * The opening pins the clock at hour 7.2 and never advances it, so whatever
 * sits between these two keys is what the first session looks like from wake to
 * goat. It used to interpolate to something near midday almost immediately —
 * strong flat fill, cool sky bounce, a key barely warmer than white — and the
 * frames came back reading as noon on a lawn. Dawn now costs the fill some
 * strength and hands it to the key: fewer lumens from everywhere, more from one
 * low warm direction, which is the only way a jungle wall gets a rim on it and
 * the only way shadows get long enough to point at the sea.
 */
const KEYS: SkyKey[] = [
  { hour: 0, sky: 0x121a33, sun: 0x3a4a80, sunIntensity: 0.25, hemiIntensity: 0.45, ambient: 0.24, hemiSky: 0xa6bce4 },
  { hour: 5, sky: 0x2c3a5e, sun: 0x6a6a9c, sunIntensity: 0.5, hemiIntensity: 0.7, ambient: 0.32, hemiSky: 0xbccae6 },
  { hour: 7, sky: 0xf6b98c, sun: 0xffbe80, sunIntensity: 1.62, hemiIntensity: 0.9, ambient: 0.38, hemiSky: 0xefdcc6 },
  { hour: 10, sky: 0x8fd4f2, sun: 0xfff4dc, sunIntensity: 1.75, hemiIntensity: 1.4, ambient: 0.52, hemiSky: 0xd2eeff },
  { hour: 15, sky: 0x8ad0f2, sun: 0xfff2d4, sunIntensity: 1.75, hemiIntensity: 1.4, ambient: 0.52, hemiSky: 0xd2eeff },
  { hour: 18, sky: 0xf7ac6c, sun: 0xffa86c, sunIntensity: 1.25, hemiIntensity: 1.05, ambient: 0.42, hemiSky: 0xf0d5c0 },
  { hour: 20, sky: 0x4a3f6b, sun: 0x8a6aa0, sunIntensity: 0.6, hemiIntensity: 0.62, ambient: 0.3, hemiSky: 0xbdb2d4 },
  { hour: 22, sky: 0x1a2240, sun: 0x4a5a90, sunIntensity: 0.3, hemiIntensity: 0.5, ambient: 0.26, hemiSky: 0xa8bade },
]

const cA = new THREE.Color()
const cB = new THREE.Color()
const skyTint = new THREE.Color()
const WHITE = new THREE.Color(0xffffff)

/**
 * The isle opening's dawn, stated outright instead of sampled off the curve.
 *
 * The opening pins the clock and then never advances it, so the day curve only
 * ever contributes one instant to it — and a keyframe that also has to serve
 * "the hour after sunrise on an ordinary day, seen from a village" is not free
 * to be as directional or as warm as the opening's one shot needs. Naming the
 * rig here costs nothing (the curve is untouched, the normal cycle restores it
 * on the first `apply` after handover) and buys the three things the spec's
 * light paragraph actually asks for: a warm low key, a fill strong enough that
 * jungle shade stays readable rather than going to olive-black, and a sun the
 * clearing can be lit *by* rather than merely near.
 *
 * `sunOffset` is what makes the shadows point at the sea. The sea is west, -x,
 * so the key sits inland at +x and low, and everything in the frame throws its
 * shadow toward the water. Elevation is just under 20° — pictorially still dawn
 * (shadows near three times an object's height) but far enough off the horizon
 * that the clearing floor takes real light instead of a grazing sliver of it.
 */
const DAWN = {
  sky: 0xffcf9c,
  sun: 0xffe0c0,
  /**
   * The key, and the number the whole defect turned on.
   *
   * At 2.5 against a hemisphere of 1.28 and an ambient of 0.56, a *horizontal*
   * surface — the beach, the whole clearing floor, the thing that fills the
   * bottom half of four beats — took 2.5·cos(73°) ≈ 0.73 from the sun and 1.84
   * from the fill. Two thirds of the light on the largest surface in frame
   * arrived from no direction at all, which is the definition of flat, and no
   * amount of grading rescues a picture lit that way: the clearing came back as
   * murky green twilight with nothing casting and nothing rimmed.
   *
   * 3.9 against a fill cut by a quarter inverts that ratio. The floor now takes
   * more of its light from one warm low direction than from everywhere, which
   * is what makes a dawn read as a dawn.
   */
  sunIntensity: 3.9,
  /**
   * Sky bounce, and the light that has to stay honest.
   *
   * The hemisphere is what every up-facing surface in the scene is mostly lit
   * by — the whole beach, the whole clearing floor — and warming it is the
   * cheapest-looking way to make a frame say "dawn". It is also a trap: the
   * sand is an ivory whose blue channel is the first casualty of any warm
   * light, and with the key, the fill and the ambient all warm as well, a warm
   * hemisphere on top tipped the beach into reserved lotto gold (the verifier
   * measured eleven percent of the tide-line beat inside `#F2C14E`). Kept a
   * whisker off neutral: the *direction* of the key carries the hour, and the
   * fill below is where the deliberate warmth lives.
   */
  hemiSky: 0xfff5ee,
  hemiIntensity: 1.0,
  ambientIntensity: 0.44,
  /**
   * Sand bounce, standing in for the rim light the spec asks for.
   *
   * The sun is east and the wall faces west, so its front leaves — the ones the
   * player is nose-to-nose with for eight minutes — are pure backlight, and
   * Lambert has no rim term to give them. What a real beach at dawn *does* have
   * is a hundred metres of warm ivory sand throwing light back inland, and that
   * bounce lands on exactly those faces. So the counter-light is warm rather
   * than the cycle's cool blue, and it is the one light in the rig aimed at the
   * front of the jungle. Its intensity is modest because it is also raking
   * across the beach itself, where warmth is the thing to spend carefully.
   */
  fillIntensity: 0.5,
  fill: 0xffdcb8,
  /**
   * Key offset from the focus point: inland (+x), low, slightly seaward-north.
   *
   * Elevation is 19.5° — shadows a shade under three times an object's height,
   * running west toward the sea. Raised a degree and a half from the previous
   * rig, which is the difference between the floor taking 29 % of the key and
   * 33 % of it; below that the ground simply cannot be lit by the sun at all
   * and every gain has to come from fill, which is where the flatness came
   * from in the first place.
   */
  sunOffset: [26, 9.9, 10] as const,
  /** Counter-light: mirrored through the focus, kept low and shadowless. */
  fillOffset: [-26, 7, -12] as const,
  /** Skybox multiply — warm enough to read as dawn without losing the clouds. */
  skyWhiteMix: 0.3,
  skyBrightness: 1.04,
  /** Warm low cloud deck at the horizon (Skybox.setHorizonBand). */
  horizon: 0xffb473,
  horizonStrength: 0.72,
}

/**
 * The ordinary cycle's counter-light colour — cool sky bounce (engine.ts).
 *
 * Named here because the opening's rig repaints the fill warm, and `apply` is
 * the handover: main.ts's handover comment is only true while *every* value the
 * dawn rig writes is written back by `apply`, so a light the opening tints has
 * to be a light the cycle un-tints.
 */
const CYCLE_FILL = 0xbcd8f5

/**
 * The dome's dawn deck, reached without widening the engine's skybox slot.
 *
 * `Engine.skybox` is deliberately a one-method structural type so the core has
 * no dependency on the asset module. The band is an opening-only affordance, so
 * it is probed for here rather than promoted into that contract — a skybox
 * implementation that has not got one simply does not get a sunrise.
 */
function setSkyHorizon(
  skybox: { setTint(color: THREE.Color): void } | null,
  color: THREE.Color,
  strength: number,
) {
  ;(skybox as { setHorizonBand?: (c: THREE.Color, s: number) => void } | null)?.setHorizonBand?.(
    color,
    strength,
  )
}

/** Shadow-frustum half-extent: the engine's default, and the opening's. */
const SHADOW_HALF = 22
/**
 * The opening plays across a longer lane than an ordinary farm session — the
 * wake spot and the clearing are twenty-two units apart and the jungle wall
 * stands over both — so the box is widened while it runs. At 2048 the wider
 * box is still ~36 texels per unit, and the alternative is watching the wall's
 * shadows switch on as the frustum edge sweeps over them.
 */
const OPENING_SHADOW_HALF = 28

export class DayCycle {
  /** Seconds elapsed within the current day. */
  time = (START_HOUR / 24) * DAY_LENGTH
  day = 1

  get hour() {
    return (this.time / DAY_LENGTH) * 24
  }

  get clockLabel() {
    const h24 = Math.floor(this.hour)
    const m = Math.floor((this.hour - h24) * 60)
    const suffix = h24 < 12 ? 'am' : 'pm'
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h12}:${m.toString().padStart(2, '0')}${suffix}`
  }

  get isNight() {
    return this.hour < 5.5 || this.hour > 19.5
  }

  /** Advance time. Returns true on the frame the day rolls over. */
  update(dt: number, engine: Engine) {
    this.time += dt
    let rolled = false
    if (this.time >= DAY_LENGTH) {
      this.time -= DAY_LENGTH
      this.day++
      rolled = true
    }
    this.apply(engine)
    return rolled
  }

  /** Fast-forward without touching lights, used for offline progress. */
  advance(seconds: number) {
    const total = this.time + seconds
    this.day += Math.floor(total / DAY_LENGTH)
    this.time = total % DAY_LENGTH
  }

  /**
   * The opening's lighting, applied in place of the curve.
   *
   * **This must run every frame while the opening is active**, not once at
   * boot. Both the key light and its shadow camera are positioned *relative to
   * `engine.focus`*, and focus follows the player — so a rig applied once at
   * the wake spot leaves the sun aimed at an empty beach while the player is
   * twenty-two units inland in the clearing, which is exactly the far edge of
   * the shadow frustum. Everything past that edge samples the clamped border of
   * the shadow map and comes back fully shadowed: no sun on the clearing floor,
   * and a hard straight boundary lying diagonally across the frame where the
   * frustum ends. Re-applying costs a handful of vector writes.
   *
   * Nothing here is sticky. Every value it touches is also written by `apply`,
   * so the first ordinary day tick after handover restores the normal cycle.
   */
  applyOpeningDawn(engine: Engine) {
    const sky = cA.setHex(DAWN.sky)
    // Fog carries the dawn haze; pulled slightly toward white so the jungle
    // reads as receding into warm air rather than as being painted peach.
    engine.scene.fog!.color.copy(sky).lerp(WHITE, 0.1)
    if (engine.skybox) {
      const peak = Math.max(sky.r, sky.g, sky.b) || 1
      skyTint.copy(sky).multiplyScalar(1 / peak).lerp(WHITE, DAWN.skyWhiteMix)
      engine.skybox.setTint(skyTint.clone().multiplyScalar(DAWN.skyBrightness))
      // The dawn deck. A flat multiply cannot make a sunrise on its own — it
      // moves the zenith with the horizon — so the warm low cloud is a separate
      // band, and `apply` clears it (strength 0) at handover.
      setSkyHorizon(engine.skybox, cB.setHex(DAWN.horizon), DAWN.horizonStrength)
      engine.scene.background = null
    }

    engine.sun.color.setHex(DAWN.sun)
    engine.sun.intensity = DAWN.sunIntensity
    engine.hemi.color.setHex(DAWN.hemiSky)
    engine.hemi.intensity = DAWN.hemiIntensity
    engine.ambient.intensity = DAWN.ambientIntensity
    engine.fill.intensity = DAWN.fillIntensity
    // The cycle leaves this a cool blue all day; the opening wants warm sand
    // bounce off the beach instead. `apply` never writes fill colour, so this
    // is the one value here that has to be handed back by name at handover.
    engine.fill.color.setHex(DAWN.fill)

    engine.sun.position.set(
      engine.focus.x + DAWN.sunOffset[0],
      engine.focus.y + DAWN.sunOffset[1],
      engine.focus.z + DAWN.sunOffset[2],
    )
    engine.sun.target.position.copy(engine.focus)
    engine.sun.target.updateMatrixWorld()
    engine.fill.position.set(
      engine.focus.x + DAWN.fillOffset[0],
      engine.focus.y + DAWN.fillOffset[1],
      engine.focus.z + DAWN.fillOffset[2],
    )
    this.setShadowHalf(engine, OPENING_SHADOW_HALF)

    // Nothing in the opening is lit by lamps, and the backdrop takes the same
    // warm morning wash as the fog.
    if (engine.lanterns) engine.lanterns.setGlow(0.03)
    if (engine.skyline) {
      const peak = Math.max(sky.r, sky.g, sky.b) || 1
      skyTint.copy(sky).multiplyScalar(1 / peak).lerp(WHITE, 0.6)
      engine.skyline.setTint(skyTint.multiplyScalar(0.95))
    }
  }

  /** Ortho shadow frustum half-extent. Cheap to call; no-ops when unchanged. */
  private shadowHalf = SHADOW_HALF
  private setShadowHalf(engine: Engine, half: number) {
    if (this.shadowHalf === half) return
    this.shadowHalf = half
    const cam = engine.sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.updateProjectionMatrix()
  }

  apply(engine: Engine) {
    // Hands the frustum back if the opening widened it.
    this.setShadowHalf(engine, SHADOW_HALF)
    const h = this.hour

    let a = KEYS[KEYS.length - 1]
    let b = KEYS[0]
    for (let i = 0; i < KEYS.length; i++) {
      const cur = KEYS[i]
      const next = KEYS[(i + 1) % KEYS.length]
      const nextHour = next.hour <= cur.hour ? next.hour + 24 : next.hour
      if (h >= cur.hour && h < nextHour) {
        a = cur
        b = next
        break
      }
    }
    const span = (b.hour <= a.hour ? b.hour + 24 : b.hour) - a.hour
    const t = span > 0 ? (h - a.hour) / span : 0

    cA.setHex(a.sky)
    cB.setHex(b.sky)
    const sky = cA.clone().lerp(cB, t)
    engine.scene.fog!.color.copy(sky)
    if (engine.skybox) {
      // Texture owns midday look; keys only shift hue/brightness around it.
      const peak = Math.max(sky.r, sky.g, sky.b) || 1
      skyTint.copy(sky).multiplyScalar(1 / peak).lerp(WHITE, 0.55)
      const brightness = clamp(0.22 + engine.sun.intensity * 0.48, 0.18, 1)
      engine.skybox.setTint(skyTint.clone().multiplyScalar(brightness))
      // Hands the dome back if the opening laid a dawn deck on it.
      setSkyHorizon(engine.skybox, WHITE, 0)
      // Dome covers the view — solid background would flash through any gap.
      engine.scene.background = null
    } else if (engine.scene.background instanceof THREE.Color) {
      engine.scene.background.copy(sky)
    }

    cA.setHex(a.sun)
    cB.setHex(b.sun)
    engine.sun.color.copy(cA.clone().lerp(cB, t))
    engine.sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t)
    engine.hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity, t)
    engine.ambient.intensity = lerp(a.ambient, b.ambient, t)

    cA.setHex(a.hemiSky)
    cB.setHex(b.hemiSky)
    engine.hemi.color.copy(cA.clone().lerp(cB, t))

    // Sun arcs east→west across the day; kept above the horizon at night so
    // shadows never flip and strobe.
    const angle = ((h - 6) / 24) * Math.PI * 2
    const elev = Math.max(0.25, Math.sin(angle))
    const radius = 30
    /*
     * The arc is squashed vertically.
     *
     * A circular path puts the 7 a.m. sun about seventeen degrees up, which is
     * technically morning and pictorially nothing: the shadows it casts are
     * barely three times an object's height and they died inside the frame. At
     * this ratio the same hour sits near twelve degrees and shadows run four
     * and a half times height, out of frame and toward the sea — which is the
     * one compositional line the opening's whole light plan is built on.
     * Midday loses seven degrees of elevation and gains nothing worse than
     * slightly longer shadows at noon.
     */
    const VERTICAL_SQUASH = 0.72
    engine.sun.position.set(
      engine.focus.x + Math.cos(angle) * radius,
      engine.focus.y + elev * radius * VERTICAL_SQUASH,
      engine.focus.z + 12,
    )
    engine.sun.target.position.copy(engine.focus)
    engine.sun.target.updateMatrixWorld()

    // Counter-light mirrors the sun through the focus point and stays low, so it
    // rakes across the faces the sun cannot reach. It fades as the sun does —
    // it represents bounced sunlight, so it cannot outlive its source.
    engine.fill.position.set(
      engine.focus.x - Math.cos(angle) * radius,
      engine.focus.y + 8 + elev * 6,
      engine.focus.z - 14,
    )
    engine.fill.intensity = 0.1 + engine.sun.intensity * 0.2
    // Hands the fill's colour back if the opening warmed it (see CYCLE_FILL).
    engine.fill.color.setHex(CYCLE_FILL)

    // --- distant ranges ----------------------------------------------------
    // The backdrop is unlit by design (see skyline.ts), so time of day reaches
    // it as a flat multiply. Take the sky's *hue* at a third strength — the
    // ranges already have haze toward the sky baked in, and applying the full
    // sky colour on top of that turns them into a flat cyan band — then scale by
    // a brightness tracking the sun so they darken into the night with the rest
    // of the valley.
    // --- lanterns ----------------------------------------------------------
    // Brightest when the sun is weakest, and fully out at midday. Tied to the
    // sun rather than to `isNight` so they fade up through dusk instead of
    // snapping on at a threshold.
    if (engine.lanterns) {
      const dark = 1 - clamp((engine.sun.intensity - 0.5) / 1.0, 0, 1)
      // Kept modest: the head is small and the bloom threshold is low enough
      // that pushing this harder produces a flare rather than a lit lamp.
      engine.lanterns.setGlow(0.03 + dark * 0.75)
    }

    if (engine.skyline) {
      const peak = Math.max(sky.r, sky.g, sky.b) || 1
      skyTint.copy(sky).multiplyScalar(1 / peak).lerp(WHITE, 0.65)
      const brightness = clamp(0.25 + engine.sun.intensity * 0.42, 0.25, 1)
      engine.skyline.setTint(skyTint.multiplyScalar(brightness))
    }
  }

  serialize() {
    return { time: this.time, day: this.day }
  }

  deserialize(d: { time: number; day: number } | undefined) {
    if (!d) return
    this.time = d.time ?? this.time
    this.day = d.day ?? 1
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}
