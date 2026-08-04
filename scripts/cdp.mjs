/**
 * Drive headless Chrome over the DevTools protocol.
 *
 *   node scripts/cdp.mjs <url-path> [--out shot.png] [--size 844x390] [--touch]
 *                        [--eval "expression"] [--wait ms]
 *
 * Replaces the `--screenshot=` command line shot.mjs used to rely on: current
 * Chrome ignores the positional URL in that mode and photographs its own new-tab
 * page instead, which is a failure that looks exactly like a broken stylesheet.
 * Talking to the browser directly is both fixable and more useful — `--eval`
 * reads real layout numbers back, so "does this fit" can be answered with a
 * measurement rather than by squinting at a picture.
 *
 * No dependencies: Node's global WebSocket is the whole client.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find((p) => p && existsSync(p))

if (!CHROME) {
  console.error('Chrome not found — edit the CHROME list in scripts/cdp.mjs')
  process.exit(1)
}

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
/*
 * Leading slash optional, and stripped of any drive letter a shell has bolted
 * on. Git Bash rewrites a bare `/foo.html` argument into `C:/Program Files/Git/
 * foo.html` before the script ever sees it — the URL that produces is invalid,
 * and Chrome's answer to an invalid URL is to sit on its new-tab page, which
 * photographs as a perfectly plausible "the stylesheet is broken".
 */
const rawPath = argv[0]?.startsWith('--') ? '/' : (argv[0] ?? '/')
const path = /^[a-z][a-z0-9+.-]+:/i.test(rawPath)
  ? rawPath
  : '/' + rawPath.replace(/^.*[/\\]Git[/\\]/i, '').replace(/^\/+/, '')
const out = flag('out', null)
const evalExpr = flag('eval', null)
const waitMs = Number(flag('wait', 1200))
const touch = argv.includes('--touch')
const wantConsole = argv.includes('--console')
const [w, h] = flag('size', '1280x800').split('x').map(Number)

const port = process.env.PORT ?? '5214'
const url = /^[a-z][a-z0-9+.-]+:/i.test(path) ? path : `http://localhost:${port}${path}`
const profile = resolve(tmpdir(), `sv-cdp-${process.pid}`)
const debugPort = 9333 + (process.pid % 500)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    ...(touch ? ['--touch-events=enabled'] : []),
    `--window-size=${w},${h}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Chrome writes its port file and opens the socket a moment after launch. */
async function endpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Not listening yet.
    }
    await sleep(100)
  }
  throw new Error('Chrome never opened its debugging port')
}

let nextId = 1
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  const ready = new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method) {
      listeners.get(msg.method)?.(msg.params)
      return
    }
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result)
  })
  const listeners = new Map()
  const onEvent = (method, fn) => listeners.set(method, fn)
  const send = async (method, params = {}) => {
    await ready
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      const payload = JSON.stringify({ id, method, params })
      if (process.env.CDP_DEBUG) console.error('->', payload)
      ws.send(payload)
    })
  }
  return { send, onEvent, close: () => ws.close() }
}

try {
  const { send, onEvent, close } = connect(await endpoint())

  // Touch emulation has to be asked for over the protocol too; the command-line
  // flag alone does not flip `(pointer: coarse)` for the page.
  if (touch) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: w,
      screenHeight: h,
    })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })
  }

  await send('Page.enable')
  await send('Runtime.enable')

  /*
   * Console and network failures, which are usually the whole answer when a page
   * "just does not load" — a 404 for one model is invisible from the outside and
   * obvious from in here.
   */
  const problems = []
  if (wantConsole) {
    await send('Log.enable')
    await send('Network.enable')
    onEvent('Log.entryAdded', (p) => {
      if (p.entry.level === 'error' || p.entry.level === 'warning') {
        problems.push(`[${p.entry.level}] ${p.entry.text} ${p.entry.url ?? ''}`.trim())
      }
    })
    onEvent('Network.loadingFailed', (p) => problems.push(`[failed] ${p.errorText} ${p.type}`))
    onEvent('Runtime.exceptionThrown', (p) => {
      const ex = p.exceptionDetails
      problems.push(`[uncaught] ${ex.exception?.description ?? ex.text}`)
    })
  }
  await send('Page.navigate', { url })
  await sleep(waitMs)

  if (evalExpr) {
    const res = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true })
    if (res.exceptionDetails) {
      // `.text` is always the bare word "Uncaught"; the useful message lives on
      // the exception object, and without it a failed eval is undebuggable.
      const ex = res.exceptionDetails.exception
      console.error(ex?.description ?? ex?.value ?? res.exceptionDetails.text ?? 'eval threw')
    }
    console.log(typeof res.result.value === 'string' ? res.result.value : JSON.stringify(res.result.value, null, 2))
  }

  if (wantConsole) {
    const seen = new Map()
    for (const p of problems) seen.set(p, (seen.get(p) ?? 0) + 1)
    const lines = [...seen].map(([p, n]) => (n > 1 ? `${p}  (x${n})` : p))
    console.log(lines.length ? lines.join('\n') : '(no console errors)')
  }

  if (out) {
    const outPath = resolve(out)
    mkdirSync(dirname(outPath), { recursive: true })
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
    console.log(`wrote ${outPath}`)
  }

  close()
} finally {
  chrome.kill()
  await sleep(400)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // Chrome can still hold a handle on the profile a moment after exit. A
    // leftover temp directory is not worth failing a screenshot over.
  }
}
