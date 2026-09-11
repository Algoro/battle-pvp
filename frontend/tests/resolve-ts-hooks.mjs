// resolve-ts-hooks.mjs — resolve-hook для node-тестов: локальные импорты без расширения
// (Vite/tsc bundler) резолвятся в .ts/.tsx, как это делает сборщик фронтенда.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTS = [".ts", ".tsx", ".js"];
const HAS_EXT = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, next) {
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
