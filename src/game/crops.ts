/**
 * Crop catalogue. Ordered cheapest-first — that order is the tier, and other
 * systems (shop stock odds, hotbar layout) read it as such.
 *
 * `growSeconds` is time to full ripeness while *unwatered*. Watering applies
 * WATER_GROWTH_MULTIPLIER, so a watered crop finishes in roughly half that.
 *
 * The economy is tuned around three knobs pulling against each other:
 *   - seedCost rises steeply, so a tier jump is a real commitment.
 *   - harvests rises with tier, so expensive seeds amortise over many pickings.
 *   - growSeconds rises, so the payoff is slower.
 * The number that actually matters is coins per plot per hour, not per harvest.
 *
 * `sellPrice` is what ONE fruit of average weight sells for. The engine works
 * in coins-per-kg internally (`sellPrice / baseWeight`) so that a heavier than
 * average fruit is worth proportionally more — but that means a plant's
 * lifetime revenue is `sellPrice x yield x harvests`, with baseWeight cancelling
 * out. Multiplying by baseWeight as well double-counts it, which has broken
 * this table once already.
 *
 * Prices were solved backwards from a target curve of profit-per-plot-per-hour
 * rising ~1.30x per tier, so they are not independently meaningful. Changing a
 * crop's yield, harvests or grow time WILL break its balance unless sellPrice
 * is re-derived alongside it. `economy.test.ts` enforces the invariants.
 */

export type CropForm = 'root' | 'bush' | 'stalk' | 'vine' | 'tree' | 'flower'

/**
 * Per-species fruit silhouette.
 *
 * `form` decides how the *plant* is massed — that is the shared language which
 * lets you read ripeness at a glance, and only six of them exist on purpose.
 * `fruit` is what tells two crops of the same form apart, and every species has
 * its own: five of these crops are bushes, and recolouring the same berry five
 * times is what made a mixed field look like a palette swatch rather than a
 * farm. Each kind is built by its own factory in assets/crops.ts.
 */
export type FruitKind =
  | 'globe' // turnip — squat pale root shoulder with a coloured band
  | 'taproot' // carrot — tapered cone, point down
  | 'tuber' // potato — three fused lumps
  | 'heart' // strawberry — seeded cone under a leafy calyx
  | 'ribbed' // tomato — squashed globe with a star calyx
  | 'cob' // corn — kernelled ear in a peeled husk, silk on top
  | 'cluster' // blueberry — tight knot of small berries with a pale bloom
  | 'gourd' // pumpkin — ridged dome and a curled stem
  | 'pod' // chilli — long curved pod hanging from the stem
  | 'striped' // melon — big globe banded in a darker tone
  | 'bunch' // grapes — tapering pyramid of berries
  | 'disc' // sunflower — petal ring around a seed disc
  | 'pome' // apple — globe with a stem and a single leaf
  | 'husk' // coconut — fibrous nut, flattened top and base
  | 'fig' // cactus fig — spined barrel with a bud on the crown
  | 'star' // starfruit — five radiating ridges
  | 'scaled' // dragonfruit — oval wrapped in upturned scales
  | 'bloom' // moonbloom — open petals around a glowing core

export interface CropDef {
  id: string
  name: string
  emoji: string
  form: CropForm
  /** Which fruit silhouette this species grows. */
  fruit: FruitKind
  seedCost: number
  sellPrice: number
  growSeconds: number
  /** Primary fruit colour and the foliage colour, both used by the model. */
  fruitColor: number
  leafColor: number
  /**
   * Secondary colour for the fruit's own detail — a calyx, stripes, seed specks,
   * a stem. Kept off `leafColor` so a detail can contrast with the plant's
   * foliage (melon stripes, a turnip's purple shoulder) rather than vanish
   * into it. Rarity retints `fruitColor` only, so this survives as the cue that
   * says which species a jackpot fruit came from.
   */
  accentColor: number
  /** How many fruit a single harvest yields. */
  yield: number
  /** Base XP per unit harvested, before rarity and mutation multipliers. */
  xp: number
  /**
   * How many times this plant can be picked before it is spent.
   *
   * Multi-harvest is what makes an expensive seed worth it: a Melon costs 32x
   * a Turnip but pays out five times without ever being replanted.
   */
  harvests: number
  /** Seconds to regrow between pickings. Shorter than the initial grow time. */
  regrowSeconds: number
  /** Median fruit weight in kg. Actual weight is rolled around this. */
  baseWeight: number
  /** Player level required before the shop will stock it. */
  unlockLevel: number
}

