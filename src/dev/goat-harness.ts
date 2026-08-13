import * as THREE from 'three'
import { createGoatModel, type GoatRig } from '../assets/opening/goat-model'
import { loadGoatModel } from '../assets/models'
import { GoatArrival, type GoatPhase } from '../game/opening/goat'

/**
 * Dev-only bench for the beat-9 goat rig.
 *
 * Watching the arrival inside the game costs a nine-beat playthrough to see one
 * second of animation, which is far too slow a loop to debug a skeleton with.
 * This page renders the SAME `createGoatModel()` rig and the SAME `GoatArrival`
 * script, but steps them by hand at a fixed dt and photographs a contact sheet:
 *
 *   row 1  one control at a time — the only way to tell a leg that swings the
 *          wrong way from a leg that is fine but sits under a broken body
 *   row 2  a gait cycle sampled across the walk phase
 *   row 3  one tile per scripted phase
 *
 * It also prints landmark positions (hooves, nose, ear tips, tail tip) in the
 * rig's own root space, because "the knee bends backwards" is a claim a number
 * can settle and a screenshot can only suggest.
 *
 *   node scripts/shot.mjs goat-harness.html out/goat.png 2200 1000
 */

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key))
  return Number.isFinite(v) && params.has(key) ? v : fallback
}

const cellPx = num('cell', 300)
const PITCH = num('pitch', 0.16)
const DT = 1 / 60

/** Bones worth measuring: the four hoof tips, the nose, both ear tips, tail tip. */
const LANDMARKS = ['frontleg2', 'R_frontleg2', 'backleg2', 'R_backleg2', 'headend', 'earend', 'R_earend', 'tail3']

interface Tile {
  name: string
  object: THREE.Object3D
  /** Camera yaw. 0 puts the camera on +z, i.e. in front of a goat facing +z. */
  yaw: number
  zoom?: number
  /** Re-pose before the tile is drawn. Tiles run in order, so this may step time. */
  apply: () => void
  /** Landmark sample taken after `apply`, in the rig root's own space. */
  measure?: boolean
  /** Same, but for the scripted rig — this is what catches a scale that only
   *  appears once the baked clip is blended in. */
  measureStage?: boolean
}

// --- rigs --------------------------------------------------------------------

/** Isolation rig: driven one control at a time, nothing else touching it. */
const probeRig: GoatRig = createGoatModel()
const probeRoot = probeRig.root

/** The real scripted arrival, stepped at a fixed dt. */
const stage = new THREE.Group()
const arrival = new GoatArrival(stage)
let arrivalT = 0

function resetControls(rig: GoatRig): void {
  for (const leg of rig.legs) leg.rotation.set(0, 0, 0)
  for (const ear of rig.ears) ear.rotation.set(0, 0, 0)
  rig.tail.rotation.set(0, 0, 0)
}

/** Settle the rig's internal blends on a held pose. */
function settle(rig: GoatRig, look: THREE.Vector3 | null, frames = 45): void {
  for (let i = 0; i < frames; i++) rig.lookAt(look, DT)
}

function probe(name: string, yaw: number, pose: (rig: GoatRig) => void, look: THREE.Vector3 | null): Tile {
  return {
    name,
    object: probeRoot,
    yaw,
    apply: () => {
      resetControls(probeRig)
      pose(probeRig)
      settle(probeRig, look)
    },
    measure: true,
  }
}

const SIDE = Math.PI / 2
const FRONT = 0

const tiles: Tile[] = []

// --- row 1: one control at a time --------------------------------------------

tiles.push(probe('rest', SIDE, () => {}, null))
tiles.push(probe('leg0 FL +0.6', SIDE, (r) => (r.legs[0].rotation.x = 0.6), null))
tiles.push(probe('leg1 FR +0.6', SIDE, (r) => (r.legs[1].rotation.x = 0.6), null))
tiles.push(probe('leg2 RL +0.6', SIDE, (r) => (r.legs[2].rotation.x = 0.6), null))
tiles.push(probe('leg3 RR +0.6', SIDE, (r) => (r.legs[3].rotation.x = 0.6), null))
tiles.push(probe('tail z +0.8', SIDE, (r) => (r.tail.rotation.z = 0.8), null))
tiles.push(probe('look front', FRONT, () => {}, new THREE.Vector3(0, 1.05, 4)))
tiles.push(probe('look front (side)', SIDE, () => {}, new THREE.Vector3(0, 1.05, 4)))
tiles.push(probe('look down', SIDE, () => {}, new THREE.Vector3(0, 0.05, 1.1)))
tiles.push(probe('look up', SIDE, () => {}, new THREE.Vector3(0, 4, 2)))

