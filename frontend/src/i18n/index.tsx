// index.tsx — React i18n wrapper: provider, t() hook, language switcher.
//
// The default language is English; the user's choice is stored in localStorage.
// Relative path: ./frontend/src/i18n/index.tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANG, LANGS, loadLang, saveLang, translate, type Lang, type TranslationParams } from "./translate.ts";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (source: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (source) => translate(DEFAULT_LANG, source),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);
  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (source, params) => translate(lang, source, params) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** String translation: `const t = useT(); t("Отмена")`. */
export function useT() {
  return useContext(I18nContext).t;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** Compact language switcher (EN / RU). */
export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`lang-switch__btn${lang === l.id ? " lang-switch__btn--on" : ""}`}
          onClick={() => setLang(l.id)}
        >
          {l.id.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export type { Lang, TranslationParams };
