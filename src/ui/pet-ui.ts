import {
  EGGS,
  MAX_EQUIPPED,
  PET_MAX_LEVEL,
  petXpToNext,
  type EggDef,
  type Pet,
  type Pets,
} from '../game/pets'
import type { Inventory } from '../game/inventory'
import type { Progression } from '../game/progression'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * Pet panel: buy eggs, watch them incubate, hatch them, and manage which three
 * are out.
 *
 * Deliberately one panel rather than a shop and a separate menu — the loop is
 * buy → wait → hatch → equip, and splitting it across two screens hides the
 * timer that is the whole reason to come back.
 */

export interface PetCallbacks {
  buyEgg(def: EggDef): void
  hatch(uid: string): void
  toggleEquip(pet: Pet): void
}

export class PetUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement

  open = false

  constructor(
    private readonly pets: Pets,
    private readonly inventory: Inventory,
    private readonly progression: Progression,
    private readonly callbacks: PetCallbacks,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'petPanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2>${iconHtml('pets', '🥚', 'title-ico')} Pets</h2><button id="petClose">✕</button></header>
        <div id="petBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#petBody')!
    this.root.querySelector('#petClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    pets.onChange(() => this.refresh())
    inventory.onChange(() => this.refresh())
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

  /** Called each frame so incubation timers tick visibly. */
  tick() {
    if (!this.open) return
    for (const egg of this.pets.incubating) {
      const el = this.body.querySelector(`[data-egg-timer="${egg.uid}"]`)
      if (!el) continue
      /*
       * Crossing zero is a re-render, not a text swap.
       *
       * The countdown and the ready state are different cards — one has a Hatch
       * button and a gold border, the other does not — so writing "Ready!" into
       * the timer left the player watching a finished egg with no way to open
       * it until they closed and reopened the panel. The timer element only
       * exists while counting down, which makes it the signal: still here, still
       * ticking; the moment it should not be, rebuild.
       */
      if (egg.remaining <= 0) {
        this.render()
        return
      }
      el.textContent = fmt(egg.remaining)
    }
  }

  private render() {
    this.body.innerHTML = ''

    // --- incubator --------------------------------------------------------
    if (this.pets.incubating.length) {
      this.heading('Incubating')
      for (const egg of this.pets.incubating) {
        const ready = egg.remaining <= 0
        const card = document.createElement('div')
        card.className = `pet-card${ready ? ' ready' : ''}`
        card.innerHTML = `
          <div class="pet-emoji">${iconHtml(`egg-${egg.def.id}`, egg.def.emoji, 'bag-ico')}</div>
          <div class="nb-meta">
            <div class="nb-name">${egg.def.name}</div>
            <div class="sub" data-egg-line="${egg.uid}">${
              ready ? '<b>Ready to hatch!</b>' : `Hatches in <b data-egg-timer="${egg.uid}">${fmt(egg.remaining)}</b>`
            }</div>
          </div>`

        if (ready) {
          const btn = document.createElement('button')
          btn.className = 'claim'
          btn.style.marginTop = '0'
          btn.textContent = 'Hatch!'
          btn.addEventListener('click', () => this.callbacks.hatch(egg.uid))
          card.appendChild(btn)
        }
        this.body.appendChild(card)
      }
    }

    // --- roster -----------------------------------------------------------
    this.heading(`Your pets (${this.pets.equipped.length}/${MAX_EQUIPPED} out)`)
    if (this.pets.owned.length === 0) {
      const msg = document.createElement('div')
      msg.className = 'empty-msg'
      msg.innerHTML = 'No pets yet.<br>Buy an egg below and wait for it to hatch.'
      this.body.appendChild(msg)
    } else {
      for (const pet of this.pets.owned) {
        const maxed = pet.level >= PET_MAX_LEVEL
        const need = petXpToNext(pet.level)
        const pct = maxed ? 100 : Math.min(100, (pet.xp / need) * 100)

        const card = document.createElement('div')
        card.className = `pet-card${pet.equipped ? ' equipped' : ''} rarity-${pet.species.rarity}`
        card.innerHTML = `
          <div class="pet-emoji">${pet.species.emoji}</div>
          <div class="nb-meta">
            <div class="nb-name">${pet.species.name} <span class="sub">· Lv ${pet.level}</span></div>
            <div class="sub">${pet.species.blurb}</div>
            <div class="sub pet-bonus">${describeBonus(pet)}</div>
            <div class="nb-friend">
              <span class="nb-friend-bar"><span style="width:${pct}%"></span></span>
              <span class="sub">${maxed ? 'MAX' : `${Math.floor(pet.xp)}/${need} XP`}</span>
            </div>
          </div>`

        const btn = document.createElement('button')
        btn.className = 'buy'
        btn.textContent = pet.equipped ? 'Put away' : 'Take out'
        btn.disabled = !pet.equipped && this.pets.equipped.length >= MAX_EQUIPPED
        btn.addEventListener('click', () => this.callbacks.toggleEquip(pet))
        card.appendChild(btn)

        this.body.appendChild(card)
      }
    }

    // --- egg shop ---------------------------------------------------------
    this.heading('Egg shop')
    for (const def of EGGS) {
      const locked = this.progression.level < def.unlockLevel
      const affordable = this.inventory.coins >= def.price

      const row = document.createElement('div')
      row.className = `row${locked || !affordable ? ' locked' : ''}`
      row.innerHTML = `
        <div class="emoji">${locked ? iconHtml('locked', '🔒') : iconHtml(`egg-${def.id}`, def.emoji)}</div>
        <div class="meta">
          <div class="name">${def.name}</div>
          <div class="sub">${
            locked
              ? `Unlocks at level ${def.unlockLevel}`
              : `Hatches in ${fmt(def.hatchSeconds)} · ${topOdds(def)}`
          }</div>
        </div>`

      if (!locked) {
        const buy = document.createElement('button')
        buy.className = 'buy'
        buy.textContent = `🪙 ${formatCoins(def.price)}`
        buy.disabled = !affordable
        buy.addEventListener('click', () => this.callbacks.buyEgg(def))
        row.appendChild(buy)
      }
      this.body.appendChild(row)
    }
  }

  private heading(text: string) {
    const h = document.createElement('h3')
    h.className = 'journal-heading'
    h.textContent = text
    this.body.appendChild(h)
  }
}

/** Human-readable summary of what this pet is currently worth. */
function describeBonus(pet: Pet) {
  const parts: string[] = []
  const b = pet.species.bonus
  const s = pet.level
  if (b.growth) parts.push(`+${Math.round(b.growth * s * 100)}% growth`)
  if (b.luck) parts.push(`+${Math.round(b.luck * s * 100)}% luck`)
  if (b.duplicate) parts.push(`${Math.round(b.duplicate * s * 100)}% double harvest`)
  if (b.autoWater) parts.push(`auto-waters`)
  if (b.weight) parts.push(`+${Math.round(b.weight * s * 100)}% weight`)
  return parts.join(' · ')
}

/** The two most likely outcomes, so the player can compare eggs at a glance. */
function topOdds(def: EggDef) {
  return [...def.odds]
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 2)
    .map((o) => `${Math.round(o.chance * 100)}% ${o.species}`)
    .join(', ')
}

function fmt(seconds: number) {
  const s = Math.ceil(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}
