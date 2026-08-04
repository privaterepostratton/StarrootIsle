import { ANIMALS, type AnimalDef, type Pasture } from '../game/animals'
import type { Inventory } from '../game/inventory'
import type { Progression } from '../game/progression'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'
import { asset } from '../core/assets'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * Animal store modal. Mirrors the seed shop's structure so the two read as the
 * same kind of place, but lists livestock and shows what is currently waiting
 * to be collected out in the pasture.
 */
export class AnimalUi {
  private readonly root: HTMLDivElement
  private readonly list: HTMLDivElement

  open = false

  constructor(
    private readonly inventory: Inventory,
    private readonly progression: Progression,
    private readonly pasture: Pasture,
    private readonly onBuy: (def: AnimalDef) => void,
    private readonly onCollectAll: () => void,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'animalShop'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2>${iconHtml('barn', '🐄', 'title-ico')} Meadow Livestock</h2><button id="animalClose">✕</button></header>
        <div id="animalList"></div>
        <footer><span class="wallet"><img class="ico-img" src="${asset('ui/coin.png')}" alt="" draggable="false"> <b id="animalCoins">0</b></span></footer>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.list = this.root.querySelector('#animalList')!
    this.root.querySelector('#animalClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    inventory.onChange(() => {
      if (this.open) this.render()
    })
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

  private render() {
    ;(this.root.querySelector('#animalCoins') as HTMLElement).textContent = formatCoins(
      this.inventory.coins,
    )
    this.list.innerHTML = ''

    const ready = this.pasture.readyCount
    if (ready > 0) {
      const btn = document.createElement('button')
      btn.className = 'buy'
      btn.style.marginBottom = '8px'
      btn.innerHTML = `${iconHtml('harvest', '🧺', 'inline-ico')} Collect ${ready} ready product${ready === 1 ? '' : 's'}`
      btn.addEventListener('click', () => {
        this.onCollectAll()
        this.render()
      })
      this.list.appendChild(btn)
    }

    for (const def of ANIMALS) {
      const locked = this.progression.level < def.unlockLevel
      const affordable = this.inventory.coins >= def.price
      const owned = this.pasture.countOf(def.id)
      const productIcon = iconHtml(def.product.name.toLowerCase(), def.product.emoji, 'inline-ico')

      const row = document.createElement('div')
      row.className = `row${locked || !affordable ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(def.id, def.emoji)}</div>
        <div class="meta">
          <div class="name">${def.name}${owned ? ` <span class="sub">· ${owned} owned</span>` : ''}</div>
          <div class="sub">${
            locked
              ? `Unlocks at level ${def.unlockLevel}`
              : // Product, then rate. Separated rather than run together as one
                // sentence — the two numbers are what a buyer is comparing across
                // rows, and a middot lets the eye jump straight to them.
                `${productIcon} ${def.product.name} · ${coinIconHtml('inline-ico')}${formatCoins(def.product.value)} every ${fmt(def.interval)}`
          }</div>
        </div>`

      if (!locked) {
        const buy = document.createElement('button')
        buy.className = 'buy'
        buy.innerHTML = `${coinIconHtml('inline-ico')} ${formatCoins(def.price)}`
        buy.disabled = !affordable
        buy.addEventListener('click', () => {
          this.onBuy(def)
          this.render()
        })
        row.appendChild(buy)
      }

      this.list.appendChild(row)
    }
  }
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}
