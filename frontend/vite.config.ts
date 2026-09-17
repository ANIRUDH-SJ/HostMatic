import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.HOSTMATIC_API_PORT || 9000}` } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
