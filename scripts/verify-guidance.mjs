/**
 * Guidance verifier: the ivory chevron trail + the gesture bubble's yellow
 * linear fill bar.
 *
 * Drives the opening to the specific moments the guidance has to be judged on
 * and captures a labelled JPEG for each, alongside a machine read-out of what
 * the guidance resolvers actually decided that frame (__isle.trail / .focus)
 * and what the bar's DOM is doing (fill width, computed colour, shape).
 *
 *   node scripts/verify-guidance.mjs --port 5263 [--out <dir>] [--only <a,b>]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep } from './verify-opening-cdp.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i === -1 ? d : argv[i + 1]
}
const port = flag('port', '5263')
const only = flag('only', null)
const want = (id) => !only || only.split(',').some((k) => id.startsWith(k))
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(flag('out', resolve(root, 'scratchpad/verify-opening')))
const BASE = `http://localhost:${port}/`
const W = 1100
const H = 700

const log = []
const say = (...a) => {
  const line = a.join(' ')
  console.log(line)
  log.push(line)
}

/* -------------------------------------------------------------------------- */

const HELPERS = String.raw`window.__gv = (() => {
  const px = (v) => Math.round(v * 100) / 100
  const V3 = Object.getPrototypeOf(window.game.player.position).constructor
  const scratch = new V3()

  const project = (x, y, z) => {
    const cam = window.game.engine.camera
    const el = window.game.engine.renderer.domElement
    scratch.set(x, y, z).project(cam)
    return [(scratch.x * 0.5 + 0.5) * el.clientWidth, (-scratch.y * 0.5 + 0.5) * el.clientHeight, scratch.z]
  }

  /*
   * Turn the camera to face the objective.
   *
   * Yaw only, by default: the opening pins its own boom (setCinematicDistance
   * = 4.8, pitch 0.17) and re-asserts it, so a driver that also writes pitch
   * and distance is testing a camera no player will ever have. dist/pitch are
   * for the deliberately-wide diagnostic frames, and say so in the label.
   */
  const frame = (tx, tz, dist, pitch) => {
    const e = window.game.engine
    const p = window.game.player.position
    const dx = tx - p.x, dz = tz - p.z
    const len = Math.hypot(dx, dz) || 1
    const yaw = Math.atan2(-dx / len, -dz / len)
    e.yaw = yaw
    e.targetYaw = yaw
    e.focus.copy(p)
    if (typeof pitch === 'number') e.pitch = pitch
    if (typeof dist === 'number') { e.setCinematicDistance(dist); e.distance = dist }
    return px(yaw)
  }
  /** What the boom is actually doing, so a bad frame can be explained. */
  const cam = () => {
    const e = window.game.engine
    return { yaw: px(e.yaw), pitch: px(e.pitch), dist: px(e.distance), cine: e.cineDistance == null ? null : px(e.cineDistance) }
  }

  const rect = (el) => { const r = el?.getBoundingClientRect(); return r ? [px(r.x), px(r.y), px(r.width), px(r.height)] : null }

  // Everything about the hold bar that a screenshot could lie about.
  const bar = () => {
    const wrap = document.querySelector('.isle-bubble')
    if (!wrap) return { present: false }
    const barEl = wrap.querySelector('.isle-bub-bar')
    const fill = wrap.querySelector('.isle-bub-fill')
    const verb = wrap.querySelector('.isle-bub-verb')
    const cs = (el) => el ? getComputedStyle(el) : null
    const w = cs(wrap), b = cs(barEl), f = cs(fill)
    return {
      cls: wrap.className.replace('isle-el ', ''),
      wrapOpacity: px(parseFloat(w.opacity)),
      verb: verb ? verb.textContent : null,
      barShown: b ? (b.display !== 'none' && parseFloat(b.opacity) > 0.02) : false,
      barRect: rect(barEl),
      barOpacity: b?.opacity,
      fillRect: rect(fill),
      fillW: fill?.style?.width ?? null,
      fillBg: (f?.backgroundImage && f.backgroundImage !== 'none') ? f.backgroundImage : f?.backgroundColor,
      fillRadius: f?.borderRadius,
      barBg: (b?.backgroundImage && b.backgroundImage !== 'none') ? b.backgroundImage : b?.backgroundColor,
    }
  }

  const trail = () => { try { return window.__isle.trail() } catch (e) { return { err: String(e) } } }
  const focus = () => { try { return window.__isle.focus() } catch (e) { return { err: String(e) } } }

  const arrows = () => {
    const g = window.game.openingGuide
    if (!g) return { guide: null }
    const out = []
    for (const c of g.group.children) {
      if (!c.visible) continue
      out.push([px(c.position.x), px(c.position.z), px(c.material?.opacity ?? -1)])
    }
    return { parented: !!g.group.parent, n: out.length, pts: out }
  }

  // Colour of the guide chevrons, straight off the material/texture.
  const guideColour = () => {
    const g = window.game.openingGuide
    if (!g) return null
    const m = g.group.children.find((c) => c.material)?.material
    if (!m) return null
    return { hex: '#' + (m.color?.getHexString?.() ?? '?'), map: !!m.map }
  }

  const player = () => { const p = window.game.player.position; return [px(p.x), px(p.z)] }

  const visibleText = () => {
    const out = []
    const walk = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t) }
        else if (n.nodeType === 1 && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') walk(n)
      }
    }
    if (document.body) walk(document.body)
    return out
  }

  // Reserved-gold scan over the canvas plus every *painted* DOM colour,
  // gradients included. Painted = laid out (offsetParent/rect) and no hidden
  // ancestor, which the naive per-element check misses.
  const GOLD_SQ = 1600
  const nearGold = (r, g, b) => { const dr=r-242, dg=g-193, db=b-78; return dr*dr+dg*dg+db*db < GOLD_SQ }
  const painted = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.02) return false
    }
    return true
  }
  const goldScan = () => {
    const g = window.game
    try { g.engine.render() } catch (e) {}
    const src = g.engine.renderer.domElement
    const w = 320, h = Math.max(2, Math.round(src.height * (w / Math.max(1, src.width))))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let gold = 0
    for (let i = 0; i < d.length; i += 4) if (nearGold(d[i], d[i+1], d[i+2])) gold++
    const cssGold = (str) => {
      if (!str || str === 'transparent' || str === 'none') return false
      return (String(str).match(/rgba?\(([^)]*)\)/g) || []).some((m) => {
        const nums = m.replace(/[^0-9.,]/g, '').split(',').map(Number)
        if (nums.length < 3 || nums.some(isNaN)) return false
        if (nums.length > 3 && nums[3] < 0.05) return false
        return nearGold(nums[0], nums[1], nums[2])
      })
    }
    const dom = []
    for (const el of document.querySelectorAll('body *')) {
      if (dom.length > 6) break
      const s = getComputedStyle(el)
      if (!(cssGold(s.color) || cssGold(s.backgroundColor) || cssGold(s.borderColor) || cssGold(s.backgroundImage))) continue
      if (!painted(el)) continue
      dom.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 50))
    }
    return { gold, total: w * h, frac: Math.round(gold / (w * h) * 1e6) / 1e6, dom }
  }

  const state = () => JSON.stringify({
    beat: window.__isle.beat(), stats: window.__isle.stats(),
    trail: trail(), focus: focus(), arrows: arrows(), guideColour: guideColour(),
    player: player(), bar: bar(), cam: cam(),
  })

  // --- drive helpers -------------------------------------------------------
  const holdKind = async (kind, doneSrc, maxMs) => {
    const done = eval(doneSrc)
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < maxMs && !done(window.__isle.stats())) {
      const list = window.__isle.targets().filter((t) => t.kind === kind)
      if (!list.length) { await new Promise((r) => setTimeout(r, 400)); continue }
      for (const t of list) {
        if (done(window.__isle.stats())) break
        try { window.__isle.hold(t.id); n++ } catch (e) {}
        await new Promise((r) => setTimeout(r, 350))
      }
    }
    return JSON.stringify({ n, stats: window.__isle.stats() })
  }
  const plantAll = async (maxMs) => {
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < maxMs) {
      const beds = window.game.farm.tiles.filter((t) => t.placed && !t.sprinkler && t.crop === null)
      if (!beds.length) break
      for (const b of beds) {
        window.game.player.position.set(b.pos.x, 0, b.pos.z)
        await new Promise((r) => setTimeout(r, 120))
        try { window.__isle.tap(b.pos.x, b.pos.z); n++ } catch (e) {}
        await new Promise((r) => setTimeout(r, 220))
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    return JSON.stringify({ n, stats: window.__isle.stats() })
  }
  const crops = () => JSON.stringify(window.game.farm.tiles.filter((t) => t.crop).map((t) => ({
    x: px(t.pos.x), z: px(t.pos.z), id: t.crop.def.id, p: px(t.crop.progress), rar: t.crop.rarity,
  })))

  return { state, bar, trail, focus, arrows, player, project, frame, cam, visibleText, goldScan, holdKind, plantAll, crops }
})()`

