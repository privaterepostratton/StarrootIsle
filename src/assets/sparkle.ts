import * as THREE from 'three'

/**
 * Ripeness sparkle.
 *
 * A ready crop needs to announce itself from across the farm, and at this
 * camera distance a colour change alone is too subtle. Orbiting motes catch
 * the eye through motion instead, which reads at any zoom level.
 *
 * The geometry and material are module-level singletons: there can be dozens
 * of ripe crops at once and each one allocating its own buffers would churn
 * memory every time a field comes in.
 */

const MOTE_COUNT = 5

/** Four-pointed star, so a mote reads as a sparkle rather than a dot. */
const MOTE_GEO = (() => {
  const shape = new THREE.Shape()
  const outer = 0.5
  const inner = 0.13
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outer : inner
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape, 1)
})()

/** Basic (unlit) and additive, so motes glow the same at noon and at midnight. */
const MOTE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xfff0a0,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
})

export interface Sparkle {
  object: THREE.Group
  update(time: number): void
}

/**
 * Build a sparkle cluster for a ripe crop.
 * `tint` lets a rare crop sparkle in its own colour.
 */
export function createSparkle(tint?: number | null): Sparkle {
  const group = new THREE.Group()
  const material = tint ? MOTE_MATERIAL.clone() : MOTE_MATERIAL
  if (tint) (material as THREE.MeshBasicMaterial).color.setHex(tint)

  const motes: THREE.Mesh[] = []
  const phases: number[] = []

  for (let i = 0; i < MOTE_COUNT; i++) {
    const mote = new THREE.Mesh(MOTE_GEO, material)
    mote.scale.setScalar(0.09)
    group.add(mote)
    motes.push(mote)
    phases.push((i / MOTE_COUNT) * Math.PI * 2)
  }

  return {
    object: group,

    update(time: number) {
      for (let i = 0; i < motes.length; i++) {
        const mote = motes[i]
        const phase = phases[i]

        // Each mote rides its own slow orbit, bobbing on a different period so
        // the cluster never visibly loops.
        const angle = time * 0.9 + phase
        const radius = 0.2 + Math.sin(time * 1.3 + phase) * 0.06
        mote.position.set(
          Math.cos(angle) * radius,
          0.3 + Math.sin(time * 1.7 + phase * 1.6) * 0.11,
          Math.sin(angle) * radius,
        )

        // Twinkle: scale and opacity pulse together, briefly to nothing, so
        // motes wink in and out rather than sliding around continuously.
        const twinkle = Math.max(0, Math.sin(time * 3.4 + phase * 2.1))
        mote.scale.setScalar(0.05 + twinkle * 0.075)
        mote.rotation.z = angle * 0.7

        // Always face the camera. Billboarding via rotation copy happens in
        // the render loop; here we just keep them flat-on by zeroing tilt.
        mote.rotation.x = 0
      }
    },
  }
}

/** Point every sparkle mote at the camera. Called once per frame. */
export function billboardSparkles(root: THREE.Object3D, camera: THREE.Camera) {
  root.quaternion.copy(camera.quaternion)
}
