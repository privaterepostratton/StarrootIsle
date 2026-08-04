import type { CropDef } from './crops'
import type { WeatherType } from './weather'

/**
 * Rarity and mutations — the payout lottery that makes checking on the farm
 * worthwhile.
 *
 * Two independent systems multiply together:
 *   Rarity  is rolled once when the seed goes in the ground and never changes.
 *   Mutations accumulate while the crop is in the soil, granted by the
 *           conditions it happens to live through — rain, storms, moonlight.
 *
 * Because mutations depend on *when* a crop is growing rather than on any
 * player input, they reward planting before a storm and leaving crops out
 * overnight, which is what turns the weather system from decoration into a
 * thing you plan around.
 */

export type RarityId = 'common' | 'silver' | 'gold' | 'rainbow'

export interface RarityDef {
  id: RarityId
  name: string
  emoji: string
  multiplier: number
  /** Chance of rolling this or better, checked rarest-first. */
  chance: number
  /** Tint applied to the crop model. */
  color: number | null
}

/** Ordered rarest-first: rolling walks this list and takes the first hit. */
export const RARITIES: RarityDef[] = [
  { id: 'rainbow', name: 'Rainbow', emoji: '🌈', multiplier: 50, chance: 0.004, color: 0xff7ae0 },
  { id: 'gold', name: 'Gold', emoji: '✨', multiplier: 15, chance: 0.022, color: 0xf5c518 },
  { id: 'silver', name: 'Silver', emoji: '⚪', multiplier: 4, chance: 0.075, color: 0xd8dee6 },
  { id: 'common', name: 'Common', emoji: '', multiplier: 1, chance: 1, color: null },
]

export const RARITY_BY_ID = new Map(RARITIES.map((r) => [r.id, r]))

export interface MutationDef {
  id: string
  name: string
  emoji: string
  multiplier: number
  /** Chance per roll tick while its condition holds. */
  chance: number
  /** Mutations this one replaces when it lands. */
  replaces?: string[]
  /** Does the current world state allow this mutation right now? */
  condition(ctx: MutationContext): boolean
}

export interface MutationContext {
  weather: WeatherType
  /** Hour of the in-game day, 0-24. */
  hour: number
  /** Is the tile currently watered? */
  watered: boolean
  /** Is a sprinkler covering this tile? */
  sprinklered: boolean
  /** Is a beehive within range of this plot? */
  pollinated: boolean
}

