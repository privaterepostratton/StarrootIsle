/**
 * Headless per-beat verification driver for the Isle Opening (contract §6).
 *
 *   node scripts/verify-opening.mjs --port 5216 [--beat N|all|resume|legacy|return]
 *                                   [--shots-only] [--out <dir>]
 *
 * Drives the running dev server through every beat of the opening using the
 * DEV-only window.__isle hook (contract §6), asserts the OpeningStats the
 * sequencer advances on, and captures a labelled JPEG per beat. Exits
 * non-zero if any hard check fails, with a readable report.
 *
 * Extra checks beyond the beat table:
 *   - reserved-gold scan  — beats 1–7 must show no LOTTO_GOLD (#F2C14E)
 *     pixels above a small noise floor (contract rule 4: gold means luck,
 *     first seen at beat 8). Scanned on the WebGL canvas AND on visible DOM
 *     computed colours.
 *   - string-budget lint  — visible DOM text at every beat must be one of
 *     the eight OPENING_STRINGS or letter-free (numbers/counts/glyphs).
 *   - resume test         — reload without ?new after beat 5 and assert the
 *     sequencer restores the same beat (staging idempotence, §3.2).
 *   - legacy-save test    — seed a save blob with no opening record, reload,
 *     and assert the opening is skipped and the normal HUD boots.
 *
 * Built to run before the game-side hook exists: every phase is wrapped in
 * try/catch, a missing window.__isle fails fast with a clear message, and
 * drive steps that depend on ids the contract does not pin (chaos/dig/odd
 * hold-target ids) discover them from live HoldTarget lists and fall back to
 * pattern probing, then to __isle.goto(), downgrading the beat to WARN so
 * the rest of the run still exercises the pipeline.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep } from './verify-opening-cdp.mjs'

// ---------------------------------------------------------------------------
// Constants (transcribed from src/game/opening/types.ts + contract §2/§3 —
// this script is plain Node and cannot import the TS module).
// ---------------------------------------------------------------------------

/** The complete text budget. Anything else rendered during the opening = fail. */
const OPENING_STRINGS = [
  'Pull.',
  "The sand won't take them.",
  'Clear.',
  'Dig.',
  'Plant.',
  'Pick.',
  'It wanted something.',
  "You didn't plant this.",
]
const OPENING_SET = new Set(OPENING_STRINGS)

/** localStorage keys: the game save blob, the opening record, the FTUE store. */
const SAVE_KEY = 'sprout-valley-save-v1'
const OPENING_KEY = 'isle-opening-v1'

/**
 * Reserved-gold scan: RGB distance from #F2C14E under this radius counts as
 * gold; squared for the page-side loop. 40 is tight enough to ignore the
 * warm dawn sky yet catch the shimmer/tell colours (contract risk 5).
 */
const GOLD_DIST_SQ = 40 * 40
/**
 * Fraction of scanned canvas pixels allowed to read gold on beats 1–7. Non-
 * zero because JPEG-adjacent dithering and dawn speculars can graze the
 * radius on isolated pixels; anything visible as an actual gold VFX blows
 * far past this.
 */
const GOLD_NOISE_FRAC = 0.0015

/** §6 table: which sequencer beat must be active before driving beat N. */
const STAGE_FOR_BEAT = {
  1: null, // fresh ?new load starts at 'wake'
  2: 'crate',
  3: 'shovel',
  4: 'clearing', // the refusal is an act inside the clearing beat, not a BeatId
  5: 'clearing',
  6: 'plant',
  7: 'grow', // tideline runs during the grow wait, never gates
  8: 'grow', // then __isle.ff ripens into 'harvest'
  9: 'arrival',
}

/**
 * Fallback hold-target id guesses per kind, used only when live discovery
 * (HoldTarget lists exposed by the modules / __isle.targets) yields nothing.
 * Probing an unknown id through __isle.hold is a no-op, so guessing is safe.
 */
const FALLBACK_IDS = {
  shovel: ['shovel', 'shovel-0', 'pull'],
  chaos: [
    ...Array.from({ length: 15 }, (_, i) => 'chaos-' + i),
    'vine-0', 'vine-1', 'vine-2', 'frond-0', 'frond-1', 'driftwood-0',
    'morning-glory-0', 'mat-0', 'basket-0', 'stone-0', 'stone-1',
    'vine', 'frond', 'driftwood', 'morning-glory', 'basket', 'stone',
  ],
  dig: ['dig', ...Array.from({ length: 8 }, (_, i) => 'dig-' + i), ...Array.from({ length: 8 }, (_, i) => 'bed-' + i)],
  'odd-fruit': ['odd-fruit', 'odd', 'odd-0', 'odd-fruit-0', 'gold-tomato'],
}

// Key world anchors (contract §4.1).
const CRATE = [-54.5, 8.5]
const SHOVEL = [-49, 3.5]
const POCKET = [-34, 0]
const SAND_SPOTS = [[-53, 5], [-55, 4], [-52, 7]]
const TIDE_ANCHORS = [[-58, 2], [-57, 9], [-60, -3]]

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? fallback : argv[i + 1]
}
const port = flagValue('port', '5216')
const beatArg = flagValue('beat', 'all')
const shotsOnly = argv.includes('--shots-only')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(flagValue('out', resolve(projectRoot, 'scratchpad/verify-opening')))
const BASE = 'http://localhost:' + port + '/'
const VIEW_W = 1000
const VIEW_H = 620

// ---------------------------------------------------------------------------
// Page-side helper bundle, installed once per page load. Plain string (no
// template placeholders) so nothing here is interpolated by Node.
// ---------------------------------------------------------------------------

