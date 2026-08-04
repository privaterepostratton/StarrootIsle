import { CROPS, growSecondsFor, type CropDef } from '../game/crops'
import { unlockLevelFor, type Progression } from '../game/progression'
import { MATERIALS } from '../game/materials'
import { SPRINKLER_TIERS, TOOLS } from '../game/sprinklers'
import { PLACEABLES } from '../game/placeables'
import { stackValue, type Inventory } from '../game/inventory'
import type { Stock } from '../game/stock'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'
import { isHandheld } from './fullscreen'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

type Tab = 'buy' | 'tools' | 'decor' | 'sell'

/**
 * Seed shop modal. Opens on interact near the stall; while open the game keeps
 * simulating (crops keep growing) but player input is locked.
 */
export class ShopUi {
  private readonly root = $<HTMLDivElement>('shop')
  private readonly list = $<HTMLDivElement>('shopList')
  private readonly coins = $<HTMLSpanElement>('shopCoins')
  private readonly footer = $<HTMLDivElement>('shop').querySelector('footer') as HTMLElement
  private tab: Tab = 'buy'
  /*
   * Keyboard hints are worse than useless on a phone: "Press V to place one" is
   * an instruction the player cannot follow, next to a dock button that does
   * exactly that. Read once — a device does not grow a keyboard mid-session.
   */
  private readonly touch = isHandheld()

  open = false

  constructor(
    private readonly inventory: Inventory,
    private readonly progression: Progression,
    private readonly stock: Stock,
    private readonly onToast: (msg: string, kind?: 'good' | 'bad' | 'info') => void,
    private readonly onSelectDecor: (id: string) => void,
    private readonly onSfx: (id: 'buy' | 'sell' | 'open' | 'error') => void = () => {},
  ) {
    $('shopClose').addEventListener('click', () => this.close())

    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    for (const tabBtn of this.root.querySelectorAll<HTMLButtonElement>('.tab')) {
      tabBtn.addEventListener('click', () => {
        this.tab = tabBtn.dataset.tab as Tab
        for (const b of this.root.querySelectorAll('.tab')) b.classList.toggle('active', b === tabBtn)
        // Whatever brought them here, they have arrived — stop nagging.
        this.root.classList.remove('urge-sell')
        this.render()
      })
    }

    inventory.onChange(() => {
      if (this.open) this.render()
    })
    stock.onChange(() => {
      if (this.open) this.render()
    })
  }

  /** Called per frame so the restock countdown ticks while the shop is open. */
  tick() {
    if (!this.open || this.tab !== 'buy') return
    const el = document.getElementById('restockTimer')
    if (el) el.textContent = fmt(Math.max(0, this.stock.timer))
  }

  toggle() {
    this.open ? this.close() : this.show()
  }

  show() {
    this.open = true
    this.root.classList.remove('hidden')
    // Drop held keys or the player keeps walking behind the modal.
    Input.clear()
    this.onSfx('open')
    /*
     * A full barn is the one reason the game sends the player here rather than
     * waiting to be visited, and the trail on the ground stops at the door — it
     * gets them to the shop and then abandons them on the Buy tab, one step
     * short of the thing they came to do. Finish the sentence: mark the Sell tab
     * so the same journey has an end.
     */
    this.root.classList.toggle('urge-sell', this.inventory.storageFull && this.tab !== 'sell')
    this.render()
  }

  close() {
    this.open = false
    this.root.classList.add('hidden')
    Input.clear()
  }

  private render() {
    this.coins.textContent = formatCoins(this.inventory.coins)
    this.list.innerHTML = ''
    // Lives in the footer, which is shared with every other tab — so it has to
    // be cleared here rather than by the list being emptied.
    this.footer.querySelector('.sell-all')?.remove()

    if (this.tab === 'buy') this.renderBuy()
    else if (this.tab === 'tools') this.renderTools()
    else if (this.tab === 'decor') this.renderDecor()
    else this.renderSell()
  }

