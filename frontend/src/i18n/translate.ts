// translate.ts — the i18n core.
//
// "msgid = source (Russian) string" approach: the code keeps t("Отмена"), while the
// translation tables map the source string to English. For the ru language there is no translation —
// the string itself is returned. This gives localization without renaming keys and without
// changing patch/render manifests (the UI translates their title/description on the fly).
//
// Relative path: ./frontend/src/i18n/translate.ts
import common from "./en/common.ts";
import lobby from "./en/lobby.ts";
import game from "./en/game.ts";
import render from "./en/render.ts";
import td from "./en/td.ts";
import misc from "./en/misc.ts";

export type Lang = "en" | "ru";
export type TranslationParams = Record<string, string | number>;
export type Messages = Record<string, string>;

/** English translations grouped by area (see en/*.ts). */
export const EN: Messages = { ...common, ...lobby, ...game, ...render, ...td, ...misc };

export const LANGS: { id: Lang; title: string }[] = [
  { id: "en", title: "English" },
  { id: "ru", title: "Русский" },
];

export const DEFAULT_LANG: Lang = "en";
export const LANG_STORAGE_KEY = "bc_lang";

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  return DEFAULT_LANG;
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  let out = text;
  for (const [key, value] of Object.entries(params)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

/** Translate a string: for en — via the table, for ru — return the source. */
export function translate(lang: Lang, source: string, params?: TranslationParams): string {
  const text = lang === "en" ? EN[source] ?? source : source;
  return interpolate(text, params);
}
