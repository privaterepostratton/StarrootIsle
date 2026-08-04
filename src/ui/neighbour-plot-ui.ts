import type { Neighbour, NeighbourPlot } from '../game/neighbours'
import { growSecondsFor } from '../game/crops'
import { RARITY_BY_ID } from '../game/mutations'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'

/**
 * Inspect one of a neighbour's crops.
 *
 * The player can already water a neighbour's field wholesale from the valley
 * menu, but that treats their farm as a chore list. Being able to click a single
 * plant and be told what it is, how far along it is and how long it has left
 * turns the row of farms opposite into something worth looking at — and gives
 * the crops the player has never unlocked a place to be seen up close.
 *
 * Deliberately *not* a harvest panel. The produce is theirs; what is on offer
 * here is helping, and what the player gets back is friendship.
 */

export interface NeighbourPlotActions {
  water(neighbour: Neighbour, plot: NeighbourPlot): void
  /** Finish the crop for them, for coins. */
  ripen(neighbour: Neighbour, plot: NeighbourPlot, cost: number): void
  coins(): number
  /** Rewarded-ad ripen (free). Hidden when ads unavailable. */
  canWatchAd?: () => boolean
  watchRipen?: (neighbour: Neighbour, plot: NeighbourPlot) => void
}

/**
 * Coins to finish someone else's crop.
 *
 * Priced off what the plant is worth and how much is left, like the player's own
 * instant-grow, but at a premium — the return is friendship rather than produce,
 * so it should read as a gift rather than as a trade.
 */
export function ripenCost(plot: NeighbourPlot) {
  const remaining = 1 - plot.progress
  return Math.max(5, Math.ceil(plot.def.sellPrice * plot.def.yield * remaining * 1.1))
}

/** Seconds until this plot ripens at its current watering. */
export function secondsLeft(plot: NeighbourPlot) {
  const rate = plot.watered ? 2 : 1
  return ((1 - plot.progress) * growSecondsFor(plot.def)) / rate
}

