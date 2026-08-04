import { describe, it, expect } from 'vitest'
import { Inventory, stackValue, STORAGE_TIERS } from '../inventory'
import { CROPS, CROP_BY_ID } from '../crops'

/**
 * Inventory and save-restore.
 *
 * The legacy-stack cases are the important ones. A save written before produce
 * gained weight stored `unitValue` and no `pricePerKg`/`totalWeight`; restoring
 * it verbatim produced NaN on the first sale, which propagated into `coins` and
 * was then written to disk by the autosave. Silent, permanent coin loss.
 *
 * Anything reaching `coins` must therefore be finite no matter how mangled the
 * save file is.
 */

const melon = CROP_BY_ID.get('melon')!
const turnip = CROP_BY_ID.get('turnip')!

const indexOf = (id: string) => CROPS.findIndex((c) => c.id === id)

describe('seed selection', () => {
  it('refuses an empty packet and lands on one the player owns', () => {
    const inv = new Inventory()
    inv.giveSeed('carrot', 3)
    // A fresh farm starts with turnips, so both of these are stocked.
    inv.select(indexOf('carrot'))
    expect(inv.selectedCrop.id).toBe('carrot')

    // Melon is owned by nobody here: asking for it must not leave an empty hand.
    inv.select(indexOf('melon'))
    expect(inv.seedCount(inv.selectedCrop.id)).toBeGreaterThan(0)
    expect(inv.selectedCrop.id).not.toBe('melon')
  })

  it('hops off a seed as its last packet is spent', () => {
    const inv = new Inventory()
    // The bag starts empty now — the opening turnips are crates on the beach —
    // so the seed to hop *to* has to be part of the fixture rather than assumed.
    inv.giveSeed('turnip', 3)
    inv.giveSeed('carrot', 1)
    inv.select(indexOf('carrot'))
    expect(inv.takeSeed('carrot')).toBe(true)
    expect(inv.selectedCrop.id).not.toBe('carrot')
    expect(inv.seedCount(inv.selectedCrop.id)).toBeGreaterThan(0)
  })

  it('leaves the selection alone when nothing at all is owned', () => {
    const inv = new Inventory()
    inv.seeds.clear()
    const before = inv.selected
    inv.select(indexOf('melon'))
    expect(inv.selected).toBe(before)
  })
})

describe('barn capacity', () => {
  it('stores only what fits and reports the shortfall', () => {
    const inv = new Inventory()
    const cap = STORAGE_TIERS[0].cap
    expect(inv.addProduce(turnip, cap - 2, 'common', [])).toBe(cap - 2)
    // Five offered into two spaces: two stored, and the caller is told so.
    expect(inv.addProduce(melon, 5, 'common', [])).toBe(2)
    expect(inv.stored).toBe(cap)
    expect(inv.storageFull).toBe(true)
    expect(inv.addProduce(turnip, 1, 'common', [])).toBe(0)
  })

  it('splits the weight of a partial store so value is not inflated', () => {
    const inv = new Inventory()
    inv.addProduce(turnip, STORAGE_TIERS[0].cap - 1, 'common', [])
    // Four melons at 10kg each offered, one space left: 10kg, not 40.
    expect(inv.addProduce(melon, 4, 'common', [], 40)).toBe(1)
    const stack = inv.produceStacks().find((s) => s.cropId === 'melon')!
    expect(stack.count).toBe(1)
    expect(stack.totalWeight).toBeCloseTo(10, 5)
  })

  it('upgrading raises the cap and charges for it', () => {
    const inv = new Inventory()
    const tier = STORAGE_TIERS[1]
    inv.coins = tier.cost - 1
    expect(inv.upgradeStorage()).toBe(false)
    inv.coins = tier.cost
    expect(inv.upgradeStorage()).toBe(true)
    expect(inv.coins).toBe(0)
    expect(inv.storageCap).toBe(tier.cap)
  })

  it('an over-full barn from an older save reports no space, never negative', () => {
    const inv = new Inventory()
    inv.addProduce(turnip, 40, 'common', [])
    const saved = inv.serialize()
    // Hand-edit the save the way a pre-barn one would look: plenty stored, no level.
    saved.produce[0].count = 500
    delete (saved as { storageLevel?: number }).storageLevel

    const loaded = new Inventory()
    loaded.deserialize(saved)
    expect(loaded.storageLevel).toBe(0)
    expect(loaded.storageSpace).toBe(0)
    expect(loaded.addProduce(turnip, 1, 'common', [])).toBe(0)
  })
})

