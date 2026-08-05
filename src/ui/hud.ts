import { CROPS } from '../game/crops'
import { HOTBAR_SLOTS, type Inventory } from '../game/inventory'
import type { DayCycle } from '../game/daycycle'
import type { Weather } from '../game/weather'
import { MAX_LEVEL, type Progression } from '../game/progression'
import type { SprinklerTier } from '../game/sprinklers'
import type { TileAction } from '../game/farm'
import { formatCoins } from './format'
import { clockIconId, iconHtml, iconSrc } from './icons'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** Panels the right-hand rail can open. */
export type NavTarget = 'quests' | 'valley' | 'pets' | 'almanac' | 'legacy' | 'menu' | 'bag'
/** Modes the bottom-right dock arms. */
export type ToolTarget = 'shovel' | 'sprinkler' | 'decor'

export interface HudActions {
  nav(target: NavTarget): void
  tool(target: ToolTarget): void
}

/** Which gated feature each button represents. Ungated buttons are absent. */
const BUTTON_FEATURE: Record<string, string> = {
  valley: 'valley',
  pets: 'pets',
  almanac: 'almanac',
  legacy: 'legacy',
  sprinkler: 'sprinkler',
  decor: 'decor',
}

export class Hud {
  private readonly coinCount = $<HTMLSpanElement>('coinCount')
  private readonly coinChip = $<HTMLDivElement>('coinChip')
  private readonly barnChip = $<HTMLDivElement>('barnChip')
  private readonly barnCount = $<HTMLSpanElement>('barnCount')
  private readonly dayCount = $<HTMLSpanElement>('dayCount')
  private readonly clockTime = $<HTMLSpanElement>('clockTime')
  private readonly clockIco = $<HTMLImageElement>('clockIco')
  private readonly hotbar = $<HTMLDivElement>('hotbar')
  private readonly prompt = $<HTMLDivElement>('prompt')
  private readonly toasts = $<HTMLDivElement>('toasts')

  private readonly seasonIco = $<HTMLImageElement>('seasonIco')
  private readonly seasonName = $<HTMLSpanElement>('seasonName')
  private readonly weatherIco = $<HTMLImageElement>('weatherIco')
  private readonly weatherName = $<HTMLSpanElement>('weatherName')
  private readonly shovelChip = $<HTMLButtonElement>('shovelChip')
  private readonly shovelCost = $<HTMLElement>('shovelCost')
  private readonly sprinklerChip = $<HTMLButtonElement>('sprinklerChip')
  private readonly sprinklerName = $<HTMLElement>('sprinklerName')
  private readonly decorBtn = document.querySelector<HTMLButtonElement>('[data-tool="decor"]')!
  private readonly lvlNum = $<HTMLSpanElement>('lvlNum')
  private readonly xpFill = $<HTMLSpanElement>('xpFill')
  private readonly xpText = $<HTMLSpanElement>('xpText')

  private lastCoins = -1
  private lastBarn = ''
  private lastLoadout = ''
  /** Kept so vacant slots can route their click to the bag. */
  private actionsRef: HudActions | null = null
  private lastPrompt = ''
  private lastWeather = ''
  private lastSeason = ''

  constructor(
    private readonly inventory: Inventory,
    actions: HudActions,
  ) {
    this.actionsRef = actions
    this.buildHotbar()
    inventory.onChange(() => this.refresh())
    this.refresh()

    // Every on-screen button routes to the same handler the keyboard shortcut
    // does, so the two can never drift apart.
    $('menuBtn').addEventListener('click', () => actions.nav('menu'))
    for (const btn of document.querySelectorAll<HTMLElement>('[data-nav]')) {
      btn.addEventListener('click', () => {
        // Picking anything closes the mobile sheet. Harmless on desktop, where
        // the class is never set.
        this.setNavSheet(false)
        actions.nav(btn.dataset.nav as NavTarget)
      })
    }

    /*
     * On touch the rail becomes a full-screen sheet behind one launcher.
     *
     * Six 52px buttons stacked down the edge of a phone are a column of targets
     * the thumb has to be precise about, right where the hand already covers the
     * screen. The same six as a grid of large tiles is one deliberate tap to
     * open and one easy tap to choose. The rail keeps its markup and its
     * handlers either way — only the CSS changes what it looks like — so there
     * is no second set of buttons to keep in sync.
     */
    const launcher = document.getElementById('navLauncher')
    launcher?.addEventListener('click', () => this.setNavSheet(!this.navSheetOpen))
    $('navRail').addEventListener('click', (e) => {
      // Tapping the backdrop, i.e. the sheet itself rather than a button.
      if (e.target === e.currentTarget) this.setNavSheet(false)
    })
    for (const btn of document.querySelectorAll<HTMLElement>('[data-tool]')) {
      btn.addEventListener('click', () => actions.tool(btn.dataset.tool as ToolTarget))
    }
  }

