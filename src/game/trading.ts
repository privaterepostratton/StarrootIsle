import { CROPS, CROP_BY_ID, type CropDef } from './crops'
import { RARITIES, type RarityId } from './mutations'
import type { Inventory, ProduceStack } from './inventory'

/**
 * Neighbour trade offers.
 *
 * Friendship previously did nothing but pay out gifts on a timer, which made
 * the roster a leaderboard with a vending machine attached. Offers turn it
 * into a market: each neighbour wants specific produce and pays in things the
 * shop will not sell you.
 *
 * Offers are generated per in-game day and scaled to the player's level, so a
 * request is always something they could plausibly fill today rather than a
 * wish for a crop they have not unlocked.
 */

export interface TradeOffer {
  id: string
  neighbourId: string
  /** What they want. */
  wantCropId: string
  wantCount: number
  /** Minimum rarity accepted. `common` means anything. */
  wantRarity: RarityId
  /** What they pay. */
  coins: number
  seeds: { id: string; qty: number } | null
  /** Friendship gained on completion. */
  friendship: number
  fulfilled: boolean
}

const RARITY_RANK: Record<string, number> = { common: 0, silver: 1, gold: 2, rainbow: 3 }

/**
 * Anything that asks for produce: a trade offer, or a neighbour's request.
 *
 * Structural rather than tied to TradeOffer so requests.ts can reuse the
 * matching rules instead of shipping a second, subtly different copy of them.
 */
export interface ProduceWant {
  wantCropId: string
  wantRarity: RarityId
}

/** Does this stack satisfy a want's rarity floor? */
export function stackQualifies(stack: ProduceStack, offer: ProduceWant) {
  return (
    stack.cropId === offer.wantCropId &&
    (RARITY_RANK[stack.rarity] ?? 0) >= (RARITY_RANK[offer.wantRarity] ?? 0)
  )
}

/** How many qualifying units the player is holding. */
export function heldFor(inventory: Inventory, offer: ProduceWant) {
  let n = 0
  for (const stack of inventory.produce.values()) {
    if (stackQualifies(stack, offer)) n += stack.count
  }
  return n
}

/**
 * Generate one offer for a neighbour.
 *
 * `favourite` biases what they ask for so requests stay in character — Odette
 * asks for dragonfruit far more often than turnips.
 */
function makeOffer(
  neighbourId: string,
  favourite: string,
  playerLevel: number,
  friendship: number,
  day: number,
  index: number,
): TradeOffer {
  const affordable = CROPS.filter((c) => c.unlockLevel <= playerLevel)
  const pool = affordable.length ? affordable : [CROPS[0]]

  const favouriteDef = CROP_BY_ID.get(favourite)
  const useFavourite = favouriteDef && favouriteDef.unlockLevel <= playerLevel && Math.random() < 0.5
  const want = useFavourite ? favouriteDef! : pool[Math.floor(Math.random() * pool.length)]

  // Higher friendship unlocks rarity demands — and much better pay.
  const roll = Math.random()
  let wantRarity: RarityId = 'common'
  if (friendship >= 60 && roll < 0.25) wantRarity = 'gold'
  else if (friendship >= 30 && roll < 0.45) wantRarity = 'silver'

  const rarityMult = RARITIES.find((r) => r.id === wantRarity)?.multiplier ?? 1
  const wantCount = wantRarity === 'common' ? 3 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2)

  // Pay above market, scaled by how demanding the request is. Trading should
  // beat simply selling the same produce, or nobody would ever bother.
  const marketValue = want.sellPrice * wantCount * rarityMult
  const generosity = 1.4 + friendship / 100
  const coins = Math.round(marketValue * generosity)

  // Sometimes they throw in seeds of something a tier or two above what was
  // asked for — the real reason to trade rather than sell.
  const upgradeIndex = Math.min(CROPS.length - 1, CROPS.indexOf(want) + 2)
  const seeds =
    Math.random() < 0.45 ? { id: CROPS[upgradeIndex].id, qty: 1 + Math.floor(Math.random() * 3) } : null

  return {
    id: `${neighbourId}-${day}-${index}`,
    neighbourId,
    wantCropId: want.id,
    wantCount,
    wantRarity,
    coins,
    seeds,
    friendship: wantRarity === 'common' ? 4 : 9,
    fulfilled: false,
  }
}

export class Trading {
  /** neighbourId -> their current offer. */
  private offers = new Map<string, TradeOffer>()
  private generatedDay = -1

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  offerFor(neighbourId: string) {
    return this.offers.get(neighbourId) ?? null
  }

  get all() {
    return [...this.offers.values()]
  }

  get openCount() {
    return this.all.filter((o) => !o.fulfilled).length
  }

  /** Roll a fresh set of offers. Called on day rollover and first load. */
  refresh(
    day: number,
    playerLevel: number,
    neighbours: { id: string; favourite: string; friendship: number }[],
  ) {
    if (this.generatedDay === day) return
    this.generatedDay = day
    this.offers.clear()

    neighbours.forEach((n, i) => {
      this.offers.set(n.id, makeOffer(n.id, n.favourite, playerLevel, n.friendship, day, i))
    })
    this.emit()
  }

  /**
   * Hand over the produce and take the payment.
   *
   * Spends the *cheapest* qualifying stacks first, so filling a "3 turnips"
   * order never silently consumes a Rainbow one the player was saving.
   */
  fulfil(offer: TradeOffer, inventory: Inventory) {
    if (offer.fulfilled) return false
    if (heldFor(inventory, offer) < offer.wantCount) return false

    const candidates = [...inventory.produce.values()]
      .filter((s) => stackQualifies(s, offer))
      .sort((a, b) => a.pricePerKg - b.pricePerKg)

    let remaining = offer.wantCount
    for (const stack of candidates) {
      if (remaining <= 0) break
      const take = Math.min(stack.count, remaining)
      // Removed rather than sold: the coins come from the offer, not the shop.
      const share = stack.totalWeight * (take / stack.count)
      stack.count -= take
      stack.totalWeight -= share
      if (stack.count <= 0) inventory.produce.delete(stack.key)
      remaining -= take
    }

    inventory.coins += offer.coins
    if (offer.seeds) inventory.giveSeed(offer.seeds.id, offer.seeds.qty)

    offer.fulfilled = true
    this.emit()
    return true
  }

  /** Human-readable summary of what an offer wants. */
  describe(offer: TradeOffer) {
    const def = CROP_BY_ID.get(offer.wantCropId)
    const rarity = RARITIES.find((r) => r.id === offer.wantRarity)
    const prefix = offer.wantRarity === 'common' ? '' : `${rarity?.emoji ?? ''} ${rarity?.name} `
    return `${offer.wantCount}× ${prefix}${def?.name ?? offer.wantCropId}`
  }

  /** Clear offers so a retired farm starts with a fresh market. */
  reset() {
    this.offers.clear()
    this.generatedDay = -1
    this.emit()
  }

  serialize() {
    return { day: this.generatedDay, offers: [...this.offers.values()] }
  }

  deserialize(d: ReturnType<Trading['serialize']> | undefined) {
    if (!d) return
    this.generatedDay = Number.isFinite(d.day) ? d.day : -1
    this.offers.clear()
    for (const offer of d.offers ?? []) {
      if (offer && typeof offer.neighbourId === 'string') this.offers.set(offer.neighbourId, offer)
    }
    this.emit()
  }
}

export type { CropDef }
