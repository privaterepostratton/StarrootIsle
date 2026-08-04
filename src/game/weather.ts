import * as THREE from 'three'
import { FOG_NEAR, FOG_FAR, type Engine } from '../core/engine'
import { RainSplashes } from '../assets/splash'
import { groundHeight, WATER_LEVEL } from './terrain'

/**
 * Weather cycle.
 *
 * Weather is applied as a *multiplier* on top of whatever the day/night cycle
 * has already set, so the two systems compose: an overcast noon is still
 * brighter than a clear midnight. DayCycle.apply() must therefore run first
 * each frame, and Weather.update() second.
 *
 * Rain is not just decoration — it waters every tilled tile, which is the
 * reason to care about the forecast at all.
 */

export type WeatherType =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'fog'
  // Global events: rare, short, announced, and the only source of their
  // matching mutations. See MUTATIONS in mutations.ts.
  | 'meteor'
  | 'bloodmoon'
  | 'disco'

interface WeatherDef {
  type: WeatherType
  name: string
  emoji: string
  /** Multipliers applied to the day cycle's light values. */
  sunMul: number
  hemiMul: number
  ambientMul: number
  /** 0 = sky untouched, 1 = fully overcast grey. */
  greyness: number
  /** 0..1 particle density. */
  rain: number
  /** Pulls the fog in, which is what actually sells mist and downpours. */
  fogPull: number
  /** How likely this is to be picked next, relative to the others. */
  weight: number
  /** Seconds this weather lasts, before ±40% jitter. */
  duration: number
  /** Global events are announced and never enter the normal rotation. */
  event?: boolean
  /** Sky tint pushed during an event, instead of overcast grey. */
  tint?: number
}

const DEFS: Record<WeatherType, WeatherDef> = {
  clear: {
    type: 'clear', name: 'Clear', emoji: '☀️',
    sunMul: 1, hemiMul: 1, ambientMul: 1, greyness: 0, rain: 0, fogPull: 0,
    weight: 34, duration: 150,
  },
  cloudy: {
    type: 'cloudy', name: 'Cloudy', emoji: '☁️',
    sunMul: 0.5, hemiMul: 0.95, ambientMul: 1.15, greyness: 0.55, rain: 0, fogPull: 0.18,
    weight: 26, duration: 110,
  },
  rain: {
    type: 'rain', name: 'Rain', emoji: '🌧️',
    sunMul: 0.28, hemiMul: 0.8, ambientMul: 1.1, greyness: 0.78, rain: 0.55, fogPull: 0.42,
    weight: 22, duration: 90,
  },
  storm: {
    type: 'storm', name: 'Storm', emoji: '⛈️',
    sunMul: 0.16, hemiMul: 0.62, ambientMul: 1.0, greyness: 0.9, rain: 1, fogPull: 0.6,
    weight: 8, duration: 65,
  },
  fog: {
    type: 'fog', name: 'Misty', emoji: '🌫️',
    sunMul: 0.42, hemiMul: 1.15, ambientMul: 1.35, greyness: 0.7, rain: 0, fogPull: 0.72,
    weight: 10, duration: 85,
  },

  // --- global events -------------------------------------------------------
  // Deliberately short. An event is a scramble to get seeds in the ground, not
  // a weather state you settle into.
  meteor: {
    type: 'meteor', name: 'Meteor Shower', emoji: '☄️',
    sunMul: 0.2, hemiMul: 0.5, ambientMul: 1.1, greyness: 0.3, rain: 0, fogPull: 0.1,
    weight: 0, duration: 50, event: true, tint: 0xff8a4a,
  },
  bloodmoon: {
    type: 'bloodmoon', name: 'Blood Moon', emoji: '🌑',
    sunMul: 0.14, hemiMul: 0.45, ambientMul: 0.95, greyness: 0.5, rain: 0, fogPull: 0.3,
    weight: 0, duration: 60, event: true, tint: 0xc41f2a,
  },
  disco: {
    type: 'disco', name: 'Disco', emoji: '🪩',
    sunMul: 0.35, hemiMul: 0.8, ambientMul: 1.3, greyness: 0.2, rain: 0, fogPull: 0.15,
    weight: 0, duration: 40, event: true, tint: 0xd94fd0,
  },
}

