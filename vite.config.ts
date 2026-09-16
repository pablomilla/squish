import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_PORT = process.env.PORT ?? '8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
})
