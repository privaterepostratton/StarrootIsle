import * as THREE from 'three'
import { MINOR_LAYER } from '../assets/style'
import { groundHeight } from '../game/terrain'
import { isHandheld } from '../ui/fullscreen'

/**
 * Third-person camera rig.
 *
 * The camera orbits a focus point pinned to the farmer's chest: right-drag
 * looks around, the wheel zooms, and Q/R still snap in 90° steps for players
 * who prefer the old fixed angles. Movement stays camera-relative, so W is
 * always "away from the camera" no matter where you have swung it.
 */

/** How far back the camera sits by default on desktop. */
export const DEFAULT_DISTANCE = 11
/** Phones start closer so plots and the farmer fill more of a small screen. */
const MOBILE_DEFAULT_DISTANCE = 7
const MIN_DISTANCE = 3.5
/* Tightened repeatedly (26 → 17 → 13 → 11): zoomed out the street reads as a
 * diorama — every farm at once, plants at a few pixels. Pinned to
 * DEFAULT_DISTANCE, so the framing the game opens with is the widest there is
 * and the wheel / pinch only zooms *in* from it. If this ever needs loosening,
 * keep it >= DEFAULT_DISTANCE or the camera spawns outside its own clamp. */
const MAX_DISTANCE = DEFAULT_DISTANCE

function startDistance() {
  return isHandheld() ? MOBILE_DEFAULT_DISTANCE : DEFAULT_DISTANCE
}

/** Height above the farmer's feet that the camera actually looks at. */
const FOCUS_HEIGHT = 1.15

/** Extra gap kept between the camera and any obstacle it swings past. */
const CAMERA_CLEARANCE = 0.55

const MIN_PITCH = -0.25
const MAX_PITCH = 1.32
const LOOK_SENSITIVITY = 0.0042

/**
 * Fog band, in real view distance now that the projection is perspective.
 *
 * Reaches past the mountain ring (which tops out around 120 units from the
 * valley centre) so the ring stays legible as rock and snow. It used to end
 * inside the ring to kill a dark grey-green wall that filled the sky, but that
 * wall was a *shape* problem — a ring with no summits — and it is fixed in
 * terrain.ts now. Aerial perspective past the ring is the skyline's job, where
 * it is painted in rather than fogged (see skyline.ts); over-fogging here on top
 * of that turns the entire horizon into one milky band.
 */
