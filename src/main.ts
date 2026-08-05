import * as THREE from 'three'
import { Engine } from './core/engine'
import { Input } from './core/input'
import { pickGround, pickObjects, rayDistanceToPoint } from './core/picking'
import { worldClicksSwallowed, swallowBackdropClick } from './core/click-guard'
import { loadGroundTextures, loadParticleTextures } from './assets/textures'
import { loadSkyTexture, Skybox } from './assets/skybox'
import { loadModels, loadFarmerModel, loadCreatureModel, loadShopkeeperModel, loadFarmgirlModel } from './assets/models'
import { createWorld, SHOP_POS, FARM_CENTRE, BARN_POS } from './game/world'
import { inPlayerPlot, SPAWN } from './game/village'
import { GuidePath } from './game/guide-path'
import { preloadImages } from './ui/preload-images'
import { groundHeight } from './game/terrain'
import { updateGrass } from './game/vegetation'
import { Farm, TILE_SIZE, type Tile } from './game/farm'
import { CROPS, CROP_BY_ID } from './game/crops'
import { rng } from './assets/style'
import { Player, PLAYER_HEIGHT } from './game/player'
import { HOTBAR_SLOTS, Inventory } from './game/inventory'
import { DayCycle, DAY_LENGTH } from './game/daycycle'
import { Weather } from './game/weather'
import { formatCoins } from './ui/format'
import { Hud } from './ui/hud'
import { ShopUi } from './ui/shop-ui'
import { QuestUi } from './ui/quest-ui'
import {
  Progression,
  unlockLevelFor,
  cropsUnlockedAt,
  featuresUnlockedAt,
  featureLevel,
  MAX_LEVEL,
  type FeatureUnlock,
} from './game/progression'
import { Quests } from './game/quests'
import { SPRINKLER_TIERS, SPRINKLER_BY_ID, type SprinklerTierId } from './game/sprinklers'
import { produceLabel, produceValue, valueMultiplier } from './game/mutations'
import { PlotUi } from './ui/plot-ui'
import { AnimalUi } from './ui/animal-ui'
import { Pasture, type AnimalDef } from './game/animals'
import { Wildlife, type TameTarget } from './game/wildlife'
import { Clearing, CLEAR_COST } from './game/clearing'
import { BeachSeeds, BEACH_SEED_CROP } from './game/beach-seeds'
import { Stock } from './game/stock'
import { Audio } from './core/audio'
import { Pets, type EggDef } from './game/pets'
import { PetUi } from './ui/pet-ui'
import { Neighbourhood } from './game/neighbours'
import { NeighbourUi } from './ui/neighbour-ui'
import { NeighbourPlotUi } from './ui/neighbour-plot-ui'
import { PostFX } from './core/postfx'
import { Ambience } from './game/ambience'
import { Bursts } from './assets/burst'
import { Popups, Shake } from './ui/popups'
import { RARITY_BY_ID } from './game/mutations'
import { SettingsUi } from './ui/settings-ui'
import { BagUi } from './ui/bag-ui'
import { Ftue, forgetFtue } from './ui/ftue'
import { DevUi } from './ui/dev-ui'
import { isEditingUi } from './ui/layout/editing'
import { Tips } from './ui/tips'
import { Discovery } from './game/discovery'
import { AlmanacUi } from './ui/almanac-ui'
import { Prestige } from './game/prestige'
import { PrestigeUi } from './ui/prestige-ui'
import { Trading } from './game/trading'
import { Requests } from './game/requests'
import { Placeables, DecorGhost, PLACEABLE_BY_ID, PLACEABLES } from './game/placeables'
import { seasonForDay, dayWithinSeason, DAYS_PER_SEASON, growthMultiplier, priceMultiplier } from './game/seasons'
import { Doobers } from './game/doobers'
import { LevelUpScreen } from './ui/levelup-screen'
import { TouchControls } from './ui/touch'
import { enableAutoFullscreen } from './ui/fullscreen'
import { coinIconHtml, mutationIconHtml } from './ui/icons'
import * as Save from './game/save'

// `?new` starts a fresh farm. Needed because the unload autosave means simply
// clearing storage and reloading writes the old state straight back.
const freshStart = new URLSearchParams(location.search).has('new')
if (freshStart) history.replaceState(null, '', location.pathname)

const canvas = document.getElementById('game') as HTMLCanvasElement
const engine = new Engine(canvas)

// Phones/tablets: enter fullscreen on tap — register before loading awaits so
// a tap on the splash still counts as the user gesture.
enableAutoFullscreen()

const audio = new Audio()

if (freshStart) Save.clear()
declare global {
  interface Window {
    __loading?: (fraction: number, hint?: string) => void
  }
}
window.__loading?.(0.15, 'Loading the valley…')

// --- world ------------------------------------------------------------------
// Both must be resident before anything is built: the world reads ground
// textures at construction, and the farm reads the planter model the first time
// a plot is tilled — including while deserialising a save.
const [, , , , , , , skyTex] = await Promise.all([
  loadGroundTextures(),
  loadParticleTextures(),
  loadModels(),
  loadFarmerModel(PLAYER_HEIGHT),
  // The wild cow: rigged, unlike the paddock's procedural livestock. Sized to
  // the shoulder rather than the spine — see loadCreatureModel.
  loadCreatureModel('cow-wild', 'models/cow-wild.glb', 'models/cow-wild-walk.glb', 1.55),
  // A head taller than the player: an adult behind the counter, and it keeps
  // them visible over the stall's awning from the lane.
  loadShopkeeperModel(PLAYER_HEIGHT * 1.15),
  // A shade shorter than the shopkeeper — she reads as the younger of the two.
  loadFarmgirlModel(PLAYER_HEIGHT * 1.02),
  loadSkyTexture(), // → skyTex
])
/*
 * The UI art, warmed before the loading screen lifts.
 *
 * Runs after the models rather than beside them: the 3D assets gate whether the
 * world can be *built* at all, while these only gate whether it looks right, so
 * the heavier work should not queue behind a hundred small PNGs on a shared
 * connection budget.
 */
window.__loading?.(0.75, 'Unpacking the toolshed…')
await preloadImages((f) => {
  window.__loading?.(0.75 + f * 0.1)
})

window.__loading?.(0.85, 'Planting the forest…')
const world = createWorld(engine.renderer)
engine.scene.add(world.group)
engine.setCameraObstacles(world.obstacles)

const farm = new Farm(FARM_CENTRE.clone())
engine.scene.add(farm.group)

const player = new Player()
engine.scene.add(player.object)

// --- presentation -----------------------------------------------------------
const postfx = new PostFX(engine.renderer, engine.scene, engine.camera)
engine.postfx = postfx
engine.skyline = world.skyline
engine.lanterns = world.lanterns

const skybox = new Skybox(skyTex)
engine.scene.add(skybox.mesh)
engine.skybox = skybox
engine.scene.background = null

const ambience = new Ambience()
engine.scene.add(ambience.group)

const bursts = new Bursts()
engine.scene.add(bursts.group)

const doobers = new Doobers()
// Two meshes: faceted gems for xp/honey/produce, the authored model for coins.
engine.scene.add(doobers.mesh, doobers.coinMesh)

const levelUpScreen = new LevelUpScreen()

const popups = new Popups(engine)
const shake = new Shake()

// --- state ------------------------------------------------------------------
const inventory = new Inventory()
const day = new DayCycle()
const weather = new Weather(engine.scene)
const progression = new Progression()
const quests = new Quests()
const stock = new Stock()
const discovery = new Discovery()
const prestige = new Prestige()
const trading = new Trading()
const requests = new Requests()
const placeables = new Placeables()
const decorGhost = new DecorGhost()
/**
 * The HUD's buttons and the keyboard shortcuts share these handlers.
 *
 * Declared before the panels they open, so they are late-bound through the
 * closures below rather than needing the whole UI constructed first.
 */
/**
 * The single gate every route into a feature goes through — nav buttons,
 * keyboard shortcuts and world clicks alike. Returns false (with the pitch)
 * when the feature is still locked, so no path can leak past the level wall.
 */
function requireFeature(id: FeatureUnlock['id']) {
  if (progression.hasFeature(id)) return true
  hud.toast(`🔒 Unlocks at level ${featureLevel(id)}`, 'info')
  audio.play('click')
  return false
}

const hud = new Hud(inventory, {
  nav: (target) => {
    // Clicked is clicked: the sound fires before the gate, so a locked button
    // still feels pressed rather than dead.
    audio.play('click')
    switch (target) {
      case 'menu': settingsUi.toggle(); break
      case 'quests': questUi.toggle(); break
      case 'bag': bagUi.toggle(); break
      case 'valley': if (requireFeature('valley')) neighbourUi.toggle(); break
      case 'pets': if (requireFeature('pets')) petUi.toggle(); break
      case 'almanac': if (requireFeature('almanac')) almanacUi.toggle(); break
      case 'legacy': if (requireFeature('legacy')) prestigeUi.toggle(); break
    }
  },
  tool: (target) => {
    audio.play('click')
    switch (target) {
      case 'shovel': setPlaceMode(placeMode === 'shovel' ? 'none' : 'shovel'); break
      case 'sprinkler': if (requireFeature('sprinkler')) toggleSprinklerMode(); break
      case 'decor': if (requireFeature('decor')) setPlaceMode(placeMode === 'decor' ? 'none' : 'decor'); break
      case 'harvest': harvestEverything(); break
    }
  },
})
const bagUi = new BagUi(inventory, (m, k) => hud.toast(m, k))
const shopUi = new ShopUi(
  inventory,
  progression,
  stock,
  (m, k) => hud.toast(m, k),
  (id) => {
    decorId = id
    setPlaceMode('decor')
  },
  (id) => audio.play(id),
)

// Sales feed the "earn coins" objectives. Watching the wallet is simpler and
// more robust than threading a callback through every sell path in the shop.
/**
 * Doobers deliver their payload on arrival rather than at spawn time.
 *
 * That delay is the point — the number on the HUD ticks up as the orbs land,
 * so the reward is spread over the animation instead of appearing before it.
 */
/**
 * Orbs leave a thin trail on their run to the player.
 *
 * The magnet flight is the part of the payout the player actually watches, and a
 * bare tumbling coin has no sense of speed. The trail is throttled inside
 * Doobers to a few sparks per orb per second — enough to read as motion, far
 * short of a firework.
 */
doobers.onTrail = (at, kind) => {
  bursts.emit(at, 1, kind === 'coin' ? [0xffe27a] : [0xb6ff8a], {
    kind: 'spark',
    speed: 0.35,
    life: 0.38,
    scale: 0.06,
  })
}

doobers.onCollect = ({ kind, value }) => {
  if (kind === 'coin') {
    inventory.coins += value
    hud.pulseChip('coinChip')
  } else if (kind === 'xp') {
    // Straight to the bar, bypassing grantXp — this XP was already counted
    // when the doober was spawned, and re-granting would double it.
    hud.pulseChip('levelChip')
  } else if (kind === 'honey') {
    inventory.addMaterial('honey', value)
  }
  audio.play('pop')
}

let lastCoins = inventory.coins
inventory.onChange(() => {
  const delta = inventory.coins - lastCoins
  lastCoins = inventory.coins
  if (delta > 0) quests.record('earn', delta)
})

let elapsed = 0

/** Award XP and surface any level-ups, including their payouts. */
function grantXp(amount: number) {
  for (const { level, reward } of progression.addXp(amount)) {
    // Crop unlocks live on the crop, so the banner looks up what this level
    // actually opened rather than the reward table repeating itself.
    const unlocked = cropsUnlockedAt(level)
    const note = unlocked.length
      ? `${unlocked.map((c) => `${c.emoji} ${c.name}`).join(', ')} unlocked`
      : (reward?.note ?? 'Level up!')

    // Build the reward list for the celebration screen before granting any of
    // it, so the panel describes exactly what the player is about to receive.
    const rewards: { iconId?: string; emoji: string; label: string }[] = []
    for (const crop of unlocked) {
      rewards.push({
        iconId: crop.id,
        emoji: crop.emoji,
        label: `${crop.name} seeds unlocked`,
      })
    }
    if (reward?.coins) {
      rewards.push({
        iconId: 'coin',
        emoji: '🪙',
        label: `${formatCoins(reward.coins)} coins`,
      })
    }
    if (reward?.plots) {
      rewards.push({
        iconId: 'plot',
        emoji: '🟫',
        label: `${reward.plots} free plot${reward.plots === 1 ? '' : 's'}`,
      })
    }
    for (const seed of reward?.seeds ?? []) {
      rewards.push({
        iconId: seed.id,
        emoji: '🌱',
        label: `${seed.qty}× ${seed.id} seeds`,
      })
    }
    if (reward?.luck) {
      rewards.push({
        iconId: 'luck',
        emoji: '🍀',
        label: `+${Math.round(reward.luck * 100)}% luck`,
      })
    }

    // Whole features land loudest, so they lead the list.
    for (const f of featuresUnlockedAt(level).reverse()) {
      rewards.unshift({ emoji: f.emoji, label: `${f.name} unlocked — ${f.blurb}` })
    }
    const featureNote = featuresUnlockedAt(level)[0]
    levelUpScreen.show(
      level,
      featureNote ? `${featureNote.emoji} ${featureNote.name} unlocked!` : unlocked.length ? note : (reward?.note ?? 'Keep going!'),
      rewards,
    )
    hud.rebuildHotbar(progression.level)
    // Whatever this level brings to the village — the stall, the barn, the next
    // neighbour — turns up as part of the level-up rather than on the next load.
    applyArrivals()
    audio.play('levelup')
    // Coins arrive as doobers so the payout is felt, not just tallied.
    if (reward?.coins) doobers.spawn(player.position, 'coin', 12, reward.coins)
    if (reward?.plots) grantFreePlots(reward.plots)
    for (const seed of reward?.seeds ?? []) inventory.giveSeed(seed.id, seed.qty)
  }
  hud.updateLevel(progression)
  hud.updateLocks((id) => progression.hasFeature(id), featureLevel)
}

