import * as THREE from 'three'
import { MINOR_LAYER } from '../assets/style'
import { WORLD_SIZE, WATER_LEVEL, heightAt } from './terrain'

/**
 * Stylised water with real reflection and refraction.
 *
 * Three passes make this work:
 *   1. Refraction — the scene rendered from the main camera with the water
 *      hidden, so the shader can sample what is actually underneath and offset
 *      it by the wave normal. That offset is the refraction.
 *   2. Reflection — the scene rendered from a camera mirrored through the
 *      water plane, clipped to above the waterline so submerged geometry
 *      cannot leak into the mirror.
 *   3. The main pass, where the shader combines them.
 *
 * Depth is *not* read from a depth buffer. The water plane is static and the
 * terrain is an analytic height function, so each vertex carries a precomputed
 * `aDepth` attribute — how far the bed sits below the surface at that point.
 * That single attribute drives the shallow/deep colour ramp, how translucent
 * the water is, how strong the refraction offset gets, and where foam forms.
 * It costs nothing per frame and never goes out of sync with the terrain.
 */

/** Reflection and refraction buffers. Deliberately below screen resolution:
 *  both are sampled through a wave-distorted UV, so fine detail is destroyed
 *  anyway, and two extra full-resolution scene renders per frame would dominate
 *  the frame budget. 384 was low enough that the refracted bed read as a blur
 *  rather than as something seen through moving water. */
const RT_WIDTH = 640
const RT_HEIGHT = 640

/** Rebuild the reflection/refraction buffers every Nth frame. They feed a
 *  wave-distorted lookup on a slowly-moving camera, so halving their rate is
 *  invisible in motion and saves a full scene pass per frame. */
const AUX_INTERVAL = 2

