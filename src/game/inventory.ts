import { CROPS, CROP_BY_ID, type CropDef } from './crops'
import { MATERIAL_BY_ID } from './materials'
import { produceKey, produceLabel, pricePerKg, type RarityId } from './mutations'

/** Hotbar capacity. The bag manages which seeds occupy these slots. */
/*
 * Seven, not eight.
 *
 * The row has to share the bottom of the screen with the tool dock on the right
 * and the controls card on the left, and at eight the last slot ran under the
 * dock on a normally-proportioned desktop window. Reducing the capacity rather
 * than hiding the eighth slot in CSS keeps the bag's "n/7 equipped" honest — a
 * slot the player is told they have and cannot see is worse than one fewer.
 */
export const HOTBAR_SLOTS = 7

/**
 * Barn capacity, and what it costs to raise it.
 *
 * Produce used to accumulate without limit, which quietly removed every
 * decision from the sell half of the game: there was never a reason to sell
 * *now* rather than later, so the shop was a formality and coins were never
 * scarce enough for a price to mean anything. A cap makes the barn a resource —
 * you sell because you need the room, and you upgrade because you would rather
 * not have to.
 *
 * It is also the game's only sink that scales into the late game. Level rewards
 * hand out 40,000 coins while the most expensive decor is 9,000, so a player
 * past level 15 has nothing to want. The last two tiers here are priced to be
 * goals rather than purchases.
 *
 * Index is the storage level; index 0 is what a new farm starts with.
 */
export const STORAGE_TIERS: { cap: number; cost: number }[] = [
  { cap: 60, cost: 0 },
  { cap: 120, cost: 1200 },
  { cap: 220, cost: 6000 },
  { cap: 380, cost: 25000 },
  { cap: 600, cost: 90000 },
  { cap: 900, cost: 300000 },
  { cap: 1400, cost: 900000 },
]

export const MAX_STORAGE_LEVEL = STORAGE_TIERS.length - 1

/** One stack of identical produce — same crop, same rarity, same mutations. */
export interface ProduceStack {
  key: string
  cropId: string
  emoji: string
  rarity: RarityId
  mutations: string[]
  /** Pre-rendered display name, e.g. "✨💧 Gold Wet Melon". */
  label: string
  /** Coins per kg, rarity and mutations already applied. */
  pricePerKg: number
  /** Total kg held in this stack. Value = pricePerKg * totalWeight. */
  totalWeight: number
  count: number
}

/** Coins this whole stack is worth. */
export function stackValue(stack: ProduceStack) {
  const value = stack.pricePerKg * stack.totalWeight
  // A malformed stack must never poison the wallet: one NaN reaching `coins`
  // turns it into NaN permanently, and the autosave then writes that to disk.
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
}

/**
 * Rebuild a produce stack loaded from disk.
 *
 * Saves are player data with an indefinite lifetime, and this game's stack
 * shape has already changed once (`unitValue` became `pricePerKg` plus
 * `totalWeight`). Trusting whatever JSON was on disk let an old stack through
 * with both new fields undefined, which produced NaN on the first sale and
 * corrupted the player's coins irrecoverably.
 *
 * So derive the value fields from the crop table rather than the save: the
 * crop id, rarity and mutations are the durable facts, and everything else is
 * recomputable from them.
 */
function reviveStack(raw: Partial<ProduceStack> & { unitValue?: number }): ProduceStack | null {
  const def = CROP_BY_ID.get(raw.cropId ?? '')
  if (!def) return null

  const count = Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count!)) : 0
  if (count <= 0) return null

  const rarity = (raw.rarity ?? 'common') as RarityId
  const mutations = Array.isArray(raw.mutations) ? raw.mutations : []

  // Pre-weight saves stored no kg at all — assume average fruit for the count.
  const totalWeight = Number.isFinite(raw.totalWeight) && raw.totalWeight! > 0
    ? raw.totalWeight!
    : def.baseWeight * count

  return {
    key: produceKey(def.id, rarity, mutations),
    cropId: def.id,
    emoji: def.emoji,
    rarity,
    mutations: [...mutations].sort(),
    label: produceLabel(def, rarity, mutations),
    pricePerKg: pricePerKg(def, rarity, mutations),
    totalWeight,
    count,
  }
}