export const FOG_NEAR = 60
export const FOG_FAR = 220

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  /** World-space point the camera orbits. Follow the player by writing to this. */
  readonly focus = new THREE.Vector3()

  /** Orbit angles. `yaw` eases toward `targetYaw` so Q/R reads as a swing. */
  yaw = Math.PI
  targetYaw = Math.PI
  /* Lowered from 0.42 to match the framing the game should open on: street
   * receding ahead, treeline and mountains on the horizon — a view down a
   * road, not down onto a board. Matched by eye against the target screenshot
   * at DEFAULT_DISTANCE. */
  pitch = 0.3

  /**
   * Camera preferences survive reloads.
   *
   * Stored in localStorage rather than the cloud save: how far someone likes
   * the camera is a property of the person and the screen they are at, not of
   * the farm — the same player on a phone and a monitor wants different zooms.
   * Written on a debounce from update() rather than on every wheel tick.
   */
  /** Separate keys so a phone does not inherit a desktop-wide framing. */
  private static cameraKey() {
    return isHandheld() ? 'sv-camera-mobile' : 'sv-camera'
  }
  private cameraSaveTimer = 0

  private restoreCamera() {
    try {
      const raw = localStorage.getItem(Engine.cameraKey())
      if (!raw) return
      const c = JSON.parse(raw) as { d?: number; pitch?: number; yaw?: number }
      if (typeof c.d === 'number' && Number.isFinite(c.d)) {
        this.targetDistance = clamp(c.d, MIN_DISTANCE, MAX_DISTANCE)
        this.distance = this.targetDistance
      }
      if (typeof c.pitch === 'number' && Number.isFinite(c.pitch)) {
        this.pitch = clamp(c.pitch, MIN_PITCH, MAX_PITCH)
      }
      if (typeof c.yaw === 'number' && Number.isFinite(c.yaw)) {
        this.yaw = c.yaw
        this.targetYaw = c.yaw
      }
    } catch {
      /* a corrupt pref is not worth a crash — fall back to defaults */
    }
  }

  private persistCamera() {
    try {
      localStorage.setItem(
        Engine.cameraKey(),
        JSON.stringify({ d: this.targetDistance, pitch: this.pitch, yaw: this.targetYaw }),
      )
    } catch {
      /* storage full or blocked — the pref is a nicety */
    }
  }

  distance = startDistance()
  private targetDistance = startDistance()

  readonly sun: THREE.DirectionalLight
  /** Shadowless counter-light opposite the sun, standing in for sky bounce. */
  readonly fill: THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight
  readonly ambient: THREE.AmbientLight

  private readonly canvas: HTMLCanvasElement
  private readonly clock = new THREE.Clock()
  private readonly lookAt = new THREE.Vector3()
  private dragging = false
  private shadowClock = 0
  /** Focus position at the last shadow render, for the movement test in render(). */
  private readonly lastShadowFocus = new THREE.Vector3(1e9, 0, 0)
  private readonly snapRight = new THREE.Vector3()
  private readonly snapUp = new THREE.Vector3()
  private obstacles: { x: number; z: number; r: number }[] | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Shadows are regenerated on a fixed cadence rather than every frame. The
    // sun takes four minutes to cross the sky and the shadow frustum only
    // shifts as the player walks, so a full re-render each frame is waste.
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    // Fallback clear colour until the equirectangular dome is attached; day
    // cycle keeps fog in sync with the sky keys either way.
    this.scene.background = new THREE.Color(0x8fd4f2)
    this.scene.fog = new THREE.Fog(0x8fd4f2, FOG_NEAR, FOG_FAR)

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 480)
    // The main view shows everything; the water's aux cameras stay on layer 0
    // and so skip the small-detail layer.
    this.camera.layers.enable(MINOR_LAYER)

    /**
     * Key light.
     *
     * The shadow frustum is tight on purpose. It follows the player (see
     * DayCycle.apply), so it only ever has to cover what is near them, and a
     * 2048 map over a 44-unit box gives ~46 texels per unit — enough that a
     * crop's shadow has a recognisable shape instead of a stair-stepped blob.
     * Widening this box is the single fastest way to make shadows look cheap.
     */
    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.75)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 110
    const s = 22
    this.sun.shadow.camera.left = -s
    this.sun.shadow.camera.right = s
    this.sun.shadow.camera.top = s
    this.sun.shadow.camera.bottom = -s
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.022
    // Penumbra width, in texels. Sunlight is not a point source; a hard edge on
    // every blade of grass is the tell that a scene is lit by a single lamp.
    this.sun.shadow.radius = 3.5
    this.scene.add(this.sun, this.sun.target)

    // Sky/ground bounce keeps shadowed faces readable — the Animal Crossing
    // look has very little true black in it, so the fill is deliberately strong
    // relative to the key and the ground bounce is a bright warm green rather
    // than the dark olive that was swallowing the undersides of the foliage.
    this.hemi = new THREE.HemisphereLight(0xd2eeff, 0x9cae68, 1.4)
    this.scene.add(this.hemi)

    this.ambient = new THREE.AmbientLight(0xfff6e8, 0.42)
    this.scene.add(this.ambient)

    /**
     * Cool counter-light from the opposite side of the sun.
     *
     * Hemisphere light is vertical only, so with one directional key every
     * surface facing away from the sun collapses to the same flat fill value and
     * the scene loses its sense of volume. A dim sky-blue light from behind
     * separates those faces from each other — the cheapest thing that reads as
     * bounced daylight rather than as a lamp in a black room. Shadowless, since
     * it is standing in for light that arrived from everywhere.
     */
    this.fill = new THREE.DirectionalLight(0xbcd8f5, 0.45)
    this.scene.add(this.fill)

    this.resize()
    addEventListener('resize', () => this.resize())
    this.bindLook()
    this.restoreCamera()
  }

  private bindLook() {
    // Right button (or middle) drags the view. Left stays free for click-to-move.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 && e.button !== 1) return
      this.dragging = true
      this.canvas.setPointerCapture(e.pointerId)
    })

    const stop = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    }
    this.canvas.addEventListener('pointerup', stop)
    this.canvas.addEventListener('pointercancel', stop)

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      // Write straight to both yaw values: an eased drag feels like lag.
      this.yaw -= e.movementX * LOOK_SENSITIVITY
      this.targetYaw = this.yaw
      this.pitch = clamp(this.pitch + e.movementY * LOOK_SENSITIVITY, MIN_PITCH, MAX_PITCH)
    })

    // (touch camera orbit shares the same yaw/pitch: see touchLook below)
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.targetDistance = clamp(
          this.targetDistance * (1 + Math.sign(e.deltaY) * 0.12),
          MIN_DISTANCE,
          MAX_DISTANCE,
        )
      },
      { passive: false },
    )
  }

  /**
   * Match the renderer and camera to the window.
   *
   * The clamp is not defensive padding — it is the fix for a real and total
   * failure. A page that boots while its tab is in the background has no layout
   * yet, so `innerWidth` and `innerHeight` are both **0**; the aspect becomes
   * `0 / 0`, which is NaN, and NaN poisons the projection matrix permanently.
   * Every raycast through that camera then misses, so tapping a plot, a crop or
   * a building silently does nothing for the rest of the session — and the
   * resize event that would have corrected it does not necessarily arrive,
   * because on some paths the window never actually changes size.
   *
   * `lastW/lastH` let `render` notice a mismatch and self-heal; see below.
   */
  private resize() {
    const w = Math.max(1, innerWidth)
    const h = Math.max(1, innerHeight)
    this.lastW = w
    this.lastH = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.postfx?.resize?.()
  }

  /** Size the camera was last built for, so a drift can be spotted per frame. */
  private lastW = 0
  private lastH = 0

  /** Unit vector pointing "screen forward" along the ground plane. Used to make
   *  WASD movement camera-relative rather than world-relative. */
  screenForward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
  }

  screenRight(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
  }

  rotate(steps: number) {
    this.targetYaw += (Math.PI / 2) * steps
  }

  update(dt: number) {
    // Debounced persist: cheap enough to check every frame, writes at most
    // every couple of seconds and only when something changed.
    this.cameraSaveTimer -= dt
    if (this.cameraSaveTimer <= 0) {
      this.cameraSaveTimer = 2
      this.persistCamera()
    }

    const diff = this.targetYaw - this.yaw
    if (Math.abs(diff) > 1e-4) this.yaw += diff * Math.min(1, dt * 8)
    else this.yaw = this.targetYaw

    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 9)

    this.lookAt.set(this.focus.x, this.focus.y + FOCUS_HEIGHT, this.focus.z)

    const cosP = Math.cos(this.pitch)
    const dirX = Math.sin(this.yaw) * cosP
    const dirY = Math.sin(this.pitch)
    const dirZ = Math.cos(this.yaw) * cosP

    // Pull the camera in until it clears scenery, so backing into a tree
    // trunk or a canopy doesn't bury the view inside it.
    const dist = this.clearDistance(dirX, dirZ, this.distance)

    const x = this.lookAt.x + dirX * dist
    const y = this.lookAt.y + dirY * dist
    const z = this.lookAt.z + dirZ * dist

    // Never let the camera sink below the ground it is flying over.
    const minY = groundHeight(x, z) + 0.9
    this.camera.position.set(x, Math.max(y, minY), z)
    this.camera.lookAt(this.lookAt)
  }

  /** Obstacles the camera should not sit inside. Shared with the player. */
  setCameraObstacles(obstacles: { x: number; z: number; r: number }[]) {
    this.obstacles = obstacles
  }

  /** Camera orbit from the touch controls — same maths as right-mouse drag. */
  touchLook(dx: number, dy: number) {
    this.yaw -= dx
    this.targetYaw = this.yaw
    this.pitch = clamp(this.pitch + dy, MIN_PITCH, MAX_PITCH)
  }

  /**
   * Pinch zoom. `scale` is previousFingerDist / currentFingerDist — pinch out
   * (< 1) pulls the camera in, matching scroll-wheel zoom-in.
   */
  touchZoom(scale: number) {
    if (!Number.isFinite(scale) || scale <= 0) return
    this.targetDistance = clamp(this.targetDistance * scale, MIN_DISTANCE, MAX_DISTANCE)
  }

  /**
   * March out along the camera's boom and stop short of the first obstacle,
   * mirroring how the player's own collision works. A full raycast against
   * scenery would be more accurate, but the obstacle circles already
   * approximate every trunk and boulder in the world for free.
   */
  private clearDistance(dirX: number, dirZ: number, wanted: number) {
    if (!this.obstacles) return wanted

    let limit = wanted
    for (const o of this.obstacles) {
      const ox = o.x - this.lookAt.x
      const oz = o.z - this.lookAt.z
      // Project the obstacle onto the boom; ignore anything behind the focus
      // or further out than the boom reaches.
      const along = ox * dirX + oz * dirZ
      if (along <= 0.3 || along > wanted) continue

      const perpSq = ox * ox + oz * oz - along * along
      const radius = o.r + CAMERA_CLEARANCE
      if (perpSq >= radius * radius) continue

      // Stop just before entering the circle.
      const back = Math.sqrt(radius * radius - perpSq)
      limit = Math.min(limit, Math.max(MIN_DISTANCE, along - back))
    }
    return limit
  }

  /** Post-processing stack. Attached after construction to avoid a cycle. */
  postfx: { render(): void; resize?(): void } | null = null

  /** Distant mountain ranges and clouds. Attached by main so the day cycle can
   *  tint them without the engine having to know about the world. */
  skyline: { setTint(color: THREE.Color): void } | null = null

  /** Painted equirectangular dome. Day/weather tint via setTint multiply. */
  skybox: { setTint(color: THREE.Color): void } | null = null

  /** Lane lanterns, likewise driven by the day cycle. */
  lanterns: { setGlow(v: number): void } | null = null

  /**
   * Quantise a world point onto the shadow map's texel grid.
   *
   * The shadow camera follows the player, and an orthographic shadow map that
   * slides by fractions of a texel makes every shadow edge crawl and fizz — the
   * texel grid shifts under stationary geometry, so the same fence post is sampled
   * differently each frame. It is most obvious while running, because that is when
   * the camera moves fastest.
   *
   * Snapping is done in the light's own plane, not world XZ: the grid is aligned to
   * the shadow camera, which is tilted with the sun, so rounding world coordinates
   * would leave a diagonal component of the jitter untouched.
   *
   * `lightDir` points from the target toward the light and need not be normalised.
   */
  snapToShadowTexel(point: THREE.Vector3, lightDir: THREE.Vector3) {
    const cam = this.sun.shadow.camera
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x
    if (!(texel > 0)) return
    this.snapRight.set(0, 1, 0).cross(lightDir)
    // Degenerate only if the light is exactly overhead, where any horizontal axis
    // will do.
    if (this.snapRight.lengthSq() < 1e-8) this.snapRight.set(1, 0, 0)
    this.snapRight.normalize()
    this.snapUp.copy(lightDir).normalize().cross(this.snapRight).normalize()
    const a = point.dot(this.snapRight)
    const b = point.dot(this.snapUp)
    point.addScaledVector(this.snapRight, Math.round(a / texel) * texel - a)
    point.addScaledVector(this.snapUp, Math.round(b / texel) * texel - b)
  }

  render() {
    /*
     * Catch a size the resize event missed.
     *
     * Cheaper than it looks — two integer compares — and it is the only thing
     * that recovers a camera built at 0x0 in a background tab, where the window
     * gains its real size without ever firing `resize`. Doing it here rather
     * than in `update` means it also covers callers that render without ticking.
     */
    if (innerWidth !== this.lastW || innerHeight !== this.lastH) this.resize()

    this.shadowClock++
    /*
     * Refresh the shadow map every frame while the view is moving, and every third
     * frame when it is not.
     *
     * A flat one-in-three was a compromise that broke exactly when it mattered: at
     * a run the player outpaces their own shadow by a couple of frames, so it drags
     * along behind their feet. Idle scenes get the saving instead, where nothing is
     * moving and nobody can tell.
     */
    const moving = this.focus.distanceToSquared(this.lastShadowFocus) > 1e-4
    this.renderer.shadowMap.needsUpdate = moving || this.shadowClock % 3 === 0
    if (this.renderer.shadowMap.needsUpdate) this.lastShadowFocus.copy(this.focus)

    if (this.postfx) this.postfx.render()
    else this.renderer.render(this.scene, this.camera)
  }

  /** Seconds since the previous frame, clamped so an alt-tab doesn't teleport
   *  the player or fast-forward every crop. */
  tick() {
    return Math.min(this.clock.getDelta(), 0.1)
  }

  get element() {
    return this.canvas
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}