  private renderTools() {
    const intro = document.createElement('div')
    intro.className = 'empty-msg'
    intro.style.padding = '4px 2px 8px'
    intro.innerHTML = this.touch
      ? 'Sprinklers keep nearby plots watered forever and raise your odds of rare crops.<br>Tap the sprinkler button in the corner to place one.'
      : 'Sprinklers keep nearby plots watered forever and raise your odds of rare crops.<br>Press <b>V</b> to place one.'
    this.list.appendChild(intro)

    // One-off tools first — they are permanent upgrades, not consumables.
    for (const tool of TOOLS) {
      const locked = this.progression.level < tool.unlockLevel
      const owned = this.inventory.hasTool(tool.id)
      const affordable = this.inventory.coins >= tool.price

      const row = document.createElement('div')
      row.className = `row${locked || (!affordable && !owned) ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(tool.id, tool.emoji)}</div>
        <div class="meta">
          <div class="name">${tool.name}${owned ? ' <span class="sub">· owned</span>' : ''}</div>
          <div class="sub">${
            locked
              ? `Unlocks at level ${tool.unlockLevel}`
              : this.touch
                ? tool.blurb
                : `${tool.blurb} Press <b>${tool.key}</b>.`
          }</div>
        </div>`

      if (!locked && !owned) {
        const buy = document.createElement('button')
        buy.className = 'buy'
        buy.textContent = `🪙 ${formatCoins(tool.price)}`
        buy.disabled = !affordable
        buy.addEventListener('click', () => {
          if (this.inventory.buyTool(tool.id, tool.price)) {
            this.onSfx('buy')
            this.onToast(
              this.touch ? `Bought the ${tool.name}` : `Bought the ${tool.name} — press ${tool.key} to use it`,
              'good',
            )
          } else {
            this.onSfx('error')
            this.onToast('Not enough coins', 'bad')
          }
        })
        row.appendChild(buy)
      }

      this.list.appendChild(row)
    }

    for (const tier of SPRINKLER_TIERS) {
      const locked = this.progression.level < tier.unlockLevel
      const affordable = this.inventory.coins >= tier.price
      const owned = this.inventory.sprinklerCount(tier.id)
      const covers = (tier.radius * 2 + 1) ** 2

      const row = document.createElement('div')
      row.className = `row${locked || !affordable ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(tier.id, tier.emoji)}</div>
        <div class="meta">
          <div class="name">${tier.name}${owned ? ` <span class="sub">· ${owned} in shed</span>` : ''}</div>
          <div class="sub">${
            locked
              ? `Unlocks at level ${tier.unlockLevel}`
              : `Waters ${covers} plots · +${Math.round(tier.luck * 100)}% rare-crop luck`
          }</div>
        </div>`

      if (!locked) {
        const buy = document.createElement('button')
        buy.className = 'buy'
        buy.textContent = `🪙 ${formatCoins(tier.price)}`
        buy.disabled = !affordable
        buy.addEventListener('click', () => {
          if (this.inventory.buySprinkler(tier.id, tier.price)) {
            this.onSfx('buy')
            this.onToast(
              this.touch
                ? `Bought a ${tier.name} — tap the sprinkler button to place it`
                : `Bought a ${tier.name} — press V to place it`,
              'good',
            )
          } else {
            this.onSfx('error')
            this.onToast('Not enough coins', 'bad')
          }
        })
        row.appendChild(buy)
      }

      this.list.appendChild(row)
    }
  }

  private renderDecor() {
    const intro = document.createElement('div')
    intro.className = 'empty-msg'
    intro.style.padding = '4px 2px 8px'
    intro.innerHTML = this.touch
      ? 'Buy an item, then tap the decor button in the corner and tap the ground to place it.'
      : 'Buy an item, then press <b>C</b> and click the ground to place it.<br>Use <b>[</b> and <b>]</b> to cycle which one you are placing.'
    this.list.appendChild(intro)

    for (const def of PLACEABLES) {
      const locked = this.progression.level < def.unlockLevel
      const affordable = this.inventory.coins >= def.price

      const row = document.createElement('div')
      row.className = `row${locked || !affordable ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(def.id, def.emoji)}</div>
        <div class="meta">
          <div class="name">${def.name}</div>
          <div class="sub">${locked ? `Unlocks at level ${def.unlockLevel}` : def.blurb}</div>
        </div>`

      if (!locked) {
        const pick = document.createElement('button')
        pick.className = 'buy'
        pick.textContent = `🪙 ${formatCoins(def.price)}`
        pick.disabled = !affordable
        // Decor is paid for on placement, not here — otherwise a player who
        // changes their mind has bought an item with nowhere to put it.
        pick.addEventListener('click', () => {
          this.onSelectDecor(def.id)
          this.onToast(`${def.emoji} ${def.name} selected — press C and click the ground`, 'good')
          this.close()
        })
        row.appendChild(pick)
      }

      this.list.appendChild(row)
    }
  }

