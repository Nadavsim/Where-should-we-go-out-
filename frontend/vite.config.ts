import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds into ../static for FastAPI to serve: "/" and "/c/<token>" return
// static/index.html, which references /static/assets/... (hence the build
// base). The dev server stays at the plain root and proxies /api to uvicorn.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/static/' : '/',
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
}))