// --- rows 2 and 3: the scripted arrival ---------------------------------------

/**
 * Step the arrival forward. Tiles are declared in time order, so each one only
 * ever advances — the sequence runs once, and the sheet is a strip of it.
 */
function advance(seconds: number): void {
  const steps = Math.max(1, Math.round(seconds / DT))
  for (let i = 0; i < steps; i++) {
    arrival.update(DT, arrivalT)
    arrivalT += DT
  }
}

function until(phase: GoatPhase, cap = 60): void {
  for (let i = 0; i < cap / DT && arrival.phase !== phase; i++) {
    arrival.update(DT, arrivalT)
    arrivalT += DT
  }
}

function scripted(name: string, yawOffset: number, step: () => void, measureStage = false): Tile {
  return {
    name,
    object: stage,
    yaw: 0,
    measureStage,
    apply: () => {
      step()
      // The camera follows the animal's own facing so a "profile" stays a
      // profile as the goat turns through its bezier.
      tileYaw = arrival.facing + yawOffset
    },
  }
}

let tileYaw = 0

// Row 2 — a gait cycle inside the walk phase, sampled every ~1/6 of a stride.
// gaitHz 6.5 rad/s means a full sin cycle takes 2*pi/6.5 = 0.967 s.
const STRIDE = (Math.PI * 2) / 6.5
for (let i = 0; i < 6; i++) {
  tiles.push(
    scripted(`walk ${i + 1}/6`, SIDE, () => {
      if (i === 0) {
        until('walk')
        advance(1.2) // clear of the treeline, up to speed
      } else {
        advance(STRIDE / 6)
      }
    }, true),
  )
}

// Row 3 — one tile per remaining phase, plus two through the bound.
tiles.push(scripted('walk pause', SIDE, () => until('sniff'), true))
tiles.push(scripted('sniff', SIDE, () => advance(0.6), true))
tiles.push(scripted('eat', SIDE, () => until('eat')))
tiles.push(scripted('eat late', SIDE, () => advance(1.6), true))
tiles.push(scripted('look (front)', FRONT, () => until('look'), true))
tiles.push(scripted('look (side)', SIDE, () => advance(0.5)))
tiles.push(scripted('bleat', SIDE, () => until('bleat')))
tiles.push(scripted('bound 1', SIDE, () => until('bound')))
tiles.push(scripted('bound 2', SIDE, () => advance(0.18)))
tiles.push(scripted('bound 3', SIDE, () => advance(0.18)))

// --- scene -------------------------------------------------------------------

const cols = num('cols', 10)
const rows = Math.ceil(tiles.length / cols)

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(1)
renderer.setSize(cols * cellPx, rows * cellPx, false)
canvas.style.width = `${cols * cellPx}px`
canvas.style.height = `${rows * cellPx}px`
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fa8b4)

const sun = new THREE.DirectionalLight(0xffd9a8, 2.0)
sun.position.set(-14, 9, 9)
scene.add(sun, sun.target)
scene.add(new THREE.HemisphereLight(0xbcd8ea, 0x5c4c3a, 1.2))
scene.add(new THREE.AmbientLight(0xffeed6, 0.4))

scene.add(probeRoot, stage)
probeRoot.visible = true

// A ground plane at y=0 under each subject: the cheapest possible check that
// the hooves are planted rather than floating or buried.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x3a2e24 }))
ground.rotation.x = -Math.PI / 2
scene.add(ground)
const gridA = new THREE.GridHelper(400, 400, 0x6a5a48, 0x4a3e32)
scene.add(gridA)

// --- framing -----------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 400)
const box = new THREE.Box3()
const size = new THREE.Vector3()
const centre = new THREE.Vector3()

function frame(tile: Tile, yaw: number) {
  tile.object.updateMatrixWorld(true)
  // Centre on the animal's own root, not a bounding box: a skinned mesh's box
  // is cached from one pose, so framing off it makes the goat drift around the
  // tile for reasons that have nothing to do with the animation.
  const subject = tile.object === stage ? (stage.children[0] ?? stage) : tile.object
  subject.getWorldPosition(centre)
  centre.y += 0.5
  box.makeEmpty()
  box.getSize(size)
  // Frame a fixed-size animal, not its bounding box: a pose that flings a leg
  // out would otherwise zoom the camera back and hide the very change we are
  // looking for. 0.85 units of radius covers a 0.95-tall goat with headroom.
  const radius = 0.85
  const vFov = (camera.fov * Math.PI) / 180
  const dist = radius / Math.sin(vFov / 2) / (tile.zoom ?? 1)
  const cosP = Math.cos(PITCH)
  camera.position.set(
    centre.x + Math.sin(yaw) * cosP * dist,
    Math.max(0.15, centre.y) + Math.sin(PITCH) * dist,
    centre.z + Math.cos(yaw) * cosP * dist,
  )
  camera.lookAt(centre.x, Math.max(0.15, centre.y), centre.z)
}

