import * as THREE from 'three'
import { createMailboxModel, type Mailbox } from '../assets/cottage'
import { createCropModel } from '../assets/crops'
import { rng, MINOR_LAYER, setLayer } from '../assets/style'
import { bakeGroup } from '../assets/bake'
import { CROPS, GROWTH_STAGES, stageForProgress, growSecondsFor, type CropDef } from './crops'
import { rollRarity, RARITY_BY_ID, produceLabel, produceValue, type RarityId } from './mutations'
import { TILE_SIZE, plotTrayPlacement, soilSurfaceY } from './farm'
import { createAlertMarker } from '../assets/alert-marker'
import {
  getModels,
  instanceModel,
  modelGroup,
  fitToHeight,
  cloneFarmer,
  PROP_HEIGHT,
  type FarmerModel,
  type PropPlacement,
} from '../assets/models'
import {
  NEIGHBOUR_SLOTS,
  SPAWN,
  PLOT_HX,
  PLOT_HZ,
  GATE_WIDTH,
  approachPos,
  FENCE_MARGIN,
  type FarmSlot,
} from './village'
import { isSand } from './terrain'
import { buildPlotFence, type Obstacle, type Wall } from './world'

/**
 * Simulated neighbours.
 *
 * Five other farmers share the street, each with a real plot whose crops grow
 * on the same timers the player's do. They are not networked — but every
 * interaction goes through this class, so swapping in a real backend later
 * means reimplementing `Neighbourhood` rather than touching the world, UI or
 * game loop.
 *
 * The point of them is social pull: a neighbour with dry crops is free XP, a
 * neighbour with a raised mailbox flag has a gift, and their rarest find sits
 * on a leaderboard next to yours. Putting all six farms on one lane is what
 * makes that pull constant rather than occasional — every neighbour is a short
 * walk away, and you can see their crops from your own gate.
 */

/**
 * Tilled patch inside the fenced plot: PLOT_W deep, PLOT_H along the lane.
 *
 * The bed is sized to fill most of the plot, because a big fence around a small
 * bed reads as an empty lawn. Only PLANTED_FRACTION of those tiles actually
 * carry a crop though — the soil is baked into the static mesh and costs
 * nothing, whereas every crop is a live model. Bare tilled rows between planted
 * ones look like a working farm rather than a shortfall.
 */
const PLOT_W = 6
const PLOT_H = 8
const PLANTED_FRACTION = 0.55
const TILE = TILE_SIZE

/**
 * Authored props gathered across all five farms and drawn as one batch each.
 *
 * These are textured models, so they cannot go into a neighbour's baked
 * vertex-coloured static mesh — baking flattens material colour into vertex
 * colours and drops the UVs a texture needs.
 */
interface NeighbourBatches {
  fences: PropPlacement[]
  trays: PropPlacement[]
  /**
   * Which garden tier each tray belongs to, aligned with `trays`.
   *
   * A neighbour's beds arrive a tier at a time as their farm grows, so the tray
   * batch cannot simply be sliced at the last arrival the way the fences and
   * cottages are — it has to be filtered. Kept as a parallel array rather than
   * a field on the placement because `PropPlacement` is the instancer's own
   * shape and has no room for game state.
   */
  trayTier: number[]
  /** Which neighbour each tray belongs to, aligned with `trays`. */
  trayOwner: number[]
  benches: PropPlacement[]
  cottages: PropPlacement[]
  scarecrows: PropPlacement[]
  flowerBeds: PropPlacement[]
  bushes: PropPlacement[]
}

const WHITE = new THREE.Color(0xffffff)

/** Mix a colour towards white. Instance tints multiply the baseColour texture,
 *  so they have to be pale or the model's own detail disappears under them. */
function washToward(hex: number, amount: number) {
  return new THREE.Color(hex).lerp(WHITE, amount).getHex()
}

/**
 * Crop detail is graded by distance — see `setViewer`.
 *
 * Six farms on one street means several neighbours are in view at once, so a
 * single on/off range would either pop crops in and out as you walk the lane or
 * leave a hundred crop models resident. Instead: every plot inside CLOSE_RANGE,
 * every *other* plot out to DETAIL_RANGE, nothing beyond.
 */
/**
 * The arrival walk.
 *
 * A new neighbour comes ashore where the player did and walks to their plot,
 * because that is the story the opening already tells — everyone here arrived
 * by sea with nothing. Thirty seconds is long enough to notice and short enough
 * that nobody is waiting on it: the player keeps playing throughout.
 */
const ARRIVAL_FROM = SPAWN
const ARRIVAL_WALK_SECONDS = 30
/** How long the wood on a newly-claimed plot takes to come down. */
const WOOD_FELL_SECONDS = 1.2

const CLOSE_RANGE = 18
const DETAIL_RANGE = 32

/** Cottage, fence and mailbox stay drawn this far out. */
const BUILDING_RANGE = 110

/**
 * Beyond this, a villager's skinning pose is frozen.
 *
 * The mixer poses 24 bones and re-uploads the skin every frame whether or not
 * anyone can resolve the result. At thirty-plus units a villager is a few
 * dozen pixels tall — the *walk* still has to advance (the inspect panel reads
 * positions), but nobody can tell a mid-stride freeze from
 * a stride, so the pose stops paying rent. Five villagers, most of them
 * usually far, makes this a per-frame win for free.
 */
const ANIMATE_RANGE = 34

/**
 * Ground speed the walk clip's stride is authored for.
 *
 * The wander plays it at 0.62 while moving at 1.7 units a second and the feet
 * hold the ground, so one is the other divided by it. Named rather than
 * repeated, because anything else that plays this clip has to scale off the
 * same number or it skates.
 */
const WALK_CLIP_SPEED = 1.7 / 0.62

export interface NeighbourProfile {
  id: string
  name: string
  blurb: string
  wallColor: number
  roofColor: number
  shirt: number
  hair: number
  /** Crop they plant most often. */
  favourite: string
  level: number
}

