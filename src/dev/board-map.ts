import { heightAt, isWalkable, isSand, WATER_LEVEL, WALK_LIMIT } from '../game/terrain'
import {
  NEIGHBOUR_SLOTS,
  LANE_HALF,
  LANE_X_MIN,
  LANE_X_MAX,
  SQUARE_CX,
  SQUARE_HX,
  SQUARE_HZ,
  SHOP_POS,
  PASTURE_CENTRE,
  PASTURE_RADIUS,
  SPAWN,
} from '../game/village'
import { TILE_SIZE } from '../game/farm'

/**
 * Dev-only plan view of the world as a board of buyable plots.
 *
 * The player's farm is one plot among several: a plot holds a garden (which
 * grows 4x4 -> 7x7 -> 10x10 tiles inside it), and later other things — a
 * hatchery, a workshop — so they all have to be the same size and none of them
 * may overlap the neighbours' farms, the lane or the market square.
 *
 * Where those plots can legally go is a question about the terrain, not about
 * taste, so this page answers it by measurement: it walks a grid over the
 * valley and keeps every square that is entirely walkable, entirely off the
 * sand, inside the walk limit and clear of everything the village already
 * occupies. What it draws is therefore the complete set of candidates.
 *
 *   /board-map.html            the valley
 *   /board-map.html?px=3       3 screen pixels per world unit
 *   /board-map.html?gap=3      metres of clearance demanded around each plot
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

/** A garden at its largest, plus the fence margin either side. */
const GARDEN_MAX_TILES = 10
const PLOT_SIZE = num('plot', GARDEN_MAX_TILES * TILE_SIZE + 1.6)
/**
 * The buyable plots, which are smaller than the one you start on.
 *
 * The neighbours are back to full size and the start plot has to hold a garden
 * grown all the way to 10x10, so those two are fixed — the only slack left is
 * in the plots for sale, and there has to be slack somewhere or the board does
 * not fit between the beach and the walk limit. Eight tiles a side plus the
 * fence: room for a garden up to 8x8, or for whatever else goes on a plot.
 */
const SIDE_PLOT_TILES = num('side', 8)
const SIDE_PLOT_SIZE = SIDE_PLOT_TILES * TILE_SIZE + 1.6
/** Clearance demanded between a plot and anything else. */
const GAP = num('gap', 2.5)
/** Step between candidate positions. */
const STEP = SIDE_PLOT_SIZE + GAP

/**
 * Turn the village a quarter turn about the valley's middle.
 *
 * `?rot=cw` or `?rot=ccw`. The terrain cannot rotate — the beach is where the
 * beach is — so this is a proposal about where the lane, the square and the
 * farms *would* sit if the street ran east to west instead of north to south,
 * measured against the same ground as everything else on this page.
 */
// Clockwise is the agreed layout — the street runs east to west with the farms
// in rows either side of it. `?rot=none` still shows what the village looks
// like today, for comparison.
const ROT = params.get('rot') ?? 'none'
const turn = (p: { x: number; z: number }) => {
  if (ROT === 'cw') return { x: -p.z, z: p.x }
  if (ROT === 'ccw') return { x: p.z, z: -p.x }
  return { x: p.x, z: p.z }
}
/** A rect's half-extents swap with the rotation; its centre moves with it. */
const turnRect = (r: { cx: number; cz: number; hx: number; hz: number }) => {
  const c = turn({ x: r.cx, z: r.cz })
  const swapped = ROT !== 'none'
  return { cx: c.x, cz: c.z, hx: swapped ? r.hz : r.hx, hz: swapped ? r.hx : r.hz }
}

const PX = num('px', 3.4)
const X0 = num('x0', -80)
const X1 = num('x1', 60)
const Z0 = num('z0', -70)
const Z1 = num('z1', 70)

const W = Math.round((X1 - X0) * PX)
const H = Math.round((Z1 - Z0) * PX)

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = W
canvas.height = H
const ctx = canvas.getContext('2d')!

const sx = (x: number) => (x - X0) * PX
const sz = (z: number) => (z - Z0) * PX

