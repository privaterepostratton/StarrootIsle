import * as THREE from 'three'
import { mat, ball, cyl, block, PALETTE } from './style'
import { asset } from '../core/assets'
import type { AnimalSpecies } from '../game/animals'

/**
 * Livestock models, built to the same chunky Animal Crossing proportions as
 * the farmer: oversized head, stubby legs, no neck.
 *
 * Each returns a rig so the animator can bob the body and swing the legs
 * without traversing the hierarchy every frame — there can be dozens of these
 * wandering at once.
 */

export interface AnimalRig {
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  legs: THREE.Group[]
  /** Anchor above the animal where a ready product icon floats. */
  productAnchor: THREE.Object3D
}

function leg(len: number, thickness: number, color: number) {
  const joint = new THREE.Group()
  const seg = cyl(thickness, thickness * 1.1, len, color, 6)
  seg.position.y = -len / 2
  joint.add(seg)
  return joint
}

function eyes(head: THREE.Group, spread: number, y: number, z: number, size = 0.032) {
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(PALETTE.black))
    eye.scale.set(size, size * 1.25, size * 0.5)
    eye.position.set(sx * spread, y, z)
    head.add(eye)
  }
}

function createChicken(): AnimalRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = 0.3
  root.add(body)

  const torso = ball(0.21, PALETTE.white, 1)
  torso.scale.set(1, 1.05, 1.2)
  body.add(torso)

  // Tail fan gives the silhouette a direction.
  for (let i = 0; i < 3; i++) {
    const feather = ball(0.09, 0xe8e2d4, 1)
    feather.scale.set(0.5, 1.1, 0.35)
    feather.position.set((i - 1) * 0.05, 0.12, -0.22)
    feather.rotation.x = -0.7
    body.add(feather)
  }

  const head = new THREE.Group()
  head.position.set(0, 0.16, 0.17)
  body.add(head)

  const skull = ball(0.12, PALETTE.white, 1)
  head.add(skull)

  const comb = ball(0.05, 0xe04a3a, 1)
  comb.scale.set(0.5, 1, 1.1)
  comb.position.y = 0.11
  head.add(comb)

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 5), mat(0xf2a63a))
  beak.castShadow = true
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, -0.01, 0.12)
  head.add(beak)

  const wattle = ball(0.03, 0xe04a3a, 1)
  wattle.position.set(0, -0.08, 0.08)
  head.add(wattle)

  eyes(head, 0.06, 0.03, 0.1, 0.028)

  const legs = [-1, 1].map((sx) => {
    const l = leg(0.14, 0.022, 0xf2a63a)
    l.position.set(sx * 0.07, -0.14, 0.02)
    body.add(l)
    return l
  })

  const productAnchor = new THREE.Object3D()
  productAnchor.position.y = 0.72
  root.add(productAnchor)

  return { root, body, head, legs, productAnchor }
}

function createSheep(): AnimalRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = 0.44
  root.add(body)

  // Fleece is a cluster of overlapping lumps — one smooth ball reads as a pill.
  const lumps: [number, number, number, number][] = [
    [0, 0, 0, 0.29],
    [0.17, 0.06, 0.04, 0.21],
    [-0.17, 0.05, -0.03, 0.22],
    [0, 0.13, -0.14, 0.2],
    [0, 0.08, 0.16, 0.19],
  ]
  for (const [x, y, z, r] of lumps) {
    const lump = ball(r, 0xf4f1e8, 1)
    lump.position.set(x, y, z)
    body.add(lump)
  }

  const head = new THREE.Group()
  head.position.set(0, 0.02, 0.32)
  body.add(head)

  const skull = ball(0.13, 0x3b3730, 1)
  skull.scale.set(0.9, 1, 1.15)
  head.add(skull)

  const fringe = ball(0.11, 0xf4f1e8, 1)
  fringe.scale.set(1, 0.7, 0.6)
  fringe.position.set(0, 0.09, -0.02)
  head.add(fringe)

  for (const sx of [-1, 1]) {
    const ear = ball(0.055, 0x3b3730, 1)
    ear.scale.set(1.5, 0.5, 0.7)
    ear.position.set(sx * 0.13, 0.02, -0.02)
    head.add(ear)
  }

  eyes(head, 0.06, 0.01, 0.11, 0.03)

  const legs: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = leg(0.24, 0.035, 0x3b3730)
      l.position.set(sx * 0.13, -0.2, sz * 0.15)
      body.add(l)
      legs.push(l)
    }
  }

  const productAnchor = new THREE.Object3D()
  productAnchor.position.y = 1.05
  root.add(productAnchor)

  return { root, body, head, legs, productAnchor }
}

