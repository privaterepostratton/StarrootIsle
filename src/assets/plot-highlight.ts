import * as THREE from 'three'

/**
 * The ring around the plot the player is about to act on.
 *
 * This replaces a four-segment `RingGeometry` — a square annulus — and the ways
 * that failed are the brief for what is here:
 *
 *  - **Polygon edges alias.** A hard-edged quad lying on the ground at this
 *    camera's shallow angle crawls and stair-steps along every side, and at a
 *    tile that small the whole outline is edge. The shape is a signed distance
 *    field instead, so the border is resolved per pixel from `fwidth` and stays
 *    clean at any zoom — the same reason the buy markers are built this way.
 *  - **A ring's corners are wrong.** `RingGeometry` interpolates between an inner
 *    and an outer radius, so a four-segment one is thin along the flats and
 *    stretches to a spike at each corner. It read as a lozenge, not as a tile.
 *    A rounded box has one border width the whole way round.
 *  - **It floated.** The old ring sat a fixed 0.2 above the tile origin, which is
 *    4cm clear of the planter's rim, so it hovered over the bed rather than
 *    marking it. This lies just above the rim, and reads as painted on.
 *  - **Nothing tied it to the plot.** A bare outline is a shape on the ground; a
 *    soft wash inside it, brightest against the border, gives the plot a body and
 *    makes it look lit rather than fenced.
 *
 * One mesh, moved between tiles — there is only ever one highlight — with a short
 * scale-in each time it lands somewhere new so the eye follows the jump.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  uniform float uAge;

  /** Overshoot and settle, applied about the tile's own centre. */
  float easeOutBack(float t) {
    float c = 1.9;
    float p = t - 1.0;
    return 1.0 + (c + 1.0) * p * p * p + c * p * p;
  }

  void main() {
    vUv = uv;
    float grow = mix(0.82, 1.0, easeOutBack(clamp(uAge / 0.16, 0.0, 1.0)));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * grow, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAge;
  uniform float uStrength;
  uniform vec3 uColor;

  /** Signed distance to a rounded box. Negative inside. */
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    // Centre the UV and work in [-1, 1] so the field is symmetric.
    vec2 p = vUv * 2.0 - 1.0;

    float appear = clamp(uAge / 0.14, 0.0, 1.0);
    // A slow breath. Deliberately gentle: this sits under the player's hands for
    // as long as they stand on the plot, and anything faster nags.
    float pulse = 0.5 + 0.5 * sin(uAge * 3.2);

    float d = sdRoundBox(p, vec2(0.79), 0.22);
    // One pixel in UV terms, so every edge below is antialiased by construction.
    float aa = fwidth(d) * 1.2;

    // Constant-width border, breathing very slightly.
    float width = 0.038 + 0.010 * pulse;
    float line = 1.0 - smoothstep(0.0, aa, abs(d) - width);

    /*
     * Inner wash: strongest just inside the border and gone by the middle, so the
     * crop and the soil stay legible through it. Clipped to the inside — a
     * symmetric falloff would bleed a halo out onto the grass and lose the shape.
     */
    float inside = 1.0 - smoothstep(0.0, aa, d);
    float wash = inside * smoothstep(-0.5, -0.02, d);

    float alpha = (line * 0.9 + wash * 0.3 * (0.75 + 0.25 * pulse)) * uStrength * appear;
    if (alpha < 0.004) discard;

    // The border carries the light, the wash carries the hue: a single flat colour
    // for both leaves the outline muddy against soil this dark.
    vec3 colour = mix(uColor, vec3(1.0), line * 0.5);
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`

export interface PlotHighlight {
  mesh: THREE.Mesh
  /** Seconds since the highlight last moved. Drives the pop-in and the breath. */
  setAge(seconds: number): void
  setColor(hex: number): void
  /** 0 to 1: a hovered plot states itself more quietly than an actionable one. */
  setStrength(v: number): void
  dispose(): void
}

export function createPlotHighlight(tileSize: number): PlotHighlight {
  const geometry = new THREE.PlaneGeometry(tileSize, tileSize)
  geometry.rotateX(-Math.PI / 2)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: 0 },
      uStrength: { value: 1 },
      uColor: { value: new THREE.Color(0xfff6e0) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Never punches a hole in the depth buffer: a crop standing in the plot has
    // to draw over the wash, not be cut out by it.
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 2

  return {
    mesh,
    setAge(seconds: number) {
      material.uniforms.uAge.value = seconds
    },
    setColor(hex: number) {
      ;(material.uniforms.uColor.value as THREE.Color).setHex(hex)
    },
    setStrength(v: number) {
      material.uniforms.uStrength.value = v
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
