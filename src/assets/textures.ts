import * as THREE from 'three'
import { asset } from '../core/assets'

/**
 * Ground albedo maps generated for the valley.
 *
 * Loaded once at boot and cloned per use so each consumer can set its own
 * repeat without fighting over a shared Texture.repeat vector.
 */

export interface GroundTextures {
  grass: THREE.Texture
  soil: THREE.Texture
  dirt: THREE.Texture
  sand: THREE.Texture
  leaf: THREE.Texture
  pine: THREE.Texture
  /** Single leaf glyph with alpha — for broadleaf cards. */
  leafCard: THREE.Texture
}

/** Soft sprites for ambience (falling leaves, pollen, fireflies, snow). */
export interface ParticleTextures {
  leaf: THREE.Texture
  pollen: THREE.Texture
  firefly: THREE.Texture
  snow: THREE.Texture
}

let cache: GroundTextures | null = null
let particleCache: ParticleTextures | null = null

function loadOne(
  loader: THREE.TextureLoader,
  url: string,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = wrap
        tex.wrapT = wrap
        tex.anisotropy = 4
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      reject,
    )
  })
}

/** Fetch every ground/foliage albedo. Safe to call repeatedly — resolves from cache. */
export async function loadGroundTextures(): Promise<GroundTextures> {
  if (cache) return cache
  const loader = new THREE.TextureLoader()
  const [grass, soil, dirt, sand, leaf, pine, leafCard] = await Promise.all([
    loadOne(loader, asset('textures/grass.png')),
    loadOne(loader, asset('textures/soil.png')),
    loadOne(loader, asset('textures/dirt.png')),
    loadOne(loader, asset('textures/sand.png')),
    loadOne(loader, asset('textures/leaf.png')),
    loadOne(loader, asset('textures/pine.png')),
    loadOne(loader, asset('textures/leaf-card.png'), THREE.ClampToEdgeWrapping),
  ])
  cache = { grass, soil, dirt, sand, leaf, pine, leafCard }
  return cache
}

export async function loadParticleTextures(): Promise<ParticleTextures> {
  if (particleCache) return particleCache
  const loader = new THREE.TextureLoader()
  const clamp = THREE.ClampToEdgeWrapping
  const [leaf, pollen, firefly, snow] = await Promise.all([
    loadOne(loader, asset('textures/particles/leaf.png'), clamp),
    loadOne(loader, asset('textures/particles/pollen.png'), clamp),
    loadOne(loader, asset('textures/particles/firefly.png'), clamp),
    loadOne(loader, asset('textures/particles/snow.png'), clamp),
  ])
  particleCache = { leaf, pollen, firefly, snow }
  return particleCache
}

export function getGroundTextures(): GroundTextures {
  if (!cache) throw new Error('Ground textures not loaded — call loadGroundTextures() first')
  return cache
}

export function getParticleTextures(): ParticleTextures {
  if (!particleCache) throw new Error('Particle textures not loaded — call loadParticleTextures() first')
  return particleCache
}

/** Independent copy with its own UV repeat, for a single material. */
export function tiled(source: THREE.Texture, repeat: number): THREE.Texture {
  const tex = source.clone()
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.repeat.set(repeat, repeat)
  tex.needsUpdate = true
  return tex
}
