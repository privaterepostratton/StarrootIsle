import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { asset } from '../core/assets'

/**
 * Authored models loaded from glTF, as opposed to the procedural ones built in
 * code everywhere else in this folder.
 *
 * Geometry *and* the model's own material come out of the file, so an authored
 * prop renders with the baseColour texture it shipped with rather than with a
 * material reconstructed in game code. Callers that need a variant (a watered
 * planter, say) should clone it — a clone shares the texture upload, so the
 * variants cost nothing extra on the GPU.
 *
 * Source assets are slimmed before they land in public/. Meshy exports arrive as
 * ~25MB GLBs whose geometry is a few hundred triangles and whose baseColour is a
 * single 8192x8192 JPEG — unshippable for a prop drawn on every farm tile. The
 * embedded image is re-encoded down to 1024px *in place*, leaving the glTF's
 * images/textures/samplers wiring untouched, which is what lets the loader hand
 * back the authored material fully hooked up. See scratchpad/slim-glb.mjs.
 */

export interface LoadedModel {
  /** Geometry in final local space, node transforms already applied. */
  geometry: THREE.BufferGeometry
  /** The material as authored in the glTF, texture included. */
  material: THREE.Material
}

interface ModelCache {
  plotTray: LoadedModel
  plotFence: LoadedModel
  lantern: LoadedModel
  bench: LoadedModel
  cottage: LoadedModel
  tree: LoadedModel
  scarecrow: LoadedModel
  mailbox: LoadedModel
  signpost: LoadedModel
  barn: LoadedModel
  pine: LoadedModel
  /** Coastal only. See the palm pass in game/vegetation.ts. */
  palm: LoadedModel
  shop: LoadedModel
  flowerBed: LoadedModel
  rock: LoadedModel
  /** A second boulder silhouette: three stones and a grass tuft, not one rock. */
  rockCluster: LoadedModel
  log: LoadedModel
  /** The cut trunk left where a tree was. Scattered with the fallen logs. */
  stump: LoadedModel
  /** Replaced the procedural three-sphere blob. See game/vegetation.ts. */
  bush: LoadedModel
  barrel: LoadedModel
  haybale: LoadedModel
  haypile: LoadedModel
  /** The coin doobers burst out of a harvest as. See game/doobers.ts. */
  coin: LoadedModel
  /** The ripe strawberry. See the 'heart' factory in assets/crops.ts. */
  strawberry: LoadedModel
  /** The ripe blueberry cluster. See the 'cluster' factory in assets/crops.ts. */
  blueberry: LoadedModel
  /** The ripe tomato. See the 'ribbed' factory in assets/crops.ts. */
  tomato: LoadedModel
  /** The ripe grape bunch. See the 'bunch' factory in assets/crops.ts. */
  grapes: LoadedModel
  /** The ripe ear of corn. See the 'cob' factory in assets/crops.ts. */
  corn: LoadedModel
  /** The ripe carrot. See the 'taproot' factory in assets/crops.ts. */
  carrot: LoadedModel
  /** The ripe apple. See the 'pome' factory in assets/crops.ts. */
  apple: LoadedModel
  /** The ripe watermelon. See the 'striped' factory in assets/crops.ts. */
  melon: LoadedModel
  /** The ripe chilli. See the 'pod' factory in assets/crops.ts. */
  pepper: LoadedModel
  /** The ripe starfruit. See the 'star' factory in assets/crops.ts. */
  starfruit: LoadedModel
  /** The ripe dragonfruit. See the 'scaled' factory in assets/crops.ts. */
  dragonfruit: LoadedModel
  /** The ripe coconut. See the 'husk' factory in assets/crops.ts. */
  coconut: LoadedModel
  /** The ripe sunflower head. See the 'disc' factory in assets/crops.ts. */
  sunflower: LoadedModel
  /** The ripe pumpkin. See the 'gourd' factory in assets/crops.ts. */
  pumpkin: LoadedModel
  /** The ripe potato. See the 'tuber' factory in assets/crops.ts. */
  potato: LoadedModel
  /** The ripe moonbloom. See the 'bloom' factory in assets/crops.ts. */
  moonbloom: LoadedModel
}

let cache: ModelCache | null = null

