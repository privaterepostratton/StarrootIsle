import * as THREE from 'three'
import { heightAt, isWalkable, isSand, WATER_LEVEL } from '../game/terrain'
import { PLOT_SIZE, type WorldPlot } from '../game/world-plots'
import { coinIconHtml } from './icons'
import { formatCoins } from './format'

/**
 * The land office: a plan view of the valley with every parcel on it.
 *
 * Marks in the world tell you a plot is for sale once you are looking at it.
 * They cannot tell you what else exists, what it costs, or which way to walk —
 * and a player deciding where to spend eight thousand coins wants all three at
 * once. A map answers those together, and it is the only view in the game from
 * directly overhead: the camera is clamped to a shallow farm-game pitch, so
 * there is no in-world shot that shows the shape of the valley.
 *
 * The terrain is sampled once and cached. It is a heightfield lookup per pixel,
 * which is fine as a one-off when the panel opens and would not be fine per
 * frame.
 */

export interface LandPlotState {
  plot: WorldPlot
  owned: boolean
  buyable: boolean
  distance: number
}

export interface LandMapActions {
  survey(): LandPlotState[]
  coins(): number
  price(): number
  buy(id: number): void
  /** Where the player is standing, drawn as a dot so the map is orientable. */
  playerPos(): THREE.Vector3
  farmCentre(): THREE.Vector3
}

/** World units shown. The valley is wider than this; the parcels are not. */
const VIEW = 130
/**
 * Canvas pixels per world unit.
 *
 * The map is drawn full screen and scaled to fit by CSS, so the backing store
 * only has to be big enough that the scaling is not visibly soft. It is also a
 * heightfield lookup per pixel: five is about 420,000 samples on first open,
 * which is a beat and then cached forever. Doubling it would quadruple that for
 * a map nobody reads at pixel level.
 */
const PX = 5

export class LandMapUi {
  private readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly info: HTMLDivElement
  /** The sampled terrain, painted once and reused every open. */
  private terrain: ImageData | null = null
  private selected: number | null = null
  open = false

