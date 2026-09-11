// resolve-ts-hooks.mjs — resolve-hook для node-тестов: локальные импорты без расширения
// (Vite/tsc bundler) резолвятся в .ts/.tsx, как это делает сборщик фронтенда.
// Дополнительно разворачивает алиасы @netcode/@core (см. frontend/tsconfig.json, vite.config.ts).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTS = [".ts", ".tsx", ".js"];
const HAS_EXT = /\.[cm]?[jt]sx?$/;

const ALIASES = [
  ["@netcode/", new URL("../../netcode/", import.meta.url)],
  ["@core/", new URL("../../emulator-core/", import.meta.url)],
];

function expandAlias(specifier) {
  for (const [prefix, base] of ALIASES) {
    if (specifier.startsWith(prefix)) {
      return new URL(specifier.slice(prefix.length), base).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const aliased = expandAlias(specifier);
  if (aliased) {
    return next(aliased, context);
  }
  if (specifier.startsWith(".") && !HAS_EXT.test(specifier)) {
    for (const ext of EXTS) {
      const candidate = specifier + ext;
      try {
        const resolved = await next(candidate, context);
        if (resolved?.url && existsSync(fileURLToPath(resolved.url))) return resolved;
      } catch {
        /* пробуем следующее расширение */
      }
    }
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    // относительный путь без расширения, но с .ts в URL — уже обработано выше
    throw e;
  }
}
