import { CROPS } from '../game/crops'
import { HOTBAR_SLOTS, type Inventory } from '../game/inventory'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { iconHtml, coinIconHtml, produceAffixHtml, produceWords } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * The bag: everything the player is carrying, and the loadout editor.
 *
 * The hotbar shows eight equipped seeds; this is where the other ten species
 * live. Seeds the player owns can be equipped or benched with one click —
 * the checkmark chip *is* the toggle, no drag and drop, because on the touch
 * targets this game runs at, dragging is how items get lost. Produce is
 * listed read-only: selling stays in the shop, where the prices are.
 */
export class BagUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement

  open = false

  constructor(
    private readonly inventory: Inventory,
    private readonly toast: (msg: string, kind: 'good' | 'bad' | 'info') => void,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'bagPanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header>
          <h2>${iconHtml('bag', '🎒', 'title-ico')} Bag</h2>
          <button id="bagClose">✕</button>
        </header>
        <div id="bagBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)
    this.body = this.root.querySelector('#bagBody')!

    this.root.querySelector('#bagClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('pointerdown', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })
    // Re-render on any inventory change while open, so counts and equip state
    // never go stale behind a purchase or a harvest.
    inventory.onChange(() => {
      if (this.open) this.render()
    })
  }

  toggle() {
    if (this.open) this.close()
    else this.show()
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
  }

  private render() {
    const inv = this.inventory
    const parts: string[] = []

    // --- seeds ---------------------------------------------------------------
    const owned = CROPS.filter((c) => inv.seedCount(c.id) > 0 || inv.equipped.includes(c.id))
    parts.push(`<div class="bag-heading">Seeds
      <span class="bag-cap">${inv.equipped.length}/${HOTBAR_SLOTS} equipped</span></div>`)
    if (owned.length === 0) {
      parts.push('<div class="bag-empty">No seeds — the shop stall is at the square.</div>')
    } else {
      parts.push('<div class="bag-grid">')
      for (const crop of owned) {
        const equipped = inv.equipped.includes(crop.id)
        parts.push(`
          <button class="bag-item ${equipped ? 'equipped' : ''}" data-seed="${crop.id}">
            ${iconHtml(crop.id, crop.emoji, 'bag-ico')}
            <b>${crop.name}</b>
            <span class="bag-count">×${inv.seedCount(crop.id)}</span>
            <span class="bag-equip">${equipped ? '✓ equipped' : 'equip'}</span>
          </button>`)
      }
      parts.push('</div>')
    }

    // --- produce -------------------------------------------------------------
    const stacks = inv.produceStacks()
    parts.push('<div class="bag-heading">Produce</div>')
    if (stacks.length === 0) {
      parts.push('<div class="bag-empty">Nothing harvested yet.</div>')
    } else {
      parts.push('<div class="bag-rows">')
      for (const s of stacks) {
        const cropName = CROPS.find((c) => c.id === s.cropId)?.name ?? s.cropId
        const affix = produceAffixHtml(s.rarity, s.mutations, 'mut-ico')
        const words = produceWords(s.rarity, s.mutations, cropName)
        parts.push(`
          <div class="bag-row">
            ${iconHtml(s.cropId, s.emoji, 'bag-ico')}
            <span class="bag-row-label">${affix ? `<span class="mut-row">${affix}</span>` : ''}<span class="bag-row-name">${words}</span></span>
            <span class="bag-row-meta">${s.totalWeight.toFixed(2)}kg · ${coinIconHtml('inline-ico')}${formatCoins(Math.round(s.pricePerKg * s.totalWeight))}</span>
          </div>`)
      }
      parts.push('</div>')
    }

    this.body.innerHTML = parts.join('')

    for (const btn of this.body.querySelectorAll<HTMLElement>('[data-seed]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.seed!
        if (this.inventory.equipped.includes(id)) {
          this.inventory.unequip(id)
        } else if (!this.inventory.equip(id)) {
          this.toast(`Hotbar is full — unequip something first (${HOTBAR_SLOTS} slots)`, 'bad')
        }
      })
    }
  }
}
