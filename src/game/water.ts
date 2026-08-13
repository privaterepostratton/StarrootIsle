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

/** Sunlight on water, with the hue taken out. See `update` for why. */
const GLINT_WARM_WHITE = new THREE.Color(0xfff6e2)

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
    // A long ocean swell under the two crossing wind waves. The first pass had
    // only the short ones, and a sea with no swell in it is a lake: the horizon
    // sat dead flat and the whole plane read as a sheet of glass.
    float swell = sin(pos.x * 0.055 - uTime * 0.52) * 0.13
                + sin((pos.x * 0.7 + pos.z) * 0.048 + uTime * 0.37) * 0.09;
    float wave =
        sin(pos.x * 0.20 + uTime * 1.10) * 0.065
      + cos(pos.z * 0.17 + uTime * 0.85) * 0.065
      + sin((pos.x + pos.z) * 0.42 + uTime * 1.90) * 0.026;
    // The swell fades out further from shore than the chop does, so it never
    // pumps the waterline where the surf band is drawn.
    pos.y += wave * shore + swell * smoothstep(0.6, 3.2, aDepth);

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

    /*
     * Body colour: turquoise in the shallows deepening to blue.
     *
     * The ramp is short on purpose. Spread over several metres of depth it gives
     * a smooth wash from cyan to blue, which is what real water does and what
     * stylised water conspicuously does not — the look this is after reads as
     * two colours meeting in a band you can point at, not as a gradient. Ending
     * it inside a couple of units puts that band right where the bed shelves,
     * which is where the eye already expects the change.
     */
    /*
     * ...and a second driver: distance.
     *
     * Depth alone put the band wherever the bed happened to shelve, and off
     * this beach the bed shelves slowly — so from a low camera the entire
     * visible sea came back as one flat sheet of milky cyan with the azure
     * nowhere on screen. The spec asks for turquoise across the first stretch
     * of shallows falling to azure by the middle distance, which is a statement
     * about the *picture*, not about the bathymetry. Distance from the viewer
     * delivers that read on any bed, and it doubles as the aerial perspective
     * an open sea needs to recede at all.
     */
    // Gated on depth so it cannot reach the valley's ponds: a shallow pool
    // stays its own colour however far away it is standing, and only water with
    // real depth under it takes the distance ramp.
    float far = smoothstep(20.0, 55.0, length(vWorldPos.xz - uCameraPos.xz))
              * smoothstep(0.35, 1.7, vDepth);
    float band = max(smoothstep(0.8, 2.3, vDepth), far);
    vec3 waterColor = mix(uShallowColor, uDeepColor, band);

    /*
     * Translucency — how much of the bed survives.
     *
     * Beer-Lambert falloff, but a steep one. At the gentle rate this used to
     * run, water under a metre of depth was mostly the sand bed showing
     * through, so the whole shelf between the surf and the drop-off came out
     * pale ivory-blue and the turquoise never appeared anywhere on screen:
     * by the depth at which the body colour finally won, the band ramp above
     * had already carried it halfway to azure. Absorbing faster hands the
     * shelf to the shallow colour while it is still turquoise, which is what
     * makes the band a band. The very edge still reads clear — at a couple of
     * centimetres of depth this is near zero either way.
     */
    float absorb = 1.0 - exp(-vDepth * 2.6);
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
    // The wash was seventeen pixels of whitening laid over the shallows, which
    // on a low beach camera (where fwidth is large) spread into the pale haze
    // that was eating the turquoise. Narrower and brighter: a hot foam edge
    // right on the waterline, and the colour left alone a pixel behind it.
    float wash = 1.0 - smoothstep(0.0, depthPx * 8.0, vDepth);
    /*
     * Break the foam edge up.
     *
     * Drawn solid, the surf band comes out as a single unbroken white stroke
     * ruled along the waterline — the tell of a cartoon water plane, and the
     * one thing on this beach that looked *drawn on* rather than lit. Real surf
     * arrives in patches. A high-frequency crossing pattern, thresholded soft
     * and multiplied into the band, dissolves the stroke into lace and moves it
     * with the water instead of pinning it to the coastline.
     */
    float lace = sin(vWorldPos.x * 7.3 + uTime * 1.6) * sin(vWorldPos.z * 6.1 - uTime * 1.1);
    float broken = smoothstep(-0.6, 0.4, lace);
    float surfEdge = clamp(surf * (0.42 + 0.86 * broken), 0.0, 1.0);
    color = mix(color, uFoamColor, clamp(surfEdge * 0.95 + wash * 0.11, 0.0, 1.0));

    /*
     * Painted ripple streaks.
     *
     * The single biggest thing separating this surface from the reference art.
     * Everything above shades the water *physically* — refraction, fresnel, a
     * specular glint — and the result is smooth, which at this camera distance
     * means featureless: a flat sheet of blue with a lit edge. Hand-painted
     * water of this kind carries marks on it, short light dashes that give the
     * surface a scale and a direction to read.
     *
     * Built from a wave whose phase is itself wavy, so the streaks meander
     * instead of ruling straight lines, then cut into dashes across the other
     * axis. Both are thresholded hard rather than blended: a soft streak is just
     * more smooth shading, and the crispness is the whole point.
     *
     * Damped in the shallows so it never fights the surf line, and faded out in
     * deep water where the reference keeps its darkest areas plain.
     */
    float streakPhase = vWorldPos.x * 1.35 + sin(vWorldPos.z * 0.62 + uTime * 0.5) * 2.6 + uTime * 0.75;
    float streak = smoothstep(0.80, 0.99, sin(streakPhase));
    float dash = smoothstep(0.25, 0.85, sin(vWorldPos.z * 4.3 - uTime * 0.35) * 0.5 + 0.5);
    float streakDepth = smoothstep(0.25, 1.4, vDepth) * (1.0 - smoothstep(3.5, 9.0, vDepth));
    color = mix(color, uFoamColor, streak * dash * streakDepth * 0.42 * (1.0 - surf));

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
        // Isle-opening palette (spec §1): banded turquoise shallows falling to
        // azure. Greener and a touch darker than the old cyan so the band reads
        // as tropical water against the ivory sand rather than as swimming-pool
        // glass; authored slightly desaturated because the postfx grade
        // multiplies saturation by 1.2.
        uShallowColor: { value: new THREE.Color(0x3ec8c0) },
        // Not near-black. A deep tone this dark plus any reflection at all leaves
        // the middle of a lake reading as a hole rather than as water.
        //
        // Azure rather than the old primary blue: a lake is small enough that
        // its colour is mostly borrowed from the sky, but an open sea fills a
        // third of the frame and has to carry a colour of its own — this one
        // sits between the shallows and the horizon instead of shouting.
        uDeepColor: { value: new THREE.Color(0x1b6fa8) },
        /*
         * Foam, warm rather than cold.
         *
         * A blue-white foam line is correct under a midday sky and wrong under
         * this one: the opening is pinned just after dawn, everything on the
         * beach is lit warm, and a cold rim on the waterline read as a chalk
         * outline drawn between the sand and the sea. Warm off-white also
         * gives the foam somewhere to be *brighter* than the ivory sand it
         * breaks onto, which is what makes the edge legible.
         */
        uFoamColor: { value: new THREE.Color(0xf6f2e4) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uCameraPos: { value: new THREE.Vector3() },
        /*
         * Reflectivity down from 0.85.
         *
         * At that level the surface was very nearly a mirror, so every body of
         * water took the sky's colour and came out pale — fine on a pond read as
         * a bright patch, wrong on an ocean, where it left the whole seaward half
         * of the map looking washed out rather than blue. Lower reflectivity lets
         * the body colour above do the work; fresnel still swings it back toward
         * a mirror at grazing angles, which is where a reflection is convincing
         * anyway.
         */
        /*
         * Reflectivity down again, 0.55 → 0.34, for the opening's beach shot.
         *
         * From a low over-the-shoulder camera almost the entire sea is seen at
         * a grazing angle, which is exactly where fresnel swings the surface
         * toward mirror — so the frame filled with reflected dawn sky and the
         * water came out pale white-blue near the shore and flat navy further
         * out, with no palette of its own anywhere. The body colour has to win
         * that argument: it is carrying the spec's turquoise-to-azure band, and
         * a mirror carries nothing. Enough reflection is left that the surface
         * still brightens toward the horizon and the sun path still lands.
         */
        uReflectivity: { value: 0.34 },
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
    /*
     * The glint takes the sun's *brightness* but not its hue.
     *
     * At the opening's pinned dawn the key light is `#FFC48C`, and a specular
     * highlight in that colour laid a saturated gold hotspot on the water two
     * beats before the lotto fires. Lotto gold is the one reserved colour in
     * the game — the first time the player sees it, it has to mean luck — so a
     * gold sun path on the sea is not a small art note, it is the reserved-
     * colour rule breaking before the rule is ever established.
     *
     * Warm white keeps the highlight reading as sunlight on water and leaves
     * the 45–55 hue band to the odd tomato.
     */
    u.uSunColor.value
      .copy(sun.color)
      .lerp(GLINT_WARM_WHITE, 0.78)
      .multiplyScalar(Math.min(1, sun.intensity * 0.4))
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
