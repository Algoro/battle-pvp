// meine-tank.spec.ts — e2e: the Minecraft-fidelity voxel driver mounts, renders a WebGL
// canvas without errors and respects its settings. Requires a built frontend + chromium.
import { test, expect } from "@playwright/test";

const OPTIONS = {
  preset: "vanilla",
  cameraMode: "orbit",
  textureSize: 32,
  fauna: "lively",
  faunaDensity: 2,
  decor: "full",
  particles: 2,
  time: "day",
};

test("meine-tank: драйвер выбирается, монтирует WebGL и не сыпет ошибками", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.addInitScript((opts) => {
    localStorage.setItem("bc_lang", "ru");
    localStorage.setItem("bc_renderDriver", "meine-tank");
    localStorage.setItem("bc_renderExtensions", "");
    localStorage.setItem("bc_renderOptions", JSON.stringify({ "meine-tank": opts }));
  }, OPTIONS);

  await page.goto("/");
  await page.getByRole("button", { name: /Соло/ }).first().click();
  await page.keyboard.press("Enter");

  await expect(page.locator("canvas.webgl")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Вид: Meine Tank/)).toBeVisible();
  await page.waitForTimeout(6000);

  // Ground decor must never sit on water/ice/trees/brick/steel (see driver's spawn audit).
  const decorBad = await page.evaluate(() => (globalThis as { __mtDecorBadNow?: number }).__mtDecorBadNow ?? 0);
  expect(decorBad, "декор на непустых клетках").toBe(0);

  expect(errors, errors.join("\n")).toEqual([]);
});
