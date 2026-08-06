import { PLOT_BUILDS, type PlotBuildDef, type PlotBuildId, type WorldPlots } from '../game/world-plots'
import type { Inventory } from '../game/inventory'
import type { Progression } from '../game/progression'
import { MATERIAL_BY_ID } from '../game/materials'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'
import { asset } from '../core/assets'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * The workbench on a bought parcel: what shall we build here?
 *
 * A cleared plot is thousands of coins of ground with a bench standing on it,
 * and until now the bench was scenery — the land was bought and then did
 * nothing. This is the decision it was always standing in for.
 *
 * A grid rather than the shop's list, because these are three *places* being
 * compared and not three prices: the choice is made on what the ground will
 * look like and what it pays in, which wants the picture and the yield side by
 * side at a glance. The same panel serves a plot that is already built, where
 * it becomes a status card — walking out to your orchard and being told nothing
 * about it would be the same mistake the bare bench was.
 */
export class PlotBuildUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly title: HTMLElement
  /** Which parcel is open. Null when the panel is closed. */
  private plotId: number | null = null

  open = false

  constructor(
    private readonly plots: WorldPlots,
    private readonly inventory: Inventory,
    private readonly progression: Progression,
    private readonly onBuild: (id: number, build: PlotBuildDef) => void,
    private readonly onCollect: (id: number) => void,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'plotBuild'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2 id="buildTitle">🔨 Workbench</h2><button id="buildClose">✕</button></header>
        <div id="buildBody"></div>
        <footer><span class="wallet"><img class="ico-img" src="${asset('ui/coin.png')}" alt="" draggable="false"> <b id="buildCoins">0</b></span></footer>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#buildBody')!
    this.title = this.root.querySelector('#buildTitle')!
    this.root.querySelector('#buildClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    inventory.onChange(() => {
      if (this.open) this.render()
    })
  }

  show(plotId: number) {
    this.plotId = plotId
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
  }

  close() {
    this.open = false
    this.plotId = null
    this.root.classList.add('hidden')
    Input.clear()
  }

  /** Repaint, so a plot filling while the panel is open shows it. */
  refresh() {
    if (this.open) this.render()
  }

  private render() {
    if (this.plotId === null) return
    ;(this.root.querySelector('#buildCoins') as HTMLElement).textContent = formatCoins(
      this.inventory.coins,
    )
    this.title.innerHTML = `🔨 Parcel ${this.plotId + 1}`
    this.body.innerHTML = ''

    const standing = this.plots.buildOn(this.plotId)
    if (standing) {
      this.body.appendChild(this.statusCard(standing))
      return
    }

    const grid = document.createElement('div')
    grid.className = 'build-grid'
    for (const def of PLOT_BUILDS) grid.appendChild(this.buildCard(def))
    this.body.appendChild(grid)
  }

  /** One choice: what it looks like, what it pays, what it costs. */
  private buildCard(def: PlotBuildDef) {
    const locked = this.progression.level < def.unlockLevel
    const affordable = this.inventory.coins >= def.price
    const card = document.createElement('div')
    card.className = `build-card${locked ? ' locked' : ''}`
    card.innerHTML = `
      <div class="build-ico">${locked ? iconHtml('locked', '🔒') : iconHtml(def.icon, def.emoji)}</div>
      <div class="build-name">${def.name}</div>
      <p class="build-blurb">${locked ? `Unlocks at level ${def.unlockLevel}` : def.blurb}</p>
      <div class="build-yield">${yieldLine(def)}</div>`

    if (!locked) {
      const buy = document.createElement('button')
      buy.className = 'buy'
      buy.innerHTML = `${coinIconHtml('inline-ico')} ${formatCoins(def.price)}`
      buy.disabled = !affordable
      buy.addEventListener('click', () => {
        if (this.plotId === null) return
        this.onBuild(this.plotId, def)
        this.render()
      })
      card.appendChild(buy)
    }
    return card
  }

  /** A plot that is already something: how far along, and the basket. */
  private statusCard(def: PlotBuildDef) {
    const state = this.plots.progressOf(this.plotId ?? -1)
    const card = document.createElement('div')
    card.className = 'build-status'
    card.innerHTML = `
      <div class="build-ico big">${iconHtml(def.icon, def.emoji)}</div>
      <div class="build-name">${def.name}</div>
      <p class="build-blurb">${def.blurb}</p>
      <div class="build-bar"><i style="width:${Math.round(state * 100)}%"></i></div>
      <div class="build-yield">${yieldLine(def)}</div>`

    const collect = document.createElement('button')
    collect.className = 'buy'
    collect.disabled = state < 1
    collect.innerHTML =
      state < 1
        ? `Ripening — ${Math.round(state * 100)}%`
        : `${iconHtml('harvest', '🧺', 'inline-ico')} Collect`
    collect.addEventListener('click', () => {
      if (this.plotId === null) return
      this.onCollect(this.plotId)
      this.render()
    })
    card.appendChild(collect)
    return card
  }
}

/**
 * "🪵 8 Wood · 🪙120 every 5m" — the two numbers a choice is made on.
 *
 * Each part is its own nowrap span. Left as plain text the line broke between
 * a coin icon and its own figure, which reads for a moment as a price of
 * nothing at all.
 */
function yieldLine(def: PlotBuildDef) {
  const parts: string[] = []
  if (def.yield.material) {
    const mat = MATERIAL_BY_ID.get(def.yield.material.id)
    parts.push(
      `${iconHtml(def.yield.material.id, mat?.emoji ?? '📦', 'inline-ico')} ${def.yield.material.amount} ${mat?.name ?? ''}`,
    )
  }
  if (def.yield.coins > 0) parts.push(`${coinIconHtml('inline-ico')}${formatCoins(def.yield.coins)}`)
  parts.push(`every ${fmt(def.interval)}`)
  return parts.map((p) => `<span class="yield-part">${p}</span>`).join('<i class="yield-dot">·</i>')
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}

export type { PlotBuildId }
