// Temp dev-server config for the jungle-wall visual pass (port 5231).
// Identical to the project config except for its own dep-optimizer cache dir,
// so it does not deadlock against the dev server another session runs on 5216.
// Delete when the pass is done.
import base from '../vite.config.js'

export default {
  ...base,
  root: 'F:/Games/GrowAGardenTwo',
  cacheDir: 'F:/Games/GrowAGardenTwo/node_modules/.vite-jw5231',
  server: { port: 5231, strictPort: true, host: '::1' },
}
