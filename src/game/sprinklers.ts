/**
 * Sprinklers — the automation layer.
 *
 * A sprinkler occupies one plot and keeps every plot in its radius permanently
 * watered, which doubles growth speed for free and flips the `sprinklered`
 * flag that the Bloom mutation requires. They also add luck, so a well-plumbed
 * farm rolls better rarities than a hand-watered one.
 *
 * The occupied tile is the cost: covering a 5x5 block means giving up its
 * centre. That tension is what stops the best sprinkler from being an
 * unconditional buy.
 */

export type SprinklerTierId = 'basic' | 'quality' | 'deluxe'

export interface SprinklerTier {
  id: SprinklerTierId
  name: string
  emoji: string
  price: number
  /** Chebyshev radius in tiles. 1 = the 8 neighbours, 2 = a 5x5 block. */
  radius: number
  /** Added to the player's luck for crops inside the radius. */
  luck: number
  /** Level required to buy. */
  unlockLevel: number
  /** Body colour of the model. */
  color: number
  accent: number
}

export const SPRINKLER_TIERS: SprinklerTier[] = [
  {
    id: 'basic',
    name: 'Basic Sprinkler',
    emoji: '💦',
    price: 220,
    radius: 1,
    luck: 0.25,
    unlockLevel: 3,
    color: 0x9aa3ab,
    accent: 0x5cb8d8,
  },
  {
    id: 'quality',
    name: 'Quality Sprinkler',
    emoji: '🚿',
    price: 950,
    radius: 2,
    luck: 0.6,
    unlockLevel: 7,
    color: 0xd8b45c,
    accent: 0x4fd0e8,
  },
  {
    id: 'deluxe',
    name: 'Deluxe Sprinkler',
    emoji: '⛲',
    price: 4200,
    radius: 3,
    luck: 1.2,
    unlockLevel: 12,
    color: 0xe0e4e8,
    accent: 0x7ae0ff,
  },
]

export const SPRINKLER_BY_ID = new Map(SPRINKLER_TIERS.map((t) => [t.id, t]))

/**
 * One-off tools. Unlike sprinklers these are not placed and there is only ever
 * one — buying it flips a permanent flag on the inventory.
 */
export interface ToolDef {
  id: string
  name: string
  emoji: string
  price: number
  unlockLevel: number
  blurb: string
  /** Key that activates it, shown in the shop and the help text. */
  key: string
}

export const TOOLS: ToolDef[] = [
  {
    id: 'harvester',
    name: 'Harvest Scythe',
    emoji: '🌾',
    price: 1500,
    unlockLevel: 4,
    blurb: 'Reap every ripe plot on the farm at once.',
    key: 'H',
  },
]

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]))