  /**
   * Hide every HUD cluster while a full-screen panel is up.
   *
   * One class on <body> rather than a per-element sweep: the CSS decides what
   * counts as chrome, so a new HUD element is covered by tagging its markup and
   * a new panel by listing it in the caller's `panelOpen()`.
   */
  setPanelOpen(open: boolean) {
    if (open === this.panelOpen) return
    this.panelOpen = open
    document.body.classList.toggle('panel-open', open)
    // A panel opening from the sheet must not leave the sheet under it.
    if (open) this.setNavSheet(false)
  }

  /** Open or close the mobile nav sheet. A no-op visually on desktop. */
  private setNavSheet(open: boolean) {
    if (open === this.navSheetOpen) return
    this.navSheetOpen = open
    document.body.classList.toggle('nav-sheet', open)
    document.getElementById('navLauncher')?.setAttribute('aria-expanded', String(open))
  }

  /**
   * Dress locked buttons with a level badge.
   *
   * The buttons stay visible and clickable — a locked feature is advertised,
   * and the click explains itself with a toast. Only the *look* changes here;
   * the actual wall lives in main's requireFeature, so a stale badge can never
   * open anything early.
   */
  updateLocks(unlocked: (id: never) => boolean, levelOf: (id: never) => number) {
    for (const btn of document.querySelectorAll<HTMLElement>('[data-nav], [data-tool]')) {
      const feature = BUTTON_FEATURE[(btn.dataset.nav ?? btn.dataset.tool)!]
      if (!feature) continue
      const isLocked = !unlocked(feature as never)
      btn.classList.toggle('locked', isLocked)
      let badge = btn.querySelector<HTMLElement>('.lock-badge')
      if (isLocked && !badge) {
        badge = document.createElement('span')
        badge.className = 'lock-badge'
        badge.innerHTML = `${iconHtml('locked', '🔒', 'lock-ico')}${levelOf(feature as never)}`
        btn.appendChild(badge)
      } else if (!isLocked && badge) {
        badge.remove()
      }
    }
  }

  private panelOpen = false
  private navSheetOpen = false

  /**
   * Crop indices currently shown in the hotbar.
   *
   * With eighteen crops a full hotbar would run off both edges of the screen,
   * so it only shows what the player has unlocked. Number keys bind to the
   * first nine of those, which is why this mapping has to be stored rather
   * than assumed to be identity.
   */
  private slotCrops: number[] = []

  /** Crop index for a 1-9 number key, or -1. */
  cropForSlot(slotIndex: number) {
    return this.slotCrops[slotIndex] ?? -1
  }

  /**
   * Eight fixed slots, filled from the inventory's equipped loadout.
   *
   * A fixed row, not a list that grows: slot N is always in the same place and
   * always answers to key N, which is what makes the hotbar muscle memory.
   * Vacant slots render as empty wells — they advertise the capacity, and
   * clicking one opens the bag, which is where the answer to "how do I fill
   * this?" actually lives.
   */
  rebuildHotbar(_playerLevel?: number) {
    this.slotCrops = this.inventory.equipped
      .map((id) => CROPS.findIndex((c) => c.id === id))
      .filter((i) => i >= 0)

    this.hotbar.innerHTML = ''
    for (let slot = 0; slot < HOTBAR_SLOTS; slot++) {
      const el = document.createElement('div')
      const cropIndex = this.slotCrops[slot] ?? -1

      if (cropIndex >= 0) {
        const crop = CROPS[cropIndex]
        el.className = 'slot'
        el.dataset.index = String(cropIndex)
        el.innerHTML = `
          <span class="key">${slot + 1}</span>
          <span class="emo">${iconHtml(crop.id, crop.emoji, 'emo-img')}</span>
          <span class="count">0</span>`
        el.title = `${crop.name} seeds`
        el.addEventListener('click', () => this.inventory.select(cropIndex))
      } else {
        el.className = 'slot vacant'
        el.title = 'Empty slot — equip seeds from your bag'
        el.addEventListener('click', () => this.actionsRef?.nav('bag'))
      }
      this.hotbar.appendChild(el)
    }
    this.refresh()
  }

