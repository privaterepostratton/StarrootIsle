import * as THREE from 'three'
import { MINOR_LAYER } from '../assets/style'
import { getParticleTextures } from '../assets/textures'
import type { Engine } from '../core/engine'
import type { Weather } from './weather'

/**
 * Ambient particles: drifting leaves, floating pollen, and fireflies at night.
 *
 * All three share one InstancedMesh per kind and are simulated on the CPU in a
 * flat array — a few hundred quads is nothing to draw, and doing it on the CPU
 * means the spawn volume can follow the camera without any GPU-side bookkeeping.
 *
 * Everything recycles inside a box centred on the camera focus, so the player
 * always walks through the effect and never past the edge of it.
 */

const LEAF_COUNT = 120
const POLLEN_COUNT = 220
const FIREFLY_COUNT = 110
/** Individual birds; they fly in loose flocks of 3-5. */
const BIRD_COUNT = 14

/** Half-extent of the box particles live in, centred on the camera focus. */
const FIELD = 26
const FIELD_HEIGHT = 14

const LEAF_COLORS = [0xd88a3a, 0xc4692f, 0xe0a83c, 0x8a9c3a, 0xc44a2f]

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spin: number
  spinSpeed: number
  /** Per-particle offset so a swarm never pulses in unison. */
  phase: number
  scale: number
}

const dummy = new THREE.Object3D()

interface Bird {
  /** Ellipse centre and radii — each bird owns a ring over the valley. */
  cx: number
  cz: number
  rx: number
  rz: number
  angle: number
  speed: number
  alt: number
  flapRate: number
  phase: number
  size: number
}

/**
 * Loose flocks: birds are dealt into groups of 3-5 sharing a centre, radius and
 * speed, each offset a little along the ring. Truly independent orbits read as
 * random dots; the shared parameters are what make them read as a flock.
 */
function makeBirds(): Bird[] {
  const birds: Bird[] = []
  while (birds.length < BIRD_COUNT) {
    const flock = Math.min(3 + Math.floor(Math.random() * 3), BIRD_COUNT - birds.length)
    const cx = (Math.random() - 0.5) * 60
    const cz = (Math.random() - 0.5) * 60
    const rx = 26 + Math.random() * 30
    const rz = 20 + Math.random() * 26
    const speed = (0.05 + Math.random() * 0.05) * (Math.random() < 0.5 ? 1 : -1)
    const alt = 17 + Math.random() * 9
    const angle = Math.random() * Math.PI * 2
    for (let i = 0; i < flock; i++) {
      birds.push({
        cx: cx + (Math.random() - 0.5) * 4,
        cz: cz + (Math.random() - 0.5) * 4,
        rx, rz,
        angle: angle + i * (0.06 + Math.random() * 0.05),
        speed,
        alt: alt + (Math.random() - 0.5) * 2.5,
        flapRate: 7 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        size: 0.8 + Math.random() * 0.5,
      })
    }
  }
  return birds
}

/**
 * A bird: body, head, tail fan and two swept wings. Forward is +X, span is Z.
 *
 * This replaces two flat triangles folded by a Z-scale — the classic distant
 * bird "sideways W". At the altitude these fly, that silhouette reads as a dark
 * arrowhead: no direction to it beyond the point, and the fold squashed the
 * whole bird rather than moving its wings.
 *
 * What is worth spending triangles on at this size is *outline*, not surface. A
 * beak and a tail fan give the shape a front and a back, and a knuckle partway
 * along each wing bends the leading edge so the wing has a shoulder instead of
 * being a spike. That is about thirty triangles a bird, fourteen birds, one
 * draw call.
 *
 * Vertex colours carry a dark back and a paler underside. Even unresolvable as
 * detail, the pair keeps the bird from reading as a single flat cutout when it
 * banks against a bright sky.
 */
