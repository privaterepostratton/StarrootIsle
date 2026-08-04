import * as THREE from 'three'

/**
 * Shared art-direction layer for every procedural model.
 *
 * The Animal Crossing look is: saturated flat-ish colours, soft rounded
 * silhouettes, no specular hotspots, and geometry that reads at a glance from
 * a fixed isometric angle. Everything here exists to keep the whole asset set
 * consistent — models should pull colours from PALETTE rather than inventing
 * hex codes, so a palette tweak restyles the entire game.
 */

export const PALETTE = {
  grass: 0x7ec850,
  grassDark: 0x5fa83c,
  soil: 0xa8683f,
  soilTilled: 0x9a5f3c,
  soilWet: 0x6f3d26,
  bark: 0x8a6042,
  barkDark: 0x6b4a33,
  leaf: 0x59b544,
  leafLight: 0x7bd062,
  leafDark: 0x469633,
  stone: 0x9aa3ab,
  stoneDark: 0x7b848c,
  wood: 0xc08a4e,
  woodDark: 0x9a6a3a,
  water: 0x4fb8e8,
  skin: 0xf2c9a0,
  hair: 0x5c3a24,
  shirt: 0x4f9de8,
  pants: 0x3b5a8c,
  shoe: 0x6b4a33,
  canvasRed: 0xe05c4a,
  canvasCream: 0xf5e6c8,
  gold: 0xf2c14e,
  white: 0xf7f3ea,
  black: 0x2b2620,
} as const

const materialCache = new Map<string, THREE.MeshLambertMaterial>()

/**
 * Flat-shaded lambert. Lambert (not standard) is deliberate: no roughness or
 * metalness means no specular highlight, which is what keeps the toy-plastic
 * look and keeps the frame cost near zero with a few hundred small meshes.
 * Cached by colour so the whole world shares a handful of materials.
 */
export function mat(color: number, opts: { flat?: boolean; emissive?: number } = {}) {
  const key = `${color}|${opts.flat ? 1 : 0}|${opts.emissive ?? 0}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: opts.flat ?? false,
      emissive: opts.emissive ?? 0x000000,
    })
    materialCache.set(key, m)
  }
  return m
}

/**
 * Box with bevelled edges, approximated by scaling a low-segment sphere-ish
 * shape. Rounded corners are the single biggest contributor to the "cute"
 * read — hard 90° box corners look like programmer art at this scale.
 */
export function roundedBox(w: number, h: number, d: number, radius = 0.08) {
  const r = Math.min(radius, w / 2, h / 2, d / 2)
  const shape = new THREE.Shape()
  const x = w / 2 - r
  const y = h / 2 - r
  shape.moveTo(-x, -h / 2)
  shape.lineTo(x, -h / 2)
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -y)
  shape.lineTo(w / 2, y)
  shape.quadraticCurveTo(w / 2, h / 2, x, h / 2)
  shape.lineTo(-x, h / 2)
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y)
  shape.lineTo(-w / 2, -y)
  shape.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2)

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d - r * 2,
    bevelEnabled: true,
    bevelSize: r,
    bevelThickness: r,
    bevelSegments: 2,
    curveSegments: 3,
  })
  geo.translate(0, 0, -(d - r * 2) / 2)
  geo.computeVertexNormals()
  return geo
}

/** Convenience: a rounded-box mesh that casts and receives shadow. */
export function block(w: number, h: number, d: number, color: number, radius = 0.08) {
  const m = new THREE.Mesh(roundedBox(w, h, d, radius), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Convenience: a low-poly sphere, the workhorse for foliage and heads. */
export function ball(r: number, color: number, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color, { flat: detail < 1 }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function cyl(rTop: number, rBot: number, h: number, color: number, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/**
 * Layer for small detail — pebbles, flowers, clover, plot pads, reeds, UI
 * markers. The main camera renders it; the water's reflection and refraction
 * cameras do not. Those buffers are 512px and sampled through a distorted UV,
 * so a pebble contributes nothing but draw calls, and there are thousands of
 * them.
 */
export const MINOR_LAYER = 1

/** Move an object and all its descendants onto a single layer. */
export function setLayer(obj: THREE.Object3D, layer: number) {
  obj.layers.set(layer)
  obj.traverse((child) => child.layers.set(layer))
  return obj
}

/** Deterministic pseudo-random so world decoration is identical every reload. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}
