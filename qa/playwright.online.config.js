// playwright.online.config.js — e2e онлайн-матча: backend (SPA + WS) на :4180.
// Запуск: (frontend собран) npx playwright test -c playwright.online.config.js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /online\.spec\.js/,
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:4180",
  },
  webServer: {
    command: "node ../backend/server.js",
    cwd: ".",
    env: { PORT: "4180", NODE_ENV: "test" },
    url: "http://localhost:4180/health",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
