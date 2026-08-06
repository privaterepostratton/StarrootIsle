import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PALETTE, mat } from '../assets/style'
import { createBushModel } from '../assets/nature'
import { PROP_HEIGHT } from '../assets/models'

/**
 * Dev-only contact sheet for the *authored* props.
 *
 * The crop gallery answers "does this plant read"; this one answers the same
 * question for everything loaded from a glTF. It was written to judge a
 * replacement against what shipped — a prop swap is otherwise a blind edit,
 * because the old and the new never appear on screen together and the
 * comparison happens from memory, one boot apart, at whatever distance the
 * camera happened to be. It still earns its keep as the sheet that shows what
 * the decimation and retint passes actually did to a model.
 *
 * One warning it cannot give: this page has no postfx, and the game grades
 * every frame at saturation 1.2. A prop that reads correctly here can still be
 * fluorescent in game — see scripts/retint-glb.mjs.
 *
 * Each pair is rendered at the *same* target height so the judgement is about
 * silhouette and texture rather than about scale, and a 1.6-unit farmer stand-in
 * shares every cell so "the same height" is still an absolute one. Lighting and
 * tone mapping are copied from core/engine.ts at noon, as in the crop gallery,
 * because a prop that reads under a studio rig can still be mud in game.
 *
 * Renders exactly once, no animation loop, so headless Chrome can capture it:
 *   node scripts/shot.mjs model-gallery.html out/models.png 1400 1500
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

const PITCH = num('pitch', 0.3)
const YAW = num('yaw', 0.55)
const ZOOM = num('zoom', 1)
const cellPx = num('cell', 340)
const cols = num('cols', 4)

interface Cell {
  label: string
  note: string
  /** Candidate models are flagged so the sheet can colour their label. */
  candidate?: boolean
  /** Target height in world units — shared across a pair. */
  height: number
  /** A glTF under public/models, or a procedural group built in code. */
  path?: string
  build?: () => THREE.Object3D
}

/*
 * Every authored prop, at its shipping PROP_HEIGHT, so each is judged at the
 * size it is actually placed at rather than at whatever scale it was authored.
 */
const cells: Cell[] = [
  { label: 'tree-broadleaf', note: 'shipping · retinted', candidate: true, height: PROP_HEIGHT.tree, path: 'models/tree-broadleaf.glb' },
  { label: 'tree-conifer', note: 'shipping · decimated', candidate: true, height: PROP_HEIGHT.pine, path: 'models/tree-conifer.glb' },
  { label: 'lantern', note: 'shipping', candidate: true, height: PROP_HEIGHT.lantern, path: 'models/lantern.glb' },
  { label: 'plot-fence', note: 'shipping · decimated + retinted', candidate: true, height: 0.9, path: 'models/plot-fence.glb' },

  { label: 'rock', note: 'shipping', height: PROP_HEIGHT.rock, path: 'models/rock.glb' },
  { label: 'rock-cluster', note: 'shipping · decimated', candidate: true, height: PROP_HEIGHT.rockCluster, path: 'models/rock-cluster.glb' },
  { label: 'log', note: 'shipping', height: PROP_HEIGHT.log, path: 'models/log.glb' },
  { label: 'stump', note: 'shipping · decimated', candidate: true, height: PROP_HEIGHT.stump, path: 'models/stump.glb' },

  { label: 'bush', note: 'superseded · procedural', height: PROP_HEIGHT.bush, build: () => createBushModel(2) },
  { label: 'bush', note: 'shipping · decimated', candidate: true, height: PROP_HEIGHT.bush, path: 'models/bush.glb' },
  { label: 'barrel', note: 'shipping', candidate: true, height: PROP_HEIGHT.barrel, path: 'models/barrel.glb' },
  { label: 'haybale', note: 'shipping', candidate: true, height: PROP_HEIGHT.haybale, path: 'models/haybale.glb' },

  { label: 'haypile', note: 'shipping', candidate: true, height: PROP_HEIGHT.haypile, path: 'models/haypile.glb' },
  { label: 'barn', note: 'shipping', candidate: true, height: PROP_HEIGHT.barn, path: 'models/barn.glb' },
  { label: 'scarecrow', note: 'shipping', candidate: true, height: PROP_HEIGHT.scarecrow, path: 'models/scarecrow.glb' },
  { label: 'bench', note: 'shipping · decimated', candidate: true, height: PROP_HEIGHT.bench, path: 'models/bench.glb' },

  { label: 'sprinkler-basic', note: 'shipping · water is procedural', candidate: true, height: PROP_HEIGHT.sprinkler, path: 'models/sprinkler-basic.glb' },
  { label: 'beehive', note: 'shipping · bees are procedural', candidate: true, height: PROP_HEIGHT.beehive, path: 'models/beehive.glb' },

  { label: 'mailbox', note: 'shipping · flag is procedural', candidate: true, height: PROP_HEIGHT.mailbox, path: 'models/mailbox.glb' },
  { label: 'signpost', note: 'shipping', height: PROP_HEIGHT.signpost, path: 'models/signpost.glb' },
  { label: 'cottage', note: 'shipping', height: PROP_HEIGHT.cottage, path: 'models/cottage.glb' },
  { label: 'shop', note: 'shipping', height: PROP_HEIGHT.shop, path: 'models/shop.glb' },
]

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

