// playwright.config.js — e2e-конфиг для клиента (frontend/dist).
// Запуск: npx playwright install chromium && npm run build (в frontend) && npm run e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    cwd: "../frontend",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
