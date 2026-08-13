/**
 * Moment-capture pass for the Isle Opening.
 *
 * verify-opening.mjs proves the beats *happen*; its screenshots are taken
 * wherever the driver happens to be standing when a stat flips, which is often
 * a frame that does not SHOW the beat — the pocket frame lands after the next
 * prompt has already staged, the gold burst is a 0.3 s window, the goat's
 * look-at is a single pose inside a long script.
 *
 * This pass drives to those three moments deliberately, parks a camera that
 * can actually see them, and captures a short burst per moment so a human can
 * pick the frame that reads. Burst frames are written as <name>-N.jpg and the
 * first is copied to <name>.jpg as the default pick.
 *
 *   node scripts/verify-opening-moments.mjs --port 5219 [--out <dir>]
 */
import { mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep } from './verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? fallback : argv[i + 1]
}
const port = flag('port', '5219')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(flag('out', resolve(projectRoot, 'scratchpad/verify-opening')))
/** `--only 5,8` re-runs just those legs; default is all of them. */
const only = new Set((flag('only', '5,8,9') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const BASE = 'http://localhost:' + port + '/'
const VIEW_W = 1000
const VIEW_H = 620
const POCKET = [-34, 0]

const log = (...a) => console.log(...a)

async function waitReady(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(1500)
        return
      }
    } catch {
      // still navigating
    }
    await sleep(500)
  }
  throw new Error('page never became ready at ' + BASE)
}

const stats = (s) => s.evalJson('JSON.stringify(window.__isle.stats())')

/**
 * Pull the camera back and up before a capture. The opening's camera hugs the
 * player, which puts it inside the pocket's own foliage — the exact thing the
 * frame is supposed to show ends up filling the lens as green slabs.
 */
async function frameCamera(s, { x, z, dist = 15, pitch = 0.62, yaw = Math.PI * 0.85 }) {
  await s.eval(`(() => {
    const g = window.game
    if (!g) return 0
    if (${x !== undefined}) g.player.position.set(${x}, 0, ${z})
    g.engine.distance = ${dist}
    g.engine.pitch = ${pitch}
    g.engine.yaw = ${yaw}
    g.engine.targetYaw = ${yaw}
    return 1
  })()`)
}

/** Burst of full-page JPEGs (DOM overlays included), spaced by gapMs. */
async function burst(s, name, n = 4, gapMs = 450) {
  const paths = []
  for (let i = 1; i <= n; i++) {
    const p = resolve(outDir, `${name}-${i}.jpg`)
    try {
      await s.screenshot(p)
      paths.push(p)
    } catch (e) {
      log(`  burst ${name}-${i} failed: ${e.message}`)
    }
    if (i < n) await sleep(gapMs)
  }
  if (paths.length) {
    const pick = resolve(outDir, `${name}.jpg`)
    copyFileSync(paths[0], pick)
    paths.push(pick)
  }
  log(`  ${name}: ${paths.length} frames`)
  return paths
}

/**
 * Teleport-and-tap a grid of world points. The pocket's last "required" prop
 * is the amphora shard, which is TAP-collect rather than hold — hold sweeps
 * alone leave requiredChaosLeft stuck at 1 forever, and every later beat that
 * needs planted beds starves behind it.
 */