/** One instance of an authored prop. */
export interface PropPlacement {
  x: number
  y: number
  z: number
  rotationY?: number
  /** Uniform, or per-axis when a prop is stretched to fit (a fence run). */
  scale?: number | { x: number; y: number; z: number }
  /**
   * Per-instance tint, multiplied over the baseColour texture.
   *
   * Lets one authored model still carry per-instance identity — five neighbours'
   * cottages built from the same mesh but recognisably their own. Keep tints
   * pale: this multiplies, so a saturated value swamps the texture.
   */
  color?: number
}

/**
 * Draw many copies of one authored model in a single call.
 *
 * Textured props cannot go through `bakeGroup` — that flattens material colours
 * into vertex colours and drops UVs, which is fine for the procedural set but
 * destroys a baseColour map. Instancing is the equivalent trick for authored
 * models: a plot's worth of fence panels, or every neighbour's planters, become
 * one draw call while keeping the texture intact.
 */
export function instanceModel(model: LoadedModel, placements: PropPlacement[]) {
  const tinted = placements.some((p) => p.color !== undefined)

  /*
   * Tinted batches need vertexColors on (instanceColor only reaches the
   * fragment through three's USE_COLOR path) and, with it, a white `color`
   * attribute (a missing attribute reads as black in WebGL and would blacken
   * the whole batch). Without both, per-instance tints are silently discarded —
   * the neighbours' cottages were all identical for exactly this reason.
   * The material is cloned so untinted users of the same model keep sharing
   * the original.
   */
  let material = model.material
  if (tinted) {
    material = model.material.clone()
    material.vertexColors = true
    if (!model.geometry.getAttribute('color')) {
      const white = new Float32Array(model.geometry.attributes.position.count * 3).fill(1)
      model.geometry.setAttribute('color', new THREE.BufferAttribute(white, 3))
    }
  }

  const mesh = new THREE.InstancedMesh(model.geometry, material, placements.length)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const tint = new THREE.Color()

  placements.forEach((p, i) => {
    pos.set(p.x, p.y, p.z)
    q.setFromAxisAngle(up, p.rotationY ?? 0)
    const s = p.scale ?? 1
    if (typeof s === 'number') scl.set(s, s, s)
    else scl.set(s.x, s.y, s.z)
    mesh.setMatrixAt(i, m.compose(pos, q, scl))

    // Untinted instances must still be written, or they inherit whatever the
    // freshly allocated colour buffer happens to hold — which is black.
    if (tinted) mesh.setColorAt(i, tint.setHex(p.color ?? 0xffffff))
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  // Static by construction — see the note in makeInstancedChunks.
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  return mesh
}

/**
 * Pull one mesh out of a glTF scene, with its world transform baked in.
 *
 * GLTFLoader puts node transforms on the Object3D, not the geometry, so a
 * geometry lifted straight out of the scene graph silently loses any scale or
 * offset the exporter put on the node.
 */
function extractMesh(scene: THREE.Object3D): LoadedModel {
  scene.updateMatrixWorld(true)

  const meshes: THREE.Mesh[] = []
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) meshes.push(mesh)
  })

  if (meshes.length === 0) throw new Error('glTF contained no mesh')
  // Every model here is a single mesh; if that ever changes, merge rather than
  // silently dropping the rest.
  if (meshes.length > 1) {
    console.warn(`glTF had ${meshes.length} meshes; using the first only`)
  }

  const mesh = meshes[0]
  // Bake the node transform into the geometry. GLTFLoader puts it on the
  // Object3D, so geometry lifted straight out of the scene graph silently loses
  // any scale or offset the exporter put on the node.
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingBox()

  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone()
  const map = (material as THREE.MeshStandardMaterial).map
  if (map) {
    map.anisotropy = 4
    map.needsUpdate = true
  }

  return { geometry, material }
}

