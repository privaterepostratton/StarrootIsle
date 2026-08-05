import * as THREE from 'three'
import { bakeGroup, makeInstancedChunks, type Placement } from '../assets/bake'
import { createFlowerModel } from '../assets/nature'
import { createPebbleScatter, createCloverPatch, createMushroomCluster } from '../assets/decals'
import { createReedsModel } from '../assets/bridge'
import { MINOR_LAYER, rng } from '../assets/style'
import { heightAt, isPlantable, oceanMask, WALK_LIMIT, WATER_LEVEL } from './terrain'
import { SPAWN } from './village'
import { getModels, fitToHeight, PROP_HEIGHT } from '../assets/models'
import { captureImpostor, createImpostorField, type ImpostorPlacement } from '../assets/impostor'
import type { Obstacle } from './world'

/**
 * Instanced vegetation.
 *
 * Every tree, pine, bush and rock is baked into one of a handful of geometry
 * variants and drawn with a single InstancedMesh each, so forest density is
 * limited by triangles rather than by draw calls. Grass is the same trick at a
 * much larger count, with the sway done in the vertex shader.
 */

export interface VegetationOptions {
  /** Rejects candidate positions that sit on the farm, the shop or the path. */
  blocked: (x: number, z: number) => boolean
  obstacles: Obstacle[]
  /** Needed once, to photograph the tree models for the impostor ring. */
  renderer: THREE.WebGLRenderer
}

/**
 * Boulder silhouettes: one stone, and a three-stone cluster with a grass tuft.
 *
 * Two is the whole point of the pair. A single authored rock stamped three
 * hundred times reads as one rock stamped three hundred times however far the
 * per-instance scale is spread, because the eye matches outlines rather than
 * sizes; alternating two unrelated outlines breaks that instantly. It stays at
 * two because each variant is its own InstancedMesh per chunk, so variant count
 * multiplies draw calls.
 */
const ROCK_VARIANTS = 2

/*
 * Raised alongside the valley: the walkable ring more than doubled when the
 * village street replaced the single farm basin, so the old count read thin.
 *
 * Then trimmed, because the authored tree and pine are ~2400 triangles each and
 * at 1400 of them the forest alone was 2M triangles a frame — most of the whole
 * frame budget for scenery the player never walks into. Fewer, larger trees
 * cover the same silhouette at this camera distance; the tree line reads by its
 * outline, not by its stem count.
 */
const TREE_COUNT = 1400

/**
 * Trees beyond this radius from the village become impostors — single
 * billboard quads wearing a snapshot of the model. The village and everything
 * the player walks through daily sits well inside; only the frontier and the
 * mountainsides go flat, and at those distances a quad and the mesh read the
 * same. See impostor.ts for the technique.
 */
const IMPOSTOR_RADIUS = 55
const BUSH_COUNT = 820
const ROCK_COUNT = 540
/**
 * Grass tufts. One instance each, where this used to be clumps of 5-8 blades.
 *
 * Down from 12000 clumps — which was 78000 blade instances — because a tuft is
 * a thing you are meant to *see*, not filler. At the old density the ground
 * would be carpeted and the individual shapes would average out again, which is
 * exactly the failure the tuft was built to fix. Sparse enough that each one
 * sits on visible grass, dense enough that the field is never bare.
 *
 * It is also a fifth of the geometry the blade field cost.
 */
const GRASS_COUNT = 14000

/**
 * Where tufts start shrinking away from the camera, and where they are gone.
 *
 * Well inside the fog band (60 to 220), which is the point: the tufts have to
 * finish disappearing *before* the distance at which fog has washed out
 * everything behind them, or they stand as dark spikes against a pale treeline.
 *
 * The near figure is also comfortably past the camera's own boom, so the grass
 * around the player is never touched by this.
 */
const GRASS_FADE_NEAR = 38
const GRASS_FADE_FAR = 60

/**
 * Nothing that grows in a meadow is planted beyond this on the seaward arc.
 *
 * One number for all three placement loops — trees, dressing and grass. They
 * each sample independently, and the beach was carpeted twice over because the
 * first two were fixed and the third was forgotten.
 */
const COAST_CLEAR = 40

