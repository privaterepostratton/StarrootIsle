import * as THREE from 'three'
import { MINOR_LAYER } from '../assets/style'
import { getModels } from '../assets/models'

/**
 * Doobers — the little collectibles that burst out of a harvest, bounce on the
 * ground, then fly to the player.
 *
 * This is the single highest-value piece of game feel in the whole project.
 * A harvest that silently increments a counter feels like a spreadsheet; the
 * same harvest that throws a fistful of coins across the soil, lets them
 * settle, then sucks them into your pocket with a rising chime feels like a
 * reward. Nothing about the economy changes — only the delivery.
 *
 * Three phases, each doing a specific job:
 *   SCATTER  ballistic arc with a bounce. Gives the payout physical presence
 *            and spreads it across space so quantity is legible at a glance.
 *   SETTLE   a beat of stillness. Without it the magnet phase starts before
 *            the eye has registered anything landed.
 *   MAGNET   accelerating homing. Ends fast so a big harvest does not keep
 *            the player waiting.
 */

const MAX_DOOBERS = 260

export type DooberKind = 'coin' | 'xp' | 'honey' | 'produce'

interface DooberStyle {
  color: number
  /** Radius in world units. */
  size: number
  /** Emissive boost so coins catch the bloom pass. */
  glow: boolean
}

const STYLES: Record<DooberKind, DooberStyle> = {
  coin: { color: 0xf2c14e, size: 0.11, glow: true },
  xp: { color: 0x7ae0ff, size: 0.085, glow: true },
  honey: { color: 0xe8a020, size: 0.1, glow: false },
  produce: { color: 0x8fd85c, size: 0.1, glow: false },
}

type Phase = 'scatter' | 'settle' | 'magnet' | 'dead'

interface Doober {
  kind: DooberKind
  phase: Phase
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Ground height it bounces on. */
  groundY: number
  spin: number
  spinSpeed: number
  /** Seconds left in the current phase. */
  timer: number
  /** Scales up on spawn so doobers pop rather than blink into being. */
  age: number
  size: number
  bounced: boolean
  /** Payload delivered on pickup. */
  value: number
  /** Throttles trail sparks during the magnet flight. */
  trailTimer: number
}

const dummy = new THREE.Object3D()
const tmpColor = new THREE.Color()
const trailPos = new THREE.Vector3()

const GRAVITY = 16
const MAGNET_SPEED = 15
const SETTLE_TIME = 0.28

export interface DooberCollect {
  kind: DooberKind
  value: number
}

/**
 * The coin model is a disc a unit across in the XY plane, so its own radius is
 * a half; doober sizes are radii, and without this a coin comes out half the
 * size of every other kind.
 */
const COIN_SCALE = 2
/**
 * A permanent tip toward the camera.
 *
 * Spun about Y alone, a disc is edge-on twice per turn and all but vanishes —
 * fine for a coin sitting in a row waiting to be run through, and bad for one
 * of forty tumbling across a field, where the eye reads the gap as a flicker.
 * Tipped, it presents some face at every angle.
 */
const COIN_LEAN = 0.3

export class Doobers {
  /** Faceted gems: xp, honey and produce. */
  readonly mesh: THREE.InstancedMesh
  /** The authored coin, on its own instanced mesh because it has its own
   *  geometry and its own textured material. */
  readonly coinMesh: THREE.InstancedMesh
  private readonly pool: Doober[] = []
  private cursor = 0

  /** Called once per doober as it reaches the player. */
  onCollect: ((c: DooberCollect) => void) | null = null

  /** Called a few times a second per orb in flight, for a trail effect. */
  onTrail: ((at: THREE.Vector3, kind: DooberKind) => void) | null = null