/** Fetch every authored model. Safe to call repeatedly — resolves from cache. */
export async function loadModels(): Promise<ModelCache> {
  if (cache) return cache

  const gltf = new GLTFLoader()
  const [tray, fence, lantern, bench, cottage, tree, scarecrow, mailbox, signpost, barn, pine, palm, shop, flowerBed, rock, log, coin, strawberry, blueberry, tomato, grapes, corn, carrot, apple, melon, pepper, starfruit, dragonfruit, coconut, sunflower, pumpkin, potato, moonbloom, rockCluster, stump, bush, barrel, haybale, haypile] =
    await Promise.all([
      gltf.loadAsync(asset('models/plot-tray.glb')),
      gltf.loadAsync(asset('models/plot-fence.glb')),
      gltf.loadAsync(asset('models/lantern.glb')),
      gltf.loadAsync(asset('models/bench.glb')),
      gltf.loadAsync(asset('models/cottage.glb')),
      gltf.loadAsync(asset('models/tree-broadleaf.glb')),
      gltf.loadAsync(asset('models/scarecrow.glb')),
      gltf.loadAsync(asset('models/mailbox.glb')),
      gltf.loadAsync(asset('models/signpost.glb')),
      gltf.loadAsync(asset('models/barn.glb')),
      gltf.loadAsync(asset('models/tree-conifer.glb')),
      gltf.loadAsync(asset('models/palm.glb')),
      gltf.loadAsync(asset('models/shop.glb')),
      gltf.loadAsync(asset('models/plot-tray-blooms.glb')),
      gltf.loadAsync(asset('models/rock.glb')),
      gltf.loadAsync(asset('models/log.glb')),
      gltf.loadAsync(asset('models/coin.glb')),
      gltf.loadAsync(asset('models/strawberry.glb')),
      gltf.loadAsync(asset('models/blueberry.glb')),
      gltf.loadAsync(asset('models/tomato.glb')),
      gltf.loadAsync(asset('models/grapes.glb')),
      gltf.loadAsync(asset('models/corn.glb')),
      gltf.loadAsync(asset('models/carrot.glb')),
      gltf.loadAsync(asset('models/apple.glb')),
      gltf.loadAsync(asset('models/melon.glb')),
      gltf.loadAsync(asset('models/pepper.glb')),
      gltf.loadAsync(asset('models/starfruit.glb')),
      gltf.loadAsync(asset('models/dragonfruit.glb')),
      gltf.loadAsync(asset('models/coconut.glb')),
      gltf.loadAsync(asset('models/sunflower.glb')),
      gltf.loadAsync(asset('models/pumpkin.glb')),
      gltf.loadAsync(asset('models/potato.glb')),
      gltf.loadAsync(asset('models/moonbloom.glb')),
      gltf.loadAsync(asset('models/rock-cluster.glb')),
      gltf.loadAsync(asset('models/stump.glb')),
      gltf.loadAsync(asset('models/bush.glb')),
      gltf.loadAsync(asset('models/barrel.glb')),
      gltf.loadAsync(asset('models/haybale.glb')),
      gltf.loadAsync(asset('models/haypile.glb')),
    ])

  cache = {
    plotTray: extractMesh(tray.scene),
    plotFence: extractMesh(fence.scene),
    lantern: extractMesh(lantern.scene),
    bench: extractMesh(bench.scene),
    cottage: extractMesh(cottage.scene),
    tree: extractMesh(tree.scene),
    scarecrow: extractMesh(scarecrow.scene),
    mailbox: extractMesh(mailbox.scene),
    signpost: extractMesh(signpost.scene),
    barn: extractMesh(barn.scene),
    pine: extractMesh(pine.scene),
    palm: extractMesh(palm.scene),
    shop: extractMesh(shop.scene),
    flowerBed: extractMesh(flowerBed.scene),
    rock: extractMesh(rock.scene),
    log: extractMesh(log.scene),
    coin: extractMesh(coin.scene),
    strawberry: extractMesh(strawberry.scene),
    blueberry: extractMesh(blueberry.scene),
    tomato: extractMesh(tomato.scene),
    grapes: extractMesh(grapes.scene),
    corn: extractMesh(corn.scene),
    carrot: extractMesh(carrot.scene),
    apple: extractMesh(apple.scene),
    melon: extractMesh(melon.scene),
    pepper: extractMesh(pepper.scene),
    starfruit: extractMesh(starfruit.scene),
    dragonfruit: extractMesh(dragonfruit.scene),
    coconut: extractMesh(coconut.scene),
    sunflower: extractMesh(sunflower.scene),
    pumpkin: extractMesh(pumpkin.scene),
    potato: extractMesh(potato.scene),
    moonbloom: extractMesh(moonbloom.scene),
    rockCluster: extractMesh(rockCluster.scene),
    stump: extractMesh(stump.scene),
    bush: extractMesh(bush.scene),
    barrel: extractMesh(barrel.scene),
    haybale: extractMesh(haybale.scene),
    haypile: extractMesh(haypile.scene),
  }
  return cache
}