const PROFILES: NeighbourProfile[] = [
  {
    id: 'pippa', name: 'Pippa', blurb: 'Swears by turnips. Will not be argued with.',
    wallColor: 0xf2e2c4, roofColor: 0xc4483c, shirt: 0xe0655c, hair: 0x8a4a2a,
    favourite: 'turnip', level: 4,
  },
  {
    id: 'bramble', name: 'Bramble', blurb: 'Grows berries, eats most of them.',
    wallColor: 0xe4dcc8, roofColor: 0x4a7a8c, shirt: 0x5c9ce0, hair: 0x2f2b26,
    favourite: 'strawberry', level: 7,
  },
  {
    id: 'juniper', name: 'Juniper', blurb: 'Corn. Rows and rows of corn.',
    wallColor: 0xf0e8d0, roofColor: 0x6b8f4a, shirt: 0x7ac45c, hair: 0xd8a53f,
    favourite: 'corn', level: 10,
  },
  {
    id: 'marlow', name: 'Marlow', blurb: 'Claims to have grown a rainbow melon once.',
    wallColor: 0xe8dcd4, roofColor: 0x8a5a9c, shirt: 0xa06ff2, hair: 0x4a3a5a,
    favourite: 'melon', level: 13,
  },
  {
    id: 'odette', name: 'Odette', blurb: 'Only dragonfruit. Nothing else is worth the soil.',
    wallColor: 0xf4e0e8, roofColor: 0xc44a7a, shirt: 0xe8459b, hair: 0x2f2b26,
    favourite: 'dragonfruit', level: 17,
  },
]

/**
 * One of a neighbour's planted tiles.
 *
 * Exported as a type only — the UI holds a reference to inspect and act on a
 * specific plot, but every mutation goes through a method on Neighbour so
 * friendship and the mailbox flag cannot be bypassed.
 */
export interface NeighbourPlot {
  def: CropDef
  rarity: RarityId
  progress: number
  stage: number
  /** Dry plots are the ones the player can help with. */
  watered: boolean
  seed: number
  model: THREE.Group | null
  pos: THREE.Vector3
  /** Checkerboard flag — the half of the bed that survives at mid detail. */
  checker: boolean
  /** Garden tier this bed belongs to. Crops wait until the tier is broken. */
  tier: number
}

/** Friendship milestones and what they pay out. */
const GIFT_TIERS = [
  { at: 25, coins: 250, seeds: 3 },
  { at: 50, coins: 900, seeds: 5 },
  { at: 75, coins: 3000, seeds: 6 },
  { at: 100, coins: 12000, seeds: 8 },
]

export class Neighbour {
  readonly group = new THREE.Group()
  readonly centre: THREE.Vector3
  /** Where the player lands when they fast-travel here. */
  readonly gate: THREE.Vector3

  friendship = 0
  /** Milestones already paid out. */
  private claimedTiers = 0
  /** Day of the last visit greeting, so it pays once a day. -1 is never. */
  private lastVisitDay = -1

  /** Their best-ever find, for the leaderboard. */
  bestFind = { label: 'nothing yet', value: 0 }

  readonly plots: NeighbourPlot[] = []
  /** Shown while this neighbour has an open request. */
  private readonly requestMarker: THREE.Group
  private readonly markerY: number
  private readonly farmer: FarmerModel
  private readonly mixer: THREE.AnimationMixer
  private readonly npcIdleAction: THREE.AnimationAction | null
  private readonly npcWalkAction: THREE.AnimationAction | null
  private npcCurrent: THREE.AnimationAction | null = null
  private readonly mailbox: Mailbox
  private readonly cropRoot = new THREE.Group()

  /** 0 = no crops built, 1 = every other plot, 2 = all of them. */
  private detailLevel = 0

  /** True while Neighbourhood is walking this villager in from the beach. */
  walkingIn = false

  /**
   * How far their garden has grown: 1 on the day they move in, up to 3.
   *
   * They start with a patch the size of the player's first clearing and work
   * outward, for the same reason the player does — a neighbour who arrives with
   * a finished farm has nothing left to show you, and the street stops changing
   * the moment everyone is in. Driven from the player's level by
   * Neighbourhood.setGardenLevels.
   */
  gardenLevel = 1

  /** Put the villager somewhere and turn them to face their heading. */
  placeNpc(x: number, z: number, facing: number) {
    // How far they were moved, so the walk clip can be played at the pace they
    // are actually travelling rather than at a guess — see update().
    this.npcStep = Math.hypot(x - this.npcPos.x, z - this.npcPos.y)
    this.npcPos.set(x, z)
    this.npcFacing = facing
    this.farmer.root.position.set(x, 0, z)
    this.farmer.root.rotation.y = facing
  }

  /** Settle them into their own plot once the walk is over. */
  settleNpc() {
    this.walkingIn = false
    this.npcTarget = this.pickNpcTarget()
  }

  // NPC wander state.
  private npcPos: THREE.Vector2
  private npcTarget: THREE.Vector2
  private npcFacing = 0
  private npcIdle = 0
  /** Distance the last placeNpc moved them, for the walk-in's stride pacing. */
  private npcStep = 0