/** Hand out free plots by expanding outward from the existing farm. */
function grantFreePlots(count: number) {
  let given = 0
  for (const tile of farm.tiles) {
    if (given >= count) break
    if (farm.canPlace(tile)) {
      farm.placePlot(tile)
      given++
    }
  }
  hud.updateShovel(shovelMode(), farm.nextPlotCost)
}

const questUi = new QuestUi(quests, {
  claimQuest: (quest) => {
    if (!quests.claimCurrent()) return
    doobers.spawn(player.position, 'coin', 14, quest.reward.coins)
    for (const seed of quest.reward.seeds ?? []) inventory.giveSeed(seed.id, seed.qty)
    hud.toast(`📜 ${quest.name} complete · 🪙${formatCoins(quest.reward.coins)}`, 'good')
    grantXp(quest.reward.xp)
  },
  claimDaily: (daily) => {
    if (!quests.claimDaily(daily.id)) return
    doobers.spawn(player.position, 'coin', 10, daily.reward.coins)
    hud.toast(`⭐ Daily complete · 🪙${formatCoins(daily.reward.coins)}`, 'good')
    grantXp(daily.reward.xp)
  },
})

/** Which placement tool is equipped, if any. */
type PlaceMode = 'none' | 'shovel' | 'sprinkler' | 'decor'
let placeMode: PlaceMode = 'none'
/** Which sprinkler tier the player is currently placing. */
let sprinklerTier: SprinklerTierId = 'basic'

const shovelMode = () => placeMode === 'shovel'

// --- pets --------------------------------------------------------------------
const pets = new Pets()
engine.scene.add(pets.group)

const plotUi = new PlotUi(inventory, {
  plant: (tile) => {
    const crop = inventory.selectedCrop
    // Never fail silently: every path out of a button press either plants or
    // says why not. A quiet return here reads as the game being broken.
    if (inventory.seedCount(crop.id) <= 0) {
      hud.toast(`No ${crop.name} seeds — buy some at the shop`, 'bad')
      return
    }
    if (!progression.canPlant(crop.id)) {
      hud.toast(`${crop.name} unlocks at level ${unlockLevelFor(crop.id)}`, 'bad')
      return
    }
    inventory.takeSeed(crop.id)
    if (!farm.plant(tile, crop.id, progression.luck + pets.bonuses().luck, elapsed)) {
      // The tile was claimed between render and click (sprinkler, regrow tick).
      inventory.giveSeed(crop.id, 1)
      hud.toast('That plot is already taken', 'bad')
      return
    }
    player.playAction('hoe')
    audio.play('plant')
    bursts.emit(tile.pos, 7, [0x8a6238, 0xa8804a], {
      kind: 'puff',
      speed: 0.7,
      life: 0.5,
      scale: 0.11,
      jitter: 0.35,
    })
    quests.record('plant')
    grantXp(2)
  },
  water: (tile) => {
    if (!farm.water(tile)) return
    player.playAction('can')
    audio.play('water')
    // Droplets fall (shards under gravity); the mist above them hangs and
    // spreads. Two kinds because water does both things at once.
    bursts.emit(tile.pos, 14, [0x8fd8ff, 0xd6f2ff], {
      kind: 'shard',
      speed: 1.9,
      life: 0.55,
      scale: 0.07,
      jitter: 0.5,
    })
    bursts.emit(tile.pos, 5, [0xdff2ff], {
      kind: 'puff',
      speed: 0.5,
      life: 0.7,
      scale: 0.12,
      jitter: 0.4,
    })
    quests.record('water')
    grantXp(1)
  },
  harvest: (tile) => {
    // Checked before picking, not after: a picked plant is gone, so harvesting
    // into a full barn would delete the produce rather than postpone it.
    if (inventory.storageFull) {
      // At the plant, not just in the corner: the toast explains what to do but
      // appears far from where the player is looking, so a harvest that silently
      // did nothing reads as the tap having missed. This lands where their eye
      // already is.
      popups.spawn('🛖 Barn full!', tile.pos, 'rare', 1.8)
      hud.toast('Barn is full — sell at the seed shop', 'bad')
      audio.play('error')
      return
    }
    const petBonus = pets.bonuses()
    const got = farm.harvest(tile, elapsed, {
      weight: petBonus.weight,
      duplicate: petBonus.duplicate,
    })
    if (!got) return

    // Season bonus is applied as extra weight, so it flows through pricing,
    // stacking and the sell UI without a second multiplier to keep in sync.
    const seasonBoost = priceMultiplier(seasonForDay(day.day), got.def)
    const weightKg = got.weightKg * seasonBoost

    const storedUnits = inventory.addProduce(got.def, got.amount, got.rarity, got.mutations, weightKg)
    if (storedUnits < got.amount) {
      hud.toast(`Barn full — only ${storedUnits} of ${got.amount} fitted`, 'bad')
    }
    const label = produceLabel(got.def, got.rarity, got.mutations)
    const value = produceValue(got.def, got.rarity, got.mutations, weightKg)
    const special = got.rarity !== 'common' || got.mutations.length > 0

    if (
      discovery.recordHarvest(got.def.id, got.amount, got.rarity, got.mutations, value, got.heaviestKg)
    ) {
      hud.toast('📖 New almanac entry', 'good')
    }

    // Pets learn from every harvest they were out for.
    for (const pet of pets.addXp(Math.max(1, Math.round(got.def.xp * 0.6)))) {
      hud.toast(`${pet.species.emoji} ${pet.species.name} reached level ${pet.level}!`, 'good')
    }

    // A genuinely heavy fruit is its own event, separate from rarity.
    // 1.45x is roughly the top few percent of the weight curve (max is 1.65x).
    if (got.heaviestKg > got.def.baseWeight * 1.45) {
      popups.spawn(`${got.heaviestKg.toFixed(2)}kg!`, tile.pos, 'rare', 2)
    }

    // --- juice -----------------------------------------------------------
    // Everything scales off the multiplier, so a jackpot is unmistakably
    // louder than a routine turnip without needing a special case per tier.
    const mult = valueMultiplier(got.rarity, got.mutations)
    const rarityColor = RARITY_BY_ID.get(got.rarity)?.color
    const tier = mult >= 100 ? 'epic' : mult >= 10 ? 'rare' : special ? 'good' : 'normal'

    // Three layers per harvest: chips of produce thrown out, leaves fluttering
    // down after them, and — only for a rare — sparks on top. The tiering is
    // what makes a jackpot legible from across the farm without a label.
    const chips = tier === 'epic' ? 26 : tier === 'rare' ? 18 : 10
    bursts.emit(tile.pos, chips, [got.def.fruitColor, rarityColor ?? got.def.fruitColor], {
      kind: 'shard',
      speed: tier === 'normal' ? 2.6 : 4.4,
      life: tier === 'normal' ? 0.7 : 1.1,
    })
    bursts.emit(tile.pos, tier === 'normal' ? 5 : 10, [got.def.leafColor], {
      kind: 'petal',
      speed: 2.2,
      jitter: 0.2,
    })
    if (tier !== 'normal') {
      bursts.emit(tile.pos, tier === 'epic' ? 30 : 16, [rarityColor ?? 0xfff0a0, 0xfff8d0], {
        kind: 'spark',
        speed: 5,
        life: 0.8,
      })
    }
    // Soil disturbed at the roots, kicked out low and wide.
    bursts.emit(tile.pos, 6, [0xa8804a, 0x8a6238], { kind: 'puff', speed: 1, scale: 0.2 })
    // XP orbs are purely visual — the XP itself is granted below. They exist
    // so a harvest throws something physical rather than only text.
    doobers.spawn(tile.pos, 'xp', tier === 'epic' ? 9 : tier === 'rare' ? 6 : 3, 0)
    popups.spawn(
      `+${coinIconHtml('popup-coin')}${formatCoins(value)}`,
      tile.pos,
      tier,
      tier === 'normal' ? 1.3 : 2,
    )
    if (special) popups.spawn(label, tile.pos, tier, 2.2)
    if (tier !== 'normal') shake.add(tier === 'epic' ? 0.9 : 0.4)
    audio.play(tier === 'epic' ? 'epic' : tier === 'rare' ? 'rare' : 'harvest')

    hud.toast(
      `+${got.amount} ${label} · ${got.weightKg.toFixed(2)}kg · 🪙${formatCoins(value)}` +
        (got.regrowing ? ' · regrowing' : ''),
      'good',
    )

    quests.record('harvest', got.amount, {
      cropId: got.def.id,
      rarityId: got.rarity,
      mutated: got.mutations.length > 0,
    })
    // Rare and mutated crops pay XP proportional to their value, so chasing
    // the lottery advances levels as well as coins.
    grantXp(Math.round(got.def.xp * got.amount * Math.min(8, valueMultiplier(got.rarity, got.mutations))))
  },
  instantGrow: (tile, cost) => {
    if (!inventory.spend(cost)) return
    farm.instantGrow(tile, elapsed)
    audio.play('instant-grow')
    hud.toast('⚡ Grown instantly', 'good')
  },
})

const petUi = new PetUi(pets, inventory, progression, {
  buyEgg: (def: EggDef) => {
    if (!inventory.spend(def.price)) {
      hud.toast('Not enough coins', 'bad')
      return
    }
    pets.startIncubating(def)
    hud.toast(`${def.emoji} ${def.name} is incubating`, 'good')
  },
  hatch: (uid: string) => {
    const pet = pets.hatch(uid)
    if (!pet) return
    if (discovery.recordPet(pet.species.id)) hud.toast('📖 New almanac entry', 'good')
    hud.toast(`${pet.species.emoji} It hatched into a ${pet.species.name}!`, 'good')
    popups.spawn(`${pet.species.emoji} ${pet.species.name}!`, player.position, 'epic', 2.4)
    audio.play('hatch')
    bursts.emit(player.position, 44, [0xfff0a0, 0xff7ae0, 0x7ae0ff], {
      kind: 'spark',
      speed: 5.4,
      life: 1.1,
    })
    bursts.emit(player.position, 16, [0xfff6c8, 0xffd9f0], { kind: 'petal', speed: 3.2, life: 2 })
    shake.add(0.7)
    grantXp(60)
  },
  toggleEquip: (pet) => pets.setEquipped(pet, !pet.equipped),
})

// --- livestock ---------------------------------------------------------------
const pasture = new Pasture()
engine.scene.add(pasture.group)

/** Sell animal products straight into the wallet — they need no seed cycle. */
function collectFrom(def: AnimalDef, count = 1) {
  inventory.coins += def.product.value * count
  grantXp(def.xp * count)
  audio.play('collect')
  hud.toast(
    `+${count} ${def.product.emoji} ${def.product.name} · 🪙${formatCoins((def.product.value * count))}`,
    'good',
  )
}

const animalUi = new AnimalUi(
  inventory,
  progression,
  pasture,
  (def) => {
    if (pasture.isFull) {
      audio.play('error')
      hud.toast('The paddock is full', 'bad')
      return
    }
    if (!inventory.spend(def.price)) {
      audio.play('error')
      hud.toast('Not enough coins', 'bad')
      return
    }
    audio.play('buy')
    pasture.add(def)
    if (discovery.recordAnimal(def.id)) hud.toast('📖 New almanac entry', 'good')
    hud.toast(`${def.emoji} A ${def.name} joins the pasture`, 'good')
    grantXp(def.xp * 2)
  },
  () => {
    for (const { def, count } of pasture.collectAll()) collectFrom(def, count)
  },
)

