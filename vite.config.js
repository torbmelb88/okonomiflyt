import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serverer demoen under /okonomiflyt/ (satt av workflowen);
  // alle andre bygg (lokal dev, Firebase Hosting) ligger på rot
  base: process.env.GITHUB_PAGES === 'true' ? '/okonomiflyt/' : '/',
})
