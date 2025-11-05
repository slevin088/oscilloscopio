import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 👇 Inserisci qui il nome del repository GitHub tra gli slash
  // Esempio: se il repo si chiama "oscilloscopio" → base: '/oscilloscopio/'
  base: '/oscilloscopio/',
})
