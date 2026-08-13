import * as THREE from 'three'
import { createSunTomato, type SunTomatoState } from '../assets/opening/sun-tomato'
import { createMysterySprout } from '../assets/opening/mystery-sprout'
import { createGoatModel } from '../assets/opening/goat-model'
import {
  createOpeningCrate,
  createSeedPouch,
  createOpeningShovel,
  createWashupProp,
  createJournalProp,
} from '../assets/opening/beach-models'
import { createChaosProp, createBougainvilleaSpill, type ChaosKind } from '../assets/opening/chaos-props'
import { loadModels, loadGoatModel } from '../assets/models'

/**
 * Dev-only contact sheet for the opening's OBJECTS and CHARACTERS.
 *
 * The opening's props can only be judged by looking at them, and looking at
 * them in the game costs a nine-beat playthrough per iteration. This page
 * renders the whole set at once under the opening's own dawn rig — low warm
 * key, cool sky fill, loam underfoot — because that is the only light these
 * assets are ever seen in, and a prop tuned under noon studio light turns to
 * mud at 7.2am.
 *
 * Static by design (renders once, no rAF) so headless Chrome can screenshot it:
 *
 *   node scripts/shot.mjs opening-gallery.html out/opening.png 1800 1000
 *   /opening-gallery.html?set=plants
 *   /opening-gallery.html?set=goat        (three angles + the look pose)
 *   /opening-gallery.html?set=props
 *   /opening-gallery.html?set=chaos
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

const set = params.get('set') ?? 'all'
const PITCH = num('pitch', 0.22)
const ZOOM = num('zoom', 1)

interface Cell {
  name: string
  object: THREE.Object3D
  /** Turntable yaw for this cell. 0 looks down -Z. */
  yaw?: number
  /** Extra zoom on top of the page zoom. */
  zoom?: number
  /** Re-pose the cell before a redraw (the rigs that load asynchronously). */
  settle?: () => void
}

const cells: Cell[] = []

const PLANT_STATES: SunTomatoState[] = ['sprout', 'vine', 'flowering', 'fruiting', 'odd']

function goatCell(name: string, yaw: number, look: THREE.Vector3 | null, zoom = 1): Cell {
  const rig = createGoatModel()
  // The goat is an authored GLB now, so it is not there on the first pass. The
  // pose has to be re-settled on the redraw that follows the fetch, hence
  // `settle` rather than a one-off loop here.
  const settle = () => {
    for (let i = 0; i < 30; i++) rig.lookAt(look)
  }
  settle()
  return { name, object: rig.root, yaw, zoom, settle }
}

if (set === 'all' || set === 'plants') {
  for (const state of PLANT_STATES) cells.push({ name: `sun-tomato ${state}`, object: createSunTomato(state) })
  cells.push({ name: 'mystery dormant', object: createMysterySprout('dormant') })
  cells.push({ name: 'mystery emerged', object: createMysterySprout('emerged') })
}

if (set === 'bed') {
  /*
   * The beat-8 test: six plants on tile spacing, five ordinary and one odd,
   * seen from the game's low over-the-shoulder height. This is the only view
   * that answers the question the harvest beat actually asks — can the player
   * find the wrong one without being told?
   */
  const bed = new THREE.Group()
  for (let i = 0; i < 6; i++) {
    const plant = createSunTomato(i === 3 ? 'odd' : 'fruiting')
    plant.position.set((i % 3) * 1.2 - 1.2, 0, Math.floor(i / 3) * 1.2 - 0.6)
    plant.rotation.y = i * 1.7
    bed.add(plant)
  }
  cells.push({ name: 'bed of six (one odd)', object: bed, yaw: 0.25, zoom: 1.25 })
}

if (set === 'all' || set === 'goat') {
  cells.push(goatCell('goat profile', Math.PI / 2, null))
  cells.push(goatCell('goat 3/4', 0.9, null))
  cells.push(goatCell('goat look-at-you', 0.15, new THREE.Vector3(0, 1.5, 6), 1.5))
}