  constructor(
    readonly profile: NeighbourProfile,
    readonly slot: FarmSlot,
    obstacles: Obstacle[],
    walls: Wall[],
    /** Shared batches, drawn once for the whole neighbourhood. */
    batches: NeighbourBatches,
    /** Position in the arrival order — the batches tag their trays with it. */
    readonly index: number,
  ) {
    this.centre = new THREE.Vector3(slot.x, 0, slot.z)
    this.gate = approachPos(slot)

    const r = rng(hashString(profile.id))
    // Which way the lane lies. Every asymmetric piece below is mirrored by this
    // rather than rotated, so the tile grid stays axis-aligned on both verges.
    const inward = slot.inward

    /*
     * Plot-local coordinates, because a plot no longer knows which way it faces.
     *
     * `deep` runs away from the lane — the cottage is deep, the crops are
     * shallow — and `across` runs along the frontage. Written this way the whole
     * yard below is a description of a farm rather than of a farm *on a
     * north–south street*: a plot that fronts the lane along Z lays itself out
     * identically, and none of the offsets have to be touched to say so.
     */
    const at = (deep: number, across: number) =>
      slot.axis === 'x'
        ? { x: slot.x - inward * deep, z: slot.z + across }
        : { x: slot.x + across, z: slot.z - inward * deep }
    /** Rotation that turns a +Z-facing model to look at the lane. */
    const facingLane = slot.axis === 'x' ? inward * (Math.PI / 2) : inward === 1 ? 0 : Math.PI
    /** Half-extents in plot-local terms. Square plots, but named for clarity. */
    const DEEP_HALF = slot.axis === 'x' ? PLOT_HX : PLOT_HZ
    const ACROSS_HALF = slot.axis === 'x' ? PLOT_HZ : PLOT_HX

    /**
     * Everything static on this farm is collected here and baked into a single
     * mesh at the end of construction. A cottage is ~25 meshes and a ring of
     * fence another ~80; left separate, five neighbours would add several
     * hundred draw calls for geometry that never moves.
     */
    const statics = new THREE.Group()

    // --- cottage ----------------------------------------------------------
    // At the back of the strip, turned to face the lane so the street is lined
    // with front doors rather than gable ends.
    //
    // One authored model for all five, tinted per neighbour. Their wall colour is
    // part of how you tell them apart — it is on their card in the valley UI too
    // — so it is washed most of the way to white and used as an instance tint
    // rather than being dropped. Applied at full strength it would swamp the
    // model's own texture.
    const cottage = at(DEEP_HALF - 3.0, -2.4)
    const cottageX = cottage.x
    const cottageZ = cottage.z
    const cottageFit = fitToHeight(getModels().cottage, PROP_HEIGHT.cottage)
    batches.cottages.push({
      x: cottageX,
      y: cottageFit.groundY,
      z: cottageZ,
      rotationY: facingLane + 0.18,
      scale: cottageFit.scale,
      color: washToward(profile.wallColor, 0.72),
    })
    obstacles.push({ x: cottageX, z: cottageZ, r: 2.0 })

    // --- mailbox ----------------------------------------------------------
    // On the verge beside the gate, so its raised flag is readable from the lane.
    this.mailbox = createMailboxModel(profile.roofColor)
    // Just outside the gate and clear of the opening, in plot-local terms.
    const post = at(-(DEEP_HALF + FENCE_MARGIN + 0.8), GATE_WIDTH / 2 + 0.9)
    this.mailbox.object.position.set(post.x, 0, post.z)
    this.group.add(this.mailbox.object)

    // Request marker, parked over the cottage roof and hidden until they ask
    // for something. The same object the shop uses, so an exclamation mark
    // means one thing across the whole game.
    this.markerY = PROP_HEIGHT.cottage + 0.9
    this.requestMarker = createAlertMarker(1.5)
    this.requestMarker.position.set(cottageX, this.markerY, cottageZ)
    this.requestMarker.visible = false
    this.group.add(this.requestMarker)

    // --- plot -------------------------------------------------------------
    // The tilled patch sits towards the lane end of the strip, so their crops
    // are the part of their farm you see from the street.
    /*
     * Laid out plot-local, like everything else on the farm.
     *
     * PLOT_W is the patch's depth and PLOT_H its frontage — six by eight — and
     * spreading those on world X and Z was right only while every plot faced
     * along X. For a plot that fronts the lane across Z the block came out
     * turned a quarter, so its long side ran the *deep* way: eight tiles plus
     * the offset toward the gate reached 7.4 units from the middle against a
     * fence half of 6.7, and the last row of beds stood outside the rails.
     */
    /** Middle of the tilled patch, in world XZ — the villager idles beside it. */
    const bedCentre = at(-2.6, 0.4)

    for (let gz = 0; gz < PLOT_H; gz++) {
      for (let gx = 0; gx < PLOT_W; gx++) {
        const local = at(-2.6 + (gx - (PLOT_W - 1) / 2) * TILE, 0.4 + (gz - (PLOT_H - 1) / 2) * TILE)
        const pos = new THREE.Vector3(local.x, 0, local.z)

        /*
         * Which tier of the garden this bed belongs to.
         *
         * Measured outward from the middle of the patch, so a neighbour's farm
         * grows the way the player's does — a small block first, then rings
         * around it — rather than filling in rows from one edge, which reads as
         * a loading bar.
         */
        const spread = Math.max(
          Math.abs(gx - (PLOT_W - 1) / 2) / ((PLOT_W - 1) / 2),
          Math.abs(gz - (PLOT_H - 1) / 2) / ((PLOT_H - 1) / 2),
        )
        const tier = spread < 0.34 ? 1 : spread < 0.7 ? 2 : 3

        // The same authored planter the player's tilled plots use, so the street
        // reads as one village rather than as the player's farm next to a
        // different game's. Collected for one instanced draw call rather than
        // baked, because baking would destroy the model's texture.
        const tray = plotTrayPlacement()
        batches.trays.push({
          x: pos.x,
          y: pos.y + tray.originY,
          z: pos.z,
          rotationY: ((gx * 3 + gz * 7) % 4) * (Math.PI / 2),
          scale: tray.scale,
        })
        batches.trayTier.push(tier)
        batches.trayOwner.push(this.index)

        // Leave the rest of the bed fallow. Draw the die unconditionally so the
        // random stream — and therefore every crop below it — is unaffected by
        // which tiles happen to be skipped.
        if (r() > PLANTED_FRACTION) continue

        this.plots.push({
          // Mostly their favourite, with the occasional something else so the
          // plot does not read as a copy-paste.
          def: r() < 0.7 ? cropById(profile.favourite) : CROPS[Math.floor(r() * CROPS.length)],
          rarity: rollRarity(1 + profile.level * 0.05),
          progress: r(),
          stage: 0,
          watered: r() > 0.4,
          seed: Math.floor(r() * 1e6),
          model: null,
          pos,
          checker: (gx + gz) % 2 === 0,
          tier,
        })
      }
    }

    this.group.add(this.cropRoot)

    // --- yard dressing ----------------------------------------------------
    // The bed and the cottage together only cover half the plot, and a fence
    // around bare lawn is the thing that makes a farm look unfinished. All of
    // this bakes into the static mesh with everything else, so filling the yard
    // is free at runtime.
    const scarecrowFit = fitToHeight(getModels().scarecrow, PROP_HEIGHT.scarecrow)
    const scarecrow = at(1.2, ACROSS_HALF - 1.8)
    batches.scarecrows.push({
      x: scarecrow.x,
      y: scarecrowFit.groundY,
      z: scarecrow.z,
      rotationY: facingLane,
      scale: scarecrowFit.scale,
    })

    /*
     * Instanced, not baked. The flower bed became an authored GLB whose colour
     * lives entirely in its texture — its baseColour factor is plain white — so
     * baking it flattened that white into vertex colours and dropped the UVs,
     * and every yard grew a set of blank white troughs. Same rule as the bench
     * below; see NeighbourBatches.
     */
    const bedFit = fitToHeight(getModels().flowerBed, PROP_HEIGHT.flowerBed)
    for (let i = 0; i < 3; i++) {
      // Draws from the shared PRNG in the same order as before, so moving these
      // out of the bake does not reshuffle every yard's dressing.
      const jitter = (r() - 0.5) * 1.6
      const spot = at(DEEP_HALF - 1.6 + jitter, -ACROSS_HALF + 1.6 + i * 2.4)
      batches.flowerBeds.push({
        x: spot.x,
        y: bedFit.groundY,
        z: spot.z,
        rotationY: r() * Math.PI,
        scale: bedFit.scale,
      })
    }

    /*
     * Bushes scattered along the back fence, thinned near the cottage door.
     *
     * Authored and textured now, like the world's, so they join the instanced
     * batch instead of being baked into the yard's static mesh — the same reason
     * the benches and flower beds moved out of the bake. The per-yard hash that
     * used to pick a procedural variant is gone with it; one silhouette turned
     * by a free rotation is what the world scatter uses too.
     */
    const bushFit = fitToHeight(getModels().bush, PROP_HEIGHT.bush)
    for (let i = 0; i < 7; i++) {
      const bush = at(2.4 + r() * (DEEP_HALF - 3.2), -ACROSS_HALF + 0.9 + r() * (ACROSS_HALF * 2 - 1.8))
      const bx = bush.x
      const bz = bush.z
      if (Math.hypot(bx - cottageX, bz - cottageZ) < 2.6) continue
      const jitter = 0.75 + r() * 0.5
      batches.bushes.push({
        x: bx,
        y: bushFit.groundY * jitter,
        z: bz,
        rotationY: r() * Math.PI * 2,
        scale: bushFit.scale * jitter,
      })
    }

    // Authored and textured, so it joins the instanced batch rather than being
    // baked in with the procedural dressing.
    const benchFit = fitToHeight(getModels().bench, PROP_HEIGHT.bench)
    // In front of the cottage, a little along the frontage from its door.
    const bench = at(DEEP_HALF - 3.0 - 2.4, -2.4 + 2.2)
    batches.benches.push({
      x: bench.x,
      y: benchFit.groundY,
      z: bench.z,
      rotationY: facingLane,
      scale: benchFit.scale,
    })

    // --- fence ------------------------------------------------------------
    // Same builder the player's plot uses, so all six footprints match exactly —
    // and the same colliders, so a neighbour's fence is as solid as your own.
    buildPlotFence(slot, batches.fences, walls)

    // Collapse every static piece into one vertex-coloured mesh.
    const baked = new THREE.Mesh(bakeGroup(statics), new THREE.MeshLambertMaterial({ vertexColors: true }))
    baked.castShadow = true
    baked.receiveShadow = true
    this.group.add(baked)

    // --- the farmer -------------------------------------------------------
    /*
     * The same authored rig as the player, tinted toward the profile's shirt
     * colour. The tint is blended most of the way back to white before it
     * multiplies the texture: at full saturation it dyes skin, hat and all,
     * and the villager reads as a statue of paint rather than a person.
     */
    const tint = new THREE.Color(profile.shirt).lerp(new THREE.Color(0xffffff), 0.55)
    this.farmer = cloneFarmer(tint.getHex())
    this.mixer = new THREE.AnimationMixer(this.farmer.root)
    const action = (clip?: THREE.AnimationClip) => (clip ? this.mixer.clipAction(clip) : null)
    this.npcIdleAction = action(this.farmer.idle)
    this.npcWalkAction = action(this.farmer.walk)
    this.npcCurrent = this.npcIdleAction
    // Offset each villager's clock so five idles never breathe in unison.
    this.npcCurrent?.play()
    this.mixer.setTime(Math.random() * 3)
    this.group.add(this.farmer.root)

    this.npcPos = new THREE.Vector2(bedCentre.x, bedCentre.z + 1)
    this.npcTarget = this.pickNpcTarget()

    this.refreshMailbox()
  }

