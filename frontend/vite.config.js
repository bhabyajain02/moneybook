import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      "/api": "https://moneybook-1.onrender.com",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

//'/api': 'http://localhost:8001'
