/**
 * W-LIGHT probe: drive the opening to a named stage, dump the live lighting
 * state, and capture a frame. Faster than the full verify run for grade work.
 *
 *   node scratchpad/wlight/probe.mjs <stage> [out.jpg] [--walk x,z]
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { launchChrome, sleep } from '../../scripts/verify-opening-cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const port = process.env.PORT ?? '5232'
const BASE = `http://localhost:${port}/`

const stage = process.argv[2] ?? 'goat'
const out = process.argv[3] ?? `${stage}.jpg`
const walkArg = process.argv.find((a) => a.startsWith('--walk='))

const s = await launchChrome({ width: 1000, height: 560 })
await s.navigate(BASE + '?new')
let ready = false
for (let i = 0; i < 400; i++) {
  const ok = await s.eval('!!(window.__isle && window.game)').catch(() => false)
  if (ok === true) {
    ready = true
    break
  }
  await sleep(500)
}
if (!ready) throw new Error('game never booted')
await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
await sleep(1500)
if (stage !== 'none') {
  await s.eval(`window.__isle.goto(${JSON.stringify(stage)})`)
  await sleep(2500)
}
if (walkArg) {
  const [x, z] = walkArg.split('=')[1].split(',').map(Number)
  await s.eval(`window.game.player.position.set(${x},0,${z})`)
  await sleep(2500)
}
await sleep(1500)

const state = await s.evalJson(`(() => {
  const e = window.game.engine
  const f = e.focus
  const c = e.sun.shadow.camera
  return JSON.stringify({
    beat: window.__isle.beat(),
    focus: [+f.x.toFixed(1), +f.y.toFixed(1), +f.z.toFixed(1)],
    player: [+window.game.player.position.x.toFixed(1), +window.game.player.position.z.toFixed(1)],
    sunPos: [+e.sun.position.x.toFixed(1), +e.sun.position.y.toFixed(1), +e.sun.position.z.toFixed(1)],
    sunColor: '#' + e.sun.color.getHexString(),
    sunI: +e.sun.intensity.toFixed(2),
    hemi: '#' + e.hemi.color.getHexString(), hemiI: +e.hemi.intensity.toFixed(2),
    hemiGround: '#' + e.hemi.groundColor.getHexString(),
    ambI: +e.ambient.intensity.toFixed(2), ambC: '#' + e.ambient.color.getHexString(),
    fillI: +e.fill.intensity.toFixed(2), fillC: '#' + e.fill.color.getHexString(),
    shadow: [c.left, c.right, c.top, c.bottom, c.near, c.far],
    fog: '#' + e.scene.fog.color.getHexString(),
    grade: (() => {
      const p = window.game.postfx.composer.passes.find((q) => q.uniforms && q.uniforms.uVignette)
      if (!p) return null
      return {
        vig: +p.uniforms.uVignette.value.toFixed(3),
        sat: +p.uniforms.uSaturation.value.toFixed(3),
        con: +p.uniforms.uContrast.value.toFixed(3),
        lift: '#' + p.uniforms.uLift.value.getHexString(),
      }
    })(),
    elevationDeg: +(Math.atan2(e.sun.position.y - f.y, Math.hypot(e.sun.position.x - f.x, e.sun.position.z - f.z)) * 180 / Math.PI).toFixed(1),
  })
})()`)
console.log(JSON.stringify(state, null, 2))

mkdirSync(here, { recursive: true })
await s.screenshot(resolve(here, out))
console.log('shot', resolve(here, out))
await s.close?.()
process.exit(0)