// --- seeds on the sand -------------------------------------------------------
const beachSeeds = new BeachSeeds()
engine.scene.add(beachSeeds.group)

beachSeeds.onCollect = (at, seeds) => {
  inventory.giveSeed(BEACH_SEED_CROP, seeds)
  bursts.emit(at, 12, [0xfff0a0, 0x9fe8b5], { kind: 'spark', speed: 2.6, life: 0.7 })
  popups.spawn(`+${seeds} 🥬`, at, 'good', 1.4)
  audio.play('collect')
}

beachSeeds.onEmptied = () => {
  hud.toast('🥬 Turnip seeds — now you need somewhere to plant them', 'good')
}

// --- the opening clearing ----------------------------------------------------
/*
 * The stand of trees on the ground the farm will occupy. Felling the last one
 * is what brings the farm into existence — see game/clearing.ts.
 */
const clearing = new Clearing(world.obstacles, rng(0xc1ea21))
engine.scene.add(clearing.group)

clearing.onCut = (at) => {
  bursts.emit(at, 16, [0x7ec850, 0x4a7a2c], { kind: 'petal', speed: 3, life: 1.2, jitter: 0.3 })
  bursts.emit(at, 10, [0xc7ad85, 0x8a6238], { kind: 'puff', speed: 1.2, scale: 0.22 })
  audio.play('harvest')
  shake.add(0.22)
}

clearing.onOpened = () => {
  farm.openClearing()
  world.setPlayerFenceVisible(true)
  hud.toast('🌱 The ground is clear — your farm is yours', 'good')
  audio.play('levelup')
  grantXp(20)
}

// --- wildlife ----------------------------------------------------------------
/*
 * Wild animals out past the fences, tamed by feeding them what they crave.
 *
 * Seeded from a fixed number so the herd is laid out the same way on every
 * boot of a given save — a player who spotted a cow by the west river and
 * walked home for a pumpkin should find it still in that half of the valley.
 */
const wildlife = new Wildlife(rng(0x5eed11fe))
engine.scene.add(wildlife.group)

/*
 * The arrival: a short hold on whatever just stepped out of the trees.
 *
 * Letterbox in, camera swings to the treeline, letterbox out — the same shape
 * the old raid cutscene had, kept deliberately short. It is an event that will
 * happen many times over a session, so it has to be an accent rather than an
 * interruption: no input lock beyond what the letterbox already implies, and it
 * yields entirely if a panel is open.
 */
const ARRIVAL_SECONDS = 2.4
let arrivalTimer = 0
const arrivalAt = new THREE.Vector3()
let arrivalPrevPitch = 0
let arrivalPrevYaw = 0
let arrivalYaw = 0

wildlife.onEmerge = (def, at) => {
  // Never steal the screen from a menu; the animal arrives unfilmed.
  if (modalOpen()) return
  arrivalTimer = ARRIVAL_SECONDS
  /*
   * Hold short of the treeline, not on it.
   *
   * The spawn point *is* the tree line, so parking the focus there puts the
   * camera boom in the canopy and the engine's obstacle avoidance then drags it
   * trunk to trunk. Pulling the hold a few units inward puts it on open ground
   * with the animal walking toward it.
   */
  arrivalAt.copy(at)
  const ring = Math.hypot(at.x, at.z)
  if (ring > 1) arrivalAt.multiplyScalar(Math.max(0, ring - 7) / ring)
  arrivalPrevPitch = engine.pitch
  arrivalPrevYaw = engine.targetYaw
  // Aim outward from the valley centre, so the camera looks *at* the forest the
  // animal is coming out of rather than from behind it.
  arrivalYaw = Math.atan2(-at.x, -at.z)
  document.body.classList.add('cinematic')
  const title = document.getElementById('cineTitle')
  if (title) title.textContent = `A wild ${def.name} appears`
  audio.play('rare')
}

wildlife.onFed = (def, at) => {
  bursts.emit(at, 14, [0xfff0a0, 0xffd24a], { kind: 'spark', speed: 3.2, life: 0.7 })
  bursts.emit(at, 8, [0xc7ad85], { kind: 'puff', speed: 0.9, scale: 0.16 })
  audio.play('collect')
  popups.spawn(`${def.emoji} tamed!`, at, 'good', 1.8)
}

wildlife.onTamed = (def, at) => {
  /*
   * The animal is only *given* once it has finished walking off.
   *
   * A full paddock is the one way this can fail, and it has to fail after the
   * walk rather than before it — the check belongs where the animal actually
   * arrives, or a player could feed a dragonfruit to a pig and be told
   * afterwards that there was never room for it.
   */
  if (pasture.isFull) {
    hud.toast(`The paddock is full — ${def.name} wandered off`, 'bad')
    return
  }
  pasture.add(def)
  grantXp(def.xp * 3)
  hud.toast(`${def.emoji} A wild ${def.name} followed you home!`, 'good')
  audio.play('levelup')
  void at
}

// --- neighbours --------------------------------------------------------------
const hood = new Neighbourhood(world.obstacles, world.walls)

/*
 * The shopkeeper's hello.
 *
 * Quiet: it is a courtesy, not an event, and it fires every time the player
 * crosses the greeting line — a full-volume voice there would be the loudest
 * thing on a walk past the stall. The wave's own 12-second cooldown is what
 * stops it repeating; nothing extra is needed here.
 */
world.shopkeeper.onGreet = () => audio.play('greet', { gain: 0.5 })
world.farmgirl.onGreet = () => audio.play('greet-girl', { gain: 0.5 })

engine.scene.add(hood.group)

const neighbourUi = new NeighbourUi(hood, progression, inventory, trading, requests, {
  deliver: (n, req) => {
    if (!requests.fulfil(req, inventory)) {
      hud.toast('You do not have what they asked for', 'bad')
      audio.play('error')
      return
    }
    n.friendship = Math.min(100, n.friendship + req.friendship)
    n.setNeedsAttention(false)
    audio.play('coin')
    hud.toast(`${n.profile.name} is delighted · 🪙${formatCoins(req.coins)}`, 'good')
    // Worth more XP than a trade: this one had a clock on it.
    grantXp(Math.round(req.coins / 8))
  },
  visit: (n) => {
    // Fast travel drops the player at the gate, facing the plot.
    player.position.set(n.gate.x, 0, n.gate.z)
    engine.focus.copy(player.position)
    hud.toast(`Visiting ${n.profile.name}'s farm`, 'good')
  },
  water: (n) => {
    // Must actually be at their farm. Without this the roster panel is a
    // free XP button you can spam from your own porch.
    const dist = Math.hypot(player.position.x - n.centre.x, player.position.z - n.centre.z)
    if (dist > 12) {
      hud.toast(`Visit ${n.profile.name}'s farm first`, 'bad')
      audio.play('error')
      return
    }
    if (!n.waterOne()) return
    player.playAction('can')
    audio.play('water')
    grantXp(6)
    hud.toast(`💧 Watered a plot for ${n.profile.name} · +6 XP`, 'good')
  },
  trade: (n, offer) => {
    if (!trading.fulfil(offer, inventory)) {
      hud.toast('You do not have what they asked for', 'bad')
      audio.play('error')
      return
    }
    n.friendship = Math.min(100, n.friendship + offer.friendship)
    audio.play('coin')
    hud.toast(`🤝 Traded with ${n.profile.name} · 🪙${formatCoins(offer.coins)}`, 'good')
    grantXp(Math.round(offer.coins / 12))
  },
  claimGift: (n) => {
    const gift = n.claimGift()
    if (!gift) return
    inventory.coins += gift.coins
    inventory.giveSeed(gift.seedId, gift.seeds)
    hud.toast(
      `🎁 ${n.profile.name} sent 🪙${formatCoins(gift.coins)} and ${gift.seeds} seeds`,
      'good',
    )
    grantXp(gift.coins / 10)
  },
})

// --- settings + onboarding ---------------------------------------------------
const settingsUi = new SettingsUi(audio, postfx, {
  resetFarm: () => {
    Save.clear()
    location.href = location.pathname
  },
})

const tips = new Tips((id) => audio.play(id))
tips.enabled = settingsUi.settings.showTips

/** Harvest every ripe plot at once. Requires the Harvest Scythe. */
function harvestEverything() {
  if (!inventory.hasTool('harvester')) {
    hud.toast('Buy the 🌾 Harvest Scythe from the stall’s Tools tab', 'bad')
    audio.play('error')
    return
  }

  const ripeBefore = farm.ripeTiles.length
  const petBonus = pets.bonuses()
  const picked = farm.harvestAll(
    elapsed,
    { weight: petBonus.weight, duplicate: petBonus.duplicate },
    inventory.storageSpace,
  )
  if (picked.length === 0) {
    const full = ripeBefore > 0
    hud.toast(full ? 'Barn is full — sell at the seed shop' : 'Nothing is ripe yet', full ? 'bad' : 'info')
    audio.play('error')
    return
  }
  // Anything left standing was left on purpose — say so, or a scythe that
  // stopped halfway reads as broken.
  if (picked.length < ripeBefore) {
    hud.toast(`Barn filled up — ${ripeBefore - picked.length} plots left ripe`, 'bad')
  }

  let totalValue = 0
  let totalUnits = 0
  let best = { label: '', value: 0 }

  for (const { tile, result } of picked) {
    inventory.addProduce(result.def, result.amount, result.rarity, result.mutations, result.weightKg)
    const value = produceValue(result.def, result.rarity, result.mutations, result.weightKg)
    totalValue += value
    totalUnits += result.amount
    if (value > best.value) {
      best = { label: produceLabel(result.def, result.rarity, result.mutations), value }
    }

    quests.record('harvest', result.amount, {
      cropId: result.def.id,
      rarityId: result.rarity,
      mutated: result.mutations.length > 0,
    })
    grantXp(
      Math.round(
        result.def.xp * result.amount * Math.min(8, valueMultiplier(result.rarity, result.mutations)),
      ),
    )

    /*
     * The reap cascades outward from the farmer instead of firing at once.
     *
     * Every plot popping on the same frame is a strobe that reads as one event
     * with no shape to it. Staggering by distance turns the same harvest into a
     * visible wave rolling across the field — and it thins the peak particle
     * load for free. Capped so a hundred-plot farm still finishes promptly.
     */
    const delay = Math.min(
      0.85,
      Math.hypot(tile.pos.x - player.position.x, tile.pos.z - player.position.z) * 0.055,
    )
    const fruitColor = result.def.fruitColor
    const leafColor = result.def.leafColor
    const at = tile.pos.clone()
    schedule(delay, () => {
      bursts.emit(at, 8, [fruitColor], { kind: 'shard', speed: 3 })
      bursts.emit(at, 4, [leafColor], { kind: 'petal', speed: 2 })
    })
  }

  for (const pet of pets.addXp(Math.max(1, picked.length * 3))) {
    hud.toast(`${pet.species.emoji} ${pet.species.name} reached level ${pet.level}!`, 'good')
  }

  popups.spawn(`+🪙${formatCoins(totalValue)}`, player.position, 'rare', 2)
  hud.toast(
    `🌾 Reaped ${picked.length} plot${picked.length === 1 ? '' : 's'} · ${totalUnits} items · 🪙${formatCoins(totalValue)}`,
    'good',
  )
  if (best.value > 0 && picked.length > 1) hud.toast(`Best: ${best.label}`, 'good')

  player.playAction('hoe')
  audio.play('harvest')
  audio.play('coin')
  if (settingsUi.settings.shake) shake.add(Math.min(0.7, 0.15 * picked.length))
}

// --- almanac, legacy, decor --------------------------------------------------
engine.scene.add(placeables.group)
engine.scene.add(decorGhost.group)

/*
 * Farmland is off limits to the decorator.
 *
 * Every owned plot, not only the planted ones: a tray is a raised bed with a
 * rim, so a bench dropped on an empty one still stands in a planter, and the
 * plot it covers can be planted the moment the player picks a seed.
 */
placeables.setReservedGround((x, z) => farm.ownsGroundAt(x, z))

const almanacUi = new AlmanacUi(discovery)

const prestigeUi = new PrestigeUi(prestige, progression, () => {
  // Retirement wipes the run but keeps knowledge, pets and legacy upgrades.
  const earned = prestige.retire(progression.level)
  if (!earned) return

  const bonus = prestige.bonuses()
  farm.reset()
  placeables.clear()
  inventory.reset(600 + bonus.startCoins)
  progression.reset()
  quests.reset()
  stock.restock(1)
  trading.reset()
  requests.reset()
  syncRequestMarkers()

  // farm.reset() already restores the standard starting block, so only the
  // legacy bonus plots are added here.
  for (let i = 0; i < bonus.startPlots; i++) {
    const tile = farm.tiles.find((t) => farm.canPlace(t))
    if (tile) farm.placePlot(tile)
  }

  hud.rebuildHotbar(1)
  hud.updateLevel(progression)
  hud.updateShovel(shovelMode(), farm.nextPlotCost)
  hud.toast(`🌼 Farm retired · earned ${earned} blossom${earned === 1 ? '' : 's'}`, 'good')
  audio.play('levelup')
  prestigeUi.close()
})

