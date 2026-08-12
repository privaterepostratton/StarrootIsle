import { describe, it, expect } from 'vitest'
import { CROPS, OPENING_CROP_IDS, WATER_GROWTH_MULTIPLIER, growSecondsFor } from '../crops'
import { unlockLevelFor, MAX_LEVEL } from '../progression'
import { produceValue } from '../mutations'

/**
 * The purchasable catalogue — what the economy invariants below are actually
 * about. The opening's scripted crops (sun-tomato, mystery-sprout) are granted,
 * never bought: their prices are placeholders, so holding them to the profit
 * curve would be enforcing tuning that does not exist. They get their own
 * describe block instead, which checks the one thing that matters about them —
 * that they can never enter the economy at all.
 */
const ECONOMY_CROPS = CROPS.filter((c) => !OPENING_CROP_IDS.has(c.id))

/**
 * Economy invariants.
 *
 * These exist because the crop table has been broken twice, both times by
 * getting this one formula wrong.
 *
 * `sellPrice` is the value of ONE fruit of average weight. The engine divides
 * it by `baseWeight` to get a per-kg rate and multiplies back by actual weight,
 * so at average weight the weight terms cancel and a plant's lifetime revenue
 * is simply `sellPrice x yield x harvests`. Multiplying by `baseWeight` here as
 * well double-counts it and produces wildly wrong balance.
 */

/** Coins a plot returns over the plant's whole life, at average weight. */
function lifetimeRevenue(crop: (typeof CROPS)[number]) {
  return crop.sellPrice * crop.yield * crop.harvests
}

function lifetimeProfit(crop: (typeof CROPS)[number]) {
  return lifetimeRevenue(crop) - crop.seedCost
}

/** Seconds from planting to the last picking, played the normal way (watered). */
function cycleSeconds(crop: (typeof CROPS)[number]) {
  const grow = crop.growSeconds / WATER_GROWTH_MULTIPLIER
  const regrow = (crop.harvests - 1) * (crop.regrowSeconds / WATER_GROWTH_MULTIPLIER)
  return grow + regrow
}

function profitPerHour(crop: (typeof CROPS)[number]) {
  return lifetimeProfit(crop) / (cycleSeconds(crop) / 3600)
}