const PAGE_HELPERS = String.raw`window.__vo = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const stats = () => window.__isle.stats()
  const voluntary = () => { try { return window.__isle.record().voluntaryCleared } catch { return 0 } }
  const snap = () => JSON.stringify([stats(), voluntary()])

  // Live discovery of HoldTargets: the contract pins the HoldTarget shape but
  // not the ids, so ask any module that will show us a list. window.game is
  // the DEV inspection map; ChaosPocket.holdTargets() / BeachProps
  // .shovelHoldTarget() are contract API, and a public .targets array on a
  // HoldInput-ish object also qualifies.
  const discoverHolds = (kinds) => {
    const found = []
    const seen = new Set()
    const push = (t) => {
      if (!t || !t.id || seen.has(t.id)) return
      if (t.kind && kinds.length && kinds.indexOf(t.kind) === -1) return
      seen.add(t.id)
      found.push({ id: t.id, kind: t.kind || '?' })
    }
    try { const list = window.__isle.targets && window.__isle.targets(); if (list) list.forEach(push) } catch {}
    const g = window.game || {}
    for (const key of Object.keys(g)) {
      const v = g[key]
      if (!v || typeof v !== 'object') continue
      try { if (typeof v.holdTargets === 'function') v.holdTargets().forEach(push) } catch {}
      try { if (typeof v.shovelHoldTarget === 'function') push(v.shovelHoldTarget()) } catch {}
      try { if (Array.isArray(v.targets)) v.targets.forEach(push) } catch {}
    }
    return found
  }

  // Commit holds (discovered, else the fallback guesses) until doneSrc says
  // stop. Progress is detected by any stats/record change, so respawning
  // targets (six dig beds) keep being driven.
  const driveHolds = async (kinds, fallbackIds, doneSrc, maxMs) => {
    const done = eval(doneSrc)
    const t0 = Date.now()
    const held = []
    // The stats snapshot refreshes once per FRAME, and headless SwiftShader
    // frames can be seconds apart — a hold that committed instantly still
    // looks like "nothing happened" for a frame or two. Poll for the change
    // instead of sleeping a fixed beat, or real progress reads as failure.
    const waitChange = async (before, ms) => {
      const s0 = Date.now()
      while (Date.now() - s0 < ms) {
        if (snap() !== before) return true
        await sleep(300)
      }
      return false
    }
    while (Date.now() - t0 < maxMs && !done(stats())) {
      let list = discoverHolds(kinds)
      if (!list.length) list = fallbackIds.map((id) => ({ id, kind: '?' }))
      let progressed = false
      for (const t of list) {
        if (done(stats()) || Date.now() - t0 > maxMs) break
        const before = snap()
        try { window.__isle.hold(t.id) } catch {}
        if (await waitChange(before, 6000)) { held.push(t.id); progressed = true }
      }
      if (!progressed) break
    }
    // One last grace window for the per-frame snapshot to catch up with the
    // final hold before we pass judgement.
    const s1 = Date.now()
    while (!done(stats()) && Date.now() - s1 < 8000) await sleep(400)
    return JSON.stringify({ held, done: done(stats()), stats: stats(), voluntary: voluntary() })
  }

  // Teleport-and-tap across a point list (planting, tideline, harvest picks,
  // amphora). The player is moved to each point first because tap collection
  // is proximity-gated in several modules.
  const tapSweep = async (points, doneSrc, maxMs, settle) => {
    const done = eval(doneSrc)
    const t0 = Date.now()
    let taps = 0
    for (const p of points) {
      if (done(stats()) || Date.now() - t0 > maxMs) break
      try { if (window.game && window.game.player) window.game.player.position.set(p[0], 0, p[1]) } catch {}
      try { window.__isle.tap(p[0], p[1]) } catch {}
      taps++
      await sleep(settle || 160)
    }
    return JSON.stringify({ taps, done: done(stats()), stats: stats() })
  }

  // Reserved-gold scan: WebGL canvas pixels + visible DOM computed colours.
  const GOLD_SQ = 1600
  const nearGold = (nums) => {
    const dr = nums[0] - 242, dg = nums[1] - 193, db = nums[2] - 78
    return dr * dr + dg * dg + db * db < GOLD_SQ
  }
  const cssGold = (str) => {
    if (!str || str === 'transparent') return false
    const nums = str.replace(/[^0-9.,]/g, '').split(',').map(Number)
    if (nums.length < 3 || nums.some(isNaN)) return false
    if (nums.length > 3 && nums[3] === 0) return false
    return nearGold(nums)
  }
  const goldScan = () => {
    const g = window.game
    if (!g || !g.engine) return JSON.stringify({ error: 'window.game.engine missing' })
    try { g.engine.render() } catch {}
    const src = g.engine.renderer.domElement
    const w = 320
    const h = Math.max(2, Math.round(src.height * (w / Math.max(1, src.width))))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(src, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let gold = 0
    for (let i = 0; i < d.length; i += 4) {
      if (nearGold([d[i], d[i + 1], d[i + 2]])) gold++
    }
    const domGold = []
    for (const el of document.querySelectorAll('body *')) {
      if (domGold.length > 4) break
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue
      if (cssGold(s.color) || cssGold(s.backgroundColor) || cssGold(s.borderColor)) {
        domGold.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40))
      }
    }
    return JSON.stringify({ gold, total: w * h, domGold })
  }

  // Rendered text only: innerText would include opacity:0 HUD chrome, which
  // is hidden by design during the opening and must not trip the lint.
  const visibleText = () => {
    const out = []
    const walk = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || effOpacity(el, s) < 0.05) return
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const t = n.textContent.trim()
          if (t) out.push(t)
        } else if (n.nodeType === 1 && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') {
          walk(n)
        }
      }
    }
    if (document.body) walk(document.body)
    return JSON.stringify(out)
  }

  // Effective opacity: what the element is HEADING to, not what a stuck
  // animation timeline says. Headless SwiftShader starves the document
  // timeline, so the 0.16s chrome-hide transition can sit "running" at
  // currentTime 0 for minutes — computed opacity then reports the START value
  // (1) while the paint already shows the hidden end state. Reading the
  // transition's final keyframe gives the truthful answer on both real and
  // starved timelines.
  const effOpacity = (el, cs) => {
    let o = parseFloat(cs.opacity)
    try {
      for (const a of el.getAnimations({ subtree: false })) {
        if (a.transitionProperty !== 'opacity' || !a.effect?.getKeyframes) continue
        const kf = a.effect.getKeyframes()
        const last = kf[kf.length - 1]
        if (last && last.opacity !== undefined) o = parseFloat(last.opacity)
      }
    } catch {}
    return o
  }
  const hudState = () => {
    const els = Array.from(document.querySelectorAll('.hud-chrome'))
    let visible = 0
    for (const el of els) {
      // The settings glyph is the contract's ONE sanctioned piece of chrome
      // during the opening (§2.8: #menuBtn at 40 %) — not a naked-screen leak.
      if (el.id === 'menuBtn') continue
      const s = getComputedStyle(el)
      if (s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el, s) > 0.05) visible++
    }
    return JSON.stringify({
      isleClass: document.body.classList.contains('isle-opening'),
      hudTotal: els.length,
      hudVisible: visible,
      isleEls: document.querySelectorAll('.isle-el').length,
    })
  }

  return { discoverHolds, driveHolds, tapSweep, goldScan, visibleText, hudState,
           stats: () => JSON.stringify(stats()) }
})()`

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------

