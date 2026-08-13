/** Identify the world geometry that shows past the isle's treeline. */
import { launchChrome, sleep } from '../scripts/verify-opening-cdp.mjs'

const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '5244'
const BASE = 'http://localhost:' + port + '/'

const s = await launchChrome({ width: 800, height: 500 })
try {
  await s.navigate(BASE + '?new')
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    if (await s.eval('!!(window.game && window.__isle)').catch(() => false)) break
    await sleep(500)
  }
  await sleep(2000)
  // Top-level scene children with names, plus anything visible whose world
  // position sits in the band the opening camera looks across.
  const dump = await s.evalJson(`JSON.stringify((() => {
    const g = window.game
    const scene = g.engine.scene
    const out = []
    const v = new (window.THREE ? window.THREE.Vector3 : Object)()
    scene.traverse((o) => {
      if (!o.visible) return
      if (!o.isMesh && !o.isInstancedMesh && !o.isGroup) return
      const p = o.getWorldPosition({ x: 0, y: 0, z: 0, setFromMatrixPosition(m) { this.x = m.elements[12]; this.y = m.elements[13]; this.z = m.elements[14]; return this } })
      // Only the band that can appear behind the isle treeline.
      if (p.x < -60 || p.x > 5) return
      if (Math.abs(p.z) > 45) return
      out.push({ n: o.name || o.type, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), inst: o.isInstancedMesh ? o.count : 0 })
    })
    return out.slice(0, 200)
  })())`)
  console.log(JSON.stringify(dump, null, 1))
  const named = await s.evalJson(`JSON.stringify(window.game.engine.scene.children.map((c) => c.name || c.type))`)
  console.log('TOP:', JSON.stringify(named))
} finally {
  await s.close()
}
