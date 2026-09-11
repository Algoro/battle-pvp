#!/bin/bash
# =============================================================================
# verify-environment.sh — проверка окружения Battle City PvP.
# Обязательно: git, node >= 23.6 (нативный type stripping .ts), npm, сабмодуль vendor/jsnes.
# Опционально: оригинальный ROM (нужен для тестов и запуска), emcc (сборка wasm).
# Относительный путь: ./scripts/verify-environment.sh
# =============================================================================
set -u
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."
FAIL=0

check() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf "  [OK]   %-10s %s\n" "$name" "$(command -v "$name")"
  else
    printf "  [FAIL] %-10s NOT FOUND\n" "$name"; FAIL=1
  fi
}

echo "==> Обязательные инструменты"
check git
check npm
# Node >= 23.6: нативный type stripping исполняет .ts без сборки.
node_major="${NODE_MAJOR:-$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)}"
node_minor="${NODE_MINOR:-$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)}"
if [ "$node_major" -gt 23 ] || { [ "$node_major" -eq 23 ] && [ "$node_minor" -ge 6 ]; }; then
  printf "  [OK]   %-10s %s\n" "node" "$(node --version) (type stripping)"
else
  printf "  [FAIL] %-10s %s (< 23.6: нет нативного type stripping)\n" "node" "$(node --version 2>/dev/null || echo 'NOT FOUND')"; FAIL=1
fi

echo
echo "==> jsnes (сабмодуль)"
if [ -f vendor/jsnes/src/nes.js ]; then
  printf "  [OK]   vendor/jsnes на месте (%s)\n" "$(git -C vendor/jsnes rev-parse --short HEAD 2>/dev/null || echo 'n/a')"
else
  printf "  [FAIL] vendor/jsnes не инициализирован: git submodule update --init --recursive\n"; FAIL=1
fi

echo
echo "==> Оригинальный ROM (нужен для тестов/игры)"
if [ -f rom/original/_battle_city.nes ]; then
  printf "  [OK]   rom/original/_battle_city.nes (sha1 %s)\n" \
    "$(sha1sum rom/original/_battle_city.nes | cut -d' ' -f1)"
else
  printf "  [WARN] rom/original/_battle_city.nes отсутствует (см. rom/original/README.md)\n"
fi

echo
if command -v emcc >/dev/null 2>&1; then
  printf "  [OK]   emcc (опц., сборка wasm)\n"
else
  printf "  [skip] emcc не найден (опц.; hash.wasm уже в репозитории)\n"
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "==> RESULT: OK"; exit 0; else echo "==> RESULT: FAIL"; exit 1; fi
