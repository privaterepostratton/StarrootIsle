import * as THREE from 'three'
import { ball, cyl, rng, PALETTE } from './style'

/**
 * World decoration. Everything is built from stacked spheres and rounded
 * boxes so the whole set shares one silhouette language with the character.
 */

/**
 * A single leaf card: a textured quad. The leaf-card albedo supplies the
 * pointed silhouette via alpha, so the geometry itself can stay a cheap plane.
 */

/**
 * Canopy tones, darkest at the bottom of a lobe and lightest on top.
 *
 * The whole ramp sits high on purpose. At forest density these tones stack into
 * a solid band across the horizon, and a ramp that bottoms out in near-black
 * turns that band into a wall rather than into trees.
 */

export function createBushModel(seed = 1): THREE.Group {
  const r = rng(seed)
  const g = new THREE.Group()
  const n = 3 + Math.floor(r() * 2)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rad = 0.24 + r() * 0.14
    const lump = ball(rad, r() > 0.5 ? PALETTE.leaf : PALETTE.leafDark, 1)
    lump.position.set(Math.cos(a) * 0.16, rad * 0.75, Math.sin(a) * 0.16)
    lump.scale.y = 0.82
    g.add(lump)
  }
  return g
}

export function createRockModel(seed = 1): THREE.Group {
  const r = rng(seed)
  const g = new THREE.Group()
  const main = ball(0.32 + r() * 0.16, PALETTE.stone, 0)
  main.scale.set(1, 0.72, 0.9)
  main.rotation.set(r(), r() * 6, r())
  main.position.y = 0.18
  g.add(main)
  const chip = ball(0.16, PALETTE.stoneDark, 0)
  chip.position.set(0.3, 0.1, 0.16)
  chip.rotation.set(r(), r() * 6, r())
  g.add(chip)
  return g
}

export function createFlowerModel(color: number, seed = 1): THREE.Group {
  const r = rng(seed)
  const g = new THREE.Group()
  const stem = cyl(0.012, 0.016, 0.2, PALETTE.leafDark, 5)
  stem.position.y = 0.1
  g.add(stem)
  const centre = ball(0.035, PALETTE.gold, 1)
  centre.position.y = 0.21
  g.add(centre)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const petal = ball(0.042, color, 1)
    petal.scale.set(1, 0.4, 1)
    petal.position.set(Math.cos(a) * 0.055, 0.208, Math.sin(a) * 0.055)
    g.add(petal)
  }
  g.rotation.y = r() * Math.PI * 2
  return g
}

/** One post-and-rail fence section, 2 world units long, origin at its centre. */