async function tapGrid(s, cx, cz, r, step, doneSrc, maxMs = 60000, settle = 200) {
  const pts = []
  for (let x = cx - r; x <= cx + r; x += step) {
    for (let z = cz - r; z <= cz + r; z += step) pts.push([+x.toFixed(2), +z.toFixed(2)])
  }
  pts.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2))
  return s.evalJson(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const done = ${doneSrc}
    const pts = ${JSON.stringify(pts)}
    const t0 = Date.now()
    let taps = 0
    for (const p of pts) {
      if (done(window.__isle.stats()) || Date.now() - t0 > ${maxMs}) break
      try { window.game.player.position.set(p[0], 0, p[1]) } catch {}
      try { window.__isle.tap(p[0], p[1]) } catch {}
      taps++
      await sleep(${settle})
    }
    return JSON.stringify({ taps, stats: window.__isle.stats() })
  })()`)
}

/** Complete every discoverable hold of a kind, one at a time. */
async function holdAll(s, kind, maxMs = 60000) {
  return s.evalJson(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const t0 = Date.now()
    const held = []
    while (Date.now() - t0 < ${maxMs}) {
      const list = (window.__isle.targets() || []).filter((t) => t.kind === ${JSON.stringify(kind)})
      if (!list.length) break
      let did = false
      for (const t of list) {
        if (window.__isle.hold(t.id)) { held.push(t.id); did = true; await sleep(250) }
      }
      if (!did) break
    }
    return JSON.stringify({ held, stats: window.__isle.stats() })
  })()`)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const written = []
  const failed = []
  const s = await launchChrome({ width: VIEW_W, height: VIEW_H })

  try {
    // --- beat 5: the pocket completes and the island breathes ---------------
    log('— beat 5 breath —')
    await s.navigate(BASE + '?new')
    await waitReady(s)
    await s.eval("window.__isle.goto('clearing')")
    await sleep(2500)
    const wantBreath = only.has('5')
    // Clearing one chaos prop can uncover another (requiredChaosLeft ticks up
    // as the pocket reveals itself), and the target list only refreshes on a
    // frame — which headless delivers slowly. So sweep repeatedly rather than
    // once, until the stat says the pocket is actually clear.
    for (let i = 0; i < 8; i++) {
      const chaos = await holdAll(s, 'chaos', 90000)
      log('  chaos held: ' + JSON.stringify(chaos?.held ?? []))
      await sleep(1500)
      let st = await stats(s).catch(() => null)
      if (st?.pocketCleared) break
      // Whatever the holds cannot reach is the tap-collect shard.
      await tapGrid(s, POCKET[0], POCKET[1], 3, 0.75, '(s) => s.pocketCleared', 40000)
      st = await stats(s).catch(() => null)
      if (st?.pocketCleared) break
      log(`  requiredChaosLeft = ${st?.requiredChaosLeft}`)
    }
    const st5 = await stats(s).catch(() => null)
    if (!wantBreath) log('  (beat-5 frames skipped by --only; pocket still cleared for later beats)')
    else if (st5?.pocketCleared) {
      /*
       * One angle is a coin flip here: the pocket sits in a bowl of jungle, so
       * a fixed yaw regularly puts the near wall's foliage between lens and
       * clearing and the "breath" reads as a green slab. Orbit instead and
       * keep every angle — one of them sees the motes rise over open ground.
       */
      const yaws = [0.85, 0.35, 1.5, 0.1, 1.15]
      for (let i = 0; i < yaws.length; i++) {
        await frameCamera(s, {
          x: POCKET[0] + 7,
          z: POCKET[1] + 7,
          dist: 22,
          pitch: 0.55,
          yaw: Math.PI * yaws[i],
        })
        await sleep(700)
        const p = resolve(outDir, `beat-5-breath-${i + 1}.jpg`)
        await s.screenshot(p)
        written.push(p)
      }
      copyFileSync(resolve(outDir, 'beat-5-breath-1.jpg'), resolve(outDir, 'beat-5-breath.jpg'))
      written.push(resolve(outDir, 'beat-5-breath.jpg'))
      log(`  beat-5-breath: ${yaws.length} angles`)
    } else {
      await frameCamera(s, { x: POCKET[0] + 7, z: POCKET[1] + 7, dist: 20, pitch: 0.5 })
      await sleep(400)
      failed.push(`beat-5-breath (pocketCleared=${st5?.pocketCleared}, requiredChaosLeft=${st5?.requiredChaosLeft})`)
      written.push(...(await burst(s, 'beat-5-breath', 2, 400)))
    }

    // --- beat 8: the odd fruit's gold burst ---------------------------------
    log('— beat 8 burst —')
    // There is no gold burst without a fruit, and no fruit without beds: run
    // the real beat-6 work first rather than jumping past it.
    await s.eval("window.__isle.goto('plant')")
    await sleep(2500)
    const dug = await holdAll(s, 'dig', 90000)
    log(`  bedsDug = ${dug?.stats?.bedsDug}`)
    const planted = await tapGrid(s, POCKET[0], POCKET[1], 4, 1, '(s) => s.seedsPlanted >= 6', 60000, 220)
    log(`  seedsPlanted = ${planted?.stats?.seedsPlanted}`)
    await s.eval("window.__isle.goto('grow')")
    await sleep(2500)
    for (let i = 0; i < 6; i++) {
      await s.eval('window.__isle.ff(90)')
      await sleep(1500)
      const st = await stats(s).catch(() => null)
      if ((st?.tomatoesRipe ?? 0) >= 6) break
    }
    // ff() ripens the crops but the pick targets belong to the HARVEST beat —
    // staying on 'grow' leaves the odd fruit with no hold target to commit,
    // which is exactly how the first pass missed the burst.
    await s.eval("window.__isle.goto('harvest')")
    await sleep(3000)
    await frameCamera(s, { x: POCKET[0] + 4, z: POCKET[1] + 4, dist: 13, pitch: 0.55 })
    await sleep(600)
    // The five ordinaries come off first — the odd one is the one left over,
    // which is how the player finds it too.
    await tapGrid(s, POCKET[0], POCKET[1], 4, 1, '(s) => s.ordinariesPicked >= 5', 60000, 220)
    const odd = await s.evalJson(
      "JSON.stringify((window.__isle.targets() || []).filter((t) => t.kind === 'odd-fruit'))",
    )
    if (Array.isArray(odd) && odd.length) {
      await s.eval(`window.__isle.hold(${JSON.stringify(odd[0].id)})`)
      // No settle sleep: the slow-mo gold burst is ~0.3 s of game time and the
      // first frame after the commit is the one that carries it.
      written.push(...(await burst(s, 'beat-8-burst', 5, 300)))
    } else {
      failed.push('beat-8-burst (no odd-fruit hold target discoverable)')
      written.push(...(await burst(s, 'beat-8-burst', 2, 300)))
    }

    // --- beat 9: the goat looks at the player, then the journal -------------
    if (!only.has('9')) {
      log('— beat 9 skipped by --only —')
      return
    }
    log('— beat 9 goat —')
    await s.eval("window.__isle.goto('arrival')")
    await sleep(3000)
    try {
      await s.eval('window.__isle.goat()')
    } catch {
      // goat() refuses if the script is already running — fine.
    }
    // The look-at is ONE second of game time inside a ~12 s script, so a blind
    // burst is a lottery. Poll the arrival's own phase instead and fire the
    // moment it enters 'look' (the beat's whole point: attention, returned).
    // The camera is the shot's, not ours — reframing here would fight the
    // cinematic rig, so this leg only times the shutter.
    let phases = []
    let looked = false
    const g0 = Date.now()
    while (Date.now() - g0 < 1200000) {
      const ph = await s
        .eval('(() => { try { return window.game.goatArrival.phase } catch { return null } })()')
        .catch(() => null)
      if (ph && phases[phases.length - 1] !== ph) phases.push(ph)
      if (ph === 'look') {
        written.push(...(await burst(s, 'beat-9-goat', 3, 250)))
        looked = true
        break
      }
      if (ph === 'done') break
      await sleep(700)
    }
    log('  goat phases: ' + phases.join(' → '))
    if (!looked) {
      failed.push(`beat-9-goat (never reached the look phase; saw ${phases.join(',') || 'nothing'})`)
      written.push(...(await burst(s, 'beat-9-goat', 3, 800)))
    }

    log('— beat 9 journal —')
    const t0 = Date.now()
    let journal = false
    while (Date.now() - t0 < 900000 && !journal) {
      const lines = await s.evalJson('JSON.stringify((() => { const o = []; const w = (el) => { const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) return; for (const n of el.childNodes) { if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) o.push(t) } else if (n.nodeType === 1) w(n) } }; w(document.body); return o })())').catch(() => null)
      if ((lines ?? []).some((t) => t.includes('It wanted something'))) journal = true
      else await sleep(1500)
    }
    if (!journal) failed.push('beat-9-journal (string #7 never rendered)')
    written.push(...(await burst(s, 'beat-9-journal', 3, 400)))
  } catch (e) {
    failed.push('run threw: ' + e.message)
  } finally {
    await s.close()
    // Reported from `finally` because a skipped leg returns early out of the
    // try — a report after the block would silently print nothing.
    log('\n==== moments ====')
    for (const p of written) log('  ' + p)
    if (failed.length) {
      log('\nmissed:')
      for (const f of failed) log('  ' + f)
    }
    process.exit(failed.length ? 1 : 0)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