/**
 * Palms along the shore — the one thing that *does* grow on the seaward arc.
 *
 * Everything else is kept off the sand by COAST_CLEAR, which is what makes the
 * coast read as a coast rather than as a forest that happens to end in water.
 * The result was a beach with nothing on it at all, and an empty beach reads as
 * unfinished for the same reason an empty sightline does. Palms are the
 * exception because they are the one species the eye accepts on sand — they
 * dress the shore without putting the forest back on it.
 *
 * Placed in a band that starts *inland* of the sand and runs down to just above
 * the tideline, so they cluster along the top of the beach the way real ones do
 * rather than standing in the surf.
 */
const PALM_COUNT = 150


export function createVegetation(opts: VegetationOptions): THREE.Group {
  const group = new THREE.Group()
  const r = rng(0xf0e57)

  // --- bake the variants ---------------------------------------------------
  /**
   * Both tree species come from authored glTFs; the rest is procedural.
   *
   * Which means one silhouette each instead of baked variants — the shape
   * variety now comes entirely from per-instance rotation and scale. That is
   * enough here because the two species are placed by altitude, so the eye
   * reads the mix of the two rather than the repetition within either.
   */
  const treeModel = getModels().tree
  const treeFit = fitToHeight(treeModel, PROP_HEIGHT.tree)
  const pineModel = getModels().pine
  const pineFit = fitToHeight(pineModel, PROP_HEIGHT.pine)

  /**
   * The bush is authored now too, and decimated to afford it.
   *
   * It arrived at ~3000 triangles against 240 for the procedural blob it
   * replaces, which at this count is 1.5M triangles a frame for shrubbery — the
   * same arithmetic that forced the tree count down. scripts/decimate-glb.mjs
   * takes it to ~840, and the shape is unchanged at the size a bush is actually
   * seen: it is a mass of leaves, so there is nothing for a lost edge to spoil.
   */
  const bushModel = getModels().bush
  const bushFit = fitToHeight(bushModel, PROP_HEIGHT.bush)

  // The rocks are authored too now, so like the trees they keep their own
  // texture and cannot be baked — bakeGroup flattens material colour into vertex
  // colour and drops the UVs, which is right for the procedural set and fatal here.
  const rockModels = [getModels().rock, getModels().rockCluster]
  const rockFits = [
    fitToHeight(rockModels[0], PROP_HEIGHT.rock),
    fitToHeight(rockModels[1], PROP_HEIGHT.rockCluster),
  ]

  const treePlacements: Placement[] = []
  const pinePlacements: Placement[] = []
  const treeImpostors: ImpostorPlacement[] = []
  const pineImpostors: ImpostorPlacement[] = []
  const bushPlacements: Placement[] = []
  const rockPlacements: Placement[][] = rockModels.map(() => [])

  /**
   * Rejection-sample a point on plantable ground outside the built-up area.
   *
   * The coast is excluded outright rather than left to `isPlantable`, which only
   * asks whether the ground is above water and gentle enough — both true of a
   * beach. A forest growing down the sand to the tideline is the one thing that
   * would stop the seaward side reading as a coast at all, so the whole seaward
   * strip is off limits to trees, bushes and rocks alike. The shore dressing
   * (reeds, pebbles) is placed separately and is unaffected.
   */
  function sample(maxAttempts = 40): { x: number; z: number; h: number } | null {
    for (let i = 0; i < maxAttempts; i++) {
      const a = r() * Math.PI * 2
      const d = 7 + Math.sqrt(r()) * (WALK_LIMIT + 10)
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (opts.blocked(x, z)) continue
      if (!isPlantable(x, z)) continue
      if (d > COAST_CLEAR && oceanMask(Math.atan2(z, x)) > 0.25) continue
      return { x, z, h: heightAt(x, z) }
    }
    return null
  }

  // --- trees ---------------------------------------------------------------
  for (let i = 0; i < TREE_COUNT; i++) {
    const p = sample()
    if (!p) continue

    // Conifers take over above the tree line, broadleaf below it.
    const conifer = p.h > 8 ? r() < 0.85 : r() < 0.3
    const rotationY = r() * Math.PI * 2

    // Both models are centred on their own origin, so the ground lift has to be
    // scaled by the same jitter as the tree itself — a fixed lift would bury the
    // small ones and float the large ones.
    const far = Math.hypot(p.x, p.z) > IMPOSTOR_RADIUS

    if (conifer) {
      // Canopy trees, not shrubs. A conifer runs taller than a broadleaf, which
      // is what makes the two species read as a treeline rather than as one
      // forest at two sizes.
      const jitter = 0.9 + r() * 0.62
      if (far) {
        pineImpostors.push({ x: p.x, y: p.h, z: p.z, height: PROP_HEIGHT.pine * jitter })
      } else {
        pinePlacements.push({
          x: p.x,
          y: p.h + pineFit.groundY * jitter,
          z: p.z,
          rotationY,
          scale: pineFit.scale * jitter,
        })
        opts.obstacles.push({ x: p.x, z: p.z, r: 0.5 * jitter })
      }
      continue
    }

    const jitter = 0.92 + r() * 0.6
    if (far) {
      treeImpostors.push({ x: p.x, y: p.h, z: p.z, height: PROP_HEIGHT.tree * jitter })
      continue
    }
    treePlacements.push({
      x: p.x,
      y: p.h + treeFit.groundY * jitter,
      z: p.z,
      rotationY,
      scale: treeFit.scale * jitter,
    })
    opts.obstacles.push({ x: p.x, z: p.z, r: 0.5 * jitter })
  }

  // --- palms, along the shore ----------------------------------------------
  const palmModel = getModels().palm
  const palmFit = fitToHeight(palmModel, PROP_HEIGHT.palm)
  const palmPlacements: Placement[] = []
  {
    let attempts = 0
    while (palmPlacements.length < PALM_COUNT && attempts < PALM_COUNT * 40) {
      attempts++
      const a = r() * Math.PI * 2
      const d = 40 + Math.sqrt(r()) * (WALK_LIMIT - 30)
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      // Only on the open arc, and only where the ground is genuinely coastal.
      if (oceanMask(Math.atan2(z, x)) < 0.6) continue
      /*
       * Never on the spot the player wakes up on.
       *
       * This is the opening shot of the game, and the radius has to cover the
       * *camera*, not the farmer: the boom sits about ten units back, so a nine
       * unit clearing around the spawn point left the first frame looking
       * straight into a canopy from inside it. Eighteen clears the boom whatever
       * direction it happens to be pointing, and takes the crates with it.
       */
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 18) continue
      if (opts.blocked(x, z) || !isPlantable(x, z)) continue
      const h = heightAt(x, z)
      // Above the tideline, below the point where the beach turns back to
      // meadow — a palm standing in grass is just a badly chosen tree.
      if (h < WATER_LEVEL + 0.6 || h > WATER_LEVEL + 4.0) continue

      const jitter = 0.82 + r() * 0.55
      palmPlacements.push({
        x,
        y: h + palmFit.groundY * jitter,
        z,
        rotationY: r() * Math.PI * 2,
        scale: palmFit.scale * jitter,
      })
      opts.obstacles.push({ x, z, r: 0.45 * jitter })
    }
  }

  // --- bushes and rocks ----------------------------------------------------
  for (let i = 0; i < BUSH_COUNT; i++) {
    const p = sample()
    if (!p) continue
    const jitter = 0.7 + r() * 0.7
    // Centred on its own origin like every other authored prop, so the ground
    // lift has to be scaled by the same jitter — a fixed one buries the small
    // bushes and floats the large ones.
    bushPlacements.push({
      x: p.x,
      y: p.h + bushFit.groundY * jitter,
      z: p.z,
      rotationY: r() * Math.PI * 2,
      scale: bushFit.scale * jitter,
    })
    opts.obstacles.push({ x: p.x, z: p.z, r: 0.42 * jitter })
  }

  for (let i = 0; i < ROCK_COUNT; i++) {
    const p = sample()
    if (!p) continue
    // Variant, then a wide size spread and free rotation on top of it. The
    // spread alone was never enough — see the note on ROCK_VARIANTS.
    const v = Math.floor(r() * ROCK_VARIANTS)
    const jitter = 0.45 + r() * 1.15
    rockPlacements[v].push({
      x: p.x,
      y: p.h + rockFits[v].groundY * jitter,
      z: p.z,
      rotationY: r() * Math.PI * 2,
      scale: rockFits[v].scale * jitter,
    })
    opts.obstacles.push({ x: p.x, z: p.z, r: 0.34 * jitter })
  }

  // Authored meshes carry their own texture, and are chunked so the forest is
  // frustum-culled per neighbourhood rather than drawn whole every frame.
  for (const species of [
    { model: treeModel, placements: treePlacements },
    { model: pineModel, placements: pinePlacements },
  ]) {
    if (species.placements.length === 0) continue
    group.add(
      makeInstancedChunks(species.model.geometry, species.placements, {
        chunkSize: 68,
        material: species.model.material,
      }),
    )
  }
  if (bushPlacements.length > 0) {
    group.add(
      makeInstancedChunks(bushModel.geometry, bushPlacements, {
        chunkSize: 68,
        material: bushModel.material,
      }),
    )
  }

  // The far forest: one snapshot and one instanced draw per species.
  for (const species of [
    { model: treeModel, impostors: treeImpostors },
    { model: pineModel, impostors: pineImpostors },
  ]) {
    if (species.impostors.length === 0) continue
    const shot = captureImpostor(opts.renderer, species.model)
    group.add(createImpostorField(shot, species.impostors))
  }
  if (palmPlacements.length > 0) {
    group.add(
      makeInstancedChunks(palmModel.geometry, palmPlacements, {
        chunkSize: 68,
        material: palmModel.material,
      }),
    )
  }

  rockModels.forEach((model, i) => {
    if (rockPlacements[i].length === 0) return
    group.add(
      makeInstancedChunks(model.geometry, rockPlacements[i], {
        chunkSize: 68,
        material: model.material,
      }),
    )
  })

  // --- small dressing ------------------------------------------------------
  // Pebbles, clover, mushrooms, flowers and reeds. These were the single
  // largest source of draw calls when built as individual object groups —
  // a few hundred props at half a dozen meshes each. Instanced they cost
  // roughly one call per chunk.
  group.add(createDressing(opts, r))

  // --- grass ---------------------------------------------------------------
  group.add(createGrassField(opts, r))

  return group
}