  /** Where this villager is standing, in world XZ. */
  get npcWorldPos(): THREE.Vector2 {
    return this.npcPos
  }

  /** False when the viewer is too far to resolve the pose; set by setViewer. */
  private animate = true

  /**
   * Whether this neighbour has moved into the village yet.
   *
   * Owned by Neighbourhood.setArrivedFor. Kept as state on the neighbour rather
   * than as a one-off visibility write because setViewer runs every frame and
   * would otherwise overwrite it — see the note there.
   */
  arrived = false

  /** Somewhere inside the fence, kept off the boundary so they never clip it. */
  private pickNpcTarget() {
    return new THREE.Vector2(
      this.centre.x + (Math.random() - 0.5) * (PLOT_HX - 1) * 2,
      this.centre.z + (Math.random() - 0.5) * (PLOT_HZ - 1) * 2,
    )
  }

  /** Raise or drop the "they want something" marker over the cottage. */
  setNeedsAttention(on: boolean) {
    this.requestMarker.visible = on
  }

  /** Plots that are grown but dry — what the player can help with. */
  get dryPlots() {
    return this.plots.filter((p) => !p.watered && p.progress < 1)
  }

  get ripeCount() {
    return this.plots.filter((p) => p.progress >= 1).length
  }

  get hasGift() {
    return this.giftTierReady() !== null
  }

  private giftTierReady() {
    const tier = GIFT_TIERS[this.claimedTiers]
    if (tier && this.friendship >= tier.at) return tier
    return null
  }

  private refreshMailbox() {
    this.mailbox.setFlag(this.hasGift)
  }

  /** Water one dry plot. Returns true if there was anything to do. */
  waterOne() {
    const dry = this.dryPlots
    if (dry.length === 0) return false
    this.water(dry[0])
    return true
  }

  /**
   * The planted plot nearest a world point, for click-to-inspect.
   *
   * Only *planted* tiles are candidates — the bed has fallow rows and clicking
   * bare soil should fall through to whatever is behind it rather than opening a
   * panel about nothing.
   */
  /*
   * The tolerance is deliberately wider than a tile.
   *
   * The click arrives as a point on the *ground*, but the plant sits on top of a
   * planter — so at a shallow camera angle the ray passes over the crop and
   * lands most of a tile beyond it. Half a tile of slack missed almost every
   * click. Since the nearest planted tile wins, being generous only means
   * clicking near a plant selects it, which is what a player expects anyway.
   */
  plotNear(point: THREE.Vector3, maxDist = TILE * 1.3): NeighbourPlot | null {
    let best: NeighbourPlot | null = null
    let bestDist = maxDist
    for (const plot of this.plots) {
      const d = Math.hypot(point.x - plot.pos.x, point.z - plot.pos.z)
      if (d < bestDist) {
        best = plot
        bestDist = d
      }
    }
    return best
  }

