import { asset } from '../core/assets'
import { allIconIds, iconSrc } from './icons'

/**
 * Warm every UI image before the loading screen goes away.
 *
 * The 3D assets have always been awaited at boot; the *images* never were, and
 * they are the ones the player notices. A hundred-odd painted icons and two
 * dozen panel sprites are fetched the first time something happens to show
 * them — so a panel opened for the first time popped in unstyled, a mutation
 * glyph appeared a frame after the toast that announced it, and the shop's rows
 * filled in as you scrolled. All of it after a loading screen that had already
 * claimed to be finished.
 *
 * Two sources, because the images arrive by two routes:
 *
 *  - The icon registry, which is the id list `icons.ts` renders `<img>` tags
 *    from. Enumerable directly.
 *  - `url(...)` in the stylesheets, which is where the panel frames, buttons and
 *    pill art live. Scraped rather than listed, so art added to the CSS is
 *    preloaded without anyone having to remember this file exists.
 */

/** Longest a single image's decode may hold things up. */
const DECODE_TIMEOUT_MS = 1500
/** Longest the whole preload may delay boot, however much is left. */
const TOTAL_BUDGET_MS = 6000

/** Every `url(...)` target in the loaded stylesheets, deduped. */
function cssImageUrls(): string[] {
  const found = new Set<string>()
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // A cross-origin sheet cannot be read. Nothing of ours is, so skipping is
      // correct rather than merely convenient.
      continue
    }
    for (const rule of rules) {
      // `cssText` on a top-level rule already contains any nested blocks, so
      // this does not need to walk the tree — which is just as well, since a
      // CSSStyleRule under CSS nesting reports an empty-but-truthy `cssRules`
      // and a naive walk silently descends into nothing.
      for (const m of rule.cssText.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
        const url = m[2].trim()
        if (!url || url.startsWith('data:')) continue
        /*
         * Resolved against the *stylesheet*, not the document.
         *
         * `cssText` hands the URL back as authored, and a stylesheet's relative
         * URLs are relative to the stylesheet — the bundled sheet lives in
         * `assets/` and says `../ui/x.png`. Handing that straight to an `Image`
         * resolves it against the page instead, which is one directory too high:
         * correct on a dev server rooted at `/`, and a 404 for every piece of UI
         * art the moment a portal serves the build from a subdirectory.
         */
        try {
          found.add(new URL(url, sheet.href ?? document.baseURI).href)
        } catch {
          // A malformed url() is not worth failing the preload over.
        }
      }
    }
  }
  return [...found]
}

/** Resolve `p`, or resolve anyway after `ms`. Never rejects. */
function atMost(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    p.then(() => { clearTimeout(timer); resolve() }, () => { clearTimeout(timer); resolve() })
  })
}

/** Fetch and decode one image. Never rejects — a missing icon is not fatal. */
function warm(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      /*
       * `decode()` is the point, not `onload`.
       *
       * A loaded image is bytes in cache; the *decode* to a paintable bitmap
       * still happens on the main thread the first time it is drawn, which is
       * the hitch this is meant to remove.
       *
       * Bounded, though, because a hidden tab does not rasterise: `decode()`
       * simply never settles there, and a player who opens the game in a
       * background tab — clicking a link and switching away is the normal way
       * to open anything — would sit on the loading screen forever. The bytes
       * are cached the moment `onload` fires, which is most of the win anyway.
       */
      atMost(img.decode(), DECODE_TIMEOUT_MS).then(resolve)
    }
    img.onerror = () => resolve()
    img.src = url
  })
}

/**
 * Warm every UI image, reporting 0..1 as they land.
 *
 * Resolves even if some fail: a game that refuses to start because one icon
 * 404s is worse than one with a missing icon.
 */
export async function preloadImages(onProgress?: (fraction: number) => void) {
  const urls = new Set<string>(cssImageUrls())
  for (const id of allIconIds()) urls.add(iconSrc(id))
  // Referenced from code rather than from the registry or a stylesheet.
  for (const extra of ['ui/coin.png']) urls.add(asset(extra))

  const list = [...urls]
  if (list.length === 0) {
    onProgress?.(1)
    return
  }

  let done = 0
  const all = Promise.all(
    list.map((url) =>
      warm(url).then(() => {
        done++
        onProgress?.(done / list.length)
      }),
    ),
  )

  /*
   * The whole batch is bounded too, and the stragglers are left running.
   *
   * Warming images is an optimisation; it must never be the thing that decides
   * whether the game starts. On a slow connection the right behaviour is to get
   * on with it and let the remaining icons land while the player is walking
   * around — which is exactly what they did before any of this existed.
   */
  await atMost(all, TOTAL_BUDGET_MS)
  onProgress?.(1)
}
