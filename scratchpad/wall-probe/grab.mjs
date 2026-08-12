import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find((p) => p && existsSync(p))

const URL = 'http://localhost:5299/scratchpad/wall-probe/jungle-gallery.html'
const OUT = resolve('scratchpad/wall-probe/out')
mkdirSync(OUT, { recursive: true })
const profile = resolve(tmpdir(), `jw-${process.pid}`)

const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
  '--window-size=1000,560', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(3500)

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Log.entryAdded') console.log('LOG', m.params.entry.level, m.params.entry.text)
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
})
await send('Page.navigate', { url: URL })
await sleep(12000)

const stats = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__stats())", returnByValue: true })
console.log("stats:", stats.result?.result?.value)
const ready = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true })
console.log('ready:', JSON.stringify(ready.result))

for (const name of process.argv.slice(2)) {
  const res = await send('Runtime.evaluate', { expression: `window.__shot(${JSON.stringify(name)})`, returnByValue: true, awaitPromise: true })
  const url = res.result?.result?.value
  if (typeof url !== 'string') { console.log('FAIL', name, JSON.stringify(res.result)); continue }
  writeFileSync(resolve(OUT, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'))
  console.log('wrote', name)
}
ws.close()
chrome.kill()
process.exit(0)