function birdGeometry() {
  const geo = new THREE.BufferGeometry()

  const positions: number[] = []
  const colors: number[] = []

  /*
   * Built through THREE.Color rather than written as raw triples.
   *
   * Vertex colours are consumed as *linear* values, and colour management
   * converts a hex through this constructor on the way in. Typing the numbers
   * directly means writing linear ones — 0.2 there is a mid grey on screen, not
   * the dark slate it looks like in the source, which is exactly how the first
   * version of this came out looking like a paper aeroplane.
   */
  const rgb = (hex: number) => new THREE.Color(hex).toArray()
  const DARK = rgb(0x2b2f38)
  const MID = rgb(0x3c414d)
  const PALE = rgb(0x8d919b)

  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    colour: number[],
  ) => {
    positions.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) colors.push(...colour)
  }

  // --- body: a slender lozenge from beak to tail base ----------------------
  const BEAK: [number, number, number] = [0.62, 0, 0]
  const NECK_L: [number, number, number] = [0.34, 0.03, -0.07]
  const NECK_R: [number, number, number] = [0.34, 0.03, 0.07]
  const HIP_L: [number, number, number] = [-0.2, 0.02, -0.08]
  const HIP_R: [number, number, number] = [-0.2, 0.02, 0.08]
  const TAIL_BASE: [number, number, number] = [-0.34, 0, 0]

  tri(BEAK, NECK_R, NECK_L, MID)
  tri(NECK_L, NECK_R, HIP_R, DARK)
  tri(NECK_L, HIP_R, HIP_L, DARK)
  tri(HIP_L, HIP_R, TAIL_BASE, DARK)

  // --- tail: a shallow fan, notched at the centre --------------------------
  tri(TAIL_BASE, [-0.66, 0, -0.17], [-0.58, 0, 0], DARK)
  tri(TAIL_BASE, [-0.58, 0, 0], [-0.66, 0, 0.17], DARK)

  /*
   * --- wings ---------------------------------------------------------------
   * Three panels a side. The knuckle sits two thirds out and slightly forward
   * of the root, which is what puts a shoulder in the leading edge; the tip is
   * swept well back from it. The trailing edge steps in at the knuckle so the
   * inner wing is deeper than the outer — the shape every soaring bird has, and
   * the one thing that stops a wing reading as a triangle.
   *
   * A little dihedral (y rises toward the tip) keeps the rest pose from being
   * perfectly flat, so a gliding bird still catches light on one wing.
   */
  for (const side of [-1, 1] as const) {
    const s = (x: number, y: number, z: number): [number, number, number] => [x, y, z * side]
    const rootFront = s(0.24, 0.02, 0.07)
    const rootBack = s(-0.16, 0.02, 0.08)
    const knuckleFront = s(0.16, 0.05, 0.52)
    const knuckleBack = s(-0.24, 0.05, 0.5)
    const tip = s(-0.3, 0.09, 1.0)
    const tipBack = s(-0.48, 0.08, 0.86)

    // Inner panel, outer panel, and the swept primary between tip and trailing edge.
    if (side > 0) {
      tri(rootFront, knuckleFront, rootBack, MID)
      tri(rootBack, knuckleFront, knuckleBack, DARK)
      tri(knuckleFront, tip, knuckleBack, DARK)
      tri(knuckleBack, tip, tipBack, DARK)
    } else {
      // Wound the other way so both wings face the same side up.
      tri(knuckleFront, rootFront, rootBack, MID)
      tri(knuckleFront, rootBack, knuckleBack, DARK)
      tri(tip, knuckleFront, knuckleBack, DARK)
      tri(tip, knuckleBack, tipBack, DARK)
    }
  }

  // --- belly patch: the same body, a hair below, in a paler tone ------------
  // Two triangles, so a bird seen from beneath is not the same flat black as one
  // seen from above.
  tri([0.6, -0.02, 0], [0.3, -0.03, -0.06], [0.3, -0.03, 0.06], PALE)
  tri([0.3, -0.03, -0.06], [-0.22, -0.02, -0.07], [0.3, -0.03, 0.06], PALE)

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * Hinge the wings in the vertex shader instead of squashing the whole bird.
 *
 * The flap has to be per-instance — fourteen birds beating in unison is a
 * mechanism, not a flock — and the CPU cannot pose vertices of an InstancedMesh
 * individually. So each instance carries its own rate and phase, and the shader
 * rotates each vertex about the body's long axis by an angle that grows with
 * how far out the wing it sits. The body, sitting on the axis, does not move.
 *
 * The normal is rotated by the same amount. Without it the wings keep their
 * rest-pose shading through the whole beat, and a bird at the top of its
 * downstroke lights as though it were gliding.
 */
