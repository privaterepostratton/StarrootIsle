import * as THREE from 'three'

/**
 * Rain splashes.
 *
 * Rain that stops dead at the ground reads as a texture drawn over the world
 * rather than as water falling on it. What sells the contact is the ring: a
 * droplet lands, a ripple runs outward, it fades. Each ring is short-lived and
 * small, but a downpour puts hundreds a second across the ground and that
 * shimmer is most of what the player actually perceives as "it is raining".
 *
 * One InstancedMesh for the whole system, with a fixed pool overwritten oldest
 * first. A ring per droplet allocated on impact would churn hard at storm
 * density, and the fixed pool caps the cost of the heaviest weather at the cost
 * of the lightest.
 *
 * Fade rides on instanceColor rather than on per-instance opacity, which
 * InstancedMesh has no slot for. Additive blending is what makes that work:
 * scaling a ring's colour toward black under additive blending *is* fading it
 * out, so the standard vertexColors path does the whole job with no shader
 * patching.
 */

/** How many rings can be alive at once. Beyond this, the oldest is recycled. */
const POOL = 220
/** Seconds from impact to gone. */
const LIFE = 0.5
/**
 * Ring radius at birth and at death, in world units.
 *
 * Tuned by eye at the game's camera distance rather than to droplet scale — a
 * physically-sized ripple is a couple of pixels here and simply does not read.
 */
const R_START = 0.09
const R_END = 0.5
/**
 * Peak additive brightness of a ring.
 *
 * Additive white goes through the bloom pass, so a ring at full strength reads
 * as a neon hoop rather than as water. Kept well under 1 so the effect is a wet
 * sheen catching the light.
 */
const PEAK = 0.42
/** Lifted clear of the ground so the ring never z-fights the terrain. */
const LIFT = 0.035

/** Flat annulus, already lying in the XZ plane so instances need no rotation. */
const RING_GEO = (() => {
  const geo = new THREE.RingGeometry(0.7, 1, 14)
  geo.rotateX(-Math.PI / 2)
  // A white vertex colour, which looks redundant and is not.
  //
  // instanceColor only reaches the fragment colour through the USE_COLOR path,
  // and USE_COLOR is what `vertexColors: true` switches on — but that same
  // define also multiplies in a `color` *attribute*. Without one, WebGL feeds
  // the shader the default generic value for a disabled attribute, which is
  // black, and every ring multiplies out to nothing. Supplying white makes the
  // multiply a no-op and lets the per-instance fade through.
  const white = new Float32Array(geo.attributes.position.count * 3).fill(1)
  geo.setAttribute('color', new THREE.BufferAttribute(white, 3))
  return geo
})()

export class RainSplashes {
  readonly object: THREE.InstancedMesh

  private readonly x = new Float32Array(POOL)
  private readonly y = new Float32Array(POOL)
  private readonly z = new Float32Array(POOL)
  /** Seconds of life remaining; <= 0 means the slot is free. */
  private readonly life = new Float32Array(POOL)
  /** Per-ring size jitter, so a shower does not look stamped. */
  private readonly size = new Float32Array(POOL)
  private next = 0
  /** Skip the buffer upload entirely on frames with nothing alive. */
  private alive = 0

  private readonly m = new THREE.Matrix4()
  private readonly pos = new THREE.Vector3()
  private readonly scl = new THREE.Vector3()
  private readonly rot = new THREE.Quaternion()
  private readonly tint = new THREE.Color()

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xcdeaf8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexColors: true,
    })

    this.object = new THREE.InstancedMesh(RING_GEO, material, POOL)
    // Rings are repositioned in place every frame, so the cached bounding
    // sphere is stale the moment it is computed.
    this.object.frustumCulled = false
    this.object.visible = false
    // Every slot starts collapsed. An InstancedMesh draws all of its instances
    // whatever their state, so a free slot has to be a zero-scale matrix.
    for (let i = 0; i < POOL; i++) {
      this.object.setMatrixAt(i, this.m.identity().scale(this.scl.set(0, 0, 0)))
      this.object.setColorAt(i, this.tint.setRGB(0, 0, 0))
    }
    scene.add(this.object)
  }

  /** Land a droplet at a point on the ground. */
  spawn(x: number, groundY: number, z: number) {
    const i = this.next
    this.next = (this.next + 1) % POOL
    this.x[i] = x
    this.y[i] = groundY + LIFT
    this.z[i] = z
    this.life[i] = LIFE
    this.size[i] = 0.7 + Math.random() * 0.6
  }

  update(dt: number) {
    let alive = 0

    for (let i = 0; i < POOL; i++) {
      const remaining = this.life[i]
      if (remaining <= 0) continue

      const left = remaining - dt
      this.life[i] = left
      if (left <= 0) {
        // Collapse the slot on the frame it dies, or the last frame's ring
        // stays on screen until something else claims the slot.
        this.object.setMatrixAt(i, this.m.identity().scale(this.scl.set(0, 0, 0)))
        this.object.setColorAt(i, this.tint.setRGB(0, 0, 0))
        alive++
        continue
      }

      // Ease outward so the ring leaps from the impact and slows as it dies,
      // which is how a real ripple loses energy.
      const t = 1 - left / LIFE
      const spread = 1 - (1 - t) * (1 - t)
      const r = (R_START + (R_END - R_START) * spread) * this.size[i]
      // Held near full for the first third, then dropped away. A fade that
      // starts falling immediately never reaches a brightness that registers
      // against sunlit ground, which is where most of the rain lands.
      const fade = (Math.min(1, (1 - t) * 1.5) ** 1.4) * PEAK

      this.pos.set(this.x[i], this.y[i], this.z[i])
      this.scl.set(r, 1, r)
      this.object.setMatrixAt(i, this.m.compose(this.pos, this.rot, this.scl))
      this.object.setColorAt(i, this.tint.setRGB(fade, fade, fade))
      alive++
    }

    // A frame that had rings and now has none still needs one upload to push
    // the collapsed matrices, hence the check against the *previous* count.
    if (alive > 0 || this.alive > 0) {
      this.object.instanceMatrix.needsUpdate = true
      if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true
    }
    this.object.visible = alive > 0
    this.alive = alive
  }
}