/** Which decoration the player is currently placing. */
let decorId = PLACEABLES[0].id

function tryPlaceDecor(x: number, z: number) {
  const def = PLACEABLE_BY_ID.get(decorId)
  if (!def) return
  if (progression.level < def.unlockLevel) {
    hud.toast(`${def.name} unlocks at level ${def.unlockLevel}`, 'bad')
    audio.play('error')
    return
  }
  if (farm.ownsGroundAt(x, z)) {
    hud.toast('That is farmland — decorate around the beds', 'bad')
    audio.play('error')
    return
  }
  if (!placeables.canPlace(def, x, z)) {
    hud.toast('Not enough room there', 'bad')
    audio.play('error')
    return
  }
  if (!inventory.spend(def.price)) {
    hud.toast(`Need 🪙${formatCoins(def.price)}`, 'bad')
    audio.play('error')
    return
  }
  // Face the player, so benches and lamps orient sensibly without extra UI.
  const rotation = Math.atan2(x - player.position.x, z - player.position.z) + Math.PI
  placeables.place(def, x, z, rotation)
  audio.play('place')
  hud.toast(`${def.emoji} ${def.name} placed`, 'good')
}

const neighbourPlotUi = new NeighbourPlotUi({
  coins: () => inventory.coins,
  water: (neighbour, plot) => {
    if (!neighbour.water(plot)) return
    player.playAction('can')
    audio.play('water')
    // Same reward as helping from the valley menu: their goodwill, and the XP
    // for having bothered.
    grantXp(3)
    hud.toast(`${neighbour.profile.name} appreciates the help`, 'good')
  },
  ripen: (neighbour, plot, cost) => {
    if (inventory.coins < cost) return
    if (!neighbour.forceRipen(plot)) return
    inventory.spend(cost)
    bursts.emit(plot.pos, 20, [0x8ef27a, 0xfff0a0], { kind: 'spark', speed: 3.4 })
    popups.spawn('Grown!', plot.pos, 'rare', 1.8)
    audio.play('levelup')
    grantXp(12)
    hud.toast(`${neighbour.profile.name} will not forget that`, 'good')
  },
})

/** Anything that swallows input: movement, picking and prompts all stand down. */
const modalOpen = () =>
  arrivalTimer > 0 ||
  // The UI editor covers the screen with its own click catcher, so letting the
  // game keep reading input would have the farmer walking around underneath a
  // drag gesture. This is the one choke point that already gates movement,
  // picking and prompts together.
  isEditingUi() ||
  bagUi.open ||
  levelUpScreen.open || settingsUi.open || almanacUi.open || prestigeUi.open || shopUi.open || plotUi.open || questUi.open || animalUi.open || neighbourUi.open || neighbourPlotUi.open || petUi.open

/**
 * The subset of those that take over the screen, and so hide the HUD chrome.
 *
 * The two contextual tile menus are deliberately excluded: they are small popups
 * anchored to a plot, and the player picks the seed they are about to plant off
 * the hotbar while one is open. Hiding the hotbar there would break the very
 * action the menu exists for.
 */
const panelOpen = () =>
  levelUpScreen.open || settingsUi.open || almanacUi.open || prestigeUi.open || shopUi.open || questUi.open || animalUi.open || neighbourUi.open || petUi.open || bagUi.open

// --- restore ----------------------------------------------------------------
window.__loading?.(0.9, 'Waking the neighbours…')
const saved = await Save.load()
// FTUE starts only on a genuinely fresh farm; see ftue.ts for the resume rules.
const ftue = new Ftue(!saved, (id) => audio.play(id))
if (saved) {
  inventory.deserialize(saved.inventory)
  day.deserialize(saved.day)
  weather.deserialize(saved.weather)
  progression.deserialize(saved.progression)
  quests.deserialize(saved.quests)
  pasture.deserialize(saved.pasture)
  hood.deserialize(saved.neighbours)
  pets.deserialize(saved.pets)
  stock.deserialize(saved.stock)
  discovery.deserialize(saved.discovery)
  prestige.deserialize(saved.prestige)
  trading.deserialize(saved.trading)
  requests.deserialize(saved.requests)
  placeables.deserialize(saved.placeables)
  farm.deserialize(saved.farm, elapsed)
  // The clearing is implied by the farm: if any ground is owned, it was cut.
  if (farm.plotSpan > 0) {
    clearing.restoreOpened()
    world.setPlayerFenceVisible(true)
  }
  // Any seeds at all, or any progress, means the beach was already combed.
  if (farm.plotSpan > 0 || inventory.seedCount(BEACH_SEED_CROP) > 0) beachSeeds.restoreEmptied()

  const away = Save.offlineSeconds(saved.savedAt)
  if (away > 20) catchUp(away, 'while you were away')
}

/**
 * Fast-forward the simulation by `seconds`.
 *
 * Shared by page load and by returning to a backgrounded tab. Both are the
 * same problem: real time passed that the frame loop never saw.
 */
function catchUp(seconds: number, phrase: string) {
  day.advance(seconds)
  pets.advanceOffline(seconds)
  stock.advanceOffline(seconds, progression.level)
  farm.update(seconds, elapsed)
  hud.toast(`Welcome back! ${fmtDuration(seconds)} of growth ${phrase} 🌱`, 'good')
}

/**
 * Browsers pause requestAnimationFrame in hidden tabs, so switching away
 * freezes the game — and because `engine.tick()` clamps dt, the elapsed time
 * is silently *lost* rather than merely deferred. Without this, backgrounding
 * the tab for ten minutes costs you ten minutes of growth.
 */
let hiddenAt = 0
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Silence first: the save below touches a dozen systems, and the music
    // should not keep playing to an empty tab while it does.
    audio.suspendForHidden()
    hiddenAt = Date.now()
    Save.save(farm, inventory, day, weather, progression, quests, pasture, hood, pets, stock, discovery, prestige, trading, requests, placeables)
    return
  }
  // Back before anything else — the sound should be there as the tab appears,
  // not after the catch-up summary has finished being calculated.
  audio.resumeFromHidden()
  if (!hiddenAt) return
  const away = Math.min(Save.MAX_OFFLINE_SECONDS, (Date.now() - hiddenAt) / 1000)
  hiddenAt = 0
  if (away > 20) catchUp(away, 'in the background')
})

hud.updateLocks((id) => progression.hasFeature(id), featureLevel)
/*
 * World-to-CSS projector for panels that anchor to a 3D thing. The Y lift aims
 * at the plant's canopy rather than the soil, so the card lines up with what
 * the eye considers "the crop".
 */
const projTmp = player.position.clone()
const projectToScreen = (world: { x: number; y: number; z: number }) => {
  projTmp.set(world.x, world.y + 0.9, world.z).project(engine.camera)
  if (projTmp.z > 1) return null
  return {
    x: (projTmp.x * 0.5 + 0.5) * innerWidth,
    y: (-projTmp.y * 0.5 + 0.5) * innerHeight,
  }
}
plotUi.projector = projectToScreen
neighbourPlotUi.projector = projectToScreen

engine.focus.copy(player.position)
day.apply(engine)
hud.updateClock(day)
hud.updateShovel(shovelMode(), farm.nextPlotCost)
hud.updateLevel(progression)
quests.rollDailies(day.day, progression.level)
trading.refresh(
  day.day,
  progression.level,
  hood.all.map((n) => ({ id: n.profile.id, favourite: n.profile.favourite, friendship: n.friendship })),
)
postRequests(false)
if (stock.totalItems === 0) stock.restock(progression.level)

/**
 * Make sure the tutorial's current step can actually be finished.
 *
 * Every step that auto-advances asks the player to *do* something, and a step
 * whose requirements the player no longer has is not a hint — it is a card on
 * screen forever with no way to clear it. Two of them can be reached broke:
 *
 *  - "Plant a seed" with an empty seed bag. Only reachable by planting the
 *    starting five somewhere the step did not count, but a stuck new player has
 *    no way back: seeds cost coins, and coins come from crops.
 *  - "Buy some seeds" with less than the cheapest packet costs, which is the
 *    likelier one — a player who spent their opening coins on a plot arrives at
 *    the stall with nothing to spend and nothing planted to sell.
 *
 * So the means are topped up rather than the step being skipped: the player
 * still does the thing, which is the point of teaching it. Announced, because
 * money quietly appearing is worse than money appearing with a reason.
 *
 * Only ever runs during the tutorial, and each rescue fires once.
 */
const ftueRescued = new Set<string>()

function keepFtuePossible() {
  const step = ftue.stepId
  if (!step || ftueRescued.has(step)) return

  if (step === 'plant' && inventory.seedCount('turnip') === 0 && inventory.produce.size === 0) {
    ftueRescued.add(step)
    inventory.giveSeed('turnip', 3)
    hud.toast('You find a few more turnip seeds in a pocket', 'good')
    return
  }

  /*
   * The opening's one hard dead end: no coins, and trees still standing.
   *
   * Clearing is the only thing to spend on at this point and the only way to
   * get a farm, so a player who somehow arrives at it broke has no move at all
   * — there is nothing to sell, because there is nowhere to have grown it.
   * Topped up to exactly one tree's worth, so the rescue does not also skip the
   * lesson.
   */
  if (step === 'clear-trees' && inventory.coins < CLEAR_COST) {
    ftueRescued.add(step)
    inventory.coins = CLEAR_COST
    hud.toast('You turn out your pockets — just enough', 'good')
  }
}

/**
 * Roll the day's neighbour requests and put the markers up.
 *
 * `announce` is off at boot: a save loaded with yesterday's live request should
 * restore quietly, not open with a toast about something the player already
 * knows. On a day rollover it is on, because that is news.
 */
function postRequests(announce: boolean) {
  const posted = requests.refresh(
    day.day,
    progression.level,
    hood.all.map((n) => ({ id: n.profile.id, favourite: n.profile.favourite, friendship: n.friendship })),
  )
  syncRequestMarkers()
  if (!announce) return
  for (const req of posted) {
    const who = hood.all.find((n) => n.profile.id === req.neighbourId)
    if (!who) continue
    hud.toast(`${who.profile.name} needs ${requests.describe(req)} — see the valley`, 'info')
    audio.play('pop')
  }
}

/** Marker over each neighbour who is waiting on an answer. */
function syncRequestMarkers() {
  for (const n of hood.all) n.setNeedsAttention(requests.requestFor(n.profile.id) !== null)
}

// --- pointer ----------------------------------------------------------------
// Clicking interacts with whatever is under the cursor. It deliberately does
// NOT move the farmer — movement is WASD only, so a click is unambiguously an
// interaction and never a navigation command.
canvas.addEventListener('pointerdown', (e) => {
  // Touches go through TouchControls, which fires interactAt only for genuine
  // taps — a camera swipe or joystick pull must not also click the world.
  if (e.pointerType === 'touch') return
  if (e.button !== 0 || modalOpen()) return
  if (worldClicksSwallowed()) return
  interactAt(e.clientX, e.clientY)
})

/** One interaction path for mouse clicks and touch taps alike. */
/**
 * `reach` is how far from a tile's centre a ground hit still counts as that
 * tile, in world units. A mouse gets the tight default; a thumb gets more —
 * see the tap handler.
 */
/**
 * How near a plant a tap may land and still count, in *screen* pixels.
 *
 * Screen space, not world space, and the first attempt at this got it wrong in
 * an instructive way. Measuring the tap ray's distance to the plant in world
 * units sounds equivalent and is not: a ray is infinite, so one aimed at open
 * sky well to the side of a plot still passes within half a metre of *some*
 * plot further along the row, and a tap 260 pixels clear of any plant opened
 * one. What forgiveness should mean is "your thumb landed near the plant you
 * were aiming at", and that is a question about pixels.
 *
 * Sized as a thumb's radius. Wide enough to cover the gaps between a plant's
 * leaf cards, narrow enough that the grass beside a plot is still the grass.
 */
const CROP_TAP_FORGIVENESS_PX = 46
/** Heights up a plant's axis to measure against, in world units. */
const CROP_RAY_HEIGHTS = [0.15, 0.8, 1.5, 2.3]
const rayProbe = SPAWN.clone()

