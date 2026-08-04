import * as THREE from 'three'
import { asset } from '../core/assets'

/**
 * Equirectangular sky dome.
 *
 * Replaces the flat `scene.background` colour with a painted panorama. Day and
 * weather tint it via `setTint` (MeshBasicMaterial multiply) the same way the
 * distant ranges are driven — fog keeps its own Colour for aerial haze.
 */

let map: THREE.Texture | null = null

export async function loadSkyTexture(): Promise<THREE.Texture> {
  if (map) return map
  const loader = new THREE.TextureLoader()
  map = await new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      asset('textures/sky.png'),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.mapping = THREE.EquirectangularReflectionMapping
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      reject,
    )
  })
  return map
}

export class Skybox {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial

  constructor(texture: THREE.Texture) {
    // Inside the camera far plane (480) so the dome is never clipped.
    const geo = new THREE.SphereGeometry(420, 64, 32)
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.name = 'skybox'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -2
    // Nudge so the painted sun sits nearer the game's daytime key light.
    this.mesh.rotation.y = Math.PI * 0.55
  }

  /** Flat multiply — white at midday, warm at dusk, deep at night. */
  setTint(color: THREE.Color) {
    this.material.color.copy(color)
  }

  /** Keep the dome centred on the camera so the far plane never clips it. */
  follow(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position)
  }
}
