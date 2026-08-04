import * as THREE from 'three'
import { mat, block, ball, PALETTE } from './style'

/**
 * Decorative props and the beehive.
 *
 * All of these are placed freely in the world rather than snapped to farm
 * plots, so each is modelled around its own origin at ground level with a
 * sensible footprint — nothing here should look wrong at an arbitrary rotation.
 */

/** Flat stone path tile. Placed in runs to make walkways. */
export function createPathTile(): THREE.Group {
  const g = new THREE.Group()
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.09, 7), mat(0xb0aa9c))
  slab.receiveShadow = true
  slab.position.y = 0.045
  g.add(slab)

  // A few darker chips so a long path does not read as a repeated stamp.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.7
    const chip = ball(0.09, 0x968f82, 1)
    chip.scale.set(1, 0.25, 1)
    chip.position.set(Math.cos(a) * 0.24, 0.09, Math.sin(a) * 0.24)
    g.add(chip)
  }
  return g
}

/**
 * Beehive. The bees are individual motes orbiting the box — cheap, and the
 * motion is what makes the hive read as active rather than as a crate.
 */
export interface BeehiveModel {
  object: THREE.Group
  update(time: number): void
}

export function createBeehive(): BeehiveModel {
  const g = new THREE.Group()

  const stand = block(0.5, 0.1, 0.5, PALETTE.woodDark, 0.03)
  stand.position.y = 0.05
  g.add(stand)

  // Stacked supers, slightly tapered so it reads as a real hive.
  for (let i = 0; i < 3; i++) {
    const box = block(0.56 - i * 0.03, 0.22, 0.56 - i * 0.03, i % 2 ? 0xe8d8a8 : 0xd8c48c, 0.03)
    box.position.y = 0.21 + i * 0.23
    g.add(box)
  }

  const lid = block(0.66, 0.08, 0.66, 0xa8763a, 0.03)
  lid.position.y = 0.93
  g.add(lid)

  const entrance = block(0.24, 0.05, 0.04, 0x3b3730, 0.01)
  entrance.position.set(0, 0.16, 0.28)
  g.add(entrance)

  // Bees.
  const beeMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e })
  const bees: THREE.Mesh[] = []
  const beeGeo = new THREE.SphereGeometry(0.035, 5, 4)
  for (let i = 0; i < 6; i++) {
    const bee = new THREE.Mesh(beeGeo, beeMat)
    bee.userData.phase = (i / 6) * Math.PI * 2
    bee.userData.radius = 0.5 + (i % 3) * 0.22
    bee.userData.height = 0.5 + (i % 4) * 0.22
    g.add(bee)
    bees.push(bee)
  }

  return {
    object: g,
    update(time: number) {
      for (const bee of bees) {
        const phase = bee.userData.phase as number
        const radius = bee.userData.radius as number
        const height = bee.userData.height as number
        // Each bee on its own orbit at its own speed, bobbing independently.
        const a = time * (1.1 + phase * 0.12) + phase
        bee.position.set(
          Math.cos(a) * radius,
          height + Math.sin(time * 2.3 + phase) * 0.12,
          Math.sin(a) * radius,
        )
      }
    },
  }
}
