> 🌐 **English** · [Русский](../getting-started.md)

# Getting started

## Requirements

- Node.js ≥ 23.6 (Docker/CI — 24 LTS; native type stripping of `.ts` without a build), npm.
- git with submodule support.
- Original Battle City (Japan) ROM — `rom/original/_battle_city.nes`
  (sha1 `941ad7ca825e3f86407472113aad00520cb45783`).
- Docker (optional) — for a "single container" run.

Environment check: `bash scripts/verify-environment.sh`.

## Initial setup

```bash
# only jsnes is required (immutable emulator)
git submodule update --init vendor/jsnes

node scripts/prepare.mjs                  # emulator-core/src, ROM artifacts, public/rom
```

The reference disassembly (`vendor/nes-disasm`) is **not needed** to build or test.
If you want to include it (sparse, only `Battle City`):

```bash
git submodule update --init vendor/nes-disasm
git -C vendor/nes-disasm sparse-checkout set "Battle City"
```

`scripts/prepare.mjs`:
1. generates `emulator-core/src` from the `vendor/jsnes` submodule (the copy is never edited);
2. copies the original ROM to `frontend/public/rom/battle_city.nes`;
3. builds `rom/disasm/_battle_city.nes` = original + `pvp` patches (the reference for tests).

The script is idempotent and safe to run concurrently.

## Running (locally)

```bash
# backend (HTTP + WebSocket, serves the built frontend from frontend/dist if present)
cd backend && npm install && npm start        # :8080

# frontend in dev mode (Vite, HMR)
cd frontend && npm install && npm run dev
```

The backend can serve the SPA from `frontend/dist`. For a prod-like run without Docker:

```bash
cd frontend && npm run build      # prebuild calls prepare itself
cd ../backend && npm start
# http://localhost:8080
```

## Running (Docker)

```bash
# put the ROM at rom/original/_battle_city.nes
docker build -t battle-city-pvp .
docker run --rm -p 8080:8080 battle-city-pvp
```

Container: a single backend process that serves the built SPA and handles WS signaling.

## Tests

```bash
npm install                     # root dev-tools (ESLint/Prettier/TS)
npm run lint                    # static analysis (ESLint, JS+TS)
npm run typecheck               # tsc --noEmit across netcode/backend/emulator-core/frontend

cd emulator-core && npm test
cd netcode       && npm test
cd backend       && npm test
cd qa            && npm test
cd frontend      && npm test

# browser e2e
cd qa && npx playwright install chromium && npm run e2e:online
```

TypeScript sources are executed by Node directly (type stripping, no build);
relative imports specify the `.ts` extension. jsnes (`emulator-core/src`) remains
immutable JS.

CI run: `bash scripts/ci.sh` — stages gate, prepare, lint, typecheck,
emulator-core/netcode/qa/backend tests and the frontend build (ROM-dependent stages are
skipped without the ROM). Frontend unit tests (`cd frontend && npm test`) are run separately —
they are not in `ci.sh`.

## Common problems

- **`vendor/jsnes not found`** — the submodule is not initialized: `git submodule update --init vendor/jsnes`.
- **`Original ROM not found`** — put the file in `rom/original/` (see `rom/original/README.md`).
- **Tests fail on the ROM** — the ROM is missing or has the wrong revision (verify the sha1).
- **Port busy** — set `PORT` (backend) or the Vite port.
