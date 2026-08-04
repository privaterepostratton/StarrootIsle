import * as THREE from 'three'
import { mat, block, cyl, PALETTE } from './style'

export function createHoeModel(): THREE.Group {
  const g = new THREE.Group()
  const handle = cyl(0.022, 0.022, 0.6, PALETTE.wood, 6)
  handle.position.y = -0.18
  g.add(handle)
  const headMesh = block(0.16, 0.09, 0.03, PALETTE.stone, 0.02)
  headMesh.position.set(0, -0.46, 0.05)
  headMesh.rotation.x = 0.5
  g.add(headMesh)
  return g
}

export function createAxeModel(): THREE.Group {
  const g = new THREE.Group()
  const handle = cyl(0.024, 0.03, 0.62, PALETTE.wood, 6)
  handle.position.y = -0.2
  g.add(handle)

  const head = block(0.09, 0.2, 0.05, 0xb8bcc0, 0.02)
  head.position.set(0.04, -0.46, 0)
  g.add(head)

  // Bit flares out from the head — a plain box reads as a hammer.
  const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.06, 0.05, 6, 1, false, 0, Math.PI), mat(0xd6dade))
  bit.castShadow = true
  bit.rotation.set(Math.PI / 2, 0, Math.PI / 2)
  bit.position.set(0.13, -0.46, 0)
  g.add(bit)
  return g
}

export function createPickaxeModel(): THREE.Group {
  const g = new THREE.Group()
  const handle = cyl(0.024, 0.03, 0.62, PALETTE.woodDark, 6)
  handle.position.y = -0.2
  g.add(handle)

  for (const dir of [1, -1]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.26, 5), mat(0xa8adb2))
    spike.castShadow = true
    spike.position.set(dir * 0.15, -0.48, 0)
    spike.rotation.z = dir * (Math.PI / 2 - 0.28)
    g.add(spike)
  }
  const collar = cyl(0.05, 0.05, 0.1, 0x8d9297, 6)
  collar.position.y = -0.48
  g.add(collar)
  return g
}

export function createShovelModel(): THREE.Group {
  const g = new THREE.Group()
  const handle = cyl(0.024, 0.028, 0.58, PALETTE.wood, 6)
  handle.position.y = -0.17
  g.add(handle)

  // D-grip at the top so it reads as a shovel and not a spear.
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 5, 8), mat(PALETTE.woodDark))
  grip.castShadow = true
  grip.position.y = 0.16
  grip.rotation.y = Math.PI / 2
  g.add(grip)

  const collar = cyl(0.032, 0.038, 0.08, 0x8d9297, 6)
  collar.position.y = -0.45
  g.add(collar)

  const blade = block(0.17, 0.22, 0.03, 0xb8bcc0, 0.02)
  blade.position.y = -0.57
  g.add(blade)

  const point = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.1, 3), mat(0xc4c8cc))
  point.castShadow = true
  point.rotation.x = Math.PI
  point.rotation.y = Math.PI / 2
  point.position.y = -0.71
  g.add(point)
  return g
}

export function createWateringCanModel(): THREE.Group {
  const g = new THREE.Group()
  const canBody = cyl(0.11, 0.13, 0.2, 0x5cb8d8, 10)
  g.add(canBody)
  const spout = cyl(0.022, 0.035, 0.24, 0x4aa4c4, 6)
  spout.position.set(0.13, 0.02, 0)
  spout.rotation.z = -0.7
  g.add(spout)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 10, Math.PI), mat(0x4aa4c4))
  handle.position.set(-0.06, 0.09, 0)
  handle.rotation.set(Math.PI / 2, 0, -0.4)
  g.add(handle)
  return g
}
