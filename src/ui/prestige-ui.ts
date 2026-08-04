import { PRESTIGE_UPGRADES, RETIRE_MIN_LEVEL, type Prestige } from '../game/prestige'
import type { Progression } from '../game/progression'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * Retirement and permanent upgrades.
 *
 * The retire button is the most destructive action in the game, so it states
 * plainly what is lost and what is kept, and is armed by a second click. A
 * player should never be able to wipe a farm they were not intending to.
 */
export class PrestigeUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement

  open = false

  constructor(
    private readonly prestige: Prestige,
    private readonly progression: Progression,
    private readonly onRetire: () => void,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'prestigePanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header>
          <h2>${iconHtml('legacy', '🌼', 'title-ico')} Legacy <span class="almanac-total" id="blossomCount"></span></h2>
          <button id="prestigeClose">✕</button>
        </header>
        <div id="prestigeBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#prestigeBody')!
    this.root.querySelector('#prestigeClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    prestige.onChange(() => {
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

  private render() {
    const p = this.prestige
    ;(this.root.querySelector('#blossomCount') as HTMLElement).textContent =
      `🌼 ${p.blossoms} blossom${p.blossoms === 1 ? '' : 's'}`

    this.body.innerHTML = ''

    // --- retire -----------------------------------------------------------
    const preview = p.previewFor(this.progression.level)
    const retireCard = document.createElement('div')
    retireCard.className = `journal-card${preview.eligible ? ' ready' : ''}`
    retireCard.innerHTML = `
      <div class="journal-name">Retire the farm</div>
      <div class="journal-blurb">
        Hand the land on and start again. You <b>keep</b> your almanac, your pets and every
        legacy upgrade. You <b>lose</b> your coins, level, plots, seeds and everything planted.
      </div>
      ${
        preview.eligible
          ? `<div class="journal-reward">Retiring now earns 🌼 ${preview.earned} blossom${preview.earned === 1 ? '' : 's'}</div>`
          : `<div class="sub">Reach level ${RETIRE_MIN_LEVEL} to retire — ${preview.needed} to go.</div>`
      }`

    if (preview.eligible) {
      const btn = document.createElement('button')
      btn.className = 'setting-danger'
      btn.style.marginTop = '10px'
      btn.textContent = `Retire for 🌼 ${preview.earned}`
      let armed = false
      btn.addEventListener('click', () => {
        if (!armed) {
          armed = true
          btn.textContent = 'This wipes your farm — click again'
          btn.classList.add('armed')
          setTimeout(() => {
            armed = false
            btn.textContent = `Retire for 🌼 ${preview.earned}`
            btn.classList.remove('armed')
          }, 4000)
          return
        }
        this.onRetire()
      })
      retireCard.appendChild(btn)
    }
    this.body.appendChild(retireCard)

    // --- upgrades ---------------------------------------------------------
    const heading = document.createElement('h3')
    heading.className = 'journal-heading'
    heading.textContent = `Legacy upgrades${p.retirements ? ` · ${p.retirements} retirement${p.retirements === 1 ? '' : 's'}` : ''}`
    this.body.appendChild(heading)

    for (const upgrade of PRESTIGE_UPGRADES) {
      const rank = p.rankOf(upgrade.id)
      const cost = p.costOf(upgrade)
      const maxed = cost === null
      const affordable = p.canAfford(upgrade)

      const effect =
        upgrade.kind === 'startCoins'
          ? `+🪙${formatCoins(upgrade.step * rank)} to start`
          : upgrade.kind === 'startPlots'
            ? `+${upgrade.step * rank} plots to start`
            : `+${Math.round(upgrade.step * rank * 100)}%`

      const row = document.createElement('div')
      row.className = `row${maxed ? '' : affordable ? '' : ' locked'}`
      row.innerHTML = `
        <div class="emoji">${upgrade.emoji}</div>
        <div class="meta">
          <div class="name">${upgrade.name}
            <span class="stock-pill${maxed ? '' : ' out'}">${rank}/${upgrade.maxRank}</span>
          </div>
          <div class="sub">${upgrade.blurb}${rank > 0 ? ` · currently ${effect}` : ''}</div>
        </div>`

      if (!maxed) {
        const buy = document.createElement('button')
        buy.className = 'buy'
        buy.textContent = `🌼 ${cost}`
        buy.disabled = !affordable
        buy.addEventListener('click', () => {
          p.buy(upgrade.id)
          this.render()
        })
        row.appendChild(buy)
      }

      this.body.appendChild(row)
    }
  }
}
