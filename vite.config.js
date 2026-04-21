import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://portkey.bain.dev',
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace(/^\/api/, '/v1'),
      }
    }
  }
})
