/*
 * Dev harness for the authored beach props. Not part of the game.
 *
 *   /scratchpad/beach-check.html?view=washups|crate|pouch|raw&h=…&w=…
 *
 * `washups` is the one that matters: the three tide-line finds side by side at
 * TRUE relative scale on ivory sand, which is the only way to judge them as a
 * set. `raw` shows an unsized cache model so a mesh can be inspected before it
 * is wired to anything.
 */
import * as THREE from 'three'
import { loadModels, type ModelCache } from '/src/assets/models'
import { createWashupProp, createSeedPouch, createOpeningCrate } from '/src/assets/opening/beach-models'

const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'washups'
const W = Number(params.get('w') ?? 1100)
const H = Number(params.get('h') ?? 620)

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
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
sun.shadow.camera.near = 0.1
sun.shadow.camera.far = 40
sun.shadow.camera.left = -3
sun.shadow.camera.right = 3
sun.shadow.camera.top = 3
sun.shadow.camera.bottom = -3
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.01
sun.position.set(-8, 3.5, 5)
scene.add(sun, sun.target)
scene.add(new THREE.HemisphereLight(0xbcd8ea, 0x9c8a6a, 1.15))
scene.add(new THREE.AmbientLight(0xffeed6, 0.34))
const fill = new THREE.DirectionalLight(0x9fc2e0, 0.4)
fill.position.set(6, 5, -8)
scene.add(fill)

// Wet ivory sand, which is what these actually land on.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshLambertMaterial({ color: 0xd8c9ad }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const camera = new THREE.PerspectiveCamera(42, W / H, 0.02, 100)
const dev = window as unknown as Record<string, unknown>

function bounds(o: THREE.Object3D) {
  o.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(o)
  return {
    min: b.min.toArray().map((n) => +n.toFixed(3)),
    max: b.max.toArray().map((n) => +n.toFixed(3)),
    size: b.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  }
}

function materialProbe(o: THREE.Object3D) {
  const out: unknown[] = []
  o.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh) return
    const mat = m.material as THREE.MeshStandardMaterial
    if (!mat.emissive) return
    out.push([mat.type, mat.emissive.getHexString(), mat.emissiveIntensity ?? null])
  })
  return out
}

void loadModels().then((models: ModelCache) => {
  const info: Record<string, unknown> = {}

  if (view === 'washups') {
    const ids = ['spiral-shell', 'sea-glass', 'driftwood-stick'] as const
    ids.forEach((id, i) => {
      const g = createWashupProp(id)
      g.position.set((i - 1) * 0.62, 0, 0)
      g.rotation.y = 0.3 + i * 1.1
      scene.add(g)
      setTimeout(() => (info[id] = bounds(g)), 30)
    })
    // The session-two impossible shard, off to the side for comparison.
    const imp = createWashupProp('impossible-glass')
    imp.position.set(1.35, 0, -0.45)
    scene.add(imp)
    camera.position.set(0.35, 0.55, 1.55)
    camera.lookAt(0, 0.08, 0)
  } else if (view === 'pouch') {
    const p = createSeedPouch()
    scene.add(p)
    setTimeout(() => (info.pouch = bounds(p)), 30)
    camera.position.set(0.42, 0.42, 0.72)
    camera.lookAt(0, 0.19, 0)
  } else if (view === 'crate') {
    const c = createOpeningCrate()
    scene.add(c.root)
    if (params.get('open')) {
      c.openLid()
      for (let i = 0; i < 60; i++) c.update(0.05)
    }
    setTimeout(() => (info.crate = bounds(c.root)), 30)
    camera.position.set(1.7, 1.5, 2.1)
    camera.lookAt(0, 0.42, 0)
  } else {
    // raw: an unsized cache model, to see what actually came out of the file.
    const key = (params.get('model') ?? 'spiralShell') as keyof ModelCache
    const m = models[key]
    const mesh = new THREE.Mesh(m.geometry, m.material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    const box = m.geometry.boundingBox!
    mesh.position.y = -box.min.y
    scene.add(mesh)
    info.raw = { key, min: box.min.toArray(), max: box.max.toArray() }
    info.mats = materialProbe(mesh)
    const r = Math.max(...box.getSize(new THREE.Vector3()).toArray())
    camera.position.set(r * 1.2, r * 1.0, r * 1.5)
    camera.lookAt(0, r * 0.35, 0)
  }

  // Two frames: one now, one after the async washup fetches have landed.
  renderer.render(scene, camera)
  setTimeout(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) info.anyMat ??= materialProbe(scene)
    })
    renderer.render(scene, camera)
    dev.__info = info
    dev.__ready = true
  }, 400)
})