const vertexShader = /* glsl */ `
  attribute float aDepth;

  uniform float uTime;

  varying float vDepth;
  varying vec3 vWorldPos;
  varying vec4 vClipPos;
  varying vec4 vReflectPos;

  uniform mat4 uTextureMatrix;

  void main() {
    vDepth = aDepth;

    vec3 pos = position;

    // Two crossing swells plus a finer ripple. Amplitude fades out in the
    // shallows so the surface doesn't visibly clip through the shoreline.
    float shore = smoothstep(0.0, 1.2, aDepth);
    float wave =
        sin(pos.x * 0.20 + uTime * 1.10) * 0.055
      + cos(pos.z * 0.17 + uTime * 0.85) * 0.055
      + sin((pos.x + pos.z) * 0.42 + uTime * 1.90) * 0.022;
    pos.y += wave * shore;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;

    vReflectPos = uTextureMatrix * worldPos;
    vClipPos = projectionMatrix * viewMatrix * worldPos;
    gl_Position = vClipPos;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uReflection;
  uniform sampler2D uRefraction;
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uCameraPos;
  uniform float uReflectivity;

  varying float vDepth;
  varying vec3 vWorldPos;
  varying vec4 vClipPos;
  varying vec4 vReflectPos;

  /** Analytic derivative of the same swells used in the vertex stage, at a
      finer scale — this is the normal that drives refraction and specular. */
  vec3 waveNormal(vec2 p, float t) {
    float dx =
        cos(p.x * 0.55 + t * 1.4) * 0.105
      + cos((p.x + p.y) * 1.10 + t * 2.3) * 0.060
      + cos(p.x * 1.90 - t * 1.1) * 0.030;
    float dz =
        sin(p.y * 0.62 + t * 1.2) * 0.105
      + cos((p.x + p.y) * 1.10 + t * 2.3) * 0.060
      + sin(p.y * 2.10 + t * 1.4) * 0.030;
    return normalize(vec3(-dx, 1.0, -dz));
  }

  void main() {
    vec3 normal = waveNormal(vWorldPos.xz, uTime);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    // Screen-space UV of this fragment, for sampling the refraction buffer.
    vec2 screenUv = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;

    /**
     * Depth change across one pixel.
     *
     * This is what lets the shoreline bands below be a constant width *on
     * screen* rather than a constant width in depth. A gentle lake bed drops
     * only a few centimetres per metre, so a band defined as "shallower than
     * 0.4" spread across many metres of shore and read as a fog bank instead of
     * as surf. Derived per fragment, so it stays right at any distance and on
     * any gradient.
     */
    float depthPx = max(fwidth(vDepth), 1e-4);

    // Deeper water bends light more; in the shallows the offset is damped to
    // near zero so the bed does not visibly slide against the shoreline.
    float depthFade = clamp(vDepth / 2.2, 0.0, 1.0);
    vec2 distortion = normal.xz * (0.05 + 0.14 * depthFade);

    vec3 refracted = texture2D(uRefraction, clamp(screenUv + distortion, 0.001, 0.999)).rgb;

    // uTextureMatrix already bakes in the 0.5 scale and bias, so the projective
    // divide alone lands in 0..1 — applying the bias again here would squash
    // the whole reflection into the middle quarter of the buffer.
    vec2 reflectUv = vReflectPos.xy / vReflectPos.w;
    vec2 rawReflectUv = reflectUv + distortion * 0.6;

    /*
     * Fade the reflection out at the buffer's edge instead of clamping into it.
     *
     * A planar reflection only covers what the reflection camera saw, so this UV
     * genuinely leaves 0..1 — and clamping it there does not stop the sample, it
     * pins it to the border texel and smears that single row or column across
     * everything beyond. Against a wide lake that reads as a hard line ruled
     * across the water at exactly the row where the clamp begins.
     *
     * Measuring how far inside the buffer the sample is lets the reflection ramp
     * down to nothing over a small margin instead, so the surface falls back to its
     * own body colour with no seam to see. The clamp stays on the actual fetch —
     * it still prevents edge bleed — but by then its result is being faded out
     * anyway.
     */
    vec2 reflectEdge = min(rawReflectUv, 1.0 - rawReflectUv);
    float inBuffer = smoothstep(0.0, 0.05, min(reflectEdge.x, reflectEdge.y));
    vec3 reflected = texture2D(uReflection, clamp(rawReflectUv, 0.001, 0.999)).rgb;

    // Body colour: turquoise in the shallows deepening to blue.
    vec3 waterColor = mix(uShallowColor, uDeepColor, clamp(vDepth / 3.4, 0.0, 1.0));

    // Translucency — how much of the bed survives. Beer-Lambert style falloff
    // so shallow edges read as clear and deep centres as solid.
    float absorb = 1.0 - exp(-vDepth * 0.85);
    vec3 body = mix(refracted, waterColor, absorb);

    /**
     * Fresnel: glancing angles turn mirror-like, steep angles stay see-through.
     *
     * Taken from a much flatter normal than the one driving refraction. Fresnel
     * follows the *overall* orientation of the surface; feeding it the fine
     * ripple normal turns the whole lake into a mirror the moment the ripples
     * are strong enough to be worth refracting through, and the body colour
     * disappears under it.
     */
    vec3 macroNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, 0.3));
    float fresnel = pow(1.0 - clamp(dot(macroNormal, viewDir), 0.0, 1.0), 4.0);
    fresnel = clamp(fresnel * uReflectivity + 0.03, 0.0, 1.0);
    // No reflection where the buffer has nothing to give — see inBuffer above.
    fresnel *= inBuffer;
    vec3 color = mix(body, reflected, fresnel);

    // Sun glint off the wave normals.
    vec3 halfVec = normalize(uSunDirection + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 220.0);
    color += uSunColor * spec * 1.6;

    /**
     * Shoreline, in two bands.
     *
     * A tight surf line right at the waterline, broken up by a moving ripple so
     * it reads as breaking water rather than as an outline, and behind it a
     * wider, much fainter wash that stands in for wet sand. Both are scaled by
     * depthPx, which is what keeps them looking like surf instead of the soft
     * smear a fixed depth threshold produced.
     */
    float ripple = sin(vWorldPos.x * 3.4 + uTime * 1.8) * cos(vWorldPos.z * 3.1 - uTime * 1.4);
    float surf = 1.0 - smoothstep(0.0, depthPx * (5.0 + ripple * 2.2), vDepth);
    float wash = 1.0 - smoothstep(0.0, depthPx * 17.0, vDepth);
    color = mix(color, uFoamColor, clamp(surf * 0.85 + wash * 0.16, 0.0, 1.0));

    // Fade the very edge out so the plane never shows a hard rim where it meets
    // dry land — but over a couple of pixels, not a couple of metres.
    float alpha = smoothstep(0.0, depthPx * 2.5, vDepth);

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

export class Water {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial

  private readonly reflectionRT: THREE.WebGLRenderTarget
  private readonly refractionRT: THREE.WebGLRenderTarget
  private readonly reflectionCamera = new THREE.PerspectiveCamera()
  private readonly textureMatrix = new THREE.Matrix4()

  // Scratch objects reused every frame — this runs three times per frame and
  // must not allocate.
  private readonly normal = new THREE.Vector3(0, 1, 0)
  private readonly plane = new THREE.Plane()
  private readonly reflectMatrix = new THREE.Matrix4()
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL + 0.02)
  private frame = 0

  /** Segments across the plane. `aDepth` is per-vertex and interpolated, so this
   *  is what decides how closely the surf line follows the actual bed contour
   *  rather than the triangle edges. */
  constructor(segments = 320) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments)
    geo.rotateX(-Math.PI / 2)

    // Precompute how deep the bed is under every vertex.
    const pos = geo.attributes.position as THREE.BufferAttribute
    const depths = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      depths[i] = WATER_LEVEL - heightAt(pos.getX(i), pos.getZ(i))
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1))

    const rtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
    }
    this.reflectionRT = new THREE.WebGLRenderTarget(RT_WIDTH, RT_HEIGHT, rtOptions)
    this.refractionRT = new THREE.WebGLRenderTarget(RT_WIDTH, RT_HEIGHT, rtOptions)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uReflection: { value: this.reflectionRT.texture },
        uRefraction: { value: this.refractionRT.texture },
        uTextureMatrix: { value: this.textureMatrix },
        uShallowColor: { value: new THREE.Color(0x6fdedc) },
        // Not near-black. A deep tone this dark plus any reflection at all leaves
        // the middle of a lake reading as a hole rather than as water.
        uDeepColor: { value: new THREE.Color(0x1f6fa8) },
        uFoamColor: { value: new THREE.Color(0xeaf7fb) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uCameraPos: { value: new THREE.Vector3() },
        uReflectivity: { value: 0.85 },
      },
    })

    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.position.y = WATER_LEVEL
    this.mesh.renderOrder = 1
    // The plane is repositioned by its shader, not its matrix, so the cached
    // bounding sphere is fine — but it spans the world and is always in view.
    this.mesh.frustumCulled = false
  }

  /**
   * Render the reflection and refraction buffers, then update uniforms.
   * Must be called before the main scene render each frame.
   */
  update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    time: number,
    sun: THREE.DirectionalLight,
  ) {
    const u = this.material.uniforms
    u.uTime.value = time
    u.uSunColor.value.copy(sun.color).multiplyScalar(Math.min(1, sun.intensity * 0.4))
    u.uSunDirection.value.copy(sun.position).sub(sun.target.position).normalize()
    camera.getWorldPosition(u.uCameraPos.value)

    if (this.frame++ % AUX_INTERVAL !== 0) return

    const prevTarget = renderer.getRenderTarget()
    const prevClipping = renderer.clippingPlanes
    const prevShadowAuto = renderer.shadowMap.autoUpdate

    // Hide the water for both auxiliary passes — sampling itself would give a
    // feedback loop, and the refraction buffer must contain only the bed.
    this.mesh.visible = false
    // Shadow maps are regenerated on every render() call. The main pass will
    // rebuild them a moment from now, so doing it twice more here is pure waste.
    renderer.shadowMap.autoUpdate = false
    // Skip the thousands of pebbles, flowers and plot pads. They are invisible
    // at 512px through a distorted UV and cost most of the draw calls.
    camera.layers.disable(MINOR_LAYER)

    // --- refraction: the scene as the player sees it, minus the water -------
    renderer.setRenderTarget(this.refractionRT)
    renderer.clear()
    renderer.render(scene, camera)

    // --- reflection: mirrored camera, clipped to above the waterline --------
    this.buildReflectionCamera(camera)
    renderer.clippingPlanes = [this.clipPlane]
    renderer.setRenderTarget(this.reflectionRT)
    renderer.clear()
    renderer.render(scene, this.reflectionCamera)

    camera.layers.enable(MINOR_LAYER)
    renderer.shadowMap.autoUpdate = prevShadowAuto
    renderer.clippingPlanes = prevClipping
    renderer.setRenderTarget(prevTarget)
    this.mesh.visible = true
  }

  /**
   * Mirror the camera through the water plane and build the matrix that maps
   * a world position to a UV in the reflection buffer.
   */
  private buildReflectionCamera(camera: THREE.Camera) {
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.mesh.position)

    // Householder reflection about the plane. Applied on the *left* of the
    // camera's world matrix so the mirrored camera keeps its own orientation.
    const { x: nx, y: ny, z: nz } = this.plane.normal
    const d = this.plane.constant
    // prettier-ignore
    this.reflectMatrix.set(
      1 - 2 * nx * nx,    -2 * nx * ny,    -2 * nx * nz, -2 * nx * d,
         -2 * ny * nx, 1 - 2 * ny * ny,    -2 * ny * nz, -2 * ny * d,
         -2 * nz * nx,    -2 * nz * ny, 1 - 2 * nz * nz, -2 * nz * d,
                    0,               0,               0,           1,
    )

    const cam = this.reflectionCamera
    cam.matrixWorld.multiplyMatrices(this.reflectMatrix, camera.matrixWorld)
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    cam.projectionMatrix.copy((camera as THREE.PerspectiveCamera).projectionMatrix)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    // Reflection flips handedness; without this the mirrored render culls the
    // faces we actually want to see.
    cam.scale.set(1, -1, 1)

    // Maps world space -> reflection-buffer UV. The 0.5 scale/offset converts
    // clip space to texture space; the shader does the perspective divide.
    // prettier-ignore
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    )
    this.textureMatrix.multiply(cam.projectionMatrix)
    this.textureMatrix.multiply(cam.matrixWorldInverse)
  }

  dispose() {
    this.reflectionRT.dispose()
    this.refractionRT.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}
