import * as THREE from 'three'

/**
 * The "you could build here" marker, drawn on every buyable plot.
 *
 * This replaces a flat translucent quad, and the reasons it was weak are worth
 * stating because they are what the shader fixes:
 *
 *  - **A filled square reads as a decal, not an invitation.** A bracketed frame
 *    with a plus in it says *place something here* without a word of UI. The old
 *    version relied on the player already knowing what a yellow square meant.
 *  - **Nothing moved.** Motion is the cheapest and strongest signal that
 *    something is interactive; a static overlay is scenery.
 *  - **Hard polygon edges alias badly** on a ground plane at a shallow camera
 *    angle, which is exactly this game's viewing angle. Signed distance fields
 *    are resolution-independent — the edge is computed per pixel from `fwidth`,
 *    so it stays clean at any zoom.
 *  - **One flat colour at 28% opacity** had to read against both bright grass and
 *    dark soil and managed neither. A bright core with a darker rim reads on both,
 *    because the pair carries its own contrast rather than borrowing the ground's.
 *
 * Drawn as a single InstancedMesh so the whole frontier costs one draw call, with
 * a per-instance phase so the markers ripple outward instead of blinking in
 * lockstep.
 */

const VERTEX = /* glsl */ `
  attribute float aPhase;
  varying vec2 vUv;
  varying float vPhase;
  uniform float uTime;

  /*
   * Overshoot-and-settle on appear. The scale is applied to the local position
   * before the instance matrix, so it grows about the tile's own centre rather
   * than sliding in from the world origin.
   */
  float easeOutBack(float t) {
    float c = 1.70158;
    float p = t - 1.0;
    return 1.0 + (c + 1.0) * p * p * p + c * p * p;
  }

  void main() {
    vUv = uv;
    vPhase = aPhase;
    // aPhase doubles as the stagger delay, so the ripple spreads from the player.
    float t = clamp((uTime - aPhase * 0.55) / 0.34, 0.0, 1.0);
    float grow = easeOutBack(t);
    vec3 scaled = position * grow;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(scaled, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying float vPhase;
  uniform float uTime;
  uniform vec3 uCore;
  uniform vec3 uRim;

  /** Signed distance to a rounded box. Negative inside. */
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    // Centre the UV and work in [-1, 1] so the SDFs are symmetric.
    vec2 p = vUv * 2.0 - 1.0;

    float appear = clamp((uTime - vPhase * 0.55) / 0.34, 0.0, 1.0);
    // Slow breath, offset per instance so the field shimmers rather than throbs.
    float pulse = 0.5 + 0.5 * sin(uTime * 2.1 - vPhase * 2.0);

    float d = sdRoundBox(p, vec2(0.82), 0.26);
    // One pixel in UV terms, so every edge below is antialiased by construction
    // instead of by a texture's filtering.
    float aa = fwidth(d) * 1.4;

    /*
     * Corner brackets, not a closed outline. A full border reads as a tile you
     * already own; brackets read as a target reticle, which is the intent — and
     * they let the ground texture through so the plot still looks like ground.
     */
    float ring = 1.0 - smoothstep(0.0, aa, abs(d) - 0.05);
    /*
     * Uses min, not max — this is the whole trick, and getting it wrong is why the
     * first two attempts drew a closed outline.
     *
     * On a square boundary max(|x|,|y|) is *constant* along each flat edge (it is
     * just the half-extent), so masking by it either keeps the entire perimeter or
     * none of it. The coordinate that actually varies along an edge is the other
     * one: min(|x|,|y|) is near zero at the middle of a side and large only where
     * two sides meet. So min is what isolates corners.
     */
    float corner = smoothstep(0.30, 0.56, min(abs(p.x), abs(p.y)));
    float brackets = ring * corner;

    // Soft interior wash, brightest at the middle, so the shape has a body.
    float inside = 1.0 - smoothstep(-0.32, 0.16, d);
    float body = inside * (0.10 + 0.06 * pulse);

    /*
     * A plus in the centre: the single clearest way to say "add a plot". Built
     * from two overlapping rounded boxes so it inherits the same crisp edges.
     */
    float barH = sdRoundBox(p, vec2(0.30, 0.075), 0.06);
    float barV = sdRoundBox(p, vec2(0.075, 0.30), 0.06);
    float plus = 1.0 - smoothstep(0.0, aa, min(barH, barV));

    /*
     * A shine sweeping along the tile diagonal. Confined to the interior so it
     * cannot smear outside the shape, and narrow enough to read as a highlight
     * passing over rather than as the marker changing colour.
     */
    float sweepPos = fract(uTime * 0.28 - vPhase * 0.12);
    float sweep = exp(-pow((p.x + p.y) * 0.5 - (sweepPos * 2.4 - 1.2), 2.0) * 18.0);
    float shine = sweep * inside * 0.30;

    float alpha = (brackets * 0.82 + body + plus * 0.66 + shine) * appear;
    if (alpha < 0.004) discard;

    /*
     * Warm, not white. Summing three near-opaque marks drove the mix factor to 1
     * everywhere, so every pixel took the core colour and the amber never showed —
     * the markers came out as blank white tiles. Weighting the factor below 1 keeps
     * the amber in the wash and the cream only in the brightest strokes, which is
     * what puts them back in the game's palette.
     */
    float warmth = clamp(brackets * 0.85 + plus * 0.55 + shine * 0.7, 0.0, 1.0);
    vec3 colour = mix(uRim, uCore, warmth);
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`

export interface PlotMarkerField {
  mesh: THREE.InstancedMesh
  /** Advance the animation. Seconds since the field was shown. */
  setTime(seconds: number): void
  dispose(): void
}

/**
 * Build the marker field.
 *
 * `origin` is what the ripple spreads from — pass the player so the nearest
 * plots light up first, which points the eye at the ones actually worth buying.
 */
export function createPlotMarkers(
  positions: THREE.Vector3[],
  tileSize: number,
  origin: THREE.Vector3,
): PlotMarkerField {
  const geometry = new THREE.PlaneGeometry(tileSize * 0.96, tileSize * 0.96)
  geometry.rotateX(-Math.PI / 2)

  // Normalised distance from the origin, so the stagger is a wave rather than a
  // random scatter — the eye follows an outward ripple, not a twitch.
  let furthest = 0.0001
  const distances = positions.map((p) => {
    const d = Math.hypot(p.x - origin.x, p.z - origin.z)
    furthest = Math.max(furthest, d)
    return d
  })
  const phase = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i++) phase[i] = distances[i] / furthest

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color(0xfff2c8) },
      uRim: { value: new THREE.Color(0xe8973a) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // On the ground and under everything: never occlude a crop or the farmer, and
    // never let two overlapping markers punch holes in each other.
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.InstancedMesh(geometry, material, positions.length)
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))

  const m = new THREE.Matrix4()
  positions.forEach((p, i) => {
    mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.05, p.z))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  // Markers are UI in world space — they must not be dimmed by the day grade or
  // sorted against foliage, so they render late and ignore lighting entirely.
  mesh.renderOrder = 5
  mesh.frustumCulled = false

  return {
    mesh,
    setTime(seconds: number) {
      material.uniforms.uTime.value = seconds
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