/**
 * How tall each authored prop stands, in world units, against a 1.6-unit farmer.
 *
 * Kept here rather than beside each use so the same prop is the same size
 * wherever it appears — the bench in the market square, the bench on a
 * neighbour's lawn and the bench the player buys are one object, and they looked
 * it only by coincidence while these numbers lived in three files.
 */
export const PROP_HEIGHT = {
  bench: 1.0,
  lantern: 2.9,
  scarecrow: 2.1,
  mailbox: 1.25,
  signpost: 1.6,
  cottage: 3.3,
  tree: 5.6,
  /* Raised from 5.4 with the model swap. Height is the only dimension
     fitToHeight controls, and the barn that replaced the old one is a taller,
     narrower building — held at the old height it lost a third of its width and
     stopped reading as the biggest thing on the square. */
  barn: 6.2,
  pine: 6.8,
  /* Shorter than the forest canopy behind it. A palm the height of a conifer
     reads as a jungle; the coast wants a fringe you can see the sea over. */
  palm: 5.2,
  /*
   * A market stall, not a building — the first one towered over the farmer it
   * serves at building height. Raised from 2.36 with the model swap, for the
   * same reason the barn was: the replacement is square in elevation where the
   * old one was wide and low, so holding the old height would have taken a
   * third off its footprint and left the seed stall smaller than the cottages
   * behind it. At 2.9 it is as wide as the old one was and still reads as a
   * stall rather than a shop building.
   */
  shop: 2.9,
  /* Knee-high: it is a trough, and the blooms are most of what you see. */
  flowerBed: 0.72,
  /* Knee-high at base scale; vegetation.ts jitters each one either side of it.
     The model is twice as wide as it is tall, so a height that sounds modest
     still puts a boulder wider than the farmer on the grass. */
  rock: 0.55,
  /* Shorter than the single boulder it alternates with, because it is three
     stones side by side: matched in height the cluster reads as one huge rock
     that happens to be cracked, rather than as a scatter. */
  rockCluster: 0.42,
  /* A fallen trunk lying on its side, sprout and all — knee-high, not waist. */
  log: 0.72,
  /* What is left where a tree came down. Taller than the log because it stands
     rather than lies, but still below the knee — a stump the player can see
     over is a tree, not a stump. */
  stump: 0.62,
  /* Waist-high on the farmer. The procedural blob it replaced was set from its
     own placement jitter; this is the base the same jitter now scales. */
  bush: 0.85,
  /* Barnyard dressing, all sized against the farmer standing beside them: a
     barrel to the hip, a bale to mid-thigh, a loose pile slumping wider and
     lower than the bale it came from. */
  barrel: 0.95,
  haybale: 0.8,
  haypile: 1.15,
} as const

/**
 * Uniform scale and ground lift for a model, from a target height.
 *
 * Every authored prop here is modelled centred on its own origin, vertically
 * included, so placing one at y=0 sinks it halfway into the terrain. Deriving
 * both numbers from the bounding box means swapping a model does not silently
 * leave it floating, buried, or the wrong size.
 */
export function fitToHeight(model: LoadedModel, height: number) {
  const box = model.geometry.boundingBox!
  const scale = height / (box.max.y - box.min.y)
  return { scale, groundY: -box.min.y * scale }
}

/**
 * A single authored prop as a standalone Group, sized and sitting on the ground.
 *
 * For the one-off cases instancing does not suit — a prop the player places and
 * later removes. Geometry and material are shared with every other copy, so the
 * only cost over an instance is the draw call.
 */
