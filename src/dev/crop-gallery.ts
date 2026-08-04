import * as THREE from 'three'
import { createCropModel } from '../assets/crops'
import { CROPS, CROP_BY_ID, GROWTH_STAGES, type CropDef } from '../game/crops'
import { PALETTE, mat } from '../assets/style'
import { TILE_SIZE } from '../game/farm'
import { loadModels } from '../assets/models'

// Some crops swap in an authored model once ripe (the strawberry does). Without
// this the gallery silently renders their procedural fallback, which is the one
// thing a reference sheet must not do.
await loadModels()

/**
 * Dev-only contact sheet for the procedural crop models.
 *
 * Crop art can only be judged by looking at it, and looking at it in the game
 * means growing eighteen species through four stages one plot at a time. This
 * page renders any slice of that matrix at once, under the game's own lighting
 * and from the game's own camera elevation, so a change to `assets/crops.ts` can
 * be checked in a single screenshot.
 *
 * Two things make it a faithful test rather than a pretty render:
 *
 * - The light rig, tone mapping and materials are copied from `core/engine.ts`
 *   and `game/daycycle.ts` at noon. A crop that reads well under a studio
 *   three-point rig can still be mud in game; matching the rig is the point.
 * - The camera sits at the game's default pitch (0.3 rad). Almost every crop
 *   mistake this page has caught was an object that reads fine from the side and
 *   collapses when seen from slightly above — a flat cap becoming a disc, a
 *   rosette lying over the fruit it should frame.
 *
 * It deliberately renders exactly once, with no animation loop, so headless
 * Chrome can screenshot it (the game itself cannot be captured that way — its
 * rAF loop never lets virtual time settle).
 *
 *   /crop-gallery.html                       every crop, ripe
 *   /crop-gallery.html?stage=1               every crop, mid-growth
 *   /crop-gallery.html?stage=all             every crop across all four stages
 *   /crop-gallery.html?crop=turnip           one crop, all four stages, large
 *   /crop-gallery.html?crops=corn,melon      just these, large
 *   /crop-gallery.html?zoom=1.6              tighter framing on whatever is shown
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

/** Camera elevation. Matches Engine's default pitch — see the note above. */
const PITCH = num('pitch', 0.3)
/** Turntable angle. 0 looks down -Z, the direction the game's camera faces. */
const YAW = num('yaw', 0.55)
const ZOOM = num('zoom', 1)

interface Cell {
  def: CropDef
  stage: number
  seed: number
}

const cropParam = params.get('crop')
const stageParam = params.get('stage') ?? '3'
const allStages = stageParam === 'all'

const cells: Cell[] = []
let cols: number
let cellPx: number

if (cropParam) {
  const def = CROP_BY_ID.get(cropParam)
  if (!def) throw new Error(`unknown crop: ${cropParam}`)
  for (let s = 0; s < GROWTH_STAGES; s++) cells.push({ def, stage: s, seed: 7 })
  cols = GROWTH_STAGES
  cellPx = num('cell', 400)
} else if (allStages) {
  for (const def of CROPS) for (let s = 0; s < GROWTH_STAGES; s++) cells.push({ def, stage: s, seed: 7 })
  cols = GROWTH_STAGES
  cellPx = num('cell', 200)
} else {
  const stage = Math.max(0, Math.min(GROWTH_STAGES - 1, Number(stageParam) || 0))
  const only = params.get('crops')
  const list = only
    ? only.split(',').map((id) => {
        const def = CROP_BY_ID.get(id.trim())
        if (!def) throw new Error(`unknown crop: ${id}`)
        return def
      })
    : CROPS
  for (const def of list) cells.push({ def, stage, seed: 7 })
  cols = num('cols', only ? Math.min(list.length, 4) : 6)
  cellPx = num('cell', only ? 420 : 280)
}

const rows = Math.ceil(cells.length / cols)

// --- scene -------------------------------------------------------------------

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(cols * cellPx, rows * cellPx, false)
canvas.style.width = `${cols * cellPx}px`
canvas.style.height = `${rows * cellPx}px`
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fd4f2)