if (set === 'all' || set === 'props') {
  const crate = createOpeningCrate()
  cells.push({ name: 'crate closed', object: crate.root, yaw: 0.7 })
  const open = createOpeningCrate()
  open.openLid()
  for (let i = 0; i < 40; i++) open.update(0.05)
  cells.push({ name: 'crate open', object: open.root, yaw: 0.7 })
  cells.push({ name: 'seed pouch', object: createSeedPouch(), yaw: 0.4 })
  cells.push({ name: 'shovel', object: createOpeningShovel(), yaw: 0.6 })
  cells.push({ name: 'journal', object: createJournalProp(), yaw: 0.5 })
  cells.push({ name: 'spiral shell', object: createWashupProp('spiral-shell'), yaw: 0.5 })
  cells.push({ name: 'sea glass', object: createWashupProp('sea-glass'), yaw: 0.5 })
  cells.push({ name: 'driftwood stick', object: createWashupProp('driftwood-stick'), yaw: 0.5 })
}

if (set === 'all' || set === 'chaos') {
  const kinds: ChaosKind[] = ['vine', 'frond', 'driftwood', 'morning-glory', 'basket', 'stone', 'amphora']
  for (const kind of kinds) cells.push({ name: kind, object: createChaosProp(kind, 0).root, yaw: 0.6 })
  cells.push({ name: 'bougainvillea', object: createBougainvilleaSpill(0), yaw: 0.5 })
}

const cols = num('cols', Math.min(cells.length, 5))
const cellPx = num('cell', 330)
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
scene.background = new THREE.Color(0x9db9c6)

/*
 * The opening's rig, not the game's noon rig: one low warm key (~12° elevation,
 * 4200K-ish), a cool sky bounce, and a weak seaward fill. Long raking shadows
 * are most of what gives these props their form, so the key sits low and to
 * one side rather than overhead.
 */
const sun = new THREE.DirectionalLight(0xffd9a8, 1.9)
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
sun.position.set(-14, 6, 9)
scene.add(sun, sun.target)

scene.add(new THREE.HemisphereLight(0xbcd8ea, 0x5c4c3a, 1.15))
scene.add(new THREE.AmbientLight(0xffeed6, 0.34))
const fill = new THREE.DirectionalLight(0x9fc2e0, 0.4)
fill.position.set(10, 8, -12)
scene.add(fill)

// Volcanic loam underfoot — the ground these props are actually seen against.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x3a2e24 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

for (const cell of cells) {
  cell.object.visible = false
  scene.add(cell.object)
}

// --- framing -----------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200)
const box = new THREE.Box3()
const size = new THREE.Vector3()
const centre = new THREE.Vector3()

function frame(cell: Cell) {
  const model = cell.object
  model.updateMatrixWorld(true)
  box.setFromObject(model)
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.6, 0.4, 0.6))
  box.getSize(size)
  box.getCenter(centre)

  const radius = Math.max(0.5 * Math.hypot(size.x, size.y, size.z), 0.5)
  const vFov = (camera.fov * Math.PI) / 180
  const dist = radius / Math.sin(vFov / 2) / (ZOOM * (cell.zoom ?? 1))

  const yaw = cell.yaw ?? 0.55
  const cosP = Math.cos(PITCH)
  camera.position.set(
    centre.x + Math.sin(yaw) * cosP * dist,
    centre.y + Math.sin(PITCH) * dist,
    centre.z + Math.cos(yaw) * cosP * dist,
  )
  camera.lookAt(centre)
}

// --- draw --------------------------------------------------------------------

const labels = document.getElementById('labels')!
const dpr = renderer.getPixelRatio()

/*
 * Drawn as a function rather than once, because several of these props are
 * authored GLBs now and a static page renders before any fetch lands. The
 * first pass shows whatever is procedural; the redraw after the models arrive
 * is the one worth screenshotting, and `__ready` only flips then.
 */
function draw() {
labels.innerHTML = ''
renderer.setScissorTest(true)
cells.forEach((cell, i) => {
  cell.settle?.()
  const col = i % cols
  const row = Math.floor(i / cols)
  const x = col * cellPx
  const yBottom = (rows - row - 1) * cellPx

  cells.forEach((c, j) => (c.object.visible = j === i))
  frame(cell)
  camera.aspect = 1
  camera.updateProjectionMatrix()

  renderer.setViewport(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.setScissor(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.shadowMap.needsUpdate = true
  renderer.render(scene, camera)

  const label = document.createElement('div')
  label.className = 'label'
  label.style.left = `${x + 8}px`
  label.style.top = `${row * cellPx + cellPx - 24}px`
  label.textContent = cell.name
  labels.appendChild(label)
})
renderer.setScissorTest(false)
document.getElementById('head')!.textContent = `${cells.length} objects · set ${set} · dawn rig`
}

draw()
void Promise.all([loadModels(), loadGoatModel()]).then(() => {
  draw()
  ;(window as unknown as { __ready?: boolean }).__ready = true
})
