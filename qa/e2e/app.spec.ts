// app.spec.js — e2e: лобби, соло-игра, соло за атакующих.
// Требует: frontend собрана (npm run build), браузер установлен (npx playwright install chromium).
import { test, expect } from "@playwright/test";

test("лобби отображается с выбором команды", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Battle City/ })).toBeVisible();
  await expect(page.getByText("Защитники", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Атакующие", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Соло/ })).toBeVisible();
});

test("соло-режим запускает эмулятор (canvas + HUD)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Соло/ }).first().click();
  await expect(page.locator("canvas.screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/DEF жизни/)).toBeVisible();
  await page.waitForTimeout(1000);
  const hasPixels = await page.locator("canvas.screen").evaluate((c) => {
    const ctx = c.getContext("2d");
    return ctx.getImageData(0, 0, 1, 1).data[3] === 255;
  });
  expect(hasPixels).toBe(true);
});

test("соло за атакующих: AI танка игрока отключён, управляется только по вводу", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Атакующие", { exact: false }).first().click();
  await page.getByRole("button", { name: /Соло/ }).first().click();

  // ждём спавна танка 2 (позиция != 255,255)
  let spawned = false;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(2000);
    if (await page.evaluate(() => window.__bc.readMem(0x92)) !== 255) { spawned = true; break; }
  }
  expect(spawned, "танк не заспавнился").toBe(true);

  const snap = () => page.evaluate(() => [window.__bc.readMem(0x92), window.__bc.readMem(0x9a)]);

  // ведём вниз, чтобы войти в поле
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(3000);
  await page.keyboard.up("ArrowDown");
  const afterDown = await snap();

  // без ввода — танк стоит (AI отключён)
  await page.waitForTimeout(2500);
  const idle = await snap();
  expect(idle[0] === afterDown[0] && idle[1] === afterDown[1], "танк двигался без ввода (AI не отключён)").toBe(true);

  // ещё вниз — танк реагирует на ввод
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(2500);
  await page.keyboard.up("ArrowDown");
  const again = await snap();
  expect(again[1] >= idle[1], "танк не отреагировал на ввод вниз").toBe(true);
});