  private buildHotbar() {
    this.rebuildHotbar(1)
  }

  refresh() {
    const inv = this.inventory

    if (inv.coins !== this.lastCoins) {
      this.coinCount.textContent = formatCoins(inv.coins)
      if (this.lastCoins >= 0 && inv.coins > this.lastCoins) {
        this.coinChip.classList.remove('bump')
        void this.coinChip.offsetWidth // restart the CSS animation
        this.coinChip.classList.add('bump')
      }
      this.lastCoins = inv.coins
    }

    // Barn fill. Warned at three quarters rather than only when full, because
    // the fix — walking to the stall and selling — takes long enough that
    // finding out at 100% means a wasted harvest.
    const barn = `${inv.stored}/${inv.storageCap}`
    if (barn !== this.lastBarn) {
      this.barnCount.textContent = barn
      this.barnChip.classList.toggle('warn', inv.stored >= inv.storageCap * 0.75)
      this.barnChip.classList.toggle('full', inv.storageFull)
      this.lastBarn = barn
    }

    // The equipped loadout is the hotbar's source of truth; rebuild when it
    // changes shape under us (a bag equip, a fresh seed type self-equipping).
    const signature = this.inventory.equipped.join('|')
    if (signature !== this.lastLoadout) {
      this.lastLoadout = signature
      this.rebuildHotbar()
      return
    }

    for (const el of this.hotbar.children as HTMLCollectionOf<HTMLElement>) {
      if (el.classList.contains('vacant')) continue
      const cropIndex = Number(el.dataset.index)
      const n = inv.seedCount(CROPS[cropIndex].id)
      el.classList.toggle('active', cropIndex === inv.selected)
      el.classList.toggle('empty', n === 0)
      const count = el.querySelector('.count') as HTMLElement
      count.textContent = String(n)
      count.style.display = n > 0 ? '' : 'none'
    }
  }

  /** Flash a topbar chip — used when a doober lands on it. */
  pulseChip(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    el.classList.remove('pulse')
    void el.offsetWidth // restart the animation
    el.classList.add('pulse')
  }

  updateClock(day: DayCycle) {
    this.dayCount.textContent = String(day.day)
    this.clockTime.textContent = day.clockLabel
    const id = clockIconId(day.hour)
    if (this.clockIco.dataset.icon !== id) {
      this.clockIco.dataset.icon = id
      this.clockIco.src = iconSrc(id)
    }
  }

  /** Season chip. Also shows the day within the season so the calendar reads. */
  updateSeason(season: { id?: string; emoji: string; name: string }, dayWithin: number, total: number) {
    const label = season.name + ' ' + dayWithin + '/' + total
    if (label === this.lastSeason) return
    this.lastSeason = label
    const id = (season.id ?? season.name).toLowerCase()
    this.seasonIco.src = iconSrc(id)
    this.seasonIco.dataset.icon = id
    this.seasonName.textContent = label
  }

  updateWeather(weather: Weather) {
    if (weather.label === this.lastWeather) return
    this.lastWeather = weather.label
    const id = weather.current.type
    this.weatherIco.src = iconSrc(id)
    this.weatherIco.dataset.icon = id
    this.weatherName.textContent = weather.current.name
  }

  updateLevel(progression: Progression) {
    this.lvlNum.textContent = String(progression.level)
    this.xpFill.style.width = `${progression.progress * 100}%`
    this.xpText.textContent =
      progression.level >= MAX_LEVEL
        ? 'MAX'
        : `${Math.floor(progression.xp)} / ${progression.xpNeeded}`
  }

  /** Full-width banner for a level-up. Queued so two levels at once both show. */
  levelUp(level: number, note: string) {
    const el = document.createElement('div')
    el.className = 'levelup'
    el.innerHTML = `<b>Level ${level}!</b><span>${note}</span>`
    document.getElementById('ui')!.appendChild(el)
    setTimeout(() => el.remove(), 3400)
  }

