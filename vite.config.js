import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// El plugin de Cloudflare corre el Worker y el Durable Object dentro de `npm run dev`,
// con el mismo runtime (workerd) que en producción.
export default defineConfig({
  plugins: [react(), cloudflare()],
})