/**
 * Player wallet + bags. Everything mutating goes through here so the HUD can
 * subscribe once and never poll.
 */
export class Inventory {
  coins = 60
  /** cropId -> seed packets held. */
  readonly seeds = new Map<string, number>()
  /**
   * Harvested produce, stacked by exact variant. A Gold Shocked Pumpkin is
   * worth 900x a plain one, so produce cannot be pooled by crop id — the key
   * encodes crop, rarity and the mutation set.
   */
  readonly produce = new Map<string, ProduceStack>()
  /** materialId -> raw materials from clearing land. */
  readonly materials = new Map<string, number>()
  /** sprinklerTierId -> unplaced sprinklers in the shed. */
  readonly sprinklers = new Map<string, number>()

  /** Index into CROPS for the currently selected seed (hotbar slot). */
  selected = 0

  /**
   * Crop ids equipped to the hotbar, in slot order. Capacity HOTBAR_SLOTS.
   *
   * The hotbar shows what the player *chose to carry*, not the whole catalogue
   * — with eighteen species the full list is a wall, and the bag exists for
   * browsing. Newly acquired seed types self-equip while there is room, so a
   * new player never has to learn the bag before their first plant.
   */
  readonly equipped: string[] = ['turnip']

  private readonly listeners = new Set<() => void>()