  /** Water one specific plot. Same friendship as helping out generally. */
  water(plot: NeighbourPlot) {
    if (plot.watered || plot.progress >= 1) return false
    plot.watered = true
    this.friendship = Math.min(100, this.friendship + 3)
    this.refreshMailbox()
    return true
  }

  /**
   * Finish someone else's crop for them.
   *
   * The plant is left ripe rather than harvested — it is their produce, and
   * their own tick picks it up and replants in its own time. What the player
   * gets is the friendship.
   */
  forceRipen(plot: NeighbourPlot) {
    if (plot.progress >= 1) return false
    plot.progress = 1
    plot.watered = true
    this.friendship = Math.min(100, this.friendship + 8)
    this.refreshMailbox()
    this.rebuildPlot(plot)
    return true
  }

  /**
   * Say hello. Pays out the first time the player walks over on a given day.
   *
   * The valley is a street of five farms the player can see from their gate and
   * had no reason to walk down — every interaction with a neighbour worked
   * perfectly well from a menu. This is the reason to make the lap: a small,
   * certain payout for turning up, once each, each day.
   *
   * Deliberately small. It is a greeting, not an income — the friendship it
   * builds is worth more than the coins, and it is the friendship that unlocks
   * the gift tiers and the better trades.
   */
  greet(day: number): { coins: number; friendship: number; seedId: string | null } | null {
    if (day === this.lastVisitDay) return null
    const first = this.lastVisitDay < 0
    this.lastVisitDay = day

    // Scaled by their standing, so the lap keeps paying as the farm grows.
    const coins = Math.round(20 + this.profile.level * 8 + this.friendship * 1.5)
    const friendship = 2
    this.friendship = Math.min(100, this.friendship + friendship)
    this.refreshMailbox()
    // A packet of what they grow, now and then — the cheapest way for a
    // neighbour to feel like a person with a farm of their own.
    const seedId = !first && Math.random() < 0.35 ? this.profile.favourite : null
    return { coins, friendship, seedId }
  }

  /** Collect a friendship gift if one is due. */
  claimGift() {
    const tier = this.giftTierReady()
    if (!tier) return null
    this.claimedTiers++
    this.refreshMailbox()
    return { ...tier, seedId: this.profile.favourite }
  }

  /**
   * Build or tear down the crop models based on player distance.
   *
   * Five neighbours at twenty plots each is a hundred crop models, and each
   * crop is a dozen small meshes. With every farm on one street several
   * neighbours are always in view, so the middle band builds half the plots:
   * enough that a farm across the lane still reads as planted, without paying
   * for detail nobody can resolve.
   */
  setViewer(playerPos: THREE.Vector3) {
    const dist = Math.hypot(playerPos.x - this.centre.x, playerPos.z - this.centre.z)
    const level = dist < CLOSE_RANGE ? 2 : dist < DETAIL_RANGE ? 1 : 0
    this.animate = dist < ANIMATE_RANGE

    /*
     * Arrival first, then distance.
     *
     * This runs every frame and owns `group.visible`, so a neighbour hidden
     * because they have not moved in yet was being switched straight back on by
     * the next LOD update — the arrival schedule looked like it did nothing at
     * all. Distance culling only ever applies to somebody who is actually here.
     */
    /*
     * A villager walking in counts as here, though their farm does not.
     *
     * `arrived` only flips once they reach their plot, so keying visibility off
     * it alone made the whole arrival invisible: the walk ran its full length
     * with nobody on the sand, and the neighbour blinked into existence at the
     * end of it.
     */
    this.group.visible = (this.arrived || this.walkingIn) && (level > 0 || dist < BUILDING_RANGE)

    if (level === this.detailLevel) return
    this.detailLevel = level

    for (const plot of this.plots) this.rebuildPlot(plot)
  }

  /** True when this plot's crops should exist at the current detail level. */
  private wantsModel(plot: NeighbourPlot) {
    // Ground they have not broken yet grows nothing. Without this the crops of
    // a tier still to come stood in mid-air over bare grass, which gives the
    // whole growth schedule away.
    if (plot.tier > this.gardenLevel) return false
    if (this.detailLevel === 2) return true
    if (this.detailLevel === 0) return false
    return plot.checker
  }

  /** Rebuild every crop — used when the garden grows a tier. */
  refreshPlots() {
    for (const plot of this.plots) this.rebuildPlot(plot)
  }

  private rebuildPlot(plot: NeighbourPlot) {
    if (plot.model) {
      this.cropRoot.remove(plot.model)
      disposeTree(plot.model)
      plot.model = null
    }
    if (!this.wantsModel(plot)) return

    plot.stage = stageForProgress(plot.progress)
    const model = createCropModel(plot.def, plot.stage, {
      seed: plot.seed,
      rarityColor: RARITY_BY_ID.get(plot.rarity)?.color,
    })
    model.position.copy(plot.pos)
    // On the planter's surface, same as the player's crops.
    model.position.y += soilSurfaceY()
    setLayer(model, MINOR_LAYER)
    this.cropRoot.add(model)
    plot.model = model
  }

