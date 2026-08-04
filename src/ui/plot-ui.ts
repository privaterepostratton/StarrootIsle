import type { Tile } from '../game/farm'
import type { Inventory } from '../game/inventory'
import { CROPS } from '../game/crops'
import { produceValue } from '../game/mutations'
import { Input } from '../core/input'
import { swallowWorldClick, backdropClickSwallowed } from '../core/click-guard'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'

/**
 * Per-plot action menu. Opens when the farmer reaches a plot the player
 * clicked, listing everything that can be done to it right now.
 *
 * The menu is rebuilt from tile state every time it opens rather than being
 * kept in sync, because a crop can ripen while the panel is on screen.
 */

export interface PlotActions {
  plant(tile: Tile): void
  water(tile: Tile): void
  harvest(tile: Tile): void
  instantGrow(tile: Tile, cost: number): void
  /** Rewarded-ad instant grow (free). Hidden when ads unavailable. */
  canWatchAd?: () => boolean
  watchInstantGrow?: (tile: Tile) => void
}

/** Coins to skip the remaining growth on a crop. Scales with what is left, so
 *  topping off a nearly-ripe crop is cheap and skipping a fresh one is not. */
export function instantGrowCost(tile: Tile) {
  const crop = tile.crop
  if (!crop) return 0
  const remaining = 1 - crop.progress
  return Math.max(2, Math.ceil(crop.def.sellPrice * remaining * 0.8))
}

/** Projects a world position to CSS pixels, or null when behind the camera. */
export type ScreenProjector = (world: { x: number; y: number; z: number }) => { x: number; y: number } | null

export class PlotUi {
  /** Set by main once the engine exists; anchors the card beside the crop. */
  projector: ScreenProjector | null = null

  private readonly root: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private readonly body: HTMLDivElement
  private tile: Tile | null = null

  open = false

