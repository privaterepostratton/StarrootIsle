import type { Neighbour, Neighbourhood } from '../game/neighbours'
import type { Progression } from '../game/progression'
import { stackValue, type Inventory } from '../game/inventory'
import { heldFor, type Trading, type TradeOffer } from '../game/trading'
import type { Requests, NeighbourRequest } from '../game/requests'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * The valley roster — you plus five neighbours, the "six in a world" view.
 *
 * Doubles as a leaderboard: everyone's level and best find sits in one list,
 * with the player's own row inlined in rank order. Seeing Odette three levels
 * above you with a Rainbow Dragonfruit is the whole motivation loop.
 */

export interface NeighbourCallbacks {
  visit(neighbour: Neighbour): void
  water(neighbour: Neighbour): void
  claimGift(neighbour: Neighbour): void
  trade(neighbour: Neighbour, offer: TradeOffer): void
  deliver(neighbour: Neighbour, request: NeighbourRequest): void
}

interface Row {
  name: string
  level: number
  best: string
  bestValue: number
  isPlayer: boolean
  neighbour?: Neighbour
}

export class NeighbourUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement

  open = false

  constructor(
    private readonly hood: Neighbourhood,
    private readonly progression: Progression,
    private readonly inventory: Inventory,
    private readonly trading: Trading,
    private readonly requests: Requests,
    private readonly callbacks: NeighbourCallbacks,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'neighbourPanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2>${iconHtml('valley', '🏘️', 'title-ico')} Starroot Isle</h2><button id="neighbourClose">✕</button></header>
        <div id="neighbourBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#neighbourBody')!
    this.root.querySelector('#neighbourClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    inventory.onChange(() => {
      if (this.open) this.render()
    })
  }

  toggle() {
    this.open ? this.close() : this.show()
  }

  show() {
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
  }

  close() {
    this.open = false
    this.root.classList.add('hidden')
    Input.clear()
  }

  refresh() {
    if (this.open) this.render()
  }

  /**
   * Called every frame so a request's countdown moves.
   *
   * Gated on the displayed second, not on dt — the same fix PlotUi needed.
   * Rebuilding this DOM every frame replaces the buttons between the player's
   * pointerdown and pointerup, and `click` then never fires at all.
   */
  tick() {
    if (!this.open) return
    const live = this.requests.all.filter((r) => !r.fulfilled && r.secondsLeft > 0)
    const signature = live.map((r) => `${r.neighbourId}:${Math.ceil(r.secondsLeft)}`).join('|')
    if (signature === this.lastTimers) return
    this.lastTimers = signature
    this.render()
  }

  private lastTimers = ''

  private rows(): Row[] {
    const best = this.inventory.produceStacks()[0]
    const rows: Row[] = [
      {
        name: 'You',
        level: this.progression.level,
        best: best?.label ?? 'nothing yet',
        bestValue: best ? stackValue(best) : 0,
        isPlayer: true,
      },
      ...this.hood.all.map((n) => ({
        name: n.profile.name,
        level: n.profile.level,
        best: n.bestFind.label,
        bestValue: n.bestFind.value,
        isPlayer: false,
        neighbour: n,
      })),
    ]
    return rows.sort((a, b) => b.level - a.level || b.bestValue - a.bestValue)
  }

  private render() {
    this.body.innerHTML = ''

    const intro = document.createElement('div')
    intro.className = 'journal-heading'
    intro.textContent = 'Six farmers share this valley'
    this.body.appendChild(intro)

    this.rows().forEach((row, i) => {
      const card = document.createElement('div')
      card.className = `neighbour-card${row.isPlayer ? ' is-player' : ''}`

      const n = row.neighbour
      const dry = n ? n.dryPlots.length : 0
      const gift = n ? n.hasGift : false

      card.innerHTML = `
        <div class="nb-rank">#${i + 1}</div>
        <div class="nb-swatch" style="background:${n ? `#${n.profile.roofColor.toString(16).padStart(6, '0')}` : '#f2c14e'}"></div>
        <div class="nb-meta">
          <div class="nb-name">${row.name} <span class="sub">· Lv ${row.level}</span></div>
          <div class="sub">${n ? n.profile.blurb : 'Your farm'}</div>
          <div class="sub nb-best">Best: ${row.best}${row.bestValue ? ` · 🪙${formatCoins(row.bestValue)}` : ''}</div>
          ${
            n
              ? `<div class="nb-friend"><span class="nb-friend-bar"><span style="width:${n.friendship}%"></span></span><span class="sub">${n.friendship}% friends</span></div>`
              : ''
          }
        </div>`

      /*
       * A live request outranks everything else on the card, including the
       * trade offer. It is the only thing here with a deadline, and it is the
       * only thing a neighbour asked for rather than merely allowed.
       */
      const request = n ? this.requests.requestFor(n.profile.id) : null
      if (n && request) {
        const held = this.requests.held(request, this.inventory)
        const canFill = this.requests.canFill(request, this.inventory)
        const left = Math.max(0, Math.ceil(request.secondsLeft))
        const frac = Math.max(0, Math.min(1, request.secondsLeft / request.totalSeconds))

        const box = document.createElement('div')
        box.className = `nb-request${canFill ? ' ready' : ''}${frac < 0.25 ? ' urgent' : ''}`
        box.innerHTML = `
          <div class="nb-request-want">❗ Needs ${this.requests.describe(request)}</div>
          <div class="sub">You have ${held}/${request.wantCount} · pays 🪙${formatCoins(request.coins)}${
            request.seeds ? ` + ${request.seeds.qty}× seeds` : ''
          }</div>
          <div class="plot-progress nb-request-timer"><div class="pp-fill" style="width:${Math.round(frac * 100)}%"></div><span>${
            left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`
          } left</span></div>`

        if (canFill) {
          const deliver = document.createElement('button')
          deliver.className = 'claim'
          deliver.textContent = 'Deliver'
          deliver.addEventListener('click', () => {
            this.callbacks.deliver(n, request)
            this.render()
          })
          box.appendChild(deliver)
        }
        ;(card.querySelector('.nb-meta') as HTMLElement).appendChild(box)
      }

      // Trade offer sits inside the card, above the buttons — it is the most
      // actionable thing on the row and should read before the leaderboard flavour.
      const offer = n ? this.trading.offerFor(n.profile.id) : null
      if (n && offer) {
        const held = heldFor(this.inventory, offer)
        const canFill = !offer.fulfilled && held >= offer.wantCount
        const box = document.createElement('div')
        box.className = `nb-offer${offer.fulfilled ? ' done' : canFill ? ' ready' : ''}`
        box.innerHTML = `
          <div class="nb-offer-want">${offer.fulfilled ? '✅ Traded today' : `Wants ${this.trading.describe(offer)}`}</div>
          ${
            offer.fulfilled
              ? ''
              : `<div class="sub">You have ${held}/${offer.wantCount} · pays 🪙${formatCoins(offer.coins)}${
                  offer.seeds ? ` + ${offer.seeds.qty}× ${offer.seeds.id} seeds` : ''
                }</div>`
          }`

        if (canFill) {
          const trade = document.createElement('button')
          trade.className = 'claim'
          trade.textContent = 'Trade'
          trade.addEventListener('click', () => {
            this.callbacks.trade(n, offer)
            this.render()
          })
          box.appendChild(trade)
        }
        ;(card.querySelector('.nb-meta') as HTMLElement).appendChild(box)
      }

      if (n) {
        const actions = document.createElement('div')
        actions.className = 'nb-actions'

        const visit = document.createElement('button')
        visit.className = 'buy'
        visit.textContent = 'Visit'
        visit.addEventListener('click', () => {
          this.callbacks.visit(n)
          this.close()
        })
        actions.appendChild(visit)

        if (dry > 0) {
          const water = document.createElement('button')
          water.className = 'buy'
          water.textContent = `💧 Water (${dry})`
          water.addEventListener('click', () => {
            this.callbacks.water(n)
            this.render()
          })
          actions.appendChild(water)
        }

        if (gift) {
          const claim = document.createElement('button')
          claim.className = 'claim'
          claim.style.marginTop = '0'
          claim.textContent = '🎁 Gift'
          claim.addEventListener('click', () => {
            this.callbacks.claimGift(n)
            this.render()
          })
          actions.appendChild(claim)
        }

        card.appendChild(actions)
      }

      this.body.appendChild(card)
    })
  }
}