  /** Full-screen announcement for a global weather event. */
  eventBanner(iconId: string, emoji: string, name: string) {
    const el = document.createElement('div')
    el.className = 'event-banner'
    el.innerHTML =
      `<div class="event-title">${iconHtml(iconId, emoji, 'event-ico')} ${name}</div>` +
      `<div class="event-sub">Rare mutations available now</div>`
    document.getElementById('ui')!.appendChild(el)
    setTimeout(() => el.remove(), 4600)
  }

  /**
   * The "!" on the Pets button.
   *
   * Called every frame, so it must stay a no-op when nothing changed —
   * `classList.toggle` with an explicit boolean is exactly that, and the
   * animation is CSS, so nothing here restarts it.
   */
  setPetAlert(on: boolean) {
    document.querySelector('[data-nav="pets"]')?.classList.toggle('alert', on)
    /*
     * And on the launcher, because on a phone the rail is a sheet that is closed
     * almost all the time — a badge on a button nobody can see is no badge at
     * all. Harmless on a desktop, where the launcher is not rendered.
     */
    document.getElementById('navLauncher')?.classList.toggle('alert', on)
  }

  /** Shovel dock button: latched state plus the price of the next plot. */
  updateShovel(active: boolean, cost: number) {
    this.shovelChip.classList.toggle('active', active)
    this.shovelChip.title = active ? `Buy plot — ${cost} coins (B)` : 'Buy plots (B)'
    // Badge only while armed — icon-only dock otherwise.
    this.shovelCost.textContent = active ? String(cost) : ''
  }

  /**
   * Sprinkler dock button.
   *
   * Stays visible when unarmed, unlike the chip it replaced — a button that only
   * appears once the mode is already on cannot be used to turn the mode on.
   */
  updateSprinkler(active: boolean, tier: SprinklerTier | null) {
    this.sprinklerChip.classList.toggle('active', active)
    this.sprinklerChip.title = active && tier ? `${tier.name} (V)` : 'Place sprinkler (V)'
    this.sprinklerName.textContent = ''
  }

  /** Decor dock button. Same latching as the other two modes. */
  updateDecor(active: boolean) {
    this.decorBtn.classList.toggle('active', active)
  }

  setPrompt(action: TileAction | 'shop' | 'menu' | 'tame', context?: string) {
    let text = ''
    switch (action) {
      case 'menu':
        text = '<kbd>E</kbd> Open plot'
        break
      case 'till':
        text = '<kbd>E</kbd> Till soil'
        break
      case 'plant':
        text = context ? `<kbd>E</kbd> Plant ${context}` : '<kbd>E</kbd> No seeds — visit the shop'
        break
      case 'water':
        text = '<kbd>E</kbd> Water'
        break
      case 'harvest':
        text = `<kbd>E</kbd> Harvest ${context ?? ''}`
        break
      case 'shop':
        text = '<kbd>E</kbd> Open seed shop'
        break
      /*
       * The only prompt whose whole text comes from the caller.
       *
       * Every other action here is one fixed sentence, but this one has to name
       * both the animal and the crop it wants, and the crop is the entire
       * mechanic — a generic "feed animal" would leave the player with no way to
       * discover that a pig wants a dragonfruit.
       */
      case 'tame':
        text = context ? `<kbd>E</kbd> ${context}` : ''
        break
      default:
        text = ''
    }
    if (text === this.lastPrompt) return
    this.lastPrompt = text
    this.prompt.innerHTML = text
    this.prompt.classList.toggle('show', text !== '')
  }

  clearPrompt() {
    if (this.lastPrompt === '') return
    this.lastPrompt = ''
    this.prompt.classList.remove('show')
  }

  toast(message: string, kind: 'good' | 'bad' | 'info' = 'info') {
    const el = document.createElement('div')
    el.className = `toast ${kind}`
    el.innerHTML = message
    this.toasts.appendChild(el)
    setTimeout(() => el.remove(), 2300)
    /*
     * Two on screen at once, not five.
     *
     * They sit down the left edge over the play area, and a harvest spree fires
     * them faster than anyone reads: five deep, the column reached the hotbar
     * and the top ones had aged out before the eye got to them. Two is what can
     * actually be read in the 2.3s each one lives, and the newest — the one the
     * player just caused — is always among them.
     */
    while (this.toasts.children.length > 2) this.toasts.firstChild!.remove()
  }
}