export const MUTATIONS: MutationDef[] = [
  {
    id: 'wet',
    name: 'Wet',
    emoji: '💧',
    multiplier: 2,
    chance: 0.34,
    condition: (c) => c.weather === 'rain' || c.weather === 'storm',
  },
  {
    id: 'shocked',
    name: 'Shocked',
    emoji: '⚡',
    multiplier: 60,
    chance: 0.012,
    // Supersedes Wet: a lightning strike is a strictly better outcome and
    // stacking both reads as a bug.
    replaces: ['wet'],
    condition: (c) => c.weather === 'storm',
  },
  {
    id: 'chilled',
    name: 'Chilled',
    emoji: '❄️',
    multiplier: 3,
    chance: 0.16,
    condition: (c) => c.weather === 'fog' && (c.hour < 7 || c.hour > 19),
  },
  {
    id: 'moonlit',
    name: 'Moonlit',
    emoji: '🌙',
    multiplier: 2.5,
    chance: 0.1,
    condition: (c) => c.hour >= 21 || c.hour < 4,
  },
  {
    id: 'dawnlit',
    name: 'Dawnlit',
    emoji: '🌅',
    multiplier: 4,
    chance: 0.08,
    // A narrow window, so catching it takes deliberate timing.
    condition: (c) => c.hour >= 5 && c.hour < 6.5 && c.weather === 'clear',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    emoji: '🌸',
    multiplier: 5,
    chance: 0.05,
    condition: (c) => c.weather === 'clear' && c.watered && c.sprinklered,
  },

  {
    id: 'frozen',
    name: 'Frozen',
    emoji: '🧊',
    multiplier: 12,
    chance: 0.04,
    // Strictly better than Chilled, and only reachable by leaving a crop out
    // through a genuinely cold night.
    replaces: ['chilled', 'wet'],
    condition: (c) => c.weather === 'fog' && (c.hour < 5 || c.hour > 22),
  },
  {
    id: 'sundried',
    name: 'Sundried',
    emoji: '🔆',
    multiplier: 3.5,
    chance: 0.09,
    // The reward for *not* watering — the only mutation that wants dry soil,
    // which gives the player a reason to sometimes leave a plot alone.
    condition: (c) => c.weather === 'clear' && !c.watered && c.hour > 11 && c.hour < 16,
  },
  {
    id: 'windswept',
    name: 'Windswept',
    emoji: '🍃',
    multiplier: 2.2,
    chance: 0.14,
    condition: (c) => c.weather === 'cloudy',
  },
  {
    id: 'drenched',
    name: 'Drenched',
    emoji: '🌊',
    multiplier: 8,
    chance: 0.06,
    replaces: ['wet'],
    condition: (c) => c.weather === 'storm' && c.watered,
  },
  {
    id: 'verdant',
    name: 'Verdant',
    emoji: '🌿',
    multiplier: 6,
    chance: 0.045,
    replaces: ['windswept'],
    condition: (c) => c.sprinklered && c.watered && (c.weather === 'rain' || c.weather === 'cloudy'),
  },
  {
    id: 'starstruck',
    name: 'Starstruck',
    emoji: '✨',
    multiplier: 20,
    chance: 0.05,
    // Clear midnight sky. Narrow enough to feel earned, common enough to see.
    condition: (c) => c.weather === 'clear' && (c.hour >= 23 || c.hour < 2),
  },

  {
    id: 'pollinated',
    name: 'Pollinated',
    emoji: '🐝',
    multiplier: 7,
    chance: 0.11,
    // The only mutation the player can guarantee by building something rather
    // than by waiting for the right sky, which is what makes a hive worth its
    // price. Beats Bloom, so a hive upgrades a sprinklered plot.
    replaces: ['bloom'],
    condition: (c) => c.pollinated,
  },

  // --- event-only mutations ------------------------------------------------
  // These can only be caught during a global event, which is what makes an
  // event worth dropping everything for. The odds are high *because* the
  // window is short — a meteor shower is a couple of minutes, not a state you
  // can farm indefinitely.
  {
    id: 'meteoric',
    name: 'Meteoric',
    emoji: '☄️',
    multiplier: 90,
    chance: 0.18,
    replaces: ['wet', 'chilled'],
    condition: (c) => c.weather === 'meteor',
  },
  {
    id: 'bloodlit',
    name: 'Bloodlit',
    emoji: '🌑',
    multiplier: 45,
    chance: 0.22,
    replaces: ['moonlit'],
    condition: (c) => c.weather === 'bloodmoon',
  },
  {
    id: 'disco',
    name: 'Disco',
    emoji: '🪩',
    multiplier: 150,
    chance: 0.1,
    replaces: ['wet', 'moonlit', 'chilled'],
    condition: (c) => c.weather === 'disco',
  },
]

export const MUTATION_BY_ID = new Map(MUTATIONS.map((m) => [m.id, m]))

/** Is `id` outranked by something already held? */
function isSuppressed(id: string, held: Set<string>) {
  for (const heldId of held) {
    if (MUTATION_BY_ID.get(heldId)?.replaces?.includes(id)) return true
  }
  return false
}

/** Roll a rarity for a freshly planted seed. `luck` scales the odds of the
 *  better tiers — sprinklers and player level feed into it. */
export function rollRarity(luck = 1): RarityId {
  for (const rarity of RARITIES) {
    if (rarity.id === 'common') break
    if (Math.random() < rarity.chance * luck) return rarity.id
  }
  return 'common'
}