// Engine's rig, with the sun where DayCycle puts it at noon. The shadow frustum
// is wider than the crop gallery's because a pine is four times a turnip.
const sun = new THREE.DirectionalLight(0xfff2d6, 1.75)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 80
const s = 8
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

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(PALETTE.grass))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

/**
 * A 1.6-unit stand-in for the farmer, off to one side of every cell.
 *
 * Without it "same height" only means the two halves of a pair match each
 * other; with it, a boulder that would come up to the player's chest is
 * obviously that, in the cell, without going back to the game to check.
 */
function farmerStandIn(): THREE.Object3D {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.86, 4, 12), mat(0x6f7a86))
  body.position.y = 0.65
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat(0x8a94a0))
  head.position.y = 1.4
  for (const m of [body, head]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  g.add(body, head)
  return g
}

// --- loading -----------------------------------------------------------------

const loader = new GLTFLoader()

/**
 * One prop, scaled to `height` and standing on the ground.
 *
 * The whole loaded scene is kept rather than lifting a single mesh out of it —
 * models.ts takes the first mesh only, which is right for the shipping props but
 * would silently hide a candidate that arrives as several parts, and "why is
 * half the fence missing" is exactly the question this page exists to answer.
 */
async function loadProp(path: string, height: number): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(`/${path}`)
  return fit(gltf.scene, height)
}

function fit(object: THREE.Object3D, height: number): THREE.Object3D {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = size.y > 1e-4 ? height / size.y : 1

  // Wrapped rather than scaled in place so the ground lift is applied after the
  // scale, in the parent's units — scaling and translating the same node makes
  // the lift scale too, which buries the small props.
  const holder = new THREE.Group()
  object.scale.multiplyScalar(scale)
  object.position.y = -box.min.y * scale
  holder.add(object)
  return holder
}

const built = await Promise.all(
  cells.map((cell) => (cell.path ? loadProp(cell.path, cell.height) : Promise.resolve(fit(cell.build!(), cell.height)))),
)

const stand = farmerStandIn()
scene.add(stand)

built.forEach((m) => {
  m.visible = false
  scene.add(m)
})

// --- framing -----------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 400)
const centre = new THREE.Vector3()

/**
 * Frame the prop and the stand-in together.
 *
 * Fitting a sphere around both, rather than around the prop alone, is what keeps
 * the reference figure in shot for a six-metre pine without shrinking a knee-high
 * rock to a speck — the cell is always "this prop, next to a person".
 */
function frame(model: THREE.Object3D, height: number) {
  // The stand-in is pushed clear of the prop's own footprint.
  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  stand.position.set(size.x * 0.5 + 0.55, 0, 0)

  const span = Math.max(height, 1.6)
  centre.set(stand.position.x * 0.5, span * 0.5, 0)
  const radius = 0.5 * Math.hypot(Math.max(size.x, 0.6) + 1.4, span, Math.max(size.z, 0.6))
  const vFov = (camera.fov * Math.PI) / 180
  const dist = radius / Math.sin(vFov / 2) / ZOOM

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

  built.forEach((m, j) => (m.visible = j === i))
  frame(built[i], cell.height)
  camera.aspect = 1
  camera.updateProjectionMatrix()

  renderer.setViewport(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.setScissor(x * dpr, yBottom * dpr, cellPx * dpr, cellPx * dpr)
  renderer.shadowMap.needsUpdate = true
  renderer.render(scene, camera)

  const label = document.createElement('div')
  label.className = cell.candidate ? 'label new' : 'label'
  label.style.left = `${x + 8}px`
  label.style.top = `${row * cellPx + cellPx - 26}px`
  label.innerHTML = `<b>${cell.label}</b> <span>${cell.note} · ${cell.height}u</span>`
  labels.appendChild(label)
})
renderer.setScissorTest(false)

document.getElementById('head')!.textContent =
  `${cells.length} props · no postfx grade here · pitch ${PITCH} · yaw ${YAW} · zoom ${ZOOM}`

/*
 * Triangle counts, read back with `cdp.mjs --eval`.
 *
 * The swap decision is not only "which looks better": vegetation.ts already
 * trimmed the forest once because two authored trees at 1400 instances cost 2M
 * triangles a frame. A candidate that is prettier and three times heavier is a
 * different trade at 900 instances than at 15, so the count belongs next to the
 * picture rather than in a follow-up investigation.
 */
;(window as unknown as { __stats?: unknown }).__stats = cells.map((cell, i) => {
  let tris = 0
  built[i].traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry
    tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3
  })
  return { label: cell.label, note: cell.note, tris }
})

// Signal for headless capture: the page is static, so this never changes again.
;(window as unknown as { __ready?: boolean }).__ready = true
