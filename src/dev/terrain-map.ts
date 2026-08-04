import {
  heightAt,
  slopeAt,
  isWalkable,
  bridgeAt,
  WATER_LEVEL,
  WALK_LIMIT,
  WORLD_SIZE,
} from '../game/terrain'
import { FLAT_PADS } from '../game/village'

/**
 * Dev-only plan view of the heightfield.
 *
 * Layout is the one thing the game itself cannot show you. The camera boom is
 * clamped to a few metres above the farmer — deliberately, it is an isometric
 * farm game — so there is no viewpoint in the running game from which "is the
 * east river clear of the pasture" or "do the summits ring the valley evenly"
 * is answerable. Both questions are trivial from directly overhead, and this
 * page is the only way to get there.
 *
 * It samples the same `heightAt` the terrain mesh is built from, so it is a
 * measurement of the world rather than a drawing of it — if the map and the
 * game disagree, the map is right and something downstream of the height
 * function has gone wrong.
 *
 *   /terrain-map.html              the whole mesh
 *   /terrain-map.html?px=3         3 screen pixels per world unit
 *   /terrain-map.html?contours=0   flat colour, no height banding
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

/** Screen pixels per world unit. */
const PX = num('px', 2)
const CONTOURS = num('contours', 1) > 0
const HALF = WORLD_SIZE / 2
const SIZE = Math.round(WORLD_SIZE * PX)

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = SIZE
canvas.height = SIZE
const ctx = canvas.getContext('2d')!
const img = ctx.createImageData(SIZE, SIZE)

let lowest = Infinity
let highest = -Infinity
let water = 0
let walkable = 0

for (let py = 0; py < SIZE; py++) {
  // Screen +y is world +z, so north (−z) is at the top as it is on a map.
  const z = -HALF + (py / SIZE) * WORLD_SIZE
  for (let px = 0; px < SIZE; px++) {
    const x = -HALF + (px / SIZE) * WORLD_SIZE
    const h = heightAt(x, z)
    lowest = Math.min(lowest, h)
    highest = Math.max(highest, h)

    let r: number
    let g: number
    let b: number

    /*
     * Keyed off isWalkable, not off a slope number picked to match the terrain
     * shader's rock tint.
     *
     * The first version of this used `slope > 0.62` — the threshold at which
     * the ground *looks* rocky — and painted every hill with a grey ring, which
     * read as six hills the player could not climb. They climb fine: the walk
     * test allows up to 0.72, and the flanks peak around 0.66. A map that
     * answers a different question from the one in its own legend is worse than
     * no map, because it is believed.
     */
    const standable = isWalkable(x, z)

    if (h < WATER_LEVEL) {
      // Depth as brightness, so a channel reads apart from a lake bed.
      const depth = Math.min(1, (WATER_LEVEL - h) / 4)
      r = 40 - depth * 20
      g = 110 - depth * 45
      b = 190 - depth * 55
      water++
    } else if (h > 30) {
      const t = Math.min(1, (h - 30) / 24)
      r = 150 + t * 105
      g = 155 + t * 100
      b = 160 + t * 95
    } else if (!standable) {
      const t = Math.min(1, Math.max(0, (h - 8) / 22))
      r = 120 + t * 40
      g = 118 + t * 40
      b = 112 + t * 40
    } else {
      // Walkable ground, shaded by height so the hills read as hills. The
      // steepest standable flanks get a rockier tint, matching what the terrain
      // shader does at the same slope.
      const rocky = Math.min(1, Math.max(0, (slopeAt(x, z) - 0.5) / 0.22))
      const t = Math.min(1, Math.max(0, (h + 2) / 13))
      r = (86 + t * 60) * (1 - rocky) + 132 * rocky
      g = (150 + t * 45) * (1 - rocky) + 130 * rocky
      b = (62 + t * 30) * (1 - rocky) + 118 * rocky
    }

    // Height banding every two units — the cheapest way to read a slope's
    // shape in a flat image, and it makes the river channels legible.
    if (CONTOURS && Math.abs((h % 2) - 1) > 0.93) {
      r *= 0.86
      g *= 0.86
      b *= 0.86
    }

    if (standable) walkable++

    const i = (py * SIZE + px) * 4
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
    img.data[i + 3] = 255
  }
}
ctx.putImageData(img, 0, 0)

// --- overlays ----------------------------------------------------------------

/** World XZ to canvas pixels. */
const sx = (x: number) => ((x + HALF) / WORLD_SIZE) * SIZE
const sz = (z: number) => ((z + HALF) / WORLD_SIZE) * SIZE

ctx.lineWidth = 2
ctx.strokeStyle = 'rgba(255, 90, 80, 0.9)'
ctx.beginPath()
ctx.arc(sx(0), sz(0), WALK_LIMIT * PX, 0, Math.PI * 2)
ctx.stroke()

ctx.strokeStyle = 'rgba(255, 224, 120, 0.85)'
for (const pad of FLAT_PADS) {
  ctx.strokeRect(sx(pad.cx - pad.hx), sz(pad.cz - pad.hz), pad.hx * 2 * PX, pad.hz * 2 * PX)
}

// Bridges are found by probing rather than by importing BRIDGES, so a deck that
// has drifted off its river shows up here as a mark sitting on dry land.
ctx.fillStyle = 'rgba(255, 150, 40, 0.95)'
for (let x = -HALF; x < HALF; x += 1) {
  for (let z = -HALF; z < HALF; z += 1) {
    if (bridgeAt(x, z)) ctx.fillRect(sx(x), sz(z), PX, PX)
  }
}

document.getElementById('head')!.innerHTML =
  `<b>${WORLD_SIZE}</b> world units · walk limit <b>${WALK_LIMIT}</b> · ` +
  `height <b>${lowest.toFixed(1)}</b> to <b>${highest.toFixed(1)}</b> · ` +
  `<b>${((water / (SIZE * SIZE)) * 100).toFixed(1)}%</b> under water · ` +
  `<b>${((walkable / (SIZE * SIZE)) * 100).toFixed(1)}%</b> walkable`

// Signal for headless capture: the page is static, so this never changes again.
;(window as unknown as { __ready?: boolean }).__ready = true
