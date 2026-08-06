import * as THREE from 'three'
import { rng, setLayer, MINOR_LAYER } from '../assets/style'
import { getGroundTextures } from '../assets/textures'
import {
  getFarmgirlModel,
  getModels,
  instanceModel,
  modelGroup,
  fitToHeight,
  PROP_HEIGHT,
  type LoadedModel,
  type PropPlacement,
} from '../assets/models'
import { createVegetation } from './vegetation'
import { createBridgeModel, createLilyPadModel } from '../assets/bridge'
import { createPebbleScatter } from '../assets/decals'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createAlertMarker } from '../assets/alert-marker'
import { Shopkeeper } from './shopkeeper'
import { PLAYER_HEIGHT } from './player'
import { Skyline } from '../assets/skyline'
import { Water } from './water'
import { createMailboxModel } from '../assets/cottage'
import { GARDEN_BOUNDS, GARDEN_LEVELS, GRID_W, TILE_SIZE } from './farm'
import {
  createTerrainMesh,
  groundHeight,
  heightAt,
  isPlantable,
  isSand,
  isWalkable,
  BRIDGES,
  WATER_LEVEL,
  WALK_LIMIT,
  oceanMask,
  OCEAN_BEARING,
  OCEAN_HALF,
  OCEAN_FEATHER,
} from './terrain'
import {
  FARM_SLOTS,
  NEIGHBOUR_SLOTS,
  PLOT_HX,
  PLAYER_SLOT,
  FENCE_HX,
  FENCE_HZ,
  FENCE_MARGIN,
  GATE_WIDTH,
  LANE_HALF,
  LANE_X_MIN,
  LANE_X_MAX,
  SQUARE_CX,
  SQUARE_HX,
  SQUARE_HZ,
  WELL_POS,
  SHOP_POS,
  FARM_CENTRE,
  BARN_POS,
  BARN_FRONT,
  PASTURE_CENTRE,
  PASTURE_RADIUS,
  gatePos,
  inVillage,
  inAnyPlot,
  onLane,
  type FarmSlot,
} from './village'


/**
 * The village made solid.
 *
 * All geometry here hangs off the slot layout in village.ts: the lane surface,
 * the fencing around every plot, the market square at the south end and the
 * scenery that dresses the street. Nothing in this file invents a position —
 * if a number looks arbitrary it belongs in village.ts instead.
 */

// Re-exported so callers keep importing world positions from one place.
export { SHOP_POS, FARM_CENTRE, BARN_POS }

/**
 * Radial falloff for the lantern pools: bright core easing to nothing well
 * inside the quad, so the disc has no visible square edge.
 */
function makeGlowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.38)')
  g.addColorStop(0.75, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function angleDelta(a: number, b: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Circle colliders the player slides around. */
export interface Obstacle {
  x: number
  z: number
  r: number
  /**
   * Which arriving building this belongs to, if any.
   *
   * The seed stall, the barn and the neighbours are all built at world
   * construction and then *revealed* by level, because they carry keepers,
   * animals and pathing that are far cheaper to hide than to construct at an
   * arbitrary moment mid-session. Hiding a mesh does not hide its collider
   * though, and a player walking into an invisible barn is a worse bug than a
   * barn that arrives early — so every collider a hidden group owns is tagged
   * here and skipped while that group is off.
   */
  owner?: ArrivalId
  /** Set by setArrivalVisible. Skipped by collision while true. */
  off?: boolean
}

/** Things that are not in the world at the start of a new game. */
export type ArrivalId = 'shop' | 'barn' | 'lane' | `neighbour${number}`

/**
 * Axis-aligned wall the player cannot cross — a whole fence run, not a segment.
 *
 * Fences are long and thin, which circles model badly: a line of them either
 * leaves gaps the player squeezes through or makes the wall feel lumpy to walk
 * along, and a plot's perimeter would need dozens of circles where one box does.
 * A box also gives clean sliding, because the push is along a single axis.
 */
export interface Wall {
  /** Centre. */
  x: number
  z: number
  /**
   * Set while the fence this belongs to is not standing.
   *
   * The player's own fence does not exist until they clear the ground for it —
   * the opening is a wood, not a garden — and a wall left live behind a fence
   * that is not drawn is an invisible barrier around an empty field.
   */
  off?: boolean
  /** Half-extents. Thin on whichever axis the run is not along. */
  hx: number
  hz: number
}

export interface World {
  group: THREE.Group
  obstacles: Obstacle[]
  walls: Wall[]
  water: Water
  skyline: Skyline
  /** Lane lanterns, lit by the day cycle. 0 = off, 1 = full. */
  lanterns: { setGlow(v: number): void; update(focus: THREE.Vector3): void }
  /** Bobbing marker over the player's own farm. Needs the camera to billboard. */
  homeMarker: { update(elapsed: number, camera: THREE.Camera): void }
  /**
   * Shop/barn "!" markers, shown when the player is close enough to interact —
   * or from anywhere while `setUrgent` says that spot is where they need to go.
   */
  shopMarkers: {
    setUrgent(id: 'shop' | 'barn', on: boolean): void
    update(elapsed: number, camera: THREE.Camera, playerPos: THREE.Vector3): void
  }
  /** The stallholder beside the seed shop: idles, and waves as you walk up. */
  shopkeeper: Shopkeeper
  farmgirl: Shopkeeper
  /**
   * Re-hedge the yard for the parcels the player holds, and put the outer
   * fence and mailbox up (or, for an empty list, take the lot down — the
   * opening clearing is not cut yet and the ground is still woodland).
   */
  setGardenLevel(level: number): void
  /** Where the upgrade mailbox is standing, for the interaction prompt. */
  readonly mailboxPos: THREE.Vector3
  /**
   * Lay the street out as far as the arrivals have earned.
   *
   * `arrived` is how many neighbours have moved in. The road, its verge and its
   * lamps stop at the last occupied plot, so the village visibly builds toward
   * the player instead of appearing whole the first time anyone moves in.
   */
  setLaneProgress(arrived: number, toSquare?: boolean): void
  /** The washed-up seed crate: where it is, and whether it is trading. */
  readonly storeCratePos: THREE.Vector3
  /** The land office desk on the square, where parcels are bought. */
  readonly landDeskPos: THREE.Vector3
  setStoreCrateVisible(on: boolean): void
  /** Reveal or hide a building that arrives with the player's level. */
  setArrivalVisible(id: ArrivalId, on: boolean): void
  hasArrived(id: ArrivalId): boolean
}

/**
 * Heights for the flat ground decals, as a ladder with real separation.
 *
 * These are all quads laid on terrain that is dead flat at y=0 across the whole
 * village, so any two that overlap at the same height will z-fight. A thousandth
 * of a unit is not separation — at this depth range it is inside the depth
 * buffer's precision, which is what made the market square shimmer.
 */
const Y_LANE = 0.02
const Y_SCATTER = 0.05
const Y_PEBBLE = 0.07

/** The glowing head sits at the top fifth of the lantern post. */
const LANTERN_HEAD_Y_FRACTION = 0.82

/** Half-thickness of a fence run, so the player stops at the rail. */
const FENCE_THICKNESS = 0.14

/** Length of the authored fence panel. Runs are divided into whole panels. */
const FENCE_PANEL = 1

/**
 * How far a tree has to stand off a fenced plot.
 *
 * Roughly the radius of a broadleaf crown at the sizes the scatter uses, so a
 * tree cleared by this much has neither its trunk nor its branches over
 * someone's beds.
 */
const CANOPY_CLEARANCE = 2.4

/**
 * How far to lift the fence so its posts meet the ground.
 *
 * The panel is modelled centred on its own origin, vertically included, so
 * placed at y=0 it would sink half its height into the terrain.
 */
function fenceGroundY() {
  return -getModels().plotFence.geometry.boundingBox!.min.y
}

/**
 * Half the width an authored prop occupies once scaled to `height`.
 *
 * Colliders sized from this track the model instead of a number typed in
 * alongside it, so swapping a building cannot silently leave a gap to walk
 * through or a wall of collision hanging off the end.
 */
function halfWidth(model: LoadedModel, height: number) {
  const box = model.geometry.boundingBox!
  return ((box.max.x - box.min.x) / 2) * fitToHeight(model, height).scale
}

/**
 * Dirt with an independent, non-uniform UV repeat.
 *
 * The lane is ten units wide and seventy-five long, so the shared `tiled()`
 * helper — which repeats squarely — would stretch the grain lengthways.
 */
function dirtMaterial(repeatX: number, repeatZ: number) {
  const tex = getGroundTextures().dirt.clone()
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.repeat.set(repeatX, repeatZ)
  tex.needsUpdate = true
  // Pale, dusty and slightly desaturated — packed earth that has been walked on,
  // not turned soil. Reading clearly *against* the plot beds is the whole job
  // here: when the lane and the beds share a brown, the street disappears.
  return new THREE.MeshLambertMaterial({ map: tex, color: 0xe6cda2 })
}

function groundQuad(w: number, d: number, mat: THREE.Material, x: number, z: number, y = Y_LANE) {
  const geo = new THREE.PlaneGeometry(w, d)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.receiveShadow = true
  return mesh
}

/**
 * A straight run of fence between two points on one axis, optionally with a
 * centred gap for a gate.
 *
 * Panel length is derived from the span rather than fixed, so a run ends flush
 * with the corner instead of overhanging it — with six plots sharing one street,
 * a stray half-metre of fence poking into the lane is very visible. The authored
 * panel is one unit long, so aiming for one panel per unit keeps the stretch
 * within a few percent and the posts undistorted.
 */
function fenceRun(
  fences: PropPlacement[],
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  gapHalf = 0,
  walls?: Wall[],
) {
  const span = to - from
  const count = Math.max(1, Math.round(span / FENCE_PANEL))
  const seg = span / count
  const mid = (from + to) / 2

  /**
   * Colliders are emitted per *contiguous* stretch of fence rather than per
   * segment, so a gate becomes a genuine hole in the collision and not just a
   * hole in the geometry.
   */
  let spanStart: number | null = null
  const closeSpan = (end: number) => {
    if (spanStart === null || !walls) return
    const centre = (spanStart + end) / 2
    const half = Math.abs(end - spanStart) / 2
    if (axis === 'z') {
      walls.push({ x: fixed, z: centre, hx: FENCE_THICKNESS, hz: half })
    } else {
      walls.push({ x: centre, z: fixed, hx: half, hz: FENCE_THICKNESS })
    }
    spanStart = null
  }

  for (let i = 0; i < count; i++) {
    const start = from + seg * i
    const c = start + seg / 2

    if (gapHalf > 0 && Math.abs(c - mid) < gapHalf) {
      closeSpan(start)
      continue
    }
    if (spanStart === null) spanStart = start

    // Stretched along its own length only, so a slightly-off panel width does
    // not fatten the posts or lift the rails.
    const stretch = { x: seg / FENCE_PANEL, y: 1, z: 1 }
    if (axis === 'z') {
      fences.push({ x: fixed, y: fenceGroundY(), z: c, rotationY: Math.PI / 2, scale: stretch })
    } else {
      fences.push({ x: c, y: fenceGroundY(), z: fixed, scale: stretch })
    }
  }
  closeSpan(to)
}

/**
 * Fence one plot, gate facing the lane.
 *
 * Exported because the neighbours bake their fencing into a single mesh — they
 * need the same pieces, built the same way, just collected somewhere else.
 */
export function buildPlotFence(
  s: FarmSlot,
  fences: PropPlacement[],
  walls?: Wall[],
  /**
   * A second opening on the far side, away from the lane.
   *
   * The neighbours' plots front onto the street and are only ever approached
   * from it, so one gate is right. The player's clearing is not on the street:
   * they arrive from the beach, on the opposite side, and a single lane-facing
   * gate meant walking the length of the fence every time they came home.
   */
  outerGate = false,
  /**
   * Half-extents, for a plot that is not full size.
   *
   * The player's clearing starts at a fraction of these and is widened by the
   * mailbox — see GARDEN_FENCE_SCALES. Every other plot in the village is built
   * at the default, which is the size the lane and the row spacing were laid
   * out against.
   */
  hx = FENCE_HX,
  hz = FENCE_HZ,
) {
  /*
   * The gate goes in whichever face the slot fronts the lane with.
   *
   * Written as "the two runs across the gate axis, then the two along it"
   * rather than as four hard-coded sides, because a plot at the *end* of the
   * street faces down it instead of across it — and a fence builder that only
   * knows how to put a gate on an X face would wall that farm in completely.
   */
  if (s.axis === 'x') {
    const inner = s.x + s.inward * hx
    const outer = s.x - s.inward * hx
    fenceRun(fences, 'z', inner, s.z - hz, s.z + hz, GATE_WIDTH / 2, walls)
    fenceRun(fences, 'z', outer, s.z - hz, s.z + hz, outerGate ? GATE_WIDTH / 2 : 0, walls)
    fenceRun(fences, 'x', s.z - hz, s.x - hx, s.x + hx, 0, walls)
    fenceRun(fences, 'x', s.z + hz, s.x - hx, s.x + hx, 0, walls)
    return
  }

  const inner = s.z + s.inward * hz
  const outer = s.z - s.inward * hz
  fenceRun(fences, 'x', inner, s.x - hx, s.x + hx, GATE_WIDTH / 2, walls)
  fenceRun(fences, 'x', outer, s.x - hx, s.x + hx, outerGate ? GATE_WIDTH / 2 : 0, walls)
  fenceRun(fences, 'z', s.x - hx, s.z - hz, s.z + hz, 0, walls)
  fenceRun(fences, 'z', s.x + hx, s.z - hz, s.z + hz, 0, walls)
}

export function createWorld(renderer: THREE.WebGLRenderer): World {
  const group = new THREE.Group()
  const obstacles: Obstacle[] = []
  const walls: Wall[] = []
  /** Every fence panel in the world, collected then drawn in one call. */
  const fences: PropPlacement[] = []

  /*
   * Groups for the things that are not in the world when a new game starts.
   *
   * Built now and revealed later rather than constructed on the level-up,
   * because each one owns a keeper with a rig and an animation mixer, and
   * building those mid-session would hitch the frame at exactly the moment the
   * game is trying to celebrate. Hiding is free; constructing is not.
   */
  const arrivalGroups = new Map<ArrivalId, THREE.Group>()
  const arrivalGroup = (id: ArrivalId) => {
    let g = arrivalGroups.get(id)
    if (!g) {
      g = new THREE.Group()
      arrivalGroups.set(id, g)
      group.add(g)
    }
    return g
  }
  /** Push a collider that belongs to an arrival, so it can be switched off with it. */
  const ownedObstacle = (id: ArrivalId, o: Omit<Obstacle, 'owner'>) => {
    obstacles.push({ ...o, owner: id })
  }

  /*
   * A thicket standing on each building's ground until it arrives.
   *
   * Without this the level-gated buildings leave bare lawns behind them: the
   * player walks a village of empty rectangles and can see exactly where every
   * future building will be. Woodland is the honest answer — it is what the
   * rest of the valley is made of, it is what the player's own farm was cut
   * out of, and it means the village visibly *clears* as it grows rather than
   * popping buildings onto mown grass.
   *
   * The trees are the inverse of the building: shown while it is hidden,
   * removed when it arrives, with their colliders switched the same way.
   */
  const thickets = new Map<ArrivalId, THREE.Group>()
  const thicketObstacles = new Map<ArrivalId, Obstacle[]>()

  /**
   * Scatter trees over one block, tagged to the arrival that will clear it.
   *
   * Additive: an id may be planted several times (the lane is three separate
   * blocks — street, square and turning circle) and each call appends to that
   * id's group and collider list rather than replacing them.
   */
  function plantThicket(id: ArrivalId, cx: number, cz: number, hx: number, hz: number, count: number) {
    const g = thickets.get(id) ?? new THREE.Group()
    const mine = thicketObstacles.get(id) ?? []
    for (let i = 0; i < count; i++) {
      const x = cx + (r() - 0.5) * 2 * hx
      const z = cz + (r() - 0.5) * 2 * hz
      if (!isWalkable(x, z) || isSand(x, z)) continue
      /*
       * Never inside a garden, and never so close that the crown hangs over one.
       *
       * This was the one scatter in the game with no plot test at all — it only
       * asked whether the ground could be stood on. That went unnoticed for as
       * long as the thickets sat in open gaps, and became three trees growing
       * out of the player's own beds the moment the village turned and the farm
       * moved to the head of the lane. The margin is a canopy rather than a
       * pace, because a trunk politely outside the rails with its branches over
       * the crops is the same bug to look at.
       */
      if (onLane(x, z, 1.2) || inAnyPlot(x, z, CANOPY_CLEARANCE)) continue
      const conifer = r() < 0.35
      const model = conifer ? getModels().pine : getModels().tree
      const height = (conifer ? PROP_HEIGHT.pine : PROP_HEIGHT.tree) * (0.8 + r() * 0.45)
      const tree = modelGroup(model, height)
      tree.position.set(x, heightAt(x, z), z)
      tree.rotation.y = r() * Math.PI * 2
      g.add(tree)
      const o: Obstacle = { x, z, r: 0.55 }
      obstacles.push(o)
      mine.push(o)
    }
    thickets.set(id, g)
    thicketObstacles.set(id, mine)
    if (!g.parent) group.add(g)
  }
  const r = rng(20260727)

  // --- sky, terrain, water -------------------------------------------------
  // Skyline first so it is drawn behind everything, and so the ranges are in
  // place before the water builds its reflection of them.
  // The painted ranges leave the sea's arc empty — see SkylineGap. The numbers
  // are terrain's, so the horizon and the heightfield open on exactly the same
  // bearings rather than on two hand-matched guesses.
  // Procedural puff clouds off — the equirectangular skybox already paints them.
  const skyline = new Skyline(
    { at: OCEAN_BEARING, half: OCEAN_HALF, feather: OCEAN_FEATHER },
    { clouds: false },
  )
  group.add(skyline.group)

  group.add(createTerrainMesh())
  const water = new Water()
  group.add(water.mesh)

  // --- bridges -------------------------------------------------------------
  for (const b of BRIDGES) group.add(createBridgeModel(b))

  // --- the lane ------------------------------------------------------------
  // One long quad for the street and one for the square, then a scatter of
  // circles along the verges. The scatter is what stops the lane reading as a
  // rectangle laid on top of the grass.
  //
  // The lane is drawn up to the square's west edge rather than to LANE_X_MAX,
  // so the two quads *abut* instead of overlapping for thirteen units. They are
  // the same material at the same height, so an overlap is a guaranteed z-fight
  // — and no depth offset fixes two identical coplanar surfaces, only not having
  // them does. LANE_X_MAX stays the lane's logical extent for `onLane`.
  const laneDrawMax = Math.min(LANE_X_MAX, SQUARE_CX - SQUARE_HX)
  /*
   * The street itself is an arrival.
   *
   * A dirt road with lamp posts down it, running past six empty lawns, tells the
   * player there is a village here long before there is one — and it is the only
   * thing in the opening that is not woodland, so it reads as the game having
   * forgotten to load. The lane, the square, the worn verges and the lanterns
   * all appear together when the first neighbour moves in.
   */
  /*
   * The market square belongs to the stall, not to the street.
   *
   * On the lane group it appeared with the first neighbour: a swept dirt plaza,
   * lit, dressed with a lamp and a flower bed, and completely empty for several
   * levels until the stall opened on it. An empty market is a stronger statement
   * that something is missing than bare grass ever was.
   */
  const squareMat = dirtMaterial((SQUARE_HX * 2) / 4, (SQUARE_HZ * 2) / 4)
  arrivalGroup('shop').add(groundQuad(SQUARE_HX * 2, SQUARE_HZ * 2, squareMat, SQUARE_CX, 0))

  /*
   * The animal store's yard.
   *
   * The barn stood on the market square until it moved north, and inherited the
   * square's dirt for free — put it on open grass and a working farmyard becomes
   * a barn parked in a meadow, with the keeper standing on lawn. This quad is
   * sized to bridge the lane's north end and the barn doors rather than to frame
   * the building, because the join is the part that would otherwise read wrong:
   * a dirt patch that stops short of the lane looks like a separate place.
   */
  const yardW = 19
  const yardD = 12
  const yardCX = BARN_POS.x * 0.62
  const yardCZ = BARN_POS.z + BARN_FRONT * (yardD / 2 - 1.5)
  const yardMat = dirtMaterial(yardW / 4, yardD / 4)
  arrivalGroup('barn').add(groundQuad(yardW, yardD, yardMat, yardCX, yardCZ))

  /*
   * The verge scatter is a *decal set*, and decals must not write depth.
   *
   * These circles deliberately overlap each other — that is what makes a worn
   * verge read as organic rather than as a row of coins — and they are all
   * coplanar at the same Y with the same material. Two identical coplanar
   * surfaces z-fight no matter what depth offset is applied, which is why the
   * lane and square were made to abut rather than overlap. Overlap cannot be
   * avoided here, so instead: depth-test against the world (so scenery still
   * occludes them) but never depth-*write*, and draw after the ground. Whichever
   * circle rasterises last simply paints over the others, and since they share
   * one dirt texture the overlap is invisible.
   *
   * polygonOffset nudges the whole set in front of the lane quad underneath, so
   * the decals win against it consistently instead of by a 0.03 gap that the
   * depth buffer cannot always resolve at this camera range.
   */
  const scatterMat = dirtMaterial(1, 1)
  scatterMat.depthWrite = false
  scatterMat.polygonOffset = true
  scatterMat.polygonOffsetFactor = -2
  scatterMat.polygonOffsetUnits = -2

  /*
   * Collected, not added.
   *
   * Every one of these was its own Mesh, and the verge takes about two hundred
   * of them — two hundred draw calls, for eight-triangle discs that share one
   * material and never move. They are baked into a single geometry below.
   * Nothing is lost by it: they are already coplanar, already unlit flat discs,
   * and individually far too small for frustum culling to have been earning its
   * keep.
   */
  const scatterParts: THREE.BufferGeometry[] = []
  const scatter = (x: number, z: number, radius: number) => {
    const geo = new THREE.CircleGeometry(radius, 8)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(r() * Math.PI)
    geo.translate(x, Y_SCATTER, z)
    scatterParts.push(geo)
  }

  /**
   * Bake the collected discs into one mesh and hand it to `target`.
   *
   * Takes a group rather than always adding to the lane, because the street now
   * arrives a stretch at a time and its worn edges have to arrive with the road
   * they are worn by — verge dirt drawn along grass with no lane on it reads as
   * a missing road, which is worse than no verge at all.
   */
  const commitScatter = (target: THREE.Object3D) => {
    if (scatterParts.length === 0) return
    const merged = mergeGeometries(scatterParts, false)
    for (const g of scatterParts) g.dispose()
    scatterParts.length = 0
    if (!merged) return
    const mesh = new THREE.Mesh(merged, scatterMat)
    // After the terrain and the lane, before anything standing on the ground.
    mesh.renderOrder = 1
    setLayer(mesh, MINOR_LAYER)
    target.add(mesh)
  }

  /*
   * The street, built in stretches.
   *
   * One neighbour moving in should not lay a road past five empty lawns and
   * light it end to end. Each stretch is its own quad, its own worn verge and
   * its own lamps, and `setLaneProgress` reveals as many as the arrivals have
   * earned — so the village lays its road out toward you as it fills up.
   *
   * `laneMat` still exists for the square; each stretch gets its own material
   * so the dirt tiles at the same density however long the stretch is.
   */
  const laneSegments: { x0: number; x1: number; group: THREE.Group }[] = []
  const LANE_SEGMENT = 9.5
  for (let sx = LANE_X_MIN; sx < laneDrawMax - 0.01; sx += LANE_SEGMENT) {
    const x1 = Math.min(sx + LANE_SEGMENT, laneDrawMax)
    const len = x1 - sx
    const segGroup = new THREE.Group()
    segGroup.visible = false
    segGroup.add(groundQuad(len, LANE_HALF * 2, dirtMaterial(len / 4, (LANE_HALF * 2) / 4), (sx + x1) / 2, 0))
    // The verge that belongs to this stretch, baked into the same group.
    for (let x = sx; x < x1; x += 1.8) {
      for (const sz of [-1, 1]) {
        scatter(x + r() * 1.2, sz * (LANE_HALF - 0.15 + r() * 0.4), 0.34 + r() * 0.24)
      }
    }
    commitScatter(segGroup)
    arrivalGroup('lane').add(segGroup)
    laneSegments.push({ x0: sx, x1, group: segGroup })
  }

  // The square's own edging, committed into the shop group with the plaza it
  // edges — see the note there.
  for (let z = -SQUARE_HZ; z < SQUARE_HZ; z += 1.9) {
    for (const sx of [-1, 1]) {
      scatter(SQUARE_CX + sx * (SQUARE_HX - 0.15 + r() * 0.45), z + r() * 1.3, 0.36 + r() * 0.26)
    }
  }
  commitScatter(arrivalGroup('shop'))

  // Aprons of worn dirt just inside each gate, so the opening reads as a way in
  // rather than a hole in the fence.
  for (const s of FARM_SLOTS) {
    const g = gatePos(s)
    scatter(g.x - s.inward * 0.7, s.z, GATE_WIDTH / 2 - 0.1)
    scatter(g.x - s.inward * 1.8, s.z + (r() - 0.5) * 0.8, 0.9)
  }
  commitScatter(arrivalGroup('lane'))

  // --- seed shop -----------------------------------------------------------
  const shopModel = getModels().shop
  const shop = modelGroup(shopModel, PROP_HEIGHT.shop)
  shop.position.copy(SHOP_POS)
  // The stall is symmetric apart from its painted sign, so the rotation is
  // chosen to put that sign toward the market square — which is the side every
  // player walks in from.
  arrivalGroup('shop').add(shop)
  // Two circles spanning the stall's own width, so the counter blocks the way
  // through while the ends stay walkable. Derived from the model rather than
  // hardcoded, or a swapped stall leaves a gap to stroll through.
  const shopHX = halfWidth(shopModel, PROP_HEIGHT.shop)
  for (const side of [-1, 1]) {
    ownedObstacle('shop', { x: SHOP_POS.x + side * shopHX * 0.5, z: SHOP_POS.z, r: shopHX * 0.55 })
  }

  /*
   * The stallholder, at the square end of the counter.
   *
   * Offset from the stall's own measured half-width rather than a hand-picked
   * position, so a re-scaled or re-modelled stall does not leave them standing
   * inside it. Turned a few degrees back toward the counter — square-on to the
   * square reads as a guard, angled reads as someone working a stall.
   */
  const shopkeeper = new Shopkeeper(
    new THREE.Vector3(SHOP_POS.x + shopHX + 0.5, 0, SHOP_POS.z + 0.55),
    -0.35,
  )
  arrivalGroup('shop').add(shopkeeper.object)
  ownedObstacle('shop', { x: shopkeeper.object.position.x, z: shopkeeper.object.position.z, r: 0.4 })

  // --- animal store + pasture ---------------------------------------------
  const barnModel = getModels().barn
  const barn = modelGroup(barnModel, PROP_HEIGHT.barn)
  barn.position.copy(BARN_POS)
  // Turned to face BARN_FRONT, then nudged off-square so the building is not
  // dead-on to the lane. The nudge is the same either way round.
  barn.rotation.y = (BARN_FRONT > 0 ? 0 : Math.PI) - 0.3
  arrivalGroup('barn').add(barn)
  // Colliders across the barn footprint so the player walks around it. Spread
  // from the model's own width so a swapped barn does not leave a gap to walk
  // through or a wall of collision hanging off the end.
  const barnHX = halfWidth(barnModel, PROP_HEIGHT.barn)
  for (let i = -1; i <= 1; i++) {
    ownedObstacle('barn', { x: BARN_POS.x + i * barnHX * 0.66, z: BARN_POS.z - BARN_FRONT * 0.4, r: barnHX * 0.5 })
  }

  /*
   * The barn's keeper, placed the same way the stall's is: off the model's own
   * measured half-width rather than a literal, so a re-scaled barn cannot leave
   * her standing inside it. Out on the dirt apron in front of the doors and a
   * little left of centre — beside the doors she read as part of the scenery,
   * and the apron is where the player is walking anyway.
   */
  const farmgirl = new Shopkeeper(
    new THREE.Vector3(BARN_POS.x - barnHX * 0.16, 0, BARN_POS.z + BARN_FRONT * 2.35),
    (BARN_FRONT > 0 ? 0 : Math.PI) - 0.32,
    getFarmgirlModel(),
  )
  arrivalGroup('barn').add(farmgirl.object)
  ownedObstacle('barn', { x: farmgirl.object.position.x, z: farmgirl.object.position.z, r: 0.4 })

  // Ring fence around the pasture, with a gap facing the barn so the animals
  // read as belonging to the store.
  const pastureFences: PropPlacement[] = []
  const posts = Math.round((2 * Math.PI * PASTURE_RADIUS) / FENCE_PANEL)
  const chord = ((2 * Math.PI * PASTURE_RADIUS) / posts) * 1.06
  const toBarn = Math.atan2(BARN_POS.z - PASTURE_CENTRE.z, BARN_POS.x - PASTURE_CENTRE.x)
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2
    // Leave a gate on the side nearest the barn.
    if (Math.abs(angleDelta(a, toBarn)) < 0.28) continue

    pastureFences.push({
      x: PASTURE_CENTRE.x + Math.cos(a) * PASTURE_RADIUS,
      y: fenceGroundY(),
      z: PASTURE_CENTRE.z + Math.sin(a) * PASTURE_RADIUS,
      rotationY: -a + Math.PI / 2,
      scale: { x: chord / FENCE_PANEL, y: 1, z: 1 },
    })
  }
  /*
   * The paddock rail is its own instanced batch rather than part of the shared
   * fence run. One batch cannot be half-hidden, and the rest of that run is the
   * player's own fence — which is standing from the first clearing.
   */
  if (pastureFences.length > 0) {
    arrivalGroup('barn').add(instanceModel(getModels().plotFence, pastureFences))
  }

  /*
   * Barnyard clutter: bales, a loose pile and barrels along the barn's flanks.
   *
   * Hand-placed rather than scattered, because this is the one part of the map
   * where the dressing has to look *kept* — a random scatter reads as ground the
   * forest took back, which is the opposite of what a working yard is. Offsets
   * are in barn half-widths for the same reason the keeper's position is: a
   * re-scaled barn should take its clutter with it instead of leaving it
   * standing in a wall.
   */
  const yard: { model: LoadedModel; height: number; ox: number; oz: number; r: number }[] = [
    { model: getModels().haypile, height: PROP_HEIGHT.haypile, ox: 0.92, oz: 1.5, r: 0.7 },
    { model: getModels().haybale, height: PROP_HEIGHT.haybale, ox: -0.86, oz: 0.9, r: 0.45 },
    { model: getModels().haybale, height: PROP_HEIGHT.haybale, ox: -0.94, oz: 1.9, r: 0.45 },
    { model: getModels().barrel, height: PROP_HEIGHT.barrel, ox: 0.58, oz: 2.5, r: 0.32 },
    { model: getModels().barrel, height: PROP_HEIGHT.barrel, ox: 0.74, oz: 2.9, r: 0.32 },
  ]
  for (const item of yard) {
    const x = BARN_POS.x + item.ox * barnHX
    const z = BARN_POS.z + BARN_FRONT * item.oz
    const prop = modelGroup(item.model, item.height)
    prop.position.set(x, 0, z)
    // Turned off the barn's own angle so the clutter reads as stacked against
    // the building rather than dropped on a grid beside it.
    prop.rotation.y = barn.rotation.y + (r() - 0.5) * 0.9
    arrivalGroup('barn').add(prop)
    ownedObstacle('barn', { x, z, r: item.r })
  }

  /*
   * The player's fence, built apart from every other one.
   *
   * It is the only fence in the world that is not there from the start: the
   * game opens on unclaimed woodland, and the rails go up when the clearing is
   * cut. That means its own batch — an InstancedMesh cannot be half-drawn — and
   * its own slice of the wall list, so the collision can be switched off with
   * the mesh.
   */
  /*
   * One fence per garden level, all built now and all hidden.
   *
   * The garden grows 4x4 -> 7x7 -> 10x10 and the rails follow it, so the yard
   * visibly gets bigger when an upgrade is bought rather than standing at full
   * size around three-quarters of nothing. Rebuilding an InstancedMesh and
   * splicing the wall list mid-session to do that would be fiddly and the sort
   * of thing that leaves a collider behind; three complete fences switched by
   * visibility cannot get out of step with themselves.
   *
   * Each is centred on its own band of tiles, which is not always the middle of
   * the plot — see GARDEN_BOUNDS for why level 2 sits half a tile off.
   */
  const gardenFences = GARDEN_LEVELS.map((_, i) => {
    const b = GARDEN_BOUNDS[i]
    const half = ((b.hi - b.lo + 1) * TILE_SIZE) / 2 + FENCE_MARGIN
    const offset = ((b.lo + b.hi) / 2 - (GRID_W - 1) / 2) * TILE_SIZE
    const slot: FarmSlot = { ...PLAYER_SLOT, x: PLAYER_SLOT.x + offset, z: PLAYER_SLOT.z + offset }

    const props: PropPlacement[] = []
    const firstWall = walls.length
    buildPlotFence(slot, props, walls, true, half, half)
    const ringWalls = walls.slice(firstWall)
    const ringGroup = new THREE.Group()
    ringGroup.add(instanceModel(getModels().plotFence, props))
    ringGroup.visible = false
    for (const w of ringWalls) w.off = true
    group.add(ringGroup)
    return { group: ringGroup, walls: ringWalls, slot, half }
  })

  /*
   * The mailbox the upgrade is bought at.
   *
   * Stands just outside the gate, so it is the first thing passed on the way in
   * and the last on the way out, and it moves with the fence as the garden
   * grows. Its collider travels with it — a mailbox left standing where the old
   * gate used to be is an invisible post in the middle of the new lawn.
   */
  const mailbox = createMailboxModel(0xd8b25a)
  mailbox.object.visible = false
  group.add(mailbox.object)
  const mailboxObstacle: Obstacle = { x: 0, z: 0, r: 0.35, off: true }
  obstacles.push(mailboxObstacle)
  const mailboxPos = new THREE.Vector3()

  /** Put the mailbox beside the gate of whichever fence is standing. */
  const placeMailbox = (ring: (typeof gardenFences)[number]) => {
    /*
     * At the *outer* gate, not the lane one.
     *
     * The lane-side gate is the one the village arrives through; the outer gate
     * is the one the player uses, because they wake on the beach and walk in
     * from that side for the whole opening. A mailbox they only meet after
     * walking the length of their own fence is a mailbox they do not meet.
     */
    const side = -PLAYER_SLOT.inward
    const gateX = ring.slot.x + side * ring.half
    const x = gateX + side * 0.85
    const z = ring.slot.z - GATE_WIDTH / 2 - 0.55
    mailbox.object.position.set(x, groundHeight(x, z), z)
    mailbox.object.rotation.y = PLAYER_SLOT.inward * (Math.PI / 2)
    mailboxObstacle.x = x
    mailboxObstacle.z = z
    mailboxPos.set(x, groundHeight(x, z), z)
  }

  // Signpost beside the gate, turned to face along the lane so it is readable
  // to someone walking up the street rather than edge-on.
  const playerGate = gatePos(PLAYER_SLOT)
  const sign = modelGroup(getModels().signpost, PROP_HEIGHT.signpost)
  sign.position.set(playerGate.x + PLAYER_SLOT.inward * 0.5, 0, PLAYER_SLOT.z + GATE_WIDTH / 2 + 0.7)
  sign.rotation.y = PLAYER_SLOT.inward * (Math.PI / 2)
  group.add(sign)
  obstacles.push({ x: sign.position.x, z: sign.position.z, r: 0.3 })

  /*
   * The store crate, washed up on the sand behind the farm.
   *
   * It trades seeds for the stretch between the player outgrowing their first
   * garden and the real stall opening on the square — a gap that otherwise has
   * them expanding a farm they cannot buy anything to fill. A crate on the
   * beach is the right shape for that: it is obviously temporary, it arrives
   * the way everything else in this game's opening arrives, and it costs the
   * village nothing to explain.
   *
   * Placed by walking out to the water and stepping back, rather than by
   * stopping at the first sand.
   *
   * `isSand` turns true well before the beach *looks* like beach — the terrain
   * blends over several units — so stopping there left the crate parked on the
   * grass verge under the treeline, which reads as delivered rather than washed
   * up. Walking to the last dry ground before the sea and backing off a few
   * paces puts it out on the open sand where the tide would have left it, and
   * it stays correct wherever the coast happens to run.
   */
  const storeCrate = modelGroup(getModels().storeCrate, PROP_HEIGHT.storeCrate)
  const storeCratePos = new THREE.Vector3()
  {
    const outward = -PLAYER_SLOT.inward
    const cz = PLAYER_SLOT.z + 3.5
    let cx = PLAYER_SLOT.x + outward * (FENCE_HX + 2)
    let furthest = cx
    for (let i = 0; i < 80; i++) {
      const nx = cx + outward * 0.6
      // Stop at the surf, not in it.
      if (!isWalkable(nx, cz) || heightAt(nx, cz) < WATER_LEVEL + 0.2) break
      cx = nx
      if (isSand(cx, cz)) furthest = cx
    }
    // Back from the waterline so it is not standing in the wash.
    const x = furthest - outward * 3.5
    storeCratePos.set(x, groundHeight(x, cz), cz)
  }
  storeCrate.position.copy(storeCratePos)
  // Turned to face the farm, so the player walks up to its front.
  storeCrate.rotation.y = PLAYER_SLOT.inward * (Math.PI / 2)
  storeCrate.visible = false
  group.add(storeCrate)
  const crateObstacle: Obstacle = { x: storeCratePos.x, z: storeCratePos.z, r: 0.9, off: true }
  obstacles.push(crateObstacle)

  // --- street furniture ----------------------------------------------------
  // Lanterns down both verges, offset half a row so the two sides alternate
  // rather than lining up in pairs.
  const lanternBox = getModels().lantern.geometry.boundingBox!
  const lanternH = lanternBox.max.y - lanternBox.min.y
  const lanternScale = PROP_HEIGHT.lantern / lanternH
  const lanterns: PropPlacement[] = []
  const lanternObstacles: Obstacle[] = []

  for (let i = 0; ; i++) {
    const x = LANE_X_MIN + 6 + i * 9.5
    if (x > laneDrawMax - 4) break
    // Alternating verges: north side, then south, so the two rows interleave
    // down the street rather than standing in facing pairs.
    const sz = i % 2 === 0 ? -1 : 1
    const z = sz * (LANE_HALF - 0.45)
    lanterns.push({
      x,
      // Modelled centred on its own origin, so lift it by half its scaled height.
      y: -lanternBox.min.y * lanternScale,
      z,
      // Face the lane, so the two verges are mirror images rather than clones.
      rotationY: sz > 0 ? Math.PI : 0,
      scale: lanternScale,
    })
    // Held individually: a lamp that has not arrived must not block the road.
    const o: Obstacle = { x, z, r: 0.3, off: true }
    obstacles.push(o)
    lanternObstacles.push(o)
  }

  const lanternMesh = instanceModel(getModels().lantern, lanterns)
  arrivalGroup('lane').add(lanternMesh)

  /**
   * The lantern glows from its head only.
   *
   * It is one material for the whole model, so an emissive map alone lights the
   * post and the stone base as brightly as the glass — the entire lamp turns
   * into a light bulb. There is no separate glass material to key off, so the
   * mask comes from local height instead: the geometry spans -0.5 to 0.5 and the
   * lantern housing is the top fifth of it. Patched into the shader rather than
   * faked with a second mesh, so it costs nothing and still instances.
   */
  const lanternMaterial = (lanternMesh.material as THREE.MeshStandardMaterial).clone()
  lanternMaterial.emissiveMap = lanternMaterial.map
  lanternMaterial.emissive.setHex(0xffe6a8)
  lanternMaterial.emissiveIntensity = 0
  lanternMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLampY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLampY;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(0.12, 0.30, vLampY);',
      )
  }
  lanternMesh.material = lanternMaterial

  /*
   * The light a lit lamp actually throws.
   *
   * Two layers, because each is wrong alone. The pool disc is the *visible
   * radius* — an additive radial gradient on the ground that reads from any
   * distance — but it illuminates nothing. The point lights genuinely light the
   * player, fences and dirt as they pass — but real lights are a per-fragment
   * cost on every lit material, so nine of them all night is a tax on the whole
   * frame. So the discs are one instanced draw for every lantern, and a pool of
   * three real lights leapfrogs between whichever lanterns are nearest the
   * player. Beyond a few metres a pool disc and a point light are
   * indistinguishable, which is what makes the swap invisible.
   */
  const glowTexture = makeGlowTexture()
  const poolGeo = new THREE.PlaneGeometry(5.2, 5.2)
  poolGeo.rotateX(-Math.PI / 2)
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: 0xffc878,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const pools = new THREE.InstancedMesh(poolGeo, poolMaterial, lanterns.length)
  {
    const m = new THREE.Matrix4()
    lanterns.forEach((l, i) => {
      // Fractionally above the lane decals so the gradient never z-fights.
      pools.setMatrixAt(i, m.makeTranslation(l.x, 0.09, l.z))
    })
    pools.instanceMatrix.needsUpdate = true
    pools.computeBoundingSphere()
    pools.updateMatrix()
    pools.matrixAutoUpdate = false
    pools.visible = false
    /*
     * Into the lane group with the posts.
     *
     * The pools and the point lights were left on the world group when the
     * lanterns moved, so before the street arrives the ground still lit up in
     * circles with nothing standing over them — lamplight from lamps that do
     * not exist, which is a far stranger sight than an unlit street.
     */
    arrivalGroup('lane').add(pools)
  }

  /*
   * The visible shaft of light between head and pool — the "volumetric" part.
   *
   * Not raymarched: an open cone, gradient-textured from bright at the head to
   * nothing at the rim, additive, depth-read but not depth-written. From the
   * game's shallow camera pitch that is exactly what a dusty light cone looks
   * like, at the cost of one instanced draw. The same glow value that lights
   * the glass fades the cones in, and the whole mesh is hidden by day.
   */
  const coneGeo = new THREE.CylinderGeometry(0.16, 2.05, LANTERN_HEAD_Y_FRACTION * PROP_HEIGHT.lantern, 20, 1, true)
  // Gradient along height: alpha rides the V coordinate in the shader patch.
  const coneMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  })
  const coneH = LANTERN_HEAD_Y_FRACTION * PROP_HEIGHT.lantern
  coneMaterial.onBeforeCompile = (shader) => {
    // The gradient rides local height, not UVs — an unmapped basic material's
    // shader never declares the uv attribute, so keying off it fails to compile.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vConeT;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvConeT = position.y / ${coneH.toFixed(3)} + 0.5;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vConeT;')
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `#include <dithering_fragment>
        // Bright at the lamp head (t=1), gone before the ground — the pool disc
        // takes over there. Squared so the cone's edge stays soft.
        gl_FragColor.a *= vConeT * vConeT * 0.85;`,
      )
  }
  const cones = new THREE.InstancedMesh(coneGeo, coneMaterial, lanterns.length)
  {
    const m = new THREE.Matrix4()
    lanterns.forEach((l, i) => {
      // Cylinder geometry is centred on its origin: lift by half its height so
      // the narrow top meets the lantern head.
      cones.setMatrixAt(i, m.makeTranslation(l.x, (LANTERN_HEAD_Y_FRACTION * PROP_HEIGHT.lantern) / 2, l.z))
    })
    cones.instanceMatrix.needsUpdate = true
    cones.computeBoundingSphere()
    cones.updateMatrix()
    cones.matrixAutoUpdate = false
    cones.visible = false
    arrivalGroup('lane').add(cones)
  }

  const LIGHT_BUDGET = 3
  const LANTERN_HEAD_Y = PROP_HEIGHT.lantern * LANTERN_HEAD_Y_FRACTION
  const pointLights = Array.from({ length: LIGHT_BUDGET }, () => {
    const light = new THREE.PointLight(0xffd9a0, 0, 8.5, 2)
    // Same reason as the pools above: a hidden group's lights still light.
    arrivalGroup('lane').add(light)
    return light
  })

  let glow = 0
  const lanternGlow = {
    setGlow(v: number) {
      lanternMaterial.emissiveIntensity = v
      glow = v
      // The pool fades with the same value that lights the glass, so the
      // radius appears exactly when the lamp does.
      poolMaterial.opacity = Math.max(0, v - 0.05) * 0.5
      pools.visible = poolMaterial.opacity > 0.01
      // The shaft is fainter than the pool — light in the air scatters far
      // less than light on a surface, and matching them makes the cone read
      // as a solid object.
      coneMaterial.opacity = Math.max(0, v - 0.1) * 0.16
      cones.visible = coneMaterial.opacity > 0.005
    },

    /** Move the real lights to the lanterns nearest the player. */
    update(focus: THREE.Vector3) {
      if (glow < 0.1) {
        for (const light of pointLights) light.intensity = 0
        return
      }
      const nearest = lanterns
        .map((l) => ({ l, d: Math.hypot(focus.x - l.x, focus.z - l.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, LIGHT_BUDGET)
      pointLights.forEach((light, i) => {
        const spot = nearest[i]
        if (!spot) {
          light.intensity = 0
          return
        }
        light.position.set(spot.l.x, LANTERN_HEAD_Y, spot.l.z)
        light.intensity = glow * 14
      })
    },
  }

  /*
   * Benches and flower beds facing the street from the square.
   *
   * Into the lane's arrival group with the square itself. Left on the world
   * group they stood in open grass from the first frame — a lamp post, two
   * benches and a pair of planters arranged around a market square that does
   * not exist yet, which reads as the village having failed to load rather than
   * as a village that has not been built.
   */
  const benchFit = fitToHeight(getModels().bench, PROP_HEIGHT.bench)
  const bedFit = fitToHeight(getModels().flowerBed, PROP_HEIGHT.flowerBed)
  const benches: PropPlacement[] = []
  const beds: PropPlacement[] = []
  for (const sx of [-1, 1]) {
    const bx = sx * 5.8
    const bz = SQUARE_HZ - 2.2
    benches.push({
      x: bx,
      y: benchFit.groundY,
      z: bz,
      // Turned so the seat faces the lane rather than across it.
      rotationY: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: benchFit.scale,
    })
    ownedObstacle('lane', { x: bx, z: bz, r: 0.6 })

    beds.push({ x: SQUARE_CX + 2, y: bedFit.groundY, z: sx * 8.5, scale: bedFit.scale })
  }
  arrivalGroup('lane').add(instanceModel(getModels().bench, benches))
  arrivalGroup('lane').add(instanceModel(getModels().flowerBed, beds))

  /*
   * The land office: a workbench on the square.
   *
   * Buying ground is the one purchase the player cannot make by walking up to
   * the thing — the parcels are scattered across the valley and most are behind
   * trees. It needs a counter, and the square is where every other counter in
   * this game already is.
   */
  const landDesk = modelGroup(getModels().workbench, PROP_HEIGHT.workbench)
  const landDeskPos = new THREE.Vector3(SQUARE_CX - SQUARE_HX + 3, 0, -SQUARE_HZ + 2.4)
  landDesk.position.set(landDeskPos.x, groundHeight(landDeskPos.x, landDeskPos.z), landDeskPos.z)
  landDesk.rotation.y = Math.PI * 0.15
  arrivalGroup('lane').add(landDesk)
  ownedObstacle('lane', { x: landDeskPos.x, z: landDeskPos.z, r: 0.7 })

  /*
   * A lantern closing off the north end of the lane, inside a pebbled circle.
   *
   * A stone rabbit stood here. It went with the rabbits, and the pebble ring it
   * sat in could not simply be left empty — the lane is a corridor a hundred
   * units long and the eye follows it to the end, so nothing there reads as
   * unfinished rather than as open. A lantern is the right size to close the
   * vista, it is already the street's own furniture (see the pairs down the
   * lane), and after dark it is the thing that makes the far end legible at all.
   */
  const laneEnd = modelGroup(getModels().lantern, PROP_HEIGHT.lantern)
  laneEnd.position.copy(WELL_POS)
  arrivalGroup('lane').add(laneEnd)
  ownedObstacle('lane', { x: WELL_POS.x, z: WELL_POS.z, r: 0.3 })
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const pebbles = createPebbleScatter(r)
    pebbles.position.set(
      WELL_POS.x + Math.cos(a) * (2.6 + r() * 1.4),
      Y_PEBBLE,
      WELL_POS.z + Math.sin(a) * (2.6 + r() * 1.4),
    )
    setLayer(pebbles, MINOR_LAYER)
    arrivalGroup('lane').add(pebbles)
  }

  // --- scattered vegetation ------------------------------------------------
  // Rejection sampling against the heightfield: a candidate is discarded if it
  // is underwater, on a cliff, or anywhere the village has built.
  const blocked = (x: number, z: number) =>
    inVillage(x, z, 2) || inAnyPlot(x, z, 1.5) || onLane(x, z, 1.5)

  // Trees, bushes, rocks and grass are instanced — see vegetation.ts. That is
  // what makes a forest of this density affordable.
  group.add(createVegetation({ blocked, obstacles, renderer }))

  /*
   * Deadfall: fallen logs, and the stumps they came off.
   *
   * Authored, so each species is gathered and drawn as one instanced batch
   * rather than added as dozens of separate groups of meshes. The two are
   * scattered together on one pass because that is the story they tell — a
   * stump on its own is a tree that vanished, whereas a stump with a trunk
   * lying near it is a clearing someone worked.
   */
  const deadfall = [
    { model: getModels().log, height: PROP_HEIGHT.log, count: 72, radius: 0.45 },
    { model: getModels().stump, height: PROP_HEIGHT.stump, count: 38, radius: 0.4 },
  ]
  let attempts = 0
  for (const kind of deadfall) {
    const fit = fitToHeight(kind.model, kind.height)
    const placements: PropPlacement[] = []
    attempts = 0
    while (placements.length < kind.count && attempts < kind.count * 36) {
      attempts++
      const a = r() * Math.PI * 2
      const d = 20 + Math.sqrt(r()) * WALK_LIMIT
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (blocked(x, z) || !isPlantable(x, z)) continue

      const jitter = 0.8 + r() * 0.5
      placements.push({
        x,
        y: heightAt(x, z) + fit.groundY * jitter,
        z,
        rotationY: r() * Math.PI * 2,
        scale: fit.scale * jitter,
      })
      obstacles.push({ x, z, r: kind.radius * jitter })
    }
    if (placements.length > 0) group.add(instanceModel(kind.model, placements))
  }

  // --- lily pads on the lakes ---------------------------------------------
  let pads = 0
  attempts = 0
  while (pads < 62 && attempts < 4200) {
    attempts++
    const a = r() * Math.PI * 2
    const d = 20 + Math.sqrt(r()) * WALK_LIMIT
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    // Want water that is shallow-ish and definitely not walkable land.
    const h = heightAt(x, z)
    if (h > WATER_LEVEL - 0.4 || h < WATER_LEVEL - 2.6) continue
    if (isWalkable(x, z)) continue
    /*
     * Fresh water only. The depth test above is satisfied by the sea's shallows
     * as readily as by a pond, and the first coast came out with lily pads
     * floating in the surf — they are a still-water plant, and the ocean is the
     * one body of water in the valley that is visibly not still.
     */
    if (oceanMask(Math.atan2(z, x)) > 0.2) continue
    const pad = createLilyPadModel(pads * 23 + 7)
    pad.position.set(x, WATER_LEVEL, z)
    setLayer(pad, MINOR_LAYER)
    group.add(pad)
    pads++
  }

  // --- fences --------------------------------------------------------------
  // The player's plot and the pasture ring, in one draw call. The neighbours
  // build their own batch — they are constructed after the world, so they cannot
  // contribute to this one.
  group.add(instanceModel(getModels().plotFence, fences))

  const homeMarker = createHomeMarker(group)
  const shopMarkers = createShopMarkers(group, shopkeeper.object.position, farmgirl.object.position, (id) => arrivalGroups.get(id)?.visible ?? false)

  /*
   * Everything starts hidden except the world itself.
   *
   * The default has to be *absent*, not present: a new game opens on an empty
   * coast, and anything that defaults to visible would be standing there for the
   * frames between world construction and main.ts getting round to applying the
   * player's level.
   */
  /*
   * Every block of the village, wooded until the thing that stands on it comes.
   *
   * The first pass only covered the buildings, which left the ground *between*
   * them as open lawn — and open lawn inside a forest is a clearing, so the
   * village read as already cleared with a few copses dotted about. The whole
   * footprint has to be wood or none of it should be: what the player sees at
   * level one is unbroken forest, and each unlock cuts a block out of it.
   *
   * The lane's own corridor is the biggest of them and the one that was most
   * obviously missing — the street was a bare strip running the length of the
   * map before a single neighbour had moved in.
   */
  plantThicket('shop', SHOP_POS.x, SHOP_POS.z, 10, 8, 46)
  plantThicket('barn', (BARN_POS.x + PASTURE_CENTRE.x) / 2, BARN_POS.z, 17, 11, 76)
  plantThicket('lane', (LANE_X_MIN + LANE_X_MAX) / 2, 0, (LANE_X_MAX - LANE_X_MIN) / 2, LANE_HALF + 2.5, 96)
  // The square, and the turning circle at the north end — both part of the
  // street, both bare strips of nothing without this.
  plantThicket('lane', SQUARE_CX, 0, SQUARE_HX + 1, SQUARE_HZ + 1, 30)
  plantThicket('lane', LANE_X_MIN + 4, 0, 7, 10, 26)

  for (const g of arrivalGroups.values()) g.visible = false
  for (const o of obstacles) if (o.owner) o.off = true

  return {
    group,
    obstacles,
    walls,
    water,
    skyline,
    lanterns: lanternGlow,
    homeMarker,
    shopMarkers,
    shopkeeper,
    farmgirl,
    mailboxPos,
    storeCratePos,
    landDeskPos,
    setLaneProgress(arrived: number, toSquare = false) {
      /*
       * How far the road has to reach.
       *
       * Out to the far fence of the last occupied plot, plus a little, so the
       * stretch a neighbour arrives with actually passes their gate rather than
       * stopping at their hedge. Nobody in yet means no road at all.
       */
      let reach = LANE_X_MIN
      for (let i = 0; i < Math.min(arrived, NEIGHBOUR_SLOTS.length); i++) {
        reach = Math.max(reach, NEIGHBOUR_SLOTS[i].x + PLOT_HX + 3)
      }
      /*
       * The square pulls the road all the way to it.
       *
       * Once the stall is open the market square is standing there in full, and
       * a paved square at the end of a road that stops two plots short reads as
       * unfinished ground rather than as a village still growing. Whatever the
       * arrivals have earned, the street reaches whatever is already built at
       * the far end of it — with the lamps that light the walk.
       */
      const open = toSquare || arrived > 0
      if (toSquare) reach = laneDrawMax
      for (const seg of laneSegments) seg.group.visible = open && seg.x0 < reach

      // InstancedMesh draws its first `count` instances, and the lamps were
      // generated in order along the street — so the count *is* the reveal.
      const lit = open ? lanterns.filter((l) => l.x < reach).length : 0
      lanternMesh.count = lit
      pools.count = lit
      cones.count = lit
      lanternObstacles.forEach((o, i) => (o.off = i >= lit))
    },
    setStoreCrateVisible(on: boolean) {
      storeCrate.visible = on
      crateObstacle.off = !on
    },
    setGardenLevel(level: number) {
      const index = level > 0 ? Math.min(gardenFences.length, level) - 1 : -1
      gardenFences.forEach((ring, i) => {
        const on = i === index
        ring.group.visible = on
        for (const w of ring.walls) w.off = !on
      })
      mailbox.object.visible = index >= 0
      mailboxObstacle.off = index < 0
      if (index >= 0) placeMailbox(gardenFences[index])
    },
    setArrivalVisible(id: ArrivalId, on: boolean) {
      const g = arrivalGroups.get(id)
      if (!g) return
      g.visible = on
      // The collider has to move with the mesh, or the player walks into a barn
      // that is not there yet. See the note on Obstacle.owner.
      for (const o of obstacles) if (o.owner === id) o.off = !on

      // ...and the wood standing on that ground is the exact inverse.
      const wood = thickets.get(id)
      if (wood) wood.visible = !on
      for (const o of thicketObstacles.get(id) ?? []) o.off = on
    },
    hasArrived(id: ArrivalId) {
      return arrivalGroups.get(id)?.visible ?? false
    },
  }
}

/**
 * A gold chevron floating over the player's plot.
 *
 * Six near-identical farms share the street, and after a camera spin "which one
 * is mine" costs a genuine scan — the marker answers it from anywhere. Unlit and
 * warm-gold so it reads at noon and at midnight, bobbing so the eye finds it in
 * motion, and billboarded because a flat chevron seen edge-on is a line.
 */
/**
 * A "!" over each interactable building, shown only within reach.
 *
 * The prompt at the bottom of the screen already says "E — Open seed shop", but
 * it does not say *where*: a player who has not found the stall yet has nothing
 * to walk toward, and one standing beside it has to read text to learn they can
 * act. A marker over the building itself answers both from the world.
 *
 * Only inside interaction range, deliberately. A permanent marker is scenery —
 * the eye stops seeing it — whereas one that appears as you arrive is a state
 * change, which is what actually draws attention.
 */
function createShopMarkers(
  parent: THREE.Group,
  shopkeeperAt: THREE.Vector3,
  barnKeeperAt: THREE.Vector3,
  /** Whether that building is in the world yet — see setArrivalVisible. */
  arrived: (id: ArrivalId) => boolean,
) {
  /*
   * Over the keeper's head, not over the roof.
   *
   * These used to float several metres above the building — 5.6 for the barn —
   * from when the buildings were the only thing there to point at. With a
   * villager standing at each door the marker reads as *someone wanting a word*
   * rather than as a waypoint hanging in the sky, and it lands at eye level
   * instead of above the treeline.
   */
  const overHead = (at: THREE.Vector3) => new THREE.Vector3(at.x, at.y + PLAYER_HEIGHT + 0.55, at.z)
  const spots: { id: 'shop' | 'barn'; at: THREE.Vector3; marker: THREE.Group; range: number }[] = [
    // Ranges match the interaction checks in main: SHOP_RANGE and the barn's
    // click radius. A marker that lights up outside the range it advertises is
    // worse than none.
    { id: 'shop', at: overHead(shopkeeperAt), range: 4.2, marker: createAlertMarker(1.2) },
    { id: 'barn', at: overHead(barnKeeperAt), range: 5.2, marker: createAlertMarker(1.2) },
    // NOTE: these are hidden along with their building — see markersFor below.
  ]
  for (const s of spots) {
    s.marker.position.copy(s.at)
    parent.add(s.marker)
  }

  /**
   * Spots currently shouting regardless of distance.
   *
   * The range rule above is right for "you could interact with this", and wrong
   * for "you are stuck until you go there". A full barn stops every harvest on
   * the farm, and the fix is at the stall — which the player may never have
   * walked to, and cannot see from their own plot. While something is urgent its
   * marker is a beacon rather than a proximity prompt; the materials already
   * ignore depth, so it shows over the buildings between here and there.
   */
  const urgent = new Set<'shop' | 'barn'>()

  return {
    setUrgent(id: 'shop' | 'barn', on: boolean) {
      if (on) urgent.add(id)
      else urgent.delete(id)
    },
    update(elapsed: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
      for (const s of spots) {
        // A marker over a building that has not arrived is a "!" hovering above
        // empty grass, pointing at nothing the player can act on.
        if (!arrived(s.id)) {
          s.marker.visible = false
          continue
        }
        const near = Math.hypot(playerPos.x - s.at.x, playerPos.z - s.at.z) < s.range
        const shout = urgent.has(s.id)
        s.marker.visible = near || shout
        if (!s.marker.visible) continue
        // Bob, and face the camera — the same treatment the raid markers get,
        // so the two read as one visual language. Urgent bobs harder, which is
        // the only difference between "you can use this" and "go here now".
        s.marker.position.y = s.at.y + Math.sin(elapsed * (shout && !near ? 5 : 3.2)) * (shout && !near ? 0.3 : 0.16)
        s.marker.quaternion.copy(camera.quaternion)
      }
    },
  }
}

function createHomeMarker(parent: THREE.Group) {
  // Downward-pointing chevron: a fat V.
  const shape = new THREE.Shape()
  shape.moveTo(-0.62, 0.78)
  shape.lineTo(0, 0)
  shape.lineTo(0.62, 0.78)
  shape.lineTo(0.62, 1.18)
  shape.lineTo(0, 0.42)
  shape.lineTo(-0.62, 1.18)
  shape.closePath()
  /*
   * Flat, not extruded — and that is the fix for the flicker.
   *
   * It was two ExtrudeGeometry solids, the dark backing scaled up and nudged
   * 0.02 behind. At those depths the backing's front face landed *inside* the
   * gold mesh's own volume, so across the whole overlap two near-coplanar
   * surfaces competed for the depth test and the marker sparkled. Extrusion
   * bought nothing to begin with: the mesh is billboarded to the camera every
   * frame, so it is never seen at the grazing angle the depth was there for.
   *
   * Two flat shapes at distinct z, with the outline not writing depth and an
   * explicit draw order, cannot fight by construction.
   */
  const geo = new THREE.ShapeGeometry(shape)

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xf6c752, toneMapped: false }),
  )
  // A darker copy behind, as a cartoon outline.
  const backing = new THREE.Mesh(
    geo.clone().scale(1.18, 1.18, 1),
    new THREE.MeshBasicMaterial({
      color: 0x8a5a14,
      toneMapped: false,
      // Never contributes depth, so the gold face in front of it has nothing
      // to tie with.
      depthWrite: false,
    }),
  )
  backing.position.z = -0.05
  backing.renderOrder = 3
  mesh.add(backing)
  mesh.renderOrder = 4

  const anchor = new THREE.Group()
  anchor.add(mesh)
  // Over the middle of the player's plot, clear of the tallest crops.
  anchor.position.set(PLAYER_SLOT.x, 5.4, PLAYER_SLOT.z)
  parent.add(anchor)

  return {
    update(elapsed: number, camera: THREE.Camera) {
      mesh.position.y = Math.sin(elapsed * 2.1) * 0.28
      mesh.quaternion.copy(camera.quaternion)
    },
  }
}
