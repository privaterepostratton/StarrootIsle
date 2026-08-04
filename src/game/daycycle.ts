import * as THREE from 'three'
import type { Engine } from '../core/engine'

/**
 * Day/night cycle. Drives the sun angle, sky colour, and light intensity.
 * One in-game day is DAY_LENGTH real seconds; the day starts at 6am so a
 * fresh save opens on a sunrise rather than in the dark.
 */

export const DAY_LENGTH = 240
const START_HOUR = 6

interface SkyKey {
  hour: number
  sky: number
  sun: number
  sunIntensity: number
  hemiIntensity: number
  ambient: number
}

// Keyframes are interpolated in order and wrap from the last back to the first.
/**
 * Daytime keys are high-key on purpose: fill (hemi + ambient) stays strong
 * relative to the sun so shadowed faces never go near black, which is the
 * single biggest thing separating this look from a generic outdoor scene. Night
 * keeps the old contrast — that is where the mood is supposed to live.
 */
const KEYS: SkyKey[] = [
  { hour: 0, sky: 0x121a33, sun: 0x3a4a80, sunIntensity: 0.25, hemiIntensity: 0.45, ambient: 0.24 },
  { hour: 5, sky: 0x2c3a5e, sun: 0x6a6a9c, sunIntensity: 0.5, hemiIntensity: 0.7, ambient: 0.32 },
  { hour: 7, sky: 0xf6b98c, sun: 0xffc48c, sunIntensity: 1.3, hemiIntensity: 1.15, ambient: 0.46 },
  { hour: 10, sky: 0x8fd4f2, sun: 0xfff4dc, sunIntensity: 1.75, hemiIntensity: 1.4, ambient: 0.52 },
  { hour: 15, sky: 0x8ad0f2, sun: 0xfff2d4, sunIntensity: 1.75, hemiIntensity: 1.4, ambient: 0.52 },
  { hour: 18, sky: 0xf7ac6c, sun: 0xffa86c, sunIntensity: 1.25, hemiIntensity: 1.05, ambient: 0.42 },
  { hour: 20, sky: 0x4a3f6b, sun: 0x8a6aa0, sunIntensity: 0.6, hemiIntensity: 0.62, ambient: 0.3 },
  { hour: 22, sky: 0x1a2240, sun: 0x4a5a90, sunIntensity: 0.3, hemiIntensity: 0.5, ambient: 0.26 },
]

const cA = new THREE.Color()
const cB = new THREE.Color()
const skyTint = new THREE.Color()
const WHITE = new THREE.Color(0xffffff)

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

  apply(engine: Engine) {
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

    // Sun arcs east→west across the day; kept above the horizon at night so
    // shadows never flip and strobe.
    const angle = ((h - 6) / 24) * Math.PI * 2
    const elev = Math.max(0.25, Math.sin(angle))
    const radius = 30
    engine.sun.position.set(
      engine.focus.x + Math.cos(angle) * radius,
      engine.focus.y + elev * radius,
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
