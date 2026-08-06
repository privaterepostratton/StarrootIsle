import * as THREE from 'three'
import { heightAt, isSand, WATER_LEVEL } from '../game/terrain'
import {
  inAnyPlot,
  onLane,
  PASTURE_CENTRE,
  PASTURE_RADIUS,
  VILLAGE_BOUNDS,
} from '../game/village'
import { PLOT_SIZE, type WorldPlot } from '../game/world-plots'
import { coinIconHtml, iconHtml } from './icons'
import { formatCoins } from './format'

/**
 * The land office: a surveyor's chart of the valley with every parcel on it.
 *
 * Marks in the world tell you a plot is for sale once you are looking at it.
 * They cannot tell you what else exists, what it costs, or which way to walk —
 * and a player deciding where to spend eight thousand coins wants all three at
 * once. A map answers those together, and it is the only view in the game from
 * directly overhead: the camera is clamped to a shallow farm-game pitch, so
 * there is no in-world shot that shows the shape of the valley.
 *
 * Two layers, on purpose. The terrain is *painted* into a canvas — sampled once
 * from the heightfield, shaded, contoured, and then cached forever, because it
 * is the one thing here that never changes. Everything that does change (the
 * parcels, the pins, the route line) is DOM on top of it, positioned in percent
 * so it scales with the canvas at any viewport. That split is what lets a parcel
 * hover, glow, pulse and take a click without a single pixel being redrawn.
 */

export interface LandPlotState {
  plot: WorldPlot
  owned: boolean
  buyable: boolean
  distance: number
}

/** A fixed place worth putting on the map so the player can orient by it. */
export interface LandMark {
  x: number
  z: number
  /** Icon id from ui/icons, with an emoji fallback. */
  icon: string
  emoji: string
  label: string
}

export interface LandMapActions {
  survey(): LandPlotState[]
  coins(): number
  price(): number
  buy(id: number): void
  /** Where the player is standing, drawn as a dot so the map is orientable. */
  playerPos(): THREE.Vector3
  farmCentre(): THREE.Vector3
  /** Village fixtures — optional, because the map reads fine without them. */
  landmarks?(): LandMark[]
}

/** World units shown. The valley is wider than this; the parcels are not. */
const VIEW = 130
/**
 * Canvas pixels per world unit.
 *
 * The map is drawn full screen and scaled to fit by CSS, so the backing store
 * only has to be big enough that the scaling is not visibly soft. Six is 608k
 * samples on first open — one heightfield lookup each, since the shading, the
 * slope and the contours are all differences taken *within* the sampled buffer
 * rather than fresh probes of the terrain. The old painter cost about seven
 * lookups a pixel for a flatter picture.
 */
const PX = 6
/** Height step between contour lines, in world units. */
const CONTOUR = 2

export class LandMapUi {
  private readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly pins: HTMLDivElement
  private readonly route: SVGSVGElement
  private readonly info: HTMLDivElement
  private readonly wallet: HTMLDivElement
  /** The painted terrain, sampled once and reused every open. */
  private terrain: ImageData | null = null
  private selected: number | null = null
  open = false

