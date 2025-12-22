import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["electron"]
  },
  server: {
    hmr: false,
    cors: false,
    port: 53001,
    strictPort: true
  },
  build: {
    outDir: "dist"
  }
});
