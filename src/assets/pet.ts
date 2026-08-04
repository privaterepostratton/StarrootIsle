import * as THREE from 'three'
import { mat, ball, cyl, PALETTE } from './style'
import type { PetSpeciesId } from '../game/pets'

/**
 * Pet models — small, round, and readable at ankle height.
 *
 * Pets trail the player and are usually seen at a distance of a couple of
 * metres against grass, so they lean hard on silhouette and a single strong
 * accent colour rather than detail. Every one exposes the same rig so the
 * follow animation is species-agnostic.
 */

export interface PetRig {
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  /** Ears, wings or tail — whatever this species flaps while moving. */
  flaps: THREE.Object3D[]
  legs: THREE.Group[]
}

function eyes(head: THREE.Group, spread: number, y: number, z: number, size = 0.03) {
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(PALETTE.black))
    eye.scale.set(size, size * 1.3, size * 0.6)
    eye.position.set(sx * spread, y, z)
    head.add(eye)

    // A tiny highlight is what stops the eyes reading as dead dots.
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), mat(0xffffff))
    glint.scale.setScalar(size * 0.32)
    glint.position.set(sx * spread + size * 0.5, y + size * 0.5, z + size * 0.4)
    head.add(glint)
  }
}

function stubLeg(color: number) {
  const joint = new THREE.Group()
  const seg = cyl(0.035, 0.04, 0.1, color, 5)
  seg.position.y = -0.05
  joint.add(seg)
  return joint
}

function base(): PetRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = 0.18
  root.add(body)
  const head = new THREE.Group()
  body.add(head)
  return { root, body, head, flaps: [], legs: [] }
}

function bunny(): PetRig {
  const rig = base()
  const fur = 0xf0e8dc

  const torso = ball(0.16, fur, 1)
  torso.scale.set(1, 0.92, 1.15)
  rig.body.add(torso)

  const tail = ball(0.06, 0xffffff, 1)
  tail.position.set(0, 0.02, -0.18)
  rig.body.add(tail)

  rig.head.position.set(0, 0.12, 0.12)
  const skull = ball(0.115, fur, 1)
  rig.head.add(skull)

  for (const sx of [-1, 1]) {
    const ear = ball(0.05, fur, 1)
    ear.scale.set(0.55, 1.9, 0.4)
    ear.position.set(sx * 0.055, 0.15, -0.01)
    ear.rotation.z = sx * 0.16
    rig.head.add(ear)
    rig.flaps.push(ear)

    const inner = ball(0.03, 0xf0a8b0, 1)
    inner.scale.set(0.5, 1.8, 0.3)
    inner.position.set(sx * 0.055, 0.15, 0.03)
    rig.head.add(inner)
  }

  const nose = ball(0.02, 0xf0a8b0, 1)
  nose.position.set(0, -0.01, 0.11)
  rig.head.add(nose)
  eyes(rig.head, 0.055, 0.03, 0.095)

  for (const sx of [-1, 1]) {
    const l = stubLeg(fur)
    l.position.set(sx * 0.08, -0.13, 0.03)
    rig.body.add(l)
    rig.legs.push(l)
  }
  return rig
}

function chick(): PetRig {
  const rig = base()
  const feather = 0xf5d84a

  const torso = ball(0.15, feather, 1)
  torso.scale.set(1, 1.05, 1)
  rig.body.add(torso)

  rig.head.position.set(0, 0.14, 0.02)
  const skull = ball(0.11, feather, 1)
  rig.head.add(skull)

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 5), mat(0xf2953a))
  beak.castShadow = true
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, -0.01, 0.11)
  rig.head.add(beak)

  const tuft = ball(0.035, 0xf2c14e, 1)
  tuft.position.y = 0.11
  rig.head.add(tuft)
  eyes(rig.head, 0.05, 0.025, 0.09, 0.026)

  for (const sx of [-1, 1]) {
    const wing = ball(0.07, 0xf2c14e, 1)
    wing.scale.set(0.32, 0.85, 1)
    wing.position.set(sx * 0.14, 0.01, 0)
    rig.body.add(wing)
    rig.flaps.push(wing)

    const l = stubLeg(0xf2953a)
    l.position.set(sx * 0.055, -0.12, 0.01)
    rig.body.add(l)
    rig.legs.push(l)
  }
  return rig
}