// Engine's rig, verbatim, with the sun placed where DayCycle puts it at noon.
const sun = new THREE.DirectionalLight(0xfff2d6, 1.75)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 60
const s = 3
sun.shadow.camera.left = -s
sun.shadow.camera.right = s
sun.shadow.camera.top = s
sun.shadow.camera.bottom = -s
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.022
sun.shadow.radius = 3.5
sun.position.set(0, 30, 12)
scene.add(sun, sun.target)

scene.add(new THREE.HemisphereLight(0xd2eeff, 0x9cae68, 1.4))
scene.add(new THREE.AmbientLight(0xfff6e8, 0.42))
const fill = new THREE.DirectionalLight(0xbcd8f5, 0.45)
fill.position.set(0, 14, -14)
scene.add(fill)

// Grass, and the tilled pad a planted tile actually shows underneath the plant.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(PALETTE.grass))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const pad = new THREE.Mesh(
  new THREE.PlaneGeometry(TILE_SIZE * 0.88, TILE_SIZE * 0.88),
  mat(PALETTE.soilTilled),
)
pad.rotation.x = -Math.PI / 2
pad.position.y = 0.012
pad.receiveShadow = true
scene.add(pad)

// Every model sits at the origin and is shown one at a time, which keeps the
// shadow frustum tight enough that a leaf casts a leaf-shaped shadow.
const models = cells.map((cell) => {
  const m = createCropModel(cell.def, cell.stage, { seed: cell.seed })
  m.visible = false
  scene.add(m)
  return m
})

// --- framing -----------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 200)
const box = new THREE.Box3()
const size = new THREE.Vector3()
const centre = new THREE.Vector3()

/**
 * Distance at which a model fills its cell.
 *
 * Fitting the bounding *sphere* rather than the box is what keeps the framing
 * stable as the turntable turns — fitting the box makes a plant breathe in and
 * out as its widest axis swings toward the camera.
 */
function frame(model: THREE.Object3D) {
  model.updateMatrixWorld(true)
  box.setFromObject(model)
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.6, 0.4, 0.6))
  box.getSize(size)
  box.getCenter(centre)

  // Include the soil pad's own footprint, so a seedling is not blown up to fill
  // the frame and shown at a scale nothing else in the sheet shares.
  const radius = Math.max(0.5 * Math.hypot(size.x, size.y, size.z), TILE_SIZE * 0.62)
  const vFov = (camera.fov * Math.PI) / 180
  const dist = (radius / Math.sin(vFov / 2)) / ZOOM

  const cosP = Math.cos(PITCH)
  camera.position.set(
    centre.x + Math.sin(YAW) * cosP * dist,
    centre.y + Math.sin(PITCH) * dist,
    centre.z + Math.cos(YAW) * cosP * dist,
  )
  camera.lookAt(centre)
}

// --- draw --------------------------------------------------------------------

const labels = document.getElementById('labels')!
const dpr = renderer.getPixelRatio()

renderer.setScissorTest(true)
cells.forEach((cell, i) => {
  const col = i % cols
  const row = Math.floor(i / cols)
  const x = col * cellPx
  // Three's viewport origin is bottom-left; the label grid's is top-left.
  const yBottom = (rows - row - 1) * cellPx

  models.forEach((m, j) => (m.visible = j === i))
  frame(models[i])
  camera.aspect = 1
  camera.updateProjectionMatrix()

  renderer.setViewport(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.setScissor(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.shadowMap.needsUpdate = true
  renderer.render(scene, camera)

  const label = document.createElement('div')
  label.className = 'label'
  label.style.left = `${x + 8}px`
  label.style.top = `${row * cellPx + cellPx - 26}px`
  label.innerHTML = `<b>${cell.def.name}</b> <span>${cell.def.fruit} · ${cell.def.form} · stage ${cell.stage}</span>`
  labels.appendChild(label)
})
renderer.setScissorTest(false)

document.getElementById('head')!.textContent =
  `${cells.length} models · pitch ${PITCH} · yaw ${YAW} · zoom ${ZOOM}`

// Signal for headless capture: the page is static, so this never changes again.
;(window as unknown as { __ready?: boolean }).__ready = true