  constructor(private readonly actions: LandMapActions) {
    this.root = document.createElement('div')
    this.root.className = 'panel hidden'
    this.root.id = 'landMap'
    this.root.innerHTML = `
      <div class="panel-head">
        <h2>🗺️ Land office</h2>
        <button class="panel-close" aria-label="Close">✕</button>
      </div>
      <div class="land-body">
        <canvas class="land-canvas"></canvas>
        <div class="land-info"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.canvas = this.root.querySelector('.land-canvas') as HTMLCanvasElement
    this.canvas.width = Math.round(VIEW * PX)
    this.canvas.height = Math.round(VIEW * PX)
    this.info = this.root.querySelector('.land-info') as HTMLDivElement

    this.root.querySelector('.panel-close')!.addEventListener('click', () => this.hide())
    this.canvas.addEventListener('click', (e) => this.onClick(e))
  }

  show() {
    this.open = true
    this.selected = null
    this.root.classList.remove('hidden')
    this.draw()
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

  private worldToCanvas(x: number, z: number) {
    return { px: (x + VIEW / 2) * PX, py: (z + VIEW / 2) * PX }
  }

  private canvasToWorld(px: number, py: number) {
    return { x: px / PX - VIEW / 2, z: py / PX - VIEW / 2 }
  }

  private onClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    // The canvas is laid out by CSS and may not be its backing-store size.
    const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width
    const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height
    const { x, z } = this.canvasToWorld(px, py)

    const half = PLOT_SIZE / 2
    const hit = this.actions
      .survey()
      .find((s) => Math.abs(x - s.plot.x) <= half && Math.abs(z - s.plot.z) <= half)
    this.selected = hit ? hit.plot.id : null
    this.draw()
  }

  /** Sample the heightfield once. Same colours as the dev board map. */
  private paintTerrain(ctx: CanvasRenderingContext2D) {
    if (!this.terrain) {
      const w = this.canvas.width
      const h = this.canvas.height
      // A zero-sized backing store would cache an empty image forever.
      if (w === 0 || h === 0) return
      const img = ctx.createImageData(w, h)
      for (let py = 0; py < h; py++) {
        const z = py / PX - VIEW / 2
        for (let px = 0; px < w; px++) {
          const x = px / PX - VIEW / 2
          const height = heightAt(x, z)
          let r: number
          let g: number
          let b: number
          if (height < WATER_LEVEL) {
            r = 38
            g = 96
            b = 168
          } else if (isSand(x, z)) {
            r = 222
            g = 198
            b = 136
          } else if (!isWalkable(x, z)) {
            r = 112
            g = 108
            b = 102
          } else {
            const t = Math.min(1, Math.max(0, (height + 2) / 13))
            r = 92 + t * 52
            g = 150 + t * 38
            b = 72 + t * 26
          }
          const i = (py * w + px) * 4
          img.data[i] = r
          img.data[i + 1] = g
          img.data[i + 2] = b
          img.data[i + 3] = 255
        }
      }
      this.terrain = img
    }
    ctx.putImageData(this.terrain, 0, 0)
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')!
    this.paintTerrain(ctx)

    const half = PLOT_SIZE / 2
    const states = this.actions.survey()
    const farm = this.actions.farmCentre()

    // Home first, so a plot drawn over it still reads on top.
    const home = this.worldToCanvas(farm.x, farm.z)
    ctx.fillStyle = 'rgba(255, 208, 98, 0.85)'
    ctx.strokeStyle = '#fff8e0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(home.px, home.py, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    for (const s of states) {
      const a = this.worldToCanvas(s.plot.x - half, s.plot.z - half)
      const w = PLOT_SIZE * PX
      /*
       * Three states, three weights. Owned is solid and quiet — it is yours and
       * needs no attention. Buyable is bright, because it is the only thing on
       * this map the player can act on. Out of reach is dim: still drawn, so
       * they can see the shape of what is coming, but plainly not an option yet.
       */
      if (s.owned) {
        ctx.fillStyle = 'rgba(150, 240, 170, 0.4)'
        ctx.strokeStyle = 'rgba(190, 255, 205, 0.9)'
      } else if (s.buyable) {
        ctx.fillStyle = 'rgba(255, 220, 120, 0.35)'
        ctx.strokeStyle = '#ffd062'
      } else {
        ctx.fillStyle = 'rgba(30, 30, 30, 0.35)'
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
      }
      ctx.lineWidth = s.plot.id === this.selected ? 4 : 2
      ctx.fillRect(a.px, a.py, w, w)
      ctx.strokeRect(a.px, a.py, w, w)
    }

    // The player, so the map can be read against where they are standing.
    const p = this.actions.playerPos()
    const dot = this.worldToCanvas(p.x, p.z)
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(dot.px, dot.py, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    this.drawInfo(states)
  }

  private drawInfo(states: LandPlotState[]) {
    const chosen = states.find((s) => s.plot.id === this.selected)
    if (!chosen) {
      const left = states.filter((s) => !s.owned).length
      this.info.innerHTML =
        `<p class="land-hint">Pick a parcel on the map.</p>` +
        `<p class="land-sub">${states.length - left} owned · ${left} still for sale</p>` +
        `<p class="land-sub">Gold parcels are within reach of land you already hold. ` +
        `The rest open up as you expand toward them.</p>`
      return
    }

    const price = this.actions.price()
    const canAfford = this.actions.coins() >= price
    const compass = bearing(this.actions.farmCentre(), chosen.plot)

    this.info.innerHTML =
      `<h3>Parcel ${chosen.plot.id + 1}</h3>` +
      `<p class="land-sub">${Math.round(chosen.distance)}m ${compass} of your farm</p>` +
      (chosen.owned
        ? `<p class="land-owned">Yours already</p>`
        : chosen.buyable
          ? `<p class="land-price">${coinIconHtml('inline-ico')}${formatCoins(price)}</p>` +
            `<button class="land-buy${canAfford ? '' : ' disabled'}">${canAfford ? 'Buy this land' : 'Not enough coins'}</button>`
          : `<p class="land-locked">Too far from your land. Expand toward it first.</p>`)

    const buy = this.info.querySelector('.land-buy')
    if (buy && canAfford) {
      buy.addEventListener('click', () => {
        this.actions.buy(chosen.plot.id)
        this.draw()
      })
    }
  }
}

/** Rough compass direction, so the readout says where to walk. */
function bearing(from: THREE.Vector3, to: WorldPlot) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) > Math.abs(dz) * 2) return dx > 0 ? 'east' : 'west'
  if (Math.abs(dz) > Math.abs(dx) * 2) return dz > 0 ? 'south' : 'north'
  return `${dz > 0 ? 'south' : 'north'}-${dx > 0 ? 'east' : 'west'}`
}
