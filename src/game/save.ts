import type { Farm } from './farm'
import type { Inventory } from './inventory'
import type { DayCycle } from './daycycle'
import type { Weather } from './weather'
import type { Progression } from './progression'
import type { Quests } from './quests'
import type { Pasture } from './animals'
import type { Neighbourhood } from './neighbours'
import type { Pets } from './pets'
import type { Stock } from './stock'
import type { Discovery } from './discovery'
import type { Prestige } from './prestige'
import type { Trading } from './trading'
import type { Requests } from './requests'
import type { Placeables } from './placeables'
import { platform } from '../platform/platform'
import { clearPlotChoice } from './village'

const KEY = 'sprout-valley-save-v1'

/**
 * Bumped whenever the save shape changes. Older saves are migrated rather than
 * discarded — see load().
 */
export const SAVE_VERSION = 2

export interface SaveData {
  version: number
  savedAt: number
  farm: ReturnType<Farm['serialize']>
  inventory: ReturnType<Inventory['serialize']>
  day: ReturnType<DayCycle['serialize']>
  weather: ReturnType<Weather['serialize']>
  progression: ReturnType<Progression['serialize']>
  quests: ReturnType<Quests['serialize']>
  pasture: ReturnType<Pasture['serialize']>
  neighbours: ReturnType<Neighbourhood['serialize']>
  pets: ReturnType<Pets['serialize']>
  stock: ReturnType<Stock['serialize']>
  discovery: ReturnType<Discovery['serialize']>
  prestige: ReturnType<Prestige['serialize']>
  trading: ReturnType<Trading['serialize']>
  requests: ReturnType<Requests['serialize']>
  placeables: ReturnType<Placeables['serialize']>
}

function buildData(
  farm: Farm,
  inventory: Inventory,
  day: DayCycle,
  weather: Weather,
  progression: Progression,
  quests: Quests,
  pasture: Pasture,
  neighbours: Neighbourhood,
  pets: Pets,
  stock: Stock,
  discovery: Discovery,
  prestige: Prestige,
  trading: Trading,
  requests: Requests,
  placeables: Placeables,
): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    farm: farm.serialize(),
    inventory: inventory.serialize(),
    day: day.serialize(),
    weather: weather.serialize(),
    progression: progression.serialize(),
    quests: quests.serialize(),
    pasture: pasture.serialize(),
    neighbours: neighbours.serialize(),
    pets: pets.serialize(),
    stock: stock.serialize(),
    discovery: discovery.serialize(),
    prestige: prestige.serialize(),
    trading: trading.serialize(),
    requests: requests.serialize(),
    placeables: placeables.serialize(),
  }
}

function validate(data: SaveData): SaveData | null {
  const version = typeof data.version === 'number' ? data.version : 0
  if (version > SAVE_VERSION) {
    console.warn(
      `Save is from a newer version (${version} > ${SAVE_VERSION}) and was not loaded.`,
    )
    return null
  }
  return data
}

function readLocal(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return validate(JSON.parse(raw) as SaveData)
  } catch {
    return null
  }
}

export function save(
  farm: Farm,
  inventory: Inventory,
  day: DayCycle,
  weather: Weather,
  progression: Progression,
  quests: Quests,
  pasture: Pasture,
  neighbours: Neighbourhood,
  pets: Pets,
  stock: Stock,
  discovery: Discovery,
  prestige: Prestige,
  trading: Trading,
  requests: Requests,
  placeables: Placeables,
) {
  const data = buildData(
    farm,
    inventory,
    day,
    weather,
    progression,
    quests,
    pasture,
    neighbours,
    pets,
    stock,
    discovery,
    prestige,
    trading,
    requests,
    placeables,
  )
  /*
   * CrazyGames Data module must be the sole progress store on portal builds.
   * Dual-writing to window.localStorage fights guest→account sync (CG docs).
   * Standalone keeps localStorage only.
   */
  if (platform.usesCloudSave()) {
    platform.persistSave(KEY, data)
  } else {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // Private-browsing / quota. Losing a save is not worth killing the frame.
    }
  }
}

/**
 * Load and migrate.
 *
 * On CrazyGames / Playgama, the portal Data module is canonical. If it is empty
 * but a legacy localStorage save exists, that save is copied into the portal
 * once so returning players keep progress — then all further writes stay on
 * the Data module only.
 *
 * Every sub-system's `deserialize` already tolerates missing fields, and
 * produce stacks are rebuilt from the crop table rather than trusted, so an
 * older save is safe to hand over as-is. Refusing to load it instead — which
 * is what a bare `version !== CURRENT` check does — throws away hours of the
 * player's progress to avoid a problem that has already been handled.
 *
 * A *newer* save is a different matter: it was written by code this build does
 * not have, so it is left untouched rather than partially loaded and then
 * overwritten by the autosave.
 */
export async function load(): Promise<SaveData | null> {
  try {
    if (platform.usesCloudSave()) {
      const cloud = await platform.loadSave(KEY)
      if (cloud && typeof cloud === 'object') {
        const ok = validate(cloud as SaveData)
        if (ok) return ok
      }
      const local = readLocal()
      if (local) {
        // One-time migrate into the portal data module.
        platform.persistSave(KEY, local)
        return local
      }
      return null
    }

    return readLocal()
  } catch {
    return null
  }
}

export function clear() {
  if (platform.usesCloudSave()) platform.clearSave(KEY)
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  // The drawn plot lives outside the save blob (see village.ts for why) so it
  // has to be forgotten explicitly, or a fresh start reopens on the same corner.
  clearPlotChoice()
}

/**
 * Crops keep growing while the tab is closed.
 *
 * The cap is deliberately generous — a full day. Closing the tab and coming
 * back to a grown farm *is* the hook, and a short cap punishes exactly the
 * players who log in daily rather than idling. It is still capped rather than
 * unbounded so that a save left for a year does not fast-forward through
 * thousands of mutation rolls in one frame.
 */
export const MAX_OFFLINE_SECONDS = 60 * 60 * 24

export function offlineSeconds(savedAt: number) {
  return Math.max(0, Math.min(MAX_OFFLINE_SECONDS, (Date.now() - savedAt) / 1000))
}
