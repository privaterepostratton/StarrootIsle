/**
 * W-LIGHT scratch driver: park the opening at a stage and photograph the floor.
 *
 * Not part of the build. `node scratchpad/wlight/drive.mjs <tag>` — one session,
 * staged into the clearing, then a set of __cap frames of the jungle floor plus
 * one live goat-arrival screenshot, so floor and dawn can be judged together.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { launchChrome, sleep } from '../../scripts/verify-opening-cdp.mjs'

const port = process.env.PORT ?? '5241'
const BASE = `http://localhost:${port}`
const tag = process.argv[2] ?? 'x'
const OUT = 'F:/Games/GrowAGardenTwo/scratchpad/wlight/'
mkdirSync(OUT, { recursive: true })

async function waitReady(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 180000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(1500)
        return
      }
    } catch {
      /* navigating */
    }
    await sleep(500)
  }
  throw new Error('never ready')
}

/** __cap returns a JPEG data URL; write it out. */
async function cap(s, name, opts) {
  const url = await s.eval(`window.__cap(${JSON.stringify(opts)})`)
  writeFileSync(OUT + name, Buffer.from(url.split(',')[1], 'base64'))
  console.log('cap', OUT + name)
}

const s = await launchChrome({ width: 1000, height: 620 })
try {
  await s.navigate(BASE + '?new')
  await waitReady(s)
  // Beach first, at the wake spot: the reserved-gold scan lives or dies here.
  await s.eval("window.__isle.goto('shovel')")
  await sleep(3000)
  await s.screenshot(OUT + `${tag}-sand.jpg`)
  console.log('shot', OUT + `${tag}-sand.jpg`)

  await s.eval("window.__isle.goto('plant')")
  await sleep(3500)

  // Standing in the clearing looking north-east at the wall and the floor.
  await cap(s, `${tag}-floor-wide.jpg`, { x: -33, z: 2, yaw: 2.2, pitch: 0.42, dist: 15 })
  // Low and close: the floor filling the bottom half, the way beats 5/6 frame it.
  await cap(s, `${tag}-floor-low.jpg`, { x: -31, z: 0, yaw: 3.6, pitch: 0.22, dist: 9 })
  // Down the gap toward the sea — the shadow direction check.
  await cap(s, `${tag}-gap.jpg`, { x: -36, z: 0, yaw: 1.1, pitch: 0.35, dist: 12 })
  // The beds and their loam patch.
  await cap(s, `${tag}-beds.jpg`, { x: -32, z: 0, yaw: 0.6, pitch: 0.55, dist: 11 })
  // The wall foot, close: roots, stones, drifted litter.
  await cap(s, `${tag}-foot.jpg`, { x: -30, z: -6, yaw: 5.5, pitch: 0.2, dist: 8 })

  // Live goat arrival: the real gameplay camera, DOM overlays included.
  await s.eval("window.__isle.goto('arrival')")
  await sleep(3000)
  try {
    await s.eval('window.__isle.goat()')
  } catch (e) {
    console.log('goat failed', e.message)
  }
  await sleep(5000)
  await s.screenshot(OUT + `${tag}-arrival.jpg`)
  console.log('shot', OUT + `${tag}-arrival.jpg`)
} finally {
  await s.close()
}
