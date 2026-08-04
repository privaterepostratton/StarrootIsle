/**
 * Resolve a public/ asset to a URL that works wherever the game is served from.
 *
 * Every model, texture, icon and audio file used to be fetched by an absolute
 * path — `/models/villager.glb`. That is correct exactly once: when the game sits
 * at the root of its own domain. A portal serves an uploaded build out of a
 * subdirectory on a shared CDN, and a leading slash there resolves against the
 * *CDN root*, so every asset in the game 404s and the player gets a lit,
 * running, completely empty world.
 *
 * Vite's `base: './'` does not fix this on its own. It rewrites the references
 * it owns — the script and stylesheet tags it writes into index.html, and
 * anything imported through the module graph — but a string handed to a loader
 * at runtime is just a string, and nothing rewrites it.
 *
 * `BASE_URL` is that base, so this turns the same path into `./models/…`, which
 * resolves against the page rather than the host. Kept as one helper rather than
 * relative literals scattered through the code, because the correct prefix
 * depends on the build and hand-written `../` chains would each be right only
 * from the file that wrote them.
 */

/** Base the build was configured with. `./` for portal-safe builds. */
const BASE = import.meta.env.BASE_URL ?? './'

/**
 * `asset('models/villager.glb')` → `./models/villager.glb`.
 *
 * Leading slashes are tolerated so a stray absolute path cannot reintroduce the
 * bug by slipping through as `.//models/…` or, worse, staying absolute.
 */
export function asset(path: string) {
  const clean = path.replace(/^\/+/, '')
  return BASE.endsWith('/') ? `${BASE}${clean}` : `${BASE}/${clean}`
}
