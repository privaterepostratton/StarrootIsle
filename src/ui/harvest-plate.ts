import type { CropDef } from '../game/crops'
import { MUTATION_BY_ID, RARITY_BY_ID, type RarityId } from '../game/mutations'
import { coinIconHtml, iconHtml } from './icons'
import { formatCoins } from './format'

/**
 * The card a special harvest throws up.
 *
 * `produceLabel` returns one string — every emoji run together, then every
 * word, then the crop — which is correct for a toast and wrong the moment it
 * is a plate over the field. A five-mutation blueberry came out as a wall of
 * glyphs followed by a sentence that wrapped across three lines, and the two
 * numbers the player actually wants (what is it, what is it worth) were buried
 * in the middle of it.
 *
 * Three rows instead, in the order the eye wants them:
 *
 *   the mutations, as chips — a count you can take in without reading;
 *   the name, with the rarity word given its own colour and weight;
 *   the money, on its own line, which is the reason the popup exists.
 *
 * Two plates also became one. The value and the label used to be separate
 * popups stacked on top of each other, which meant the biggest finds — the
 * ones with the longest names — pushed their own price off the top of the
 * cluster.
 */
export function harvestPlateHtml(
  def: CropDef,
  rarity: RarityId,
  mutations: readonly string[],
  value: number,
  /** Set when this pick also broke the crop's weight record. */
  recordKg: number | null = null,
) {
  const r = RARITY_BY_ID.get(rarity)
  const muts = mutations.map((id) => MUTATION_BY_ID.get(id)).filter(Boolean)

  const chips = muts
    .map((m) => `<span class="hp-chip" title="${m!.name}">${iconHtml(chipIcon(m!.id), m!.emoji, 'hp-chip-ico')}</span>`)
    .join('')

  // The rarity is a word, not another chip: it is the one adjective that
  // changes the colour of the whole plate, so it leads the name.
  const rarityWord =
    r && r.id !== 'common' ? `<span class="hp-rarity">${r.emoji} ${r.name}</span> ` : ''
  /*
   * Past two mutations the words are dropped and the chips carry them alone.
   *
   * "Rainbow Sundried Frozen Disco Windswept Pollinated Blueberry" is a
   * legitimate name and an unreadable one — it wraps to three lines on a plate
   * that is on screen for two seconds, and pushes the price down with it. One
   * or two adjectives is a name; five is a list, and a list is what the row of
   * icons above is for. The full name is still spelled out in the bag and the
   * almanac, where there is time to read it.
   */
  const mutWords = muts.length <= 2 ? muts.map((m) => m!.name).join(' ') : ''

  return (
    `<div class="hp">` +
    (chips ? `<div class="hp-chips">${chips}</div>` : '') +
    `<div class="hp-name">${rarityWord}${mutWords ? `<span class="hp-muts">${mutWords}</span> ` : ''}` +
    `<span class="hp-crop">${def.name}</span></div>` +
    (recordKg !== null ? `<div class="hp-record">⚖️ ${recordKg.toFixed(2)}kg — heaviest yet</div>` : '') +
    `<div class="hp-value">${coinIconHtml('hp-coin')}${formatCoins(value)}</div>` +
    `</div>`
  )
}

/**
 * The disco mutation's icon file is `disco-mut.png` — `disco.png` belongs to
 * the weather. Everything else is filed under its own id.
 */
function chipIcon(id: string) {
  return id === 'disco' ? 'disco-mut' : id
}