function birdMaterial() {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })
  const uniforms = { uTime: { value: 0 } }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float aPhase;
        attribute float aRate;
        uniform float uTime;

        /* Rotation about +X, by an angle that ramps in across the wing root. */
        vec3 flapPoint(vec3 p, float beat) {
          float span = abs(p.z);
          float amount = smoothstep(0.08, 0.55, span);
          // Down-stroke bites harder than the recovery, the way a real wingbeat does.
          float shaped = beat < 0.0 ? beat * 0.6 : beat;
          float a = shaped * 0.85 * amount * sign(p.z);
          float ca = cos(a);
          float sa = sin(a);
          return vec3(p.x, p.y * ca - p.z * sa, p.y * sa + p.z * ca);
        }
      `,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        #include <beginnormal_vertex>
        float beat = sin(uTime * aRate + aPhase);
        objectNormal = normalize(flapPoint(objectNormal + vec3(0.0, 0.0, position.z * 0.001), beat));
      `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        transformed = flapPoint(transformed, beat);
      `,
      )
  }

  return { material, uniforms }
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    spin: Math.random() * Math.PI * 2,
    spinSpeed: (Math.random() - 0.5) * 2,
    phase: Math.random() * Math.PI * 2,
    scale: 1,
  }))
}

export class Ambience {
  readonly group = new THREE.Group()

  private readonly leaves: THREE.InstancedMesh
  private readonly pollen: THREE.InstancedMesh
  private readonly fireflies: THREE.InstancedMesh
  private readonly birds: THREE.InstancedMesh
  private readonly birdData: Bird[]
  /** Drives the wing hinge in the bird shader. */
  private readonly birdUniforms: { uTime: { value: number } }

  private readonly leafData = makeParticles(LEAF_COUNT)
  private readonly pollenData = makeParticles(POLLEN_COUNT)
  private readonly fireflyData = makeParticles(FIREFLY_COUNT)

  /** Eased 0..1 weights so effects fade in and out instead of popping. */
  private leafWeight = 0
  private pollenWeight = 0
  private fireflyWeight = 0
  private birdWeight = 0

  constructor() {
    const fx = getParticleTextures()

    // Hard alpha cutout (not soft blending): transparent quads + fog paint a
    // visible rectangle around every flake. MeshBasic keeps colour readable at
    // night too — Lambert was turning them into black silhouettes.
    //
    /*
     * vertexColors ON, with a white colour attribute supplied below.
     *
     * The trap here has two jaws. Leave vertexColors on with no `color`
     * attribute and WebGL feeds the shader black, so every flake is a
     * silhouette. Turn vertexColors *off* to avoid that and instanceColor stops
     * working instead — three's color_fragment only applies vColor to the
     * diffuse under USE_COLOR, which is exactly what vertexColors enables, so
     * the per-leaf autumn tint is computed and then silently discarded.
     * Supplying white satisfies both: nothing goes black, and the tint lands.
     */
    const leafMat = new THREE.MeshBasicMaterial({
      map: fx.leaf,
      color: 0xffffff,
      vertexColors: true,
      alphaTest: 0.55,
      transparent: false,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true,
    })
    const leafGeo = new THREE.PlaneGeometry(0.55, 0.7)
    const leafWhite = new Float32Array(leafGeo.attributes.position.count * 3).fill(1)
    leafGeo.setAttribute('color', new THREE.BufferAttribute(leafWhite, 3))
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAF_COUNT)
    const c = new THREE.Color()
    for (let i = 0; i < LEAF_COUNT; i++) {
      c.setHex(LEAF_COLORS[i % LEAF_COLORS.length])
      this.leaves.setColorAt(i, c)
    }
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true

    /*
     * Soft additive motes — black in the sprite is empty after keying, but ONLY
     * with fog off. Fog mixes its colour into every fragment *before* the
     * additive blend, so a "black = invisible" texel becomes "fog-blue = added
     * glow" and the whole quad prints as a pale outline against anything dark —
     * which is exactly what the mist and the mountains are. (burst.ts carries
     * the same rule for the same reason.)
     */
    this.pollen = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        map: fx.pollen,
        color: 0xfff2c0,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
      POLLEN_COUNT,
    )

    this.fireflies = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        map: fx.firefly,
        color: 0xc8ff6a,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
      FIREFLY_COUNT,
    )

    /*
     * Birds are lit (Lambert) rather than additive: they are matter, not light,
     * and an additive bird over a bright sky disappears exactly when it should
     * be most visible. Dark plumage keeps them readable as silhouettes, which is
     * how distant birds actually present.
     */
    this.birdData = makeBirds()
    const birdGeo = birdGeometry()
    // Per-instance beat, so the flock never claps in unison.
    birdGeo.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(new Float32Array(this.birdData.map((b) => b.phase)), 1),
    )
    birdGeo.setAttribute(
      'aRate',
      new THREE.InstancedBufferAttribute(new Float32Array(this.birdData.map((b) => b.flapRate)), 1),
    )
    const bird = birdMaterial()
    this.birdUniforms = bird.uniforms
    this.birds = new THREE.InstancedMesh(birdGeo, bird.material, BIRD_COUNT)

    for (const mesh of [this.leaves, this.pollen, this.fireflies, this.birds]) {
      mesh.castShadow = false
      mesh.receiveShadow = false
      // The spawn box follows the camera, so the cached bounding sphere is
      // always stale — and the box is around the camera anyway, so culling it
      // would be wrong regardless.
      mesh.frustumCulled = false
      mesh.layers.set(MINOR_LAYER)
      mesh.visible = false
      this.group.add(mesh)
    }

    this.seed(this.leafData, 0)
    this.seed(this.pollenData, 0)
    this.seed(this.fireflyData, 0)
  }

  private seed(data: Particle[], centreY: number) {
    for (const p of data) this.respawn(p, 0, centreY, 0, true)
  }

  private respawn(p: Particle, cx: number, cy: number, cz: number, anywhere = false) {
    p.x = cx + (Math.random() - 0.5) * FIELD * 2
    p.z = cz + (Math.random() - 0.5) * FIELD * 2
    // New leaves enter from the top; on first seed they can start anywhere so
    // the field is already full on frame one.
    p.y = anywhere ? cy + Math.random() * FIELD_HEIGHT : cy + FIELD_HEIGHT
    p.scale = 0.6 + Math.random() * 0.9
    p.phase = Math.random() * Math.PI * 2
    p.spinSpeed = (Math.random() - 0.5) * 2.4
  }

  update(dt: number, elapsed: number, engine: Engine, weather: Weather, hour: number) {
    const focus = engine.focus

    // --- decide what should be in the air --------------------------------
    const night = hour >= 20.5 || hour < 4.5
    const calm = weather.current.type === 'clear' || weather.current.type === 'cloudy'
    const windy = weather.current.type === 'storm' || weather.current.type === 'rain'

    // Leaves blow hardest in wind but a few always drift.
    const wantLeaves = windy ? 1 : calm ? 0.35 : 0.6
    // Pollen is a fair-weather daytime thing.
    const wantPollen = !night && calm ? 1 : 0
    const wantFireflies = night && !windy ? 1 : 0
    // Birds fly by day and sit out storms; a few still cross a rainy sky.
    const wantBirds = night ? 0 : windy ? (weather.current.type === 'storm' ? 0 : 0.4) : 1

    const ease = Math.min(1, dt * 0.7)
    this.leafWeight += (wantLeaves - this.leafWeight) * ease
    this.pollenWeight += (wantPollen - this.pollenWeight) * ease
    this.fireflyWeight += (wantFireflies - this.fireflyWeight) * ease
    this.birdWeight += (wantBirds - this.birdWeight) * ease

    const gust = 1 + (windy ? 2.2 : 0)

    this.updateLeaves(dt, elapsed, focus, gust)
    this.updatePollen(dt, elapsed, focus, engine.camera)
    this.updateFireflies(dt, elapsed, focus, engine.camera)
    this.updateBirds(dt, elapsed, focus)
  }

  /**
   * Birds circle the valley on individual orbits.
   *
   * An orbit rather than a straight flight path because the world is a bowl —
   * a straight line either leaves the field in seconds or has to teleport back,
   * and both read as spawning. A wide ellipse keeps every bird in the air
   * indefinitely with no respawn logic at all.
   */
  private updateBirds(dt: number, elapsed: number, focus: THREE.Vector3) {
    const active = Math.floor(BIRD_COUNT * this.birdWeight)
    this.birds.visible = active > 0
    if (!this.birds.visible) return
    this.birdUniforms.uTime.value = elapsed

    for (let i = 0; i < BIRD_COUNT; i++) {
      const b = this.birdData[i]
      if (i >= active) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.setScalar(0.001)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        this.birds.setMatrixAt(i, dummy.matrix)
        continue
      }

      b.angle += b.speed * dt
      const x = b.cx + Math.cos(b.angle) * b.rx
      const z = b.cz + Math.sin(b.angle) * b.rz
      // Gentle altitude swell, so flocks climb and dip rather than gliding a rail.
      const y = b.alt + Math.sin(elapsed * 0.4 + b.phase) * 2.2

      dummy.position.set(x, y, z)
      // Face along the direction of travel (tangent of the ellipse).
      dummy.rotation.set(0, Math.atan2(-Math.sin(b.angle) * b.rx * -1, Math.cos(b.angle) * b.rz) + Math.PI, 0)
      /*
       * Bank into the turn. The ellipse's curvature flips sign twice a lap, so
       * rolling with it is what makes a circling flock look like it is flying
       * rather than being dragged around a rail.
       */
      dummy.rotation.z = -Math.sign(b.speed) * 0.28
      // The wingbeat itself is per-vertex in the shader — see birdMaterial.
      dummy.scale.setScalar(b.size)
      dummy.updateMatrix()
      this.birds.setMatrixAt(i, dummy.matrix)
    }
    this.birds.instanceMatrix.needsUpdate = true
    // Ellipses are centred on the village, not the camera — no focus tracking —
    // but `focus` stays a parameter so a future follow behaviour has it.
    void focus
  }

  private updateLeaves(dt: number, elapsed: number, focus: THREE.Vector3, gust: number) {
    const active = Math.floor(LEAF_COUNT * this.leafWeight)
    this.leaves.visible = active > 0
    if (active === 0) return

    for (let i = 0; i < LEAF_COUNT; i++) {
      const p = this.leafData[i]

      if (i >= active) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.setScalar(0.001)
        dummy.updateMatrix()
        this.leaves.setMatrixAt(i, dummy.matrix)
        continue
      }

      // Falling leaves flutter: a sine on the horizontal axes with a phase
      // offset per leaf, which reads far more like a leaf than a straight drop.
      p.y -= (0.9 + p.scale * 0.4) * dt
      p.x += (Math.sin(elapsed * 1.3 + p.phase) * 0.9 + 0.5 * gust) * dt
      p.z += Math.cos(elapsed * 1.1 + p.phase * 1.4) * 0.9 * dt
      p.spin += p.spinSpeed * dt

      // Recycle once below the player or too far out of the box.
      if (p.y < focus.y - 3 || Math.abs(p.x - focus.x) > FIELD || Math.abs(p.z - focus.z) > FIELD) {
        this.respawn(p, focus.x, focus.y, focus.z)
      }

      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.spin * 0.7, p.spin, p.spin * 1.3)
      dummy.scale.setScalar(p.scale * 0.85)
      dummy.updateMatrix()
      this.leaves.setMatrixAt(i, dummy.matrix)
    }
    this.leaves.instanceMatrix.needsUpdate = true
  }

  private updatePollen(dt: number, elapsed: number, focus: THREE.Vector3, camera: THREE.Camera) {
    const active = Math.floor(POLLEN_COUNT * this.pollenWeight)
    this.pollen.visible = active > 0
    if (active === 0) return

    for (let i = 0; i < POLLEN_COUNT; i++) {
      const p = this.pollenData[i]

      if (i >= active) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.setScalar(0.001)
        dummy.updateMatrix()
        this.pollen.setMatrixAt(i, dummy.matrix)
        continue
      }

      // Pollen rises slowly and wanders — it never falls.
      p.y += (0.14 + Math.sin(elapsed * 0.7 + p.phase) * 0.1) * dt
      p.x += Math.sin(elapsed * 0.5 + p.phase) * 0.3 * dt
      p.z += Math.cos(elapsed * 0.42 + p.phase * 1.7) * 0.3 * dt

      if (p.y > focus.y + FIELD_HEIGHT * 0.5 || Math.abs(p.x - focus.x) > FIELD) {
        this.respawn(p, focus.x, focus.y, focus.z)
        p.y = focus.y + Math.random() * 2
      }

      dummy.position.set(p.x, p.y, p.z)
      dummy.quaternion.copy(camera.quaternion)
      // Twinkle by scale rather than opacity: instanced meshes share one
      // material, so per-instance opacity is not available.
      dummy.scale.setScalar(p.scale * (0.6 + Math.sin(elapsed * 2 + p.phase) * 0.4) * this.pollenWeight)
      dummy.updateMatrix()
      this.pollen.setMatrixAt(i, dummy.matrix)
    }
    this.pollen.instanceMatrix.needsUpdate = true
  }

  private updateFireflies(dt: number, elapsed: number, focus: THREE.Vector3, camera: THREE.Camera) {
    const active = Math.floor(FIREFLY_COUNT * this.fireflyWeight)
    this.fireflies.visible = active > 0
    if (active === 0) return

    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const p = this.fireflyData[i]

      if (i >= active) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.setScalar(0.001)
        dummy.updateMatrix()
        this.fireflies.setMatrixAt(i, dummy.matrix)
        continue
      }

      // Lazy figure-of-eight drift close to the ground.
      p.x += Math.sin(elapsed * 0.9 + p.phase) * 0.55 * dt
      p.z += Math.sin(elapsed * 0.6 + p.phase * 2.1) * 0.55 * dt
      p.y += Math.sin(elapsed * 1.4 + p.phase * 1.3) * 0.35 * dt

      const targetY = focus.y + 0.6 + (p.scale - 0.6) * 1.4
      p.y += (targetY - p.y) * Math.min(1, dt * 0.6)

      if (Math.abs(p.x - focus.x) > FIELD * 0.7 || Math.abs(p.z - focus.z) > FIELD * 0.7) {
        this.respawn(p, focus.x, focus.y, focus.z)
        p.y = focus.y + 0.5 + Math.random() * 2
      }

      // Fireflies blink: mostly dark with a sharp pulse, which is what makes
      // them read as fireflies rather than as floating dots.
      const blink = Math.pow(Math.max(0, Math.sin(elapsed * 1.8 + p.phase * 3)), 6)

      dummy.position.set(p.x, p.y, p.z)
      dummy.quaternion.copy(camera.quaternion)
      dummy.scale.setScalar(p.scale * blink * this.fireflyWeight)
      dummy.updateMatrix()
      this.fireflies.setMatrixAt(i, dummy.matrix)
    }
    this.fireflies.instanceMatrix.needsUpdate = true
  }
}
