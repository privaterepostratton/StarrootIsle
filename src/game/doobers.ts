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
  /*
   * Ice-cyan, and deliberately the one cold colour in the game.
   *
   * It used to be a warm green-gold, which put it inside the range every crop,
   * leaf and coin already occupies — an XP orb crossing a green field was a
   * light green dot on green. Cold reads instantly against grass, soil and
   * gold, and nothing else in the valley is allowed this hue.
   */
  xp: { color: 0x9ff6ee, size: 0.085, glow: true },
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

/**
 * The wisp's texture: a shard of light with a star burning through it.
 *
 * It used to be a radial gradient, which is the honest way to draw a firefly
 * and reads at any size as a blurred dot — there is no *thing* there, so the
 * eye files it with the bloom and the god rays rather than with the pickups.
 * Three layers fix that, drawn in the order the eye assembles them:
 *
 *   the halo, wide and faint, so the shard sits in its own light;
 *   the shard, an angular crystal with a facet down one side, which is the
 *     silhouette that makes it an object;
 *   the star, four thin spikes through the middle, which is what says *this is
 *     glowing* rather than *this is a pale blue rock*.
 *
 * Additively blended in the material, so every layer only ever brightens what
 * is under it and the shard keeps its glassy edge instead of matting out.
 */
function makeWispTexture() {
  const size = 128
  const c = size / 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // 1. The halo.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c)
  halo.addColorStop(0, 'rgba(190, 255, 248, 0.55)')
  halo.addColorStop(0.34, 'rgba(120, 240, 226, 0.26)')
  halo.addColorStop(0.72, 'rgba(70, 200, 200, 0.07)')
  halo.addColorStop(1, 'rgba(60, 190, 200, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  /*
   * 2. The shard. Seven points rather than a symmetrical gem: a crystal that
   * can be folded onto itself reads as a UI icon, and the whole job of this
   * silhouette is to look grown rather than drawn.
   */
  const r = size * 0.27
  const shard: [number, number][] = [
    [0, -1.12],
    [0.72, -0.52],
    [0.9, 0.36],
    [0.24, 1.1],
    [-0.5, 0.92],
    [-0.94, 0.1],
    [-0.66, -0.7],
  ]
  const trace = (scale: number) => {
    ctx.beginPath()
    shard.forEach(([x, y], i) => {
      const px = c + x * r * scale
      const py = c + y * r * scale
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.closePath()
  }

  const body = ctx.createLinearGradient(c - r, c - r, c + r, c + r)
  body.addColorStop(0, 'rgba(226, 255, 252, 0.95)')
  body.addColorStop(0.45, 'rgba(140, 244, 232, 0.8)')
  body.addColorStop(1, 'rgba(72, 206, 208, 0.62)')
  ctx.fillStyle = body
  trace(1)
  ctx.fill()

  // The facet: the same shape shrunk and pushed off-centre, so one side of the
  // crystal catches more light than the other.
  ctx.save()
  ctx.translate(-r * 0.16, -r * 0.2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  trace(0.5)
  ctx.fill()
  ctx.restore()

  // 3. The star. Four spikes, the vertical pair longer, as light behaves.
  const spike = (halfW: number, halfH: number, alpha: number) => {
    const g = ctx.createLinearGradient(c, c - halfH, c, c + halfH)
    g.addColorStop(0, `rgba(214, 255, 250, 0)`)
    g.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`)
    g.addColorStop(1, `rgba(214, 255, 250, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(c, c - halfH)
    ctx.lineTo(c + halfW, c)
    ctx.lineTo(c, c + halfH)
    ctx.lineTo(c - halfW, c)
    ctx.closePath()
    ctx.fill()
  }
  spike(size * 0.055, size * 0.48, 0.95)
  ctx.save()
  ctx.translate(c, c)
  ctx.rotate(Math.PI / 2)
  ctx.translate(-c, -c)
  spike(size * 0.045, size * 0.4, 0.8)
  ctx.restore()

  // The hot centre the spikes cross at.
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.1)
  core.addColorStop(0, 'rgba(255, 255, 255, 1)')
  core.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(c, c, size * 0.1, 0, Math.PI * 2)
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Doobers {
  /** Faceted gems: xp, honey and produce. */
  readonly mesh: THREE.InstancedMesh
  /** The authored coin, on its own instanced mesh because it has its own
   *  geometry and its own textured material. */
  readonly coinMesh: THREE.InstancedMesh
  /**
   * XP, as a firefly wisp rather than a gem.
   *
   * A faceted octahedron is a *thing* — it has edges, it catches the light, it
   * reads as treasure. Experience is not treasure; it is the glow the crop gave
   * off when you pulled it. Its own mesh because it wants the opposite of the
   * gems' material in every respect: a soft billboarded blob, additive, no
   * depth write, flickering.
   */
  readonly wispMesh: THREE.InstancedMesh
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

    /*
     * The wisp: one soft radial blob, always facing the camera.
     *
     * Camera-facing is done in the vertex shader from the view matrix's own
     * basis — the same trick the particle bursts use — because an InstancedMesh
     * cannot be billboarded from the CPU without rewriting every matrix each
     * frame, and there can be a hundred of these in the air.
     */
    const wispTex = makeWispTexture()
    const wispGeo = new THREE.PlaneGeometry(1, 1)
    const wispMat = new THREE.MeshBasicMaterial({
      map: wispTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexColors: true,
    })
    const whiteQuad = new Float32Array(wispGeo.attributes.position.count * 3).fill(1)
    wispGeo.setAttribute('color', new THREE.BufferAttribute(whiteQuad, 3))
    wispMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec3 iOrigin = vec3(instanceMatrix[3]);
        float iScale = length(instanceMatrix[0].xyz);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 billboarded = iOrigin + (camRight * transformed.x + camUp * transformed.y) * iScale;
        vec4 mvPosition = viewMatrix * vec4(billboarded, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        `,
      )
    }
    this.wispMesh = new THREE.InstancedMesh(wispGeo, wispMat, MAX_DOOBERS)
    this.wispMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOOBERS * 3), 3)
    this.wispMesh.frustumCulled = false
    this.wispMesh.layers.set(MINOR_LAYER)
    this.wispMesh.castShadow = false

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
    for (let i = 0; i < MAX_DOOBERS; i++) this.parkAll(i)
    this.mesh.instanceMatrix.needsUpdate = true
    this.coinMesh.instanceMatrix.needsUpdate = true
    this.wispMesh.instanceMatrix.needsUpdate = true
  }

  /** Take one pool slot out of all three meshes. What death means, in pixels. */
  private parkAll(i: number) {
    this.park(this.mesh, i)
    this.park(this.coinMesh, i)
    this.park(this.wispMesh, i)
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
          /*
           * All three meshes, not two.
           *
           * A dead slot is skipped by every later frame, so whatever matrix it
           * last wrote is the matrix it keeps. This parked the gems and the
           * coins and forgot the wisps, which meant every XP orb ever collected
           * left a frozen quad hanging at chest height where it was picked up.
           * It read as "the wisps work for a while and then start to fail":
           * the debris is only drawn while something else is in flight, because
           * `live` hides the mesh when the field empties, so the field slowly
           * filled with stuck glows that blinked on with the next harvest.
           */
          this.parkAll(i)
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
        // And the wisp, which this slot may have been a moment ago: the pool is
        // a ring, so a slot changes kind, and the mesh it *used* to draw in
        // keeps the last matrix it was given until something clears it. The gem
        // and wisp branches below each park the other two; this one parked one.
        this.park(this.wispMesh, i)
        continue
      }

      const style = STYLES[d.kind]

      if (d.kind === 'xp') {
        /*
         * A firefly does not tumble, it *breathes*. Two sine terms at unrelated
         * rates so the flicker never settles into a visible loop, and the quad
         * is drawn several times the gem's size because most of a wisp is the
         * faint halo — the bright part is tiny.
         */
        const flicker = 0.72 + Math.sin(d.age * 11 + d.spin) * 0.18 + Math.sin(d.age * 3.3) * 0.1
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(scale * 4.6 * flicker)
        dummy.updateMatrix()
        this.wispMesh.setMatrixAt(i, dummy.matrix)
        this.park(this.mesh, i)
        this.park(this.coinMesh, i)
        tmpColor.setHex(style.color).multiplyScalar(1.35 * flicker)
        this.wispMesh.setColorAt(i, tmpColor)
        continue
      }

      dummy.rotation.set(d.spin * 0.6, d.spin, d.spin * 0.35)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)
      this.park(this.coinMesh, i)
      this.park(this.wispMesh, i)

      tmpColor.setHex(style.color)
      // Glowing kinds are pushed past 1.0 so the bloom threshold catches them.
      if (style.glow) tmpColor.multiplyScalar(1.5)
      this.mesh.setColorAt(i, tmpColor)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.coinMesh.instanceMatrix.needsUpdate = true
    this.wispMesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    if (this.wispMesh.instanceColor) this.wispMesh.instanceColor.needsUpdate = true
    this.mesh.visible = live
    this.coinMesh.visible = live
    this.wispMesh.visible = live
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