describe('crop economy', () => {
  it('every crop turns a profit', () => {
    for (const crop of ECONOMY_CROPS) {
      expect(lifetimeProfit(crop), `${crop.id} must be worth planting`).toBeGreaterThan(0)
    }
  })

  it('profit per hour rises monotonically with tier', () => {
    // CROPS is ordered cheapest-first and that order *is* the tier, so a later
    // crop earning less than an earlier one means the ladder is broken.
    for (let i = 1; i < ECONOMY_CROPS.length; i++) {
      const prev = ECONOMY_CROPS[i - 1]
      const cur = ECONOMY_CROPS[i]
      expect(
        profitPerHour(cur),
        `${cur.id} earns less per hour than ${prev.id}`,
      ).toBeGreaterThan(profitPerHour(prev))
    }
  })

  it('seed cost rises monotonically with tier', () => {
    for (let i = 1; i < ECONOMY_CROPS.length; i++) {
      expect(ECONOMY_CROPS[i].seedCost).toBeGreaterThan(ECONOMY_CROPS[i - 1].seedCost)
    }
  })

  it('a seed never costs more than one plant returns', () => {
    // Otherwise buying is strictly irrational, no matter how patient you are.
    for (const crop of ECONOMY_CROPS) {
      expect(lifetimeRevenue(crop), `${crop.id}`).toBeGreaterThan(crop.seedCost)
    }
  })

  it('unlock levels are unique, ordered, and reachable', () => {
    const levels = ECONOMY_CROPS.map((c) => c.unlockLevel)

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i], `${ECONOMY_CROPS[i].id} unlocks out of tier order`).toBeGreaterThanOrEqual(
        levels[i - 1],
      )
    }

    for (const crop of ECONOMY_CROPS) {
      expect(crop.unlockLevel, `${crop.id} unlocks past max level`).toBeLessThanOrEqual(MAX_LEVEL)
      expect(unlockLevelFor(crop.id)).toBe(crop.unlockLevel)
    }
  })

  it('at least one crop is available at level 1', () => {
    expect(CROPS.some((c) => c.unlockLevel <= 1)).toBe(true)
  })

  it('multi-harvest crops regrow faster than they first grew', () => {
    // Regrowing as slowly as the initial planting would make multi-harvest a
    // downgrade over replanting a fresh seed.
    for (const crop of CROPS) {
      if (crop.harvests <= 1) continue
      expect(crop.regrowSeconds, `${crop.id}`).toBeGreaterThan(0)
      expect(crop.regrowSeconds, `${crop.id}`).toBeLessThan(crop.growSeconds)
    }
  })

  it('single-harvest crops define no regrow time', () => {
    for (const crop of CROPS) {
      if (crop.harvests === 1) expect(crop.regrowSeconds, `${crop.id}`).toBe(0)
    }
  })

  it('has no duplicate ids', () => {
    expect(new Set(CROPS.map((c) => c.id)).size).toBe(CROPS.length)
  })

  it('agrees with the engine on what an average fruit is worth', () => {
    // The invariant the whole table depends on: one average-weight fruit sells
    // for exactly `sellPrice`. If produceValue and this file ever disagree, the
    // balance numbers above are meaningless.
    for (const crop of CROPS) {
      expect(produceValue(crop, 'common', [], crop.baseWeight), `${crop.id}`).toBe(crop.sellPrice)
    }
  })

  it('every crop returns at least 1.8x its seed cost', () => {
    for (const crop of ECONOMY_CROPS) {
      expect(lifetimeRevenue(crop) / crop.seedCost, `${crop.id}`).toBeGreaterThan(1.8)
    }
  })

  it('every crop has sane physical values', () => {
    for (const crop of ECONOMY_CROPS) {
      expect(crop.baseWeight, `${crop.id} weight`).toBeGreaterThan(0)
      expect(crop.yield, `${crop.id} yield`).toBeGreaterThanOrEqual(1)
      expect(crop.harvests, `${crop.id} harvests`).toBeGreaterThanOrEqual(1)
      expect(crop.growSeconds, `${crop.id} grow time`).toBeGreaterThan(0)
      expect(crop.xp, `${crop.id} xp`).toBeGreaterThan(0)
    }
  })
})

describe('opening crops', () => {
  /**
   * The Isle Opening's scripted species (docs/OPENING-CONTRACT.md §2.6) are
   * exempt from the economy curve above, so these are the invariants that
   * replace it: they exist, and nothing can ever buy them. Shop stock, trader
   * pools and request pools all filter on `unlockLevel <= playerLevel`, so an
   * unlock level past MAX_LEVEL is the mechanism that keeps them out.
   */
  const opening = CROPS.filter((c) => OPENING_CROP_IDS.has(c.id))

  it('both scripted crops exist in the catalogue', () => {
    expect(opening.map((c) => c.id).sort()).toEqual(['mystery-sprout', 'sun-tomato'])
  })

  it('can never be purchased or stocked', () => {
    for (const crop of opening) {
      expect(crop.seedCost, `${crop.id} must be free`).toBe(0)
      expect(crop.unlockLevel, `${crop.id} must be unreachable`).toBeGreaterThan(MAX_LEVEL)
    }
  })

  it('grants no XP — the opening grants zero XP by contract', () => {
    for (const crop of opening) {
      expect(crop.xp, `${crop.id}`).toBe(0)
    }
  })

  it('sun-tomato ripens in 90 real seconds', () => {
    // The spec's sundial target. growSeconds holds 30 because GROW_TIME_SCALE
    // is 3 — writing 90 in the table would make a 270-second crop.
    const sunTomato = CROPS.find((c) => c.id === 'sun-tomato')!
    expect(growSecondsFor(sunTomato)).toBe(90)
  })

  it('mystery-sprout can never ripen within a session', () => {
    const mystery = CROPS.find((c) => c.id === 'mystery-sprout')!
    // Hours of real time: emergence is scripted on the first return, never
    // reached by waiting.
    expect(growSecondsFor(mystery)).toBeGreaterThan(8 * 3600)
  })
})