const DRESSING_COUNTS = {
  pebbles: 540,
  clover: 730,
  mushroom: 320,
  flowers: 830,
  // Scaled harder than the rest: reeds are shore-only, and the wider valley
  // added four river banks and three lake shores for them to grow on.
  reeds: 620,
} as const

function createDressing(opts: VegetationOptions, r: () => number): THREE.Group {
  const group = new THREE.Group()

  const flowerColors = [0xf25c9e, 0xf2e05c, 0xa06ff2, 0xf27a4a, 0xf5f5f5]

  /*
   * `coast` says whether a kind may grow on the seaward sand.
   *
   * Only the pebbles may. Everything else here is meadow or marsh dressing, and
   * the reeds were the ones that gave it away: `shoreOnly` means "just above the
   * waterline", which was a river bank until there was an ocean and is now a
   * whole beach as well. The first coast came out carpeted in bulrushes from the
   * dunes to the surf.
   */
  const kinds: { geos: THREE.BufferGeometry[]; count: number; shoreOnly?: boolean; coast?: boolean }[] = [
    { geos: [bakeGroup(createPebbleScatter(r)), bakeGroup(createPebbleScatter(r))], count: DRESSING_COUNTS.pebbles, coast: true },
    { geos: [bakeGroup(createCloverPatch(r)), bakeGroup(createCloverPatch(r))], count: DRESSING_COUNTS.clover },
    { geos: [bakeGroup(createMushroomCluster(r))], count: DRESSING_COUNTS.mushroom },
    {
      geos: flowerColors.map((c) => bakeGroup(createFlowerModel(c, Math.floor(r() * 9999)))),
      count: DRESSING_COUNTS.flowers,
    },
    { geos: [bakeGroup(createReedsModel(3)), bakeGroup(createReedsModel(11))], count: DRESSING_COUNTS.reeds, shoreOnly: true },
  ]

  for (const kind of kinds) {
    const buckets: Placement[][] = kind.geos.map(() => [])
    let attempts = 0
    let placed = 0

    while (placed < kind.count && attempts < kind.count * 12) {
      attempts++
      const a = r() * Math.PI * 2
      const d = 5 + Math.sqrt(r()) * (WALK_LIMIT + 10)
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (opts.blocked(x, z) || !isPlantable(x, z)) continue
      if (!kind.coast && d > COAST_CLEAR && oceanMask(Math.atan2(z, x)) > 0.25) continue

      const h = heightAt(x, z)
      // Reeds only belong in the band just above the waterline.
      if (kind.shoreOnly && h > WATER_LEVEL + 1.6) continue

      buckets[Math.floor(r() * kind.geos.length)].push({
        x, y: h, z, rotationY: r() * Math.PI * 2, scale: 0.75 + r() * 0.6,
      })
      placed++
    }

    kind.geos.forEach((geo, i) => {
      if (buckets[i].length === 0) return
      group.add(
        makeInstancedChunks(geo, buckets[i], {
          chunkSize: 112,
          castShadow: false,
          layer: MINOR_LAYER,
        }),
      )
    })
  }

  return group
}

