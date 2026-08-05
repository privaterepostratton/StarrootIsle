/**
 * Quests and daily challenges.
 *
 * The chain is authored and strictly ordered — it is the tutorial and the
 * long-term goal list in one, walking the player from their first turnip to a
 * rainbow dragonfruit. Dailies are generated fresh each in-game day from a
 * pool, scaled to the player's level, and exist to give a reason to log in
 * when the chain is between milestones.
 *
 * Both read from the same counter set, so a single harvest can advance a
 * chain objective and a daily at once.
 */

export type ObjectiveKind =
  | 'harvest' // any crop
  | 'harvestCrop' // a specific crop
  | 'plant'
  /**
   * Retired: plots arrive tilled, so this is never generated any more. The kind,
   * its counter and its progress lookup are kept so a save holding an in-flight
   * "Till N plots" daily still loads and can still be completed — buying a plot
   * records it.
   */
  | 'till'
  | 'water'
  | 'earn' // coins earned from sales
  | 'plots' // plots owned (absolute, not counted)
  | 'coins' // coins held (absolute, not counted)
  | 'level' // player level (absolute)
  | 'mutation' // harvest a crop carrying any mutation
  | 'rarity' // harvest a crop of at least this rarity

export interface Objective {
  kind: ObjectiveKind
  target: number
  /** For harvestCrop. */
  cropId?: string
  /** For rarity objectives: the minimum rarity id. */
  rarityId?: string
  label: string
}

export interface QuestReward {
  coins: number
  xp: number
  seeds?: { id: string; qty: number }[]
}

export interface Quest {
  id: string
  name: string
  blurb: string
  objectives: Objective[]
  reward: QuestReward
}

/** Objectives that read a live value rather than accumulating one. */
const ABSOLUTE: ObjectiveKind[] = ['plots', 'coins', 'level']