/** Weight 0 keeps events out of the ordinary rotation — they are rolled
 *  separately on their own timer. */
const ORDER: WeatherType[] = ['clear', 'cloudy', 'rain', 'storm', 'fog']
const EVENTS: WeatherType[] = ['meteor', 'bloodmoon', 'disco']

/** Seconds between event rolls, and the chance one actually fires. */
const EVENT_CHECK_SECONDS = 150
const EVENT_CHANCE = 0.34

/** Seconds to cross-fade between two weather states. */
const TRANSITION = 8

/**
 * The droplet sprite: a soft vertical capsule on a transparent field.
 *
 * Drawn rather than loaded, because it is sixteen lines of canvas against
 * another file to ship, decode and keep in step with the material that is its
 * only user.
 *
 * Vertical, not round. Point sprites are screen-aligned, so a streak in the
 * texture is a streak on screen whichever way the camera is turned — which is
 * what rain looks like, and a field of round dots does not. The ends fade
 * instead of stopping, so a drop has no hard edge to alias against at 3px.
 */
function makeDropTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, size * 0.12, 0, size * 0.88)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.28, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.75, 'rgba(255,255,255,0.95)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad

  // A capsule a fifth of the sprite wide: wide enough to survive being scaled
  // down to a few pixels, narrow enough to still read as a streak.
  const w = size * 0.2
  const x = (size - w) / 2
  ctx.beginPath()
  ctx.roundRect(x, size * 0.12, w, size * 0.76, w / 2)
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const RAIN_COUNT = 2600
const RAIN_AREA = 34
const RAIN_TOP = 20
const RAIN_SPEED = 26
/**
 * Height above the camera focus below which a droplet starts testing the ground.
 *
 * Sampling the terrain for all 2600 droplets every frame is wasted work — all
 * but the bottom sliver of the column are nowhere near it. Only droplets inside
 * this band pay for a height lookup, which is a few percent of the pool.
 */
const RAIN_PROBE_BAND = 2.2

const greyColor = new THREE.Color(0x8c93a0)
const flashColor = new THREE.Color(0xffffff)
const eventColor = new THREE.Color()
const tmpColor = new THREE.Color()

/* Weather recomputes the fog band from Engine's clear-weather constants rather
 * than mutating scene.fog in place — nothing else resets them each frame, so an
 * incremental tweak would compound to zero within seconds. */

export class Weather {
  current: WeatherDef = DEFS.clear
  private previous: WeatherDef = DEFS.clear
  /** 0 = fully `previous`, 1 = fully `current`. */
  private blend = 1
  private timer = DEFS.clear.duration

  private readonly rainPoints: THREE.Points
  private readonly rainPos: Float32Array
  private readonly rainVel: Float32Array
  private readonly splashes: RainSplashes
  /**
   * Fraction of impacts that get a ring.
   *
   * Every droplet splashing looks like static at storm density and costs the
   * whole pool in a few frames. Thinning the impacts keeps the rings readable
   * as individual events, which is the point of drawing them at all.
   */
  private static readonly SPLASH_CHANCE = 0.22

  /** Brief additive flash during storms. */
  private flash = 0
  private flashCooldown = 6

  /** Countdown to the next event roll. */
  private eventCheck = EVENT_CHECK_SECONDS
  /** Set when an event starts, so the caller can announce it once. */
  pendingAnnounce: WeatherDef | null = null

