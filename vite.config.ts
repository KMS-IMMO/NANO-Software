import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Alle Abhängigkeiten gleich beim Start vorbereiten. Sonst entdeckt Vite nachgeladene Teile (z. B. den PDF-Leser)
  // erst bei Benutzung und lädt die Vorschau neu, wobei die Demodaten im Browser verloren gehen (Komplettest).
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{ts,tsx}'],
    include: ['pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
})