  update(dt: number, elapsed: number, camera?: THREE.Camera) {
    // --- the "they need something" marker ----------------------------------
    // Over the cottage, visible from the lane. A request the player has to open
    // a panel to discover is a request that goes unanswered — the point of it
    // is that a neighbour is asking, and asking has to be visible from outside.
    if (this.requestMarker.visible && camera) {
      this.requestMarker.position.y = this.markerY + Math.sin(elapsed * 3.2) * 0.16
      this.requestMarker.quaternion.copy(camera.quaternion)
    }

    // --- crops ------------------------------------------------------------
    for (const plot of this.plots) {
      if (plot.progress >= 1) {
        // A ripe crop is eventually harvested by its owner and replanted, so a
        // neighbour's farm is never a static diorama.
        if (Math.random() < dt * 0.05) this.harvestAndReplant(plot)
        continue
      }

      const rate = plot.watered ? 2 : 1
      plot.progress = Math.min(1, plot.progress + (dt * rate) / growSecondsFor(plot.def))

      // Soil dries out, creating the dry plots the player can help with.
      if (plot.watered && Math.random() < dt * 0.02) plot.watered = false

      const stage = stageForProgress(plot.progress)
      if (stage !== plot.stage && plot.model) this.rebuildPlot(plot)
      else plot.stage = stage
    }

    // --- the farmer wanders ------------------------------------------------
    if (!this.group.visible) return
    /*
     * ...unless they are still walking in.
     *
     * A neighbour who has just been unlocked is crossing the valley from the
     * beach to a plot that is not theirs yet, and the wander would drag them
     * back inside a fence that does not exist. Neighbourhood drives them for
     * the length of that walk — see `beginArrival` — and hands them back here
     * once they are home.
     */
    if (this.walkingIn) {
      this.farmer.root.position.set(this.npcPos.x, 0, this.npcPos.y)
      this.farmer.root.rotation.y = this.npcFacing
      const walk = this.npcWalkAction ?? this.npcIdleAction
      if (walk !== this.npcCurrent) {
        walk?.reset().fadeIn(0.2).play()
        this.npcCurrent?.fadeOut(0.2)
        this.npcCurrent = walk
      }
      /*
       * Stride matched to their real ground speed.
       *
       * The walk is a straight lerp from the beach to whichever gate they are
       * headed for, and those are between forty and seventy units away over the
       * same thirty seconds — so one fixed time scale had somebody skating and
       * somebody else moonwalking. Derived from the step Neighbourhood just
       * moved them, which is the only number that knows.
       */
      if (dt > 0 && walk === this.npcWalkAction) {
        const speed = this.npcStep / dt
        walk?.setEffectiveTimeScale(Math.min(1.5, Math.max(0.35, speed / WALK_CLIP_SPEED)))
      }
      /*
       * Driven every frame of the walk, whatever the LOD says.
       *
       * This branch used to return before the mixer update at the bottom of
       * the method, so the one time a villager is guaranteed to be on screen —
       * the arrival, with the camera pulled back and holding on them — was the
       * one time they slid across the valley in a frozen pose. The distance
       * test is no help either: it measures from the *plot*, which is the far
       * end of the walk, so most of the crossing sits outside ANIMATE_RANGE.
       */
      this.mixer.update(dt)
      return
    }

    const dx = this.npcTarget.x - this.npcPos.x
    const dz = this.npcTarget.y - this.npcPos.y
    const dist = Math.hypot(dx, dz)

    let moving = false
    if (this.npcIdle > 0) {
      this.npcIdle -= dt
    } else if (dist < 0.25) {
      this.npcIdle = 1.5 + Math.random() * 3
      this.npcTarget = this.pickNpcTarget()
    } else {
      moving = true
      const step = Math.min(dist, 1.7 * dt)
      this.npcPos.x += (dx / dist) * step
      this.npcPos.y += (dz / dist) * step
      this.npcFacing = angleLerp(this.npcFacing, Math.atan2(dx, dz), Math.min(1, dt * 8))
    }

    this.farmer.root.position.set(this.npcPos.x, 0, this.npcPos.y)
    this.farmer.root.rotation.y = this.npcFacing

    // Same cross-fade the player uses, at the wander pace: villagers stroll,
    // so the walk clip is slowed to match their actual feet-per-second.
    const next = moving ? (this.npcWalkAction ?? this.npcIdleAction) : this.npcIdleAction
    if (next !== this.npcCurrent) {
      next?.reset().setEffectiveTimeScale(moving ? 0.62 : 1).fadeIn(0.2).play()
      this.npcCurrent?.fadeOut(0.2)
      this.npcCurrent = next
    }
    if (this.animate) this.mixer.update(dt)
    void elapsed
  }

  private harvestAndReplant(plot: NeighbourPlot) {
    const value = produceValue(plot.def, plot.rarity, [])
    if (value > this.bestFind.value) {
      this.bestFind = { label: produceLabel(plot.def, plot.rarity, []), value }
    }

    plot.def = Math.random() < 0.7 ? cropById(this.profile.favourite) : CROPS[Math.floor(Math.random() * CROPS.length)]
    plot.rarity = rollRarity(1 + this.profile.level * 0.05)
    plot.progress = 0
    plot.seed = Math.floor(Math.random() * 1e6)
    plot.watered = Math.random() > 0.4
    this.rebuildPlot(plot)
  }

  serialize() {
    return {
      id: this.profile.id,
      friendship: this.friendship,
      tiers: this.claimedTiers,
      visited: this.lastVisitDay,
    }
  }

  deserialize(d: { friendship: number; tiers: number; visited?: number } | undefined) {
    if (!d) return
    this.friendship = d.friendship ?? 0
    this.claimedTiers = d.tiers ?? 0
    this.lastVisitDay = Number.isFinite(d.visited) ? d.visited! : -1
    this.refreshMailbox()
  }
}

export class Neighbourhood {
  readonly group = new THREE.Group()
  readonly all: Neighbour[] = []