const results = []
const pageErrors = []
function record(id, status, reason = '') {
  results.push({ id, status, reason })
  const tag = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL'
  console.log(`  [${tag}] ${id}${reason ? ' — ' + reason : ''}`)
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function waitReady(s, { needIsle = true, timeoutMs = 120000 } = {}) {
  const expr = needIsle ? '!!(window.game && window.__isle)' : '!!window.game'
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await s.eval(expr)) {
        await s.eval(PAGE_HELPERS)
        // SwiftShader renders this scene at a crawl and the engine clamps dt
        // to 0.1 s, so game time runs far behind real time. Low quality is
        // the difference between ~0.4 fps and something the timed beats
        // (sit-up, goat script) can actually finish inside a poll window.
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch {} return 1 })()")
        await sleep(1200) // let the first beats stage / first frames render
        return
      }
    } catch {
      // Page still navigating.
    }
    await sleep(500)
  }
  if (needIsle) {
    // Distinguish "game never booted" from "hook not built yet".
    let hasGame = false
    try {
      hasGame = await s.eval('!!window.game')
    } catch {
      // Unreachable page.
    }
    if (hasGame) {
      throw new Error(
        'window.__isle is missing: the game booted but the DEV debug hook (contract §6, W-INT) is not installed yet.',
      )
    }
  }
  throw new Error(`page at ${BASE} never became ready in ${timeoutMs / 1000}s (is the dev server running on port ${port}?)`)
}

const getStats = (s) => s.evalJson('window.__vo.stats()')
const getBeat = (s) => s.eval('window.__isle.beat()')
const getRecord = (s) => s.evalJson('JSON.stringify(window.__isle.record())')

/** Poll OpeningStats until pred passes; returns the final stats either way. */
async function pollStats(s, pred, timeoutMs, everyMs = 400) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await getStats(s)
      if (last && pred(last)) return { ok: true, stats: last }
    } catch {
      // Transient — sequencer mid-stage.
    }
    await sleep(everyMs)
  }
  return { ok: false, stats: last }
}

async function teleport(s, x, z) {
  await s.eval(`window.game && window.game.player && window.game.player.position.set(${x}, 0, ${z})`)
  await sleep(300)
}

async function isleTap(s, x, z) {
  await s.eval(`window.__isle.tap(${x}, ${z})`)
}

async function driveHolds(s, kind, doneSrc, maxMs) {
  const kinds = JSON.stringify([kind])
  const fallback = JSON.stringify(FALLBACK_IDS[kind] ?? [])
  return s.evalJson(
    `window.__vo.driveHolds(${kinds}, ${fallback}, ${JSON.stringify(doneSrc)}, ${maxMs})`,
  )
}

async function tapSweep(s, points, doneSrc, maxMs, settle = 160) {
  return s.evalJson(
    `window.__vo.tapSweep(${JSON.stringify(points)}, ${JSON.stringify(doneSrc)}, ${maxMs}, ${settle})`,
  )
}

function grid(cx, cz, r, step) {
  const pts = []
  for (let x = cx - r; x <= cx + r; x += step) {
    for (let z = cz - r; z <= cz + r; z += step) pts.push([+x.toFixed(2), +z.toFixed(2)])
  }
  // Centre-out ordering so the likely targets come first.
  pts.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2))
  return pts
}