  constructor(
    private readonly inventory: Inventory,
    readonly actions: PlotActions,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'plotMenu'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel plot-panel">
        <header><h2 id="plotTitle">Plot</h2><button id="plotClose">✕</button></header>
        <div id="plotBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.title = this.root.querySelector('#plotTitle')!
    this.body = this.root.querySelector('#plotBody')!

    this.root.querySelector('#plotClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    inventory.onChange(() => {
      if (this.open) this.render()
    })
  }

  show(tile: Tile) {
    this.tile = tile
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
    this.reposition()
  }

  close() {
    this.open = false
    this.tile = null
    this.root.classList.add('hidden')
    Input.clear()
  }

  /**
   * Pin the card beside the plot's screen position.
   *
   * Beside, not over: the card exists to describe the plant, so covering the
   * plant with it defeated the click. Preferred side is the right; it flips
   * left when the plot sits near the right edge, and clamps so the card never
   * leaves the viewport however close to a corner the plot is.
   */
  reposition() {
    if (!this.open || !this.tile || !this.projector) return
    const panel = this.root.querySelector<HTMLElement>('.plot-panel')
    if (!panel) return
    const at = this.projector(this.tile.pos)
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
   * Called each frame so a crop ripening while the menu is open updates it.
   *
   * The rebuild is gated on a signature of everything the panel displays.
   * Rebuilding unconditionally destroyed and recreated the buttons ~60 times a
   * second, and a click only fires when pointerdown and pointerup land on the
   * *same node* — so buttons ate almost every real click while looking
   * perfectly normal. Synthetic `element.click()` in tests still worked, which
   * is what let the bug hide.
   */
  refresh() {
    if (!this.open || !this.tile) return
    // Track the camera every frame — cheap, two style writes.
    this.reposition()
    const sig = this.signature(this.tile)
    if (sig === this.lastSignature) return
    this.render()
  }

  /** Everything render() draws, flattened. If this is unchanged, so is the UI. */
  private signature(tile: Tile) {
    const crop = tile.crop
    const seed = this.inventory.selectedCrop
    const counts = CROPS.map((c) => this.inventory.seedCount(c.id)).join(',')
    return [
      tile.placed ? 1 : 0,
      crop?.def.id ?? '',
      crop ? Math.round(crop.progress * 100) : -1,
      tile.water > 0 ? 1 : 0,
      seed.id,
      counts,
      crop ? (this.inventory.coins >= instantGrowCost(tile) ? 1 : 0) : 0,
      crop ? crop.rarity + ':' + crop.mutations.size : '',
    ].join('|')
  }

  private lastSignature = ''

  private button(
    icon: string,
    label: string,
    sub: string,
    enabled: boolean,
    onClick: () => void,
    opts?: { paid?: boolean; closeAfter?: boolean },
  ) {
    const btn = document.createElement('button')
    btn.className = opts?.paid ? 'plot-action paid' : 'plot-action'
    btn.disabled = !enabled
    btn.innerHTML =
      `${icon}<span class="pa-label">${label}</span><span class="pa-sub">${sub}</span>`
    btn.addEventListener('click', () => {
      // This gesture belongs to the panel. Block the world from also seeing it
      // — the click otherwise lands on the plot underneath as the menu closes.
      swallowWorldClick()
      onClick()
      /*
       * Harvesting is terminal for a plot: the crop the panel was opened to
       * discuss no longer exists. Re-rendering instead left the menu sitting
       * there showing planting options, which reads as it having reopened by
       * itself. Every other action (water, plant, ripen) changes what is
       * possible next, so those re-derive in place.
       */
      if (opts?.closeAfter) this.close()
      else if (this.tile) this.render()
    })
    this.body.appendChild(btn)
    return btn
  }

  private render() {
    const tile = this.tile
    if (!tile) return
    this.lastSignature = this.signature(tile)

    this.body.innerHTML = ''

    if (!tile.placed) {
      this.title.textContent = 'Empty ground'
      this.body.innerHTML = `<div class="empty-msg">Equip the shovel to buy a plot here.</div>`
      return
    }

    const crop = tile.crop
    this.title.innerHTML = crop
      ? `${iconHtml(crop.def.id, crop.def.emoji, 'title-ico')} ${crop.def.name}`
      : 'Plot'

    if (!crop) {
      const seed = this.inventory.selectedCrop
      const have = this.inventory.seedCount(seed.id)
      this.button(
        iconHtml(seed.id, seed.emoji, 'btn-ico'),
        `Plant ${seed.name}`,
        have > 0 ? `${have} seed${have === 1 ? '' : 's'} in your bag` : 'No seeds — buy at shop',
        have > 0,
        () => this.actions.plant(tile),
      )

      // Quick-switch to any other seed the player is actually carrying.
      const others = CROPS.filter((c) => c.id !== seed.id && this.inventory.seedCount(c.id) > 0)
      if (others.length) {
        const row = document.createElement('div')
        row.className = 'plot-seeds'
        row.innerHTML = `<span class="pa-sub">Switch seed:</span>`
        for (const c of others) {
          const chip = document.createElement('button')
          chip.className = 'seed-chip'
          chip.innerHTML = `${iconHtml(c.id, c.emoji, 'seed-ico')}<b>${this.inventory.seedCount(c.id)}</b>`
          chip.title = c.name
          chip.addEventListener('click', () => this.inventory.select(CROPS.indexOf(c)))
          row.appendChild(chip)
        }
        this.body.appendChild(row)
      }

      if (tile.water <= 0) {
        this.button(
          iconHtml('water', '💧', 'btn-ico'),
          'Water',
          'Double growth',
          true,
          () => this.actions.water(tile),
        )
      }
      return
    }

    const pct = Math.round(crop.progress * 100)
    if (crop.progress >= 1) {
      this.button(
        iconHtml('harvest', '🧺', 'btn-ico'),
        'Harvest',
        /*
         * The estimate uses the full pricing pipeline — rarity and mutations
         * included — not the raw catalogue price. A golden mutated crop worth
         * ten times list showing its base price made the panel look broken
         * exactly when the player had something worth reading it for. Weight is
         * shown at its expected value; the actual roll happens at harvest.
         */
        `+${crop.def.yield} ${iconHtml(crop.def.id, crop.def.emoji, 'inline-ico')} · ~${(crop.def.baseWeight * crop.def.yield).toFixed(1)}kg · ${coinIconHtml('inline-ico')}${formatCoins(Math.round(produceValue(crop.def, crop.rarity, crop.mutations) * crop.def.yield))}`,
        true,
        () => {
          this.actions.harvest(tile)
        },
        { closeAfter: true },
      )
      return
    }

    const bar = document.createElement('div')
    bar.className = 'plot-progress'
    bar.innerHTML = `<div class="pp-fill" style="width:${pct}%"></div><span>${pct}% grown</span>`
    this.body.appendChild(bar)

    if (tile.water <= 0) {
      this.button(
        iconHtml('water', '💧', 'btn-ico'),
        'Water',
        'Double growth',
        true,
        () => this.actions.water(tile),
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

    const cost = instantGrowCost(tile)
    this.button(
      iconHtml('bolt', '⚡', 'btn-ico'),
      'Instant grow',
      `${coinIconHtml('inline-ico')}${formatCoins(cost)} — ripen now`,
      this.inventory.coins >= cost,
      () => this.actions.instantGrow(tile, cost),
      { paid: true },
    )

    if (this.actions.canWatchAd?.() && this.actions.watchInstantGrow) {
      this.button(
        iconHtml('bolt', '⚡', 'btn-ico'),
        'Watch & grow',
        'Free — watch a short video',
        true,
        () => this.actions.watchInstantGrow!(tile),
      )
    }
  }
}