export function modelGroup(model: LoadedModel, height: number): THREE.Group {
  const fit = fitToHeight(model, height)
  const mesh = new THREE.Mesh(model.geometry, model.material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.scale.setScalar(fit.scale)
  mesh.position.y = fit.groundY

  const group = new THREE.Group()
  group.add(mesh)
  return group
}

export function getModels(): ModelCache {
  if (!cache) throw new Error('Models not loaded — call loadModels() first')
  return cache
}

/**
 * The cache if it is loaded, or null.
 *
 * For callers that have a procedural fallback and must not throw when they run
 * before boot finishes — the crop factories are also exercised by the test suite
 * and the gallery, neither of which loads a glTF.
 */
export function peekModels(): ModelCache | null {
  return cache
}

/**
 * The villager: one rigged mesh with its locomotion clips. Every person in the
 * valley is built from it — the player, and each neighbour as a tinted clone.
 *
 * Unlike everything above, this is handed back as a live scene graph rather than
 * geometry — a SkinnedMesh cannot be baked or instanced, because its vertices are
 * posed on the GPU from bone matrices every frame.
 *
 * The asset does its own orientation and scaling: its root node carries the
 * 0.01 unit scale. That matters more than it sounds. A glTF skin's inverse bind
 * matrices are baked against the joints' bind-pose world transforms, so
 * *nothing* here may rotate the rig or edit the file's node transforms after the
 * fact — the mesh and the skeleton would disagree about where the bind pose was,
 * and the model either lies down, inflates, or collapses. Correcting orientation
 * is the exporter's job, not this loader's.
 *
 * The clips arrive in four separate files, one per animation, each carrying a
 * full copy of the body and its texture — the same exporter behaviour the
 * greeters have. Three of the four are stripped to their animation channels
 * before they ship (scripts/extract-anim.mjs takes the walk from 447KB to 35KB)
 * and played on the body loaded from the idle file, which works because a clip
 * binds to bones by *name* and all four exports carry the same rig.
 */
export interface FarmerModel {
  /** Add this to the scene. Already oriented and sized. */
  root: THREE.Object3D
  idle?: THREE.AnimationClip
  walk?: THREE.AnimationClip
  run?: THREE.AnimationClip
  /** Crouch, pick up, place to the side. The harvest animation. */
  pick?: THREE.AnimationClip
}

let farmer: FarmerModel | null = null

/**
 * Force a character material to be *lit* by the scene rather than by itself.
 *
 * Every biped in this game comes off the same exporter, and it writes three
 * things that each, on their own, defeat the lighting:
 *
 * - `emissiveFactor: [1,1,1]` with an emissive texture pointing at the *same
 *   image as the baseColour*. That is the albedo re-emitted at full strength:
 *   the figure carries its own illumination, ignores the sun, ignores the day
 *   cycle, and stays flat and bright at midnight. It is an unlit shader in all
 *   but name, which is exactly what it looked like.
 * - `KHR_materials_specular` with `specularColorFactor: [2,2,2]` — twice the
 *   maximum the spec allows. three reads it into a MeshPhysicalMaterial and
 *   puts a hard highlight on cloth. Nothing else in the valley has a specular
 *   at all; every procedural model is Lambert precisely so there is none.
 * - PBR defaults for roughness and metalness, which make skin look wet.
 *
 * The build step fixes the file too (scripts/slim-glb.mjs drops the emissive
 * map and zeroes the factor). This runs anyway, because a stale copy — a
 * browser cache, a portal CDN, a zip already uploaded — would otherwise put the
 * self-lit version back, and a shipped build cannot re-run the build step.
 */
function makeLit(mat: THREE.MeshStandardMaterial) {
  // Both halves matter: dropping the map alone leaves the factor multiplying
  // nothing into full white, which is the *other* failure — a featureless white
  // silhouette with its texture attached and invisible underneath.
  mat.emissiveMap = null
  if (mat.emissive) mat.emissive.setHex(0x000000)
  mat.emissiveIntensity = 0

  // Cloth and skin, not a polished surface.
  mat.roughness = 1
  mat.metalness = 0

  // MeshPhysicalMaterial only — present when the glTF carried the specular
  // extension, absent otherwise, so it is guarded rather than assumed.
  const physical = mat as THREE.MeshPhysicalMaterial
  if (physical.specularIntensity !== undefined) physical.specularIntensity = 0
  if (physical.specularColor) physical.specularColor.setHex(0x000000)

  mat.needsUpdate = true
}

/**
 * The one real clip in an export, out of the three it declares.
 *
 * These files ship "Armature" and "baselayer" alongside the actual animation,
 * both of them empty — matching on the meaningful name is the only way to tell
 * them apart, and taking `animations[0]` gets the empty one.
 */
function namedClip(clips: THREE.AnimationClip[], re: RegExp) {
  return clips.find((c) => re.test(c.name))
}

export async function loadFarmerModel(targetHeight: number): Promise<FarmerModel> {
  if (farmer) return farmer

  const loader = new GLTFLoader()
  const [body, walk, run, pick] = await Promise.all([
    loader.loadAsync(asset('models/villager.glb')),
    loader.loadAsync(asset('models/villager-walk.glb')),
    loader.loadAsync(asset('models/villager-run.glb')),
    loader.loadAsync(asset('models/villager-pick.glb')),
  ])

  const root = body.scene
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      makeLit(m as THREE.MeshStandardMaterial)
    }
  })

  /*
   * Height is measured from the *bones*, not from a Box3.
   *
   * Box3.setFromObject reads a SkinnedMesh's raw vertex buffer, which is in bind
   * space — for a rig authored at a hundred times game scale that reads back
   * absurd numbers and any scale derived from them is meaningless. The joints'
   * world positions are the only measurement that reflects what will actually be
   * drawn.
   */
  root.updateMatrixWorld(true)
  let lo = Infinity
  let hi = -Infinity
  const p = new THREE.Vector3()
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return
    o.getWorldPosition(p)
    lo = Math.min(lo, p.y)
    hi = Math.max(hi, p.y)
  })

  // The topmost joint sits inside the skull, not on top of the head, so the
  // rendered figure is taller than its skeleton by roughly this much.
  const HEAD_ALLOWANCE = 1.14
  const span = (hi - lo) * HEAD_ALLOWANCE
  if (span > 1e-3) root.scale.multiplyScalar(targetHeight / span)

  farmer = {
    root,
    idle: namedClip(body.animations, /idle/i),
    walk: namedClip(walk.animations, /walk/i),
    run: namedClip(run.animations, /run/i),
    pick: namedClip(pick.animations, /pick|crouch/i),
  }
  return farmer
}