/* -------------------------------------------------------------------------- */

async function ready(s) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      if (await s.eval('!!(window.game && window.__isle)')) {
        await s.eval(HELPERS)
        await s.eval("(() => { try { window.game.postfx.setQuality('low') } catch(e) {} return 1 })()")
        await sleep(1500)
        return
      }
    } catch {}
    await sleep(400)
  }
  throw new Error('page never became ready')
}

const state = (s) => s.evalJson('window.__gv.state()')

async function capture(s, label, note) {
  const st = await state(s)
  const path = resolve(outDir, `guidance-${label}.jpg`)
  await s.screenshot(path)
  say(`\n### ${label}${note ? ' — ' + note : ''}`)
  say(`  beat=${st.beat} player=[${st.player}] cam=${JSON.stringify(st.cam)}`)
  say(`  trail=${JSON.stringify(st.trail)}`)
  say(`  focus=${JSON.stringify(st.focus)}`)
  say(`  guideColour=${JSON.stringify(st.guideColour)} arrows: parented=${st.arrows.parented} visible=${st.arrows.n}`)
  say(`  arrowPts=${JSON.stringify(st.arrows.pts)}`)
  say(`  bar=${JSON.stringify(st.bar)}`)
  say(`  shot ${path}`)
  return st
}

async function gold(s, tag) {
  const g = await s.evalJson('JSON.stringify(window.__gv.goldScan())')
  say(`  gold[${tag}]: ${JSON.stringify(g)}`)
  return g
}
async function text(s) {
  const t = await s.evalJson('JSON.stringify(window.__gv.visibleText())')
  say(`  text: ${JSON.stringify(t)}`)
  return t
}