// --- landmark readout ---------------------------------------------------------

const readout: string[] = []
const wv = new THREE.Vector3()

function sample(name: string): void {
  probeRoot.updateMatrixWorld(true)
  const parts: string[] = []
  for (const bone of LANDMARKS) {
    const o = probeRoot.getObjectByName(bone)
    if (!o) {
      parts.push(`${bone}=MISSING`)
      continue
    }
    o.getWorldPosition(wv)
    probeRoot.worldToLocal(wv)
    parts.push(`${bone} ${wv.x.toFixed(3)},${wv.y.toFixed(3)},${wv.z.toFixed(3)}`)
  }
  // Grounding: the drawn mesh's own extent, not a bone's. min.y should be 0.
  const mbox = new THREE.Box3().setFromObject(probeRoot)
  parts.push(`meshY ${mbox.min.y.toFixed(3)}..${mbox.max.y.toFixed(3)}`)
  readout.push(`${name.padEnd(18)} ${parts.join('  ')}`)
}

/**
 * Size of the scripted goat, right now, in its own root space.
 *
 * Bone spans rather than a bounding box, because a SkinnedMesh caches its box
 * from one pose and would report the same number however big the animal is
 * actually being drawn. Hip-to-nose is the honest ruler.
 */
const hipV = new THREE.Vector3()
const noseV = new THREE.Vector3()

function sampleStage(name: string): void {
  const root = stage.children[0]
  if (!root) return
  root.updateMatrixWorld(true)
  const hips = root.getObjectByName('Hips')
  const nose = root.getObjectByName('headend')
  const ear = root.getObjectByName('earend')
  if (!hips || !nose || !ear) {
    readout.push(`${name.padEnd(18)} bones missing`)
    return
  }
  hips.getWorldPosition(hipV)
  nose.getWorldPosition(noseV)
  const span = hipV.distanceTo(noseV)
  root.worldToLocal(hipV)
  root.worldToLocal(noseV)
  ear.getWorldPosition(new THREE.Vector3())
  const earLocal = root.worldToLocal(ear.getWorldPosition(new THREE.Vector3()))
  readout.push(
    `${name.padEnd(18)} hip->nose ${span.toFixed(4)}  hipY ${hipV.y.toFixed(4)}  noseY ${noseV.y.toFixed(4)}  earY ${earLocal.y.toFixed(4)}`,
  )
}

// --- draw --------------------------------------------------------------------

const labels = document.getElementById('labels')!

function draw() {
  labels.innerHTML = ''
  readout.length = 0
  renderer.setScissorTest(true)
  tiles.forEach((tile, i) => {
    tileYaw = tile.yaw
    tile.apply()
    if (tile.measure) sample(tile.name)
    if (tile.measureStage) sampleStage(tile.name)

    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * cellPx
    const yBottom = (rows - row - 1) * cellPx

    probeRoot.visible = tile.object === probeRoot
    stage.visible = tile.object === stage
    if (stage.visible) {
      // The arrival hides its own root outside the visible beats; the bench
      // wants to see the pose regardless.
      stage.traverse((o) => (o.visible = true))
    }

    frame(tile, tileYaw)
    camera.aspect = 1
    camera.updateProjectionMatrix()

    renderer.setViewport(x, yBottom, cellPx, cellPx)
    renderer.setScissor(x, yBottom, cellPx, cellPx)
    renderer.render(scene, camera)

    const label = document.createElement('div')
    label.className = 'label'
    label.style.left = `${x + 6}px`
    label.style.top = `${row * cellPx + cellPx - 22}px`
    label.textContent = tile.name
    labels.appendChild(label)
  })
  renderer.setScissorTest(false)
  document.getElementById('head')!.textContent = `goat rig bench · ${tiles.length} tiles`
  document.getElementById('data')!.textContent = readout.join('\n')
  ;(window as unknown as { __probe?: string }).__probe = readout.join('\n')
}

// The GLB is not there on the first pass; only the redraw after it lands is
// worth photographing.
arrival.begin([new THREE.Vector3(-30.5, 0, -4.2)], () => new THREE.Vector3(-27.5, 1.35, 1.5))
draw()
void loadGoatModel().then(() => {
  arrivalT = 0
  arrival.begin([new THREE.Vector3(-30.5, 0, -4.2)], () => new THREE.Vector3(-27.5, 1.35, 1.5))
  draw()
  ;(window as unknown as { __ready?: boolean }).__ready = true
})
