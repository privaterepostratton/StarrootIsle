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
  /** Seed crates still lying on the sand. */
  cratesLeft: number
  /** Trees of the opening stand still standing. */
  treesLeft: number
  /** True once the clearing has been cut and the farm exists. */
  hasFarm: boolean
}

/** The steps, by name. `main` uses these to keep each one completable. */
export type StepId =
  | 'welcome'
  | 'gather-seeds'
  | 'find-ground'
  | 'clear-trees'
  | 'plant'
  | 'water'

/** What the finger should point at while a step is active. */
export type PointerHint = 'plot' | 'crop' | 'shop' | 'seeds' | 'trees' | null

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

/*
 * The opening, in the order the player actually does it.
 *
 * The old sequence assumed a farm: it opened with "this garden is yours",
 * taught planting on beds that already existed, and finished by walking to a
 * stall that had always been standing there. None of that is true any more —
 * the player wakes on a beach owning nothing, and the stall does not exist
 * until level 2.
 *
 * So the tutorial now teaches the three things that are genuinely new, in the
 * order the world presents them: find the seeds, find the ground, pay to clear
 * it. Planting and watering come after, on a farm the player made rather than
 * one they were given — which is the whole reason for the change.
 *
 * Nothing here mentions the stall. It arrives with a level-up banner of its own
 * several minutes later, and a tutorial that points at a building which is not
 * there yet is worse than no tutorial.
 */
const STEPS: Step[] = [
  {
    iconId: 'ftue-welcome',
    id: 'welcome',
    emoji: '🌊',
    title: 'Washed ashore',
    body: 'You have the clothes you stand in and a handful of coins. There is good soil inland — but first, see what came in with the tide.',
    button: 'Take a look',
  },
  {
    iconId: 'ftue-plant',
    id: 'gather-seeds',
    emoji: '🥬',
    title: 'Gather the seed crates',
    body: 'Three crates washed up along the sand. Walk over each one to pick it up.',
    done: (s) => s.cratesLeft === 0,
    pointer: 'seeds',
  },
  {
    iconId: 'ftue-stall',
    id: 'find-ground',
    emoji: '🌲',
    title: 'Find somewhere to plant',
    body: 'Seeds are no use on sand. Head inland — there is a stand of trees on ground worth clearing.',
    done: (s) => s.treesLeft < 4,
    pointer: 'trees',
  },
  {
    iconId: 'ftue-buy',
    id: 'clear-trees',
    emoji: '🪓',
    title: 'Clear the trees',
    body: 'Stand by a tree and press E to pay to fell it. Clear them all and the ground is yours.',
    done: (s) => s.hasFarm,
    pointer: 'trees',
  },
  {
    iconId: 'ftue-plant',
    id: 'plant',
    emoji: '🌱',
    title: 'Plant your first seed',
    body: 'Pick a seed from the hotbar (or press 1), then click any bed to plant it.',
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
]

const KEY = 'sv-ftue'

/**
 * How much room the card is taking at the bottom of the screen.
 *
 * The interaction prompt ("E — Clear this tree") is anchored bottom-centre too,
 * and the two landed on top of each other: the card is the taller of the pair,
 * so it simply covered the prompt telling the player what to press — during the
 * one step of the game where they have never pressed it before.
 *
 * Published as a CSS variable rather than fixed in the stylesheet because the
 * card's height depends on how the body text wraps, which depends on the step
 * and the window width. A hard-coded offset is right at one size and wrong at
 * every other.
 */
const LIFT_VAR = '--ftue-lift'

/**
 * Forget that the tour was ever completed.
 *
 * Separate from `restart()`, which replays it for this session only. A save
 * wipe has to clear the stored flag as well, or the "new game" the dev panel
 * produces is a new game that skips its own tutorial — which is the one thing
 * you were most likely wiping the save to look at.
 */
export function forgetFtue() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage off */
  }
}

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
    cratesLeft: 0,
    treesLeft: 0,
    hasFarm: false,
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
  /** Tell the stylesheet how tall the card currently is. See LIFT_VAR. */
  private publishHeight() {
    const shown = !this.root.classList.contains('hidden')
    const lift = shown ? this.root.offsetHeight + 12 : 0
    document.documentElement.style.setProperty(LIFT_VAR, `${lift}px`)
  }

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
      this.publishHeight()
      this.hidePointer()
      return
    }
    localStorage.setItem(KEY, String(this.step))
    this.show()
  }

  private show() {
    const step = STEPS[this.step]
    this.root.classList.remove('hidden')
    this.publishHeight()
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
      this.publishHeight()
      this.hidePointer()
    })
  }
}