export function getFarmerModel(): FarmerModel {
  if (!farmer) throw new Error('Farmer not loaded — call loadFarmerModel() first')
  return farmer
}

/**
 * The stallholder: a rigged body with an idle and a wave.
 *
 * Same contract as the farmer — a live scene plus clips — with one wrinkle. The exporter writes a separate file per animation, each one
 * carrying a full copy of the mesh and a 4K texture, so the wave arrives as its
 * own 64MB body. Only the clip is wanted, so the wave file is stripped to its
 * animation channels before it ships (scripts/extract-anim.mjs) and the clip is
 * played on the body loaded from the idle file. That works because an
 * AnimationClip binds to bones by *name*, and both exports carry the same rig.
 */
export interface ShopkeeperModel {
  root: THREE.Object3D
  idle?: THREE.AnimationClip
  wave?: THREE.AnimationClip
}

let shopkeeper: ShopkeeperModel | null = null
let farmgirl: ShopkeeperModel | null = null

/**
 * Load a standing villager: one idle body plus a wave clip from a second file.
 *
 * Shared because every greeter in the valley is authored the same way — a Meshy
 * biped exported once per animation — and the fix-ups below (emissive, shadow
 * flags, joint-measured scaling) are properties of that pipeline rather than of
 * any one character.
 */
async function loadGreeter(bodyPath: string, wavePath: string, targetHeight: number): Promise<ShopkeeperModel> {
  const loader = new GLTFLoader()
  const [body, wave] = await Promise.all([
    loader.loadAsync(asset(bodyPath)),
    loader.loadAsync(asset(wavePath)),
  ])

  const root = body.scene
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true

    // Same exporter as the player's rig, same three ways of defeating the
    // scene lighting. See makeLit.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      makeLit(m as THREE.MeshStandardMaterial)
    }
  })

  // Measured off the joints, not a Box3 — see loadFarmerModel for why a
  // SkinnedMesh's vertex bounds are meaningless here.
  root.updateMatrixWorld(true)
  let lo = Infinity
  let hi = -Infinity
  const p = new THREE.Vector3()
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return
    o.getWorldPosition(p)
    lo = Math.min(lo, p.y)
    hi = Math.max(hi, p.y)
  })
  const HEAD_ALLOWANCE = 1.14
  const span = (hi - lo) * HEAD_ALLOWANCE
  if (span > 1e-3) root.scale.multiplyScalar(targetHeight / span)

  return { root, idle: body.animations[0], wave: wave.animations[0] }
}

export async function loadShopkeeperModel(targetHeight: number): Promise<ShopkeeperModel> {
  shopkeeper ??= await loadGreeter('models/shopkeeper.glb', 'models/shopkeeper-wave.glb', targetHeight)
  return shopkeeper
}

export function getShopkeeperModel(): ShopkeeperModel {
  if (!shopkeeper) throw new Error('Shopkeeper not loaded — call loadShopkeeperModel() first')
  return shopkeeper
}