// --- grass -------------------------------------------------------------------

/** Shared time uniform so every grass batch sways in step. */
const grassTime = { value: 0 }

/**
 * Where the tuft fade sits, as live uniforms rather than baked constants.
 *
 * The fade has to finish *before* fog takes over, or the tufts are the only
 * crisp thing left in a scene the weather has washed out — which reads as grass
 * that fog does not apply to. Baked at 38-60 that was true in clear weather and
 * wrong in every other: rain pulls the fog band in to about forty units and mist
 * to twenty-five, and the grass went on being sharp well past both.
 *
 * Tracking the actual fog near plane keeps the two in step whatever the weather
 * does, and costs two uniform writes a frame.
 */
const grassFadeNear = { value: 0 }
const grassFadeFar = { value: 0 }

export function updateGrass(time: number, fogNear = GRASS_FADE_FAR) {
  grassTime.value = time
  // Never further than the clear-weather figure, and never past the fog.
  const far = Math.min(GRASS_FADE_FAR, fogNear)
  grassFadeFar.value = far
  grassFadeNear.value = far * (GRASS_FADE_NEAR / GRASS_FADE_FAR)
}

/**
 * A grass *tuft*: five to seven blades splaying outward from one root.
 *
 * This replaced a single Breath-of-the-Wild blade, placed six-odd times per
 * clump with independent jitter. That built a convincing lawn and the lawn was
 * the problem — at the camera height this game actually plays at, seventy-odd
 * thousand independent blades average out into a flat green mat, indis-
 * tinguishable from a texture. Nothing in the field read as an *object*.
 *
 * A tuft reads as an object because its blades share a root and fan away from
 * it, so the silhouette has a recognisable shape instead of being one more
 * sliver among thousands. That is also why the whole fan is baked into a single
 * geometry rather than assembled from instances: the blades have to hold their
 * arrangement relative to each other, and per-instance jitter is precisely what
 * destroys it.
 *
 * It costs less, too. One tuft is ~40 triangles against ~42 for the six blades
 * it replaces, and there are a quarter as many of them.
 */