function tideMarchPoints() {
  const pts = []
  for (const [ax, az] of TIDE_ANCHORS) {
    for (let dx = 0; dx <= 9; dx += 0.75) {
      pts.push([+(ax - dx).toFixed(2), az])
      pts.push([+(ax - dx).toFixed(2), +(az + 1).toFixed(2)])
      pts.push([+(ax - dx).toFixed(2), +(az - 1).toFixed(2)])
    }
  }
  return pts
}

async function shot(s, name) {
  const path = resolve(outDir, name)
  try {
    await s.screenshot(path)
    console.log(`  shot ${path}`)
  } catch (e) {
    record(`shot:${name}`, 'warn', `screenshot failed: ${e.message}`)
  }
}

/** Reserved-gold scan; hard-fails on beats 1–7, expects gold on beat 8. */
async function goldCheck(s, beatN) {
  let scan
  try {
    scan = await s.evalJson('window.__vo.goldScan()')
  } catch (e) {
    record(`gold:beat-${beatN}`, 'warn', `scan failed: ${e.message}`)
    return
  }
  if (!scan || scan.error) {
    record(`gold:beat-${beatN}`, 'warn', `scan unavailable: ${scan?.error ?? 'no result'}`)
    return
  }
  const frac = scan.gold / scan.total
  if (beatN <= 7) {
    const canvasBad = frac > GOLD_NOISE_FRAC
    const domBad = (scan.domGold?.length ?? 0) > 0
    if (canvasBad || domBad) {
      record(
        `gold:beat-${beatN}`,
        'fail',
        `reserved LOTTO_GOLD before beat 8: canvas ${(frac * 100).toFixed(3)}% (limit ${(GOLD_NOISE_FRAC * 100).toFixed(2)}%)` +
          (domBad ? `, DOM: ${scan.domGold.join(', ')}` : ''),
      )
    } else {
      record(`gold:beat-${beatN}`, 'pass', `canvas ${(frac * 100).toFixed(3)}% gold`)
    }
  } else if (beatN === 8) {
    if (scan.gold > 0) record('gold:beat-8', 'pass', `${scan.gold} gold px — lotto tell present`)
    else record('gold:beat-8', 'warn', 'no gold pixels in the odd-pick frame (tell may have been missed by timing)')
  }
}

/** String-budget lint: every rendered string is an OPENING_STRING or letter-free. */
async function textLint(s, label) {
  let lines
  try {
    lines = await s.evalJson('window.__vo.visibleText()')
  } catch (e) {
    record(`strings:${label}`, 'warn', `text dump failed: ${e.message}`)
    return
  }
  const numeric = /^[x×+\-]?\s*\d[\d\s.,x×+%:/-]*$/iu
  const offenders = (lines ?? []).filter(
    (t) => !OPENING_SET.has(t) && /\p{L}/u.test(t) && !numeric.test(t),
  )
  if (offenders.length) {
    record(`strings:${label}`, 'fail', `rendered text outside the 8-string budget: ${JSON.stringify(offenders.slice(0, 5))}`)
  } else {
    record(`strings:${label}`, 'pass')
  }
}

// ---------------------------------------------------------------------------
// Per-beat drivers (§6 table)
// ---------------------------------------------------------------------------

async function beat1(s) {
  const hud = await s.evalJson('window.__vo.hudState()')
  if (!hud.isleClass) record('beat-1:naked', 'fail', 'body.isle-opening class missing at wake')
  else if (hud.hudVisible > 0) record('beat-1:naked', 'fail', `${hud.hudVisible} .hud-chrome elements visible at wake`)
  else record('beat-1:naked', 'pass', `hud chrome hidden (${hud.hudTotal} elements)`)

  await shot(s, 'beat-1.jpg')
  await goldCheck(s, 1)
  await textLint(s, 'beat-1')

  // First input is the body: a real tap anywhere. The sit-up takes 0.9 s of
  // *game* time — many real seconds under SwiftShader's dt clamp — so the
  // polls here are generous by design (pacing trap: poll state, never sleep).
  await s.tapScreen(Math.round(VIEW_W / 2), Math.round(VIEW_H / 2))
  let r = await pollStats(s, (st) => st.satUp, 45000)
  if (!r.ok) {
    // Fallback: tap the world at the player's feet through the hook.
    const pos = await s.evalJson(
      'JSON.stringify([window.game.player.position.x, window.game.player.position.z])',
    )
    if (Array.isArray(pos)) await isleTap(s, pos[0], pos[1])
    r = await pollStats(s, (st) => st.satUp, 40000)
  }
  record('beat-1:situp', r.ok ? 'pass' : 'fail', r.ok ? '' : `satUp never became true (stats: ${JSON.stringify(r.stats)})`)
  return r.ok
}

async function beat2(s) {
  await teleport(s, CRATE[0] + 0.8, CRATE[1])
  await isleTap(s, CRATE[0], CRATE[1])
  let r = await pollStats(s, (st) => st.crateOpened, 6000)
  if (!r.ok) {
    await tapSweep(s, grid(CRATE[0], CRATE[1], 1, 0.5), '(s) => s.crateOpened', 12000, 250)
    r = await pollStats(s, (st) => st.crateOpened, 4000)
  }
  record('beat-2:crate', r.ok ? 'pass' : 'fail', r.ok ? '' : 'crateOpened never became true')

  const hud = await s.evalJson('window.__vo.hudState()')
  if (hud.isleEls > 0) record('beat-2:satchel', 'pass', `${hud.isleEls} .isle-el elements (satchel born)`)
  else record('beat-2:satchel', 'warn', 'no .isle-el DOM found after crate open')

  // Inventory stores seeds/produce in Maps, which JSON.stringify flattens to
  // {} — ask the Maps directly. Polled: the grant lands with the pouch
  // animation a few game-seconds after the lid opens, and headless game
  // seconds are tens of real seconds.
  let seeds = false
  {
    const t0 = Date.now()
    while (!seeds && Date.now() - t0 < 60000) {
      seeds = await s.eval(
        "(() => { try { const inv = window.game.inventory; return [...inv.seeds.keys()].includes('sun-tomato') || [...inv.produce.keys()].some((k) => String(k).includes('sun-tomato')) } catch { return false } })()",
      )
      if (!seeds) await sleep(1000)
    }
  }
  record('beat-2:seeds', seeds ? 'pass' : 'warn', seeds ? '' : 'sun-tomato not visible in inventory serialization (best-effort check)')

  await shot(s, 'beat-2.jpg')
  await goldCheck(s, 2)
  await textLint(s, 'beat-2')
  return r.ok
}