export const QUEST_CHAIN: Quest[] = [
  {
    id: 'first-roots',
    name: 'Tidebound Seeds',
    blurb: 'Every isle farm starts with salt air and soft soil.',
    objectives: [
      { kind: 'plant', target: 4, label: 'Plant 4 seeds' },
      { kind: 'water', target: 4, label: 'Water 4 plots' },
    ],
    reward: { coins: 40, xp: 30, seeds: [{ id: 'turnip', qty: 4 }] },
  },
  {
    id: 'first-harvest',
    name: 'Lagoon Bounty',
    blurb: 'Water them and wait. A warm rain will do the job for you.',
    objectives: [
      { kind: 'water', target: 4, label: 'Water 4 plots' },
      { kind: 'harvestCrop', cropId: 'turnip', target: 4, label: 'Harvest 4 Turnips' },
    ],
    reward: { coins: 70, xp: 50 },
  },
  {
    id: 'market-day',
    name: 'Seaside Stall',
    blurb: 'The stall by the palm path buys anything you grow.',
    objectives: [{ kind: 'earn', target: 120, label: 'Earn 🪙120 from sales' }],
    reward: { coins: 90, xp: 70, seeds: [{ id: 'carrot', qty: 4 }] },
  },
  {
    id: 'room-to-grow',
    name: 'Clearing the Canopy',
    blurb: 'Take out the shovel and claim more shoreline.',
    objectives: [{ kind: 'plots', target: 12, label: 'Own 12 plots' }],
    reward: { coins: 140, xp: 90 },
  },
  {
    id: 'carrot-top',
    name: 'Coral Carrots',
    blurb: 'Bright roots that pay better than turnips.',
    objectives: [{ kind: 'harvestCrop', cropId: 'carrot', target: 8, label: 'Harvest 8 Carrots' }],
    reward: { coins: 200, xp: 130, seeds: [{ id: 'strawberry', qty: 3 }] },
  },
  {
    id: 'strange-weather',
    name: 'Moonlit Monsoon',
    blurb: 'Leave a crop out through rain or a starlit night and see what happens.',
    objectives: [{ kind: 'mutation', target: 3, label: 'Harvest 3 mutated crops' }],
    reward: { coins: 300, xp: 200 },
  },
  {
    id: 'berry-good',
    name: 'Berry Atoll',
    blurb: 'Strawberries yield double — worth the wait in the shade.',
    objectives: [{ kind: 'harvestCrop', cropId: 'strawberry', target: 10, label: 'Harvest 10 Strawberries' }],
    reward: { coins: 420, xp: 280 },
  },
  {
    id: 'expanding-acres',
    name: 'Wider Shores',
    blurb: 'A proper isle farm needs proper space.',
    objectives: [
      { kind: 'plots', target: 24, label: 'Own 24 plots' },
      { kind: 'level', target: 6, label: 'Reach level 6' },
    ],
    reward: { coins: 600, xp: 400, seeds: [{ id: 'corn', qty: 4 }] },
  },
  {
    id: 'golden-fields',
    name: 'Sunlit Stalks',
    blurb: 'Corn takes its time under the palm sun, but pays for the patience.',
    objectives: [{ kind: 'harvestCrop', cropId: 'corn', target: 10, label: 'Harvest 10 Corn' }],
    reward: { coins: 900, xp: 600 },
  },
  {
    id: 'struck-lucky',
    name: 'Pearl of Chance',
    blurb: 'Silver or better. Plant enough and the tide brings luck.',
    objectives: [{ kind: 'rarity', rarityId: 'silver', target: 5, label: 'Harvest 5 Silver-or-better crops' }],
    reward: { coins: 1200, xp: 800 },
  },
  {
    id: 'pumpkin-patch',
    name: 'Gourd Lagoon',
    blurb: 'Round, rich, and ripe for the island autumn.',
    objectives: [{ kind: 'harvestCrop', cropId: 'pumpkin', target: 10, label: 'Harvest 10 Pumpkins' }],
    reward: { coins: 1800, xp: 1100, seeds: [{ id: 'melon', qty: 3 }] },
  },
  {
    id: 'coin-purse',
    name: 'Shell Coffers',
    blurb: 'Save up. The rarest seeds are not cheap on this isle.',
    objectives: [{ kind: 'coins', target: 5000, label: 'Hold 🪙5,000 at once' }],
    reward: { coins: 1500, xp: 1400 },
  },
  {
    id: 'melon-baron',
    name: 'Melon Reef',
    blurb: 'Two melons per plot, every plot along the shore.',
    objectives: [
      { kind: 'harvestCrop', cropId: 'melon', target: 12, label: 'Harvest 12 Melons' },
      { kind: 'plots', target: 48, label: 'Own 48 plots' },
    ],
    reward: { coins: 3200, xp: 2200 },
  },
  {
    id: 'sunflower-estate',
    name: 'Sunflare Grove',
    blurb: 'The tallest crop on Starroot Isle.',
    objectives: [{ kind: 'harvestCrop', cropId: 'sunflower', target: 10, label: 'Harvest 10 Sunflowers' }],
    reward: { coins: 6000, xp: 4000, seeds: [{ id: 'dragonfruit', qty: 2 }] },
  },
  {
    id: 'gold-standard',
    name: 'Starlit Gold',
    blurb: 'One in fifty, if the starroot luck holds.',
    objectives: [{ kind: 'rarity', rarityId: 'gold', target: 3, label: 'Harvest 3 Gold-or-better crops' }],
    reward: { coins: 9000, xp: 6000 },
  },
  {
    id: 'dragons-hoard',
    name: "Volcano's Hoard",
    blurb: 'The last and richest crop on the isle.',
    objectives: [
      { kind: 'harvestCrop', cropId: 'dragonfruit', target: 8, label: 'Harvest 8 Dragonfruit' },
      { kind: 'coins', target: 40000, label: 'Hold 🪙40,000 at once' },
    ],
    reward: { coins: 25000, xp: 12000 },
  },
]

/** Templates for generated dailies. `scale` multiplies the target by level. */
interface DailyTemplate {
  kind: ObjectiveKind
  base: number
  scale: number
  label: (n: number) => string
  reward: (n: number, level: number) => QuestReward
}

