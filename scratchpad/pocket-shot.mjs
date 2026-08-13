/**
 * Fast pocket probe: stage the clearing, stand the player in the pocket, and
 * capture the gameplay camera from several yaws. Exists so the near-camera
 * dissolve can be judged in ~2 minutes instead of the 40-minute full run.
 *
 *   node scratchpad/pocket-shot.mjs --port 5244 --tag before
 */
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep } from '../scripts/verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i === -1 ? d : argv[i + 1]
}
const port = flag('port', '5244')
const tag = flag('tag', 'x')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'scratchpad/pocket')
const BASE = 'http://localhost:' + port + '/'
const POCKET = [-34, 0]

async function ready(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(1500)
        return
      }
    } catch {
      // navigating
    }
    await sleep(500)
  }
  throw new Error('never ready')
}

async function main() {
  mkdirSync(out, { recursive: true })
  const s = await launchChrome({ width: 1000, height: 620 })
  try {
    await s.navigate(BASE + '?new')
    await ready(s)
    await s.eval("window.__isle.goto('clearing')")
    await sleep(3000)
    // Stand in the pocket and let the gameplay camera settle behind the
    // player at its own distance — the point is to reproduce what the PLAYER
    // sees, not to pick a flattering camera.
    for (const [i, spot] of [POCKET, [-37, 0], [-34, 4], [-31, -4]].entries()) {
      await s.eval(`window.game.player.position.set(${spot[0]}, 0, ${spot[1]})`)
      await sleep(2500)
      for (const [j, yaw] of [0.2, 0.65, 1.1, 1.6].entries()) {
        await s.eval(`(() => { const g = window.game; g.engine.yaw = Math.PI * ${yaw}; g.engine.targetYaw = Math.PI * ${yaw}; return 1 })()`)
        await sleep(900)
        const p = resolve(out, `${tag}-p${i}-y${j}.jpg`)
        await s.screenshot(p)
        console.log('  ' + p)
      }
    }
  } finally {
    await s.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
