/**
 * Contextual onboarding.
 *
 * Not a modal tutorial. The game now has a dozen interlocking systems, and a
 * wall of text up front teaches none of them — so each tip is bound to a
 * condition and fires the first time the player is actually in that situation.
 * Tips fire from real game state, not on the title screen.
 *
 * Each tip fires once ever and is remembered separately from the save, so
 * resetting the farm does not replay the tutorial.
 */

const KEY = 'sprout-valley-tips-v1'

export interface TipContext {
  level: number
  coins: number
  /** Plots owned. */
  plots: number
  tilledCount: number
  plantedCount: number
  ripeCount: number
  seedsHeld: number
  produceStacks: number
  hasHarvested: boolean
  hasMutation: boolean
  nearShop: boolean
  /** Late enough in the day that the raid window is coming. */
  isRaining: boolean
  petCount: number
}

interface Tip {
  id: string
  title: string
  body: string
  /** Fires the first frame this returns true. */
  when(c: TipContext): boolean
}

/**
 * Ordered by when they should appear. Only one tip is ever on screen, and the
 * first matching unseen tip wins — so an earlier entry acts as a prerequisite
 * for everything after it.
 */
const TIPS: Tip[] = [
  {
    id: 'open-plot',
    title: 'Your farm',
    body: 'The fenced plots are yours. <b>Click one</b> to open it, or stand on it and press <b>E</b>.',
    when: (c) => c.plots > 0,
  },
  {
    id: 'plant',
    title: 'Get something in the ground',
    body: 'Pick a seed from the <b>hotbar</b> at the bottom, then <b>Plant</b> it in one of your plots.',
    when: (c) => c.tilledCount > 0 && c.plantedCount === 0 && c.seedsHeld > 0,
  },
  {
    id: 'water',
    title: 'Water grows things twice as fast',
    body: 'Watered soil doubles growth speed. Rain waters everything for free — and sprinklers do it forever.',
    when: (c) => c.plantedCount > 0,
  },
  /*
   * Placed ahead of the rest of the ladder on purpose.
   *
   * The first matching unseen tip wins, so position is priority — and this one
   * is the only tip in the list with a deadline. It has to land while the sun is
   * still going down, not after the player has been robbed, so it outranks
   * everything about selling and expanding. Gated on having crops in the ground
   * because a warning about losing them means nothing to a player with none.
   */
  {
    id: 'harvest',
    title: 'Ready to pick',
    body: 'Sparkling plants are ripe. Open the plot and <b>Harvest</b> — most crops regrow and can be picked again.',
    when: (c) => c.ripeCount > 0,
  },
  {
    id: 'sell',
    title: 'Turn crops into coins',
    body: 'Walk to the <b>seed stall</b> and open the <b>Sell</b> tab. Heavier and rarer fruit is worth far more.',
    when: (c) => c.hasHarvested && c.produceStacks > 0,
  },
  {
    id: 'restock',
    title: 'The shop restocks',
    body: 'Seeds are limited and the stall refills on a timer. If something good is in stock, buy it now.',
    when: (c) => c.nearShop && c.coins > 100,
  },
  {
    id: 'mutation',
    title: 'That one is special',
    body: 'Weather and time of day mutate growing crops. Mutations <b>stack</b>, and each multiplies the price.',
    when: (c) => c.hasMutation,
  },
  {
    id: 'rain',
    title: 'Free watering',
    body: "It's raining — every tilled plot is being watered for you, and rain can leave crops <b>Wet</b>.",
    when: (c) => c.isRaining && c.plantedCount > 0,
  },
  {
    id: 'expand',
    title: 'Room to grow',
    body: 'Press <b>B</b> for the shovel, then click bare ground next to your farm to buy another plot.',
    when: (c) => c.coins > 400,
  },
  {
    id: 'pets',
    title: 'Eggs hatch into helpers',
    body: 'Press <b>K</b> to open pets. Buy an egg, wait for it to hatch, and equip up to three — each one buffs your whole farm.',
    when: (c) => c.level >= 3 && c.petCount === 0,
  },
  {
    id: 'neighbours',
    title: 'You have neighbours',
    body: 'Press <b>N</b> for the valley roster. Visit their farms, water their crops for XP, and climb the leaderboard.',
    when: (c) => c.level >= 4,
  },
]