// --- ground ------------------------------------------------------------------
const img = ctx.createImageData(W, H)
for (let py = 0; py < H; py++) {
  const z = Z0 + py / PX
  for (let px = 0; px < W; px++) {
    const x = X0 + px / PX
    const h = heightAt(x, z)
    let r: number
    let g: number
    let b: number
    if (h < WATER_LEVEL) {
      const depth = Math.min(1, (WATER_LEVEL - h) / 4)
      r = 40 - depth * 20
      g = 110 - depth * 45
      b = 190 - depth * 55
    } else if (isSand(x, z)) {
      r = 226
      g = 200
      b = 138
    } else if (!isWalkable(x, z)) {
      r = 118
      g = 114
      b = 108
    } else {
      const t = Math.min(1, Math.max(0, (h + 2) / 13))
      r = 92 + t * 55
      g = 154 + t * 40
      b = 70 + t * 28
    }
    const i = (py * W + px) * 4
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
    img.data[i + 3] = 255
  }
}
ctx.putImageData(img, 0, 0)

ctx.textBaseline = 'middle'
function label(text: string, x: number, z: number, colour = '#fff', size = 12, align: CanvasTextAlign = 'center') {
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.textAlign = align
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'
  ctx.strokeText(text, sx(x), sz(z))
  ctx.fillStyle = colour
  ctx.fillText(text, sx(x), sz(z))
}

function box(cx: number, cz: number, hx: number, hz: number, stroke: string, width = 2, fill?: string) {
  ctx.lineWidth = width
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(sx(cx - hx), sz(cz - hz), hx * 2 * PX, hz * 2 * PX)
  }
  ctx.strokeStyle = stroke
  ctx.strokeRect(sx(cx - hx), sz(cz - hz), hx * 2 * PX, hz * 2 * PX)
}

// --- what the village already owns -------------------------------------------
interface Rect {
  cx: number
  cz: number
  hx: number
  hz: number
}

/**
 * Neighbour gardens, in tiles.
 *
 * Four, not the ten a player's garden grows to. A neighbour is scenery with a
 * quest attached: their plot has to read as a smallholding at a glance and then
 * get out of the way, and at ten tiles they were the same size as a fully
 * upgraded player farm — five of them ate the middle of the valley and left
 * nothing worth buying near the village.
 */
const NEIGHBOUR_TILES = num('nb', GARDEN_MAX_TILES)
const NEIGHBOUR_HALF = (NEIGHBOUR_TILES * TILE_SIZE) / 2 + 0.8
const taken: Rect[] = [
  // The market square.
  { cx: SQUARE_CX, cz: 0, hx: SQUARE_HX, hz: SQUARE_HZ },
  ...NEIGHBOUR_SLOTS.map((s) => ({ cx: s.x, cz: s.z, hx: NEIGHBOUR_HALF, hz: NEIGHBOUR_HALF })),
].map(turnRect)

/**
 * The lane, added after the start plot so it can be cut short to meet it.
 *
 * The spot the farm wants is the head of the street, and the street currently
 * runs straight through it. Rather than shove the farm aside — the fit search
 * did exactly that, and put it twenty-five units away in a field — the lane
 * gives way: it now ends at the farm's gate instead of carrying on past it into
 * empty grass, which is what a village street would do anyway.
 */
const laneFull = turnRect({
  cx: (LANE_X_MIN + LANE_X_MAX) / 2,
  cz: 0,
  hx: (LANE_X_MAX - LANE_X_MIN) / 2,
  hz: LANE_HALF,
})

function overlaps(cx: number, cz: number, half: number, r: Rect, pad: number) {
  return Math.abs(cx - r.cx) < half + r.hx + pad && Math.abs(cz - r.cz) < half + r.hz + pad
}

