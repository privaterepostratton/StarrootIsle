import * as THREE from 'three'
import { groundHeight, isWalkable } from '../game/terrain'
import type { Engine } from './engine'

/**
 * Ground picking against the heightfield.
 *
 * Raycasting the terrain mesh directly would mean testing ~45k triangles per
 * click. Marching the ray against the analytic height function instead is a
 * few hundred cheap evaluations, and it automatically agrees with the
 * collision code — which uses the same function — so you can never click a
 * spot the player is then unable to reach.
 */

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const probe = new THREE.Vector3()

const STEP = 0.7
const MAX_STEPS = 420

/**
 * Raycast real meshes under the cursor, nearest first.
 *
 * Used before ground picking so a click on a plant's body selects that plant.
 * Returns every intersected object rather than just the closest: the root the
 * farm exposes also holds soil trays and markers, and the caller wants "the
 * nearest hit that resolves to a crop", not "the nearest hit, if it happens to
 * be a crop".
 */
export function pickObjects(
  engine: Engine,
  clientX: number,
  clientY: number,
  root: THREE.Object3D,
): THREE.Object3D[] {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, engine.camera)
  // Crops live on the minor layer as well as default; test both.
  raycaster.layers.enableAll()
  return raycaster.intersectObject(root, true).map((h) => h.object)
}

export function pickGround(engine: Engine, clientX: number, clientY: number): THREE.Vector3 | null {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, engine.camera)

  const origin = raycaster.ray.origin
  const dir = raycaster.ray.direction
  if (dir.y >= 0) return null // looking up; never hits the ground

  let tPrev = 0
  probe.copy(origin)
  let diffPrev = probe.y - groundHeight(probe.x, probe.z)

  for (let i = 1; i <= MAX_STEPS; i++) {
    const t = i * STEP
    probe.copy(origin).addScaledVector(dir, t)
    const diff = probe.y - groundHeight(probe.x, probe.z)

    if (diff <= 0) {
      // Crossed the surface between tPrev and t — refine by bisection so the
      // marker lands exactly on the ground rather than up to STEP below it.
      let lo = tPrev
      let hi = t
      let dLo = diffPrev
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2
        probe.copy(origin).addScaledVector(dir, mid)
        const dMid = probe.y - groundHeight(probe.x, probe.z)
        if (dMid <= 0 === dLo <= 0) {
          lo = mid
          dLo = dMid
        } else {
          hi = mid
        }
      }
      probe.copy(origin).addScaledVector(dir, hi)
      probe.y = groundHeight(probe.x, probe.z)
      return probe.clone()
    }

    tPrev = t
    diffPrev = diff
  }
  return null
}

/**
 * Nudge a picked point to somewhere the player can actually stand. Walks back
 * along the line toward the player, so clicking into a lake sends the farmer
 * to the near shore instead of doing nothing.
 */
export function nearestWalkable(target: THREE.Vector3, from: THREE.Vector3): THREE.Vector3 | null {
  if (isWalkable(target.x, target.z)) return target

  const dx = from.x - target.x
  const dz = from.z - target.z
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-4) return null

  const stepX = (dx / dist) * 0.6
  const stepZ = (dz / dist) * 0.6
  const steps = Math.ceil(dist / 0.6)

  const p = target.clone()
  for (let i = 0; i < steps; i++) {
    p.x += stepX
    p.z += stepZ
    if (isWalkable(p.x, p.z)) {
      p.y = groundHeight(p.x, p.z)
      return p
    }
  }
  return null
}


/**
 * Shortest distance from the click ray to a world point.
 *
 * Buildings need this where ground picking fails them: a click on a stall's
 * awning projects to ground *behind* the stall, outside any sane radius test.
 * Measuring against the ray itself makes the whole visible building clickable,
 * exactly like the crop-body fix in tileFromClick.
 */
export function rayDistanceToPoint(
  engine: Engine,
  clientX: number,
  clientY: number,
  point: THREE.Vector3,
): number {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, engine.camera)
  return raycaster.ray.distanceToPoint(point)
}
