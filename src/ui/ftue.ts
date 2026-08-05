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
  /** Beds the farm has, planted or not — the plant step asks for all of them. */
  plotCount: number
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
  /** 0 before the farm exists, then 1..3 as the garden is upgraded. */
  gardenLevel: number
}

/** The steps, by name. `main` uses these to keep each one completable. */
export type StepId =
  | 'welcome'
  | 'gather-seeds'
  | 'find-ground'
  | 'clear-trees'
  | 'plant'
  | 'water'
  | 'upgrade-garden'

/** What the finger should point at while a step is active. */
export type PointerHint = 'plot' | 'crop' | 'shop' | 'seeds' | 'trees' | 'mailbox' | null

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
  /**
   * Live "2/4" style tally, for a step that asks for more than one of something.
   *
   * A step the player can satisfy in one action needs no counter — the card
   * disappearing is the feedback. A step that wants four says so, and then has
   * to show the four filling up, or the third plant is indistinguishable from
   * the first and the player cannot tell the instruction is being followed.
   */
  progress?: (stats: FtueStats, baseline: FtueStats) => string | null
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
    /*
     * Dismissed by playing, not only by clicking.
     *
     * The button is the polite way past this card, but a player who has already
     * worked out what to do and walked off to grab a barrel should not come back
     * to a screen still asking them to go and look at the tide. Any real
     * progress — a crate taken, a tree felled, a farm cut — stands the card
     * down, and the steps behind it then satisfy themselves in turn, so
     * overtaking the tutorial fast-forwards it instead of leaving it stuck
     * describing something you have finished.
     */
    done: (s, base) => s.cratesLeft < base.cratesLeft || s.treesLeft < base.treesLeft || s.hasFarm,
    /*
     * The guides are up before the card is even dismissed.
     *
     * This step is the one place the player has no idea what the game wants,
     * and the card telling them to look at the tide is worth much more with
     * three gold trails already running down the sand to the crates it means.
     * Nothing is asked of them yet, so there is no instruction to pre-empt.
     */
    pointer: 'seeds',
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
    title: 'Fill the beds',
    /*
     * All four, not one.
     *
     * Planting a single seed teaches the click and leaves the player standing in
     * a farm that is three-quarters bare, with no sense of what a working bed
     * looks like — and the next step then has them watering one sprout in an
     * empty plot. Filling the plot is the same lesson four times for the cost of
     * a few seconds, and it hands over a farm that looks like a farm.
     */
    body: 'Pick a seed from the hotbar (or press 1), then click a bed to plant it. Fill every bed in the plot.',
    done: (s) => s.plotCount > 0 && s.plantedCount >= s.plotCount,
    progress: (s) => (s.plotCount > 0 ? `${Math.min(s.plantedCount, s.plotCount)}/${s.plotCount} planted` : null),
    pointer: 'plot',
  },
  {
    iconId: 'ftue-water',
    id: 'water',
    emoji: '💧',
    title: 'Water it',
    body: 'Click your sprout — watered crops grow faster and mutate more often.',
    /*
     * Absolute, not "one more than when this card appeared".
     *
     * A player who waters each bed as they plant it arrives here with the job
     * already done, and a relative test would sit asking them to water
     * something that is already wet — the card would only clear when a crop
     * dried out. Asking whether every planted bed is watered is the same
     * question and answers correctly however the player got here.
     */
    done: (s) => s.plantedCount > 0 && s.wateredCount >= s.plantedCount,
    progress: (s) =>
      s.plantedCount > 0 ? `${Math.min(s.wateredCount, s.plantedCount)}/${s.plantedCount} watered` : null,
    pointer: 'crop',
  },
]

const KEY = 'sv-ftue'
const UPGRADE_KEY = 'sv-ftue-upgrade'

/**
 * The second tour: the garden upgrade, taught when it first becomes possible.
 *
 * The opening tutorial ends with a watered bed and never mentions that the
 * ground itself can be bought — which is the single biggest thing the player
 * can do with money, standing at a mailbox they have walked past a hundred
 * times. It is taught at level 2 rather than at the start because that is when
 * it becomes true, and a tutorial for something you cannot yet afford is just
 * an advert.
 */
const UPGRADE_STEPS: Step[] = [
  {
    iconId: 'ftue-buy',
    id: 'upgrade-garden',
    emoji: '📮',
    title: 'Room to grow',
    body: 'Your garden can be extended. Head to the mailbox by the gate and press E — here is the coin for it.',
    done: (s, base) => s.gardenLevel > base.gardenLevel,
    pointer: 'mailbox',
  },
]

/** Forget the upgrade tour too, so a wiped save teaches it again. */
export function forgetUpgradeTour() {
  try {
    localStorage.removeItem(UPGRADE_KEY)
  } catch {
    /* storage off */
  }
}

