// eslint.config.mjs — плоский конфиг ESLint (ESLint 9) для всего монорепозитория.
// Цель: ловить реальные ошибки (необъявленные/неиспользуемые имена, var, ==, дубли ключей),
// не устраивая стилевой шум. jsnes (emulator-core/src) исключён — он неизменяемый.
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const tsFiles = ["**/*.ts", "**/*.tsx"];
const nodeGlobals = { ...globals.node, ...globals.browser };

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "emulator-core/src/**",
      "**/test-results/**",
      "**/.kilo/**",
      "vendor/**",
      "rom/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
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
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: tsFiles })),
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["frontend/**/*.ts", "frontend/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // тесты и скрипты: допускаем неиспользуемые аргументы/переменные-хелперы
    files: ["**/tests/**/*.ts", "scripts/**/*.mjs", "qa/**/*.ts"],
    rules: { "no-unused-vars": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
];
