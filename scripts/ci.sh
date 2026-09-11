#!/bin/bash
# =============================================================================
# ci.sh — локальный CI: подготовка -> тесты модулей -> сборка фронта.
# ROM-зависимые этапы выполняются, только если есть rom/original/_battle_city.nes.
# Относительный путь: ./scripts/ci.sh
# =============================================================================
set -u
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

PASS=0; FAIL=0; FAILED=(); SKIP=0
have_rom() { [ -f rom/original/_battle_city.nes ]; }

stage() {
  local name="$1"; shift
  echo ""; echo "==================== [$name] ===================="
  if "$@"; then PASS=$((PASS+1)); echo "[$name] OK"; else FAIL=$((FAIL+1)); FAILED+=("$name"); echo "[$name] FAIL"; fi
}
skip() { echo ""; echo "==================== [$1] ===================="; echo "[$1] SKIP ($2)"; SKIP=$((SKIP+1)); }

# Корневые dev-tools (eslint/tsc) нужны для стадий lint/typecheck.
if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/eslint ]; then
  echo "[bootstrap] npm install (корневые dev-tools: eslint, typescript, typescript-eslint)"
  npm install || true
fi

stage "gate:verify-environment" bash scripts/verify-environment.sh
stage "prepare" node scripts/prepare.mjs
stage "lint" npx eslint .
stage "typecheck" npm run typecheck

if have_rom; then
  stage "emulator-core:test" bash -c 'cd emulator-core && node --disable-warning=ExperimentalWarning --test tests/*.test.ts'
  stage "netcode:test"       bash -c 'cd netcode && node --disable-warning=ExperimentalWarning --test tests/*.test.ts'
  stage "qa:test"            bash -c 'cd qa && node --disable-warning=ExperimentalWarning --test tests/*.test.ts'
else
  skip "emulator-core:test" "нет rom/original/_battle_city.nes"
  skip "netcode:test" "нет rom/original/_battle_city.nes"
  skip "qa:test" "нет rom/original/_battle_city.nes"
fi

stage "backend:test" bash -c 'cd backend && npm test'
stage "frontend:build" bash -c 'cd frontend && npm run build'

echo ""; echo "=============================================="
echo "CI итог: pass=$PASS fail=$FAIL skip=$SKIP"
[ "$FAIL" -gt 0 ] && { printf 'Провалены: %s\n' "${FAILED[*]}"; exit 1; }
echo "OK"; exit 0
