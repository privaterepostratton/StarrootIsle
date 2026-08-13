/**
 * Read the live light rig out of a running opening. Companion to
 * scripts/light-shots.mjs — numbers instead of pictures.
 *
 *   node scripts/light-probe.mjs --port 5222 [--beat grow]
 */
import { launchChrome, sleep } from './verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i === -1 ? d : argv[i + 1]
}
const port = flag('port', '5222')
const beat = flag('beat', null)
const BASE = `http://localhost:${port}/`

const s = await launchChrome({ width: 900, height: 560 })
try {
  await s.navigate(BASE + '?new')
  const t0 = Date.now()
  while (Date.now() - t0 < 180000) {
    if (await s.eval('!!(window.__isle && window.game && window.game.engine)')) break
    await sleep(600)
  }
  await sleep(1500)
  if (beat) {
    await s.eval(`window.__isle.goto('${beat}')`)
    await sleep(1200)
  }
  const out = await s.evalJson(`JSON.stringify((() => {
    const g = window.game, e = g.engine
    const f = e.focus, sp = e.sun.position
    const d = { x: sp.x - f.x, y: sp.y - f.y, z: sp.z - f.z }
    const horiz = Math.hypot(d.x, d.z)
    return {
      hour: +g.day.hour.toFixed(2),
      sun: { i: +e.sun.intensity.toFixed(2), c: e.sun.color.getHexString(),
             offset: [+d.x.toFixed(1), +d.y.toFixed(1), +d.z.toFixed(1)],
             elevationDeg: +(Math.atan2(d.y, horiz) * 180 / Math.PI).toFixed(1),
             shadowLenPerHeight: +(horiz / Math.max(d.y, 0.01)).toFixed(2) },
      hemi: { i: +e.hemi.intensity.toFixed(2), sky: e.hemi.color.getHexString(), gnd: e.hemi.groundColor.getHexString() },
      ambient: { i: +e.ambient.intensity.toFixed(2), c: e.ambient.color.getHexString() },
      fill: { i: +e.fill.intensity.toFixed(2), c: e.fill.color.getHexString() },
      focus: [+f.x.toFixed(1), +f.y.toFixed(1), +f.z.toFixed(1)],
      player: [+g.player.position.x.toFixed(1), +g.player.position.z.toFixed(1)],
      shadowBox: [e.sun.shadow.camera.left, e.sun.shadow.camera.right, e.sun.shadow.camera.far],
      fog: e.scene.fog.color.getHexString(),
      grade: {
        sat: g.postfx.composer.passes.map(p => p.uniforms && p.uniforms.uSaturation && p.uniforms.uSaturation.value).find(v => v !== undefined),
      },
    }
  })())`)
  console.log(JSON.stringify(out, null, 2))
} finally {
  await s.close()
}
