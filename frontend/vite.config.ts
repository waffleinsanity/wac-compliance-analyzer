import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@data': path.resolve(rootDir, '../data'),
    },
  },
  server: {
    // Bind all local interfaces so both http://localhost:5173 and http://127.0.0.1:5173 work.
    // Port 5173 avoids clashing with Navy EHIP on :3000.
    host: true,
    port: 5173,
    strictPort: true,
    fs: {
      allow: [rootDir, path.resolve(rootDir, '../data')],
    },
    proxy: {
      // Preserve 302 redirects from Google OAuth start/callback.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
