import { CROPS, CROP_BY_ID } from './crops'

/**
 * Player level and XP.
 *
 * Levels gate seeds rather than just handing out numbers, so a level-up
 * changes what you can plant tomorrow instead of nudging a multiplier. Every
 * level also pays out, which keeps the mid-game from feeling like a plateau
 * between crop unlocks.
 */

export interface LevelReward {
  coins?: number
  /** Free plots granted immediately. */
  plots?: number
  seeds?: { id: string; qty: number }[]
  /** Multiplier on rarity and mutation rolls, cumulative across levels. */
  luck?: number
  note: string
}

/**
 * Index 0 is the reward for reaching level 2, and so on.
 *
 * Crop unlocks are *not* listed here — each crop declares its own
 * `unlockLevel`, and the level-up banner looks up what became available. That
 * keeps adding a crop to a single edit in one file.
 */
export const LEVEL_REWARDS: LevelReward[] = [
  { coins: 40, seeds: [{ id: 'carrot', qty: 3 }], note: 'New seeds in the shop' },
  { coins: 70, plots: 1, note: '+1 free plot' },
  { coins: 110, seeds: [{ id: 'strawberry', qty: 3 }], note: 'New seeds in the shop' },
  { coins: 170, luck: 0.12, note: 'Luckier harvests' },
  { coins: 240, plots: 2, note: '+2 free plots' },
  { coins: 340, seeds: [{ id: 'blueberry', qty: 3 }], note: 'New seeds in the shop' },
  { coins: 480, luck: 0.12, note: 'Luckier harvests' },
  { coins: 700, plots: 2, note: '+2 free plots' },
  { coins: 980, note: 'A tidy bonus' },
  { coins: 1400, luck: 0.15, note: 'Luckier harvests' },
  { coins: 2000, plots: 3, note: '+3 free plots' },
  { coins: 2900, note: 'A tidy bonus' },
  { coins: 4200, luck: 0.15, note: 'Luckier harvests' },
  { coins: 6000, plots: 3, note: '+3 free plots' },
  { coins: 9000, note: 'A tidy bonus' },
  { coins: 14000, luck: 0.2, note: 'Luckier harvests' },
  { coins: 22000, plots: 4, note: '+4 free plots' },
  { coins: 40000, luck: 0.25, note: 'Master farmer' },
]

export const MAX_LEVEL = LEVEL_REWARDS.length + 1

// --- feature gates -------------------------------------------------------

/**
 * Whole systems, not just seeds, arrive on the level ladder.
 *
 * The order is the early-game's teaching plan: each unlock lands roughly when
 * the previous one has become routine, so a new player is introduced to one
 * system at a time instead of nine buttons at once. The lock is also the
 * advertisement — a locked button labelled with its level is a goal; a missing
 * button is nothing.
 */
export interface FeatureUnlock {
  id: 'valley' | 'almanac' | 'sprinkler' | 'animals' | 'decor' | 'pets' | 'legacy'
  name: string
  emoji: string
  level: number
  blurb: string
}

export const FEATURE_UNLOCKS: FeatureUnlock[] = [
  { id: 'valley', name: 'The Valley', emoji: '🏘️', level: 3, blurb: 'Meet the neighbours' },
  { id: 'almanac', name: 'Almanac', emoji: '📖', level: 4, blurb: 'Track your discoveries' },
  { id: 'sprinkler', name: 'Sprinklers', emoji: '💦', level: 5, blurb: 'Automatic watering' },
  { id: 'animals', name: 'Animal Barn', emoji: '🐄', level: 6, blurb: 'Buy livestock' },
  { id: 'decor', name: 'Decor', emoji: '🪑', level: 7, blurb: 'Dress up your farm' },
  { id: 'pets', name: 'Pets', emoji: '🐾', level: 8, blurb: 'Hatch little companions' },
  { id: 'legacy', name: 'Legacy', emoji: '👑', level: 12, blurb: 'Retire, and grow faster forever' },
]

export const FEATURE_BY_ID = new Map(FEATURE_UNLOCKS.map((f) => [f.id, f]))

export function featureLevel(id: FeatureUnlock['id']) {
  return FEATURE_BY_ID.get(id)?.level ?? 1
}

export function featuresUnlockedAt(level: number) {
  return FEATURE_UNLOCKS.filter((f) => f.level === level)
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number) {
  return Math.round(50 * Math.pow(level, 1.55))
}

/**
 * Which level a crop becomes purchasable at.
 *
 * The crop owns this now rather than it being inferred from the reward table —
 * that inversion is what lets the roster grow without every new crop needing a
 * matching level-reward entry.
 */
export function unlockLevelFor(cropId: string) {
  return CROP_BY_ID.get(cropId)?.unlockLevel ?? 1
}

/** Crops that become available on reaching this level. */
export function cropsUnlockedAt(level: number) {
  return CROPS.filter((c) => c.unlockLevel === level)
}

export interface LevelUpResult {
  level: number
  reward: LevelReward
}

export class Progression {
  level = 1
  xp = 0
  /** Accumulated bonus to rarity and mutation rolls. 1.0 is the base rate. */
  luck = 1

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  get xpNeeded() {
    return xpToNext(this.level)
  }

  get progress() {
    return this.level >= MAX_LEVEL ? 1 : Math.min(1, this.xp / this.xpNeeded)
  }

  canPlant(cropId: string) {
    return this.level >= unlockLevelFor(cropId)
  }

  hasFeature(id: FeatureUnlock['id']) {
    return this.level >= featureLevel(id)
  }

  /**
   * Award XP. Returns every level gained, so a single huge harvest that
   * crosses two thresholds pays out both rewards rather than swallowing one.
   */
  addXp(amount: number): LevelUpResult[] {
    if (this.level >= MAX_LEVEL) return []

    this.xp += amount
    const gained: LevelUpResult[] = []

    while (this.level < MAX_LEVEL && this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded
      this.level++
      const reward = LEVEL_REWARDS[this.level - 2]
      if (reward?.luck) this.luck += reward.luck
      gained.push({ level: this.level, reward })
    }

    if (this.level >= MAX_LEVEL) this.xp = 0
    this.emit()
    return gained
  }

  /** Back to level 1 for a new run. Luck from levels is lost; prestige luck
   *  is held separately and survives. */
  reset() {
    this.level = 1
    this.xp = 0
    this.luck = 1
    this.emit()
  }

  serialize() {
    return { level: this.level, xp: this.xp, luck: this.luck }
  }

  deserialize(d: { level: number; xp: number; luck: number } | undefined) {
    if (!d) return
    this.level = d.level ?? 1
    this.xp = d.xp ?? 0
    this.luck = d.luck ?? 1
    this.emit()
  }
}