export async function loadFarmgirlModel(targetHeight: number): Promise<ShopkeeperModel> {
  farmgirl ??= await loadGreeter('models/farmgirl.glb', 'models/farmgirl-wave.glb', targetHeight)
  return farmgirl
}

/**
 * A rigged wild animal: live scene graph plus its clips.
 *
 * Same contract and the same rules as the villager — no baking, no instancing,
 * no re-orienting at runtime. Separate from the procedural `AnimalRig` the
 * paddock uses because the two are animated in completely different ways: the
 * paddock's animals are boxes whose legs are rotated by hand each frame, and
 * this is a skinned mesh posed by a mixer.
 */
export interface CreatureModel {
  root: THREE.Object3D
  idle?: THREE.AnimationClip
  walk?: THREE.AnimationClip
}

const creatures = new Map<string, CreatureModel>()

/**
 * Load a rigged creature: one body file plus one clip file.
 *
 * The exporter writes a whole copy of the mesh per animation, so the walk is
 * stripped to its channels before it ships (scripts/extract-anim.mjs takes the
 * cow's from 33MB to 40KB) and played on the body from the idle file. Works
 * because a clip binds to bones by name and both exports carry the same rig.
 */
export async function loadCreatureModel(
  id: string,
  bodyPath: string,
  walkPath: string,
  targetHeight: number,
): Promise<CreatureModel> {
  const existing = creatures.get(id)
  if (existing) return existing

  const loader = new GLTFLoader()
  const [body, walk] = await Promise.all([
    loader.loadAsync(asset(bodyPath)),
    loader.loadAsync(asset(walkPath)),
  ])

  const root = body.scene
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      makeLit(m as THREE.MeshStandardMaterial)
    }
  })

  // Bone span, not a Box3 — see loadFarmerModel for why a SkinnedMesh's vertex
  // bounds are meaningless.
  root.updateMatrixWorld(true)
  let lo = Infinity
  let hi = -Infinity
  const p = new THREE.Vector3()
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return
    o.getWorldPosition(p)
    lo = Math.min(lo, p.y)
    hi = Math.max(hi, p.y)
  })
  // A quadruped's topmost joint is its spine, not the top of its head, so the
  // allowance is larger than the biped's.
  const span = (hi - lo) * 1.45
  if (span > 1e-3) root.scale.multiplyScalar(targetHeight / span)

  const byName = (clips: THREE.AnimationClip[], re: RegExp) => clips.find((c) => re.test(c.name))
  const model: CreatureModel = {
    root,
    idle: byName(body.animations, /idle|clip/i),
    walk: byName(walk.animations, /walk|take|run/i),
  }
  creatures.set(id, model)
  return model
}

export function getCreatureModel(id: string): CreatureModel | null {
  return creatures.get(id) ?? null
}

/** Independent copy — see cloneFarmer for why SkeletonUtils is required. */
export function cloneCreature(id: string): CreatureModel | null {
  const src = creatures.get(id)
  if (!src) return null
  const root = cloneSkinned(src.root)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  return { root, idle: src.idle, walk: src.walk }
}

export function getFarmgirlModel(): ShopkeeperModel {
  if (!farmgirl) throw new Error('Farmgirl not loaded — call loadFarmgirlModel() first')
  return farmgirl
}

/**
 * An independent copy of the farmer for an NPC.
 *
 * A SkinnedMesh cannot be added to the scene twice — mesh, skeleton and bones
 * are one live graph, so two users of it would fight over the pose every frame.
 * SkeletonUtils.clone duplicates the graph *and* rebinds the clone's mesh to the
 * clone's bones, which a plain Object3D.clone does not (its skin stays bound to
 * the original's skeleton and deforms with the wrong body).
 *
 * `tint` multiplies the shared texture so each villager reads as their own
 * person at a glance. The material is cloned per call — cheap, since the
 * texture upload itself stays shared — but geometry and clips are not copied.
 */
export function cloneFarmer(tint?: number): FarmerModel {
  const src = getFarmerModel()
  const root = cloneSkinned(src.root)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (tint !== undefined) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial
      mat.color = new THREE.Color(tint)
      mesh.material = mat
    }
  })
  return { root, idle: src.idle, walk: src.walk, run: src.run, pick: src.pick }
}