  constructor() {
    // A few starter turnip seeds so the first action is planting, not shopping.
    this.seeds.set('turnip', 5)
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  seedCount(id: string) {
    return this.seeds.get(id) ?? 0
  }

  /** Units held of a crop, across every rarity and mutation combination. */
  produceCount(cropId: string) {
    let n = 0
    for (const stack of this.produce.values()) {
      if (stack.cropId === cropId) n += stack.count
    }
    return n
  }

  /** Every distinct produce stack, richest first. */
  produceStacks() {
    return [...this.produce.values()].sort((a, b) => stackValue(b) - stackValue(a))
  }

  get totalProduceValue() {
    let total = 0
    for (const stack of this.produce.values()) total += stackValue(stack)
    return total
  }

  // --- barn ---------------------------------------------------------------

  /** How many upgrades have been bought. Indexes STORAGE_TIERS. */
  storageLevel = 0

  /** Units of produce held, across every crop, rarity and mutation. */
  get stored() {
    let n = 0
    for (const stack of this.produce.values()) n += stack.count
    return n
  }

  get storageCap() {
    return STORAGE_TIERS[Math.min(this.storageLevel, MAX_STORAGE_LEVEL)].cap
  }

  /** Room for this many more units. Never negative, even if a save overfilled. */
  get storageSpace() {
    return Math.max(0, this.storageCap - this.stored)
  }

  get storageFull() {
    return this.storageSpace <= 0
  }

  /** The next upgrade, or null at the last tier. */
  get nextStorageTier() {
    const next = STORAGE_TIERS[this.storageLevel + 1]
    return next ? { level: this.storageLevel + 1, ...next } : null
  }

  upgradeStorage() {
    const next = this.nextStorageTier
    if (!next || !this.spend(next.cost)) return false
    this.storageLevel = next.level
    this.emit()
    return true
  }

  get selectedCrop() {
    return CROPS[this.selected]
  }

  /**
   * Select a seed — but never an empty packet.
   *
   * Every route into the hotbar comes through here: the number keys, a click on
   * a slot, the plot panel's chips, and the shop after a purchase. An empty
   * selection is a hand that cannot plant, so every click on the field after it
   * is a dead click, and the player has to work out for themselves that the slot
   * they picked ran out three harvests ago. Asking for one lands on whatever
   * they *do* have instead, which is the thing they were going to do next
   * anyway.
   *
   * Falling back rather than refusing outright matters: refusing leaves the
   * selection on the seed they just ran out of, which is equally dead.
   */
  select(index: number) {
    if (index < 0 || index >= CROPS.length) return
    if (this.seedCount(CROPS[index].id) <= 0) {
      this.selectAnyOwned()
      return
    }
    this.setSelected(index)
  }

  /** The raw move, for callers that have already checked the packet is not empty. */
  private setSelected(index: number) {
    this.selected = index
    this.emit()
  }

  /** Cycle to the next seed the player actually owns. */
  selectNextOwned(dir = 1) {
    for (let i = 1; i <= CROPS.length; i++) {
      const idx = (this.selected + dir * i + CROPS.length * 2) % CROPS.length
      if (this.seedCount(CROPS[idx].id) > 0) {
        this.setSelected(idx)
        return
      }
    }
  }

  /** Grant seeds outright, e.g. from a quest or level reward. */
  giveSeed(id: string, qty: number) {
    // First seeds of a new type walk straight onto the hotbar if it has room.
    if (!this.equipped.includes(id) && this.equipped.length < HOTBAR_SLOTS) {
      this.equipped.push(id)
    }
    this.seeds.set(id, this.seedCount(id) + qty)
    this.emit()
  }

  /**
   * Hop to another equipped seed the player still owns.
   *
   * Called after the last packet of the current seed is spent: an empty hand is
   * a dead click, and making the player notice-then-fix that every time they
   * finish a stack is friction with no decision in it. Prefers the hotbar
   * loadout (that is what the number keys address), then anything owned.
   */
  private selectAnyOwned() {
    for (const id of this.equipped) {
      if (this.seedCount(id) <= 0) continue
      const idx = CROPS.findIndex((c) => c.id === id)
      if (idx >= 0) {
        this.setSelected(idx)
        return
      }
    }
    for (let i = 0; i < CROPS.length; i++) {
      if (this.seedCount(CROPS[i].id) > 0) {
        this.setSelected(i)
        return
      }
    }
    // Nothing owned at all. The selection stays where it is — there is no better
    // slot to move to, and the hotbar already shows every count at zero.
  }

  takeSeed(id: string) {
    const n = this.seedCount(id)
    if (n <= 0) return false
    this.seeds.set(id, n - 1)
    // Spending the last one moves the selection somewhere useful, so the very
    // next click still plants something instead of doing nothing.
    if (n - 1 === 0 && CROPS[this.selected]?.id === id) this.selectAnyOwned()
    this.emit()
    return true
  }

  /**
   * Store harvested produce. Returns how many units actually fitted in the barn.
   *
   * Clamped rather than refused outright: a harvest that yields four melons into
   * two spaces stores two, and the caller reports the shortfall. Silently
   * dropping the rest would be worse — and so would letting the barn overflow,
   * since the cap is the whole point.
   */
  addProduce(
    def: CropDef,
    amount: number,
    rarity: RarityId = 'common',
    mutations: string[] = [],
    weightKg = def.baseWeight * amount,
  ) {
    const stored = Math.min(amount, this.storageSpace)
    if (stored <= 0) return 0
    // Weight is per-unit-averaged so a partial store is worth its own share.
    if (stored < amount) weightKg *= stored / amount
    amount = stored

    // Stacks pool by variant and carry total weight rather than splitting on
    // every distinct kg value, which would shatter the sell list into hundreds
    // of one-item rows.
    const key = produceKey(def.id, rarity, mutations)
    const existing = this.produce.get(key)
    if (existing) {
      existing.count += amount
      existing.totalWeight += weightKg
    } else {
      this.produce.set(key, {
        key,
        cropId: def.id,
        emoji: def.emoji,
        rarity,
        mutations: [...mutations].sort(),
        label: produceLabel(def, rarity, mutations),
        pricePerKg: pricePerKg(def, rarity, mutations),
        totalWeight: weightKg,
        count: amount,
      })
    }
    this.emit()
    return stored
  }

  /**
   * Seed purchases made this session.
   *
   * Not saved: its only consumer is the tutorial, which compares it against a
   * baseline taken when its step began, so what matters is that it moves — not
   * what it is. Persisting it would mean a returning player's old purchases
   * satisfying a step they have not done yet.
   */
  purchases = 0

  buySeed(id: string, qty = 1) {
    const def = CROP_BY_ID.get(id)
    if (!def) return false
    const cost = def.seedCost * qty
    if (this.coins < cost) return false
    this.coins -= cost
    this.seeds.set(id, this.seedCount(id) + qty)
    this.purchases++
    this.emit()
    return true
  }

  /** Sell from one exact stack. Returns coins earned. */
  sellProduce(key: string, qty = 1) {
    const stack = this.produce.get(key)
    if (!stack) return 0
    const n = Math.min(stack.count, qty)
    if (n <= 0) return 0

    // Sell an average portion of the stack's weight, so selling half a stack
    // is worth half its value regardless of which fruit went in first.
    const share = stack.totalWeight * (n / stack.count)
    const earned = Math.max(1, Math.round(stack.pricePerKg * share))
    stack.count -= n
    stack.totalWeight -= share
    if (stack.count <= 0) this.produce.delete(key)
    this.coins += earned
    this.emit()
    return earned
  }

  /**
   * Consume one unit of a crop without selling it. Returns false if none held.
   *
   * Feeding a wild animal is the first thing in the game that spends produce on
   * something other than coins, so it needs its own exit from the inventory —
   * `sellProduce` pays out, and paying the player for feeding an animal would be
   * exactly backwards.
   *
   * The *cheapest* stack goes first. Stacks are keyed by rarity and mutation, so
   * a player holding one gold-rarity carrot and six plain ones would otherwise
   * risk feeding the valuable one to a chicken, which is the kind of silent loss
   * that makes people stop using a feature.
   */
  takeProduce(cropId: string) {
    let cheapest: { key: string; stack: ProduceStack } | null = null
    for (const [key, stack] of this.produce) {
      if (stack.cropId !== cropId || stack.count <= 0) continue
      if (!cheapest || stack.pricePerKg < cheapest.stack.pricePerKg) cheapest = { key, stack }
    }
    if (!cheapest) return false

    const { key, stack } = cheapest
    stack.totalWeight -= stack.totalWeight / stack.count
    stack.count -= 1
    if (stack.count <= 0) this.produce.delete(key)
    this.emit()
    return true
  }

  /** Deduct coins. Returns false and changes nothing if the player is short. */
  spend(amount: number) {
    if (this.coins < amount) return false
    this.coins -= amount
    this.emit()
    return true
  }

  /** One-off tools the player owns permanently. */
  readonly tools = new Set<string>()

  hasTool(id: string) {
    return this.tools.has(id)
  }

  buyTool(id: string, price: number) {
    if (this.tools.has(id) || !this.spend(price)) return false
    this.tools.add(id)
    this.emit()
    return true
  }

  sprinklerCount(id: string) {
    return this.sprinklers.get(id) ?? 0
  }

  buySprinkler(id: string, price: number) {
    if (!this.spend(price)) return false
    this.sprinklers.set(id, this.sprinklerCount(id) + 1)
    this.emit()
    return true
  }

  takeSprinkler(id: string) {
    const n = this.sprinklerCount(id)
    if (n <= 0) return false
    this.sprinklers.set(id, n - 1)
    this.emit()
    return true
  }

  giveSprinkler(id: string, qty = 1) {
    this.sprinklers.set(id, this.sprinklerCount(id) + qty)
    this.emit()
  }

  materialCount(id: string) {
    return this.materials.get(id) ?? 0
  }

  addMaterial(id: string, amount: number) {
    this.materials.set(id, this.materialCount(id) + amount)
    this.emit()
  }

  sellMaterial(id: string, qty = 1) {
    const def = MATERIAL_BY_ID.get(id)
    if (!def) return 0
    const have = this.materialCount(id)
    const n = Math.min(have, qty)
    if (n <= 0) return 0
    this.materials.set(id, have - n)
    const earned = def.sellPrice * n
    this.coins += earned
    this.emit()
    return earned
  }

  sellAll() {
    let total = 0
    for (const stack of [...this.produce.values()]) {
      total += this.sellProduce(stack.key, stack.count)
    }
    for (const [id, n] of [...this.materials]) {
      if (n > 0) total += this.sellMaterial(id, n)
    }
    return total
  }

  /**
   * Wipe for a new run after retirement. Tools are kept deliberately — they
   * are quality-of-life the player already paid for, and making them re-buy a
   * Harvest Scythe every prestige would make retiring feel like a punishment.
   */
  reset(startCoins: number) {
    this.coins = startCoins
    this.seeds.clear()
    this.seeds.set('turnip', 5)
    this.produce.clear()
    this.materials.clear()
    this.sprinklers.clear()
    this.selected = 0
    this.emit()
  }

  /** Equip a seed to the hotbar. False when the bar is full. */
  equip(id: string) {
    if (this.equipped.includes(id)) return true
    if (this.equipped.length >= HOTBAR_SLOTS) return false
    this.equipped.push(id)
    this.emit()
    return true
  }

  unequip(id: string) {
    const at = this.equipped.indexOf(id)
    if (at === -1) return
    this.equipped.splice(at, 1)
    this.emit()
  }

  serialize() {
    return {
      coins: this.coins,
      seeds: [...this.seeds],
      equipped: [...this.equipped],
      produce: [...this.produce.values()],
      materials: [...this.materials],
      sprinklers: [...this.sprinklers],
      tools: [...this.tools],
      selected: this.selected,
      storageLevel: this.storageLevel,
    }
  }

  deserialize(d: ReturnType<Inventory['serialize']>) {
    if (!d) return
    // A corrupted save must not be able to load a NaN wallet back in.
    this.coins = Number.isFinite(d.coins) ? d.coins : this.coins
    this.seeds.clear()
    for (const [k, v] of d.seeds ?? []) this.seeds.set(k, v)
    // Restore the loadout; saves from before the bag existed self-heal by
    // equipping the first few owned seed types instead.
    this.equipped.length = 0
    const savedEq = (d as { equipped?: string[] }).equipped
    if (Array.isArray(savedEq) && savedEq.length > 0) {
      for (const id of savedEq.slice(0, HOTBAR_SLOTS)) this.equipped.push(id)
    } else {
      for (const [id, n] of this.seeds) {
        if (n > 0 && this.equipped.length < HOTBAR_SLOTS) this.equipped.push(id)
      }
      if (this.equipped.length === 0) this.equipped.push('turnip')
    }
    this.produce.clear()
    for (const raw of d.produce ?? []) {
      const stack = reviveStack(raw)
      if (stack) this.produce.set(stack.key, stack)
    }
    this.materials.clear()
    for (const [k, v] of d.materials ?? []) this.materials.set(k, v)
    this.sprinklers.clear()
    for (const [k, v] of d.sprinklers ?? []) this.sprinklers.set(k, v)
    this.tools.clear()
    for (const id of d.tools ?? []) this.tools.add(id)
    this.selected = d.selected ?? 0
    // Saves from before the barn existed load at level 0. Those farms can be
    // holding more than the starting cap, which is why every capacity check is
    // written against `storageSpace` clamping at zero rather than a subtraction:
    // an over-full barn stops accepting produce, it does not go negative.
    const level = (d as { storageLevel?: number }).storageLevel
    this.storageLevel = Number.isFinite(level) ? Math.max(0, Math.min(MAX_STORAGE_LEVEL, level!)) : 0
    this.emit()
  }
}
