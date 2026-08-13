/*
 * Dev harness for the authored goat. Not part of the game.
 *
 *   /scratchpad/goat-check.html?mode=walk|look|rest&view=side|front|three
 *
 * window.__g.set(mode, view) re-aims it; window.__ready flips true once the
 * GLB is in and the first frame has drawn.
 */
import * as THREE from 'three'
import { loadGoatModel } from '/src/assets/models'
import { createGoatModel, GOAT_BODY_Y } from '/src/assets/opening/goat-model'

const params = new URLSearchParams(location.search)
let mode = params.get('mode') ?? 'rest'
let view = params.get('view') ?? 'three'

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
const W = Number(params.get('w') ?? 1100)
const H = Number(params.get('h') ?? 720)
renderer.setSize(W, H, false)
canvas.style.width = `${W}px`
canvas.style.height = `${H}px`
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
for (const [k, v] of [['left', -6], ['right', 6], ['top', 6], ['bottom', -6]] as const) {
  ;(sun.shadow.camera as unknown as Record<string, number>)[k] = v
}
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.022
sun.position.set(-14, 6, 9)
scene.add(sun, sun.target)
scene.add(new THREE.HemisphereLight(0xbcd8ea, 0x5c4c3a, 1.15))
scene.add(new THREE.AmbientLight(0xffeed6, 0.34))
const fill = new THREE.DirectionalLight(0x9fc2e0, 0.4)
fill.position.set(10, 8, -12)
scene.add(fill)

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshLambertMaterial({ color: 0x3a2e24 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// Scale reference: a 1.6-unit farmer-height post and a 1.2 tile square.
const post = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 1.6, 0.24),
  new THREE.MeshLambertMaterial({ color: 0x6f7f8a }),
)
post.position.set(1.6, 0.8, -0.6)
post.castShadow = true
scene.add(post)
const tile = new THREE.Mesh(
  new THREE.PlaneGeometry(1.2, 1.2),
  new THREE.MeshLambertMaterial({ color: 0x50412f }),
)
tile.rotation.x = -Math.PI / 2
tile.position.set(0, 0.002, 0)
scene.add(tile)

const camera = new THREE.PerspectiveCamera(46, W / H, 0.05, 200)

const rig = createGoatModel()
scene.add(rig.root)

const lookTarget = new THREE.Vector3()
let t = 0
let gaitT = 0

function frameCamera(centre: THREE.Vector3) {
  const dist = 3.1
  if (view === 'side') camera.position.set(centre.x + dist, 0.85, centre.z)
  else if (view === 'front') camera.position.set(centre.x, 0.72, centre.z + dist * 0.72)
  else camera.position.set(centre.x + dist * 0.72, 0.95, centre.z + dist * 0.72)
  camera.lookAt(centre.x, view === 'front' ? 0.62 : 0.45, centre.z)
}

const centre = new THREE.Vector3()

function tick(dt: number) {
  t += dt
  let look: THREE.Vector3 | null = null
  let moving = false

  if (mode === 'walk') {
    // Straight line at the arrival's own walking pace, so the camera can sit
    // square on the side of it. The rig reads its own root speed to decide how
    // much of the baked stride to blend in.
    const speed = Number(params.get('speed') ?? 1.05)
    rig.root.position.set(0, 0, t * speed)
    rig.root.rotation.y = 0
    moving = true
    lookTarget.set(0, 0.3, rig.root.position.z + 1.4)
    look = lookTarget
  } else if (mode === 'look') {
    rig.root.position.set(0, 0, 0)
    rig.root.rotation.y = 0.5
    lookTarget.copy(camera.position)
    look = lookTarget
  } else if (mode === 'eat') {
    rig.root.position.set(0, 0, 0)
    rig.root.rotation.y = 0.4
    lookTarget.set(0.35, 0.06, 0.75)
    look = lookTarget
  } else {
    rig.root.position.set(0, 0, 0)
    rig.root.rotation.y = 0.5
  }

  const amp = moving ? 0.5 : 0
  if (moving) gaitT += dt * 6.5
  const sw = Math.sin(gaitT) * amp
  rig.legs[0].rotation.x = sw
  rig.legs[1].rotation.x = -sw
  rig.legs[2].rotation.x = -sw * 0.9
  rig.legs[3].rotation.x = sw * 0.9
  rig.body.position.y = GOAT_BODY_Y + Math.abs(Math.sin(gaitT)) * 0.028 * amp
  rig.body.rotation.z = Math.sin(gaitT * 0.5) * 0.05 * amp
  rig.tail.rotation.z = Math.sin(t * 2.1) * (mode === 'eat' ? 0.35 : 0.12)

  centre.copy(rig.root.position)
  frameCamera(centre)
  // The look target for 'look' has to follow the camera we just moved.
  if (mode === 'look') lookTarget.copy(camera.position)
  rig.lookAt(look)
}

let prev = performance.now()
function loop() {
  const now = performance.now()
  const dt = Math.min(0.05, (now - prev) / 1000)
  prev = now
  tick(dt)
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}

const dev = window as unknown as Record<string, unknown>
dev.__g = {
  set: (m: string, v: string) => {
    mode = m
    view = v ?? view
    return [mode, view]
  },
  /** Numbers a screenshot cannot give you: real world bounds and material state. */
  probe: () => {
    rig.root.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const pts: number[][] = []
    rig.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh) return
      const pos = m.geometry.attributes.position
      const skinned = new THREE.Vector3()
      for (let i = 0; i < pos.count; i += 7) {
        skinned.fromBufferAttribute(pos, i)
        m.applyBoneTransform(i, skinned)
        m.localToWorld(skinned)
        box.expandByPoint(skinned)
      }
      const mat = m.material as THREE.MeshStandardMaterial
      pts.push([mat.emissiveIntensity, mat.emissive.getHex(), mat.roughness, mat.metalness])
    })
    const headPos = rig.head.getWorldPosition(new THREE.Vector3())
    // frontleg1 is a knee the scripted pose never touches — if it has moved off
    // its rest value, the baked take is what moved it.
    const knee = rig.root.getObjectByName('frontleg1')
    return {
      knee: knee ? knee.quaternion.toArray().map((n) => +n.toFixed(4)) : null,
      min: box.min.toArray().map((n) => +n.toFixed(3)),
      max: box.max.toArray().map((n) => +n.toFixed(3)),
      head: headPos.toArray().map((n) => +n.toFixed(3)),
      mats: pts,
    }
  },
}

void loadGoatModel().then(() => {
  // Let the rig pick the model up, then start.
  setTimeout(() => {
    loop()
    setTimeout(() => (dev.__ready = true), 250)
  }, 60)
})