  private renderBuy() {
    const banner = document.createElement('div')
    banner.className = 'restock-banner'
    banner.innerHTML = `${iconHtml('truck', '🚚', 'restock-ico')} Restocks in <b id="restockTimer">${fmt(Math.max(0, this.stock.timer))}</b>`
    this.list.appendChild(banner)

    for (const crop of CROPS) {
      const unlockLevel = unlockLevelFor(crop.id)
      const locked = this.progression.level < unlockLevel
      const inStock = this.stock.countOf(crop.id)
      const affordable = this.inventory.coins >= crop.seedCost
      const held = this.inventory.seedCount(crop.id)
      // Growth time shown watered, since that is how anyone actually plays.
      const mins = growSecondsFor(crop) / 2

      // Out-of-stock rows still show, greyed — seeing what you missed is half
      // the reason to be back for the next restock.
      const row = document.createElement('div')
      row.className = `row${locked || !affordable || inStock === 0 ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(crop.id, crop.emoji)}</div>
        <div class="meta">
          <div class="name">${crop.name} Seeds${held ? ` <span class="sub">· ${held} held</span>` : ''}
            ${locked ? '' : `<span class="stock-pill${inStock ? '' : ' out'}">${inStock ? `${inStock} in stock` : 'SOLD OUT'}</span>`}
          </div>
          <div class="sub">${
            locked
              ? `Unlocks at level ${unlockLevel}`
              : `🪙${formatCoins(crop.sellPrice)} each · ~🪙${formatCoins(lifetimeValue(crop))} over ${crop.harvests} pick${crop.harvests === 1 ? '' : 's'} · ripens in ~${fmt(mins)}`
          }</div>
        </div>`

      if (!locked && inStock > 0) {
        const buy1 = document.createElement('button')
        buy1.className = 'buy'
        buy1.textContent = `🪙 ${crop.seedCost}`
        buy1.disabled = !affordable
        buy1.addEventListener('click', () => this.buy(crop.id, 1))
        row.appendChild(buy1)

        const bulk = Math.min(10, inStock)
        if (bulk > 1) {
          const buyBulk = document.createElement('button')
          buyBulk.className = 'buy'
          buyBulk.textContent = `×${bulk}`
          buyBulk.disabled = this.inventory.coins < crop.seedCost * bulk
          buyBulk.addEventListener('click', () => this.buy(crop.id, bulk))
          row.appendChild(buyBulk)
        }
      }

      this.list.appendChild(row)
    }
  }

  /**
   * The barn: a fill meter, and the next capacity upgrade if there is one.
   *
   * Lives in the shop rather than in its own panel because it is a purchase, and
   * because the moment a player wants it is the moment they came here to make
   * room — putting it anywhere else means finding out the barn is full and then
   * going somewhere third to fix it.
   */
  private barnRow() {
    const inv = this.inventory
    const pct = Math.min(100, Math.round((inv.stored / inv.storageCap) * 100))
    const next = inv.nextStorageTier

    const row = document.createElement('div')
    row.className = `row barn-row${inv.storageFull ? ' barn-full' : ''}`
    row.innerHTML = `
      <div class="emoji">${iconHtml('barn', '🛖')}</div>
      <div class="meta">
        <div class="name">Barn <span class="sub">· ${inv.stored} / ${inv.storageCap} crops</span></div>
        <div class="plot-progress barn-meter"><div class="pp-fill" style="width:${pct}%"></div></div>
        <div class="sub">${
          next
            ? `Upgrade to ${next.cap} for 🪙${formatCoins(next.cost)}`
            : 'The biggest barn in the valley'
        }</div>
      </div>`

    if (next) {
      const buy = document.createElement('button')
      buy.className = 'buy'
      buy.textContent = 'Upgrade'
      buy.disabled = this.inventory.coins < next.cost
      buy.addEventListener('click', () => {
        if (!this.inventory.upgradeStorage()) {
          this.onSfx('error')
          this.onToast('Not enough coins', 'bad')
          return
        }
        this.onSfx('buy')
        this.onToast(`Barn extended — room for ${this.inventory.storageCap} crops`, 'good')
        this.render()
      })
      row.appendChild(buy)
    }
    return row
  }

