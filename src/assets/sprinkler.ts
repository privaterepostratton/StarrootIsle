import * as THREE from 'three'
import { mat, block, ball, cyl, PALETTE } from './style'
import type { SprinklerTier } from '../game/sprinklers'

/**
 * Sprinkler model: a squat base, a rising post, and a rotating head throwing
 * water arcs. The head spins and the arcs pulse in `update`, because a static
 * sprinkler reads as a fence post from any distance.
 *
 * Tier is legible at a glance from the arc count and the body colour, so a
 * player scanning their farm can see which plots are on the good hardware.
 */

export interface SprinklerModel {
  object: THREE.Group
  update(time: number): void
}

const ARC_GEO = new THREE.SphereGeometry(0.5, 6, 4)

export function createSprinklerModel(tier: SprinklerTier): SprinklerModel {
  const group = new THREE.Group()

  const base = cyl(0.19, 0.25, 0.1, PALETTE.stoneDark, 10)
  base.position.y = 0.05
  group.add(base)

  const post = cyl(0.06, 0.075, 0.34, tier.color, 8)
  post.position.y = 0.26
  group.add(post)

  // Rotating head.
  const head = new THREE.Group()
  head.position.y = 0.46
  group.add(head)

  const dome = ball(0.11, tier.color, 1)
  dome.scale.y = 0.75
  head.add(dome)

  const collar = cyl(0.13, 0.13, 0.035, tier.accent, 10)
  collar.position.y = -0.06
  head.add(collar)

  // One nozzle per unit of radius, so tier is countable.
  const nozzles = tier.radius + 1
  for (let i = 0; i < nozzles; i++) {
    const a = (i / nozzles) * Math.PI * 2
    const nozzle = cyl(0.022, 0.028, 0.12, tier.accent, 5)
    nozzle.position.set(Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1)
    nozzle.rotation.z = Math.cos(a) * 0.7
    nozzle.rotation.x = -Math.sin(a) * 0.7
    head.add(nozzle)
  }

  // Water arcs: droplet trails thrown outward, scaled to the tier's reach.
  const arcMaterial = new THREE.MeshBasicMaterial({
    color: tier.accent,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const droplets: THREE.Mesh[] = []
  const dropletsPerArc = 6
  for (let i = 0; i < nozzles; i++) {
    for (let j = 0; j < dropletsPerArc; j++) {
      const drop = new THREE.Mesh(ARC_GEO, arcMaterial)
      drop.scale.setScalar(0.035)
      drop.userData.arc = i
      drop.userData.step = j / dropletsPerArc
      head.add(drop)
      droplets.push(drop)
    }
  }

  const reach = tier.radius * 1.2 * 0.75

  return {
    object: group,

    update(time: number) {
      head.rotation.y = time * 1.6

      for (const drop of droplets) {
        const arc = drop.userData.arc as number
        // Each droplet marches along its arc on a loop, offset by its step, so
        // the trail reads as continuous flow rather than as discrete blobs.
        const t = ((time * 0.9 + drop.userData.step) % 1)
        const a = (arc / nozzles) * Math.PI * 2

        const dist = t * reach
        // Ballistic arc: up then down, landing at the radius edge.
        const height = 0.16 + Math.sin(t * Math.PI) * 0.34 - t * t * 0.42

        drop.position.set(Math.cos(a) * dist, height, Math.sin(a) * dist)
        drop.scale.setScalar(0.045 * (1 - t * 0.55))
      }
    },
  }
}

/** Flat translucent disc showing which plots a sprinkler covers. */
export function createCoverageDecal(radiusTiles: number, tileSize: number): THREE.Mesh {
  const size = (radiusTiles * 2 + 1) * tileSize
  const geo = new THREE.PlaneGeometry(size, size)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x6fd8ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  )
  mesh.renderOrder = 2
  return mesh
}

/** Small watering-can icon used for the shop row and placement ghost. */
export function createSprinklerGhost(tier: SprinklerTier): THREE.Group {
  const g = new THREE.Group()
  const body = block(0.28, 0.4, 0.28, tier.color, 0.06)
  body.position.y = 0.2
  ;(body.material as THREE.Material).transparent = true
  g.add(body)
  const top = ball(0.13, tier.accent, 1)
  top.position.y = 0.44
  g.add(top)
  return g
}

/** Shared translucent material so ghost previews never occlude the farm. */
export const GHOST_MATERIAL = mat(0x7ce87c)
