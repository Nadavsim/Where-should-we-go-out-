import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds into dist/, which the Worker serves as static assets (see
// ../wrangler.jsonc). In dev, `npm run dev` here proxies /api to
// `wrangler dev` running at the repo root.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
