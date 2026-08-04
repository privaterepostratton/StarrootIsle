/**
 * First-time user experience: a six-step guided open.
 *
 * One card at a time, not a checklist — a new player should only ever have a
 * single instruction on screen. Steps that correspond to a real action
 * (plant, water, reach the shop) advance *by observing game state*, never by a
 * "Next" click: a tutorial the player can click through without doing the
 * thing teaches clicking, not farming. The two bookend steps carry no action,
 * so they are the only ones with a button.
 *
 * Deliberately not modal. Movement, camera and every panel stay live — the
 * card is a coach, not a cage, and anyone who ignores it and just plays will
 * complete it by accident, which is the best possible outcome.
 *
 * Progress persists per device (localStorage, not the save): a mid-tutorial
 * refresh resumes on the same step, a finished tutorial never returns, and
 * wiping the farm with `?new` does not force a veteran back through it.
 */

import { iconHtml } from './icons'

export interface FtueStats {
  plantedCount: number
  wateredCount: number
  nearShop: boolean
  /** Seed purchases made this session — the shop step watches this move. */
  seedsBought: number
}

/** The steps, by name. `main` uses these to keep each one completable. */
export type StepId = 'welcome' | 'plant' | 'water' | 'walk-to-shop' | 'buy-seeds'

/** What the finger should point at while a step is active. */
export type PointerHint = 'plot' | 'crop' | 'shop' | null

interface Step {
  /** Stable name for this step, so game code can ask what is being asked of the player. */
  id: StepId
  /** Painted icon id under /ui/icons (emoji is fallback). */
  iconId: string
  emoji: string
  title: string
  body: string
  /** Present = auto-advance when true. Absent = the card shows a button. */
  done?: (stats: FtueStats, baseline: FtueStats) => boolean
  button?: string
  /** Where the guiding finger points. Resolved to pixels by the caller. */
  pointer?: PointerHint
}

const STEPS: Step[] = [
  {
    iconId: 'ftue-welcome',
    id: 'welcome',
    emoji: '🌱',
    title: 'Welcome to Sprout Valley!',
    body: 'This garden is yours — everything inside the fence. Your neighbours farm the plots across the lane.',
    button: "Let's grow",
  },
  {
    iconId: 'ftue-plant',
    id: 'plant',
    emoji: '🥕',
    title: 'Plant a seed',
    body: 'Pick a seed from the hotbar (or press 1), then click any tilled plot to plant it.',
    done: (s, base) => s.plantedCount > base.plantedCount,
    pointer: 'plot',
  },
  {
    iconId: 'ftue-water',
    id: 'water',
    emoji: '💧',
    title: 'Water it',
    body: 'Click your sprout — watered crops grow faster and mutate more often.',
    done: (s, base) => s.wateredCount > base.wateredCount,
    pointer: 'crop',
  },
  {
    iconId: 'ftue-stall',
    id: 'walk-to-shop',
    emoji: '🏪',
    title: 'Walk to the seed stall',
    body: 'More seeds are sold at the market stall. Follow the lane out of your gate, south to the square.',
    done: (s) => s.nearShop,
    pointer: 'shop',
  },
  /*
   * Arriving is not the lesson; buying is. Standing near the stall taught the
   * player where it is and nothing about restocking, prices, or the fact that
   * the shelf only carries a few species at a time — and a player who never
   * opened it once has no reason to come back when they run out of turnips.
   *
   * Completed by a purchase rather than by opening the panel, because opening
   * it can be an accident on the way past.
   */
  {
    iconId: 'ftue-buy',
    id: 'buy-seeds',
    emoji: '🛒',
    title: 'Buy some seeds',
    body: 'Press E at the stall to open it, then buy a packet. The shelf restocks on a timer, so the good seeds are worth checking back for.',
    done: (s, base) => s.seedsBought > base.seedsBought,
    pointer: 'shop',
  },
]

const KEY = 'sv-ftue'

export class Ftue {
  private readonly root: HTMLDivElement
  /** The guiding finger. Position is fed per frame via setPointer. */
  private readonly finger: HTMLDivElement
  private step = 0
  private baseline: FtueStats = {
    plantedCount: 0,
    wateredCount: 0,
    nearShop: false,
    seedsBought: 0,
  }
  private baselineFresh = false
  /** Most recent stats seen, whatever the step — advance() snapshots from it. */
  private lastStats: FtueStats | null = null

  /** True while the tutorial is guiding — main mutes the ambient tips off it. */
  active = false