  constructor() {
    // An octahedron reads as a faceted gem at this size and costs 8 triangles.
    // A sphere would need 10x the geometry to look any better at 0.1 units.
    const geo = new THREE.OctahedronGeometry(1, 0)
    /*
     * A white vertex colour, without which every orb renders black.
     *
     * instanceColor only reaches the fragment colour through three's USE_COLOR
     * path, which `vertexColors: true` enables — but the same define also
     * multiplies in a `color` *attribute*, and a disabled attribute reads as
     * black in WebGL. OctahedronGeometry ships no colour attribute, so until now
     * every coin and XP orb in the game was drawn as a black gem.
     */
    const white = new Float32Array(geo.attributes.position.count * 3).fill(1)
    geo.setAttribute('color', new THREE.BufferAttribute(white, 3))

    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.98 }),
      MAX_DOOBERS,
    )
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOOBERS * 3), 3)
    this.mesh.frustumCulled = false
    this.mesh.layers.set(MINOR_LAYER)
    this.mesh.castShadow = false

    /*
     * Coins get the authored model and its own material — no instance tint.
     *
     * They cannot share the gem mesh: that one is a single octahedron coloured
     * per instance, which is exactly the right trick for four kinds that differ
     * only in colour, and no help at all for one that differs in shape and
     * carries a texture. Two instanced meshes is still two draw calls for the
     * whole shower.
     */
    const model = getModels().coin
    const coinMat = (model.material as THREE.MeshStandardMaterial).clone()
    // Enough emissive to clear the bloom threshold at dusk without the coin
    // looking like its own light source.
    coinMat.emissive = new THREE.Color(0x6a4a10)
    coinMat.emissiveIntensity = 1
    this.coinMesh = new THREE.InstancedMesh(model.geometry, coinMat, MAX_DOOBERS)
    this.coinMesh.frustumCulled = false
    this.coinMesh.layers.set(MINOR_LAYER)
    this.coinMesh.castShadow = false

    for (let i = 0; i < MAX_DOOBERS; i++) {
      this.pool.push({
        kind: 'coin', phase: 'dead',
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, groundY: 0,
        spin: 0, spinSpeed: 0, timer: 0, age: 0, size: 0.1, bounced: false, value: 0, trailTimer: 0,
      })
    }
    this.hideAll()
  }

  private hideAll() {
    for (let i = 0; i < MAX_DOOBERS; i++) {
      this.park(this.mesh, i)
      this.park(this.coinMesh, i)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.coinMesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Send one instance somewhere it cannot be seen.
   *
   * Every pool slot has a matrix in *both* meshes — whichever one is not drawing
   * that doober this frame has to be parked, or the last thing it drew stays
   * frozen in the field. Keeping the indices aligned across the two meshes is
   * what makes that a one-line answer instead of two cursors to keep in step.
   */
  private park(mesh: THREE.InstancedMesh, i: number) {
    dummy.position.set(0, -9999, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.setScalar(0.0001)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  /**
   * Throw a handful of doobers from a world position.
   *
   * `total` is split across `count` orbs, with the remainder going to the last
   * one — so the sum delivered always equals the sum promised, however the
   * division rounds.
   */
  spawn(at: THREE.Vector3, kind: DooberKind, count: number, total: number) {
    const n = Math.max(1, Math.min(count, 40))
    const per = Math.floor(total / n)
    const style = STYLES[kind]

    for (let i = 0; i < n; i++) {
      const d = this.pool[this.cursor]
      this.cursor = (this.cursor + 1) % MAX_DOOBERS

      const angle = Math.random() * Math.PI * 2
      const speed = 1.6 + Math.random() * 2.4

      d.kind = kind
      d.phase = 'scatter'
      d.x = at.x
      d.y = at.y + 0.35
      d.z = at.z
      d.vx = Math.cos(angle) * speed
      d.vy = 3.2 + Math.random() * 2.6
      d.vz = Math.sin(angle) * speed
      d.groundY = at.y
      d.spin = Math.random() * Math.PI * 2
      d.spinSpeed = (Math.random() - 0.5) * 9
      d.timer = 0
      d.age = 0
      d.size = style.size * (0.85 + Math.random() * 0.3)
      d.bounced = false
      // Last orb carries the remainder so nothing is lost to rounding.
      d.value = i === n - 1 ? total - per * (n - 1) : per
    }
  }

  update(dt: number, playerPos: THREE.Vector3) {
    let live = false

    for (let i = 0; i < MAX_DOOBERS; i++) {
      const d = this.pool[i]
      if (d.phase === 'dead') continue
      live = true
      d.age += dt
      d.spin += d.spinSpeed * dt

      if (d.phase === 'scatter') {
        d.vy -= GRAVITY * dt
        d.x += d.vx * dt
        d.y += d.vy * dt
        d.z += d.vz * dt

        if (d.y <= d.groundY + d.size) {
          d.y = d.groundY + d.size
          if (!d.bounced) {
            // One damped bounce. A second is imperceptible and just delays
            // the payoff.
            d.bounced = true
            d.vy = Math.abs(d.vy) * 0.42
            d.vx *= 0.5
            d.vz *= 0.5
            d.spinSpeed *= 0.5
          } else {
            d.phase = 'settle'
            d.timer = SETTLE_TIME
            d.vx = d.vy = d.vz = 0
          }
        }
      } else if (d.phase === 'settle') {
        d.timer -= dt
        // Bob gently while waiting so they read as alive, not as debris.
        d.y = d.groundY + d.size + Math.sin(d.age * 7) * 0.02
        if (d.timer <= 0) d.phase = 'magnet'
      } else {
        /*
         * Trail sparks, throttled per orb. Firing one every frame would put
         * sixty a second behind each of forty orbs; a few a second is all it
         * takes to read as speed.
         */
        d.trailTimer -= dt
        if (this.onTrail && d.trailTimer <= 0) {
          d.trailTimer = 0.075
          trailPos.set(d.x, d.y, d.z)
          this.onTrail(trailPos, d.kind)
        }

        // Magnet: aim slightly above the feet so orbs converge on the body.
        const tx = playerPos.x
        const ty = playerPos.y + 0.7
        const tz = playerPos.z
        const dx = tx - d.x
        const dy = ty - d.y
        const dz = tz - d.z
        const dist = Math.hypot(dx, dy, dz)

        if (dist < 0.4) {
          d.phase = 'dead'
          this.onCollect?.({ kind: d.kind, value: d.value })
          this.park(this.mesh, i)
          this.park(this.coinMesh, i)
          continue
        }

        // Accelerate as it closes — a constant speed looks robotic, and the
        // acceleration is what makes the pickup feel like a snap.
        d.timer += dt
        const speed = MAGNET_SPEED * Math.min(2.2, 0.45 + d.timer * 2.4)
        d.x += (dx / dist) * speed * dt
        d.y += (dy / dist) * speed * dt
        d.z += (dz / dist) * speed * dt
      }

      // Pop-in scale over the first 120ms.
      const pop = Math.min(1, d.age / 0.12)
      const scale = d.size * (0.3 + pop * 0.7) * (1 + Math.sin(d.age * 9) * 0.06)

      dummy.position.set(d.x, d.y, d.z)

      if (d.kind === 'coin') {
        // A flat spin about its own axis, the way a coin spins. The gems' tumble
        // on three axes suits a shard and makes a disc look like it is being
        // buffeted.
        dummy.rotation.set(COIN_LEAN, d.spin, 0)
        dummy.scale.setScalar(scale * COIN_SCALE)
        dummy.updateMatrix()
        this.coinMesh.setMatrixAt(i, dummy.matrix)
        this.park(this.mesh, i)
        continue
      }

      dummy.rotation.set(d.spin * 0.6, d.spin, d.spin * 0.35)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)
      this.park(this.coinMesh, i)

      const style = STYLES[d.kind]
      tmpColor.setHex(style.color)
      // Glowing kinds are pushed past 1.0 so the bloom threshold catches them.
      if (style.glow) tmpColor.multiplyScalar(1.5)
      this.mesh.setColorAt(i, tmpColor)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.coinMesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.visible = live
    this.coinMesh.visible = live
  }

  /** Number currently in flight, for debugging and tests. */
  get activeCount() {
    return this.pool.reduce((n, d) => n + (d.phase === 'dead' ? 0 : 1), 0)
  }

  /** Deliver everything immediately — used when the farm is retired. */
  flush(playerPos: THREE.Vector3) {
    for (const d of this.pool) {
      if (d.phase === 'dead') continue
      d.phase = 'dead'
      this.onCollect?.({ kind: d.kind, value: d.value })
    }
    void playerPos
    this.hideAll()
  }
}
