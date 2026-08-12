/**
 * Long-lived headless-Chrome session for the opening verifier.
 *
 * scripts/cdp.mjs is a one-shot tool: spawn, navigate, capture, die. The
 * per-beat verifier needs the *same* page kept alive across many evaluate
 * calls, real input dispatch, and mid-run reloads (resume + legacy-save
 * tests), so this module lifts cdp.mjs's connection plumbing into a reusable
 * session object. Same zero-dependency approach: Node's global WebSocket is
 * the whole client, SwiftShader keeps WebGL alive with no GPU (project
 * memory: the editor's browser pane cannot screenshot while hidden — this
 * pipeline is how the project verifies visuals).
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Launch headless Chrome and return a live CDP session.
 *
 * The returned object stays valid across `navigate()` calls — Chrome keeps
 * the same target for same-tab navigations, which is exactly what the
 * resume/legacy reload tests need (localStorage persists in the profile for
 * the whole run, and is wiped with the throwaway profile at `close()`).
 */
export async function launchChrome({ width = 1000, height = 620 } = {}) {
  if (!CHROME) {
    throw new Error('Chrome not found — edit the CHROME list in scripts/verify-opening-cdp.mjs')
  }
  const profile = resolve(tmpdir(), `sv-verify-${process.pid}`)
  const debugPort = 9400 + (process.pid % 500)

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
      // The audio gesture-gate means the page will try to create an
      // AudioContext on the first synthetic tap; autoplay policy would
      // otherwise leave it suspended and spam the console.
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // Chrome writes its port file and opens the socket a moment after launch.
  let wsUrl = null
  for (let i = 0; i < 150 && !wsUrl; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null
    } catch {
      // Not listening yet.
    }
    if (!wsUrl) await sleep(100)
  }
  if (!wsUrl) {
    chrome.kill()
    throw new Error('Chrome never opened its debugging port')
  }

  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen)
    ws.addEventListener('error', () => rejectOpen(new Error('CDP websocket failed to open')))
  })
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

  const send = (method, params = {}) =>
    new Promise((resolveMsg, rejectMsg) => {
      const id = nextId++
      pending.set(id, { resolve: resolveMsg, reject: rejectMsg })
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')

  const session = {
    send,
    onEvent: (method, fn) => listeners.set(method, fn),

    /** Navigate the (single) tab. Callers poll readiness themselves. */
    async navigate(url) {
      await send('Page.navigate', { url })
    },

    /**
     * Evaluate an expression and return its value. Promises are awaited, so
     * in-page `async` drive loops work. Throws with the page-side message on
     * an uncaught exception — `.text` alone is always the bare word
     * "Uncaught", which is undebuggable (lesson inherited from cdp.mjs).
     */
    async eval(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails.exception
        throw new Error(`page eval threw: ${ex?.description ?? ex?.value ?? res.exceptionDetails.text}`)
      }
      return res.result.value
    },

    /** eval() for expressions that JSON.stringify their result page-side. */
    async evalJson(expression) {
      const raw = await session.eval(expression)
      if (typeof raw !== 'string') return raw
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    },

    /**
     * Full-page JPEG (WebGL canvas AND DOM overlays — prompt strings, the
     * journal page — which the in-game `__cap` canvas grab cannot show).
     */
    async screenshot(outPath, quality = 86) {
      const abs = resolve(outPath)
      mkdirSync(dirname(abs), { recursive: true })
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality })
      writeFileSync(abs, Buffer.from(shot.data, 'base64'))
      return abs
    },

    /** A real mouse tap on the page (capture-phase listeners see it). */
    async tapScreen(x, y) {
      const base = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' }
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await sleep(60)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    },

    async close() {
      try {
        ws.close()
      } catch {
        // Already closed.
      }
      chrome.kill()
      await sleep(400)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        // Chrome can hold the profile a moment after exit; a leftover temp
        // directory is not worth failing a verification run over.
      }
    },
  }
  return session
}