export const CROPS: CropDef[] = [
  {
    id: 'turnip', name: 'Turnip', emoji: '🥬', form: 'root', fruit: 'globe',
    seedCost: 5, sellPrice: 10, growSeconds: 24,
    fruitColor: 0xf7f2e4, leafColor: 0x6fc456, accentColor: 0xb46ad0,
    yield: 1, xp: 4, harvests: 1, regrowSeconds: 0, baseWeight: 0.35, unlockLevel: 1,
  },
  {
    id: 'carrot', name: 'Carrot', emoji: '🥕', form: 'root', fruit: 'taproot',
    seedCost: 14, sellPrice: 27, growSeconds: 48,
    fruitColor: 0xf28c28, leafColor: 0x4fa83d, accentColor: 0xd06c12,
    yield: 1, xp: 9, harvests: 1, regrowSeconds: 0, baseWeight: 0.5, unlockLevel: 2,
  },
  {
    id: 'potato', name: 'Potato', emoji: '🥔', form: 'root', fruit: 'tuber',
    seedCost: 26, sellPrice: 25, growSeconds: 66,
    fruitColor: 0xd6b47c, leafColor: 0x5fa83c, accentColor: 0x9a7846,
    yield: 2, xp: 14, harvests: 1, regrowSeconds: 0, baseWeight: 0.9, unlockLevel: 3,
  },
  {
    id: 'strawberry', name: 'Strawberry', emoji: '🍓', form: 'bush', fruit: 'heart',
    seedCost: 38, sellPrice: 14, growSeconds: 75,
    fruitColor: 0xe33d3d, leafColor: 0x3d8a2e, accentColor: 0xffe9a0,
    yield: 2, xp: 16, harvests: 4, regrowSeconds: 26, baseWeight: 0.18, unlockLevel: 4,
  },
  {
    id: 'tomato', name: 'Tomato', emoji: '🍅', form: 'bush', fruit: 'ribbed',
    seedCost: 62, sellPrice: 20, growSeconds: 96,
    fruitColor: 0xe0442f, leafColor: 0x4fa83d, accentColor: 0x3d8a2e,
    yield: 2, xp: 22, harvests: 5, regrowSeconds: 32, baseWeight: 0.3, unlockLevel: 5,
  },
  {
    id: 'corn', name: 'Corn', emoji: '🌽', form: 'stalk', fruit: 'cob',
    seedCost: 90, sellPrice: 84, growSeconds: 120,
    fruitColor: 0xf5cf4a, leafColor: 0x7ab83c, accentColor: 0x9ccf4a,
    yield: 1, xp: 28, harvests: 3, regrowSeconds: 45, baseWeight: 1.4, unlockLevel: 6,
  },
  {
    id: 'blueberry', name: 'Blueberry', emoji: '🫐', form: 'bush', fruit: 'cluster',
    seedCost: 130, sellPrice: 18, growSeconds: 140,
    fruitColor: 0x5a6ad0, leafColor: 0x3d8a2e, accentColor: 0xa8b4ee,
    yield: 4, xp: 34, harvests: 6, regrowSeconds: 34, baseWeight: 0.09, unlockLevel: 7,
  },
  {
    id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', form: 'vine', fruit: 'gourd',
    seedCost: 180, sellPrice: 250, growSeconds: 175,
    fruitColor: 0xe8791f, leafColor: 0x4fa83d, accentColor: 0x4a7a2a,
    yield: 1, xp: 46, harvests: 2, regrowSeconds: 70, baseWeight: 4.2, unlockLevel: 8,
  },
  {
    id: 'pepper', name: 'Chilli', emoji: '🌶️', form: 'bush', fruit: 'pod',
    seedCost: 240, sellPrice: 71, growSeconds: 190,
    fruitColor: 0xd8271f, leafColor: 0x3d8a2e, accentColor: 0x3d8a2e,
    yield: 3, xp: 55, harvests: 4, regrowSeconds: 56, baseWeight: 0.22, unlockLevel: 9,
  },
  {
    id: 'melon', name: 'Melon', emoji: '🍉', form: 'vine', fruit: 'striped',
    seedCost: 330, sellPrice: 160, growSeconds: 235,
    fruitColor: 0x6fc456, leafColor: 0x3d8a2e, accentColor: 0x2a6b28,
    yield: 2, xp: 70, harvests: 5, regrowSeconds: 80, baseWeight: 6.5, unlockLevel: 10,
  },
  {
    id: 'grape', name: 'Grapes', emoji: '🍇', form: 'vine', fruit: 'bunch',
    seedCost: 470, sellPrice: 85, growSeconds: 265,
    fruitColor: 0x8a4ad0, leafColor: 0x5fa83c, accentColor: 0x5fa83c,
    yield: 4, xp: 88, harvests: 7, regrowSeconds: 66, baseWeight: 0.55, unlockLevel: 11,
  },
  {
    id: 'sunflower', name: 'Sunflower', emoji: '🌻', form: 'stalk', fruit: 'disc',
    seedCost: 640, sellPrice: 890, growSeconds: 320,
    fruitColor: 0xf5c518, leafColor: 0x5fa83c, accentColor: 0x6b4a2a,
    yield: 1, xp: 110, harvests: 3, regrowSeconds: 110, baseWeight: 2.8, unlockLevel: 12,
  },
  {
    id: 'apple', name: 'Apple', emoji: '🍎', form: 'tree', fruit: 'pome',
    seedCost: 950, sellPrice: 250, growSeconds: 380,
    fruitColor: 0xe0342f, leafColor: 0x3d8a2e, accentColor: 0x6b4a33,
    yield: 3, xp: 140, harvests: 8, regrowSeconds: 92, baseWeight: 0.65, unlockLevel: 13,
  },
  {
    id: 'dragonfruit', name: 'Dragonfruit', emoji: '🐉', form: 'bush', fruit: 'scaled',
    seedCost: 1400, sellPrice: 710, growSeconds: 430,
    fruitColor: 0xe8459b, leafColor: 0x3d8a2e, accentColor: 0x5fc456,
    yield: 2, xp: 170, harvests: 6, regrowSeconds: 140, baseWeight: 1.9, unlockLevel: 14,
  },
  {
    id: 'coconut', name: 'Coconut', emoji: '🥥', form: 'tree', fruit: 'husk',
    seedCost: 2400, sellPrice: 1100, growSeconds: 520,
    fruitColor: 0x8a6042, leafColor: 0x4fa83d, accentColor: 0xb08a63,
    yield: 2, xp: 230, harvests: 6, regrowSeconds: 165, baseWeight: 1.5, unlockLevel: 15,
  },
  {
    id: 'cactus', name: 'Cactus Fig', emoji: '🌵', form: 'stalk', fruit: 'fig',
    seedCost: 4200, sellPrice: 3800, growSeconds: 620,
    fruitColor: 0xd0407a, leafColor: 0x3f8a5a, accentColor: 0xf2f0d8,
    yield: 1, xp: 320, harvests: 5, regrowSeconds: 190, baseWeight: 0.8, unlockLevel: 16,
  },
  {
    id: 'starfruit', name: 'Starfruit', emoji: '⭐', form: 'tree', fruit: 'star',
    seedCost: 9500, sellPrice: 2500, growSeconds: 760,
    fruitColor: 0xf5e04a, leafColor: 0x5fa83c, accentColor: 0xc9a832,
    yield: 2, xp: 480, harvests: 8, regrowSeconds: 210, baseWeight: 0.42, unlockLevel: 17,
  },
  {
    id: 'moonbloom', name: 'Moonbloom', emoji: '🌙', form: 'flower', fruit: 'bloom',
    seedCost: 24000, sellPrice: 8300, growSeconds: 900,
    fruitColor: 0xb8d8ff, leafColor: 0x4a5a8c, accentColor: 0xfff4c0,
    yield: 1, xp: 900, harvests: 9, regrowSeconds: 240, baseWeight: 0.3, unlockLevel: 18,
  },
]

