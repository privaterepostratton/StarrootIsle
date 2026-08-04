import * as THREE from 'three'

/**
 * The "!" marker, shared by anything that needs to shout for attention.
 *
 * Built from geometry, not a canvas texture. A texture version rendered as an
 * opaque dark rectangle — the canvas's transparent region came through solid —
 * and rather than tune blend flags against a failure that would not reproduce
 * headlessly, this removes the failure mode: two solid meshes have no alpha
 * channel to get wrong. A dark copy sits a hair behind a bright one, which is
 * how it gets a cartoon outline without a texture.
 *
 * The fill is deliberately pushed past white-point with `toneMapped: false`.
 * Basic materials already ignore scene lights, so the marker was never being
 * *dimmed* — a flat mid-yellow just reads dull next to a night grade that has
 * crushed everything around it. An over-1 colour blows through the tone map and
 * clears the bloom threshold, which is what makes it look lit rather than
 * painted.
 *
 * One object, so an exclamation mark means the same thing wherever it appears —
 * over the stall, or over a neighbour with a request.
 */

const FILL = new THREE.MeshBasicMaterial({
  color: 0xffe680,
  depthTest: false,
  toneMapped: false,
})
FILL.color.multiplyScalar(2.6)

const EDGE = new THREE.MeshBasicMaterial({ color: 0x2a1408, depthTest: false })

const barGeo = new THREE.BoxGeometry(0.1, 0.26, 0.02)
const dotGeo = new THREE.BoxGeometry(0.11, 0.11, 0.02)

/**
 * A fresh marker group, hidden until shown.
 *
 * depthTest is off on both materials: a marker occluded by the very thing it is
 * pointing at is a marker that fails exactly when it matters.
 *
 * The explicit per-mesh renderOrder is the whole reason this reads gold rather
 * than black. A Group's renderOrder becomes its children's *groupOrder*, so both
 * passes tie on that AND on their own renderOrder — and three then breaks the tie
 * by material id, which follows creation order. FILL is declared above EDGE, so
 * the black outline sorted last and painted straight over the gold. With
 * depthTest off there is no depth buffer to save it either. Ordering the two
 * passes explicitly makes the outline-then-fill sequence a fact instead of an
 * accident of declaration order.
 */
export function createAlertMarker(scale = 1) {
  const group = new THREE.Group()
  for (const [mat, outline, z, order] of [
    [EDGE, 1.45, -0.01, 0],
    [FILL, 1, 0, 1],
  ] as const) {
    const bar = new THREE.Mesh(barGeo, mat)
    bar.position.set(0, 0.09, z)
    bar.scale.setScalar(outline)
    bar.renderOrder = order
    const dot = new THREE.Mesh(dotGeo, mat)
    dot.position.set(0, -0.12, z)
    dot.scale.setScalar(outline)
    dot.renderOrder = order
    group.add(bar, dot)
  }
  group.scale.setScalar(scale)
  group.renderOrder = 32
  group.visible = false
  return group
}
