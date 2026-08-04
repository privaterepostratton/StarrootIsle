import * as THREE from 'three'
import { MINOR_LAYER } from './style'

/**
 * One-shot particle bursts for harvests, purchases, watering and level-ups.
 *
 * Four *kinds*, not one. A single tumbling shard standing in for soil, coins,
 * smoke and water made every event in the game feel like the same event — the
 * shape and the motion are most of what tells the player what just happened.
 * Each kind gets its own geometry, blend mode and physics:
 *
 *   shard  sharp, heavy, tumbles in 3D and falls          — debris, produce
 *   puff   soft, round, rises and swells as it thins      — dust, smoke
 *   petal  flat, light, flutters side to side as it sinks — leaves, blossom
 *   spark  tiny, additive, fast and bright                — magic, level-ups
 *
 * Every kind is one pooled InstancedMesh, so a fifty-plot harvest costs four
 * draw calls no matter how much is in flight. Particles genuinely fade rather
 * than only shrinking: alpha rides a custom instanced attribute, since a shared
 * material has no per-instance opacity of its own.
 */

export type ParticleKind = 'shard' | 'puff' | 'petal' | 'spark'

interface KindConfig {
  /** Pool size. Sized to what the busiest moment for this kind actually needs. */
  budget: number
  /** Units/s². Negative rises — smoke is lighter than air. */
  gravity: number
  /** Velocity lost per second, as a fraction. High drag = stops dead and hangs. */
  drag: number
  /** Multiplier on each particle's random tumble rate. 0 = no spin. */
  spin: number
  /** Lateral oscillation amplitude — what makes a petal flutter, not drop. */
  flutter: number
  /** Size at death, relative to birth. <1 shrinks, >1 swells. */
  growth: number
  /** How strongly birth velocity is biased upward (1 = straight up). */
  upBias: number
  /** Camera-facing quad, or a 3D shape that tumbles? */
  billboard: boolean
  additive: boolean
  /** Fraction of life spent fading in. Smoke needs it; debris does not. */
  fadeIn: number
  /**
   * Ceiling on alpha. Dust and smoke are *thin* — at full opacity a puff reads
   * as a solid ball of paint rather than as something you could see through.
   */
  peakAlpha: number
  defaultSpeed: number
  defaultLife: number
  defaultScale: number
}

const KINDS: Record<ParticleKind, KindConfig> = {
  shard: {
    budget: 300,
    gravity: 9.4,
    drag: 2.4,
    spin: 1,
    flutter: 0,
    growth: 0.2,
    upBias: 0.55,
    billboard: false,
    additive: false,
    fadeIn: 0,
    peakAlpha: 1,
    defaultSpeed: 3.2,
    defaultLife: 0.85,
    defaultScale: 0.14,
  },
  puff: {
    // Rises slowly: dust and smoke are the one thing here that is buoyant.
    budget: 220,
    gravity: -0.5,
    drag: 3.6,
    spin: 0.25,
    flutter: 0.12,
    growth: 2.6,
    upBias: 0.45,
    billboard: true,
    additive: false,
    fadeIn: 0.12,
    peakAlpha: 0.5,
    defaultSpeed: 1.1,
    defaultLife: 0.95,
    defaultScale: 0.16,
  },
  petal: {
    // Barely falls, and the low drag lets the flutter dominate the motion.
    budget: 180,
    gravity: 2.1,
    drag: 1.1,
    spin: 0.8,
    flutter: 0.55,
    growth: 1,
    upBias: 0.5,
    billboard: false,
    additive: false,
    fadeIn: 0.05,
    peakAlpha: 1,
    defaultSpeed: 2.4,
    defaultLife: 1.6,
    defaultScale: 0.13,
  },
  spark: {
    budget: 220,
    gravity: 3,
    drag: 1.4,
    spin: 0,
    flutter: 0,
    growth: 0.25,
    upBias: 0.6,
    billboard: true,
    additive: true,
    fadeIn: 0,
    peakAlpha: 0.95,
    defaultSpeed: 4,
    defaultLife: 0.6,
    defaultScale: 0.1,
  },
}

export interface EmitOptions {
  kind?: ParticleKind
  speed?: number
  life?: number
  scale?: number
  /** Random spread on the birth position, in units. */
  jitter?: number
}

