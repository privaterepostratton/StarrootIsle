import * as THREE from 'three'
import { block, cyl, PALETTE } from './style'
import type { Bridge } from '../game/terrain'

/**
 * Plank bridge sized to a Bridge record. Deck planks run across the span so
 * the direction of travel is obvious from the isometric camera, and the
 * support posts drop far enough to reach the riverbed at any depth.
 */
export function createBridgeModel(b: Bridge): THREE.Group {
  const g = new THREE.Group()
  // Work in local space where +Z is always the direction of travel.
  const span = b.along === 'z' ? b.hd * 2 : b.hw * 2
  const width = b.along === 'z' ? b.hw * 2 : b.hd * 2

  const deck = new THREE.Group()
  deck.position.y = b.y
  g.add(deck)

  const plankCount = Math.max(6, Math.round(span / 0.55))
  const plankDepth = span / plankCount
  for (let i = 0; i < plankCount; i++) {
    const plank = block(width, 0.14, plankDepth * 0.86, i % 2 ? PALETTE.wood : PALETTE.woodDark, 0.03)
    plank.position.z = -span / 2 + plankDepth * (i + 0.5)
    deck.add(plank)
  }

  // Stringers under the deck give it visible thickness from the side.
  for (const sx of [-1, 1]) {
    const beam = block(0.16, 0.22, span, PALETTE.woodDark, 0.04)
    beam.position.set(sx * (width / 2 - 0.12), -0.16, 0)
    deck.add(beam)
  }

  // Railings and posts.
  const postCount = 4
  for (const sx of [-1, 1]) {
    for (let i = 0; i < postCount; i++) {
      const t = i / (postCount - 1)
      const z = -span / 2 + 0.5 + t * (span - 1.0)
      const post = block(0.16, 0.9, 0.16, PALETTE.woodDark, 0.04)
      post.position.set(sx * (width / 2 - 0.1), 0.45, z)
      deck.add(post)

      // Support piles reaching down into the channel.
      const pile = cyl(0.11, 0.13, 4.2, PALETTE.woodDark, 6)
      pile.position.set(sx * (width / 2 - 0.1), -2.2, z)
      deck.add(pile)
    }
    const rail = block(0.1, 0.12, span - 0.6, PALETTE.wood, 0.03)
    rail.position.set(sx * (width / 2 - 0.1), 0.86, 0)
    deck.add(rail)
  }

  g.position.set(b.x, 0, b.z)
  if (b.along === 'x') g.rotation.y = Math.PI / 2
  return g
}

/** Reeds for lake and river shorelines. */
export function createReedsModel(seed = 1): THREE.Group {
  const g = new THREE.Group()
  let s = seed >>> 0
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)

  const n = 4 + Math.floor(rand() * 4)
  for (let i = 0; i < n; i++) {
    const h = 0.55 + rand() * 0.65
    const stalk = cyl(0.02, 0.03, h, 0x6a9c3c, 5)
    stalk.position.set((rand() - 0.5) * 0.55, h / 2, (rand() - 0.5) * 0.55)
    stalk.rotation.z = (rand() - 0.5) * 0.35
    g.add(stalk)
    if (rand() > 0.45) {
      const head = cyl(0.045, 0.045, 0.2, 0x8a6a3a, 5)
      head.position.set(stalk.position.x, h + 0.08, stalk.position.z)
      g.add(head)
    }
  }
  return g
}

/** Lily pad cluster that floats on a lake surface. */
export function createLilyPadModel(seed = 1): THREE.Group {
  const g = new THREE.Group()
  let s = seed >>> 0
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)

  const n = 2 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const r = 0.24 + rand() * 0.2
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(r, 9, rand() * 6, Math.PI * 1.82),
      new THREE.MeshLambertMaterial({ color: rand() > 0.5 ? 0x4a9c46 : 0x3d8a3a }),
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set((rand() - 0.5) * 1.5, 0.03 + i * 0.004, (rand() - 0.5) * 1.5)
    g.add(pad)
  }
  return g
}