describe('produce stacks', () => {
  it('pools identical variants and keeps total weight', () => {
    const inv = new Inventory()
    inv.addProduce(turnip, 2, 'common', [], 0.7)
    inv.addProduce(turnip, 3, 'common', [], 1.05)

    expect(inv.produce.size).toBe(1)
    const stack = inv.produceStacks()[0]
    expect(stack.count).toBe(5)
    expect(stack.totalWeight).toBeCloseTo(1.75, 5)
  })

  it('keeps different rarities and mutation sets apart', () => {
    const inv = new Inventory()
    inv.addProduce(turnip, 1, 'common', [])
    inv.addProduce(turnip, 1, 'gold', [])
    inv.addProduce(turnip, 1, 'gold', ['wet'])
    // Mutation order must not create a distinct stack.
    inv.addProduce(turnip, 1, 'gold', ['wet'])

    expect(inv.produce.size).toBe(3)
  })

  it('values a stack by weight, not by unit count', () => {
    const inv = new Inventory()
    // One melon that happens to weigh 10kg against a 6.5kg median.
    inv.addProduce(melon, 1, 'common', [], 10)
    const stack = inv.produceStacks()[0]

    const perKg = melon.sellPrice / melon.baseWeight
    expect(stackValue(stack)).toBe(Math.round(perKg * 10))
    // Heavier than average therefore beats the listed price.
    expect(stackValue(stack)).toBeGreaterThan(melon.sellPrice)
  })

  it('prices an average-weight fruit at exactly its listed price', () => {
    const inv = new Inventory()
    inv.addProduce(melon, 1, 'common', [], melon.baseWeight)
    expect(stackValue(inv.produceStacks()[0])).toBe(melon.sellPrice)
  })

  it('selling part of a stack takes a proportional share of the weight', () => {
    const inv = new Inventory()
    inv.coins = 0
    inv.addProduce(melon, 4, 'common', [], 20)

    const earned = inv.sellProduce(inv.produceStacks()[0].key, 2)
    const left = inv.produceStacks()[0]

    expect(left.count).toBe(2)
    expect(left.totalWeight).toBeCloseTo(10, 5)
    // Half the units means half the weight, so half the money.
    expect(earned).toBe(Math.round((melon.sellPrice / melon.baseWeight) * 10))
    expect(inv.coins).toBe(earned)
  })

  it('selling the whole stack removes it', () => {
    const inv = new Inventory()
    inv.addProduce(melon, 2, 'common', [], 8)
    inv.sellProduce(inv.produceStacks()[0].key, 2)
    expect(inv.produce.size).toBe(0)
  })
})

describe('save restore hardening', () => {
  /** Shape of a stack as written by the pre-weight version of the game. */
  const legacyStack = {
    key: 'melon|gold|wet',
    cropId: 'melon',
    emoji: '🍉',
    rarity: 'gold',
    mutations: ['wet'],
    label: '✨💧 Gold Wet Melon',
    unitValue: 6150,
    count: 3,
  }

  function restore(produce: unknown[], coins: number = 100) {
    const inv = new Inventory()
    inv.deserialize({
      coins,
      seeds: [],
      produce,
      materials: [],
      sprinklers: [],
      tools: [],
      selected: 0,
    } as never)
    return inv
  }

  it('revives a pre-weight stack into something sellable', () => {
    const inv = restore([legacyStack])
    const stack = inv.produceStacks()[0]

    expect(stack).toBeDefined()
    expect(Number.isFinite(stack.pricePerKg)).toBe(true)
    expect(Number.isFinite(stack.totalWeight)).toBe(true)
    // No weight was stored, so it falls back to average fruit for the count.
    expect(stack.totalWeight).toBeCloseTo(melon.baseWeight * 3, 5)
    expect(Number.isFinite(stackValue(stack))).toBe(true)
  })

  it('never lets a malformed stack poison the wallet', () => {
    const inv = restore([legacyStack], 500)
    const before = inv.coins
    const earned = inv.sellProduce('melon|gold|wet', 3)

    expect(Number.isFinite(earned)).toBe(true)
    expect(earned).toBeGreaterThan(0)
    expect(Number.isFinite(inv.coins)).toBe(true)
    expect(inv.coins).toBe(before + earned)
  })

  it('rejects a NaN wallet from a corrupted save', () => {
    const inv = restore([], Number.NaN)
    expect(Number.isFinite(inv.coins)).toBe(true)
  })

  it('drops junk entries instead of loading them', () => {
    const inv = restore([
      { cropId: 'not-a-real-crop', count: 5 },
      { cropId: 'turnip', count: 0 },
      { cropId: 'turnip' },
      {},
    ])
    expect(inv.produce.size).toBe(0)
  })

  it('repairs a stack whose weight is NaN', () => {
    const inv = restore([
      { cropId: 'apple', rarity: 'gold', mutations: ['wet'], count: 2, totalWeight: Number.NaN },
    ])
    const stack = inv.produceStacks()[0]
    expect(stack).toBeDefined()
    expect(Number.isFinite(stack.totalWeight)).toBe(true)
    expect(stack.totalWeight).toBeGreaterThan(0)
  })

  it('round-trips a normal save without changing anything', () => {
    const inv = new Inventory()
    inv.coins = 1234
    inv.addProduce(melon, 2, 'gold', ['wet'], 13)
    inv.giveSeed('carrot', 7)
    inv.buyTool('harvester', 0)

    const restored = new Inventory()
    restored.deserialize(JSON.parse(JSON.stringify(inv.serialize())))

    expect(restored.coins).toBe(1234)
    expect(restored.seedCount('carrot')).toBe(7)
    expect(restored.hasTool('harvester')).toBe(true)

    const a = inv.produceStacks()[0]
    const b = restored.produceStacks()[0]
    expect(b.key).toBe(a.key)
    expect(b.count).toBe(a.count)
    expect(b.totalWeight).toBeCloseTo(a.totalWeight, 5)
    expect(stackValue(b)).toBe(stackValue(a))
  })
})

describe('spending', () => {
  it('refuses to spend more than is held and changes nothing', () => {
    const inv = new Inventory()
    inv.coins = 50
    expect(inv.spend(51)).toBe(false)
    expect(inv.coins).toBe(50)
  })

  it('buying a tool twice does not charge twice', () => {
    const inv = new Inventory()
    inv.coins = 1000
    expect(inv.buyTool('harvester', 400)).toBe(true)
    expect(inv.coins).toBe(600)
    expect(inv.buyTool('harvester', 400)).toBe(false)
    expect(inv.coins).toBe(600)
  })
})
