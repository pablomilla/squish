import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const API_PORT = process.env.PORT ?? '8787'

/**
 * Which build this is: the commit Render is deploying, or a timestamp
 * anywhere else. Baked into the app (__SQUISH_BUILD__) and written beside it
 * (dist/build.json, which the server reports at /api/build), so an app left
 * open across a deploy can tell it is out of date and refresh itself — see
 * src/lib/update.ts.
 */
const BUILD = (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 12) || `local-${Date.now().toString(36)}`

const buildFile = (): Plugin => ({
  name: 'squish-build-id',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ build: BUILD }) })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildFile()],
  define: { __SQUISH_BUILD__: JSON.stringify(BUILD) },
  server: {
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
})