function createCow(): AnimalRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = 0.62
  root.add(body)

  const torso = block(0.52, 0.42, 0.78, PALETTE.white, 0.18)
  body.add(torso)

  // Patches, placed asymmetrically so the cow reads as hand-painted.
  const patches: [number, number, number, number][] = [
    [0.2, 0.1, 0.2, 0.15],
    [-0.18, -0.04, -0.14, 0.13],
    [0.16, -0.1, -0.28, 0.1],
  ]
  for (const [x, y, z, r] of patches) {
    const patch = ball(r, 0x2f2b26, 1)
    patch.scale.set(1.2, 0.9, 1.2)
    patch.position.set(x, y, z)
    body.add(patch)
  }

  const head = new THREE.Group()
  head.position.set(0, 0.1, 0.46)
  body.add(head)

  const skull = block(0.3, 0.28, 0.3, PALETTE.white, 0.1)
  head.add(skull)

  const muzzle = block(0.22, 0.16, 0.14, 0xf0c0b8, 0.06)
  muzzle.position.set(0, -0.07, 0.19)
  head.add(muzzle)

  for (const sx of [-1, 1]) {
    const nostril = ball(0.022, 0x9a6a62, 1)
    nostril.position.set(sx * 0.05, -0.05, 0.26)
    head.add(nostril)

    const horn = ball(0.05, 0xe8dcc0, 1)
    horn.scale.set(1, 0.7, 1)
    horn.position.set(sx * 0.15, 0.15, 0)
    head.add(horn)

    const ear = ball(0.06, PALETTE.white, 1)
    ear.scale.set(1.6, 0.6, 0.8)
    ear.position.set(sx * 0.19, 0.05, -0.02)
    head.add(ear)
  }

  eyes(head, 0.09, 0.05, 0.16, 0.036)

  const udder = ball(0.13, 0xf0b0b0, 1)
  udder.scale.set(1, 0.8, 1.2)
  udder.position.set(0, -0.22, -0.12)
  body.add(udder)

  const legs: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = leg(0.34, 0.055, 0x2f2b26)
      l.position.set(sx * 0.19, -0.19, sz * 0.26)
      body.add(l)
      legs.push(l)
    }
  }

  const productAnchor = new THREE.Object3D()
  productAnchor.position.y = 1.35
  root.add(productAnchor)

  return { root, body, head, legs, productAnchor }
}

