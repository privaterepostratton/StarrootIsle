/**
 * Chaos-prop harness: every clearable at rest, under full strain, and part-way
 * through its clear, under the opening's own dawn rig.
 *
 *   node scripts/cdp.mjs "http://localhost:5216/scratchpad/chaos-check.html" \
 *        --out out.png --size 1920x1290 --wait 6500
 *
 *   ?set=phases   the kinds × phases contact sheet (default)
 *   ?set=spread   the pocket's own vine/frond multiplicity, to judge variance
 *   ?kinds=a,b    restrict the kinds; ?steps=0.1,0.3 the clear samples (seconds)
 *
 * Static: draws once the models land, then sets __ready. Same lighting as
 * src/dev/opening-gallery.ts, because these props are only ever seen at 7.2am.
 */
import * as THREE from 'three'
import { createChaosProp, type ChaosKind } from '../src/assets/opening/chaos-props'
import { loadModels } from '../src/assets/models'

const params = new URLSearchParams(location.search)
const set = params.get('set') ?? 'phases'
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d)

const ALL: ChaosKind[] = ['vine', 'frond', 'driftwood', 'basket', 'stone', 'amphora']
const KINDS = (params.get('kinds')?.split(',') as ChaosKind[]) ?? ALL
/** Clear samples, in seconds after playClear(). */
const STEPS = params.get('steps')?.split(',').map(Number) ?? [0.15, 0.32]

interface Cell {
  name: string
  object: THREE.Object3D
  drive: () => void
  yaw: number
}

/** Step a rig to a pose: settle, optionally strain, optionally clear. */
function driver(kind: ChaosKind, variant: number, strain: number, clearFor: number) {
  const rig = createChaosProp(kind, variant)
  const drive = () => {
    let t = 0
    const dt = 1 / 60
    // Rest first, so the idle sway has a defined phase in every cell.
    for (let i = 0; i < 30; i++, t += dt) rig.update(dt, t)
    if (strain > 0) {
      rig.setStrain(strain)
      for (let i = 0; i < 45; i++, t += dt) rig.update(dt, t)
    }
    if (clearFor > 0) {
      rig.playClear()
      for (let i = 0; i < Math.round(clearFor * 60); i++, t += dt) rig.update(dt, t)
    }
  }
  return { rig, drive }
}

function buildCells(): Cell[] {
  const cells: Cell[] = []
  if (set === 'phases') {
    const phases = [
      { label: 'rest', strain: 0, clear: 0 },
      { label: 'strain', strain: 1, clear: 0 },
      ...STEPS.map((t) => ({ label: `clear +${t}s`, strain: 1, clear: t })),
    ]
    for (const p of phases) {
      for (const kind of KINDS) {
        const { rig, drive } = driver(kind, 0, p.strain, p.clear)
        cells.push({ name: `${kind} · ${p.label}`, object: rig.root, drive, yaw: 0.6 })
      }
    }
  } else {
    // The five vines and four fronds the pocket actually places, at the variant
    // numbers it actually passes — two of each are repeats of one variant.
    const spread: [ChaosKind, number][] = [
      ['vine', 0], ['vine', 1], ['vine', 2], ['vine', 0], ['vine', 1],
      ['frond', 0], ['frond', 1], ['frond', 0], ['frond', 1], ['driftwood', 0],
    ]
    for (const [kind, variant] of spread) {
      const { rig, drive } = driver(kind, variant, 0, 0)
      cells.push({ name: `${kind} v${variant}`, object: rig.root, drive, yaw: 0.35 })
    }
  }
  return cells
}

// --- scene -------------------------------------------------------------------

const canvas = document.getElementById('c') as HTMLCanvasElement
// preserveDrawingBuffer: the page draws once and stops, and a CDP screenshot of
// a swapped-away WebGL buffer is a blank rectangle.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9db9c6)

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

// The grass the pocket actually stands on, not the loam under it.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0x2f6b2a }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200)
const box = new THREE.Box3()
const size = new THREE.Vector3()
const centre = new THREE.Vector3()
const PITCH = num('pitch', 0.24)
const ZOOM = num('zoom', 0.92)

function frame(cell: Cell) {
  cell.object.updateMatrixWorld(true)
  box.setFromObject(cell.object)
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.6, 0.4, 0.6))
  box.getSize(size)
  box.getCenter(centre)
  const radius = Math.max(0.5 * Math.hypot(size.x, size.y, size.z), 0.7)
  const dist = radius / Math.sin(((camera.fov * Math.PI) / 180) / 2) / ZOOM
  camera.position.set(
    centre.x + Math.sin(cell.yaw) * Math.cos(PITCH) * dist,
    centre.y + Math.sin(PITCH) * dist,
    centre.z + Math.cos(cell.yaw) * Math.cos(PITCH) * dist,
  )
  camera.lookAt(centre)
}

const labels = document.getElementById('labels')!

function draw(cells: Cell[], cols: number, cellPx: number, rows: number) {
  labels.innerHTML = ''
  renderer.setScissorTest(true)
  cells.forEach((cell, i) => {
    cell.drive()
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * cellPx
    const yBottom = (rows - row - 1) * cellPx
    cells.forEach((c, j) => (c.object.visible = j === i))
    frame(cell)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    renderer.setViewport(x, yBottom, cellPx, cellPx)
    renderer.setScissor(x, yBottom, cellPx, cellPx)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, camera)

    const label = document.createElement('div')
    label.className = 'label'
    label.style.left = `${x + 8}px`
    label.style.top = `${row * cellPx + cellPx - 22}px`
    label.textContent = cell.name
    labels.appendChild(label)
  })
  renderer.setScissorTest(false)
}

/*
 * Cells are built AFTER loadModels() resolves, never at module scope.
 *
 * A rig created while the cache is still cold registers its own
 * `loadModels().then(attach)`, and loadModels does not memoise an in-flight
 * promise — so the page's load and each rig's load are separate chains that
 * settle in arbitrary order, and a draw fired off the page's chain caught some
 * props before their mesh had been attached. The game never sees this: boot
 * warms the cache long before beat 5 builds the pocket, and `peekModels()`
 * then returns it synchronously.
 */
void loadModels().then(() => {
  const cells = buildCells()
  const cols = num('cols', set === 'phases' ? KINDS.length : 5)
  const cellPx = num('cell', 320)
  const rows = Math.ceil(cells.length / cols)
  renderer.setSize(cols * cellPx, rows * cellPx, false)
  canvas.style.width = `${cols * cellPx}px`
  canvas.style.height = `${rows * cellPx}px`
  for (const cell of cells) {
    cell.object.visible = false
    scene.add(cell.object)
  }
  draw(cells, cols, cellPx, rows)
  ;(window as unknown as { __ready?: boolean }).__ready = true
})
