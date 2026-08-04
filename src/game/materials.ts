/**
 * Materials recovered from clearing land. They exist to give the expansion
 * grind a payout beyond the plot itself — every tree you fell is also seed
 * money, so early clearing bootstraps the first real crop.
 */

export interface MaterialDef {
  id: string
  name: string
  emoji: string
  sellPrice: number
}

export const MATERIALS: MaterialDef[] = [
  { id: 'wood', name: 'Wood', emoji: '🪵', sellPrice: 9 },
  { id: 'stone', name: 'Stone', emoji: '🪨', sellPrice: 12 },
  { id: 'fiber', name: 'Fiber', emoji: '🌾', sellPrice: 4 },
  // Honey is not cleared from land — it comes from hives, but it sells through
  // the same materials path so it needs to live in the same table.
  { id: 'honey', name: 'Honey', emoji: '🍯', sellPrice: 320 },
]

export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]))

/** Kinds of obstruction that can sit on an unclaimed farm tile. */
export type DebrisKind = 'tree' | 'stump' | 'rock' | 'weeds'

export interface DebrisDef {
  kind: DebrisKind
  name: string
  /** Hits required to clear it. */
  hp: number
  /** Which tool the farmer swings. */
  tool: 'axe' | 'pick' | 'hoe'
  /** Material dropped, and how much. */
  drop: { id: string; amount: number }
  /** Collider radius while it stands. */
  radius: number
}

export const DEBRIS: Record<DebrisKind, DebrisDef> = {
  tree: { kind: 'tree', name: 'Tree', hp: 4, tool: 'axe', drop: { id: 'wood', amount: 3 }, radius: 0.55 },
  stump: { kind: 'stump', name: 'Stump', hp: 2, tool: 'axe', drop: { id: 'wood', amount: 2 }, radius: 0.42 },
  rock: { kind: 'rock', name: 'Boulder', hp: 3, tool: 'pick', drop: { id: 'stone', amount: 3 }, radius: 0.45 },
  weeds: { kind: 'weeds', name: 'Weeds', hp: 1, tool: 'hoe', drop: { id: 'fiber', amount: 2 }, radius: 0 },
}
