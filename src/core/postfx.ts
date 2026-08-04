import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * Post-processing stack.
 *
 * Order matters and is not arbitrary:
 *   Render → GTAO → Bloom → Grade → Output
 *
 * Ambient occlusion has to run on the raw lit scene, before bloom smears
 * bright pixels across the contact shadows it just darkened. Grading runs
 * after bloom so the vignette darkens the glow too rather than sitting under
 * it. OutputPass is last because it owns tone mapping and the sRGB conversion —
 * with a composer in play the renderer must not do that itself, or everything
 * gets gamma-corrected twice and washes out.
 */

export type QualityLevel = 'low' | 'medium' | 'high'

/**
 * Resolution the composer renders at, as a multiple of CSS pixels.
 *
 * The composer's ratio — not the renderer's — is what the player actually sees:
 * once post-processing is on, the scene goes into an offscreen target sized by
 * *this*, and the renderer's own 2x cap stops mattering. That is why the game
 * looked soft on a phone whose device ratio is 3 while the renderer was
 * ostensibly set to 2.
 *
 * Raised across the board. The old ceiling of 1.5 was set against desktop
 * integrated graphics, where the frame cost is fill-rate bound and 1.5 is a fair
 * trade; a modern phone has the pixels and reads visibly cleaner for them, and
 * the adaptive step-down in main.ts is there to catch anything that cannot keep
 * up. Capped rather than uncapped because a 3x ratio on a large screen is four
 * times the fill of 1.5x for a difference nobody can see.
 */
const DPR_HIGH = 2
const DPR_MEDIUM = 1.35
const DPR_LOW = 1