/** Is a square footprint on clean, standable, unclaimed ground? */
function fits(cx: number, cz: number, half: number, pad = GAP) {
  if (Math.hypot(cx, cz) + half > WALK_LIMIT - 4) return false
  for (const r of taken) if (overlaps(cx, cz, half, r, pad)) return false
  // Sample the footprint on a 1-unit lattice: every square metre of it has to
  // be standable grass, or a plot ends up with a river or a cliff inside it.
  for (let x = cx - half; x <= cx + half; x += 1) {
    for (let z = cz - half; z <= cz + half; z += 1) {
      if (!isWalkable(x, z) || isSand(x, z) || heightAt(x, z) < WATER_LEVEL) return false
    }
  }
  return true
}

/** Walk outward from a wanted spot until the footprint fits. */
function nearestFitting(target: { x: number; z: number }, half: number, pad = GAP) {
  if (fits(target.x, target.z, half, pad)) return { ...target, moved: 0 }
  for (let r = 1; r <= 45; r++) {
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * Math.PI * 2
      const x = target.x + Math.cos(th) * r
      const z = target.z + Math.sin(th) * r
      if (fits(x, z, half, pad)) return { x, z, moved: r }
    }
  }
  return { ...target, moved: -1 }
}

/*
 * The pasture, re-sited.
 *
 * Turning the village dropped it on the beach, which is the sort of thing a
 * rotation does to anything that was placed by eye. Rather than pick a new
 * number by eye as well, it is put back by the same fit test everything else on
 * this page uses: as close to the old spot as the ground allows.
 */
const pasture = nearestFitting(turn(PASTURE_CENTRE), PASTURE_RADIUS, 2)
taken.push({ cx: pasture.x, cz: pasture.z, hx: PASTURE_RADIUS, hz: PASTURE_RADIUS })

for (const r of taken) box(r.cx, r.cz, r.hx, r.hz, 'rgba(255,255,255,0.5)', 1.5, 'rgba(255,255,255,0.12)')
const sq = turn({ x: SQUARE_CX, z: 0 })
label('village square', sq.x, sq.z, '#ffe9b8', 12)
const laneLabel = turn({ x: 0, z: 0 })
label('lane', laneLabel.x, laneLabel.z, '#ffe9b8', 12)
label(`pasture${pasture.moved ? ' (moved)' : ''}`, pasture.x, pasture.z, '#fff', 11)
for (const s of NEIGHBOUR_SLOTS) {
  const p = turn(s)
  label(`${NEIGHBOUR_TILES}×${NEIGHBOUR_TILES}`, p.x, p.z, 'rgba(255,255,255,0.9)', 10)
}

// --- candidate plots ---------------------------------------------------------
/*
 * The grid is anchored on the player's current farm, so the plot they start on
 * is a plot of the board rather than an exception sitting between two of them.
 */
/**
 * Where the player's plot wants to be, and where it can actually go.
 *
 * The target is a spot picked by eye off this map — the head of the street,
 * west end, with the beach behind it. Whether a whole plot fits there is a
 * different question, so the target is only a starting point: the search below
 * walks outward from it and takes the nearest position that passes the same fit
 * test as every other plot. If the answer comes back a few units north, that is
 * the lane refusing to be built on.
 */
const START_TARGET = { x: num('sx', -33), z: num('sz', -2) }

/*
 * Placed where it was asked for, not where a search finds room.
 *
 * The only thing that can veto this spot is the ground itself — sand, water or
 * a slope — because everything else in the way is a village that can be moved.
 * If the ground says no, the search takes over and the map says how far it had
 * to go.
 */
const startOnGround = fits(START_TARGET.x, START_TARGET.z, PLOT_SIZE / 2, 0)
const anchor = startOnGround ? { ...START_TARGET, moved: 0 } : nearestFitting(START_TARGET, PLOT_SIZE / 2)
// The start plot is part of the board, so nothing else may be laid over it.
taken.push({ cx: anchor.x, cz: anchor.z, hx: PLOT_SIZE / 2, hz: PLOT_SIZE / 2 })

