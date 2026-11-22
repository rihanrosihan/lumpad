import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Lists every built file so the service worker can store the whole app on first visit (offline works for every page).
const assetList = () => ({
  name: 'asset-list',
  generateBundle(_o, bundle) {
    const files = Object.keys(bundle).filter((f) => /\.(js|css|woff2)$/.test(f) && !/(cyrillic|greek|vietnamese)/.test(f)).map((f) => '/' + f)
    this.emitFile({ type: 'asset', fileName: 'asset-list.json', source: JSON.stringify(files) })
  },
})

export default defineConfig({
  plugins: [react(), assetList()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'leaflet-vendor': ['leaflet'],
          'chart-vendor': ['chart.js/auto'],
        },
      },
    },
  },
})