export const CROP_BY_ID = new Map(CROPS.map((c) => [c.id, c]))

/**
 * Global multiplier on every grow and regrow time.
 *
 * The table above holds *relative* times. Slowing the game down belongs here
 * rather than in eighteen pairs of numbers, and applying it uniformly is what
 * keeps the balance intact: every crop's profit-per-hour divides by the same
 * factor, so the ~1.30x-per-tier curve and the ordering the economy tests
 * enforce are untouched. Editing individual `growSeconds` values is what breaks
 * that.
 *
 * Applied at the two places progress accumulates (Farm.update and the
 * neighbours' own tick) and in the shop's "ready in" estimate.
 */
export const GROW_TIME_SCALE = 3

/** Actual seconds to ripeness for a crop, scale included. */
export function growSecondsFor(def: CropDef) {
  return def.growSeconds * GROW_TIME_SCALE
}

/** Watered soil grows crops this much faster. */
export const WATER_GROWTH_MULTIPLIER = 2.0

/** Seconds before watered soil dries back out. */
export const WATER_DURATION = 45

/** Discrete visual stages a crop passes through. */
export const GROWTH_STAGES = 4

export function stageForProgress(progress: number) {
  if (progress >= 1) return GROWTH_STAGES - 1
  return Math.min(GROWTH_STAGES - 2, Math.floor(progress * (GROWTH_STAGES - 1)))
}
