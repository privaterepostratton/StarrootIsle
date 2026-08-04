import { CROPS } from '../game/crops'
import { MUTATIONS, RARITIES } from '../game/mutations'
import { PET_SPECIES } from '../game/pets'
import { ANIMALS } from '../game/animals'
import type { Discovery, DiscoveryKind } from '../game/discovery'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { iconHtml, mutationIconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * The almanac.
 *
 * Undiscovered entries are shown as silhouettes rather than hidden, because
 * the gap is the motivation — a locked row that says "???" next to fifteen
 * found ones is a to-do list. Hiding them entirely would just make the page
 * look complete.
 */

interface Entry {
  id: string
  emoji: string
  name: string
  detail: string
  /** Which set this entry is discovered against. Ids only have to be unique
   *  within their own kind, and one tab can now show more than one kind. */
  kind: DiscoveryKind
  /** Extra line shown only once discovered. */
  found?: string
}

/**
 * A tab can cover more than one discovery set.
 *
 * Livestock and pets were a tab each and neither filled a row — two half-empty
 * pages of the same thing, which read as the almanac having more sections than
 * content. They are both animals you collect, so they share a page, livestock
 * first because that is the half the player meets first.
 */
const TABS: { id: string; label: string; iconId: string; emoji: string; kinds: DiscoveryKind[] }[] = [
  { id: 'crops', label: 'Crops', iconId: 'sprout', emoji: '🌱', kinds: ['crops'] },
  { id: 'mutations', label: 'Mutations', iconId: 'starstruck', emoji: '✨', kinds: ['mutations'] },
  { id: 'rarities', label: 'Rarities', iconId: 'rainbow', emoji: '🌈', kinds: ['rarities'] },
  { id: 'animals', label: 'Animals', iconId: 'barn', emoji: '🐄', kinds: ['animals', 'pets'] },
]

export class AlmanacUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private tab = TABS[0].id

  open = false

  constructor(private readonly discovery: Discovery) {
    this.root = document.createElement('div')
    this.root.id = 'almanacPanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header>
          <h2>${iconHtml('almanac', '📖', 'title-ico')} Almanac <span class="almanac-total" id="almanacTotal"></span></h2>
          <button id="almanacClose">✕</button>
        </header>
        <div class="tabs" id="almanacTabs"></div>
        <div id="almanacBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#almanacBody')!
    this.root.querySelector('#almanacClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    discovery.onChange(() => {
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

  /** Every entry on a tab, in the order its kinds are listed. */
  private tabEntries(tabId: string): Entry[] {
    const tab = TABS.find((t) => t.id === tabId) ?? TABS[0]
    return tab.kinds.flatMap((kind) => this.entries(kind))
  }

  private entries(kind: DiscoveryKind): Entry[] {
    switch (kind) {
      case 'crops':
        return CROPS.map((c) => {
          const rec = this.discovery.cropRecord(c.id)
          return {
            kind,
            id: c.id,
            emoji: c.emoji,
            name: c.name,
            detail: `${c.harvests} pick${c.harvests === 1 ? '' : 's'}`,
            found: rec
              ? `${rec.harvested} harvested · best 🪙${formatCoins(rec.bestValue)} · heaviest ${rec.heaviestKg.toFixed(2)}kg`
              : undefined,
          }
        })
      case 'mutations':
        return MUTATIONS.map((m) => ({
          kind,
          id: m.id,
          emoji: m.emoji,
          name: m.name,
          detail: `×${m.multiplier} value`,
        }))
      case 'rarities':
        return RARITIES.map((r) => ({
          kind,
          id: r.id,
          emoji: r.emoji || '⬜',
          name: r.name,
          detail: `×${r.multiplier} value · ${(r.chance * 100).toFixed(r.chance < 0.01 ? 2 : 1)}% base chance`,
        }))
      case 'pets':
        return PET_SPECIES.map((p) => ({
          kind,
          id: p.id,
          emoji: p.emoji,
          name: p.name,
          detail: p.blurb,
        }))
      case 'animals':
        return ANIMALS.map((a) => ({
          kind,
          id: a.id,
          emoji: a.emoji,
          name: a.name,
          detail: `${a.product.name} · ${a.product.value} coins`,
        }))
    }
  }

  private render() {
    const overall = this.discovery.completion
    ;(this.root.querySelector('#almanacTotal') as HTMLElement).textContent =
      `${Math.round(overall * 100)}% complete`

    // --- tabs -------------------------------------------------------------
    const tabs = this.root.querySelector('#almanacTabs') as HTMLElement
    tabs.innerHTML = ''
    for (const t of TABS) {
      const btn = document.createElement('button')
      btn.className = `tab${this.tab === t.id ? ' active' : ''}`
      btn.innerHTML = `${iconHtml(t.iconId, t.emoji, 'tab-ico')} ${t.label}`
      btn.addEventListener('click', () => {
        this.tab = t.id
        this.render()
      })
      tabs.appendChild(btn)
    }

    // --- grid -------------------------------------------------------------
    this.body.innerHTML = ''
    const grid = document.createElement('div')
    grid.className = 'almanac-grid'

    for (const entry of this.tabEntries(this.tab)) {
      const found = this.discovery.has(entry.kind, entry.id)
      const card = document.createElement('div')
      card.className = `almanac-card${found ? '' : ' undiscovered'}`
      card.innerHTML = `
        <div class="almanac-emoji">${
          found
            ? (entry.kind === 'mutations'
                ? mutationIconHtml(entry.id, entry.emoji, 'almanac-ico')
                : iconHtml(entry.id, entry.emoji, 'almanac-ico'))
            : iconHtml('locked', '❔', 'almanac-ico')
        }</div>
        <div class="almanac-meta">
          <div class="almanac-name">${found ? entry.name : '???'}</div>
          <div class="sub">${found ? entry.detail : 'Not yet discovered'}</div>
          ${found && entry.found ? `<div class="sub almanac-found">${entry.found}</div>` : ''}
        </div>`
      grid.appendChild(card)
    }

    this.body.appendChild(grid)
  }
}