// Now the street: it runs from the square in the east to the farm gate, and no
// further.
const laneEast = laneFull.cx + laneFull.hx
const laneWest = anchor.x + PLOT_SIZE / 2 + GAP
const lane: Rect = {
  cx: (laneWest + laneEast) / 2,
  cz: laneFull.cz,
  hx: Math.max(2, (laneEast - laneWest) / 2),
  hz: laneFull.hz,
}
taken.push(lane)
box(lane.cx, lane.cz, lane.hx, lane.hz, 'rgba(255,255,255,0.5)', 1.5, 'rgba(255,255,255,0.12)')

box(
  anchor.x,
  anchor.z,
  PLOT_SIZE / 2,
  PLOT_SIZE / 2,
  '#ffd062',
  3,
  'rgba(255, 208, 98, 0.25)',
)
label('START', anchor.x, anchor.z, '#ffe9a8', 13)
label(`${GARDEN_MAX_TILES}×${GARDEN_MAX_TILES} max`, anchor.x, anchor.z + 3, 'rgba(255,233,168,0.85)', 10)

/*
 * The rest of the board.
 *
 * Stepped off the start plot so the whole thing reads as one grid, but sized
 * for a smaller garden — the start plot and the neighbours are the two things
 * that must be full size, and everything else gives way to them.
 */
const candidates: { cx: number; cz: number }[] = []
for (let i = -7; i <= 7; i++) {
  for (let j = -7; j <= 7; j++) {
    if (i === 0 && j === 0) continue
    const cx = anchor.x + i * STEP
    const cz = anchor.z + j * STEP
    if (fits(cx, cz, SIDE_PLOT_SIZE / 2)) candidates.push({ cx, cz })
  }
}

candidates.forEach((c, i) => {
  box(
    c.cx,
    c.cz,
    SIDE_PLOT_SIZE / 2,
    SIDE_PLOT_SIZE / 2,
    'rgba(150, 240, 170, 0.95)',
    2,
    'rgba(150, 240, 170, 0.14)',
  )
  label(`plot ${i + 1}`, c.cx, c.cz, '#dfffe8', 11)
})

// --- landmarks ---------------------------------------------------------------
const stall = turn(SHOP_POS)
// The barn belongs beside the pasture, so it follows it rather than the turn.
label('🛒 stall', stall.x, stall.z, '#ffe9b8', 11)
label('🏚️ barn', pasture.x, pasture.z - PASTURE_RADIUS - 2, '#ffe9b8', 11)
// The spawn is on the beach, which does not rotate — the player still washes up
// where the sea is, whatever the village does.
label('🧍 wake here', SPAWN.x, SPAWN.z, '#fff', 11)
label('beach', -62, 20, '#8a6a3a', 12)
label('ocean', -74, -10, '#cfe4ff', 12)

ctx.setLineDash([5, 5])
ctx.lineWidth = 2
ctx.strokeStyle = 'rgba(255, 110, 100, 0.8)'
ctx.beginPath()
ctx.arc(sx(0), sz(0), WALK_LIMIT * PX, 0, Math.PI * 2)
ctx.stroke()
ctx.setLineDash([])

ctx.fillStyle = 'rgba(255,255,255,0.9)'
ctx.fillRect(sx(X1 - 26), sz(Z1 - 5), 20 * PX, 3)
label('20 units', X1 - 16, Z1 - 7.5, '#fff', 11)
label('north ↑', X1 - 12, Z0 + 4, '#fff', 12)

document.getElementById('head')!.innerHTML =
  `start plot <b>${PLOT_SIZE.toFixed(1)}</b>u (${GARDEN_MAX_TILES}×${GARDEN_MAX_TILES} garden) · ` +
  `other plots <b>${SIDE_PLOT_SIZE.toFixed(1)}</b>u (${SIDE_PLOT_TILES}×${SIDE_PLOT_TILES}) · ` +
  `neighbours <b>${NEIGHBOUR_TILES}×${NEIGHBOUR_TILES}</b> · clearance <b>${GAP}</b> · ` +
  `<b>${candidates.length}</b> plots for sale · ` +
  `village turned <b>${ROT === 'none' ? 'as built' : ROT === 'cw' ? 'a quarter clockwise' : 'a quarter anticlockwise'}</b>`
;(window as unknown as { __ready?: boolean }).__ready = true
