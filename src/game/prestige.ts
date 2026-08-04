import { MAX_LEVEL } from './progression'

/**
 * Prestige — retiring the farm.
 *
 * Level 19 and Moonbloom are the ceiling, after which the game has nothing
 * left to say. Retiring trades all of that progress for permanent multipliers
 * and a currency that coins cannot buy, so the next run is faster and reaches
 * further than the last.
 *
 * What survives a retirement is the interesting design question. The rule here
 * is: **knowledge and identity persist, resources do not.** You keep the
 * almanac, your pets and your settings; you lose coins, levels, plots, seeds
 * and everything planted. That makes retiring feel like a considered choice
 * rather than a menu you click for free numbers.
 */

/** Minimum level before retirement is offered at all. */
export const RETIRE_MIN_LEVEL = 12

export interface PrestigeUpgrade {
  id: string
  name: string
  emoji: string
  blurb: string
  /** Cost of the first rank; each rank costs `cost * (rank + 1)`. */
  cost: number
  maxRank: number
  /** Per-rank effect size. */
  step: number
  kind: 'luck' | 'growth' | 'value' | 'startCoins' | 'startPlots'
}

export const PRESTIGE_UPGRADES: PrestigeUpgrade[] = [
  {
    id: 'greenThumb', name: 'Green Thumb', emoji: '🌿',
    blurb: 'Everything grows faster, forever.',
    cost: 1, maxRank: 10, step: 0.08, kind: 'growth',
  },
  {
    id: 'fortune', name: "Farmer's Fortune", emoji: '🍀',
    blurb: 'Better odds on rarities and mutations.',
    cost: 1, maxRank: 10, step: 0.15, kind: 'luck',
  },
  {
    id: 'haggler', name: 'Haggler', emoji: '💰',
    blurb: 'Produce sells for more.',
    cost: 2, maxRank: 8, step: 0.1, kind: 'value',
  },
  {
    id: 'nestEgg', name: 'Nest Egg', emoji: '🥚',
    blurb: 'Start each new farm with more coins.',
    cost: 1, maxRank: 8, step: 500, kind: 'startCoins',
  },
  {
    id: 'inheritance', name: 'Inheritance', emoji: '📜',
    blurb: 'Start each new farm with extra plots.',
    cost: 2, maxRank: 6, step: 2, kind: 'startPlots',
  },
]

export const UPGRADE_BY_ID = new Map(PRESTIGE_UPGRADES.map((u) => [u.id, u]))

/**
 * Blossoms earned by retiring at a given level.
 *
 * Superlinear so that pushing one level further is always tempting, but capped
 * in practice by MAX_LEVEL. Retiring at the minimum yields 1; retiring at max
 * yields a meaningful handful.
 */
export function blossomsFor(level: number) {
  if (level < RETIRE_MIN_LEVEL) return 0
  const over = level - RETIRE_MIN_LEVEL
  return Math.max(1, Math.floor(1 + Math.pow(over, 1.35)))
}

export interface PrestigeBonuses {
  luck: number
  growth: number
  value: number
  startCoins: number
  startPlots: number
}

export const NO_PRESTIGE: PrestigeBonuses = {
  luck: 0, growth: 0, value: 0, startCoins: 0, startPlots: 0,
}

export class Prestige {
  /** Unspent currency. */
  blossoms = 0
  /** Lifetime retirements. */
  retirements = 0
  /** upgradeId -> rank purchased. */
  readonly ranks = new Map<string, number>()

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  rankOf(id: string) {
    return this.ranks.get(id) ?? 0
  }

  /** Cost of the next rank, or null if maxed. */
  costOf(upgrade: PrestigeUpgrade) {
    const rank = this.rankOf(upgrade.id)
    if (rank >= upgrade.maxRank) return null
    return upgrade.cost * (rank + 1)
  }

  canAfford(upgrade: PrestigeUpgrade) {
    const cost = this.costOf(upgrade)
    return cost !== null && this.blossoms >= cost
  }

  buy(id: string) {
    const upgrade = UPGRADE_BY_ID.get(id)
    if (!upgrade) return false
    const cost = this.costOf(upgrade)
    if (cost === null || this.blossoms < cost) return false

    this.blossoms -= cost
    this.ranks.set(id, this.rankOf(id) + 1)
    this.emit()
    return true
  }

  /** Aggregate effect of every purchased rank. */
  bonuses(): PrestigeBonuses {
    const total = { ...NO_PRESTIGE }
    for (const upgrade of PRESTIGE_UPGRADES) {
      const rank = this.rankOf(upgrade.id)
      if (rank > 0) total[upgrade.kind] += upgrade.step * rank
    }
    return total
  }

  canRetire(level: number) {
    return level >= RETIRE_MIN_LEVEL
  }

  /** Award blossoms for a retirement. The caller performs the actual reset. */
  retire(level: number) {
    const earned = blossomsFor(level)
    if (earned <= 0) return 0
    this.blossoms += earned
    this.retirements++
    this.emit()
    return earned
  }

  /** Preview text for the retire button. */
  previewFor(level: number) {
    return {
      earned: blossomsFor(level),
      atMax: level >= MAX_LEVEL,
      eligible: this.canRetire(level),
      needed: Math.max(0, RETIRE_MIN_LEVEL - level),
    }
  }

  serialize() {
    return { blossoms: this.blossoms, retirements: this.retirements, ranks: [...this.ranks] }
  }

  deserialize(d: ReturnType<Prestige['serialize']> | undefined) {
    if (!d) return
    this.blossoms = Number.isFinite(d.blossoms) ? d.blossoms : 0
    this.retirements = Number.isFinite(d.retirements) ? d.retirements : 0
    this.ranks.clear()
    for (const [id, rank] of d.ranks ?? []) {
      if (UPGRADE_BY_ID.has(id) && Number.isFinite(rank)) this.ranks.set(id, rank)
    }
    this.emit()
  }
}