  constructor(obstacles: Obstacle[], walls: Wall[]) {
    // Fences and planters are authored, textured models, so they cannot be baked
    // into each neighbour's vertex-coloured static mesh. Collected across all
    // five farms instead and drawn as one instanced batch each.
    const batches: NeighbourBatches = { fences: [], trays: [], trayTier: [], trayOwner: [], benches: [], cottages: [], scarecrows: [], flowerBeds: [], bushes: [] }

    PROFILES.forEach((profile, i) => {
      const slot = NEIGHBOUR_SLOTS[i]
      if (!slot) return
      /*
       * Each neighbour's contribution to the shared batches is bracketed, so a
       * rebuild can take a prefix of them.
       *
       * The batches exist because fences, planters and cottages are textured
       * models that cannot be baked into a vertex-coloured static mesh — one
       * instanced draw for all five farms instead of five of each. That is
       * still the right call, and it is also why a single neighbour cannot
       * simply be hidden: an InstancedMesh is all-or-nothing. Recording where
       * each one's entries start lets the whole set be rebuilt from however
       * many have moved in, which costs a handful of small allocations on a
       * level-up and nothing at all in between.
       */
      const mark = () => ({
        fences: batches.fences.length,
        trays: batches.trays.length,
        benches: batches.benches.length,
        cottages: batches.cottages.length,
        scarecrows: batches.scarecrows.length,
        flowerBeds: batches.flowerBeds.length,
        bushes: batches.bushes.length,
      })
      const before = mark()
      const firstObstacle = obstacles.length
      const neighbour = new Neighbour(profile, slot, obstacles, walls, batches, i)
      this.group.add(neighbour.group)
      this.all.push(neighbour)
      this.ranges.push({ from: before, to: mark() })
      this.obstacleRanges.push({ from: firstObstacle, to: obstacles.length })

      /*
       * Woodland over the ground this neighbour will occupy.
       *
       * Same reasoning as the stall's and the barn's (see plantThicket in
       * world.ts): a level-gated building leaves a bare rectangle otherwise,
       * and a street of empty lawns tells the player exactly what is coming and
       * where. The wood is the inverse of the neighbour — shown until they move
       * in, cleared when they do.
       */
      const wood = new THREE.Group()
      const woodObstacles: Obstacle[] = []
      for (let t = 0; t < 26; t++) {
        const x = slot.x + (Math.random() - 0.5) * 2 * (PLOT_HX + 1)
        const z = slot.z + (Math.random() - 0.5) * 2 * (PLOT_HZ + 1)
        if (isSand(x, z)) continue
        const conifer = Math.random() < 0.35
        const model = conifer ? getModels().pine : getModels().tree
        const height = (conifer ? PROP_HEIGHT.pine : PROP_HEIGHT.tree) * (0.8 + Math.random() * 0.4)
        const tree = modelGroup(model, height)
        tree.position.set(x, 0, z)
        tree.rotation.y = Math.random() * Math.PI * 2
        wood.add(tree)
        const o: Obstacle = { x, z, r: 0.55 }
        obstacles.push(o)
        woodObstacles.push(o)
      }
      this.group.add(wood)
      this.woods.push(wood)
      this.woodObstacles.push(woodObstacles)
    })

    this.batches = batches
    this.obstacles = obstacles

    /*
     * Nobody has moved in yet.
     *
     * `arrived` starts at 0 and setArrivedFor early-returns when the count has
     * not changed, so the opening call for a level-1 player is a no-op — which
     * left all five standing on the street at construction and made the whole
     * schedule look broken from the first frame. The absent state has to be
     * established here, not inferred from the first update.
     */
    this.all.forEach((nb) => {
      nb.arrived = false
      nb.group.visible = false
    })
    // The woods start standing — nobody has moved in to clear them.
    this.woods.forEach((wood, i) => {
      wood.visible = true
      for (const o of this.woodObstacles[i]) o.off = false
    })
    for (const range of this.obstacleRanges) {
      for (let k = range.from; k < range.to; k++) obstacles[k].off = true
    }
    this.rebuildBatches()
  }

  private readonly ranges: { from: Record<string, number>; to: Record<string, number> }[] = []
  private readonly obstacleRanges: { from: number; to: number }[] = []
  private batches!: NeighbourBatches
  private obstacles!: Obstacle[]
  private readonly batchMeshes: THREE.Object3D[] = []
  /** Per neighbour: the trees standing on their plot until they move in. */
  private readonly woods: THREE.Group[] = []
  private readonly woodObstacles: Obstacle[][] = []
  private arrived = 0

  /** How many neighbours have moved in. The street is laid out to match. */
  get arrivedCount() {
    return this.arrived
  }

  /**
   * How many neighbours have moved in at this level.
   *
   * One every other level from the third, which is where the Valley panel
   * unlocks — so the panel arrives with the first person to put in it rather
   * than with an empty street. Spreading them out is the point: a village that
   * fills up as you grow gives the middle levels something to show for
   * themselves that is not another crop.
   */
  static arrivedCountFor(level: number) {
    return Math.max(0, Math.min(PROFILES.length, Math.floor((level - 3) / 2) + 1))
  }

  /**
   * How many neighbours the player's level has earned. They do not appear at
   * that instant — see `beginArrival`; this is the target the arrivals walk
   * toward, one at a time.
   */
  private targetArrived = 0
  /** The arrival playing out right now, if any. */
  private arrival: {
    index: number
    t: number
    from: THREE.Vector2
    to: THREE.Vector2
  } | null = null
  /** Woods coming down, mid-shrink. */
  private readonly felling: { group: THREE.Group; t: number }[] = []

  /** Fires when a villager sets off from the beach — for the camera. */
  onArrivalStart: ((nb: Neighbour, at: THREE.Vector3) => void) | null = null
  /** Fires when they reach their plot and the wood comes down. */
  onArrivalSettled: ((nb: Neighbour, at: THREE.Vector3) => void) | null = null

  /**
   * Bring everyone in at once, without the walk.
   *
   * For a restored save: the neighbours a returning player has already earned
   * are simply *there*, and replaying five arrival walks on load would be a
   * cutscene about nothing.
   */
  restoreArrivedFor(level: number) {
    const grew = this.setGardenLevels(level)
    this.targetArrived = Neighbourhood.arrivedCountFor(level)
    const before = this.arrived
    this.applyArrived(this.targetArrived)
    /*
     * `applyArrived` early-returns when the count has not moved, which is the
     * common case for a garden that has only *grown* — a save loaded at a high
     * level has had everyone for ages. The beds still need redrawing.
     */
    if (grew && this.arrived === before && this.arrived > 0) {
      this.rebuildBatches()
      for (const nb of this.all) nb.refreshPlots()
    }
  }

  setArrivedFor(level: number) {
    // Their gardens grow with the player's level, arrived or not — see
    // setGardenLevels. A change there needs the beds redrawn.
    if (this.setGardenLevels(level) && this.arrived > 0) {
      this.rebuildBatches()
      for (const nb of this.all) nb.refreshPlots()
    }
    this.targetArrived = Neighbourhood.arrivedCountFor(level)
    // Fewer than we have (a retirement) applies at once; more is walked in.
    if (this.targetArrived < this.arrived) this.applyArrived(this.targetArrived)
    else this.beginArrival()
  }

  /**
   * Start the next villager walking, if one is owed and none is on the road.
   *
   * One at a time on purpose: two levels earned at once would otherwise put two
   * strangers on the beach walking in step, which reads as a spawn rather than
   * as someone moving in.
   */
  private beginArrival() {
    if (this.arrival || this.arrived >= this.targetArrived) return
    const index = this.arrived
    const nb = this.all[index]
    // Visible for the walk, but not yet counted — their fence, cottage and beds
    // are in the shared batches and stay out until they are home.
    nb.group.visible = true
    nb.walkingIn = true

    const gate = approachPos(NEIGHBOUR_SLOTS[index])
    const from = new THREE.Vector2(ARRIVAL_FROM.x, ARRIVAL_FROM.z)
    const to = new THREE.Vector2(gate.x, gate.z)
    nb.placeNpc(from.x, from.y, Math.atan2(to.x - from.x, to.y - from.y))
    this.arrival = { index, t: 0, from, to }
    this.onArrivalStart?.(nb, new THREE.Vector3(from.x, 0, from.y))
  }

