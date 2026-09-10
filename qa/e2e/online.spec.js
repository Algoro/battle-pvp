// online.spec.js — e2e онлайн-матча: лобби → старт → синхронизация → чат матча →
// режим наблюдателя (spectator) по ?spectate=MATCHID.
// Требует: frontend/dist собран, backend запускается webServer-ом (playwright.online.config.js).
import { test, expect } from "@playwright/test";

// Создаёт онлайн 1v1 и доводит до боя. Возвращает контексты/страницы и matchId.
async function setupMatch(browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await alice.goto("/?player=alice&name=Алиса");
  await bob.goto("/?player=bob&name=Боб");

  await alice.getByRole("button", { name: /Создать игру/ }).click();
  await alice.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(alice.locator(".room-header__meta")).toBeVisible({ timeout: 10_000 });
  const meta = await alice.locator(".room-header__meta").innerText();
  const code = (meta.match(/код\s+([A-Z0-9]+)/i) || [])[1];
  expect(code, `не найден код комнаты в "${meta}"`).toBeTruthy();

  await bob.goto(`/?player=bob&name=Боб&lobby=${code}`);
  await expect(bob.locator(".room-header__meta")).toBeVisible({ timeout: 10_000 });
  await bob.getByRole("button", { name: /^Готов$/ }).click();
  await alice.getByRole("button", { name: /Старт/ }).click();

  await expect(alice.locator("canvas.screen")).toBeVisible({ timeout: 20_000 });
  await expect(bob.locator("canvas.screen")).toBeVisible({ timeout: 20_000 });

  const matchId = await alice.evaluate(() => window.__matchId);
  expect(matchId).toBeTruthy();
  return { ctxA, ctxB, alice, bob, matchId };
}

test("онлайн 1v1: лобби, старт, синхронные хэши, чат матча", async ({ browser }) => {
  const { ctxA, ctxB, alice, bob } = await setupMatch(browser);

  const started = (page) => page.evaluate(() => window.__bc && window.__bc.readMem(0x80) !== 0xff).catch(() => false);
  const hashOf = (page) => page.evaluate(() => window.__bc.getFrameHash()).catch(() => null);

  let converged = false;
  for (let i = 0; i < 100 && !converged; i++) {
    await alice.waitForTimeout(150);
    if ((await started(alice)) && (await started(bob))) {
      const [ha, hb] = await Promise.all([hashOf(alice), hashOf(bob)]);
      if (ha && ha === hb) converged = true;
    }
  }
  expect(converged, "хэши клиентов не сошлись (desync)").toBe(true);

  const text = "держим базу";
  await bob.locator(".chat__form input").fill(text);
  await bob.locator(".chat__form button").click();
  await expect(alice.getByText(text)).toBeVisible({ timeout: 10_000 });

  // звук: AudioContext поднят жестом, обе группы (музыка/эффекты) уходят в вывод
  const audio = await alice.evaluate(() => window.__bcAudio.stats());
  expect(audio.ready, "AudioContext не поднялся").toBe(true);
  expect(audio.music.posted, "нет сэмплов музыки").toBeGreaterThan(0);
  expect(audio.sfx.posted, "нет сэмплов эффектов").toBeGreaterThan(0);

  await ctxA.close();
  await ctxB.close();
});

test("наблюдатель: ?spectate=MATCHID показывает матч", async ({ browser }) => {
  const { ctxA, ctxB, alice, matchId } = await setupMatch(browser);

  const ctxC = await browser.newContext();
  const spec = await ctxC.newPage();
  await spec.goto(`/?player=spec&name=Смотрящий&spectate=${matchId}`);
  await expect(spec.locator("canvas.screen")).toBeVisible({ timeout: 15_000 });
  await expect(spec.getByText(/Режим: наблюдатель/)).toBeVisible();

  // ждём первый снапшот: счётчик кадра становится > 0
  await expect(spec.getByText(/кадр: [1-9]/)).toBeVisible({ timeout: 20_000 });

  // рисуется не пустой кадр
  const drawn = await spec.locator("canvas.screen").evaluate((c) => {
    const ctx = c.getContext("2d");
    return ctx.getImageData(0, 0, 1, 1).data[3] === 255;
  });
  expect(drawn).toBe(true);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
