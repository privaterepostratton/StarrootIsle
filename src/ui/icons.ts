/**
 * Township-style painted icons for HUD / shop rows.
 *
 * Icons live at `ui/icons/<id>.png`. Anything without a file falls back to the
 * emoji already stored on the game data, so new content still shows something.
 */

import { MUTATION_BY_ID, RARITY_BY_ID, type RarityId } from '../game/mutations'
import { asset } from '../core/assets'

const KNOWN = new Set([
  // crops
  'turnip', 'carrot', 'potato', 'strawberry', 'tomato', 'corn', 'blueberry',
  'pumpkin', 'pepper', 'melon', 'grape', 'sunflower', 'apple', 'dragonfruit',
  'coconut', 'cactus', 'starfruit', 'moonbloom',
  // materials
  'wood', 'stone', 'fiber', 'honey',
  // livestock + products
  'chicken', 'sheep', 'cow', 'pig', 'egg', 'wool', 'milk', 'truffle',
  // tools / sprinklers
  'harvester', 'basic', 'quality', 'deluxe',
  // placeables
  'path', 'flowerbed', 'bench', 'lamp', 'scarecrow', 'hive',
  // topbar / status
  'day', 'sun', 'moon', 'sunset',
  'spring', 'summer', 'autumn', 'winter',
  'clear', 'cloudy', 'rain', 'storm', 'fog', 'meteor', 'bloodmoon', 'disco',
  // chrome
  'locked',
  // FTUE step icons
  'ftue-welcome', 'ftue-plant', 'ftue-water', 'ftue-stall', 'ftue-buy',
  // nav rail / panel headers
  'settings', 'journal', 'valley', 'pets', 'almanac', 'legacy', 'shop', 'barn', 'bag', 'cart', 'truck',
  // pet eggs
  'egg-common', 'egg-rare', 'egg-legendary',
  // plot / tool actions
  'water', 'bolt', 'harvest', 'shovel', 'decor',
  // level-up rewards
  'sprout', 'plot', 'luck',
  // rarities
  'gold', 'silver', 'rainbow',
  // mutations — disco mutation file is disco-mut.png (weather owns disco.png)
  'wet', 'shocked', 'chilled', 'moonlit', 'dawnlit', 'bloom', 'frozen',
  'sundried', 'windswept', 'drenched', 'verdant', 'starstruck', 'pollinated',
  'meteoric', 'bloodlit', 'disco-mut',
])

/** Coin chip asset lives one folder up from the per-id icons. */
export function coinIconHtml(className = 'ico-img') {
  return `<img class="${className}" src="${asset('ui/coin.png')}" alt="" draggable="false">`
}

/** Clock face for the time-of-day chip. */
export function clockIconId(hour: number): 'moon' | 'sunset' | 'sun' {
  if (hour < 5.5 || hour > 19.5) return 'moon'
  if (hour < 8 || hour > 17) return 'sunset'
  return 'sun'
}

/** Every icon id that has a file. Used by the boot-time image preload. */
export function allIconIds(): readonly string[] {
  return [...KNOWN]
}

export function hasIcon(id: string) {
  return KNOWN.has(id)
}

export function iconSrc(id: string) {
  return asset(`ui/icons/${id}.png`)
}

/** Inline HTML for a content icon, with emoji fallback. */
export function iconHtml(id: string, emoji: string, className = 'ico-img') {
  if (!hasIcon(id)) return emoji
  return `<img class="${className}" src="${iconSrc(id)}" alt="" draggable="false">`
}

/** Mutation glyph — `disco` maps to disco-mut.png so weather keeps disco.png. */
export function mutationIconHtml(id: string, emoji: string, className = 'mut-ico') {
  const file = id === 'disco' ? 'disco-mut' : id
  if (!KNOWN.has(file)) return emoji
  return `<img class="${className}" src="${iconSrc(file)}" alt="" draggable="false">`
}

/**
 * Rarity + mutation glyph row for produce lists.
 * Common rarity contributes nothing; unknown ids fall back to emoji.
 */
export function produceAffixHtml(
  rarity: RarityId,
  mutations: Iterable<string>,
  className = 'mut-ico',
) {
  const parts: string[] = []
  const r = RARITY_BY_ID.get(rarity)
  if (r && r.id !== 'common') {
    parts.push(iconHtml(r.id, r.emoji, className))
  }
  for (const id of mutations) {
    const m = MUTATION_BY_ID.get(id)
    if (!m) continue
    parts.push(mutationIconHtml(m.id, m.emoji, className))
  }
  return parts.join('')
}

/** Text label without leading emoji — pair with produceAffixHtml. */
export function produceWords(rarity: RarityId, mutations: Iterable<string>, cropName: string) {
  const r = RARITY_BY_ID.get(rarity)
  const muts = [...mutations].map((id) => MUTATION_BY_ID.get(id)).filter(Boolean)
  return [r?.id === 'common' ? '' : r?.name, ...muts.map((m) => m!.name), cropName]
    .filter(Boolean)
    .join(' ')
}
