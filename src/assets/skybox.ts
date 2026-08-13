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

/** Dome radius. Shared with the horizon-band shader, which normalises by it. */
const RADIUS = 420

export class Skybox {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial
  /**
   * Warm low cloud at the horizon — the isle opening's dawn sky.
   *
   * `setTint` can only ever multiply the whole painted panorama by one colour,
   * which moves the *entire* sky together: push it warm enough to read as dawn
   * and the zenith goes peach too, which looks like a filter rather than like a
   * sunrise. A real dawn is a warm deck low down under a sky that is still
   * cool. This pair of uniforms lays that band in, and at zero strength the
   * dome renders exactly as it did before — which is what the ordinary day
   * cycle sets it to.
   */
  private readonly horizonColor = { value: new THREE.Color(1, 1, 1) }
  private readonly horizonAmount = { value: 0 }

  constructor(texture: THREE.Texture) {
    // Inside the camera far plane (480) so the dome is never clipped.
    const geo = new THREE.SphereGeometry(RADIUS, 64, 32)
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHorizon = this.horizonColor
      shader.uniforms.uHorizonAmt = this.horizonAmount
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying float vDomeY;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n  vDomeY = position.y / ${RADIUS.toFixed(1)};`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'uniform vec3 uHorizon;\nuniform float uHorizonAmt;\nvarying float vDomeY;\nvoid main() {',
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          // A deck, not a gradient: the band holds nearly full strength up to
          // a few degrees above the horizon and then falls away fast, which is
          // what gives low cloud an edge instead of an airbrushed glow.
          float deck = smoothstep(0.30, 0.015, vDomeY);
          float amt = deck * uHorizonAmt;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uHorizon * 1.35 + uHorizon * 0.16, amt);
          `,
        )
    }
    this.material.customProgramCacheKey = () => 'skybox-horizon'
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

  /**
   * Warm low cloud at the horizon. `strength` 0 restores the plain dome, so the
   * ordinary day cycle only has to call this with 0 to undo an opening.
   */
  setHorizonBand(color: THREE.Color, strength: number) {
    this.horizonColor.value.copy(color)
    this.horizonAmount.value = Math.min(1, Math.max(0, strength))
  }

  /** Keep the dome centred on the camera so the far plane never clips it. */
  follow(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position)
  }
}