function fox(): PetRig {
  const rig = base()
  const coat = 0xe08a3a

  const torso = ball(0.16, coat, 1)
  torso.scale.set(1, 0.85, 1.35)
  rig.body.add(torso)

  // Big brush tail — the whole silhouette of a fox lives here.
  const tail = ball(0.1, coat, 1)
  tail.scale.set(0.8, 0.8, 1.7)
  tail.position.set(0, 0.06, -0.24)
  tail.rotation.x = 0.35
  rig.body.add(tail)
  rig.flaps.push(tail)

  const tip = ball(0.07, 0xf4f1e8, 1)
  tip.position.set(0, 0.14, -0.36)
  rig.body.add(tip)

  rig.head.position.set(0, 0.1, 0.16)
  const skull = ball(0.11, coat, 1)
  rig.head.add(skull)

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 6), mat(0xf4f1e8))
  snout.castShadow = true
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, -0.02, 0.11)
  rig.head.add(snout)

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 5), mat(coat))
    ear.castShadow = true
    ear.position.set(sx * 0.07, 0.11, -0.01)
    ear.rotation.z = sx * 0.25
    rig.head.add(ear)
  }
  eyes(rig.head, 0.055, 0.02, 0.085)

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = stubLeg(0x3b3730)
      l.position.set(sx * 0.09, -0.11, sz * 0.11)
      rig.body.add(l)
      rig.legs.push(l)
    }
  }
  return rig
}

function hedgehog(): PetRig {
  const rig = base()

  const belly = ball(0.15, 0xd8b48c, 1)
  belly.scale.set(1, 0.85, 1.15)
  rig.body.add(belly)

  // Spines: a shell of cones, which is the only readable way to say "hedgehog".
  for (let i = 0; i < 22; i++) {
    const u = Math.random() * 0.8 + 0.1
    const theta = (i / 22) * Math.PI * 2 * 1.618
    const s = Math.sqrt(1 - u * u)
    const dir = new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta) - 0.15)

    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 4), mat(i % 2 ? 0x6b5a4a : 0x54463a))
    spine.castShadow = true
    spine.position.copy(dir).multiplyScalar(0.15)
    spine.lookAt(dir.clone().multiplyScalar(2))
    spine.rotateX(Math.PI / 2)
    rig.body.add(spine)
  }

  rig.head.position.set(0, 0.02, 0.16)
  const skull = ball(0.085, 0xd8b48c, 1)
  skull.scale.set(1, 0.9, 1.1)
  rig.head.add(skull)

  const nose = ball(0.022, PALETTE.black, 1)
  nose.position.set(0, -0.01, 0.09)
  rig.head.add(nose)
  eyes(rig.head, 0.045, 0.025, 0.07, 0.024)

  for (const sx of [-1, 1]) {
    const l = stubLeg(0xb08a64)
    l.position.set(sx * 0.075, -0.11, 0.03)
    rig.body.add(l)
    rig.legs.push(l)
  }
  return rig
}

function dragonling(): PetRig {
  const rig = base()
  const scale = 0.7
  const skin = 0x6ad0a8

  const torso = ball(0.15, skin, 1)
  torso.scale.set(1, 0.95, 1.3)
  rig.body.add(torso)

  const tail = ball(0.06, skin, 1)
  tail.scale.set(0.7, 0.7, 2.2)
  tail.position.set(0, 0.02, -0.24)
  rig.body.add(tail)
  rig.flaps.push(tail)

  rig.head.position.set(0, 0.13, 0.14)
  const skull = ball(0.105, skin, 1)
  skull.scale.set(1, 0.95, 1.15)
  rig.head.add(skull)

  const snout = ball(0.055, skin, 1)
  snout.scale.set(0.9, 0.7, 1.1)
  snout.position.set(0, -0.03, 0.1)
  rig.head.add(snout)

  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 4), mat(0xf2e05c))
    horn.castShadow = true
    horn.position.set(sx * 0.05, 0.11, -0.02)
    horn.rotation.z = sx * 0.35
    rig.head.add(horn)

    // Wings flap on the follow animation.
    const wing = ball(0.11, 0x4fb894, 1)
    wing.scale.set(0.18, 0.95, 1.1)
    wing.position.set(sx * 0.14, 0.08, -0.04)
    wing.rotation.z = sx * 0.5
    rig.body.add(wing)
    rig.flaps.push(wing)
  }
  eyes(rig.head, 0.05, 0.02, 0.09, 0.028)

  for (const sx of [-1, 1]) {
    const l = stubLeg(0x4fb894)
    l.position.set(sx * 0.08, -0.12, 0.02)
    rig.body.add(l)
    rig.legs.push(l)
  }

  rig.root.scale.setScalar(scale / 0.7)
  return rig
}

