> 🌐 **English** · [Русский](../typescript.md)

# TypeScript: conventions and layout

The project's own code (`backend`, `netcode`, `emulator-core`, `frontend/src`, `qa`) is
written in TypeScript (`.ts`/`.tsx`). jsnes (`vendor/jsnes`, `emulator-core/src`) and the ROM are immutable.

## Running without a build

Node 23.6+ executes `.ts` directly (type stripping). For `backend`, `netcode`,
`emulator-core`, `qa` no `tsc` build is needed: the sources run as-is, and `tsc`
is used only for type checking (`noEmit`). Requirements of native execution
(checked by `erasableSyntaxOnly`):

- no `enum`, `namespace` with runtime code, parameter properties, `import =`;
- relative imports — with an explicit `.ts` extension;
- types — `import type` only (`verbatimModuleSyntax`);
- no decorators.

The exception is `frontend`: built via Vite, tests use a resolve hook
(`frontend/tests/resolve-ts.mjs`).

## Versions

- Node: `>=23.6` (`package.json`), `.nvmrc` = 24, Docker/CI — `node:24`.
- TypeScript: `^5.9` (`erasableSyntaxOnly` required), `@types/node` `^24`, `typescript-eslint`.

## Import extensions

| Area | Style | Resolved by |
|---|---|---|
| `backend/`, `netcode/`, `emulator-core/`, `qa/`, tests | explicit `.ts` | Node + tsc |
| `emulator-core/*.ts` → `./src/*.js` (jsnes) | `.js` | Node (JS), tsc via `*.d.ts` |
| `frontend/src/**` internally | extensionless | Vite + resolve hook in tests |
| `frontend` → `netcode`/`emulator-core` | explicit `.ts` | Vite + tsc |

## Type configuration

Root `tsconfig.base.json` (inherited by packages):

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

- `noEmit: true` is required together with `allowImportingTsExtensions`.
- `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` are not enabled (noise in numeric code).
- `tsconfig.json` exists in `netcode/`, `backend/`, `emulator-core/`, `frontend/`; `qa/`
  has none — tests are executed by Node directly and are not part of `typecheck`.

## Scripts

```jsonc
// root package.json
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc -p netcode && tsc -p backend && tsc -p emulator-core && tsc -p frontend"
}
```

Per-package test: `node ../scripts/prepare.mjs && node --disable-warning=ExperimentalWarning
--test tests/*.test.ts` (for `backend` without `prepare`). Lint — `eslint .` with `typescript-eslint`
(no type-aware rules; types are checked by `tsc`). `scripts/ci.sh` contains a `typecheck` stage.

## Boundaries with jsnes

- Ready-made declarations: `vendor/jsnes/src/{nes,controller,gamegenie,browser}.d.ts`;
  we do not edit `nes.d.ts`.
- Our additional fields (`nes.opts.noRender`, `onAudioSampleGroup`) — via a local
  type `BattleNesOpts` with `as unknown as`.
- Numeric/binary modules (`state-codec.ts`, `netcode/protocol/frame.ts`) work with
  `Uint8Array`/`DataView`/`number[]`.
- Tests and fakes are typed through port interfaces (`fakeEmu`, `fakeGateway`).