  constructor(private readonly actions: LandMapActions) {
    this.root = document.createElement('div')
    this.root.className = 'panel hidden'
    this.root.id = 'landMap'
    this.root.innerHTML = `
      <div class="panel-head">
        <h2><span class="lm-crest">🗺️</span> Land office</h2>
        <div class="lm-head-end">
          <div class="lm-wallet">${coinIconHtml('inline-ico')}<b>0</b></div>
          <button class="panel-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="land-body">
        <div class="land-plate">
          <div class="land-frame">
            <canvas class="land-canvas"></canvas>
            <div class="land-grain"></div>
            <svg class="land-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
            <div class="land-pins"></div>
            ${compassSvg()}
            <div class="land-scale"><span class="land-scale-bar"></span><b>20m</b></div>
          </div>
        </div>
        <aside class="land-side">
          <div class="land-info"></div>
        </aside>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.canvas = this.root.querySelector('.land-canvas') as HTMLCanvasElement
    this.canvas.width = Math.round(VIEW * PX)
    this.canvas.height = Math.round(VIEW * PX)
    this.pins = this.root.querySelector('.land-pins') as HTMLDivElement
    this.route = this.root.querySelector('.land-route') as SVGSVGElement
    this.info = this.root.querySelector('.land-info') as HTMLDivElement
    this.wallet = this.root.querySelector('.lm-wallet') as HTMLDivElement

    this.root.querySelector('.panel-close')!.addEventListener('click', () => this.hide())
    // Clicking bare ground is how you get back out of a selection.
    this.canvas.addEventListener('click', () => {
      if (this.selected === null) return
      this.selected = null
      this.render()
    })
  }

  show() {
    this.open = true
    this.selected = null
    this.root.classList.remove('hidden')
    this.paintTerrain()
    this.render()
  }

  /**
   * Throw the sampled terrain away.
   *
   * The cache is keyed on nothing — it assumes the heightfield never changes,
   * which is true — but a map cached from a frame where sampling failed would
   * stay blank for the rest of the session. Anything that suspects the picture
   * is wrong can ask for it to be taken again.
   */
  invalidate() {
    this.terrain = null
  }

  hide() {
    this.open = false
    this.root.classList.add('hidden')
  }

  /** World position to a percentage across the square map. */
  private pct(v: number) {
    return ((v + VIEW / 2) / VIEW) * 100
  }

  // --- the painted valley ----------------------------------------------------

  /**
   * Sample the heightfield once and shade it like a chart.
   *
   * Height alone gives the flat paint-by-numbers picture this replaced: four
   * colours, no form, and no way to tell a hill from a meadow. What reads as
   * terrain is the gradient — a hillshade from the north-west, contour lines
   * every couple of units, depth bands under the water and a foam line at the
   * shore. All four come out of the same buffer of samples, so the extra detail
   * costs arithmetic rather than another million probes of the noise field.
   */
  private paintTerrain() {
    const ctx = this.canvas.getContext('2d')!
    const w = this.canvas.width
    const h = this.canvas.height
    // A zero-sized backing store would cache an empty image forever.
    if (w === 0 || h === 0) return

    if (!this.terrain) {
      const farm = this.actions.farmCentre()
      const heights = new Float32Array(w * h)
      for (let py = 0; py < h; py++) {
        const z = py / PX - VIEW / 2
        for (let px = 0; px < w; px++) {
          heights[py * w + px] = heightAt(px / PX - VIEW / 2, z)
        }
      }

      const img = ctx.createImageData(w, h)
      // One world unit apart, matching the step the game's own slope test uses.
      const S = PX
      const at = (px: number, py: number) =>
        heights[Math.min(h - 1, Math.max(0, py)) * w + Math.min(w - 1, Math.max(0, px))]

      for (let py = 0; py < h; py++) {
        const z = py / PX - VIEW / 2
        for (let px = 0; px < w; px++) {
          const x = px / PX - VIEW / 2
          const i = py * w + px
          const y = heights[i]

          // Gradient in world units: rise per unit run, east-ward and south-ward.
          const dx = (at(px + S, py) - at(px - S, py)) / 2
          const dz = (at(px, py + S) - at(px, py - S)) / 2
          const slope = Math.hypot(dx, dz)

          let r: number
          let g: number
          let b: number

          if (y < WATER_LEVEL) {
            // Depth, eased so the shallows keep their range instead of all
            // going to one blue two metres out.
            const d = Math.min(1, (WATER_LEVEL - y) / 7) ** 0.65
            r = 92 + (24 - 92) * d
            g = 172 + (62 - 172) * d
            b = 198 + (112 - 198) * d
            // Sounding lines, like a chart.
            if (bandEdge(y, at(px - 1, py), at(px, py - 1), 2.5)) {
              r += 14
              g += 18
              b += 20
            }
            // Surf: the last hand's breadth before the waterline goes white.
            const surf = Math.max(0, 1 - (WATER_LEVEL - y) / 0.45)
            if (surf > 0) {
              const t = surf * surf * 0.8
              r += (238 - r) * t
              g += (250 - g) * t
              b += (252 - b) * t
            }
          } else if (y < WATER_LEVEL + 3.4 && isSand(x, z)) {
            // Wet sand darkens toward the water; dry dune is pale and grainy.
            const dry = Math.min(1, (y - WATER_LEVEL) / 1.6)
            r = 214 + 30 * dry
            g = 190 + 30 * dry
            b = 142 + 26 * dry
          } else if (slope > 0.72 || y > 13) {
            // Bare rock, going to snow at the tops of the ring.
            const snow = Math.min(1, Math.max(0, (y - 19) / 8))
            r = 138 + (238 - 138) * snow
            g = 130 + (243 - 130) * snow
            b = 118 + (250 - 118) * snow
          } else if (onLane(x, z)) {
            /*
             * The street and the market square, drawn from the same geometry
             * that builds them.
             *
             * Guessing at where the village is would have been the one error
             * this map cannot afford: the player knows that street. Packed dirt
             * running east to the square is the strongest orienting mark on the
             * chart — everything else is read against it.
             */
            r = 202
            g = 172
            b = 124
          } else if (inAnyPlot(x, z)) {
            // Fenced plots, tilled in rows so a farm reads as a farm.
            const row = Math.sin(z * 2.6) * 0.5 + 0.5
            r = 158 + row * 30
            g = 126 + row * 30
            b = 88 + row * 22
          } else if (Math.hypot(x - PASTURE_CENTRE.x, z - PASTURE_CENTRE.z) < PASTURE_RADIUS) {
            // Grazed grass: cropped short, so paler than the meadow around it.
            r = 158
            g = 196
            b = 108
          } else {
            /*
             * Meadow, and then woodland over most of it.
             *
             * A single flat green over sixty metres of valley is what made the
             * old map look like a diagram, and it was also a lie: everything
             * outside the village and the farm is forest, which is exactly why
             * a parcel has to be cleared before it can be farmed. Two scales of
             * noise do the work — broad patches for fields, a tighter one for
             * canopy — thinned out around the village and the farm so the open
             * ground the player actually walks stays open.
             */
            const t = Math.min(1, Math.max(0, (y - WATER_LEVEL) / 10))
            const patch = vnoise(x * 0.28, z * 0.28) - 0.5
            r = 112 + t * 52 + patch * 18
            g = 162 + t * 32 + patch * 15
            b = 78 + t * 24 + patch * 10

            const wood = vnoise(x * 0.13 + 40, z * 0.13 + 40) * 0.62 + vnoise(x * 0.5, z * 0.5) * 0.38
            const dense = Math.min(1, Math.max(0, (wood - 0.42) / 0.26)) * clearing(x, z)
            if (dense > 0) {
              // Canopy: a darker, bluer green, broken up by crown-sized blobs so
              // the mass has texture instead of being a stain.
              const crown = vnoise(x * 1.5, z * 1.5) - 0.5
              const k = dense * 0.86
              r += (50 + crown * 44 - r) * k
              g += (100 + crown * 50 - g) * k
              b += (46 + crown * 30 - b) * k
            }
          }

          if (y >= WATER_LEVEL) {
            // Hillshade from the north-west. Everything above gets its form here.
            const lit = 1 + (dx * -0.6 + dz * -0.8) * 1.15
            const k = Math.min(1.55, Math.max(0.48, lit))
            r *= k
            g *= k
            b *= k
            // Contours, drawn darker so they read as ink on the paint.
            if (bandEdge(y, at(px - 1, py), at(px, py - 1), CONTOUR)) {
              r *= 0.8
              g *= 0.8
              b *= 0.82
            }
          }

          // Paper grain, so nothing is ever a flat plate of colour.
          const grain = (((px * 73856093) ^ (py * 19349663)) & 15) - 7.5
          const o = i * 4
          img.data[o] = clamp255(r + grain * 0.55)
          img.data[o + 1] = clamp255(g + grain * 0.55)
          img.data[o + 2] = clamp255(b + grain * 0.55)
          img.data[o + 3] = 255
        }
      }
      this.terrain = img
    }
    ctx.putImageData(this.terrain, 0, 0)
  }

  // --- the overlay -----------------------------------------------------------

  private render() {
    const states = this.actions.survey()
    const farm = this.actions.farmCentre()
    const player = this.actions.playerPos()
    const size = (PLOT_SIZE / VIEW) * 100

    this.wallet.innerHTML = `${coinIconHtml('inline-ico')}<b>${formatCoins(this.actions.coins())}</b>`

    const marks = this.actions.landmarks?.() ?? []
    const parcels = states
      .map((s) => {
        const kind = s.owned ? 'owned' : s.buyable ? 'sale' : 'locked'
        const sel = s.plot.id === this.selected ? ' sel' : ''
        const badge = s.owned
          ? `<span class="lp-badge">✓</span>`
          : s.buyable
            ? `<span class="lp-tag">${coinIconHtml('lp-coin')}${formatCoins(this.actions.price())}</span>`
            : `<span class="lp-badge">${iconHtml('locked', '🔒', 'lp-lock')}</span>`
        return `<button class="lp lp-${kind}${sel}" data-id="${s.plot.id}"
            style="left:${this.pct(s.plot.x)}%;top:${this.pct(s.plot.z)}%;width:${size}%;height:${size}%"
            aria-label="Parcel ${s.plot.id + 1}">
            <span class="lp-face"></span>
            <span class="lp-num">${s.plot.id + 1}</span>
            ${badge}
          </button>`
      })
      .join('')

    const pins =
      marks
        .map(
          (m) =>
            `<div class="land-mark" style="left:${this.pct(m.x)}%;top:${this.pct(m.z)}%">
               <span class="land-mark-ico">${iconHtml(m.icon, m.emoji, 'land-mark-img')}</span>
               <span class="land-mark-label">${m.label}</span>
             </div>`,
        )
        .join('') +
      `<div class="land-home" style="left:${this.pct(farm.x)}%;top:${this.pct(farm.z)}%">
         <span class="land-home-ico">🏡</span>
         <span class="land-mark-label">Your farm</span>
       </div>
       <div class="land-you" style="left:${this.pct(player.x)}%;top:${this.pct(player.z)}%">
         <span class="land-you-ring"></span>
         <span class="land-you-dot"></span>
       </div>`

    this.pins.innerHTML = parcels + pins
    for (const el of Array.from(this.pins.querySelectorAll<HTMLButtonElement>('.lp'))) {
      el.addEventListener('click', () => {
        const id = Number(el.dataset.id)
        this.selected = this.selected === id ? null : id
        this.render()
      })
    }

    this.drawRoute(farm, states)
    this.drawInfo(states)
  }

  /**
   * A dashed line from the farm to whatever is selected.
   *
   * "31m north-east" is a fact about a parcel; a line drawn across the valley is
   * a route. It is the difference between reading the panel and knowing which
   * way to walk when it closes.
   */
  private drawRoute(farm: THREE.Vector3, states: LandPlotState[]) {
    const chosen = states.find((s) => s.plot.id === this.selected)
    if (!chosen) {
      this.route.innerHTML = ''
      return
    }
    const x1 = this.pct(farm.x)
    const y1 = this.pct(farm.z)
    const x2 = this.pct(chosen.plot.x)
    const y2 = this.pct(chosen.plot.z)
    // Bowed a little, so it reads as a drawn line rather than a CAD constraint.
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12
    const my = (y1 + y2) / 2 - (x2 - x1) * 0.12
    this.route.innerHTML =
      `<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" class="route-shadow"/>` +
      `<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" class="route-line"/>`
  }

