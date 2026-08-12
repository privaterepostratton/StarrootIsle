import * as THREE from 'three'
import { groundHeight } from '../terrain'
import { MINOR_LAYER } from '../../assets/style'

/**
 * Beat 4 — the wayfinding actors.
 *
 * Two butterflies drift on a looping path from the refusal spot toward the
 * treeline gap. They are the opening's only guidance: living, ignorable,
 * never an arrow. The player who follows them finds the bougainvillea; the
 * player who ignores them loses nothing — the loop keeps returning past the
 * beach end of the route, so the invitation renews itself forever.
 *
 * Build: one InstancedMesh of four wing quads (two per butterfly) per the
 * contract — no per-butterfly meshes, no textures. Motion is a closed
 * elliptical circuit (cosine ease along the from→to line, sine sweep across
 * it) so the loop never teleports, plus layered sine wander and a flap-coupled
 * lift so nothing about the flight is mechanical.
 *
 * Colours are quiet and nowhere near lotto gold: bleached ivory and a pale
 * lilac-blue, both authored desaturated for the 1.2-saturation grade.
 */

/** Wing span (x, hinge to tip) and chord (z) of one wing quad. */
const WING_SPAN = 0.2
const WING_CHORD = 0.14

/** Cruise height above the ground, before bobs and flap lift. */
const FLY_HEIGHT = 1.25

/**
 * Per-butterfly character. Different loop periods keep the pair from ever
 * phase-locking — two insects, not a formation.
 */
const FLIERS = [
  { period: 9.5, offset: 0.0, sweep: 2.4, flapHz: 11, bobHz: 1.9, color: 0xf2ead8 },
  { period: 11.5, offset: 0.45, sweep: -3.1, flapHz: 13, bobHz: 1.6, color: 0xbcc8e2 },
] as const

export class Butterflies {
  private readonly mesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly perp = new THREE.Vector2()
  private readonly prev = [new THREE.Vector3(), new THREE.Vector3()]
  private readonly headings = [0, 0]
  private active = false
  private t = 0

  constructor(scene: THREE.Group) {
    const geo = new THREE.PlaneGeometry(WING_SPAN, WING_CHORD)
    // Lay the wing flat (XZ plane) and move the hinge to the origin so a
    // roll about the body axis flaps the tip, not the middle.
    geo.rotateX(-Math.PI / 2)
    geo.translate(WING_SPAN / 2, 0, 0)

    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(geo, material, FLIERS.length * 2)
    // Instances wander far from the geometry's tiny bounds — cull by hand
    // (they are hidden whenever inactive anyway).
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    // Detail layer: the water's reflection buffers can live without them.
    this.mesh.layers.set(MINOR_LAYER)
    for (let b = 0; b < FLIERS.length; b++) {
      const c = new THREE.Color(FLIERS[b].color)
      this.mesh.setColorAt(b * 2, c)
      this.mesh.setColorAt(b * 2 + 1, c)
    }
    scene.add(this.mesh)
  }

  /** Two butterflies loop a drifting path from `from` toward `to`; ignorable. */
  lead(from: THREE.Vector3, to: THREE.Vector3): void {
    this.from.copy(from)
    this.to.copy(to)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    this.perp.set(-dz / len, dx / len)
    this.active = true
    this.mesh.visible = true
    // Seed the heading references so the first frame does not spin.
    for (let b = 0; b < FLIERS.length; b++) this.bodyPos(b, this.prev[b])
  }

  hide(): void {
    this.active = false
    this.mesh.visible = false
  }

  update(dt: number, elapsed: number): void {
    if (!this.active) return
    this.t += dt

    const pos = new THREE.Vector3()
    for (let b = 0; b < FLIERS.length; b++) {
      const f = FLIERS[b]
      this.bodyPos(b, pos)

      // Heading from actual travel, eased — a flutter, not a swivel.
      const mx = pos.x - this.prev[b].x
      const mz = pos.z - this.prev[b].z
      if (Math.hypot(mx, mz) > 1e-4) {
        const target = Math.atan2(mx, mz)
        let d = target - this.headings[b]
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        this.headings[b] += d * Math.min(1, dt * 5)
      }
      this.prev[b].copy(pos)

      // Wingbeat: fast open-close with a resting V, plus lift on the beat so
      // the body rides its own strokes.
      const beat = Math.sin(elapsed * f.flapHz * Math.PI * 2 + b * 1.7)
      const flap = 0.25 + Math.abs(beat) * 1.0
      pos.y += beat * 0.03

      for (const side of [-1, 1]) {
        this.dummy.position.copy(pos)
        this.dummy.scale.set(side, 1, 1)
        this.dummy.rotation.order = 'YZX'
        this.dummy.rotation.set(0, this.headings[b], side * flap)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(b * 2 + (side < 0 ? 0 : 1), this.dummy.matrix)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Body position on the circuit: θ sweeps the loop; cos eases progress
   * along from→to and back (0→1→0, no seam), sin bows the return leg out to
   * one side so the path is a lazy ellipse rather than a shuttle run.
   * Layered wander sines keep any two laps from matching.
   */
  private bodyPos(b: number, out: THREE.Vector3): void {
    const f = FLIERS[b]
    const th = ((this.t / f.period + f.offset) % 1) * Math.PI * 2
    const s = 0.5 - 0.5 * Math.cos(th)
    const lateral = Math.sin(th) * f.sweep + Math.sin(this.t * 0.9 + b * 2.6) * 0.35
    out.set(
      this.from.x + (this.to.x - this.from.x) * s + this.perp.x * lateral,
      0,
      this.from.z + (this.to.z - this.from.z) * s + this.perp.y * lateral,
    )
    out.y =
      groundHeight(out.x, out.z) +
      FLY_HEIGHT +
      Math.sin(this.t * f.bobHz + b * 1.3) * 0.28 +
      Math.sin(this.t * 0.53 + b) * 0.12
  }
}