  constructor(
    freshFarm: boolean,
    private readonly onSfx: (id: 'click' | 'dismiss' | 'open') => void = () => {},
  ) {
    this.root = document.createElement('div')
    this.root.id = 'ftueCard'
    this.root.className = 'hidden'
    document.getElementById('ui')!.appendChild(this.root)

    this.finger = document.createElement('div')
    this.finger.id = 'ftuePointer'
    this.finger.textContent = '👇'
    this.finger.style.display = 'none'
    document.getElementById('ui')!.appendChild(this.finger)

    const stored = localStorage.getItem(KEY)
    if (stored === 'done') return
    // A returning device with a saved step resumes it; otherwise only a fresh
    // farm starts the tutorial — a veteran's existing farm explains itself.
    if (stored !== null) {
      this.step = Math.min(STEPS.length - 1, Number(stored) || 0)
    } else if (!freshFarm) {
      localStorage.setItem(KEY, 'done')
      return
    }
    this.active = true
    this.show()
  }

  /** Which step is on screen, or null when the tutorial is not running. */
  get stepId(): StepId | null {
    return this.active ? STEPS[this.step].id : null
  }

  /** What the active step wants pointed at; null when nothing (or inactive). */
  pointerHint(): PointerHint {
    if (!this.active) return null
    return STEPS[this.step].pointer ?? null
  }

  /**
   * Pin the finger above a screen point. `angle` (radians) swings it toward an
   * off-screen target — 0 keeps the default downward point for on-screen spots.
   * The bob animation lives on the element; only the anchor moves per frame.
   */
  setPointer(x: number, y: number, angle = 0) {
    this.finger.style.display = ''
    this.finger.style.left = `${x}px`
    this.finger.style.top = `${y}px`
    this.finger.style.setProperty('--aim', `${angle}rad`)
  }

  hidePointer() {
    this.finger.style.display = 'none'
  }

  /** Restart from step 0 — used by the dev panel for QA. */
  restart() {
    this.step = 0
    this.baselineFresh = false
    this.lastStats = null
    this.active = true
    localStorage.setItem(KEY, '0')
    this.show()
  }

  /** Feed live state; the current step decides whether it is finished. */
  update(stats: FtueStats) {
    if (!this.active) return
    this.lastStats = stats
    const step = STEPS[this.step]
    if (!step.done) return

    /*
     * The action baseline is captured when the step begins — normally by
     * advance(), from the frame *before* the click that advanced. This lazy
     * path only covers a resumed session, where no earlier frame exists. Both
     * exist so that pre-existing plants never auto-complete a step, and an
     * action performed in the same frame gap as the advance still counts.
     */
    if (!this.baselineFresh) {
      this.baseline = { ...stats }
      this.baselineFresh = true
      return
    }
    if (step.done(stats, this.baseline)) this.advance()
  }

  private advance() {
    this.step++
    if (this.lastStats) {
      this.baseline = { ...this.lastStats }
      this.baselineFresh = true
    } else {
      this.baselineFresh = false
    }
    if (this.step >= STEPS.length) {
      this.active = false
      localStorage.setItem(KEY, 'done')
      this.root.classList.add('hidden')
      this.hidePointer()
      return
    }
    localStorage.setItem(KEY, String(this.step))
    this.show()
  }

  private show() {
    const step = STEPS[this.step]
    this.root.classList.remove('hidden')
    // Re-trigger the entrance spring per step.
    this.root.classList.remove('ftue-in')
    void this.root.offsetWidth
    this.root.classList.add('ftue-in')
    this.root.innerHTML = `
      <div class="ftue-emoji">${iconHtml(step.iconId, step.emoji, 'ftue-ico')}</div>
      <div class="ftue-text">
        <b>${step.title}</b>
        <span>${step.body}</span>
      </div>
      <div class="ftue-side">
        <span class="ftue-count">${this.step + 1}/${STEPS.length}</span>
        ${step.button ? `<button class="ftue-next">${step.button}</button>` : ''}
        <button class="ftue-skip">Skip tour</button>
      </div>`
    this.onSfx('open')
    this.root.querySelector('.ftue-next')?.addEventListener('click', () => {
      this.onSfx('click')
      this.advance()
    })
    this.root.querySelector('.ftue-skip')!.addEventListener('click', () => {
      this.onSfx('dismiss')
      this.active = false
      localStorage.setItem(KEY, 'done')
      this.root.classList.add('hidden')
      this.hidePointer()
    })
  }
}