function duration(seconds: number) {
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

import type { ScreenProjector } from './plot-ui'
import { backdropClickSwallowed } from '../core/click-guard'

export class NeighbourPlotUi {
  /** Set by main once the engine exists; anchors the card beside the crop. */
  projector: ScreenProjector | null = null

  private readonly root: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private readonly body: HTMLDivElement

  private neighbour: Neighbour | null = null
  private plot: NeighbourPlot | null = null

  open = false

  constructor(private readonly actions: NeighbourPlotActions) {
    this.root = document.createElement('div')
    this.root.id = 'neighbourPlotMenu'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel plot-panel">
        <header><h2 id="npTitle">Crop</h2><button id="npClose">✕</button></header>
        <div id="npBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.title = this.root.querySelector('#npTitle')!
    this.body = this.root.querySelector('#npBody')!

    this.root.querySelector('#npClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })
  }

  show(neighbour: Neighbour, plot: NeighbourPlot) {
    this.neighbour = neighbour
    this.plot = plot
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
    this.reposition()
  }

  close() {
    this.open = false
    this.neighbour = null
    this.plot = null
    this.root.classList.add('hidden')
    Input.clear()
  }

  /** Same side-anchoring as PlotUi — see the note there. */
  reposition() {
    if (!this.open || !this.plot || !this.projector) return
    const panel = this.root.querySelector<HTMLElement>('.plot-panel')
    if (!panel) return
    const at = this.projector(this.plot.pos)
    if (!at) return

    const w = panel.offsetWidth
    const h = panel.offsetHeight
    const gap = 46
    let left = at.x + gap
    if (left + w > innerWidth - 12) left = at.x - gap - w
    let top = at.y - h / 2
    left = Math.max(12, Math.min(left, innerWidth - w - 12))
    top = Math.max(12, Math.min(top, innerHeight - h - 12))
    panel.style.left = `${Math.round(left)}px`
    panel.style.top = `${Math.round(top)}px`
  }

  /**
   * Called each frame, so the countdown ticks while the panel is open.
   *
   * Gated on a signature of what is displayed — same fix as PlotUi. Rebuilding
   * the DOM every frame replaces the buttons between the player's pointerdown
   * and pointerup, which stops `click` from ever firing. The countdown label
   * only needs a rebuild when its rounded value actually changes.
   */
  refresh() {
    if (!this.open || !this.plot) return
    this.reposition()
    const sig = this.signature(this.plot)
    if (sig === this.lastSignature) return
    this.render()
  }

  private signature(plot: NeighbourPlot) {
    return [
      plot.def.id,
      Math.round(plot.progress * 100),
      plot.watered ? 1 : 0,
      plot.progress < 1 ? duration(secondsLeft(plot)) : '',
      plot.progress < 1 && this.actions.coins() >= ripenCost(plot) ? 1 : 0,
    ].join('|')
  }

  private lastSignature = ''

  private button(
    icon: string,
    label: string,
    sub: string,
    enabled: boolean,
    onClick: () => void,
    opts?: { paid?: boolean },
  ) {
    const btn = document.createElement('button')
    btn.className = opts?.paid ? 'plot-action paid' : 'plot-action'
    btn.disabled = !enabled
    btn.innerHTML =
      `${icon}<span class="pa-label">${label}</span><span class="pa-sub">${sub}</span>`
    btn.addEventListener('click', () => {
      onClick()
      if (this.plot) this.render()
    })
    this.body.appendChild(btn)
    return btn
  }

  private render() {
    const { neighbour, plot } = this
    if (!neighbour || !plot) return
    this.lastSignature = this.signature(plot)

    const def = plot.def
    const rarity = RARITY_BY_ID.get(plot.rarity)
    this.title.innerHTML = `${iconHtml(def.id, def.emoji, 'title-ico')} ${def.name}`

    this.body.innerHTML = ''

    const owner = document.createElement('div')
    owner.className = 'np-owner'
    // Common crops carry no rarity colour, so they get no tag rather than a
    // colourless one.
    const rarityTag =
      rarity?.color != null
        ? ` · <b style="color:#${rarity.color.toString(16).padStart(6, '0')}">${rarity.name}</b>`
        : ''
    owner.innerHTML = `${neighbour.profile.name}'s field${rarityTag}`
    this.body.appendChild(owner)

    if (plot.progress >= 1) {
      const note = document.createElement('div')
      note.className = 'empty-msg'
      note.textContent = `Ripe — ${neighbour.profile.name} will pick it before long.`
      this.body.appendChild(note)
      return
    }

    const pct = Math.round(plot.progress * 100)
    const bar = document.createElement('div')
    bar.className = 'plot-progress'
    bar.innerHTML =
      `<div class="pp-fill" style="width:${pct}%"></div>` +
      `<span>${pct}% · ready in ${duration(secondsLeft(plot))}</span>`
    this.body.appendChild(bar)

    if (!plot.watered) {
      this.button(
        iconHtml('water', '💧', 'btn-ico'),
        'Water it',
        'Double growth',
        true,
        () => this.actions.water(neighbour, plot),
      )
    } else {
      this.button(
        iconHtml('water', '💧', 'btn-ico'),
        'Watered',
        'double speed',
        false,
        () => {},
      )
    }

    const cost = ripenCost(plot)
    this.button(
      iconHtml('bolt', '⚡', 'btn-ico'),
      'Finish it',
      `${coinIconHtml('inline-ico')}${formatCoins(cost)}`,
      this.actions.coins() >= cost,
      () => this.actions.ripen(neighbour, plot, cost),
      { paid: true },
    )

    if (this.actions.canWatchAd?.() && this.actions.watchRipen) {
      this.button(
        iconHtml('bolt', '⚡', 'btn-ico'),
        'Watch & finish',
        'Free favour — watch a short video',
        true,
        () => this.actions.watchRipen!(neighbour, plot),
      )
    }
  }
}
