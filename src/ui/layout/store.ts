/**
 * The live side of the layout system: hold a document, push it to the page, ship
 * it to disk.
 *
 * Overrides are applied as a *stylesheet*, not as inline styles. Half the game's
 * UI is rebuilt by innerHTML when a panel opens, which wipes inline styles and
 * would have made every override look like it randomly stopped working. A rule
 * in a stylesheet re-applies itself to whatever matches, whenever it appears,
 * for free.
 */

import { docToCss, EMPTY_DOC, parseDoc, type LayoutDoc } from './doc'
import { asset } from '../../core/assets'

const STYLE_ID = 'sv-ui-layout'
const JSON_URL = asset('ui/layout.json')
const SAVE_URL = '/__ui-layout'

let doc: LayoutDoc = EMPTY_DOC

export function currentDoc(): LayoutDoc {
  return doc
}

/**
 * Read the saved layout.
 *
 * `cache: 'no-store'` because the editor's whole workflow is save-then-reload,
 * and a cached 200 would show you the layout you had two edits ago while
 * insisting it saved fine.
 */
export async function loadLayout(): Promise<LayoutDoc> {
  try {
    const res = await fetch(JSON_URL, { cache: 'no-store' })
    if (!res.ok) return EMPTY_DOC
    doc = parseDoc(await res.json())
  } catch {
    doc = EMPTY_DOC
  }
  return doc
}

function styleEl(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    // Appended last so it is the final word in the cascade among equal
    // specificity, which matters for the free-form `css` escape hatch.
    document.head.appendChild(el)
  }
  return el
}

/**
 * Push a document to the page immediately, with no save. This is the live preview.
 *
 * The compiled CSS addresses its art relative to the sheet on disk — which lives
 * in `public/ui/` — but this copy is injected into the *page*, one directory up.
 * The URLs are re-based on the way in so the preview shows the same art the
 * saved file will, without the file having to carry a path that is only correct
 * from inside the editor.
 */
export function applyLayout(next: LayoutDoc = doc): void {
  doc = next
  styleEl().textContent = docToCss(next).replace(/url\('(?!\.|\/|data:|https?:)/g, `url('${asset('ui/')}`)
}

export interface SaveResult {
  ok: boolean
  entries?: number
  error?: string
}

/**
 * Persist to disk through the dev server.
 *
 * Failure is reported rather than thrown: the only way this fails in practice is
 * running the editor against a production build, where there is no endpoint to
 * write files. That deserves a message in the editor's status line, not an
 * unhandled rejection.
 */
export async function saveLayout(next: LayoutDoc = doc): Promise<SaveResult> {
  applyLayout(next)
  try {
    const res = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      /*
       * The compiled stylesheet travels with the document. The endpoint could
       * have re-rendered it server-side, but then two copies of the compiler
       * would exist — one tested, one in a plain-JS Vite config that cannot
       * import it — and the file on disk would be free to drift from the preview
       * that was just approved on screen. Sending both makes them the same bytes.
       */
      body: JSON.stringify({ json: next, css: docToCss(next) }),
    })
    if (!res.ok) return { ok: false, error: `server said ${res.status}` }
    return (await res.json()) as SaveResult
  } catch (err) {
    return { ok: false, error: `${(err as Error).message} — is the dev server running?` }
  }
}