function interactAt(clientX: number, clientY: number, reach = TILE_SIZE * 0.8) {
  /*
   * The plant's own body wins over the ground behind it. A grown crop stands
   * over a metre tall, so the ground ray exits past the plot and tileNear
   * misses — making plants *harder* to click the better they grow. A direct
   * raycast against the crop meshes costs a few dozen boxes per click.
   *
   * This has to run *before* the ground pick, not after it. Tapping the upper
   * half of a tall crop — corn, a sunflower, a tree — sends the ground ray over
   * the plot and out to the horizon, and when the plant is silhouetted against
   * the sky the ray finds no ground at all. The old order bailed on that empty
   * ground hit and never consulted the crop meshes, so the taller a plant grew
   * the more of it stopped responding. Intermittent by construction: it
   * depended on where in the plant you happened to tap.
   */
  let cropTile: Tile | null = null
  for (const obj of pickObjects(engine, clientX, clientY, farm.cropRaycastRoot)) {
    cropTile = farm.tileFromObject(obj)
    if (cropTile) break
  }

  const hit = pickGround(engine, clientX, clientY)

  /*
   * Last resort: the plant whose body the tap landed nearest on screen.
   *
   * A crop is mostly gaps. The foliage is a few dozen flat cards around a thin
   * stem, so a tap aimed squarely at a corn plant frequently threads between
   * two leaves and hits neither the plant nor — if the plant is against the
   * sky — any ground behind it. Nothing was under that pixel, strictly, and the
   * tap did nothing; which is exactly the "sometimes it just doesn't work" a
   * player reports, because from the outside the two taps look identical.
   *
   * Only when there is no ground point at all, so this cannot steal a tap meant
   * for the shop, a building or a neighbour's plot — those all test against a
   * ground position and would have produced one.
   */
  if (!hit && !cropTile) {
    let best: Tile | null = null
    let bestDist = CROP_TAP_FORGIVENESS_PX
    for (const t of farm.tiles) {
      if (!t.placed) continue
      /*
       * Sampled up the plant's axis, not at one point on it. A single probe at
       * canopy height is only forgiving near that height, so the tall plants
       * this exists to help were the ones it missed.
       */
      for (const probeY of CROP_RAY_HEIGHTS) {
        rayProbe.set(t.pos.x, t.pos.y + probeY, t.pos.z)
        const at = projectToScreen({ x: rayProbe.x, y: rayProbe.y - 0.9, z: rayProbe.z })
        if (!at) continue
        const d = Math.hypot(at.x - clientX, at.y - clientY)
        if (d < bestDist) {
          bestDist = d
          best = t
        }
      }
    }
    cropTile = best
  }

  // Empty sky, and no plant anywhere near the line of the tap.
  if (!hit && !cropTile) return

  const tile = cropTile ?? farm.tileNear(hit!, reach)

  if (placeMode === 'shovel') {
    tryBuyPlot(tile)
    return
  }
  if (placeMode === 'sprinkler') {
    tryPlaceSprinkler(tile)
    return
  }
  if (placeMode === 'decor') {
    // Decor is placed on ground, so a tap with no ground under it does nothing.
    if (hit) tryPlaceDecor(hit.x, hit.z)
    return
  }

  /*
   * A tap that found a plant but no ground is unambiguous — it landed on the
   * crop itself, against the sky. Everything between here and the plot handling
   * is a test against a ground position, so there is nothing for them to
   * measure and no question about what was meant.
   */
  if (!hit) {
    if (tile?.placed) openPlot(tile)
    return
  }

  // Collecting from a hive takes priority over anything else nearby.
  const hive = placeables.nearest(hit.x, hit.z, 1.5)
  if (hive && hive.hive) {
    if (placeables.collectHoney(hive)) {
      doobers.spawn(hive.object.position, 'honey', 3, 1)
      audio.play('collect')
      hud.toast('🍯 Collected honey', 'good')
    } else {
      hud.toast('This hive is still filling', 'info')
    }
    return
  }

  /*
   * Buildings are clickable by their *bodies*, not just the dirt at their
   * feet: the ground ray from a click on the stall's awning lands behind the
   * building, so the old ground-distance test ignored exactly the clicks that
   * looked most deliberate. In range, a click opens; out of range it walks
   * the farmer over, and the E-prompt takes it from there.
   */
  const clickedShop =
    Math.hypot(hit.x - SHOP_POS.x, hit.z - SHOP_POS.z) < 3.6 ||
    rayDistanceToPoint(engine, clientX, clientY, shopClickPoint) < 2.4
  if (clickedShop) {
    if (shopInRange()) shopUi.show()
    else player.moveTo(shopApproach)
    return
  }

  const clickedBarn =
    Math.hypot(hit.x - BARN_POS.x, hit.z - BARN_POS.z) < 4.5 ||
    rayDistanceToPoint(engine, clientX, clientY, barnClickPoint) < 3.2
  if (clickedBarn) {
    if (!world.hasArrived('barn')) return
    const near = Math.hypot(player.position.x - BARN_POS.x, player.position.z - BARN_POS.z) < 7
    if (!near) player.moveTo(barnApproach)
    else if (requireFeature('animals')) animalUi.show()
    return
  }

  // Clicking an animal with a product ready collects it.
  const animal = pasture.findReadyNear(hit)
  if (animal) {
    const def = pasture.collect(animal)
    if (def) {
      collectFrom(def)
      bursts.emit(hit, 12, [def.product.color], { kind: 'shard', speed: 3 })
      bursts.emit(hit, 10, [0xfff0a0], { kind: 'spark', speed: 3.4 })
      popups.spawn(`+🪙${formatCoins(def.product.value)}`, hit, 'good')
    }
    return
  }

  if (tile?.placed) {
    openPlot(tile)
    return
  }

  // Not our land — see if they clicked a neighbour's plant.
  const theirs = hood.plotAt(hit)
  if (theirs) neighbourPlotUi.show(theirs.neighbour, theirs.plot)
}

/** Plant into a tile, or open its menu. Shared by the ground and crop-body paths. */
function openPlot(tile: Tile) {
  // Farm work happens *on* the farm. Clicking plots from the lane — reaching
  // over the fence — bounces, which is what gives the gate a reason to exist.
  if (!inPlayerPlot(player.position.x, player.position.z, 0.4)) {
    hud.toast('Step inside your farm to work the plots', 'info')
    return
  }
  /*
   * Fast path: a selected seed on an open, tilled plot plants with one click —
   * no menu round-trip. The menu is for everything that needs reading (growth,
   * instant-grow prices, switching seeds); planting the seed already in hand
   * needs none of it, and it is the single most repeated action in the game.
   * Any tile the fast path can't handle falls through to the menu, so nothing
   * is ever *only* reachable this way.
   */
  const seed = inventory.selectedCrop
  if (
    !tile.crop &&
    !tile.sprinkler &&
    tile.state === 'tilled' &&
    inventory.seedCount(seed.id) > 0 &&
    progression.canPlant(seed.id)
  ) {
    plotUi.actions.plant(tile)
    return
  }
  plotUi.show(tile)
}

// Touch: joysticks + tap-to-interact (Grow a Garden style, left move / right look).
const touchControls = new TouchControls(engine)
touchControls.onTap = (x, y) => {
  /*
   * A thumb is not a cursor, so a tap gets a wider tile than a click does.
   *
   * The plots are 1.2 units square and seen at a shallow angle, which makes the
   * near edge of one a few dozen pixels tall — comfortably smaller than the
   * contact patch of a thumb. Half a tile of extra reach is enough to forgive
   * that without letting a tap on the grass grab a plot a row away.
   */
  if (modalOpen() || worldClicksSwallowed()) return
  /*
   * Armed *before* the panel opens, because the click that would dismiss it is
   * already on its way: a touch fires pointerdown, pointerup, then a synthesised
   * click, and the tap is handled on the pointerup. Without this the panel opens
   * and the tail of the same tap closes it again.
   */
  swallowBackdropClick()
  interactAt(x, y, TILE_SIZE * 1.3)
}

// Right-drag is camera look, so suppress the browser menu.
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

function tryBuyPlot(tile: Tile | null) {
  if (!farm.canPlace(tile)) {
    hud.toast('New plots must touch your existing farm', 'bad')
    return
  }
  const cost = farm.nextPlotCost
  if (inventory.coins < cost) {
    hud.toast(`Need 🪙${formatCoins(cost)} for another plot`, 'bad')
    return
  }
  inventory.spend(cost)
  farm.placePlot(tile)
  player.playAction('shovel')
  audio.play('till')
  // Buying a plot is now what turns its soil, so it is what a "till N plots"
  // objective counts. Nothing generates those any more, but a save made before
  // the change can still hold one in flight.
  bursts.emit(tile.pos, 16, [0x8a6238, 0x6b4a28, 0xa8804a], {
    kind: 'shard',
    speed: 2.6,
    life: 0.7,
    scale: 0.1,
    jitter: 0.4,
  })
  bursts.emit(tile.pos, 8, [0xc7ad85], { kind: 'puff', speed: 0.9, scale: 0.22, jitter: 0.5 })
  shake.add(0.18)
  quests.record('till')
  hud.toast(`Plot bought for 🪙${formatCoins(cost)}`, 'good')
  hud.updateShovel(shovelMode(), farm.nextPlotCost)
  // The purchase moved the frontier — re-project the buyable markers around it.
  farm.showBuyableSpots(true, player.position)
}

function tryPlaceSprinkler(tile: Tile | null) {
  const tier = SPRINKLER_BY_ID.get(sprinklerTier)!
  if (inventory.sprinklerCount(tier.id) <= 0) {
    hud.toast(`No ${tier.name} in the shed — buy one at the shop`, 'bad')
    return
  }
  if (!farm.canPlaceSprinkler(tile)) {
    hud.toast('Sprinklers need an empty owned plot', 'bad')
    return
  }
  inventory.takeSprinkler(tier.id)
  farm.placeSprinkler(tile, tier)
  player.playAction('shovel')
  audio.play('place')
  hud.toast(`${tier.emoji} ${tier.name} installed`, 'good')
  if (inventory.sprinklerCount(tier.id) <= 0) setPlaceMode('none')
}

/** Equip the best sprinkler tier the player actually owns. */
function pickSprinklerTier() {
  for (const tier of [...SPRINKLER_TIERS].reverse()) {
    if (inventory.sprinklerCount(tier.id) > 0) return tier.id
  }
  return null
}

// --- interaction ------------------------------------------------------------
const SHOP_RANGE = 3.4
/** Mid-body aim points for the building click tests, and where an
 *  out-of-range click walks the farmer to. */
const shopClickPoint = SHOP_POS.clone().setY(1.6)
const barnClickPoint = BARN_POS.clone().setY(2.6)
const shopApproach = SHOP_POS.clone().add(SPAWN.clone().sub(SHOP_POS).setY(0).normalize().multiplyScalar(2.4))
const barnApproach = BARN_POS.clone().add(SPAWN.clone().sub(BARN_POS).setY(0).normalize().multiplyScalar(4))

/**
 * The wild animal the player is standing next to, if any.
 *
 * Deliberately reports a target the player *cannot* yet feed as well as one
 * they can — the prompt names the crop either way, and that naming is the only
 * place the game ever tells you what a species wants. Hiding it until you
 * happen to be carrying the right thing would make the whole feature invisible.
 */
function tameTarget(): TameTarget | null {
  if (modalOpen()) return null
  return wildlife.targetNear(player.position, (cropId) => inventory.produceCount(cropId) > 0)
}

/** Prompt line for a tameable animal: what it is, and what it wants. */
function tamePromptText(target: TameTarget) {
  const crop = CROP_BY_ID.get(target.cropId)
  const label = crop ? `${crop.emoji} ${crop.name}` : target.cropId
  return target.canFeed
    ? `${target.def.emoji} ${target.def.name} — feed ${label}`
    : `${target.def.emoji} ${target.def.name} wants ${label}`
}

function feedWildAnimal(target: TameTarget) {
  if (!target.canFeed) {
    const crop = CROP_BY_ID.get(target.cropId)
    audio.play('error')
    hud.toast(`The ${target.def.name} wants ${crop?.emoji ?? ''} ${crop?.name ?? target.cropId}`, 'info')
    return
  }
  if (pasture.isFull) {
    audio.play('error')
    hud.toast('The paddock is full', 'bad')
    return
  }
  // Take the food first: feedNear starts the animal walking away, and an
  // inventory that failed after that point would give the animal for nothing.
  if (!inventory.takeProduce(target.cropId)) {
    audio.play('error')
    return
  }
  wildlife.feedNear(player.position)
}

/** A tree of the opening stand within reach, or null. */
function clearTarget() {
  if (modalOpen() || clearing.opened) return null
  return clearing.targetNear(player.position)
}

