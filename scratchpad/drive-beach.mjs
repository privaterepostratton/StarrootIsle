/*
 * One headless session that walks the opening to a beat the authored beach
 * props appear in and orbits a camera round them, running the verifier's own
 * reserved-gold scan on each frame.
 *
 *   node scratchpad/drive-beach.mjs --port 5216 --leg crate|tide
 *
 * One leg per process on purpose: SwiftShader has dropped the connection part
 * way through a long run more than once, and a leg that has already written
 * its frames should not lose them to the next leg's crash.
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchChrome, sleep } from '../scripts/verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i === -1 ? d : argv[i + 1]
}
const port = flag('port', '5216')
const leg = flag('leg', 'tide')
const outDir = resolve(flag('out', 'scratchpad/goat-glb/ingame'))
const BASE = `http://localhost:${port}/`
mkdirSync(outDir, { recursive: true })

const GOLD_SCAN = `(() => {
  const g = window.game
  try { g.engine.render() } catch {}
  const src = g.engine.renderer.domElement
  const w = 320
  const h = Math.max(2, Math.round(src.height * (w / Math.max(1, src.width))))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.drawImage(src, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  let gold = 0
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - 242, dg = d[i+1] - 193, db = d[i+2] - 78
    if (dr*dr + dg*dg + db*db < 1600) gold++
  }
  return JSON.stringify({ gold, total: w * h, pct: +(100 * gold / (w * h)).toFixed(4) })
})()`

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + what)), ms))])

async function waitReady(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(1500)
        return
      }
    } catch {}
    await sleep(500)
  }
  throw new Error('page never became ready')
}

const frame = (s, x, z, dist, pitch, yaw) =>
  s.eval(`(() => {
    const g = window.game
    g.player.position.set(${x}, 0, ${z})
    g.engine.focus.set(${x}, 0, ${z})
    g.engine.distance = ${dist}
    g.engine.pitch = ${pitch}
    g.engine.yaw = ${yaw}
    g.engine.targetYaw = ${yaw}
    return 1
  })()`)

async function orbit(s, name, x, z, dist, pitch, yaws) {
  for (const [i, yaw] of yaws.entries()) {
    try {
      await frame(s, x, z, dist, pitch, yaw)
      await sleep(1100)
      await withTimeout(s.screenshot(resolve(outDir, `${name}-${i + 1}.jpg`)), 30000, 'screenshot')
      const gold = await withTimeout(s.evalJson(GOLD_SCAN), 30000, 'goldScan')
      console.log(`  ${name}-${i + 1} yaw=${yaw.toFixed(2)} gold=${gold.gold}px ${gold.pct}%`)
    } catch (e) {
      console.log(`  ${name}-${i + 1} failed: ${e.message}`)
      return
    }
  }
}

const s = await launchChrome({ width: 820, height: 560 })
try {
  await s.navigate(BASE + '?new')
  await waitReady(s)
  const TAU = Math.PI * 2
  const yaws = [0, TAU * 0.25, TAU * 0.5, TAU * 0.75]

  if (leg === 'crate') {
    await s.eval("window.__isle.goto('crate')")
    await sleep(3500)
    const [cx, cz] = await s.evalJson(
      'JSON.stringify((() => { const p = window.game.beachProps.cratePos; return [p.x, p.z] })())',
    )
    console.log('crate at', cx, cz)
    await orbit(s, 'crate-shut', cx, cz, 3.4, 0.5, yaws)
    await s.eval(`window.__isle.tap(${cx}, ${cz})`)
    await sleep(320)
    await withTimeout(s.screenshot(resolve(outDir, 'crate-swing.jpg')), 30000, 'swing')
    await sleep(1400)
    console.log('crateOpened =', await s.eval('window.game.beachProps.crateOpened'))
    await orbit(s, 'crate-open', cx, cz, 3.2, 0.55, yaws)
  } else {
    await s.eval("window.__isle.goto('grow')")
    await sleep(4500)
    const spots = await s.evalJson(
      'JSON.stringify((window.game.tidelineOpening?.items ?? []).map((i) => [i.id, +i.x.toFixed(2), +i.z.toFixed(2)]))',
    )
    console.log('washups', JSON.stringify(spots))
    if (!Array.isArray(spots) || !spots.length) throw new Error('no washups staged')
    const mx = spots.reduce((a, b) => a + b[1], 0) / spots.length
    const mz = spots.reduce((a, b) => a + b[2], 0) / spots.length
    await orbit(s, 'tideline', mx, mz, 3.0, 0.5, yaws)
    // And one right on top of the shell, which is the gold-risk prop.
    const shell = spots.find((p) => p[0] === 'spiral-shell')
    if (shell) await orbit(s, 'shell-close', shell[1], shell[2], 1.5, 0.42, yaws)
  }
} finally {
  await s.close()
}
