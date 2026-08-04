import { describe, it, expect } from 'vitest'
import {
  MUTATIONS,
  MUTATION_BY_ID,
  RARITIES,
  RARITY_BY_ID,
  rollMutation,
  rollRarity,
  valueMultiplier,
  produceKey,
  produceLabel,
  pricePerKg,
  type MutationContext,
} from '../mutations'
import { CROP_BY_ID } from '../crops'

/**
 * Mutation rules.
 *
 * The stacking test guards a bug that shipped: `shocked` declares that it
 * replaces `wet`, but removing `wet` from the set only meant the next roll was
 * free to add it straight back, so crops ended up holding both. A superseded
 * mutation has to stay superseded.
 */

const turnip = CROP_BY_ID.get('turnip')!

const ctx = (over: Partial<MutationContext> = {}): MutationContext => ({
  weather: 'clear',
  hour: 12,
  watered: false,
  sprinklered: false,
  pollinated: false,
  ...over,
})

describe('mutation table', () => {
  it('has unique ids', () => {
    expect(new Set(MUTATIONS.map((m) => m.id)).size).toBe(MUTATIONS.length)
  })

  it('every mutation is worth having', () => {
    for (const m of MUTATIONS) {
      expect(m.multiplier, `${m.id}`).toBeGreaterThan(1)
      expect(m.chance, `${m.id}`).toBeGreaterThan(0)
      expect(m.chance, `${m.id}`).toBeLessThanOrEqual(1)
    }
  })

  it('only replaces mutations that exist', () => {
    for (const m of MUTATIONS) {
      for (const id of m.replaces ?? []) {
        expect(MUTATION_BY_ID.get(id), `${m.id} replaces unknown ${id}`).toBeDefined()
      }
    }
  })

  it('a replacement is always worth more than what it replaces', () => {
    // Otherwise "upgrading" would cost the player money.
    for (const m of MUTATIONS) {
      for (const id of m.replaces ?? []) {
        expect(m.multiplier, `${m.id} vs ${id}`).toBeGreaterThan(
          MUTATION_BY_ID.get(id)!.multiplier,
        )
      }
    }
  })

  it('nothing replaces itself', () => {
    for (const m of MUTATIONS) {
      expect(m.replaces ?? []).not.toContain(m.id)
    }
  })
})

describe('rollMutation', () => {
  it('never re-adds a mutation that was superseded', () => {
    // The exact shipped bug: shocked removes wet, then wet comes straight back.
    const held = new Set<string>()
    const stormNight = ctx({ weather: 'storm', hour: 22, watered: true })

    for (let i = 0; i < 4000; i++) rollMutation(held, stormNight, 50)

    if (held.has('shocked')) {
      expect(held.has('wet'), 'wet must not coexist with shocked').toBe(false)
    }
    for (const m of MUTATIONS) {
      for (const replaced of m.replaces ?? []) {
        if (held.has(m.id)) expect(held.has(replaced), `${m.id} + ${replaced}`).toBe(false)
      }
    }
  })

  it('only grants mutations whose condition currently holds', () => {
    const held = new Set<string>()
    // Bright, dry, clear noon: rain and night mutations must be impossible.
    for (let i = 0; i < 3000; i++) rollMutation(held, ctx({ hour: 12 }), 100)

    expect(held.has('wet')).toBe(false)
    expect(held.has('shocked')).toBe(false)
    expect(held.has('moonlit')).toBe(false)
  })

  it('never grants the same mutation twice', () => {
    const held = new Set<string>()
    for (let i = 0; i < 2000; i++) rollMutation(held, ctx({ weather: 'rain' }), 100)
    expect(held.size).toBe(new Set(held).size)
  })

  it('returns the mutation it granted, or null', () => {
    const held = new Set<string>()
    const granted = rollMutation(held, ctx({ weather: 'rain' }), 1000)
    if (granted) {
      expect(held.has(granted.id)).toBe(true)
    } else {
      expect(held.size).toBe(0)
    }
  })
})

describe('rarity', () => {
  it('is ordered rarest-first with rising multipliers', () => {
    for (let i = 1; i < RARITIES.length; i++) {
      expect(RARITIES[i].chance).toBeGreaterThan(RARITIES[i - 1].chance)
      expect(RARITIES[i].multiplier).toBeLessThan(RARITIES[i - 1].multiplier)
    }
  })

  it('common is the guaranteed fallback at multiplier 1', () => {
    const common = RARITY_BY_ID.get('common')!
    expect(common.multiplier).toBe(1)
    expect(common.chance).toBe(1)
  })

  it('always returns a known rarity', () => {
    for (let i = 0; i < 500; i++) {
      expect(RARITY_BY_ID.get(rollRarity(Math.random() * 3))).toBeDefined()
    }
  })

  it('higher luck cannot make rare drops less likely', () => {
    const rate = (luck: number) => {
      let hits = 0
      for (let i = 0; i < 20000; i++) if (rollRarity(luck) !== 'common') hits++
      return hits / 20000
    }
    // Generous margin: this is sampled, not exact.
    expect(rate(5)).toBeGreaterThan(rate(1))
  })
})

describe('value', () => {
  it('multiplies rarity and every mutation together', () => {
    const mult = valueMultiplier('gold', ['wet', 'moonlit'])
    const expected =
      RARITY_BY_ID.get('gold')!.multiplier *
      MUTATION_BY_ID.get('wet')!.multiplier *
      MUTATION_BY_ID.get('moonlit')!.multiplier
    expect(mult).toBeCloseTo(expected, 6)
  })

  it('is exactly 1 for a plain common crop', () => {
    expect(valueMultiplier('common', [])).toBe(1)
  })

  it('ignores unknown mutation ids rather than producing NaN', () => {
    expect(Number.isFinite(valueMultiplier('common', ['not-a-mutation']))).toBe(true)
  })

  it('price per kg scales with the multiplier', () => {
    const plain = pricePerKg(turnip, 'common', [])
    const fancy = pricePerKg(turnip, 'gold', ['wet'])
    expect(fancy).toBeCloseTo(plain * valueMultiplier('gold', ['wet']), 4)
  })
})

describe('produce identity', () => {
  it('keys ignore mutation ordering', () => {
    expect(produceKey('melon', 'gold', ['wet', 'moonlit'])).toBe(
      produceKey('melon', 'gold', ['moonlit', 'wet']),
    )
  })

  it('keys separate different rarities', () => {
    expect(produceKey('melon', 'gold', [])).not.toBe(produceKey('melon', 'common', []))
  })

  it('labels a plain crop with just its name', () => {
    expect(produceLabel(turnip, 'common', [])).toBe(turnip.name)
  })

  it('labels a rare mutated crop with both', () => {
    const label = produceLabel(turnip, 'gold', ['wet'])
    expect(label).toContain('Gold')
    expect(label).toContain('Wet')
    expect(label).toContain(turnip.name)
  })
})