  private renderSell() {
    const owned = this.inventory.produceStacks()
    const mats = MATERIALS.filter((m) => this.inventory.materialCount(m.id) > 0)

    // The barn meter leads the sell tab, because "how full am I" is the reason
    // the player opened it — and the upgrade beside it is the one thing in the
    // game that a late-game wallet can still be spent on.
    this.list.appendChild(this.barnRow())

    if (owned.length === 0 && mats.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty-msg'
      empty.innerHTML = 'Nothing to sell yet.<br>Go harvest something, or clear some land! 🌱'
      this.list.appendChild(empty)
      return
    }

    /*
     * Sell everything, in the footer beside the wallet.
     *
     * It used to be the last child of the list, below every stack — the one
     * place it is guaranteed not to be seen, since the tab exists because the
     * barn is full and a full barn means thirty rows above it. The footer is
     * outside the scroll container, so it is on screen whatever the list is
     * doing, and it puts the total it would pay directly beside the coin count
     * it would add to.
     */
    const total =
      owned.reduce((sum, stack) => sum + stackValue(stack), 0) +
      mats.reduce((sum, m) => sum + m.sellPrice * this.inventory.materialCount(m.id), 0)

    const all = document.createElement('button')
    all.className = 'buy sell-all'
    all.innerHTML = `${coinIconHtml()} Sell all · ${formatCoins(total)}`
    all.addEventListener('click', () => {
      const earned = this.inventory.sellAll()
      if (earned > 0) {
        this.onSfx('sell')
        this.onToast(`Sold everything for 🪙${formatCoins(earned)}`, 'good')
      }
    })
    this.footer.appendChild(all)

    for (const mat of mats) {
      const n = this.inventory.materialCount(mat.id)
      const row = document.createElement('div')
      row.className = 'row'
      row.innerHTML = `
        <div class="emoji">${iconHtml(mat.id, mat.emoji)}</div>
        <div class="meta">
          <div class="name">${mat.name} <span class="sub">· ${n} held</span></div>
          <div class="sub">🪙${formatCoins(mat.sellPrice)} each · 🪙${formatCoins(mat.sellPrice * n)} for all</div>
        </div>`

      const sellAll = document.createElement('button')
      sellAll.className = 'buy'
      sellAll.textContent = `Sell ${n}`
      sellAll.addEventListener('click', () => {
        const earned = this.inventory.sellMaterial(mat.id, n)
        if (earned > 0) {
          this.onSfx('sell')
          this.onToast(`Sold ${n}× ${mat.name} for 🪙${formatCoins(earned)}`, 'good')
        }
      })
      row.appendChild(sellAll)
      this.list.appendChild(row)
    }

    for (const stack of owned) {
      const row = document.createElement('div')
      // Rare stacks get a highlight so a rainbow drop is impossible to miss
      // in a list of thirty turnip variants. (barnRow is above.)
      row.className = `row${stack.rarity === 'common' ? '' : ` rare-${stack.rarity}`}`
      row.innerHTML = `
        <div class="emoji">${iconHtml(stack.cropId, stack.emoji)}</div>
        <div class="meta">
          <div class="name">${stack.label} <span class="sub">· ${stack.count} held</span></div>
          <div class="sub">${stack.totalWeight.toFixed(2)}kg total · 🪙${formatCoins(stackValue(stack))} for all</div>
        </div>`

      const sell1 = document.createElement('button')
      sell1.className = 'buy'
      sell1.textContent = 'Sell 1'
      sell1.addEventListener('click', () => this.sell(stack.key, 1))
      row.appendChild(sell1)

      const sellAll = document.createElement('button')
      sellAll.className = 'buy'
      sellAll.textContent = `Sell ${stack.count}`
      sellAll.addEventListener('click', () => this.sell(stack.key, stack.count))
      row.appendChild(sellAll)

      this.list.appendChild(row)
    }

  }

  private buy(id: string, qty: number) {
    const crop = CROPS.find((c) => c.id === id)!
    // Stock is decremented first: if the shelf is short, the purchase never
    // happens and no coins move.
    if (!this.stock.take(id, qty)) {
      this.onSfx('error')
      this.onToast('Sold out — wait for the restock', 'bad')
      return
    }
    if (this.inventory.buySeed(id, qty)) {
      this.onSfx('buy')
      this.onToast(`Bought ${qty}× ${crop.name} seeds`, 'good')
      // Buying a seed almost always means you want to plant it next.
      this.inventory.select(CROPS.indexOf(crop))
    } else {
      // Put it back on the shelf — the coin check failed after we reserved it.
      this.stock.restore(id, qty)
      this.onSfx('error')
      this.onToast('Not enough coins', 'bad')
    }
  }

  private sell(key: string, qty: number) {
    const stack = this.inventory.produce.get(key)
    if (!stack) return
    const label = stack.label
    const earned = this.inventory.sellProduce(key, qty)
    if (earned > 0) {
      this.onSfx('sell')
      this.onToast(`Sold ${qty}× ${label} for 🪙${formatCoins(earned)}`, 'good')
    }
  }
}

/**
 * Total coins a seed returns across its whole life, at average weight and no
 * mutations. Weight cancels out — `sellPrice` already *is* the value of an
 * average fruit — so this is just price times how many you get.
 */
function lifetimeValue(crop: CropDef) {
  return Math.round(crop.sellPrice * crop.yield * crop.harvests)
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}