  private drawInfo(states: LandPlotState[]) {
    const chosen = states.find((s) => s.plot.id === this.selected)
    const owned = states.filter((s) => s.owned).length

    if (!chosen) {
      const forSale = states.filter((s) => !s.owned && s.buyable).length
      const locked = states.length - owned - forSale
      /*
       * The empty state is a ledger, not a shrug.
       *
       * "Pick a parcel" on its own leaves the panel's whole right-hand side
       * saying nothing while the player is still working out what they are
       * looking at. The three counts are the same three states the map is
       * painted in, so this doubles as the key to the colours.
       */
      this.info.innerHTML =
        `<div class="lm-card lm-card-empty">
           <h3>Valley survey</h3>
           <div class="lm-progress">
             <div class="lm-progress-bar"><i style="width:${(owned / states.length) * 100}%"></i></div>
             <span><b>${owned}</b> of ${states.length} parcels owned</span>
           </div>
           <div class="lm-tally">
             <div class="lm-tally-row lm-row-owned"><span class="lm-swatch"></span><b>${owned}</b> yours</div>
             <div class="lm-tally-row lm-row-sale"><span class="lm-swatch"></span><b>${forSale}</b> for sale ·
               <span class="lm-tally-price">${coinIconHtml('inline-ico')}${formatCoins(this.actions.price())} each</span></div>
             <div class="lm-tally-row lm-row-locked"><span class="lm-swatch"></span><b>${locked}</b> out of reach</div>
           </div>
           <p class="land-hint">Tap a parcel on the map.</p>
           <p class="land-sub">${
             forSale > 0
               ? `Gold parcels border land you already hold.`
               : `Nothing is within reach yet — buy your way outward.`
           } The rest open up as you expand toward them.</p>
         </div>`
      return
    }

    const price = this.actions.price()
    const canAfford = this.actions.coins() >= price
    const compass = bearing(this.actions.farmCentre(), chosen.plot)

    this.info.innerHTML =
      `<div class="lm-card lm-card-${chosen.owned ? 'owned' : chosen.buyable ? 'sale' : 'locked'}">
         <div class="lm-card-head">
           <span class="lm-card-num">${chosen.plot.id + 1}</span>
           <div>
             <h3>Parcel ${chosen.plot.id + 1}</h3>
             <p class="land-sub">${Math.round(chosen.distance)}m ${compass} of your farm</p>
           </div>
         </div>
         <div class="lm-stats">
           <div class="lm-stat"><span>Room for</span><b>an 8 × 8 garden</b></div>
           <div class="lm-stat"><span>Ground</span><b>${chosen.owned ? 'cleared' : 'thick woodland'}</b></div>
         </div>` +
      (chosen.owned
        ? `<p class="land-owned">✓ Yours already</p>`
        : chosen.buyable
          ? `<div class="lm-price-row">
               <span class="land-sub">Asking price</span>
               <p class="land-price">${coinIconHtml('inline-ico')}${formatCoins(price)}</p>
             </div>
             <button class="land-buy${canAfford ? '' : ' disabled'}">${canAfford ? 'Buy this land' : 'Not enough coins'}</button>`
          : `<p class="land-locked">${iconHtml('locked', '🔒', 'lp-lock')} Too far from your land. Buy your way toward it first.</p>`) +
      `</div>`

    const buy = this.info.querySelector('.land-buy')
    if (buy && canAfford) {
      buy.addEventListener('click', () => {
        this.actions.buy(chosen.plot.id)
        this.render()
      })
    }
  }
}