async function goto(s, beat) {
  await s.eval(`window.__isle.goto(${JSON.stringify(beat)})`)
  await sleep(2500)
}

/** Put the farmer somewhere, turn the camera onto the objective axis, settle. */
async function stage(s, px_, pz, tx, tz, { dist, pitch, settle = 7000 } = {}) {
  const args = `${tx}, ${tz}, ${dist ?? 'undefined'}, ${pitch ?? 'undefined'}`
  await s.eval(`window.game.player.position.set(${px_}, 0, ${pz})`)
  await sleep(400)
  await s.eval(`window.__gv.frame(${args})`)
  await sleep(settle)
  await s.eval(`window.__gv.frame(${args})`)
  await sleep(2000)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const s = await launchChrome({ width: W, height: H })
  const errors = []
  s.onEvent('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text))

  try {
    await s.navigate(BASE + '?new')
    await ready(s)

    if (want('a1')) {
      await capture(s, 'a1-wake-naked', 'beat 1, before the sit-up')
      await gold(s, 'wake'); await text(s)
    }

    const crate = await s.evalJson('JSON.stringify([window.game.beachProps.cratePos.x, window.game.beachProps.cratePos.y, window.game.beachProps.cratePos.z])')
    const shovel = await s.evalJson('JSON.stringify([window.game.beachProps.shovelPos.x, window.game.beachProps.shovelPos.y, window.game.beachProps.shovelPos.z])')
    say(`crate=${JSON.stringify(crate)} shovel=${JSON.stringify(shovel)}`)

    if (want('a2')) {
      await goto(s, 'crate')
      // As played: the opening's own boom (4.8 units, pitch 0.17).
      await stage(s, crate[0] + 4.5, crate[2] + 4.5, crate[0], crate[2])
      await capture(s, 'a2-trail-to-crate', 'AS PLAYED: ivory chevrons across pale sand to the seed crate')
      await gold(s, 'crate'); await text(s)
      // Wide diagnostic: the same frame with the boom pulled back, to judge
      // the trail's shape and where it ends.
      await stage(s, crate[0] + 7, crate[2] + 7, crate[0], crate[2], { dist: 16, pitch: 0.75, settle: 5000 })
      await capture(s, 'a2b-trail-to-crate-wide', 'WIDE DIAGNOSTIC (boom pulled back): trail shape to the crate')
      await s.eval('window.game.engine.setCinematicDistance(4.8); window.game.engine.pitch = 0.17')
    }

    if (want('a3')) {
      await stage(s, crate[0] + 2.2, crate[2] + 2.0, crate[0], crate[2])
      await capture(s, 'a3-bubble-tap-crate', 'AS PLAYED: TAP verb card over the crate — no bar')
      await text(s)
    }

    if (want('a4') || want('a5')) {
      await goto(s, 'shovel')
      await stage(s, shovel[0] - 4.5, shovel[2] + 4.5, shovel[0], shovel[2])
      await capture(s, 'a4-trail-to-shovel', 'AS PLAYED: trail re-targeted to the shovel')
      await gold(s, 'shovel')
      await stage(s, shovel[0] - 6, shovel[2] + 6, shovel[0], shovel[2], { dist: 16, pitch: 0.75, settle: 5000 })
      await capture(s, 'a4b-trail-to-shovel-wide', 'WIDE DIAGNOSTIC: trail shape to the shovel')
      await s.eval('window.game.engine.setCinematicDistance(4.8); window.game.engine.pitch = 0.17')
    }

    if (want('a5')) {
      // Walk in and press. dt is clamped to 0.1 s/frame and SwiftShader frames
      // are slow, so a 1.4 s hold takes many real seconds — catchable part-way.
      await stage(s, shovel[0] - 1.8, shovel[2] + 1.6, shovel[0], shovel[2])
      const proj = await s.evalJson(`JSON.stringify(window.__gv.project(${shovel[0]}, ${shovel[1] + 0.35}, ${shovel[2]}))`)
      const [sx, sy] = [Math.round(proj[0]), Math.round(proj[1])]
      say(`  shovel projects to [${sx}, ${sy}] (viewport ${W}x${H})`)
      if (sx > 5 && sx < W - 5 && sy > 5 && sy < H - 5) {
        await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, pointerType: 'mouse' })
        let mid = null
        const t0 = Date.now()
        while (Date.now() - t0 < 90000) {
          const f = await s.evalJson('JSON.stringify(window.__gv.focus())')
          if (f && f.progress > 0.15 && f.progress < 0.85) { mid = f; break }
          if (f && f.progress >= 0.85) break
          if (await s.eval('!!window.game.beachProps.shovelPulled')) break
          await sleep(90)
        }
        if (mid) {
          await capture(s, 'a5-midhold-fill-bar', `MID-HOLD, progress ${mid.progress}`)
          await gold(s, 'midhold'); await text(s)
        } else {
          say('  !! never observed a mid-hold progress window')
          await capture(s, 'a5-midhold-fill-bar', 'MID-HOLD NOT CAUGHT')
        }
        await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1, pointerType: 'mouse' })
        await sleep(1200)
      } else {
        say('  !! shovel projected off-screen; press skipped')
      }
    }

    const gap = await s.evalJson('JSON.stringify([window.game.jungleWall.gapCentre.x, window.game.jungleWall.gapCentre.z])')
    const pocket = await s.evalJson('JSON.stringify([window.game.chaosPocket.centre.x, window.game.chaosPocket.centre.z])')
    say(`gap=${JSON.stringify(gap)} pocket=${JSON.stringify(pocket)}`)

    if (want('a6')) {
      await goto(s, 'clearing')
      await stage(s, -48, 3, gap[0], gap[1])
      await capture(s, 'a6-trail-via-doorway', 'AS PLAYED: beach -> pocket, routed through the treeline gap')
      await gold(s, 'clearing')
      await stage(s, -49, 4, gap[0], gap[1], { dist: 18, pitch: 0.8, settle: 5000 })
      await capture(s, 'a6b-trail-via-doorway-wide', 'WIDE DIAGNOSTIC: the whole dog-leg through the gap')
      await s.eval('window.game.engine.setCinematicDistance(4.8); window.game.engine.pitch = 0.17')
    }

    if (want('a7')) {
      if (!want('a6')) await goto(s, 'clearing')
      // Stand at the clearing's west edge, so the trail runs across open dark
      // clearing floor rather than under the canopy.
      // Approach from the open side (+x,+z): the pocket is 7x5 and ringed by
      // jungle, and a 4.8-unit boom on any other bearing buries the camera in
      // a bush — a staging problem, not a guidance one.
      await stage(s, pocket[0] + 4.2, pocket[1] + 4.2, pocket[0] - 1.5, pocket[1] - 1.5)
      await capture(s, 'a7-trail-jungle-floor', 'AS PLAYED: trail across the dark clearing floor')
      await gold(s, 'jungle')
      await stage(s, pocket[0] + 5.5, pocket[1] + 2.5, pocket[0] - 1.5, pocket[1])
      await capture(s, 'a7b-trail-clearing-floor-2', 'AS PLAYED: second angle on the dark floor')
      // Same-side control: a beach target must NOT be given the doorway.
      await s.eval('window.game.player.position.set(-55, 0, 6)')
      await sleep(1500)
      const beachSide = await s.evalJson('JSON.stringify(window.__gv.trail())')
      say(`  same-side control (player -55,6): trail=${JSON.stringify(beachSide)}`)
    }

    if (want('a8') || want('a9')) {
      // Real progress: dig the beds, plant them, ripen them.
      await goto(s, 'plant')
      await stage(s, pocket[0], pocket[1], pocket[0] + 1, pocket[1], { settle: 3000 })
      say('  digging: ' + await s.eval('window.__gv.holdKind("dig", "(s)=>s.bedsDug>=6", 90000)'))
      say('  planting: ' + await s.eval('window.__gv.plantAll(90000)'))
      await s.eval('window.__isle.ff(400)')
      await sleep(3000)
      say('  crops: ' + await s.eval('window.__gv.crops()'))
      await goto(s, 'harvest')
      await sleep(6000) // let the crop meshes rebuild to their ripe stage
      const beds = await s.evalJson('window.__gv.crops()')
      say('  ripe beds: ' + JSON.stringify(beds))
      const oddBed = beds?.find((b) => b.rar === 'gold')
      const ordBed = beds?.find((b) => b.rar === 'common' && b.id === 'sun-tomato')
      // Stand inside tap reach (2.6) of an ORDINARY, with the odd fruit further
      // off: the card must name the ordinary, the trail must too.
      if (ordBed) await stage(s, ordBed.x + 1.3, ordBed.z - 1.3, ordBed.x, ordBed.z)
      await capture(s, 'a8-harvest-ordinaries', 'AS PLAYED: harvest, ordinaries first (tap card)')
      await gold(s, 'harvest')
      await text(s)
      say(`  oddBed=${JSON.stringify(oddBed)} ordBed=${JSON.stringify(ordBed)}`)
    }

    if (want('a9')) {
      const removed = await s.eval(`(() => {
        let n = 0
        for (const t of window.game.farm.tiles) {
          const c = t.crop
          if (c && c.def.id === 'sun-tomato' && c.progress >= 1 && c.rarity === 'common') { t.crop = null; n++ }
        }
        return n
      })()`)
      say(`  removed ordinaries: ${removed}`)
      await sleep(3000)
      const odd = await s.evalJson('JSON.stringify(window.__gv.trail())')
      say(`  trail now: ${JSON.stringify(odd)}`)
      if (odd && odd.x !== undefined) {
        // Inside the 2.6 tap reach, so the odd fruit — not a rim vine — owns
        // the card: 1.3/1.3 is 1.84 units out.
        await stage(s, odd.x + 1.3, odd.z + 1.3, odd.x, odd.z)
      }
      await capture(s, 'a9-harvest-odd-fruit', 'AS PLAYED: only the odd fruit left — trail + HOLD card')
      await text(s)
    }

    /*
     * The check the yellow bar exists to survive: a bar held part-way up at a
     * beat where LOTTO_GOLD is still reserved. Run on a dig target at 'plant'
     * (beat 6), on dark loam, which is the worst case for the bar's own
     * antialiased edges blending toward gold.
     */
    if (want('c1')) {
      await goto(s, 'plant')
      const digs = await s.evalJson(`JSON.stringify(window.__isle.targets().filter((t) => t.kind === 'dig').map((t) => [Math.round(t.pos.x*100)/100, Math.round(t.pos.y*100)/100, Math.round(t.pos.z*100)/100]))`)
      say(`  dig targets: ${JSON.stringify(digs)}`)
      const d = digs?.[0]
      if (d) {
        await stage(s, d[0] + 1.3, d[2] + 1.3, d[0], d[2])
        const proj = await s.evalJson(`JSON.stringify(window.__gv.project(${d[0]}, ${d[1] + 0.15}, ${d[2]}))`)
        const [sx, sy] = [Math.round(proj[0]), Math.round(proj[1])]
        say(`  dig projects to [${sx}, ${sy}]`)
        if (sx > 5 && sx < W - 5 && sy > 5 && sy < H - 5) {
          await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, pointerType: 'mouse' })
          let mid = null
          const t0 = Date.now()
          while (Date.now() - t0 < 90000) {
            const f = await s.evalJson('JSON.stringify(window.__gv.focus())')
            if (f && f.progress > 0.2 && f.progress < 0.85) { mid = f; break }
            if (f && f.progress >= 0.85) break
            await sleep(90)
          }
          await capture(s, 'c1-midhold-dig-beat6', mid ? `MID-HOLD on loam at beat 6, progress ${mid.progress}` : 'MID-HOLD on loam NOT CAUGHT')
          await gold(s, 'beat6-bar-up')
          await text(s)
          await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1, pointerType: 'mouse' })
        } else {
          say('  !! dig target off-screen')
        }
      }
    }

    /*
     * "Max one prompt on screen" under pressure: at 'plant' the worded prompt
     * follows a plantable bed while the wordless marker follows the nearest
     * UNDUG spot, and the two only merge when they are within a ring's radius
     * of each other. Dig one bed, plant nothing, stand between the two.
     */
    if (want('c2')) {
      await goto(s, 'plant')
      await sleep(2000)
      const digs2 = await s.evalJson(`JSON.stringify(window.__isle.targets().filter((t) => t.kind === 'dig').map((t) => [Math.round(t.pos.x*100)/100, Math.round(t.pos.z*100)/100]))`)
      say(`  dig targets: ${JSON.stringify(digs2)}`)
      // Dig only the two nearest, leaving undug spots elsewhere in the pad.
      await s.eval(`(() => {
        const ts = window.__isle.targets().filter((t) => t.kind === 'dig')
        ts.slice(0, 2).forEach((t) => t.onComplete())
        return ts.length
      })()`)
      await sleep(4000)
      const st2 = await state(s)
      say(`  after 2 digs: focus=${JSON.stringify(st2.focus)} trail=${JSON.stringify(st2.trail)}`)
      const beds2 = await s.evalJson(`JSON.stringify(window.game.farm.tiles.filter((t) => t.placed && !t.sprinkler && t.crop === null).map((t) => [Math.round(t.pos.x*100)/100, Math.round(t.pos.z*100)/100]))`)
      say(`  plantable beds: ${JSON.stringify(beds2)}`)
      const b = beds2?.[0]
      if (b) {
        await stage(s, b[0] + 1.2, b[1] + 1.2, b[0], b[1])
        await capture(s, 'c2-prompt-vs-marker', 'plant beat: worded prompt on a bed, wordless marker on the next undug spot')
        await text(s)
        const rings = await s.evalJson(`JSON.stringify((() => {
          const out = []
          for (const el of document.querySelectorAll('.isle-prompt, .isle-mark, .isle-bubble')) {
            const s = getComputedStyle(el)
            const r = el.getBoundingClientRect()
            out.push({ cls: el.className.replace('isle-el ', ''), vis: s.visibility, disp: s.display,
                       rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
          }
          return out
        })())`)
        say(`  ivory elements on screen: ${JSON.stringify(rings)}`)
      }
    }

    if (want('b1')) {
      await goto(s, 'arrival')
      await sleep(4000)
      await capture(s, 'b1-arrival-no-trail', 'the goat arrives unannounced')
      await sleep(10000)
      await capture(s, 'b2-arrival-mid', 'mid-arrival: still no trail')
    }
  } catch (e) {
    say('DRIVER THREW: ' + e.message + '\n' + e.stack)
  } finally {
    if (errors.length) {
      const seen = new Map()
      for (const e of errors) { const k = String(e).split('\n')[0]; seen.set(k, (seen.get(k) ?? 0) + 1) }
      say('\npage exceptions:')
      for (const [m, n] of seen) say(`  ${m}${n > 1 ? ' (x' + n + ')' : ''}`)
    }
    await s.close()
  }
  writeFileSync(resolve(outDir, 'guidance-log.txt'), log.join('\n'))
  say(`\nlog: ${resolve(outDir, 'guidance-log.txt')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