/**
 * Warm colour grade plus a hint of vignette.
 *
 * This is where most of the "expensive" look actually comes from — a slight
 * saturation push reads as deliberate art direction, and it costs one
 * full-screen pass instead of the several that AO and bloom need.
 *
 * Contrast is applied as an S-curve rather than as a multiply about mid-grey.
 * A multiply is a straight line, so pushing it hard clips the highlights flat
 * and drives the shadows to black at the same rate — which is what makes a
 * "more contrast" tweak look harsh. The curve steepens the midtones while
 * rolling off both ends, so the picture gains punch and still keeps detail in
 * the sky and under the foliage.
 *
 * The warm shadow lift stays. The Animal Crossing daytime look has almost no
 * true black in it, and a cool lift plus a heavy vignette — the obvious
 * "cinematic" choices — are what made this scene read as overcast dusk at noon.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.16 },
    uSaturation: { value: 1.2 },
    /** Steepness of the S-curve. 1 is a straight line, higher is punchier. */
    uContrast: { value: 1.28 },
    // Warm, and weak. `uLift * (1 - color)` acts hardest on the darkest pixels,
    // so a saturated value here tints every shadow in the frame.
    uLift: { value: new THREE.Color(0x1d160e) },
    uGain: { value: new THREE.Color(0xfffcf4) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uLift;
    uniform vec3 uGain;
    varying vec2 vUv;

    /**
     * Contrast S-curve.
     *
     * Symmetric about mid-grey, steep through the midtones and flattening
     * towards both ends, so raising contrast does not clip the highlights or
     * crush the shadows the way a straight multiply does.
     */
    float scurve(float x, float k) {
      float t = clamp(x, 0.0, 1.0);
      float s = t < 0.5
        ? 0.5 * pow(2.0 * t, k)
        : 1.0 - 0.5 * pow(2.0 * (1.0 - t), k);
      return s;
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      // Roll anything overbright back in rather than letting the curve clip it,
      // so a bloom hotspot keeps some shape instead of becoming a flat patch.
      vec3 color = texel.rgb / (1.0 + max(vec3(0.0), texel.rgb - 1.0));

      // Lift/gain: warm the shadows, warm the highlights. A tiny split-tone
      // does more for perceived quality than any amount of extra saturation.
      color = color * uGain + uLift * (1.0 - color);

      color = vec3(scurve(color.r, uContrast), scurve(color.g, uContrast), scurve(color.b, uContrast));

      // Saturation after the curve, around perceptual luma rather than a flat
      // average, so greens do not blow out relative to the soil and sky.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Vignette on distance from centre, aspect-corrected via uv only — the
      // slight ovality on ultrawide is desirable, not a bug.
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * uVignette * 2.4;
      color *= clamp(vig, 0.0, 1.0);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
}

export class PostFX {
  readonly composer: EffectComposer
  private readonly target: THREE.WebGLRenderTarget
  private readonly gtao: GTAOPass
  private readonly bloom: UnrealBloomPass
  private readonly grade: ShaderPass

  quality: QualityLevel = 'high'

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly camera: THREE.Camera) {
    // The composer owns tone mapping from here on.
    renderer.toneMapping = THREE.NoToneMapping

    const size = renderer.getSize(new THREE.Vector2())

    /**
     * The composer's own render target, explicitly multisampled.
     *
     * MSAA here is not the default and matters: a composer renders the scene
     * into an offscreen target, so the renderer's own `antialias: true` stops
     * applying the moment post-processing is switched on, and every edge in the
     * game was aliased.
     *
     * The buffer stays 8-bit on purpose. A HalfFloatType target looks like the
     * obvious upgrade — linear, HDR headroom for the bloom to work from — but
     * combined with `samples` it makes UnrealBloomPass output pure black, which
     * takes the whole frame with it. Not worth chasing for a stylised game whose
     * brightest surface is a lantern; the anti-aliasing was the real win.
     */
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4 })
    this.composer = new EffectComposer(renderer, this.target)
    this.composer.setPixelRatio(Math.min(devicePixelRatio, DPR_HIGH))
    this.composer.setSize(size.x, size.y)

    this.composer.addPass(new RenderPass(scene, camera))

    // Ambient occlusion. This is what stops crops, animals and fences from
    // looking pasted onto the terrain — they get a contact shadow where they
    // meet the ground.
    // Kept light: enough to seat objects on the ground, not enough to smudge
    // the flat-shaded surfaces the whole look depends on.
    this.gtao = new GTAOPass(scene, camera, size.x, size.y)
    this.gtao.blendIntensity = 0.62
    this.gtao.updateGtaoMaterial({
      radius: 0.28,
      distanceExponent: 1.4,
      thickness: 1.0,
      scale: 1.0,
      samples: 12,
      screenSpaceRadius: false,
    })
    this.composer.addPass(this.gtao)

    // Deliberately high threshold: only the sparkles on ripe crops, sun glints
    // on water, lit lanterns and rare-crop tints should bloom. A low threshold
    // turns a bright green field into a glowing mess, so the strength goes up
    // rather than the threshold coming down.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.58, 0.7, 0.8)
    this.composer.addPass(this.bloom)

    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)

    this.composer.addPass(new OutputPass())

    addEventListener('resize', () => this.resize())
  }

  resize() {
    // Clamped for the same reason the engine's is: a tab that boots in the
    // background reports 0x0, and a zero-sized composer target is as broken as
    // a NaN camera aspect.
    const w = Math.max(1, innerWidth)
    const h = Math.max(1, innerHeight)
    this.composer.setSize(w, h)
    this.gtao.setSize(w, h)
    this.bloom.setSize(w, h)
  }

  /**
   * Quality tiers. AO is by far the most expensive pass, so it is the first
   * thing dropped; the grade is the cheapest and always stays.
   */
  setQuality(level: QualityLevel) {
    this.quality = level
    /*
     * GTAO is deliberately OFF at every tier now.
     *
     * On this art style it subtracts: the look is flat-shaded low-poly, and
     * screen-space AO reads the mountains' huge facets as one giant crevice —
     * "high" was visibly *worse* than medium, dark splotches over the whole
     * range, which defeats the point of a high tier. Shadow mapping already
     * seats objects on the ground. The pass and its wiring stay, because a
     * future dense-interior scene may want it back — but it needs a depth
     * fade before it can coexist with the mountains.
     */
    this.gtao.enabled = false
    this.bloom.enabled = level !== 'low'
    // MSAA scales with the tier too. It is the cheapest way to look sharp on a
    // discrete GPU and the first thing worth dropping on integrated graphics.
    this.target.samples = level === 'high' ? 4 : level === 'medium' ? 2 : 0
    this.composer.setPixelRatio(
      level === 'high' ? Math.min(devicePixelRatio, DPR_HIGH) : level === 'medium' ? DPR_MEDIUM : DPR_LOW,
    )
    this.resize()
  }

  /** Night grading: cooler, more contrast, heavier vignette. */
  setNightAmount(t: number) {
    const u = this.grade.uniforms
    u.uVignette.value = 0.16 + t * 0.4
    u.uSaturation.value = 1.2 - t * 0.32
    u.uContrast.value = 1.28 + t * 0.22
    u.uGain.value.setRGB(1 - t * 0.12, 1 - t * 0.06, 1 + t * 0.06).multiplyScalar(1)
  }

  /**
   * Adaptive quality.
   *
   * Ambient occlusion is worth roughly 25ms on integrated graphics and almost
   * nothing on a discrete GPU, so hardcoding either choice is wrong. Instead
   * the stack starts at full quality and steps down if the frame budget is
   * consistently blown.
   *
   * It only ever steps *down* automatically. Stepping back up on a good
   * stretch would oscillate: dropping AO makes frames fast, which re-enables
   * AO, which makes them slow again. Raising quality is a manual choice.
   */
  private frameAccum = 0
  private frameCount = 0
  private settleTime = 0

  /** When false the player has pinned a quality level and we leave it alone. */
  autoQuality = true

  autoAdjust(dt: number) {
    if (!this.autoQuality) return null
    // Ignore the first second — shader compilation and world generation make
    // early frames wildly unrepresentative.
    this.settleTime += dt
    if (this.settleTime < 1.5) return

    this.frameAccum += dt
    this.frameCount++
    if (this.frameCount < 90) return

    const avgMs = (this.frameAccum / this.frameCount) * 1000
    this.frameAccum = 0
    this.frameCount = 0

    if (this.quality === 'high' && avgMs > 24) {
      this.setQuality('medium')
      return 'medium' as const
    }
    if (this.quality === 'medium' && avgMs > 34) {
      this.setQuality('low')
      return 'low' as const
    }
    return null
  }

  render() {
    this.composer.render()
  }

  get isAOEnabled() {
    return this.gtao.enabled
  }

  /** Keeps the AO pass honest when the camera's near/far change. */
  syncCamera() {
    const cam = this.camera as THREE.PerspectiveCamera
    this.gtao.camera = cam
  }
}