  constructor(scene: THREE.Scene) {
    this.rainPos = new Float32Array(RAIN_COUNT * 3)
    this.rainVel = new Float32Array(RAIN_COUNT)
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * RAIN_AREA
      this.rainPos[i * 3 + 1] = Math.random() * RAIN_TOP
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA
      this.rainVel[i] = 0.8 + Math.random() * 0.5
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    // Frustum culling is disabled because the points are repositioned in place
    // every frame and the cached bounding sphere goes stale immediately.
    const mat = new THREE.PointsMaterial({
      color: 0xbcd8ea,
      /*
       * A point sprite is a *square* unless it is given a map, and an unmapped
       * one is a flat square of solid colour. Over a bright sky that passes for
       * a speck; over the night grade every drop reads as a pale blue tile
       * scattered across the mountains. The map is what makes it a drop.
       */
      map: makeDropTexture(),
      // Size is in pixels, not world units: sizeAttenuation scales points by
      // distance to the camera, which is constant under an orthographic
      // projection and collapses every droplet to the same sub-pixel dot.
      sizeAttenuation: false,
      size: 3,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.rainPoints = new THREE.Points(geo, mat)
    this.rainPoints.frustumCulled = false
    this.rainPoints.visible = false
    scene.add(this.rainPoints)

    this.splashes = new RainSplashes(scene)
  }

  /** True while precipitation is heavy enough to water crops. */
  get isRaining() {
    return this.rainStrength > 0.25
  }

  /** Blended rain density, 0..1. */
  get rainStrength() {
    return this.previous.rain + (this.current.rain - this.previous.rain) * this.blend
  }

  get label() {
    return `${this.current.emoji} ${this.current.name}`
  }

  get isEvent() {
    return this.current.event === true
  }

  /** Force a specific weather immediately (used when restoring a save). */
  set(type: WeatherType) {
    this.previous = DEFS[type]
    this.current = DEFS[type]
    this.blend = 1
    this.timer = jitter(DEFS[type].duration)
  }

  private pickNext() {
    // Never repeat the current weather — a "change" that changes nothing reads
    // as the system being broken.
    const candidates = ORDER.filter((t) => t !== this.current.type)
    let total = 0
    for (const t of candidates) total += DEFS[t].weight
    let roll = Math.random() * total
    for (const t of candidates) {
      roll -= DEFS[t].weight
      if (roll <= 0) return DEFS[t]
    }
    return DEFS[candidates[0]]
  }

  update(dt: number, engine: Engine) {
    // Events pre-empt the normal rotation, but never interrupt another event.
    if (!this.isEvent) {
      this.eventCheck -= dt
      if (this.eventCheck <= 0) {
        this.eventCheck = EVENT_CHECK_SECONDS
        if (Math.random() < EVENT_CHANCE) {
          const pick = EVENTS[Math.floor(Math.random() * EVENTS.length)]
          this.previous = this.current
          this.current = DEFS[pick]
          this.blend = 0
          this.timer = DEFS[pick].duration
          this.pendingAnnounce = this.current
        }
      }
    }

    this.timer -= dt
    if (this.timer <= 0) {
      this.previous = this.current
      this.current = this.pickNext()
      this.blend = 0
      this.timer = jitter(this.current.duration)
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / TRANSITION)

    const b = this.blend
    const sunMul = lerp(this.previous.sunMul, this.current.sunMul, b)
    const hemiMul = lerp(this.previous.hemiMul, this.current.hemiMul, b)
    const ambMul = lerp(this.previous.ambientMul, this.current.ambientMul, b)
    const greyness = lerp(this.previous.greyness, this.current.greyness, b)
    const fogPull = lerp(this.previous.fogPull, this.current.fogPull, b)

    this.updateFlash(dt)

    engine.sun.intensity *= sunMul
    engine.hemi.intensity *= hemiMul
    engine.ambient.intensity = engine.ambient.intensity * ambMul + this.flash * 1.6

    // Desaturate the sky and fog toward overcast grey.
    const bg = engine.scene.background as THREE.Color
    // Events colour the sky rather than greying it — that tint is the signal
    // the player reads from anywhere on the map.
    const tint = this.current.tint ?? this.previous.tint
    tmpColor.copy(tint !== undefined ? eventColor.setHex(tint) : greyColor)
    if (this.flash > 0) tmpColor.lerp(flashColor, this.flash)
    bg.lerp(tmpColor, greyness)

    // Tighten the fog band toward the camera as conditions close in.
    const fog = engine.scene.fog as THREE.Fog
    fog.color.copy(bg)
    fog.near = FOG_NEAR - 48 * fogPull
    fog.far = FOG_FAR - 130 * fogPull

    this.updateRain(dt, engine)
  }

  private updateFlash(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 4.5)
    const flashes = this.current.type === 'storm' || this.current.type === 'meteor' || this.current.type === 'disco'
    if (!flashes || this.blend < 0.5) return
    this.flashCooldown -= dt
    if (this.flashCooldown <= 0) {
      this.flash = this.current.type === 'disco' ? 0.5 : 0.85
      // Disco strobes; meteors streak often; storms are sparse.
      this.flashCooldown =
        this.current.type === 'disco' ? 0.28 : this.current.type === 'meteor' ? 0.7 + Math.random() * 1.4 : 3 + Math.random() * 9
    }
  }

  private updateRain(dt: number, engine: Engine) {
    const strength = this.rainStrength
    const mat = this.rainPoints.material as THREE.PointsMaterial

    if (strength <= 0.01) {
      this.rainPoints.visible = false
      // Keep ticking: rings landed on the last wet frame still have to finish.
      this.splashes.update(dt)
      return
    }
    this.rainPoints.visible = true
    mat.opacity = 0.28 + strength * 0.45
    // Larger than the old square: most of the sprite is transparent now, so the
    // same pixel size would leave a thread of a drop.
    mat.size = 4.5 + strength * 3.5

    // Only simulate the share of particles the current density calls for; the
    // rest stay parked offscreen. Cheaper than resizing the buffer.
    const active = Math.floor(RAIN_COUNT * strength)
    const fx = engine.focus.x
    const fy = engine.focus.y
    const fz = engine.focus.z
    const fall = RAIN_SPEED * dt * (0.7 + strength * 0.6)

    for (let i = 0; i < RAIN_COUNT; i++) {
      const yi = i * 3 + 1
      if (i >= active) {
        this.rainPos[yi] = -9999
        continue
      }
      let y = this.rainPos[yi]
      if (y < -9000) y = fy + Math.random() * RAIN_TOP
      y -= fall * this.rainVel[i]

      // Land the droplet on whatever is under it — terrain, or the water
      // surface where the terrain is below it. Testing against the actual
      // ground rather than a fixed floor is what puts rings on the hillsides
      // and the pond instead of all at one height.
      let landed = false
      if (y < fy + RAIN_PROBE_BAND) {
        const gx = this.rainPos[i * 3]
        const gz = this.rainPos[i * 3 + 2]
        const surface = Math.max(groundHeight(gx, gz), WATER_LEVEL)
        if (y <= surface) {
          landed = true
          if (Math.random() < Weather.SPLASH_CHANCE) this.splashes.spawn(gx, surface, gz)
        }
      }

      if (landed || y < fy - 6) {
        // Respawn at the top of a column centred on the camera focus, so the
        // rain volume travels with the player without ever visibly popping.
        // The height fallback catches droplets over a hole in the world.
        y = fy + RAIN_TOP
        this.rainPos[i * 3] = fx + (Math.random() - 0.5) * RAIN_AREA
        this.rainPos[i * 3 + 2] = fz + (Math.random() - 0.5) * RAIN_AREA
      }
      this.rainPos[yi] = y
    }

    ;(this.rainPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    this.splashes.update(dt)
  }

  serialize() {
    return { type: this.current.type, timer: this.timer }
  }

  deserialize(d: { type: WeatherType; timer: number } | undefined) {
    if (!d || !DEFS[d.type]) return
    this.set(d.type)
    this.timer = d.timer ?? this.timer
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function jitter(seconds: number) {
  return seconds * (0.6 + Math.random() * 0.8)
}