const BLADE_SEGMENTS = 3
/** Tallest blade in a tuft. The rest are scaled down from it. */
const BLADE_HEIGHT = 0.62
/*
 * Wide, for a grass blade — three times what the old field used.
 *
 * The first tuft kept the blade width the lawn had, and at that width it was
 * correct up close and gone by fifteen units: a 0.05-unit sliver is sub-pixel
 * at the distance this camera actually sits, so the field averaged straight
 * back into the flat mat the tuft was supposed to replace. Reading at gameplay
 * range is the whole requirement, and it is width that buys it, not height.
 */
const BLADE_WIDTH = 0.22
/** How far a tip leans out from vertical, as a fraction of height. */
const BLADE_CURVE = 0.55
/** Blades per tuft. */
const TUFT_BLADES = 6

const BLADE_BASE = new THREE.Color(0x4a7a2c)
const BLADE_TIP = new THREE.Color(0xbfe06a)

/**
 * Deterministic pseudo-random from an integer, so the tuft is identical every
 * run. Not `rng()` — that is a stream, and this needs to be a pure function of
 * the blade index or the geometry changes between the two build calls below.
 */
function tuftNoise(i: number) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function buildTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []

  const color = new THREE.Color()

  for (let b = 0; b < TUFT_BLADES; b++) {
    /*
     * Blades fan out on an uneven spread rather than at even angles.
     *
     * Evenly spaced blades read as a shuttlecock — a manufactured object — and
     * the giveaway is strongest from directly above, which is roughly where
     * this camera sits. Offsetting each blade's bearing and giving each its own
     * height is what makes the fan read as something that grew.
     */
    const bearing = (b / TUFT_BLADES) * Math.PI * 2 + tuftNoise(b) * 0.9
    const lean = 0.55 + tuftNoise(b + 7) * 0.75
    const height = BLADE_HEIGHT * (0.6 + tuftNoise(b + 13) * 0.5)
    const width = BLADE_WIDTH * (0.75 + tuftNoise(b + 23) * 0.5)

    const outX = Math.cos(bearing)
    const outZ = Math.sin(bearing)

    /** Blade half-width at height ratio t — tapers to nothing at the tip. */
    const widthAt = (t: number) => (width / 2) * (1 - t * t)
    const yAt = (t: number) => t * height
    // Quadratic splay, so the roots stay together and only the tips open out.
    const outAt = (t: number) => t * t * BLADE_CURVE * lean * height

    const push = (t: number, side: number) => {
      // `side` walks across the blade, perpendicular to the direction it leans.
      const half = widthAt(t)
      const out = outAt(t)
      positions.push(outX * out - outZ * side * half, yAt(t), outZ * out + outX * side * half)
      color.copy(BLADE_BASE).lerp(BLADE_TIP, t)
      colors.push(color.r, color.g, color.b)
      // Faces outward from the tuft's axis, tilting up as the blade arcs over.
      normals.push(outX, 0.35 + t * 0.5, outZ)
    }

    for (let i = 0; i < BLADE_SEGMENTS; i++) {
      const t0 = i / BLADE_SEGMENTS
      const t1 = (i + 1) / BLADE_SEGMENTS

      if (i === BLADE_SEGMENTS - 1) {
        // Final segment closes to a single point at the tip.
        push(t0, -1)
        push(t0, 1)
        push(t1, 0)
      } else {
        push(t0, -1)
        push(t0, 1)
        push(t1, 1)

        push(t0, -1)
        push(t1, 1)
        push(t1, -1)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.normalizeNormals()
  return geo
}

/**
 * How many tufts are straw rather than green.
 *
 * The warm ones are what make the field read as tufts at all. A scatter of
 * green-on-green is invisible against a green terrain however well-shaped each
 * tuft is — it is the colour break that separates the object from the ground,
 * and it is the first thing the eye picks out of the reference art. Too many
 * and the valley looks parched, so this stays a minority.
 */
const STRAW_SHARE = 0.34

function createGrassField(opts: VegetationOptions, r: () => number): THREE.Group {
  const geo = buildTuftGeometry()

  const placements: Placement[] = []
  const colors: number[] = []
  const tint = new THREE.Color()

  let attempts = 0
  // One entry per *tuft* now, where this used to hold one per blade.
  while (placements.length < GRASS_COUNT && attempts < GRASS_COUNT * 4) {
    attempts++
    const a = r() * Math.PI * 2
    const d = 4 + Math.sqrt(r()) * (WALK_LIMIT + 12)
    const cx = Math.cos(a) * d
    const cz = Math.sin(a) * d
    if (opts.blocked(cx, cz)) continue
    if (!isPlantable(cx, cz)) continue
    // Off the sand, like the trees and the meadow dressing. The grass field has
    // its own placement loop, which is exactly why it was the one that kept
    // carpeting the beach after the other two were fixed.
    if (d > COAST_CLEAR && oceanMask(Math.atan2(cz, cx)) > 0.25) continue

    const h = heightAt(cx, cz)
    // Grass thins out with altitude — bare rock above the tree line.
    if (h > 10 && r() > 0.25) continue

    /*
     * Straw is decided per tuft, but the hue *within* each family stays narrow.
     *
     * The old field spread hue across every clump so it would average into one
     * surface, which is the right call for a lawn and the wrong one here: the
     * point now is that a tuft is a distinct thing sitting on the ground. Two
     * tight families — green and straw — give that separation without the field
     * turning into confetti.
     */
    if (r() < STRAW_SHARE) {
      tint.setHSL(0.09 + r() * 0.035, 0.62 + r() * 0.16, 0.42 + r() * 0.12)
    } else {
      tint.setHSL(0.245 + r() * 0.03, 0.48 + r() * 0.18, 0.34 + r() * 0.12)
    }

    placements.push({
      x: cx,
      y: h,
      z: cz,
      rotationY: r() * Math.PI * 2,
      // Wider spread than the blades had. A tuft is a silhouette, and a range
      // of silhouette sizes is what stops the scatter reading as one stamp.
      scale: 0.8 + r() * 1.1,
    })
    const j = 0.92 + r() * 0.16
    colors.push(tint.r * j, tint.g * j, tint.b * j)
  }

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // Blades are thin slivers; without this they vanish from the shadow map
    // and the grass reads as floating.
    shadowSide: THREE.DoubleSide,
  })

  // Inject wind into the standard lambert vertex shader rather than writing a
  // whole material, so the grass still receives scene lighting and fog.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassTime
    shader.uniforms.uFadeNear = grassFadeNear
    shader.uniforms.uFadeFar = grassFadeFar
    shader.vertexShader = shader.vertexShader
      /*
       * Every uniform is declared in this one replace, and that is not a style
       * choice. `void main() {` occurs once, so a *second* `.replace` aimed at
       * the same anchor silently does nothing — which is exactly how the fade
       * uniforms ended up used but undeclared. The vertex shader then failed to
       * compile, the program failed to link, and the entire grass field
       * vanished from the frame with nothing in the console but a generic
       * `useProgram: program not valid`.
       */
      .replace(
        'void main() {',
        'uniform float uTime;\nuniform float uFadeNear;\nuniform float uFadeFar;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float wx = instanceMatrix[3][0];
          float wz = instanceMatrix[3][2];

          // A broad gust travelling across the field, plus a faster local
          // flutter. Phasing both off world position is what makes the wind
          // read as a wave rolling over the grass rather than every blade
          // twitching independently.
          float travel = (wx * 0.12 + wz * 0.09) - uTime * 1.15;
          float gust = sin(travel) * 0.5 + 0.5;
          float flutter = sin(uTime * 3.1 + wx * 0.9 + wz * 0.7);

          float sway = gust * 0.75 + flutter * 0.18;

          // Bend scales with the square of height so the base stays planted
          // and only the upper blade whips over.
          float t = clamp(transformed.y / ${BLADE_HEIGHT.toFixed(3)}, 0.0, 1.0);
          float bend = t * t * ${BLADE_HEIGHT.toFixed(3)};

          transformed.x += sway * bend * 0.30;
          transformed.z += sway * bend * 0.22;
          // Arcing over shortens the blade's vertical reach.
          transformed.y -= abs(sway) * bend * 0.10;

          /*
           * Shrink each tuft to nothing as it recedes.
           *
           * Fog pales everything in the distance, but a tuft is dark, small and
           * spiky, so out at the treeline the field stopped reading as ground
           * cover and became a black fringe standing *in front of* the fogged
           * trees — which looks for all the world like grass drawn over them.
           * The tufts are not in the wrong place; they are simply too legible
           * to be that far away, a side effect of widening the blades enough to
           * read up close.
           *
           * Scaling rather than fading, because the material is opaque and
           * turning it transparent would move the whole field into the sorted
           * pass — thousands of instances, blending against each other, for a
           * problem that a shrink solves outright. Multiplying the vertex
           * position pulls every vertex toward the tuft's own root at y=0, so
           * it sinks into the ground as it goes rather than dissolving in
           * mid-air.
           *
           * (No backticks in this comment: it lives inside a JS template
           * literal, and one would end the shader string.)
           *
           * Measured from the *camera*, not from the world origin: the player
           * walks the whole valley, and a fixed radius would strip the grass
           * from wherever they happened to be standing.
           */
          vec3 tuftRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float camDist = distance(cameraPosition, tuftRoot);
          transformed *= 1.0 - smoothstep(uFadeNear, uFadeFar, camDist);
        #endif
        `,
      )
  }

  return makeInstancedChunks(geo, placements, {
    material,
    colors,
    // Small chunks: grass is the densest thing in the scene, so tight frustum
    // culling matters more here than anywhere else.
    /*
     * Chunked coarsely, against the instinct that the densest thing in the scene
     * wants the tightest culling.
     *
     * At 14 units the grass alone was 300-odd draw calls for 300k triangles — a
     * thousand triangles per call, which is nowhere near enough work to cover
     * the cost of issuing one. Coarser chunks submit more off-screen blades and
     * are still dramatically cheaper, because the bottleneck was never the
     * triangles.
     */
    chunkSize: 68,
    // Grass never casts — tens of thousands of shadow casters would dominate
    // the shadow pass, and at this blade size the shadows are invisible anyway.
    castShadow: false,
    receiveShadow: true,
    layer: MINOR_LAYER,
  })
}