function clearPromptText() {
  return inventory.coins >= CLEAR_COST
    ? `🪓 Clear this tree — 🪙${formatCoins(CLEAR_COST)}`
    : `🪓 Clearing costs 🪙${formatCoins(CLEAR_COST)}`
}

function fellTree() {
  if (!inventory.spend(CLEAR_COST)) {
    audio.play('error')
    hud.toast('Not enough coins to clear it', 'bad')
    return
  }
  clearing.cutNear(player.position)
}

/**
 * The level each building turns up at.
 *
 * The barn reuses the existing `animals` feature unlock so the building and the
 * panel it opens can never disagree — they were already both level 6, but only
 * the panel was gated, so a level-1 player could walk into a barn that sold
 * them nothing. The stall has no feature of its own: seeds are the whole game
 * from minute one, so its arrival *is* the unlock.
 */
const ARRIVAL_LEVEL = { shop: 2, lane: featureLevel('valley'), barn: featureLevel('animals') } as const

/**
 * Show whatever the player's level has earned.
 *
 * Called on restore and on every level-up rather than per frame — the set only
 * changes at those two moments, and toggling a group's visibility every frame
 * would dirty the scene graph for nothing.
 */
function applyArrivals() {
  // Rarity rolls stay off until the feature unlocks — see Farm.mutationsUnlocked.
  farm.mutationsUnlocked = progression.hasFeature('mutations')
  world.setArrivalVisible('shop', progression.level >= ARRIVAL_LEVEL.shop)
  world.setArrivalVisible('barn', progression.level >= ARRIVAL_LEVEL.barn)
  // The street arrives with the first neighbour to walk down it.
  world.setArrivalVisible('lane', progression.level >= ARRIVAL_LEVEL.lane)
  hood.setArrivedFor(progression.level)
}

function shopInRange() {
  // Not there yet: no prompt, no click target, no panel.
  if (!world.hasArrived('shop')) return false
  // Ground-plane distance only — the player's Y tracks the terrain and would
  // otherwise skew the range check.
  return Math.hypot(player.position.x - SHOP_POS.x, player.position.z - SHOP_POS.z) < SHOP_RANGE
}

function handleInput() {
  /*
   * F2 opens the UI editor. Imported dynamically and checked before the
   * modal-open early return below — the editor counts as a modal once open, so a
   * static check further down could turn it on but never off.
   *
   * `import.meta.env.DEV` lets Rollup drop the whole branch, and with it the only
   * reference to the editor's module graph, from a production build.
   */
  if (import.meta.env.DEV && Input.justPressed('F2')) {
    void import('./ui/layout/editor').then((m) => m.toggleUiEditor())
  }
  if (Input.justPressed('Escape')) {
    if (levelUpScreen.dismissFromKey()) return
    if (bagUi.open) bagUi.close()
    if (settingsUi.open) settingsUi.close()
    else if (almanacUi.open) almanacUi.close()
    else if (prestigeUi.open) prestigeUi.close()
    else if (shopUi.open) shopUi.close()
    else if (animalUi.open) animalUi.close()
    else if (plotUi.open) plotUi.close()
    else if (questUi.open) questUi.close()
    else if (neighbourUi.open) neighbourUi.close()
    else if (petUi.open) petUi.close()
    else if (placeMode !== 'none') setPlaceMode('none')

  }
  if (modalOpen()) return

  if (Input.justPressed('KeyQ')) engine.rotate(1)
  if (Input.justPressed('KeyR')) engine.rotate(-1)
  if (Input.justPressed('KeyB')) setPlaceMode(placeMode === 'shovel' ? 'none' : 'shovel')
  if (Input.justPressed('KeyV') && requireFeature('sprinkler')) {
    toggleSprinklerMode()
  }
  if (Input.justPressed('KeyH')) harvestEverything()
  if (Input.justPressed('KeyO')) settingsUi.toggle()
  if (Input.justPressed('KeyL') && requireFeature('almanac')) almanacUi.toggle()
  if (Input.justPressed('KeyY') && requireFeature('legacy')) prestigeUi.toggle()
  if (Input.justPressed('KeyC') && requireFeature('decor')) setPlaceMode(placeMode === 'decor' ? 'none' : 'decor')
  if (placeMode === 'decor') {
    const dir = Input.justPressed('BracketRight') ? 1 : Input.justPressed('BracketLeft') ? -1 : 0
    if (dir) {
      const usable = PLACEABLES.filter((p) => progression.level >= p.unlockLevel)
      const at = Math.max(0, usable.findIndex((p) => p.id === decorId))
      decorId = usable[(at + dir + usable.length) % usable.length].id
      const picked = PLACEABLE_BY_ID.get(decorId)!
      hud.toast(picked.emoji + ' ' + picked.name + ' · 🪙' + formatCoins(picked.price), 'info')
    }
  }
  if (Input.justPressed('KeyJ')) questUi.toggle()
  if (Input.justPressed('KeyI')) bagUi.toggle()
  if (Input.justPressed('KeyN') && requireFeature('valley')) neighbourUi.toggle()
  if (Input.justPressed('KeyP') && requireFeature('pets')) petUi.toggle()
  if (Input.justPressed('Backquote')) devUi.toggle()
  if (Input.justPressed('KeyM')) hud.toast(audio.toggleMute() ? '🔇 Muted' : '🔊 Sound on', 'info')
  if (Input.justPressed('KeyG')) {
    const next = postfx.quality === 'high' ? 'low' : postfx.quality === 'low' ? 'medium' : 'high'
    postfx.setQuality(next)
    hud.toast(`Graphics: ${next}`, 'info')
  }

  // Number keys index the *hotbar*, not the crop table — those diverge once
  // some crops are still locked.
  for (let slot = 0; slot < HOTBAR_SLOTS; slot++) {
    if (!Input.justPressed(`Digit${slot + 1}`)) continue
    const cropIndex = hud.cropForSlot(slot)
    if (cropIndex >= 0) inventory.select(cropIndex)
  }

  if (Input.justPressed('KeyE') || Input.justPressed('Space')) {
    const fellable = clearTarget()
    const tameable = tameTarget()
    if (fellable) fellTree()
    else if (shopInRange()) shopUi.show()
    else if (tameable) feedWildAnimal(tameable)
    else {
      const tile = farm.tileNear(player.position)
      // Same rule as clicking: the fence is a real boundary, so a plot within
      // arm's reach across it still needs the walk through the gate.
      if (tile?.placed && inPlayerPlot(player.position.x, player.position.z, 0.4)) plotUi.show(tile)
    }
  }
}

function setPlaceMode(mode: PlaceMode) {
  // Dropped the instant the mode is left, not on the next frame's update: the
  // click that leaves decor mode often opens a panel, and a green lamp post
  // hanging around behind it for a frame reads as a bug.
  if (mode !== 'decor') decorGhost.hide()
  placeMode = mode
  if (mode === 'none') farm.hideGhost()
  // The whole frontier lights up while the shovel is out, so choosing where to
  // grow is a look, not a sweep of the cursor.
  farm.showBuyableSpots(mode === 'shovel', player.position)
  player.setTool(mode === 'none' ? 'none' : 'shovel')
  hud.updateShovel(mode === 'shovel', farm.nextPlotCost)
  hud.updateSprinkler(mode === 'sprinkler', mode === 'sprinkler' ? SPRINKLER_BY_ID.get(sprinklerTier)! : null)
  hud.updateDecor(mode === 'decor')
}

/**
 * Arm the sprinkler, or disarm it.
 *
 * Shared by the V key and the dock button, because the check for having one in
 * the shed has to happen on both paths — arming with an empty shed leaves a mode
 * that swallows clicks and places nothing.
 */
function toggleSprinklerMode() {
  if (placeMode === 'sprinkler') {
    setPlaceMode('none')
    return
  }
  const tier = pickSprinklerTier()
  if (!tier) {
    hud.toast('No sprinklers in the shed — buy one at the shop', 'bad')
    return
  }
  sprinklerTier = tier
  setPlaceMode('sprinkler')
}

/**
 * The plot under the mouse pointer, or null.
 *
 * Tolerance is wider than half a tile because the ray lands on the ground while
 * a planted crop sits on a raised planter — picking at exactly half a tile makes
 * the plots feel like they have gaps between them.
 */
function hoveredPlot() {
  const hit = pickGround(engine, pointerX, pointerY)
  if (!hit) return null
  const tile = farm.tileNear(hit, TILE_SIZE * 0.75)
  return tile?.placed ? tile : null
}

/** Show the tool matching whatever the player is about to do. */
function updateHeldTool() {
  if (placeMode !== 'none') {
    player.setTool('shovel')
    return { tile: null, action: 'none' as const }
  }
  const tile = farm.tileNear(player.position)
  const action = farm.actionFor(tile)
  // A swing in progress owns the hands — re-deriving the tool mid-swing would
  // snatch the implement away on the frame it was drawn to be used.
  if (player.isActing) return { tile, action }
  if (action === 'plant') player.setTool('hoe')
  else if (action === 'water') player.setTool('can')
  else player.setTool('none')
  return { tile, action }
}

/**
 * Resolve the FTUE's pointer hint to a screen position each frame.
 *
 * World targets are projected through the live camera, so the finger sticks to
 * the plot or sprout as the camera moves. A target that projects off-screen
 * (the shop, from the garden) pins to the screen edge instead, with the finger
 * swung to point along the direction of travel — a guide that can point at
 * nothing it can't see is a guide that shrugs.
 */
const ftueProj = SPAWN.clone()
function updateFtuePointer() {
  const hint = ftue.pointerHint()
  if (!hint) {
    ftue.hidePointer()
    return
  }

  /*
   * The plot menu is part of the flow being taught — when it is open, the
   * finger moves onto the button the step is about ("Water", or "Plant")
   * rather than vanishing. Hiding here was the original behaviour, and it
   * dropped the guide at the exact moment of the final click. Every *other*
   * modal still hides the finger: pointing at the world through the shop is
   * noise.
   */
  if (plotUi.open) {
    const want = hint === 'crop' ? 'water' : hint === 'plot' ? 'plant' : null
    const label = want
      ? [...document.querySelectorAll('#plotMenu .plot-action .pa-label')].find((el) =>
          (el.textContent ?? '').toLowerCase().includes(want),
        )
      : null
    const button = label?.closest('.plot-action')
    if (button) {
      const r = button.getBoundingClientRect()
      // Anchor on the button's left edge so the finger doesn't cover the text.
      ftue.setPointer(r.left + 26, r.top - 2, 0)
    } else {
      ftue.hidePointer()
    }
    return
  }
  if (modalOpen()) {
    ftue.hidePointer()
    return
  }

  if (hint === 'plot') {
    const tile = farm.tiles.find((t) => t.placed && t.state === 'tilled' && !t.crop && !t.sprinkler)
    if (!tile) return ftue.hidePointer()
    ftueProj.copy(tile.pos)
    ftueProj.y += 0.4
  } else if (hint === 'crop') {
    const tile = farm.tiles.find((t) => t.crop)
    if (!tile) return ftue.hidePointer()
    ftueProj.copy(tile.pos)
    ftueProj.y += 1.0
  } else if (hint === 'seeds') {
    // The nearest crate still on the sand.
    const crate = beachSeeds.group.children[0]
    if (!crate) return ftue.hidePointer()
    ftueProj.copy(crate.position)
    ftueProj.y += 1.0
  } else if (hint === 'trees') {
    /*
     * The clearing, not a specific tree.
     *
     * Pointing at the nearest trunk is right once you are standing among them
     * and useless from the beach, where the four are a single distant clump and
     * the finger would jitter between them as the camera turns. The centre of
     * the plot is the thing the player is actually being sent to.
     */
    ftueProj.set(FARM_CENTRE.x, 3.2, FARM_CENTRE.z)
  } else {
    ftueProj.copy(SHOP_POS)
    ftueProj.y += 2.4
  }

  ftueProj.project(engine.camera)
  const behind = ftueProj.z > 1
  let nx = behind ? -ftueProj.x : ftueProj.x
  let ny = behind ? -ftueProj.y : ftueProj.y
  const off = behind || Math.abs(nx) > 0.95 || Math.abs(ny) > 0.9

  if (off) {
    // Clamp to a margin inside the edge and aim the finger outward.
    const scale = 0.88 / Math.max(Math.abs(nx), Math.abs(ny), 1e-4)
    nx *= scale
    ny *= scale
    const px = (nx * 0.5 + 0.5) * innerWidth
    const py = (-ny * 0.5 + 0.5) * innerHeight
    // Screen-space direction from centre out is where the target lies.
    const angle = Math.atan2(px - innerWidth / 2, -(py - innerHeight / 2))
    ftue.setPointer(px, py, angle)
  } else {
    ftue.setPointer((nx * 0.5 + 0.5) * innerWidth, (-ny * 0.5 + 0.5) * innerHeight, 0)
  }
}