/** A tour that waits for its cue. See Ftue's `autoStart`. */
export function createUpgradeTour(onSfx: (id: 'click' | 'dismiss' | 'open') => void) {
  return new Ftue(false, onSfx, UPGRADE_STEPS, UPGRADE_KEY, false)
}

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
    plotCount: 0,
    wateredCount: 0,
    nearShop: false,
    seedsBought: 0,
    cratesLeft: 0,
    treesLeft: 0,
    hasFarm: false,
    gardenLevel: 0,
  }
  private baselineFresh = false
  /** Most recent stats seen, whatever the step — advance() snapshots from it. */
  private lastStats: FtueStats | null = null
  /** The live tally on the card, and what it currently reads. */
  private progress: HTMLElement | null = null
  private progressText = ''

  /** True while the tutorial is guiding — main mutes the ambient tips off it. */
  active = false

  /** Already seen through, or skipped, on this device. */
  get finished() {
    return localStorage.getItem(this.storeKey) === 'done'
  }

  /**
   * Start a tour that was waiting for its cue.
   *
   * Distinct from `restart`, which replays a finished one for QA: this is the
   * first run of a tour whose trigger is a moment in the game rather than a new
   * save, and it must not re-fire for someone who has already been through it.
   */
  begin() {
    if (this.active || this.finished) return
    this.step = 0
    this.baselineFresh = false
    this.lastStats = null
    this.active = true
    localStorage.setItem(this.storeKey, '0')
    this.show()
  }

  constructor(
    freshFarm: boolean,
    private readonly onSfx: (id: 'click' | 'dismiss' | 'open') => void = () => {},
    /*
     * Which tour this is.
     *
     * The opening is not the only thing worth teaching: the garden upgrade
     * arrives an hour later and is just as invisible, and it wants the same
     * card, the same finger and the same gold trail rather than a second
     * parallel implementation of all three. A tour is its list of steps plus
     * the key it remembers itself under.
     */
    private readonly steps: Step[] = STEPS,
    private readonly storeKey: string = KEY,
    /** False for a tour that begins later — see `begin`. */
    autoStart = true,
  ) {
    /*
     * Classes, not ids.
     *
     * There is more than one tour now, and each builds its own card — two
     * elements with the same id is invalid, and the first `getElementById`
     * anywhere in the codebase would silently pick whichever was created first.
     */
    this.root = document.createElement('div')
    this.root.className = 'ftue-card hidden'
    document.getElementById('ui')!.appendChild(this.root)

    this.finger = document.createElement('div')
    this.finger.className = 'ftue-pointer'
    this.finger.textContent = '👇'
    this.finger.style.display = 'none'
    document.getElementById('ui')!.appendChild(this.finger)

    const stored = localStorage.getItem(this.storeKey)
    if (stored === 'done') return
    // A returning device with a saved step resumes it; otherwise only a fresh
    // farm starts the tutorial — a veteran's existing farm explains itself.
    if (stored !== null) {
      this.step = Math.min(this.steps.length - 1, Number(stored) || 0)
    } else if (!autoStart) {
      // Waiting for its cue. Nothing is stored, so it can still fire later.
      return
    } else if (!freshFarm) {
      localStorage.setItem(this.storeKey, 'done')
      return
    }
    this.active = true
    this.show()
  }

  /** Which step is on screen, or null when the tutorial is not running. */
  get stepId(): StepId | null {
    return this.active ? this.steps[this.step].id : null
  }

  /** What the active step wants pointed at; null when nothing (or inactive). */
  pointerHint(): PointerHint {
    if (!this.active) return null
    return this.steps[this.step].pointer ?? null
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
    localStorage.setItem(this.storeKey, '0')
    this.show()
  }

  /** Feed live state; the current step decides whether it is finished. */
  update(stats: FtueStats) {
    if (!this.active) return
    this.lastStats = stats
    const step = this.steps[this.step]

    if (this.progress) {
      const text = step.progress?.(stats, this.baseline) ?? ''
      // Written only on change: this runs every frame, and assigning identical
      // text still dirties the node for the next layout pass.
      if (text !== this.progressText) {
        this.progressText = text
        this.progress.textContent = text
        this.progress.classList.toggle('hidden', text === '')
      }
    }

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
    if (this.step >= this.steps.length) {
      this.active = false
      localStorage.setItem(this.storeKey, 'done')
      this.root.classList.add('hidden')
      this.publishHeight()
      this.hidePointer()
      return
    }
    localStorage.setItem(this.storeKey, String(this.step))
    this.show()
  }

  private show() {
    const step = this.steps[this.step]
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
        <span class="ftue-count">${this.step + 1}/${this.steps.length}</span>
        <span class="ftue-prog hidden"></span>
        ${step.button ? `<button class="ftue-next">${step.button}</button>` : ''}
        <button class="ftue-skip">Skip tour</button>
      </div>`
    // Re-found per step: show() rewrites the card wholesale, so the previous
    // step's node is detached by the time this runs.
    this.progress = this.root.querySelector('.ftue-prog')
    this.progressText = ''
    this.onSfx('open')
    this.root.querySelector('.ftue-next')?.addEventListener('click', () => {
      this.onSfx('click')
      this.advance()
    })
    this.root.querySelector('.ftue-skip')!.addEventListener('click', () => {
      this.onSfx('dismiss')
      this.active = false
      localStorage.setItem(this.storeKey, 'done')
      this.root.classList.add('hidden')
      this.publishHeight()
      this.hidePointer()
    })
  }
}