const DAILY_TEMPLATES: DailyTemplate[] = [
  {
    kind: 'harvest',
    base: 6,
    scale: 1.6,
    label: (n) => `Harvest ${n} crops`,
    reward: (n, lvl) => ({ coins: n * 12 * lvl, xp: n * 6 * lvl }),
  },
  {
    kind: 'plant',
    base: 8,
    scale: 1.5,
    label: (n) => `Plant ${n} seeds`,
    reward: (n, lvl) => ({ coins: n * 8 * lvl, xp: n * 4 * lvl }),
  },
  {
    kind: 'water',
    base: 8,
    scale: 1.5,
    label: (n) => `Water ${n} plots`,
    reward: (n, lvl) => ({ coins: n * 7 * lvl, xp: n * 4 * lvl }),
  },
  {
    kind: 'mutation',
    base: 1,
    scale: 0.6,
    label: (n) => `Harvest ${n} mutated crop${n === 1 ? '' : 's'}`,
    reward: (n, lvl) => ({ coins: n * 90 * lvl, xp: n * 45 * lvl }),
  },
  {
    kind: 'earn',
    base: 200,
    scale: 140,
    label: (n) => `Earn 🪙${n} from sales`,
    reward: (n, lvl) => ({ coins: Math.round(n * 0.4), xp: Math.round(n * 0.2 * lvl) }),
  },
]

export interface DailyChallenge {
  id: string
  objective: Objective
  reward: QuestReward
  progress: number
  claimed: boolean
}

/** Counters the quest system reads. Absolute kinds are pushed in each frame. */
export interface QuestCounters {
  harvest: number
  plant: number
  till: number
  water: number
  earn: number
  mutation: number
  /** Per-crop harvest tallies. */
  crops: Record<string, number>
  /** Tally of harvests at each rarity or better, keyed by rarity id. */
  rarity: Record<string, number>
  /** Live values. */
  plots: number
  coins: number
  level: number
}

function emptyCounters(): QuestCounters {
  return { harvest: 0, plant: 0, till: 0, water: 0, earn: 0, mutation: 0, crops: {}, rarity: {}, plots: 0, coins: 0, level: 1 }
}

/** Rarity ordering for "at least this good" objectives. */
const RARITY_RANK: Record<string, number> = { common: 0, silver: 1, gold: 2, rainbow: 3 }

export class Quests {
  /** Index into QUEST_CHAIN. Equal to the length once everything is done. */
  chainIndex = 0
  /** Accumulated counters, reset per quest so targets are per-quest. */
  private counters = emptyCounters()
  /** Counters for the current day's challenges, reset at each day rollover. */
  private dailyCounters = emptyCounters()

  dailies: DailyChallenge[] = []
  dailyDay = -1

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  get current(): Quest | null {
    return QUEST_CHAIN[this.chainIndex] ?? null
  }

  get allComplete() {
    return this.chainIndex >= QUEST_CHAIN.length
  }

  /** Roll a fresh set of dailies. Called on day rollover and on first load. */
  rollDailies(day: number, level: number) {
    if (this.dailyDay === day) return
    this.dailyDay = day
    this.dailyCounters = emptyCounters()

    const pool = [...DAILY_TEMPLATES]
    this.dailies = []
    for (let i = 0; i < 3 && pool.length; i++) {
      const [template] = pool.splice(Math.floor(Math.random() * pool.length), 1)
      const n = Math.max(1, Math.round(template.base + template.scale * (level - 1)))
      this.dailies.push({
        id: `${day}-${template.kind}-${i}`,
        objective: { kind: template.kind, target: n, label: template.label(n) },
        reward: template.reward(n, level),
        progress: 0,
        claimed: false,
      })
    }
    this.emit()
  }