// --- autosave ---------------------------------------------------------------
let saveTimer = 0
addEventListener('beforeunload', () => Save.save(farm, inventory, day, weather, progression, quests, pasture, hood, pets, stock, discovery, prestige, trading, requests, placeables))

// Rain tops up the soil on a slow tick rather than every frame.
let rainTimer = 0
let wasRaining = false
let wasBarnFull = false

/** The golden "this way" trail, shown while something has the player stuck. */
const guidePath = new GuidePath()
engine.scene.add(guidePath.group)

// Ghost preview follows the mouse while the shovel is out.
let pointerX = innerWidth / 2
let pointerY = innerHeight / 2
addEventListener('pointermove', (e) => {
  pointerX = e.clientX
  pointerY = e.clientY
})

// Frame stats for the dev readout. autoReset is off so the counters cover the
// whole composer frame — with it on, three wipes them after every internal
// pass and the readout only ever saw the final output quad.
engine.renderer.info.autoReset = false
let fpsEma = 60

const devUi = new DevUi({
  setHour: (h) => {
    day.time = (h / 24) * DAY_LENGTH
  },
  skipDay: () => {
    day.time += DAY_LENGTH
  },
  setWeather: (type) => weather.set(type as never),
  give: (kind, amount) => {
    if (kind === 'coins') inventory.coins += amount
    else grantXp(amount)
    hud.refresh()
  },
  levelUp: () => grantXp(progression.xpNeeded),
  setLevel: (level) => {
    /*
     * A jump, not a grant: XP-driven levelling would fire every reward and
     * level-up screen between here and there, which is exactly the noise a
     * "put me at level 12" button exists to skip. State is set directly and
     * the HUD surfaces are refreshed the same way a real level-up refreshes
     * them. Rewards (plots, seeds, coins) are deliberately NOT granted.
     */
    progression.level = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)))
    progression.xp = 0
    hud.rebuildHotbar(progression.level)
    hud.updateLevel(progression)
    hud.updateLocks((id) => progression.hasFeature(id), featureLevel)
    hud.toast(`Dev: level set to ${progression.level}`, 'info')
  },
  growAll: () => {
    for (const tile of farm.tiles) if (tile.crop) farm.instantGrow(tile, elapsed)
  },
  waterAll: () => farm.waterAll(),
  setQuality: (q) => {
    postfx.autoQuality = false
    postfx.setQuality(q)
  },
  teleport: (where) => {
    // Not SPAWN for the square — spawn moved inside the garden for the FTUE,
    // so the square teleport aims at the shop's patch of the market instead.
    const to = where === 'farm' ? FARM_CENTRE : where === 'barn' ? BARN_POS : SHOP_POS
    player.position.set(to.x, groundHeight(to.x, to.z), to.z)
    player.cancelMove()
    engine.focus.copy(player.position)
  },
  showTip: () => tips.forceShow('harvester'),
  restartFtue: () => {
    ftue.restart()
    hud.toast('Dev: FTUE restarted', 'info')
  },
  saveNow: () => {
    Save.save(farm, inventory, day, weather, progression, quests, pasture, hood, pets, stock, discovery, prestige, trading, requests, placeables)
    hud.toast('Dev: saved', 'info')
  },
  resetSave: () => {
    /*
     * Wipe and reload rather than tearing the running game down.
     *
     * A new game is not a state this session can reach by mutating what is
     * already loaded — the farm, the clearing, the crates and the FTUE all
     * carry one-way progress, and half-resetting them is exactly the sort of
     * inconsistent state a dev tool is supposed to help find, not create. The
     * reload is the only honest "new game" button.
     */
    Save.clear()
    forgetFtue()
    location.reload()
  },
  openClearing: () => {
    clearing.restoreOpened()
    farm.openClearing()
    world.setPlayerFenceVisible(true)
    hud.toast('Dev: clearing opened', 'info')
  },
  respawnCrates: () => {
    beachSeeds.respawn()
    hud.toast('Dev: crates back on the sand', 'info')
  },
  expandPlot: () => {
    if (farm.expandPlot()) hud.toast(`Dev: plot is now ${farm.plotSpan}x${farm.plotSpan}`, 'info')
    else hud.toast('Dev: plot is already at maximum', 'bad')
  },
  revealAll: () => {
    world.setArrivalVisible('shop', true)
    world.setArrivalVisible('barn', true)
    hood.setArrivedFor(99)
    hud.toast('Dev: everything revealed', 'info')
  },
  stats: () => ({
    fps: fpsEma,
    calls: engine.renderer.info.render.calls,
    tris: engine.renderer.info.render.triangles,
    quality: postfx.quality,
  }),
})

// Walk-dust state — see the puff block in the loop.
let prevPX = 0
let prevPZ = 0
let stepPuffTimer = 0

/** Below this the farmer is drifting or being nudged, not walking. */
const FOOTSTEP_MIN_SPEED = 0.9
const GRASS_STEPS = ['step-grass-1', 'step-grass-2'] as const
const DIRT_STEPS = ['step-dirt-1', 'step-dirt-2'] as const
let footstepTimer = 0
let footstepFlip = 0

/**
 * Deferred one-shot effects.
 *
 * A mass action resolves in a single frame, but showing it in a single frame is
 * a strobe. Queueing the visuals lets one press cascade — see the harvest wave,
 * which radiates outward from the farmer rather than flashing the whole field.
 */
const scheduled: { at: number; run: () => void }[] = []

function schedule(delay: number, run: () => void) {
  scheduled.push({ at: elapsed + delay, run })
}

function runScheduled() {
  for (let i = scheduled.length - 1; i >= 0; i--) {
    if (scheduled[i].at > elapsed) continue
    const entry = scheduled[i]
    scheduled.splice(i, 1)
    entry.run()
  }
}