/**
 * How wooded a spot should be drawn: 0 over the village, 1 out in the wild.
 *
 * The valley the player walks is forest everywhere except the ground the
 * village has cleared, and a map that puts canopy over the market square is
 * wrong in the one region they know by heart — which is the region they will
 * check the map against first. Measured off the same bounds the world
 * generator keeps its trees out of, so the two cannot disagree.
 */
function clearing(x: number, z: number) {
  const dx = Math.max(0, Math.abs(x - (VILLAGE_BOUNDS.minX + VILLAGE_BOUNDS.maxX) / 2) - (VILLAGE_BOUNDS.maxX - VILLAGE_BOUNDS.minX) / 2)
  const dz = Math.max(0, Math.abs(z - (VILLAGE_BOUNDS.minZ + VILLAGE_BOUNDS.maxZ) / 2) - (VILLAGE_BOUNDS.maxZ - VILLAGE_BOUNDS.minZ) / 2)
  return ramp(Math.hypot(dx, dz), 1, 13)
}

/** Smoothstep from 0 at `inner` to 1 at `outer`. */
function ramp(d: number, inner: number, outer: number) {
  const t = (d - inner) / (outer - inner)
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** True where a value crosses a multiple of `step` from either neighbour. */
function bandEdge(y: number, left: number, up: number, step: number) {
  const b = Math.floor(y / step)
  return b !== Math.floor(left / step) || b !== Math.floor(up / step)
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Cheap smooth value noise — meadow patching only, never geometry. */
function hash2(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Rough compass direction, so the readout says where to walk. */
function bearing(from: THREE.Vector3, to: WorldPlot) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) > Math.abs(dz) * 2) return dx > 0 ? 'east' : 'west'
  if (Math.abs(dz) > Math.abs(dx) * 2) return dz > 0 ? 'south' : 'north'
  return `${dz > 0 ? 'south' : 'north'}-${dx > 0 ? 'east' : 'west'}`
}

/**
 * The rose in the corner.
 *
 * Every map the player has ever seen has one, and its absence is felt long
 * before it is noticed — it is most of what makes a green square with boxes on
 * it read as a *chart* rather than as a debug view of a heightfield.
 */
function compassSvg() {
  return `<svg class="land-compass" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="45" class="cp-ring"/>
    <circle cx="50" cy="50" r="36" class="cp-ring cp-ring-thin"/>
    <g class="cp-star">
      <path d="M50 8 L58 42 L50 50 L42 42 Z" class="cp-n"/>
      <path d="M50 92 L42 58 L50 50 L58 58 Z"/>
      <path d="M8 50 L42 42 L50 50 L42 58 Z"/>
      <path d="M92 50 L58 58 L50 50 L58 42 Z"/>
      <path d="M22 22 L47 44 L44 47 Z" class="cp-minor"/>
      <path d="M78 22 L56 47 L53 44 Z" class="cp-minor"/>
      <path d="M78 78 L53 56 L56 53 Z" class="cp-minor"/>
      <path d="M22 78 L44 53 L47 56 Z" class="cp-minor"/>
    </g>
    <text x="50" y="6" class="cp-label">N</text>
  </svg>`
}
