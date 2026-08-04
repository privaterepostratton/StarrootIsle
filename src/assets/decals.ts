import * as THREE from 'three'
import { mat, ball, PALETTE } from './style'

/**
 * Ground dressing: tiny, collider-free props that break up open grass.
 *
 * These are deliberately built from a handful of shared geometries rather than
 * per-instance ones — a few hundred decals across the valley would otherwise
 * mean a few hundred buffer allocations for shapes nobody looks at closely.
 */

const pebbleGeo = new THREE.IcosahedronGeometry(1, 0)
const cloverGeo = new THREE.SphereGeometry(0.5, 6, 4)
const capGeo = new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
const stalkGeo = new THREE.CylinderGeometry(0.02, 0.026, 0.09, 5)

type Rand = () => number

export function createPebbleScatter(r: Rand): THREE.Group {
  const g = new THREE.Group()
  const n = 3 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const s = 0.05 + r() * 0.07
    const pebble = new THREE.Mesh(pebbleGeo, mat(r() > 0.5 ? PALETTE.stone : PALETTE.stoneDark, { flat: true }))
    pebble.castShadow = true
    pebble.receiveShadow = true
    pebble.scale.set(s, s * 0.6, s * 0.85)
    pebble.position.set((r() - 0.5) * 1.1, s * 0.4, (r() - 0.5) * 1.1)
    pebble.rotation.set(r() * 3, r() * 6, r() * 3)
    g.add(pebble)
  }
  return g
}

export function createCloverPatch(r: Rand): THREE.Group {
  const g = new THREE.Group()
  const n = 5 + Math.floor(r() * 6)
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(cloverGeo, mat(r() > 0.6 ? 0x63a83c : 0x4f9433))
    leaf.receiveShadow = true
    const s = 0.07 + r() * 0.06
    leaf.scale.set(s, s * 0.32, s)
    leaf.position.set((r() - 0.5) * 1.3, 0.02, (r() - 0.5) * 1.3)
    g.add(leaf)
  }
  return g
}

export function createMushroomCluster(r: Rand): THREE.Group {
  const g = new THREE.Group()
  const capColor = r() > 0.5 ? 0xd8543f : 0xd8a86a
  const n = 2 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 0.6
    const z = (r() - 0.5) * 0.6
    const s = 0.7 + r() * 0.7

    const stalk = new THREE.Mesh(stalkGeo, mat(PALETTE.white))
    stalk.castShadow = true
    stalk.scale.setScalar(s)
    stalk.position.set(x, 0.045 * s, z)
    g.add(stalk)

    const cap = new THREE.Mesh(capGeo, mat(capColor))
    cap.castShadow = true
    cap.scale.set(0.11 * s, 0.075 * s, 0.11 * s)
    cap.position.set(x, 0.088 * s, z)
    g.add(cap)
  }
  return g
}

/** Fallen log — a bigger set-dressing piece for forest clearings. */
export function createLogModel(r: Rand): THREE.Group {
  const g = new THREE.Group()
  const len = 1.4 + r() * 1.2
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, len, 8), mat(PALETTE.barkDark))
  log.castShadow = true
  log.receiveShadow = true
  log.rotation.z = Math.PI / 2
  log.position.y = 0.19
  g.add(log)

  const face = new THREE.Mesh(new THREE.CircleGeometry(0.19, 8), mat(0xd8b98c))
  face.position.set(len / 2, 0.19, 0)
  face.rotation.y = Math.PI / 2
  g.add(face)

  // A little moss on the upper side so it doesn't read as a plain tube.
  for (let i = 0; i < 3; i++) {
    const moss = ball(0.09 + r() * 0.05, 0x5f9c46, 1)
    moss.scale.set(1.3, 0.5, 1)
    moss.position.set((r() - 0.5) * len * 0.7, 0.33, (r() - 0.5) * 0.16)
    g.add(moss)
  }
  return g
}