// --- loop -------------------------------------------------------------------
function frame() {
  requestAnimationFrame(frame)

  const dt = engine.tick()
  elapsed += dt
  const petBonuses = pets.bonuses()

  handleInput()

  player.update(dt, engine, world.obstacles, world.walls, modalOpen())

  // Dust kicked up by a moving farmer. Speed is measured from actual
  // displacement rather than input, so sliding along a fence — moving slowly
  // whatever the stick says — puffs accordingly.
  {
    const speed = Math.hypot(player.position.x - prevPX, player.position.z - prevPZ) / Math.max(dt, 1e-4)
    prevPX = player.position.x
    prevPZ = player.position.z

    /*
     * Footsteps, on the same measured speed as the dust but a lower threshold.
     *
     * Dust only makes sense at a run; steps happen whenever the farmer is
     * actually moving, which is most of the game — so they are quiet, alternate
     * between two samples and vary in pitch. A single sample at a fixed pitch,
     * three times a second, for an hour, is the definition of a sound the player
     * ends up muting the game over.
     *
     * The surface comes from the tile underfoot rather than from the terrain
     * texture: a plot is the only worked ground in the valley, and it is the one
     * place where the difference is audible.
     */
    if (speed > FOOTSTEP_MIN_SPEED) {
      footstepTimer -= dt
      if (footstepTimer <= 0) {
        // Cadence tightens with pace, floored so a sprint is not a machine gun.
        footstepTimer = Math.max(0.25, 0.6 - speed * 0.07)
        footstepFlip ^= 1
        const onSoil = farm.tileNear(player.position, TILE_SIZE * 0.55)?.placed ?? false
        audio.play((onSoil ? DIRT_STEPS : GRASS_STEPS)[footstepFlip], {
          gain: 0.22,
          rate: 0.92 + Math.random() * 0.18,
        })
      }
    } else {
      footstepTimer = 0
    }

    if (speed > 2.2) {
      stepPuffTimer -= dt
      if (stepPuffTimer <= 0) {
        // Cadence tracks pace, so running visibly kicks more dust than walking.
        stepPuffTimer = 0.34 - Math.min(0.14, speed * 0.02)
        bursts.emit(player.position, 2, [0xd9c9a8, 0xc7ad85], {
          kind: 'puff',
          speed: 0.55,
          life: 0.6,
          scale: 0.13,
          jitter: 0.18,
        })
      }
    } else {
      stepPuffTimer = 0
    }
  }

  // Camera trails the player slightly rather than locking to them — a rigid
  // lock makes the whole world appear to jitter when walking.
  if (arrivalTimer > 0) {
    arrivalTimer -= dt
    // Faster pull than the walk-follow: this should read as a cut to the
    // treeline, not as the camera wandering off.
    engine.focus.lerp(arrivalAt, Math.min(1, dt * 3.2))
    engine.pitch += (0.52 - engine.pitch) * Math.min(1, dt * 4)
    const yawDiff = ((arrivalYaw - engine.targetYaw + Math.PI) % (Math.PI * 2)) - Math.PI
    engine.targetYaw += (yawDiff < -Math.PI ? yawDiff + Math.PI * 2 : yawDiff) * Math.min(1, dt * 3.5)
    if (arrivalTimer <= 0) {
      document.body.classList.remove('cinematic')
      // A hard cut home. Cuts are cinematic language; a slow lerp back is just
      // seasickness.
      engine.pitch = arrivalPrevPitch
      engine.targetYaw = arrivalPrevYaw
      engine.yaw = arrivalPrevYaw
    }
  } else {
    engine.focus.lerp(player.position, Math.min(1, dt * 6))
  }
  engine.focus.add(shake.update(dt, elapsed))
  engine.update(dt)

  // Season, pets and legacy upgrades all bend the same two numbers.
  const season = seasonForDay(day.day)
  const legacy = prestige.bonuses()

  farm.update(
    dt,
    elapsed,
    { weather: weather.current.type, hour: day.hour },
    progression.luck + petBonuses.luck + legacy.luck,
    (_crop, mutation) =>
      hud.toast(
        `${mutationIconHtml(mutation.id, mutation.emoji, 'mut-ico')} ${mutation.name} mutation!`,
        'good',
      ),
    petBonuses.growth + legacy.growth,
    // Per-tile: is a hive in range, and does this season suit the crop?
    (tile) => placeables.isPollinated(tile.pos.x, tile.pos.z),
    (crop) => growthMultiplier(season, crop),
  )
  // Fed the live fog plane so the tufts always fade out ahead of the haze —
  // see updateGrass.
  {
    // `Fog` has a near plane; `FogExp2` does not, and the scene's type is the
    // union of both. Narrowed rather than cast so swapping fog models later is
    // a compile error rather than an undefined.
    const fog = engine.scene.fog
    updateGrass(elapsed, fog && 'near' in fog ? fog.near : undefined)
  }
  pasture.update(dt, elapsed, engine.camera)
  wildlife.update(dt, elapsed, player.position)
  beachSeeds.update(dt, elapsed, player.position)
  placeables.update(dt, elapsed, farm)
  pets.update(dt, elapsed, player.position, () => {
    // A pet watering something should feel like a small gift, not a silent stat.
    const dry = farm.tiles.find((t) => t.state === 'tilled' && t.water <= 0)
    if (dry && farm.water(dry)) popups.spawn('💧', dry.pos, 'good', 1)
  })
  petUi.tick()
  // Cheap enough to run per frame: a filter over at most a handful of eggs, and
  // the setter itself is a no-op when the flag has not changed.
  hud.setPetAlert(pets.readyEggs.length > 0)
  hood.update(dt, elapsed, player.position, engine.camera)

  // Requests run on a real clock, so a deadline passes whether or not the
  // player ever opened the valley panel.
  for (const lapsed of requests.update(dt)) {
    const who = hood.all.find((n) => n.profile.id === lapsed.neighbourId)
    hud.toast(`${who?.profile.name ?? 'A neighbour'} sorted it out themselves`, 'bad')
    who?.setNeedsAttention(false)
  }

  // Walking onto a neighbour's farm greets them, once a day each. Proximity
  // rather than a button: the reward is for making the trip.
  const host = hood.nearest(player.position, 6)
  if (host) {
    const greeting = host.greet(day.day)
    if (greeting) {
      inventory.coins += greeting.coins
      if (greeting.seedId) inventory.giveSeed(greeting.seedId, 1)
      popups.spawn(`+${greeting.coins}`, host.centre, 'good', 1)
      hud.toast(
        `${host.profile.name} says hello — 🪙${formatCoins(greeting.coins)}${
          greeting.seedId ? ` and a ${greeting.seedId} seed` : ''
        }`,
        'good',
      )
      audio.play('coin')
      neighbourUi.refresh()
    }
  }
  ambience.update(dt, elapsed, engine, weather, day.hour)
  runScheduled()
  // Manual because autoReset is off (see the dev panel block). Reset *before*
  // the frame's renders so the counters cover exactly one frame.
  engine.renderer.info.reset()
  fpsEma += (1 / Math.max(dt, 1e-4) - fpsEma) * 0.05
  devUi.tick()
  bursts.update(dt, elapsed)
  doobers.update(dt, player.position)
  popups.update(dt)
  plotUi.refresh()
  neighbourPlotUi.refresh()
  neighbourUi.tick()

  if (day.update(dt, engine)) {
    hud.toast(`☀️ Day ${day.day} begins`, 'good')
    // A new day rolls a fresh set of challenges.
    quests.rollDailies(day.day, progression.level)
    trading.refresh(
      day.day,
      progression.level,
      hood.all.map((n) => ({ id: n.profile.id, favourite: n.profile.favourite, friendship: n.friendship })),
    )
    postRequests(true)
    hud.toast(seasonForDay(day.day).emoji + ' ' + seasonForDay(day.day).name + ' day ' + dayWithinSeason(day.day), 'info')
  }
  // Weather multiplies the day cycle's lighting, so it must run after it.
  weather.update(dt, engine)

  if (weather.isRaining) {
    if (!wasRaining) hud.toast(`${weather.label} — your crops are being watered`, 'good')
    rainTimer += dt
    if (rainTimer > 2) {
      rainTimer = 0
      farm.waterAll()
    }
  }
  if (weather.isRaining !== wasRaining) audio.setRaining(weather.isRaining)
  wasRaining = weather.isRaining

  /*
   * A full barn stops every harvest on the farm, and the only fix is selling at
   * the stall — so while it is full, the stall's marker becomes a beacon visible
   * from anywhere instead of a proximity prompt. The toast says what to do; this
   * says where.
   *
   * Polled rather than pushed for the same reason the coin objectives are:
   * produce enters the barn from harvests, the scythe, pets and neighbour
   * trades, and watching the one piece of state beats threading a callback
   * through all of them.
   */
  if (inventory.storageFull !== wasBarnFull) {
    wasBarnFull = inventory.storageFull
    world.shopMarkers.setUrgent('shop', wasBarnFull)
    guidePath.setTarget(wasBarnFull ? SHOP_POS : null)
  }
  guidePath.update(dt, player.position)

  // Grade toward the night look across dusk rather than snapping at a threshold.
  const h = day.hour
  const nightAmount = h < 5 || h > 21 ? 1 : h < 7 ? (7 - h) / 2 : h > 19 ? (h - 19) / 2 : 0
  postfx.setNightAmount(Math.min(1, Math.max(0, nightAmount)))

  if (stock.update(dt, progression.level)) {
    hud.toast('🚚 The seed shop just restocked', 'good')
    audio.play('pop')
  }
  shopUi.tick()

  // Global events announce once, loudly.
  if (weather.pendingAnnounce) {
    const ev = weather.pendingAnnounce
    weather.pendingAnnounce = null
    hud.eventBanner(ev.type, ev.emoji, ev.name)
    hud.toast(ev.emoji + ' ' + ev.name + ' has begun — plant now for rare mutations!', 'good')
    audio.play('epic')
    shake.add(0.8)
  }

  audio.setHour(day.hour)
  audio.update()

  hud.updateClock(day)
  hud.updateWeather(weather)
  hud.updateSeason(season, dayWithinSeason(day.day), DAYS_PER_SEASON)
  quests.setLive(farm.placedCount, inventory.coins, progression.level)
  hud.setPanelOpen(panelOpen())

  // Prompts, highlight and the shovel's ghost preview.
  const { tile, action } = updateHeldTool()

  /*
   * One place decides whether the decor preview exists at all.
   *
   * It used to be hidden inside the branches that happened to be thought of,
   * which left the one branch that matters — ordinary play, no mode, no modal —
   * without a hide. Leaving decor mode therefore left the last green ghost
   * standing in the world until the mode was entered again.
   */
  if (placeMode !== 'decor') decorGhost.hide()

  if (placeMode === 'decor') {
    /*
     * Decor is placed freely rather than on the grid, so its preview is the
     * model itself standing at the cursor — not the tile quad the shovel and
     * the sprinkler use. It also faces the way it would be built, which is the
     * only way to tell before buying whether a bench will face the lane.
     */
    const hit = modalOpen() ? null : pickGround(engine, pointerX, pointerY)
    const def = PLACEABLE_BY_ID.get(decorId)
    if (hit && def) {
      const rotation = Math.atan2(hit.x - player.position.x, hit.z - player.position.z) + Math.PI
      const valid =
        placeables.canPlace(def, hit.x, hit.z) &&
        progression.level >= def.unlockLevel &&
        inventory.coins >= def.price
      decorGhost.show(def, hit.x, hit.z, rotation, valid)
    } else {
      decorGhost.hide()
    }
    farm.setGhost(null, false)
    farm.setHighlight(null, 'none')
    hud.clearPrompt()
  } else if (placeMode !== 'none') {
    const hit = modalOpen() ? null : pickGround(engine, pointerX, pointerY)
    const ghostTile = hit ? farm.tileNear(hit, TILE_SIZE * 0.8) : null
    const valid =
      placeMode === 'shovel'
        ? farm.canPlace(ghostTile) && inventory.coins >= farm.nextPlotCost
        : farm.canPlaceSprinkler(ghostTile)
    farm.setGhost(ghostTile && (placeMode === 'shovel' ? farm.canPlace(ghostTile) : true) ? ghostTile : null, valid)
    farm.setHighlight(null, 'none')
    hud.clearPrompt()
  } else if (modalOpen()) {
    hud.clearPrompt()
    farm.setHighlight(null, 'none')
  } else {
    const fellable = clearTarget()
    const tameable = tameTarget()
    if (fellable) hud.setPrompt('tame', clearPromptText())
    else if (shopInRange()) hud.setPrompt('shop')
    else if (tameable) hud.setPrompt('tame', tamePromptText(tameable))
    else if (tile?.placed) hud.setPrompt('menu')
    else hud.clearPrompt()

    /*
     * The cursor wins over proximity.
     *
     * `tile` is whatever the player is standing next to — that is the tile `E`
     * acts on. But a click acts on whatever is under the pointer, so while the
     * cursor is over a plot the ring has to follow the cursor or it points at the
     * wrong plot at the exact moment the player is aiming.
     */
    const hovered = hoveredPlot()
    if (hovered) farm.setHighlight(hovered, farm.actionFor(hovered), true)
    else farm.setHighlight(tile, action)
  }

  keepFtuePossible()

  // Onboarding reads real game state, so a tip only fires when the player is
  // genuinely in the situation it describes.
  ftue.update({
    plantedCount: farm.tiles.filter((t) => t.crop).length,
    wateredCount: farm.tiles.filter((t) => t.water > 0).length,
    nearShop: shopInRange(),
    seedsBought: inventory.purchases,
    cratesLeft: beachSeeds.remaining,
    treesLeft: clearing.remaining,
    hasFarm: farm.plotSpan > 0,
  })
  updateFtuePointer()
  tips.enabled = settingsUi.settings.showTips && !ftue.active
  tips.update(dt, {
    level: progression.level,
    coins: inventory.coins,
    plots: farm.placedCount,
    tilledCount: farm.tiles.filter((t) => t.state === 'tilled').length,
    plantedCount: farm.tiles.filter((t) => t.crop).length,
    ripeCount: farm.ripeTiles.length,
    ripeAtOnce: farm.ripeTiles.length,
    seedsHeld: [...inventory.seeds.values()].reduce((a, b) => a + b, 0),
    produceStacks: inventory.produce.size,
    hasHarvested: inventory.produce.size > 0,
    hasMutation: [...inventory.produce.values()].some((s) => s.mutations.length > 0),
    nearShop: shopInRange(),
    isRaining: weather.isRaining,
    petCount: pets.owned.length,
    hasHarvester: inventory.hasTool('harvester'),
  })

  saveTimer += dt
  if (saveTimer > 10) {
    saveTimer = 0
    Save.save(farm, inventory, day, weather, progression, quests, pasture, hood, pets, stock, discovery, prestige, trading, requests, placeables)
  }

  // Water renders its reflection and refraction buffers first — both need the
  // scene in its final state for this frame, and neither may include the water.
  world.skyline.update(dt)
  skybox.follow(engine.camera)
  world.homeMarker.update(elapsed, engine.camera)
  world.lanterns.update(player.position)
  world.shopMarkers.update(elapsed, engine.camera, player.position)
  world.shopkeeper.update(dt, player.position)
  world.farmgirl.update(dt, player.position)
  world.water.update(engine.renderer, engine.scene, engine.camera, elapsed, engine.sun)

  // Step quality down if the frame budget is consistently blown.
  const dropped = postfx.autoAdjust(dt)
  if (dropped) hud.toast(`Graphics lowered to ${dropped} for smoother play (G to change)`, 'info')

  engine.render()
  Input.endFrame()
}

/*
 * The village catches up with the player's level before the first frame.
 *
 * After the restore, not inside it: a new game has no save to restore from and
 * still needs the empty-coast state applied, and a loaded one needs the stall
 * and neighbours it has already earned standing there when the screen fades in
 * rather than arriving a level later.
 */
applyArrivals()

window.__loading?.(1)
frame()

// Dev-only inspection handle. Vite folds import.meta.env.DEV to false in a
// production build, so this whole block is dropped by tree-shaking.
if (import.meta.env.DEV) {
  const dev = window as unknown as Record<string, unknown>
  dev.game = {
    engine, world, farm, player, inventory, day, weather, progression, quests, pasture, plotUi, shopUi, questUi, animalUi, postfx, ambience, bursts, popups, hood, neighbourUi, neighbourPlotUi, pets, petUi, stock, audio, settingsUi, tips, ftue, hud, catchUp, discovery, prestige, trading, requests, placeables, decorGhost, almanacUi, prestigeUi, doobers, levelUpScreen, guidePath, wildlife, clearing, beachSeeds,
  }

  /**
   * Park the camera somewhere, render one frame, and hand back a JPEG data URL.
   *
   * For art-direction work from a headless/hidden window, where the page is not
   * compositing and so cannot be screenshotted from outside. Everything the game
   * loop would normally drive has to be driven by hand: the loop overwrites
   * `focus` and the camera transform every frame, and distance-gated detail —
   * neighbour crops especially — is only built when the neighbourhood is ticked.
   */
  dev.__cap = (opts: Record<string, number> = {}) => {
    const { x, z, yaw = Math.PI, pitch = 0.5, dist = 16, hour = 12, w = 1000, h = 560 } = opts
    if (x !== undefined) player.position.set(x, 0, z ?? 0)
    engine.yaw = yaw
    engine.targetYaw = yaw
    engine.pitch = pitch
    engine.distance = dist
    day.time = (hour / 24) * DAY_LENGTH
    day.apply(engine)
    postfx.setNightAmount(day.isNight ? 1 : 0)

    // Settle: the camera eases toward its target and the LOD needs a few ticks.
    for (let i = 0; i < 40; i++) {
      engine.focus.copy(player.position)
      hood.update(0.016, i * 0.016, player.position)
      engine.update(0.05)
    }

    // The water's reflection and refraction buffers are rendered from the main
    // camera, so they have to be refreshed *after* it has been placed. Doing it
    // before shows the previous viewpoint's reflection, which made the lakes
    // look far darker in captures than they do in the running game.
    for (let i = 0; i < 3; i++) {
      world.water.update(engine.renderer, engine.scene, engine.camera, i * 0.05, engine.sun)
    }
    engine.render()

    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(engine.renderer.domElement, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.88)
  }

  /**
   * Fill the player's owned plots with crops, ripened, to inspect the art.
   * Pass a crop id for a single species, or nothing for one of each in turn.
   */
  dev.__plant = (cropId?: string) => {
    let n = 0
    for (const tile of farm.tiles) {
      if (!tile.placed || tile.sprinkler) continue
      if (tile.state !== 'tilled') farm.till(tile)
      const id = cropId ?? CROPS[n % CROPS.length].id
      if (farm.plant(tile, id, 1, elapsed)) {
        farm.instantGrow(tile, performance.now() / 1000)
        n++
      }
    }
    return `planted ${n}`
  }

  /*
   * `?uiedit` opens the UI editor at boot, optionally on a given selector
   * (`?uiedit=%23hotbar`). Mirrors how `?dev` opens the dev panel, and is the
   * only way in for a headless capture, which cannot press a key.
   */
  const uiedit = new URLSearchParams(location.search).get('uiedit')
  if (uiedit !== null) {
    void import('./ui/layout/editor').then((m) => m.toggleUiEditor(uiedit || undefined))
  }
}

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  if (m < 1) return `${Math.round(seconds)}s`
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}
