/**
 * Lighting/grade check pass for the Isle Opening (W-LIGHT).
 *
 * Boots `?new`, jumps to the beats whose light actually matters — the beach at
 * wake, the clearing, the planted beds, the goat's ground — parks a camera that
 * can see them, and writes one JPEG each. Fast enough to run every tweak.
 *
 *   node scripts/light-shots.mjs --port 5222 [--tag before]
 */
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep } from './verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? fallback : argv[i + 1]
}
const port = flag('port', '5222')
const tag = flag('tag', 'now')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'scratchpad/light-check')
mkdirSync(outDir, { recursive: true })
const BASE = `http://localhost:${port}/`

async function waitReady(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await sleep(1600)
        return
      }
    } catch {
      /* still navigating */
    }
    await sleep(500)
  }
  throw new Error('page never became ready')
}

async function park(s, { x, z, dist, pitch, yaw }) {
  await s.eval(`(() => {
    const g = window.game
    g.player.position.set(${x}, g.player.position.y, ${z})
    g.engine.focus.set(${x}, g.engine.focus.y, ${z})
    g.engine.distance = ${dist}
    g.engine.pitch = ${pitch}
    g.engine.yaw = ${yaw}
    g.engine.targetYaw = ${yaw}
    return 1
  })()`)
  await sleep(900)
}

const s = await launchChrome({ width: 1000, height: 620 })
try {
  await s.navigate(BASE + '?new')
  await waitReady(s)

  // Beat 1 — the beach at wake. Sand, crate, jungle wall behind.
  await sleep(1200)
  await s.screenshot(resolve(outDir, `${tag}-beach.jpg`))

  // Beat 5 — the clearing, wide enough to show the jungle wall and the floor.
  await s.eval("window.__isle.goto('clearing')")
  await sleep(1400)
  await park(s, { x: -34, z: 0, dist: 16, pitch: 0.6, yaw: Math.PI * 0.85 })
  await s.screenshot(resolve(outDir, `${tag}-clearing.jpg`))

  // Beat 6/8 — beds. Same ground the goat later stands on.
  await s.eval("window.__isle.goto('grow')")
  await sleep(1600)
  await park(s, { x: -33, z: 1.5, dist: 13, pitch: 0.52, yaw: Math.PI * 0.9 })
  await s.screenshot(resolve(outDir, `${tag}-beds.jpg`))

  // The jungle wall itself, looking east into it — the rim-light test.
  await park(s, { x: -34, z: 0, dist: 14, pitch: 0.28, yaw: Math.PI * 1.35 })
  await s.screenshot(resolve(outDir, `${tag}-wall.jpg`))

  // Back to the beach looking west at the sea — shadow-direction test.
  await park(s, { x: -52, z: 4, dist: 15, pitch: 0.35, yaw: Math.PI * 0.15 })
  await s.screenshot(resolve(outDir, `${tag}-sea.jpg`))

  console.log('wrote', outDir, 'tag', tag)
} finally {
  await s.close()
}