  /** Drive the walk and the felling. Called from update. */
  private updateArrivals(dt: number) {
    for (let i = this.felling.length - 1; i >= 0; i--) {
      const f = this.felling[i]
      f.t += dt / WOOD_FELL_SECONDS
      if (f.t >= 1) {
        f.group.visible = false
        f.group.scale.setScalar(1)
        this.felling.splice(i, 1)
        continue
      }
      f.group.scale.setScalar(1 - f.t)
    }

    const a = this.arrival
    if (!a) return
    const nb = this.all[a.index]
    a.t += dt / ARRIVAL_WALK_SECONDS
    if (a.t < 1) {
      const x = a.from.x + (a.to.x - a.from.x) * a.t
      const z = a.from.y + (a.to.y - a.from.y) * a.t
      nb.placeNpc(x, z, Math.atan2(a.to.x - a.from.x, a.to.y - a.from.y))
      return
    }

    // Home. The wood on their plot comes down, and their farm is theirs.
    this.arrival = null
    nb.settleNpc()
    const wood = this.woods[a.index]
    if (wood.visible) this.felling.push({ group: wood, t: 0 })
    this.applyArrived(a.index + 1)
    this.onArrivalSettled?.(nb, nb.centre.clone())
    // Another may be owed — they queue rather than travel together.
    this.beginArrival()
  }

  /** Put the world into the state for `n` arrived neighbours, at once. */
  private applyArrived(n: number) {
    if (n === this.arrived) return
    this.arrived = n
    this.all.forEach((nb, i) => {
      nb.arrived = i < n
      nb.group.visible = nb.arrived
    })
    this.woods.forEach((wood, i) => {
      // A wood mid-fall is left to the felling animation to put away.
      if (!this.felling.some((f) => f.group === wood)) wood.visible = i >= n
      for (const o of this.woodObstacles[i]) o.off = i < n
    })
    this.obstacleRanges.forEach((range, i) => {
      for (let k = range.from; k < range.to; k++) this.obstacles[k].off = i >= n
    })
    this.rebuildBatches()
  }

  /**
   * How grown each arrived neighbour's garden is, from the player's level.
   *
   * A neighbour moves in at level 3 + 2i and gains a tier every four levels
   * after that, so the street keeps changing long after the last of them has
   * arrived — by the time the player is deep into their own upgrades, the farms
   * either side of them have visibly filled out too.
   */
  private setGardenLevels(level: number) {
    let changed = false
    this.all.forEach((nb, i) => {
      const since = level - (3 + 2 * i)
      const grown = Math.max(1, Math.min(3, 1 + Math.floor(since / 4)))
      if (grown !== nb.gardenLevel) {
        nb.gardenLevel = grown
        changed = true
      }
    })
    return changed
  }

  /** Redraw the shared instanced batches from the neighbours who have arrived. */
  private rebuildBatches() {
    for (const mesh of this.batchMeshes) this.group.remove(mesh)
    this.batchMeshes.length = 0
    if (this.arrived === 0) return

    const cut = this.ranges[this.arrived - 1].to
    const models = getModels()
    const add = (model: Parameters<typeof instanceModel>[0], list: PropPlacement[], end: number) => {
      const slice = list.slice(0, end)
      if (slice.length === 0) return
      const mesh = instanceModel(model, slice)
      this.batchMeshes.push(mesh)
      this.group.add(mesh)
    }
    add(models.plotFence, this.batches.fences, cut.fences)

    /*
     * The beds are filtered, not sliced.
     *
     * Everything else on a neighbour's farm arrives whole the day they move in,
     * so a prefix of the batch is exactly right for it. Their beds do not: the
     * garden grows outward a tier at a time, which means the visible set is
     * "every tray whose owner is here *and* whose tier they have broken" —
     * spread across the batch rather than sitting at the front of it.
     */
    const trays = this.batches.trays.filter((_, k) => {
      const owner = this.batches.trayOwner[k]
      return owner < this.arrived && this.batches.trayTier[k] <= this.all[owner].gardenLevel
    })
    if (trays.length > 0) {
      const mesh = instanceModel(models.plotTray, trays)
      this.batchMeshes.push(mesh)
      this.group.add(mesh)
    }
    add(models.bench, this.batches.benches, cut.benches)
    add(models.cottage, this.batches.cottages, cut.cottages)
    add(models.scarecrow, this.batches.scarecrows, cut.scarecrows)
    add(models.flowerBed, this.batches.flowerBeds, cut.flowerBeds)
    add(models.bush, this.batches.bushes, cut.bushes)
  }

  /** The neighbour and planted plot under a world point, for click-to-inspect. */
  plotAt(point: THREE.Vector3): { neighbour: Neighbour; plot: NeighbourPlot } | null {
    for (const neighbour of this.all) {
      // Cheap reject on the plot's own footprint before walking its tiles.
      if (Math.abs(point.x - neighbour.centre.x) > PLOT_HX + 1) continue
      if (Math.abs(point.z - neighbour.centre.z) > PLOT_HZ + 1) continue

      const plot = neighbour.plotNear(point)
      if (plot) return { neighbour, plot }
    }
    return null
  }

  /** Nearest neighbour whose farm the player is standing in, if any. */
  nearest(pos: THREE.Vector3, maxDist = 8) {
    let best: Neighbour | null = null
    let bestDist = maxDist
    for (const n of this.all) {
      const d = Math.hypot(pos.x - n.centre.x, pos.z - n.centre.z)
      if (d < bestDist) {
        best = n
        bestDist = d
      }
    }
    return best
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3, camera?: THREE.Camera) {
    this.updateArrivals(dt)
    for (const n of this.all) {
      n.setViewer(playerPos)
      n.update(dt, elapsed, camera)
    }
  }

  serialize() {
    return this.all.map((n) => n.serialize())
  }

  deserialize(data: ReturnType<Neighbourhood['serialize']> | undefined) {
    if (!Array.isArray(data)) return
    for (const entry of data) {
      this.all.find((n) => n.profile.id === entry.id)?.deserialize(entry)
    }
  }
}

function cropById(id: string) {
  return CROPS.find((c) => c.id === id) ?? CROPS[0]
}

function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function angleLerp(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry.dispose()
  })
}

export { GROWTH_STAGES }