async function beat3(s) {
  await teleport(s, SHOVEL[0] + 0.8, SHOVEL[1])
  const res = await driveHolds(s, 'shovel', '(s) => s.shovelPulled', 15000)
  const ok = !!res?.done
  record('beat-3:shovel', ok ? 'pass' : 'fail', ok ? `held ${JSON.stringify(res.held)}` : `shovelPulled never became true (held: ${JSON.stringify(res?.held ?? [])})`)
  await shot(s, 'beat-3.jpg')
  await goldCheck(s, 3)
  await textLint(s, 'beat-3')
  return ok
}

async function beat4(s) {
  // Try to plant on dry sand — expect the refusal string, no penalty.
  let seen = false
  for (const [x, z] of SAND_SPOTS) {
    await teleport(s, x, z)
    await isleTap(s, x + 0.5, z + 0.5)
    const t0 = Date.now()
    while (Date.now() - t0 < 5000 && !seen) {
      const lines = await s.evalJson('window.__vo.visibleText()')
      if ((lines ?? []).some((t) => t.includes("The sand won't take them"))) seen = true
      else await sleep(350)
    }
    if (seen) break
  }
  // Screenshot while (hopefully) the string is still up.
  await shot(s, 'beat-4.jpg')
  record('beat-4:refusal', seen ? 'pass' : 'fail', seen ? '' : 'string #2 never rendered after sand taps')
  await goldCheck(s, 4)
  await textLint(s, 'beat-4')
  return seen
}

async function beat5(s) {
  await teleport(s, POCKET[0], POCKET[1])
  // The amphora shard is tap-collect; sweep it early, then hold-clear.
  await tapSweep(s, grid(POCKET[0], POCKET[1], 3, 1), '(s) => s.pocketCleared', 12000, 200)
  const res = await driveHolds(s, 'chaos', '(s) => s.pocketCleared', 90000)
  let ok = !!res?.done
  let via = 'holds'
  if (!ok) {
    // One more amphora pass — a lone remaining tap-collect blocks the pocket.
    await tapSweep(s, grid(POCKET[0], POCKET[1], 3, 0.75), '(s) => s.pocketCleared', 15000, 200)
    ok = (await pollStats(s, (st) => st.pocketCleared, 3000)).ok
  }
  if (!ok) {
    await s.eval("window.__isle.goto('plant')")
    await sleep(2500)
    ok = (await pollStats(s, (st) => st.pocketCleared, 5000)).ok
    via = 'goto-fallback (chaos hold ids undiscoverable)'
  }
  record(
    'beat-5:pocket',
    ok ? (via === 'holds' ? 'pass' : 'warn') : 'fail',
    ok ? `cleared via ${via}; held ${JSON.stringify(res?.held ?? [])}` : `pocketCleared never true (requiredLeft: ${res?.stats?.requiredChaosLeft})`,
  )

  // Voluntary extras — the thesis metric. Clear whatever chaos remains.
  const extra = await driveHolds(s, 'chaos', '(s) => false', 10000)
  const vol = extra?.voluntary ?? (await getRecord(s).catch(() => null))?.voluntaryCleared ?? 0
  record('beat-5:voluntary', vol >= 1 ? 'pass' : 'warn', `voluntaryCleared = ${vol}`)

  await sleep(1000) // let the island's breath motes rise into frame
  await shot(s, 'beat-5.jpg')
  await goldCheck(s, 5)
  await textLint(s, 'beat-5')
  return ok
}

async function beat6(s) {
  await teleport(s, POCKET[0], POCKET[1])
  const dig = await driveHolds(s, 'dig', '(s) => s.bedsDug >= 6', 90000)
  let dugOk = (dig?.stats?.bedsDug ?? 0) >= 6

  // Plant: tap each bed with the pouch. Bed positions are farm-grid cells
  // near the pocket centre — sweep the pad.
  await tapSweep(s, grid(POCKET[0], POCKET[1], 4, 1), '(s) => s.seedsPlanted >= 6', 45000, 220)
  let st = (await pollStats(s, (x) => x.seedsPlanted >= 6, 3000)).stats
  let plantOk = (st?.seedsPlanted ?? 0) >= 6

  let via = 'holds+taps'
  if (!dugOk || !plantOk) {
    await s.eval("window.__isle.goto('grow')")
    await sleep(2500)
    st = (await pollStats(s, (x) => x.bedsDug >= 6 && x.seedsPlanted >= 6, 5000)).stats
    dugOk = (st?.bedsDug ?? 0) >= 6
    plantOk = (st?.seedsPlanted ?? 0) >= 6
    via = 'goto-fallback'
  }
  const ok = dugOk && plantOk
  record(
    'beat-6:plant',
    ok ? (via === 'holds+taps' ? 'pass' : 'warn') : 'fail',
    `bedsDug=${st?.bedsDug} seedsPlanted=${st?.seedsPlanted} via ${via}`,
  )
  await shot(s, 'beat-6.jpg')
  await goldCheck(s, 6)
  await textLint(s, 'beat-6')
  return ok
}

