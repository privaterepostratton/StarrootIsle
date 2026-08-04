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
import {
  createTerrainMesh,
  heightAt,
  isPlantable,
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
  PLAYER_SLOT,
  FENCE_HX,
  FENCE_HZ,
  GATE_WIDTH,
  LANE_HALF,
  LANE_Z_MIN,
  LANE_Z_MAX,
  SQUARE_CZ,
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
}

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
export function buildPlotFence(s: FarmSlot, fences: PropPlacement[], walls?: Wall[]) {
  const inner = s.x + s.inward * FENCE_HX
  const outer = s.x - s.inward * FENCE_HX
  fenceRun(fences, 'z', inner, s.z - FENCE_HZ, s.z + FENCE_HZ, GATE_WIDTH / 2, walls)
  fenceRun(fences, 'z', outer, s.z - FENCE_HZ, s.z + FENCE_HZ, 0, walls)
  fenceRun(fences, 'x', s.z - FENCE_HZ, s.x - FENCE_HX, s.x + FENCE_HX, 0, walls)
  fenceRun(fences, 'x', s.z + FENCE_HZ, s.x - FENCE_HX, s.x + FENCE_HX, 0, walls)
}

export function createWorld(renderer: THREE.WebGLRenderer): World {
  const group = new THREE.Group()
  const obstacles: Obstacle[] = []
  const walls: Wall[] = []
  /** Every fence panel in the world, collected then drawn in one call. */
  const fences: PropPlacement[] = []
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
  // The lane is drawn from the square's north edge rather than from LANE_Z_MIN,
  // so the two quads *abut* instead of overlapping for thirteen units. They are
  // the same material at the same height, so an overlap is a guaranteed z-fight
  // — and no depth offset fixes two identical coplanar surfaces, only not having
  // them does. LANE_Z_MIN stays the lane's logical extent for `onLane`.
  const laneDrawMin = Math.max(LANE_Z_MIN, SQUARE_CZ + SQUARE_HZ)
  const laneLength = LANE_Z_MAX - laneDrawMin
  const laneMat = dirtMaterial((LANE_HALF * 2) / 4, laneLength / 4)
  group.add(
    groundQuad(LANE_HALF * 2, laneLength, laneMat, 0, (laneDrawMin + LANE_Z_MAX) / 2),
  )

  const squareMat = dirtMaterial((SQUARE_HX * 2) / 4, (SQUARE_HZ * 2) / 4)
  group.add(groundQuad(SQUARE_HX * 2, SQUARE_HZ * 2, squareMat, 0, SQUARE_CZ))

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
  group.add(groundQuad(yardW, yardD, yardMat, yardCX, yardCZ))

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

  /** Bake the collected discs into one mesh. Call once, after the last scatter(). */
  const commitScatter = () => {
    if (scatterParts.length === 0) return
    const merged = mergeGeometries(scatterParts, false)
    for (const g of scatterParts) g.dispose()
    scatterParts.length = 0
    if (!merged) return
    const mesh = new THREE.Mesh(merged, scatterMat)
    // After the terrain and the lane, before anything standing on the ground.
    mesh.renderOrder = 1
    setLayer(mesh, MINOR_LAYER)
    group.add(mesh)
  }

  // Small and tight against the edge: big blobs out on the grass stop reading
  // as a worn verge and start reading as spilt paint.
  for (let z = laneDrawMin; z < LANE_Z_MAX; z += 1.8) {
    for (const sx of [-1, 1]) {
      scatter(sx * (LANE_HALF - 0.15 + r() * 0.4), z + r() * 1.2, 0.34 + r() * 0.24)
    }
  }
  for (let x = -SQUARE_HX; x < SQUARE_HX; x += 1.9) {
    for (const sz of [-1, 1]) {
      scatter(x + r() * 1.3, SQUARE_CZ + sz * (SQUARE_HZ - 0.15 + r() * 0.45), 0.36 + r() * 0.26)
    }
  }

  // Aprons of worn dirt just inside each gate, so the opening reads as a way in
  // rather than a hole in the fence.
  for (const s of FARM_SLOTS) {
    const g = gatePos(s)
    scatter(g.x - s.inward * 0.7, s.z, GATE_WIDTH / 2 - 0.1)
    scatter(g.x - s.inward * 1.8, s.z + (r() - 0.5) * 0.8, 0.9)
  }
  commitScatter()

  // --- seed shop -----------------------------------------------------------
  const shopModel = getModels().shop
  const shop = modelGroup(shopModel, PROP_HEIGHT.shop)
  shop.position.copy(SHOP_POS)
  // The stall is symmetric apart from its painted sign, so the rotation is
  // chosen to put that sign toward the market square — which is the side every
  // player walks in from.
  group.add(shop)
  // Two circles spanning the stall's own width, so the counter blocks the way
  // through while the ends stay walkable. Derived from the model rather than
  // hardcoded, or a swapped stall leaves a gap to stroll through.
  const shopHX = halfWidth(shopModel, PROP_HEIGHT.shop)
  for (const side of [-1, 1]) {
    obstacles.push({ x: SHOP_POS.x + side * shopHX * 0.5, z: SHOP_POS.z, r: shopHX * 0.55 })
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
  group.add(shopkeeper.object)
  obstacles.push({ x: shopkeeper.object.position.x, z: shopkeeper.object.position.z, r: 0.4 })

  // --- animal store + pasture ---------------------------------------------
  const barnModel = getModels().barn
  const barn = modelGroup(barnModel, PROP_HEIGHT.barn)
  barn.position.copy(BARN_POS)
  // Turned to face BARN_FRONT, then nudged off-square so the building is not
  // dead-on to the lane. The nudge is the same either way round.
  barn.rotation.y = (BARN_FRONT > 0 ? 0 : Math.PI) - 0.3
  group.add(barn)
  // Colliders across the barn footprint so the player walks around it. Spread
  // from the model's own width so a swapped barn does not leave a gap to walk
  // through or a wall of collision hanging off the end.
  const barnHX = halfWidth(barnModel, PROP_HEIGHT.barn)
  for (let i = -1; i <= 1; i++) {
    obstacles.push({ x: BARN_POS.x + i * barnHX * 0.66, z: BARN_POS.z - BARN_FRONT * 0.4, r: barnHX * 0.5 })
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
  group.add(farmgirl.object)
  obstacles.push({ x: farmgirl.object.position.x, z: farmgirl.object.position.z, r: 0.4 })

  // Ring fence around the pasture, with a gap facing the barn so the animals
  // read as belonging to the store.
  const posts = Math.round((2 * Math.PI * PASTURE_RADIUS) / FENCE_PANEL)
  const chord = ((2 * Math.PI * PASTURE_RADIUS) / posts) * 1.06
  const toBarn = Math.atan2(BARN_POS.z - PASTURE_CENTRE.z, BARN_POS.x - PASTURE_CENTRE.x)
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2
    // Leave a gate on the side nearest the barn.
    if (Math.abs(angleDelta(a, toBarn)) < 0.28) continue

    fences.push({
      x: PASTURE_CENTRE.x + Math.cos(a) * PASTURE_RADIUS,
      y: fenceGroundY(),
      z: PASTURE_CENTRE.z + Math.sin(a) * PASTURE_RADIUS,
      rotationY: -a + Math.PI / 2,
      scale: { x: chord / FENCE_PANEL, y: 1, z: 1 },
    })
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
    group.add(prop)
    obstacles.push({ x, z, r: item.r })
  }

  // --- the player's plot ---------------------------------------------------
  buildPlotFence(PLAYER_SLOT, fences, walls)

  // Signpost beside the gate, turned to face along the lane so it is readable
  // to someone walking up the street rather than edge-on.
  const playerGate = gatePos(PLAYER_SLOT)
  const sign = modelGroup(getModels().signpost, PROP_HEIGHT.signpost)
  sign.position.set(playerGate.x + PLAYER_SLOT.inward * 0.5, 0, PLAYER_SLOT.z + GATE_WIDTH / 2 + 0.7)
  sign.rotation.y = PLAYER_SLOT.inward * (Math.PI / 2)
  group.add(sign)
  obstacles.push({ x: sign.position.x, z: sign.position.z, r: 0.3 })

  // --- street furniture ----------------------------------------------------
  // Lanterns down both verges, offset half a row so the two sides alternate
  // rather than lining up in pairs.
  const lanternBox = getModels().lantern.geometry.boundingBox!
  const lanternH = lanternBox.max.y - lanternBox.min.y
  const lanternScale = PROP_HEIGHT.lantern / lanternH
  const lanterns: PropPlacement[] = []

  for (let i = 0; ; i++) {
    const z = LANE_Z_MIN + 6 + i * 9.5
    if (z > LANE_Z_MAX - 4) break
    const sx = i % 2 === 0 ? -1 : 1
    const x = sx * (LANE_HALF - 0.45)
    lanterns.push({
      x,
      // Modelled centred on its own origin, so lift it by half its scaled height.
      y: -lanternBox.min.y * lanternScale,
      z,
      // Face the lane, so the two verges are mirror images rather than clones.
      rotationY: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: lanternScale,
    })
    obstacles.push({ x, z, r: 0.3 })
  }

  const lanternMesh = instanceModel(getModels().lantern, lanterns)
  group.add(lanternMesh)

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
    group.add(pools)
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
    group.add(cones)
  }

  const LIGHT_BUDGET = 3
  const LANTERN_HEAD_Y = PROP_HEIGHT.lantern * LANTERN_HEAD_Y_FRACTION
  const pointLights = Array.from({ length: LIGHT_BUDGET }, () => {
    const light = new THREE.PointLight(0xffd9a0, 0, 8.5, 2)
    group.add(light)
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

  // Benches and flower beds facing the street from the square.
  const benchFit = fitToHeight(getModels().bench, PROP_HEIGHT.bench)
  const bedFit = fitToHeight(getModels().flowerBed, PROP_HEIGHT.flowerBed)
  const benches: PropPlacement[] = []
  const beds: PropPlacement[] = []
  for (const sx of [-1, 1]) {
    const bx = sx * 5.8
    const bz = SQUARE_CZ + SQUARE_HZ - 2.2
    benches.push({
      x: bx,
      y: benchFit.groundY,
      z: bz,
      // Turned so the seat faces the lane rather than across it.
      rotationY: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: benchFit.scale,
    })
    obstacles.push({ x: bx, z: bz, r: 0.6 })

    beds.push({ x: sx * 13.5, y: bedFit.groundY, z: SQUARE_CZ + 2, scale: bedFit.scale })
  }
  group.add(instanceModel(getModels().bench, benches))
  group.add(instanceModel(getModels().flowerBed, beds))

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
  group.add(laneEnd)
  obstacles.push({ x: WELL_POS.x, z: WELL_POS.z, r: 0.3 })
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const pebbles = createPebbleScatter(r)
    pebbles.position.set(
      WELL_POS.x + Math.cos(a) * (2.6 + r() * 1.4),
      Y_PEBBLE,
      WELL_POS.z + Math.sin(a) * (2.6 + r() * 1.4),
    )
    setLayer(pebbles, MINOR_LAYER)
    group.add(pebbles)
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
  const shopMarkers = createShopMarkers(group, shopkeeper.object.position, farmgirl.object.position)

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
function createShopMarkers(parent: THREE.Group, shopkeeperAt: THREE.Vector3, barnKeeperAt: THREE.Vector3) {
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
