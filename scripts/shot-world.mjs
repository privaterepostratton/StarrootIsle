/**
 * Environment-only look pass for the Isle Opening.
 *
 * The beat verifier proves the sequence fires; this one only wants to know
 * whether the *island* is the island the spec describes. It parks the camera at
 * a handful of fixed vantage points — the wake shot, the treeline gap, the
 * clearing floor, the sea — and captures each one, so a ground or water or
 * lighting change can be judged in four frames without driving nine beats.
 *
 *   node scripts/shot-world.mjs --port 5216 [--out <dir>]
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
const port = flag('port', '5216')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(flag('out', resolve(projectRoot, 'scratchpad/art-world')))
const BASE = 'http://localhost:' + port + '/'

/** name, player x/z, camera distance, pitch, yaw. */
const SHOTS = [
  // Wake: low and close, looking up the cross at the jungle wall.
  { name: 'wake', x: -56, z: 6, dist: 6, pitch: 0.14, yaw: Math.PI * 0.0 },
  // The approach: standing off the treeline, the gap ahead.
  { name: 'gap', x: -47, z: 2, dist: 8, pitch: 0.2, yaw: Math.PI * 0.0 },
  // The clearing floor, from inside the pocket.
  { name: 'pocket', x: -34, z: 0, dist: 9, pitch: 0.34, yaw: Math.PI * 0.15 },
  // The sea, from the tide line.
  { name: 'sea', x: -58, z: 2, dist: 7, pitch: 0.1, yaw: 3.05 },
  // Wide, from over the water, so the whole treeline silhouette is visible.
  { name: 'wide', x: -64, z: 0, dist: 30, pitch: 0.3, yaw: Math.PI * 0.0 },
  // Up the beach — the sightline that used to end on the village terraces.
  { name: 'along', x: -54, z: -6, dist: 10, pitch: 0.12, yaw: Math.PI * 0.5 },
]

async function waitReady(s) {
  const t0 = Date.now()
  // Generous: headless SwiftShader boots the valley in the low tens of seconds
  // on a good day and several times that when another capture is competing for
  // the same cores.
  while (Date.now() - t0 < 300000) {
    try {
      // Only `window.game` — the opening debug hook belongs to the integrator
      // and may be absent while that file is being worked on; this pass never
      // drives a beat, it only parks a camera.
      if (await s.eval('!!(window.game && window.game.player && window.game.engine)')) {
        // SwiftShader is slow enough that full-quality postfx alone can hold
        // the loader on screen past any reasonable budget.
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(3000)
        return
      }
    } catch {
      // still navigating
    }
    await sleep(600)
  }
  throw new Error('page never became ready at ' + BASE)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const session = await launchChrome({ width: 1000, height: 620 })
  try {
    await session.navigate(BASE + '?new')
    await waitReady(session)
    // One tap to sit up. Beat 1 pins the camera to the wake yaw every frame it
    // owns, so until the avatar is upright no vantage point here is reachable —
    // every shot comes back looking inland at the same treeline.
    await session.tapScreen(500, 310)
    await sleep(2500)
    for (const shot of SHOTS) {
      await session.eval(`(() => {
        const g = window.game
        if (!g) return 0
        g.player.position.set(${shot.x}, 0, ${shot.z})
        g.engine.distance = ${shot.dist}
        g.engine.pitch = ${shot.pitch}
        // Both, always: the engine eases yaw toward targetYaw, so writing only
        // the first is undone within a few frames and every shot comes back
        // pointing wherever the last cinematic left the camera.
        g.engine.yaw = ${shot.yaw}
        g.engine.targetYaw = ${shot.yaw}
        g.engine.focus.set(${shot.x}, 1.2, ${shot.z})
        return 1
      })()`)
      await sleep(900)
      // Re-assert: beat staging in main.ts writes the wake yaw every frame it
      // owns the camera, and it wins any single write made before it runs.
      await session.eval(`(() => {
        const g = window.game
        g.engine.yaw = ${shot.yaw}
        g.engine.targetYaw = ${shot.yaw}
        return 1
      })()`)
      await sleep(500)
      await session.screenshot(resolve(outDir, shot.name + '.jpg'))
      console.log('wrote', shot.name)
    }
  } finally {
    await session.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