async function beat7(s) {
  const res = await tapSweep(s, tideMarchPoints(), '(s) => s.tidePicked >= 3', 60000, 180)
  const picked = res?.stats?.tidePicked ?? 0
  // The tideline never gates the opening, so an undiscoverable washup is a
  // warning, not a run-stopper.
  record('beat-7:tideline', picked >= 3 ? 'pass' : 'warn', `tidePicked = ${picked} after ${res?.taps ?? 0} taps`)
  await shot(s, 'beat-7.jpg')
  await goldCheck(s, 7)
  await textLint(s, 'beat-7')
  return picked >= 3
}

async function beat8(s) {
  // Ripen: ff adds crop progress; loop in case staging replay reset a bed.
  let ripe = false
  for (let i = 0; i < 4 && !ripe; i++) {
    await s.eval('window.__isle.ff(90)')
    ripe = (await pollStats(s, (st) => st.tomatoesRipe >= 6, 12000)).ok
  }
  record('beat-8:ripen', ripe ? 'pass' : 'fail', ripe ? '' : 'tomatoesRipe never reached 6 after 4×ff(90)')

  // Tap-pick the five ordinaries.
  await teleport(s, POCKET[0], POCKET[1])
  await tapSweep(s, grid(POCKET[0], POCKET[1], 4, 1), '(s) => s.ordinariesPicked >= 5', 45000, 220)
  let st = (await getStats(s).catch(() => null)) ?? {}
  const ordOk = (st.ordinariesPicked ?? 0) >= 5
  record('beat-8:ordinaries', ordOk ? 'pass' : 'fail', `ordinariesPicked = ${st.ordinariesPicked}`)

  // The odd fruit is a hold-pick: commit it, then screenshot immediately so
  // the frame lands inside (or right after) the 0.3 s slow-mo gold burst.
  let oddOk = false
  const found = await s.evalJson(`JSON.stringify(window.__vo.discoverHolds(${JSON.stringify(['odd-fruit'])}))`)
  if (Array.isArray(found) && found.length) {
    await s.eval(`window.__isle.hold(${JSON.stringify(found[0].id)})`)
    await shot(s, 'beat-8.jpg')
    oddOk = (await pollStats(s, (x) => x.oddPicked, 6000)).ok
  } else {
    const res = await driveHolds(s, 'odd-fruit', '(s) => s.oddPicked', 15000)
    await shot(s, 'beat-8.jpg')
    oddOk = !!res?.done
  }
  if (!oddOk) {
    await s.eval("window.__isle.goto('arrival')")
    await sleep(2500)
    oddOk = (await pollStats(s, (x) => x.oddPicked, 5000)).ok
    record('beat-8:odd', oddOk ? 'warn' : 'fail', oddOk ? 'via goto-fallback' : 'oddPicked never became true')
  } else {
    record('beat-8:odd', 'pass')
  }
  await goldCheck(s, 8)
  await textLint(s, 'beat-8')
  return ripe && ordOk && oddOk
}

async function beat9(s) {
  /*
   * Arrival is scripted once the beat stages; force it only if it never started.
   *
   * This leg used to poll 180 s, fire `__isle.goat()` "to force it", then poll
   * 480 s — and it failed two runs out of three for a reason that had nothing
   * to do with the goat. Its phase machine is driven by `dt`, and the engine
   * clamps `dt` per frame; under SwiftShader at roughly a frame a second that
   * makes game time run about thirty times slower than the wall clock. A
   * `probe-goat` sample measured the 2.0 s rustle taking 65 real seconds, which
   * puts the whole ~18 s script near ten real minutes. The old first poll
   * therefore expired mid-walk *every* time, and the "force" restarted the
   * script from rustle with less budget left than it had just failed with —
   * the retry could not succeed by construction.
   *
   * So: one long budget, and the nudge only when the goat is genuinely idle.
   */
  const idle = async () => {
    try {
      return await s.eval("(() => { const g = window.game && window.game.goatArrival; return !g || g.phase === 'idle' })()")
    } catch {
      return false
    }
  }
  let r = await pollStats(s, (st) => st.goatDone, 45000, 600)
  if (!r.ok && (await idle())) {
    try {
      await s.eval('window.__isle.goat()')
    } catch {
      // goat() may refuse mid-script; the poll below decides.
    }
  }
  if (!r.ok) r = await pollStats(s, (st) => st.goatDone, 900000, 800)
  record('beat-9:goat', r.ok ? 'pass' : 'fail', r.ok ? '' : 'goatDone never became true')

  // Journal page: wait for string #7 to render, screenshot it, then tap to
  // dismiss (tap anywhere dismisses per contract §2.8).
  let journalSeen = false
  const t0 = Date.now()
  while (Date.now() - t0 < 60000 && !journalSeen) {
    const lines = await s.evalJson('window.__vo.visibleText()')
    if ((lines ?? []).some((t) => t.includes('It wanted something'))) journalSeen = true
    else await sleep(500)
  }
  await shot(s, 'beat-9.jpg')
  record('beat-9:journal', journalSeen ? 'pass' : 'warn', journalSeen ? '' : 'string #7 not observed (screenshot may predate the journal)')
  await textLint(s, 'beat-9')

  let done = false
  for (let i = 0; i < 10 && !done; i++) {
    await s.tapScreen(Math.round(VIEW_W / 2), Math.round(VIEW_H / 2))
    await sleep(2000)
    const rec = await getRecord(s).catch(() => null)
    const st = await getStats(s).catch(() => null)
    done = !!(st?.journalDismissed && rec?.beat === 'done')
  }
  const rec = await getRecord(s).catch(() => null)
  record('beat-9:done', done ? 'pass' : 'fail', `record.beat = ${rec?.beat}`)
  return done
}