function phoenix(): PetRig {
  const rig = base()
  const flame = 0xf2743a

  const torso = ball(0.14, flame, 1)
  torso.scale.set(1, 1.1, 1)
  rig.body.add(torso)

  // Tail plumes in a descending gradient — the read is "on fire".
  const plumeColors = [0xf2c14e, 0xf2913a, 0xe0552f]
  for (let i = 0; i < 3; i++) {
    const plume = ball(0.075, plumeColors[i], 1)
    plume.scale.set(0.4, 1.5, 0.4)
    plume.position.set((i - 1) * 0.07, 0.06, -0.2)
    plume.rotation.x = -0.6
    rig.body.add(plume)
    rig.flaps.push(plume)
  }

  rig.head.position.set(0, 0.16, 0.03)
  const skull = ball(0.1, flame, 1)
  rig.head.add(skull)

  const crest = ball(0.05, 0xf2e05c, 1)
  crest.scale.set(0.35, 1.5, 0.6)
  crest.position.y = 0.12
  rig.head.add(crest)

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 5), mat(0xf2c14e))
  beak.castShadow = true
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, -0.01, 0.1)
  rig.head.add(beak)
  eyes(rig.head, 0.048, 0.025, 0.085, 0.026)

  for (const sx of [-1, 1]) {
    const wing = ball(0.12, 0xf2913a, 1)
    wing.scale.set(0.22, 1, 1.15)
    wing.position.set(sx * 0.14, 0.03, -0.02)
    rig.body.add(wing)
    rig.flaps.push(wing)

    const l = stubLeg(0xf2c14e)
    l.position.set(sx * 0.055, -0.12, 0.01)
    rig.body.add(l)
    rig.legs.push(l)
  }
  return rig
}

export function createPetModel(species: PetSpeciesId): PetRig {
  switch (species) {
    case 'bunny':
      return bunny()
    case 'chick':
      return chick()
    case 'fox':
      return fox()
    case 'hedgehog':
      return hedgehog()
    case 'dragonling':
      return dragonling()
    case 'phoenix':
      return phoenix()
  }
}

/** Egg model, used in the shop preview and while incubating. */
export function createEggModel(shell: number, speck: number): THREE.Group {
  const g = new THREE.Group()

  const egg = ball(0.22, shell, 2)
  egg.scale.set(0.82, 1.12, 0.82)
  egg.position.y = 0.25
  g.add(egg)

  // Speckles, distributed with a golden-angle spiral so they never band.
  for (let i = 0; i < 14; i++) {
    const u = (i / 14) * 1.7 - 0.85
    const theta = i * 2.39996
    const s = Math.sqrt(1 - u * u)
    const spot = ball(0.028 + (i % 3) * 0.008, speck, 1)
    spot.scale.set(1, 1, 0.35)
    spot.position.set(s * Math.cos(theta) * 0.19, 0.25 + u * 0.24, s * Math.sin(theta) * 0.19)
    spot.lookAt(0, 0.25, 0)
    g.add(spot)
  }

  const nest = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.06, 6, 12), mat(0x8a6a3a))
  nest.castShadow = true
  nest.receiveShadow = true
  nest.rotation.x = Math.PI / 2
  nest.position.y = 0.05
  g.add(nest)

  return g
}
