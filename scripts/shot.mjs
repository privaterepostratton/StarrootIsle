/**
 * Screenshot a dev-server page with headless Chrome.
 *
 *   node scripts/shot.mjs <url-path> <out.png> [width] [height]
 *   node scripts/shot.mjs /crop-gallery.html out/crops.png 1700 920
 *
 * Exists because the editor's browser pane cannot be captured while it is
 * hidden, which is most of the time. Chrome is driven with SwiftShader so this
 * works over RDP and in a session with no GPU.
 *
 * Call it with a bare filename, not a leading slash: Git Bash rewrites `/x.html`
 * into a Windows path, and Chrome answers the resulting invalid URL by
 * screenshotting its own new-tab page. scripts/cdp.mjs supersedes this for
 * anything needing navigation or measurement.
 *
 * Only static pages capture cleanly: `--virtual-time-budget` waits for the page
 * to go idle, and a page with a requestAnimationFrame loop never does — that is
 * why the crop gallery renders exactly once instead of animating.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find((p) => p && existsSync(p))

if (!CHROME) {
  console.error('Chrome not found — edit the CHROME list in scripts/shot.mjs')
  process.exit(1)
}

const [path = '/crop-gallery.html', out = 'shot.png', w = '1700', h = '920'] = process.argv.slice(2)
const port = process.env.PORT ?? '5214'
const url = path.startsWith('http') ? path : `http://localhost:${port}${path}`
const outPath = resolve(out)
mkdirSync(dirname(outPath), { recursive: true })

// A throwaway profile each run: Chrome refuses to start a second headless
// instance against a profile another one is already holding.
const profile = resolve(tmpdir(), `sv-shot-${process.pid}`)

try {
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      /*
       * Opt-in touch emulation, because `(pointer: coarse)` and `(hover: none)`
       * are the only handle the stylesheet gives the phone layout — without this
       * a headless capture is always the desktop cascade, however small the
       * window is. TOUCH=1 in the environment turns it on.
       */
      ...(process.env.TOUCH ? ['--touch-events=enabled'] : []),
      `--window-size=${w},${h}`,
      '--virtual-time-budget=20000',
      `--user-data-dir=${profile}`,
      `--screenshot=${outPath}`,
      url,
    ],
    { stdio: 'inherit' },
  )
  console.log(`wrote ${outPath}`)
} finally {
  rmSync(profile, { recursive: true, force: true })
}