const BEAT_FNS = { 1: beat1, 2: beat2, 3: beat3, 4: beat4, 5: beat5, 6: beat6, 7: beat7, 8: beat8, 9: beat9 }

// ---------------------------------------------------------------------------
// Cross-cutting phases
// ---------------------------------------------------------------------------

/** Reload without ?new mid-opening; the sequencer must restore the beat. */
async function resumeTest(s) {
  const before = await getBeat(s).catch(() => null)
  if (!before || before === 'done') {
    record('resume', 'warn', `not mid-opening (beat = ${before}); skipped`)
    return
  }
  await s.navigate(BASE)
  await waitReady(s)
  await sleep(2000) // staging replays up the chain
  const after = await getBeat(s).catch(() => null)
  const ok = after === before
  record('resume', ok ? 'pass' : 'fail', `beat before reload = ${before}, after = ${after}`)
  await shot(s, 'resume.jpg')
}

/** A save blob with no opening record must skip the opening entirely. */
async function legacyTest(s, saveBlob) {
  const blob = saveBlob ?? JSON.stringify({ v: 1 })
  await s.eval(
    `localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(blob)});` +
      `localStorage.removeItem(${JSON.stringify(OPENING_KEY)}); 'seeded'`,
  )
  await s.navigate(BASE)
  await waitReady(s, { needIsle: false })
  // Let the boot loading cover lift so the screenshot shows the actual HUD,
  // not the "Loading the valley" splash.
  {
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      const covered = await s.eval("!!document.getElementById('loading')").catch(() => true)
      if (!covered) break
      await sleep(500)
    }
  }
  await sleep(2000)
  const hud = await s.evalJson('window.__vo.hudState()').catch(() => null)
  if (!hud) {
    record('legacy-save', 'fail', 'page did not boot with the seeded legacy save')
    return
  }
  const skipped = !hud.isleClass
  const hudUp = hud.hudVisible > 0
  record(
    'legacy-save',
    skipped && hudUp ? 'pass' : 'fail',
    `isle-opening class = ${hud.isleClass}, visible hud-chrome = ${hud.hudVisible}` +
      (saveBlob ? ' (real completed-run blob)' : ' (stub blob — best effort)'),
  )
  const marked = await s
    .evalJson(`JSON.stringify((() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(OPENING_KEY)})) } catch { return null } })())`)
    .catch(() => null)
  record(
    'legacy-save:marked',
    marked?.beat === 'done' ? 'pass' : 'warn',
    `opening record after legacy boot: ${marked ? 'beat=' + marked.beat : 'absent'} (markLegacyDone expected)`,
  )
  await shot(s, 'legacy.jpg')
}

/** First-return staging (session 2): force it and record what it stages. */
async function returnTest(s) {
  await s.navigate(BASE)
  await waitReady(s)
  const plan = await s.evalJson('JSON.stringify(window.__isle.ret())').catch(() => null)
  if (!plan) {
    record('first-return', 'fail', '__isle.ret() returned null/undefined — first-return staging did not run')
    return
  }
  record('first-return', 'pass', `plan = ${JSON.stringify(plan)}`)
  await sleep(2500)
  // No string lint here: the first return is a NORMAL-game boot (§3.3) — the
  // full HUD (clock, help card, coins) is supposed to be back. The 8-string
  // budget governs the opening itself, which ended last session.
  await shot(s, 'return.jpg')
}

// ---------------------------------------------------------------------------
// Shots-only mode: jump each beat, settle, capture. No assertions.
// ---------------------------------------------------------------------------