  /** Record a countable event. `cropId` and `rarityId` refine harvest events. */
  record(kind: ObjectiveKind, amount = 1, opts: { cropId?: string; rarityId?: string; mutated?: boolean } = {}) {
    for (const set of [this.counters, this.dailyCounters]) {
      switch (kind) {
        case 'harvest':
          set.harvest += amount
          if (opts.cropId) set.crops[opts.cropId] = (set.crops[opts.cropId] ?? 0) + amount
          if (opts.mutated) set.mutation += amount
          if (opts.rarityId) {
            // Count toward every rarity tier this one meets or beats, so an
            // "at least silver" objective is satisfied by a gold drop.
            const rank = RARITY_RANK[opts.rarityId] ?? 0
            for (const [id, r] of Object.entries(RARITY_RANK)) {
              if (rank >= r) set.rarity[id] = (set.rarity[id] ?? 0) + amount
            }
          }
          break
        case 'plant':
          set.plant += amount
          break
        case 'till':
          set.till += amount
          break
        case 'water':
          set.water += amount
          break
        case 'earn':
          set.earn += amount
          break
        default:
          break
      }
    }
    this.syncDailies()
    this.emit()
  }

  /** Push live values that are read rather than accumulated. */
  setLive(plots: number, coins: number, level: number) {
    for (const set of [this.counters, this.dailyCounters]) {
      set.plots = plots
      // Objectives ask to *hold* an amount at once, so track the peak.
      set.coins = Math.max(set.coins, coins)
      set.level = level
    }
  }

  progressOf(objective: Objective, set = this.counters) {
    switch (objective.kind) {
      case 'harvest':
        return set.harvest
      case 'harvestCrop':
        return set.crops[objective.cropId ?? ''] ?? 0
      case 'plant':
        return set.plant
      case 'till':
        return set.till
      case 'water':
        return set.water
      case 'earn':
        return set.earn
      case 'mutation':
        return set.mutation
      case 'rarity':
        return set.rarity[objective.rarityId ?? 'common'] ?? 0
      case 'plots':
        return set.plots
      case 'coins':
        return set.coins
      case 'level':
        return set.level
      default:
        return 0
    }
  }

  /** True when every objective on the active quest is satisfied. */
  isCurrentComplete() {
    const quest = this.current
    if (!quest) return false
    return quest.objectives.every((o) => this.progressOf(o) >= o.target)
  }

  /** Advance past the completed quest and reset its counters. */
  claimCurrent(): Quest | null {
    if (!this.isCurrentComplete()) return null
    const quest = this.current!
    this.chainIndex++
    // Absolute objectives (plots, coins, level) are re-pushed next frame, so
    // only the accumulating counters need clearing.
    const { plots, coins, level } = this.counters
    this.counters = emptyCounters()
    this.counters.plots = plots
    this.counters.coins = coins
    this.counters.level = level
    this.emit()
    return quest
  }

  private syncDailies() {
    for (const daily of this.dailies) {
      if (daily.claimed) continue
      daily.progress = Math.min(daily.objective.target, this.progressOf(daily.objective, this.dailyCounters))
    }
  }

  /** Dailies that are finished but not yet paid out. */
  claimableDailies() {
    this.syncDailies()
    return this.dailies.filter((d) => !d.claimed && d.progress >= d.objective.target)
  }

  claimDaily(id: string): DailyChallenge | null {
    const daily = this.dailies.find((d) => d.id === id)
    if (!daily || daily.claimed || daily.progress < daily.objective.target) return null
    daily.claimed = true
    this.emit()
    return daily
  }

  ABSOLUTE = ABSOLUTE

  /** Restart the chain for a new run. */
  reset() {
    this.chainIndex = 0
    this.counters = emptyCounters()
    this.dailyCounters = emptyCounters()
    this.dailies = []
    this.dailyDay = -1
    this.emit()
  }

  serialize() {
    return {
      chainIndex: this.chainIndex,
      counters: this.counters,
      dailyCounters: this.dailyCounters,
      dailies: this.dailies,
      dailyDay: this.dailyDay,
    }
  }

  deserialize(d: ReturnType<Quests['serialize']> | undefined) {
    if (!d) return
    this.chainIndex = d.chainIndex ?? 0
    this.counters = { ...emptyCounters(), ...d.counters }
    this.dailyCounters = { ...emptyCounters(), ...d.dailyCounters }
    this.dailies = d.dailies ?? []
    this.dailyDay = d.dailyDay ?? -1
    this.emit()
  }
}