/**
 * Attempt to add one mutation given current conditions. Returns the mutation
 * that landed, or null. Called on a slow tick, not per frame.
 */
export function rollMutation(held: Set<string>, ctx: MutationContext, luck = 1): MutationDef | null {
  for (const mutation of MUTATIONS) {
    if (held.has(mutation.id)) continue
    // A mutation that was superseded must stay gone. Without this check the
    // roll simply re-adds it on the next tick and both end up held, which is
    // exactly the stacking the `replaces` rule exists to prevent.
    if (isSuppressed(mutation.id, held)) continue
    if (!mutation.condition(ctx)) continue
    if (Math.random() >= mutation.chance * luck) continue

    if (mutation.replaces) {
      for (const id of mutation.replaces) held.delete(id)
    }
    held.add(mutation.id)
    return mutation
  }
  return null
}

/** Combined value multiplier from rarity and every mutation held. */
export function valueMultiplier(rarity: RarityId, mutations: Iterable<string>) {
  let mult = RARITY_BY_ID.get(rarity)?.multiplier ?? 1
  for (const id of mutations) {
    mult *= MUTATION_BY_ID.get(id)?.multiplier ?? 1
  }
  return mult
}

/**
 * Roll the weight of one fruit, in kg.
 *
 * Approximately normal via the sum of three uniforms, which gives a believable
 * bell around the crop's median instead of the flat distribution a single
 * random() would produce. The tails matter: a 2.1x monster melon should be
 * memorable and rare, not something you see every third harvest.
 */
export function rollWeight(def: CropDef, weightBonus = 0) {
  const bell = (Math.random() + Math.random() + Math.random()) / 3
  // Maps the 0..1 bell onto 0.35x..1.65x. The midpoint must land on exactly
  // 1.0 — `bell` averages 0.5, so the offset and span are chosen so the mean
  // factor is 1. Get this wrong and every fruit is systematically over- or
  // under-weight, which silently rescales the entire economy, because
  // pricePerKg is derived from baseWeight.
  const factor = 0.35 + bell * 1.3
  return Math.max(0.01, def.baseWeight * factor * (1 + weightBonus))
}

/** Price per kg, after rarity and mutations. */
export function pricePerKg(def: CropDef, rarity: RarityId, mutations: Iterable<string>) {
  return (def.sellPrice / def.baseWeight) * valueMultiplier(rarity, mutations)
}

/**
 * Sale price of produce. Weight scales linearly, and because the per-kg rate
 * is derived from the crop's median weight, an average fruit is still worth
 * exactly its listed sellPrice.
 */
export function produceValue(
  def: CropDef,
  rarity: RarityId,
  mutations: Iterable<string>,
  weightKg = def.baseWeight,
) {
  return Math.max(1, Math.round(pricePerKg(def, rarity, mutations) * weightKg))
}

/** Stable key identifying an exact produce variant, for inventory stacking. */
export function produceKey(cropId: string, rarity: RarityId, mutations: Iterable<string>) {
  const sorted = [...mutations].sort()
  return `${cropId}|${rarity}|${sorted.join(',')}`
}

/** Human-readable name, e.g. "🌈 ⚡ Rainbow Shocked Pumpkin". */
export function produceLabel(def: CropDef, rarity: RarityId, mutations: Iterable<string>) {
  const r = RARITY_BY_ID.get(rarity)
  const muts = [...mutations].map((id) => MUTATION_BY_ID.get(id)).filter(Boolean) as MutationDef[]

  const emojis = [r?.emoji, ...muts.map((m) => m.emoji)].filter(Boolean).join('')
  const words = [r?.id === 'common' ? '' : r?.name, ...muts.map((m) => m.name), def.name]
    .filter(Boolean)
    .join(' ')
  return `${emojis} ${words}`.trim()
}
