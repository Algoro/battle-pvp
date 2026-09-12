# TypeScript: конвенции и раскладка

Собственный код проекта (`backend`, `netcode`, `emulator-core`, `frontend/src`, `qa`) —
на TypeScript (`.ts`/`.tsx`). jsnes (`vendor/jsnes`, `emulator-core/src`) и ROM неизменяемы.

## Запуск без сборки

Node 23.6+ исполняет `.ts` напрямую (type stripping). Для `backend`, `netcode`,
`emulator-core`, `qa` `tsc`-build не нужен: исходники запускаются как есть, а `tsc`
используется только для проверки типов (`noEmit`). Требования нативного запуска
(проверяется `erasableSyntaxOnly`):

- без `enum`, `namespace` с рантайм-кодом, parameter properties, `import =`;
- относительные импорты — с явным расширением `.ts`;
- типы — только `import type` (`verbatimModuleSyntax`);
- декораторов нет.

Исключение — `frontend`: сборка через Vite, в тестах работает resolve-hook
(`frontend/tests/resolve-ts.mjs`).

## Версии

- Node: `>=23.6` (`package.json`), `.nvmrc` = 24, Docker/CI — `node:24`.
- TypeScript: `^5.9` (нужен `erasableSyntaxOnly`), `@types/node` `^24`, `typescript-eslint`.

## Расширения импортов

| Зона | Стиль | Кто резолвит |
|---|---|---|
| `backend/`, `netcode/`, `emulator-core/`, `qa/`, тесты | явное `.ts` | Node + tsc |
| `emulator-core/*.ts` → `./src/*.js` (jsnes) | `.js` | Node (JS), tsc через `*.d.ts` |
| `frontend/src/**` внутри себя | extensionless | Vite + resolve-hook в тестах |
| `frontend` → `netcode`/`emulator-core` | явное `.ts` | Vite + tsc |

## Конфигурация типов

Корневой `tsconfig.base.json` (наследуется пакетами):

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useDefineForClassFields": true,
    "types": ["node"]
  }
}
```

- `noEmit: true` обязателен вместе с `allowImportingTsExtensions`.
- `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` не включены (шум в числовом коде).
- `tsconfig.json` есть у `netcode/`, `backend/`, `emulator-core/`, `frontend/`; у `qa/`
  своего нет — тесты исполняет Node напрямую и в `typecheck` они не входят.

## Скрипты

```jsonc
// корневой package.json
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc -p netcode && tsc -p backend && tsc -p emulator-core && tsc -p frontend"
}
```

Пакетный тест: `node ../scripts/prepare.mjs && node --disable-warning=ExperimentalWarning
--test tests/*.test.ts` (у `backend` без `prepare`). Линт — `eslint .` с `typescript-eslint`
(без type-aware правил; типы проверяет `tsc`). `scripts/ci.sh` содержит стадию `typecheck`.

## Границы с jsnes

- Готовые декларации: `vendor/jsnes/src/{nes,controller,gamegenie,browser}.d.ts`;
  `nes.d.ts` не правим.
- Наши дополнительные поля (`nes.opts.noRender`, `onAudioSampleGroup`) — через локальный
  тип `BattleNesOpts` с `as unknown as`.
- Числовые/бинарные модули (`state-codec.ts`, `netcode/protocol/frame.ts`) работают с
  `Uint8Array`/`DataView`/`number[]`.
- Тесты и фейки типизированы через интерфейсы портов (`fakeEmu`, `fakeGateway`).
