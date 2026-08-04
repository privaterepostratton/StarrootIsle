import * as THREE from 'three'

/**
 * Surface detail for the crops, drawn to a canvas at runtime.
 *
 * The crops were flat-shaded solids in a single colour each, which is the right
 * *silhouette* language for this art direction and the wrong *surface* one:
 * every leaf and every fruit came out as unbroken plastic, and at the game's
 * camera distance a plot read as coloured shapes rather than as plants. What was
 * missing is the small-scale variation that says something grew.
 *
 * Generated rather than authored for two reasons. It has to multiply cleanly
 * against eighteen crops' worth of vertex colours, which means it must be near
 * white with all of its information in the last fifteen percent of the range —
 * easy to guarantee in code and fiddly to keep true by hand through a paint
 * program and a PNG. And the crop models are built lazily and cached, so there
 * is no load step to hang a fetch off without making every caller async.
 *
 * One map serves both foliage and fruit. A separate leaf map with painted veins
 * was the first attempt and does not survive the bake: crop foliage is merged
 * into one mesh with one material, so a vein pattern would also be stretched
 * across every stem, collar and trunk in the same geometry. Veins belong to the
 * leaf's *shape* (see the midrib in LEAF_PAD_GEO); what a shared map can do
 * everywhere, and what this does, is break up the flat colour.
 */

/** Deterministic value noise, so the texture is identical every run. */
function noise(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

let cached: THREE.Texture | null = null
let tried = false

/**
 * A tiling greyscale mottle, mean ~0.94.
 *
 * Deliberately low contrast. Anything stronger stops reading as surface and
 * starts reading as dirt on the model — and because it multiplies the crop's
 * own colour, a dark patch on a pale turnip is far more visible than the same
 * patch on a dark leaf, so the ceiling is set by the palest crop in the game.
 */
export function cropDetailMap(): THREE.Texture | null {
  if (tried) return cached
  tried = true

  /*
   * Null off the DOM, and that is a supported answer rather than a failure.
   *
   * The crop models are imported by the economy and router suites, which run in
   * node — building the map at module scope threw there and took a whole suite
   * with it. `material.map = null` is exactly what a material with no map has,
   * so the headless path gets the flat-shaded look and nothing has to branch.
   */
  if (typeof document === 'undefined') return null

  const SIZE = 256
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const r = noise(0x5eed1eaf)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SIZE, SIZE)

  /*
   * Soft blobs at three sizes, each drawn nine times in a 3x3 wrap so a blob
   * crossing an edge reappears on the opposite one. Without that the seam is a
   * hard line every time the texture repeats, which on a leaf is exactly the
   * artefact the mottle was added to avoid.
   */
  ctx.globalCompositeOperation = 'multiply'
  for (const [count, radius, depth] of [
    [26, 54, 0.055],
    [60, 26, 0.045],
    [140, 11, 0.035],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = r() * SIZE
      const y = r() * SIZE
      const rad = radius * (0.55 + r() * 0.9)
      const strength = depth * (0.4 + r() * 0.6)
      for (const dx of [-SIZE, 0, SIZE]) {
        for (const dy of [-SIZE, 0, SIZE]) {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad)
          const v = Math.round(255 * (1 - strength))
          g.addColorStop(0, `rgb(${v},${v},${v})`)
          g.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }

  // A faint fibrous grain over the top — short strokes, all one way, which is
  // what stops the blobs reading as clouds.
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1
  for (let i = 0; i < 260; i++) {
    const x = r() * SIZE
    const y = r() * SIZE
    const len = 6 + r() * 16
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (r() - 0.5) * 4, y + len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cached = tex
  return tex
}
