// Throwaway: find where world plots legally fit, so the result can be baked in.
import { heightAt, isWalkable, isSand, WATER_LEVEL, WALK_LIMIT } from './src/game/terrain.ts'
import {
  PLAYER_SLOT,
  NEIGHBOUR_SLOTS,
  FENCE_HX,
  LANE_HALF,
  LANE_X_MIN,
  LANE_X_MAX,
  SQUARE_CX,
  SQUARE_HX,
  SQUARE_HZ,
  PASTURE_CENTRE,
  PASTURE_RADIUS,
  BARN_POS,
} from './src/game/village.ts'
import { TILE_SIZE } from './src/game/farm.ts'

const PLOT = 8 * TILE_SIZE + 1.6 // an 8x8 garden plus its fence
const GAP = 2.5
const STEP = PLOT + GAP
const HALF = PLOT / 2

const taken = [
  { cx: (LANE_X_MIN + LANE_X_MAX) / 2, cz: 0, hx: (LANE_X_MAX - LANE_X_MIN) / 2, hz: LANE_HALF },
  { cx: SQUARE_CX, cz: 0, hx: SQUARE_HX, hz: SQUARE_HZ },
  { cx: PASTURE_CENTRE.x, cz: PASTURE_CENTRE.z, hx: PASTURE_RADIUS, hz: PASTURE_RADIUS },
  { cx: BARN_POS.x, cz: BARN_POS.z, hx: 8, hz: 7 },
  { cx: PLAYER_SLOT.x, cz: PLAYER_SLOT.z, hx: FENCE_HX, hz: FENCE_HX },
  ...NEIGHBOUR_SLOTS.map((s) => ({ cx: s.x, cz: s.z, hx: FENCE_HX, hz: FENCE_HX })),
]

const overlaps = (cx, cz, r) =>
  Math.abs(cx - r.cx) < HALF + r.hx + GAP && Math.abs(cz - r.cz) < HALF + r.hz + GAP

function fits(cx, cz) {
  if (Math.hypot(cx, cz) + HALF > WALK_LIMIT - 6) return false
  for (const r of taken) if (overlaps(cx, cz, r)) return false
  for (let x = cx - HALF; x <= cx + HALF; x += 1) {
    for (let z = cz - HALF; z <= cz + HALF; z += 1) {
      if (!isWalkable(x, z) || isSand(x, z) || heightAt(x, z) < WATER_LEVEL) return false
    }
  }
  return true
}

// Anchored on the player's farm so the board lines up with the street.
const found = []
for (let i = -7; i <= 7; i++) {
  for (let j = -7; j <= 7; j++) {
    const cx = PLAYER_SLOT.x + i * STEP
    const cz = PLAYER_SLOT.z + j * STEP
    if (fits(cx, cz)) found.push({ cx: +cx.toFixed(2), cz: +cz.toFixed(2) })
  }
}

// Nearest first: that is the order a player would meet them, and it makes the
// price ladder a function of distance from home.
found.sort(
  (a, b) =>
    Math.hypot(a.cx - PLAYER_SLOT.x, a.cz - PLAYER_SLOT.z) -
    Math.hypot(b.cx - PLAYER_SLOT.x, b.cz - PLAYER_SLOT.z),
)

console.log('plot size', PLOT.toFixed(2), 'step', STEP.toFixed(2), 'found', found.length)
console.log(JSON.stringify(found.slice(0, 12)))
