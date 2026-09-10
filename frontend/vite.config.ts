import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Пути к модулям-зависимостям (монорепозиторий, вне каталога frontend/).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Vite config. Пути относительные. Серверная часть (backend) запускается отдельно.
export default defineConfig({
  plugins: [react()],
  // Алиасы: маппим относительные импорты зависимостей на их реальные пути
  // (TS резолвит их как обычные относительные, Vite — через эти алиасы).
  resolve: {
    alias: [
      { find: /^\.\.\/\.\.\/emulator-core/, replacement: r("../emulator-core") },
      { find: /^\.\.\/\.\.\/netcode/, replacement: r("../netcode") },
    ],
  },
  server: {
    port: 5173,
    fs: { allow: [".."] }, // доступ к ../emulator-core, ../netcode в dev
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
      },
    },
  },
});