async function shotsOnlyRun(s) {
  await s.navigate(BASE + '?new')
  await waitReady(s)
  for (let n = 1; n <= 9; n++) {
    const stage = STAGE_FOR_BEAT[n]
    try {
      if (stage) {
        await s.eval(`window.__isle.goto(${JSON.stringify(stage)})`)
        await sleep(2500)
      }
      if (n === 8) {
        await s.eval('window.__isle.ff(90)')
        await sleep(2000)
      }
      if (n === 9) await sleep(6000) // let the goat get on stage
      await shot(s, `beat-${n}.jpg`)
    } catch (e) {
      record(`shots:beat-${n}`, 'warn', e.message)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(outDir, { recursive: true })

  // Preflight: a dead dev server should be one readable line, not a timeout.
  // Retried with a generous window because a *cold* vite dev server answers
  // its first request only after the initial transform pass (seconds), and on
  // an IPv6-only bind the happy-eyeballs fallback adds more still — a single
  // short probe reports a perfectly healthy server as dead.
  {
    let reachable = false
    const t0 = Date.now()
    while (!reachable && Date.now() - t0 < 45000) {
      try {
        await fetch(BASE, { signal: AbortSignal.timeout(15000) })
        reachable = true
      } catch {
        await sleep(500)
      }
    }
    if (!reachable) {
      console.error(`Dev server not reachable at ${BASE} — start it first (npx vite --port ${port}).`)
      process.exit(2)
    }
  }

  const s = await launchChrome({ width: VIEW_W, height: VIEW_H })
  s.onEvent('Runtime.exceptionThrown', (p) => {
    const ex = p.exceptionDetails
    pageErrors.push(ex.exception?.description ?? ex.text)
  })

  try {
    if (shotsOnly) {
      console.log('— shots-only run —')
      await shotsOnlyRun(s)
    } else if (beatArg === 'resume') {
      await s.navigate(BASE + '?new')
      await waitReady(s)
      await s.eval("window.__isle.goto('clearing')")
      await sleep(2500)
      await resumeTest(s)
    } else if (beatArg === 'legacy') {
      await s.navigate(BASE + '?new')
      await waitReady(s, { needIsle: false })
      await legacyTest(s, null)
    } else if (beatArg === 'return') {
      // Assumes a completed opening in this profile is impossible (throwaway
      // profile) — run the fast path: jump to done, then stage the return.
      await s.navigate(BASE + '?new')
      await waitReady(s)
      await s.eval("window.__isle.goto('done')")
      await sleep(2000)
      await returnTest(s)
    } else if (/^\d+-\d+$/.test(beatArg)) {
      // Range mode (harness-only convenience, not in the CLI doc comment):
      // drive several beats back-to-back in ONE session so later beats in
      // the range inherit real progress (bedsDug/seedsPlanted/etc) from
      // earlier ones, instead of the single-beat mode's goto()-only staging
      // which does not backfill per-beat stat progress for beats that build
      // on prior beats (e.g. beat 8's ripening needs beat 6's planted beds).
      const [lo, hi] = beatArg.split('-').map(Number)
      await s.navigate(BASE + '?new')
      await waitReady(s)
      const stage = STAGE_FOR_BEAT[lo]
      if (stage) {
        await s.eval(`window.__isle.goto(${JSON.stringify(stage)})`)
        await sleep(2500)
      }
      for (let n = lo; n <= hi; n++) {
        console.log(`— beat ${n} —`)
        await BEAT_FNS[n](s)
      }
    } else if (beatArg !== 'all') {
      const n = Number(beatArg)
      if (!BEAT_FNS[n]) {
        console.error(`--beat must be 1-9, all, resume, legacy, or return (got ${beatArg})`)
        process.exit(2)
      }
      await s.navigate(BASE + '?new')
      await waitReady(s)
      const stage = STAGE_FOR_BEAT[n]
      if (stage) {
        await s.eval(`window.__isle.goto(${JSON.stringify(stage)})`)
        await sleep(2500)
      }
      console.log(`— beat ${n} —`)
      await BEAT_FNS[n](s)
    } else {
      // Full run: beats 1-5, resume test, beats 6-9, first return, legacy.
      await s.navigate(BASE + '?new')
      await waitReady(s)
      for (let n = 1; n <= 9; n++) {
        console.log(`— beat ${n} —`)
        let ok = false
        try {
          ok = await BEAT_FNS[n](s)
        } catch (e) {
          record(`beat-${n}`, 'fail', `driver threw: ${e.message}`)
        }
        if (n === 5) {
          console.log('— resume test —')
          try {
            await resumeTest(s)
          } catch (e) {
            record('resume', 'fail', `driver threw: ${e.message}`)
          }
        }
        // If the beat could not complete naturally, jump so later beats
        // still get exercised (goto staging is idempotent per contract).
        if (!ok && n < 9) {
          const next = STAGE_FOR_BEAT[n + 1]
          if (next) {
            try {
              await s.eval(`window.__isle.goto(${JSON.stringify(next)})`)
              await sleep(2500)
            } catch (e) {
              record(`goto:${next}`, 'warn', e.message)
            }
          }
        }
      }
      console.log('— first return —')
      try {
        await returnTest(s)
      } catch (e) {
        record('first-return', 'fail', `driver threw: ${e.message}`)
      }
      console.log('— legacy save —')
      try {
        // Capture the genuine save blob from the completed run: navigating
        // fires the beforeunload autosave, so read it after a plain reload.
        const blob = await s.eval(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`)
        await legacyTest(s, typeof blob === 'string' ? blob : null)
      } catch (e) {
        record('legacy-save', 'fail', `driver threw: ${e.message}`)
      }
    }
  } catch (e) {
    record('run', 'fail', e.message)
  } finally {
    await s.close()
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  const fails = results.filter((r) => r.status === 'fail')
  const warns = results.filter((r) => r.status === 'warn')
  console.log('\n==== verify-opening report ====')
  for (const r of results) {
    console.log(`${r.status.toUpperCase().padEnd(4)}  ${r.id}${r.reason ? '  — ' + r.reason : ''}`)
  }
  if (pageErrors.length) {
    const seen = new Map()
    for (const p of pageErrors) seen.set(p, (seen.get(p) ?? 0) + 1)
    console.log('\npage exceptions:')
    for (const [msg, n] of seen) console.log(`  ${msg.split('\n')[0]}${n > 1 ? `  (x${n})` : ''}`)
  }
  console.log(`\n${results.length} checks: ${fails.length} failed, ${warns.length} warnings`)
  console.log(`screenshots: ${outDir}`)
  try {
    writeFileSync(
      resolve(outDir, 'report.json'),
      JSON.stringify({ when: new Date().toISOString(), port, beat: beatArg, shotsOnly, results, pageErrors }, null, 2),
    )
  } catch {
    // Report file is a convenience; the console output is the record.
  }
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
