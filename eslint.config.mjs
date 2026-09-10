// eslint.config.mjs — плоский конфиг ESLint (ESLint 9) для всего монорепозитория.
// Цель: ловить реальные ошибки (необъявленные/неиспользуемые имена, var, ==, дубли ключей),
// не устраивая стилевой шум. jsnes (emulator-core/src) исключён — он неизменяемый.
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/src/**", "**/test-results/**", "**/.kilo/**", "vendor/**", "rom/**", "**/*.ts", "**/*.tsx"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    // тесты и скрипты: допускаем неиспользуемые аргументы/переменные-хелперы
    files: ["**/tests/**/*.js", "scripts/**/*.mjs", "qa/**/*.js"],
    rules: { "no-unused-vars": "off" },
  },
];