/**
 * Seconds between one tip being dismissed and the next being allowed on screen.
 *
 * Was six, which is nothing: several tips have conditions that all come true
 * during the same minute of play — first harvest, first sale, barn filling — so
 * dismissing one just brought up the next, and the player spent a stretch of the
 * early game closing cards instead of farming. Twenty puts real play between
 * them, which is also what makes each one land as advice about the thing that
 * just happened rather than as a queue draining.
 */
const TIP_GAP = 20

export class Tips {
  private seen: Set<string>
  private readonly root: HTMLDivElement
  private current: Tip | null = null
  /** Seconds before another tip may appear, so they never chain. */
  private cooldown = TIP_GAP
  /** Whether tips were allowed last frame — see the transition in update(). */
  private wasEnabled = false
  /** Dev force-show: keep the card up even if tips are disabled this frame. */
  private sticky = false

  enabled = true

  constructor(private readonly onSfx: (id: 'open' | 'dismiss') => void = () => {}) {
    this.seen = loadSeen()

    this.root = document.createElement('div')
    this.root.id = 'tipCard'
    this.root.className = 'hidden'
    document.getElementById('ui')!.appendChild(this.root)
  }

  private show(tip: Tip, remember = true) {
    this.current = tip
    if (remember) {
      this.seen.add(tip.id)
      saveSeen(this.seen)
    }

    this.root.innerHTML = `
      <div class="tip-title">${tip.title}</div>
      <div class="tip-body">${tip.body}</div>
      <button class="tip-dismiss">Got it</button>`
    this.root.classList.remove('hidden')
    this.onSfx('open')
    this.root.querySelector('.tip-dismiss')!.addEventListener('click', () => this.dismiss())
  }

  /**
   * Force a tip on screen for QA. Does not mark it seen, so the real trigger
   * can still fire later. Defaults to whichever tip is first in the list.
   */
  forceShow(id?: string) {
    const tip = TIPS.find((t) => t.id === id) ?? TIPS[0]
    this.sticky = true
    this.cooldown = 0
    this.show(tip, false)
  }

  dismiss() {
    if (this.current) this.onSfx('dismiss')
    this.current = null
    this.sticky = false
    this.root.classList.add('hidden')
    this.cooldown = TIP_GAP
  }

  update(dt: number, ctx: TipContext) {
    /*
     * Becoming allowed starts a full gap, it does not resume one.
     *
     * The cooldown only ticks while tips are enabled, so it sat untouched for the
     * whole tutorial and the first real tip arrived a couple of seconds after the
     * last tour card — the two read as one continuous wall of text, which is
     * exactly when a player stops reading them. The same applies to switching
     * tips back on in settings: the gap is time spent *playing*, so it starts
     * when play does.
     */
    const allowed = this.enabled || this.sticky
    if (allowed && !this.wasEnabled) this.cooldown = Math.max(this.cooldown, TIP_GAP)
    this.wasEnabled = allowed

    if (!this.enabled && !this.sticky) {
      if (this.current) this.dismiss()
      return
    }
    if (this.current) return
    if (!this.enabled) return

    this.cooldown -= dt
    if (this.cooldown > 0) return

    for (const tip of TIPS) {
      if (this.seen.has(tip.id)) continue
      if (!tip.when(ctx)) continue
      this.show(tip)
      return
    }
  }

  /** Replay the whole sequence. Exposed for the settings panel. */
  reset() {
    this.seen = new Set()
    saveSeen(this.seen)
    this.cooldown = 0
  }

  get remaining() {
    return TIPS.length - this.seen.size
  }
}

function loadSeen() {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set<string>()
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]))
  } catch {
    /* ignore */
  }
}