function createPig(): AnimalRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = 0.36
  root.add(body)

  const torso = ball(0.28, 0xf0a8b0, 1)
  torso.scale.set(1, 0.92, 1.35)
  body.add(torso)

  const head = new THREE.Group()
  head.position.set(0, 0.06, 0.32)
  body.add(head)

  const skull = ball(0.17, 0xf0a8b0, 1)
  skull.scale.set(1, 0.95, 1.05)
  head.add(skull)

  const snout = cyl(0.08, 0.08, 0.08, 0xe08f9a, 10)
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, -0.02, 0.17)
  head.add(snout)

  for (const sx of [-1, 1]) {
    const nostril = ball(0.018, 0xb06a74, 1)
    nostril.position.set(sx * 0.03, -0.02, 0.21)
    head.add(nostril)

    const ear = ball(0.07, 0xe08f9a, 1)
    ear.scale.set(0.8, 1.1, 0.35)
    ear.position.set(sx * 0.12, 0.13, -0.01)
    ear.rotation.z = sx * 0.4
    head.add(ear)
  }

  eyes(head, 0.07, 0.04, 0.14, 0.028)

  // Curly tail: a short spiral of shrinking beads.
  for (let i = 0; i < 5; i++) {
    const t = i / 5
    const bead = ball(0.028 - t * 0.008, 0xe08f9a, 1)
    const a = t * Math.PI * 2.4
    bead.position.set(Math.cos(a) * 0.05, 0.13 + t * 0.06, -0.38 + Math.sin(a) * 0.04)
    body.add(bead)
  }

  const legs: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = leg(0.16, 0.045, 0xd8848f)
      l.position.set(sx * 0.14, -0.18, sz * 0.18)
      body.add(l)
      legs.push(l)
    }
  }

  const productAnchor = new THREE.Object3D()
  productAnchor.position.y = 0.85
  root.add(productAnchor)

  return { root, body, head, legs, productAnchor }
}

export function createAnimalModel(species: AnimalSpecies): AnimalRig {
  switch (species) {
    case 'chicken':
      return createChicken()
    case 'sheep':
      return createSheep()
    case 'cow':
      return createCow()
    case 'pig':
      return createPig()
  }
}

/**
 * Billboard nameplate above an animal's head.
 *
 * Sprite (not a mesh) so it faces the camera without a per-frame quaternion
 * copy. Painted once at create — names don't change after roll/restore.
 */
export function createNameTag(name: string): THREE.Sprite {
  const fontSize = 44
  const padX = 22
  const padY = 10
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `800 ${fontSize}px Fredoka, "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif`
  ctx.font = font
  const textW = Math.ceil(ctx.measureText(name).width)
  canvas.width = Math.max(64, textW + padX * 2)
  canvas.height = fontSize + padY * 2

  // Resize clears the context — set font again before drawing.
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const r = canvas.height / 2

  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(canvas.width - r, 0)
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r)
  ctx.lineTo(canvas.width, canvas.height - r)
  ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height)
  ctx.lineTo(r, canvas.height)
  ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fillStyle = 'rgba(36, 24, 12, 0.78)'
  ctx.fill()

  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(36, 24, 12, 0.95)'
  ctx.strokeText(name, cx, cy + 1)
  ctx.fillStyle = '#fff6e4'
  ctx.fillText(name, cx, cy + 1)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  const worldH = 0.2
  sprite.scale.set((canvas.width / canvas.height) * worldH, worldH, 1)
  return sprite
}

/** Product icon id under /ui/icons — same art the HUD / animal card use. */
function productIconId(species: AnimalSpecies): string {
  switch (species) {
    case 'chicken':
      return 'egg'
    case 'sheep':
      return 'wool'
    case 'cow':
      return 'milk'
    case 'pig':
      return 'truffle'
  }
}

const productIconTextures = new Map<string, THREE.Texture>()
const productIconLoader = new THREE.TextureLoader()

function productIconTexture(id: string, onReady: (tex: THREE.Texture) => void) {
  const cached = productIconTextures.get(id)
  if (cached) {
    onReady(cached)
    return
  }
  productIconLoader.load(asset(`ui/icons/${id}.png`), (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace
    productIconTextures.set(id, tex)
    onReady(tex)
  })
}

/**
 * Floating ready marker — the same 2D product icon as the UI, not a 3D prop.
 *
 * Sprite so it billboards on its own (no camera quaternion copy needed).
 */
export function createProductBubble(species: AnimalSpecies): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 0,
  })
  const sprite = new THREE.Sprite(material)
  const size = 0.34
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 900

  productIconTexture(productIconId(species), (tex) => {
    material.map = tex
    material.opacity = 1
    material.needsUpdate = true
  })
  return sprite
}