interface Particle {
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spin: number
  spinSpeed: number
  /** Per-particle phase, so a burst's flutter never moves in lockstep. */
  phase: number
  age: number
  life: number
  scale: number
  r: number
  g: number
  b: number
}

const dummy = new THREE.Object3D()
const colorTmp = new THREE.Color()

/** Sharp four-pointed diamond: reads as a chip of something solid. */
function shardGeometry() {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0.5, 0, 0.3, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, -0.5, 0, -0.3, 0, 0],
      3,
    ),
  )
  geo.computeVertexNormals()
  return geo
}

/** Rounded leaf: wide in the middle, tapered at both ends. */
function petalGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.5)
  shape.bezierCurveTo(0.34, 0.22, 0.34, -0.22, 0, -0.5)
  shape.bezierCurveTo(-0.34, -0.22, -0.34, 0.22, 0, 0.5)
  return new THREE.ShapeGeometry(shape, 6)
}

/**
 * Soft radial falloff for the billboarded kinds.
 *
 * A hard-edged quad reads as a quad however small it is. The gradient is what
 * turns one into a puff of dust or a mote of light.
 */
function softTexture(core: number) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(core, 'rgba(255,255,255,0.72)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * One kind's pool: geometry, material and a flat particle array.
 *
 * The alpha attribute is the reason this is not just a bare InstancedMesh.
 * Three's instancing gives per-instance colour but no per-instance opacity, so
 * a fading particle normally has to be faked by shrinking it — which reads as
 * flying away, not dissolving. One extra float per instance plus two lines of
 * patched shader fixes that for every kind at once.
 */
class Layer {
  readonly mesh: THREE.InstancedMesh
  private readonly particles: Particle[] = []
  private readonly alpha: THREE.InstancedBufferAttribute
  private cursor = 0

  constructor(
    readonly config: KindConfig,
    geometry: THREE.BufferGeometry,
    map: THREE.Texture | null,
  ) {
    const material = new THREE.MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      // Additive particles are light, not matter: they should not be dimmed by
      // distance fog the way a falling chip of soil should.
      fog: !config.additive,
    })

    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(config.budget), 1)
    const billboard = config.billboard

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;')

      if (billboard) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          /* glsl */ `
          // Full camera-facing billboard, built from the view matrix's own basis
          // rather than from the instance's rotation — which is why the instance
          // matrix only ever carries position and scale for these kinds.
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

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;',
        )
    }

    /*
     * A white vertex colour, which looks redundant and is not.
     *
     * instanceColor only reaches the fragment colour through three's USE_COLOR
     * path, and USE_COLOR is what `vertexColors: true` switches on — but the
     * same define also multiplies in a `color` *attribute*. Without one, WebGL
     * supplies the default generic value for a disabled attribute, which is
     * black, and every particle multiplies out to nothing. (The splash rings hit
     * this too; see splash.ts.)
     */
    if (!geometry.getAttribute('color')) {
      const white = new Float32Array(geometry.attributes.position.count * 3).fill(1)
      geometry.setAttribute('color', new THREE.BufferAttribute(white, 3))
    }

    this.mesh = new THREE.InstancedMesh(geometry, material, config.budget)
    this.mesh.geometry.setAttribute('aAlpha', this.alpha)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(config.budget * 3),
      3,
    )
    // Positions are rewritten every frame in world space, so a cached bounding
    // sphere is stale immediately and culling against it would be wrong.
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.layers.set(MINOR_LAYER)
    this.mesh.visible = false

    dummy.position.set(0, -9999, 0)
    dummy.scale.setScalar(0.001)
    dummy.updateMatrix()
    for (let i = 0; i < config.budget; i++) {
      this.particles.push({
        active: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        spin: 0, spinSpeed: 0, phase: 0,
        age: 0, life: 1, scale: 1, r: 1, g: 1, b: 1,
      })
      this.mesh.setMatrixAt(i, dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** Claim the next slot, stealing from the oldest when the pool is full. */
  spawn(at: THREE.Vector3, color: number, opts: EmitOptions) {
    const c = this.config
    const p = this.particles[this.cursor]
    this.cursor = (this.cursor + 1) % c.budget

    const speed = (opts.speed ?? c.defaultSpeed) * (0.55 + Math.random() * 0.75)
    const theta = Math.random() * Math.PI * 2
    // Upward-biased hemisphere: particles should arc up and out, never straight
    // down into the ground they were born on.
    const up = 1 - c.upBias + Math.random() * c.upBias
    const flat = Math.sqrt(Math.max(0, 1 - up * up))
    const jitter = opts.jitter ?? 0

    p.active = true
    p.x = at.x + (Math.random() - 0.5) * jitter
    p.y = at.y + 0.15 + (Math.random() - 0.5) * jitter
    p.z = at.z + (Math.random() - 0.5) * jitter
    p.vx = Math.cos(theta) * flat * speed
    p.vy = up * speed
    p.vz = Math.sin(theta) * flat * speed
    p.spin = Math.random() * Math.PI * 2
    p.spinSpeed = (Math.random() - 0.5) * 14 * c.spin
    p.phase = Math.random() * Math.PI * 2
    p.age = 0
    p.life = (opts.life ?? c.defaultLife) * (0.75 + Math.random() * 0.5)
    p.scale = (opts.scale ?? c.defaultScale) * (0.7 + Math.random() * 0.6)

    colorTmp.setHex(color)
    p.r = colorTmp.r
    p.g = colorTmp.g
    p.b = colorTmp.b
  }

  update(dt: number, elapsed: number) {
    const c = this.config
    let anyActive = false

    for (let i = 0; i < c.budget; i++) {
      const p = this.particles[i]
      if (!p.active) continue

      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        this.alpha.setX(i, 0)
        dummy.position.set(0, -9999, 0)
        dummy.scale.setScalar(0.001)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        this.mesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      anyActive = true
      const t = p.age / p.life

      p.vy -= c.gravity * dt
      // Clamped so a large dt cannot flip the velocity's sign.
      const decay = 1 - Math.min(0.95, dt * c.drag)
      p.vx *= decay
      p.vz *= decay
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt

      if (c.flutter > 0) {
        // Two out-of-phase drifts. The point is only that they *reverse*, which
        // is what the eye reads as "light enough to be pushed by the air".
        p.x += Math.sin(elapsed * 5.5 + p.phase) * c.flutter * dt
        p.z += Math.cos(elapsed * 4.7 + p.phase) * c.flutter * dt
      }

      p.spin += p.spinSpeed * dt

      dummy.position.set(p.x, p.y, p.z)
      // The billboard shader discards rotation, so keep those matrices clean.
      if (c.billboard) dummy.rotation.set(0, 0, 0)
      else dummy.rotation.set(p.spin * 0.6, p.spin, p.spin * 0.4)
      dummy.scale.setScalar(p.scale * (1 + (c.growth - 1) * t))
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)

      // Fade in over the opening slice, then out on a curve that holds the
      // particle visible for most of its life and drops it quickly at the end.
      const fadeIn = c.fadeIn > 0 ? Math.min(1, t / c.fadeIn) : 1
      const fadeOut = (1 - t) * (1 - t) * 1.6
      this.alpha.setX(i, Math.min(1, fadeIn) * Math.min(1, fadeOut) * c.peakAlpha)

      colorTmp.setRGB(p.r, p.g, p.b)
      this.mesh.setColorAt(i, colorTmp)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.alpha.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.visible = anyActive
  }
}

export class Bursts {
  readonly group = new THREE.Group()
  private readonly layers: Record<ParticleKind, Layer>

  constructor() {
    const soft = softTexture(0.42)
    // Sparks get a tighter core so they read as points of light rather than as
    // small clouds.
    const tight = softTexture(0.2)

    this.layers = {
      shard: new Layer(KINDS.shard, shardGeometry(), null),
      puff: new Layer(KINDS.puff, new THREE.PlaneGeometry(1, 1), soft),
      petal: new Layer(KINDS.petal, petalGeometry(), null),
      spark: new Layer(KINDS.spark, new THREE.PlaneGeometry(1, 1), tight),
    }

    for (const layer of Object.values(this.layers)) this.group.add(layer.mesh)
  }

  /**
   * Fire a burst. Colours are dealt round-robin rather than sampled at random,
   * so a two-colour burst always comes out mixed instead of occasionally
   * landing all one shade.
   */
  emit(at: THREE.Vector3, count: number, colors: number[], opts: EmitOptions = {}) {
    const layer = this.layers[opts.kind ?? 'shard']
    for (let i = 0; i < count; i++) {
      layer.spawn(at, colors[i % colors.length], opts)
    }
  }

  update(dt: number, elapsed: number) {
    for (const layer of Object.values(this.layers)) layer.update(dt, elapsed)
  }
}
