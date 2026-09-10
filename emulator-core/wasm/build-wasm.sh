#!/bin/bash
# =============================================================================
# build-wasm.sh — компиляция WASM-модуля emulator-core через emsdk (emcc).
# Относительный путь: ./emulator-core/wasm/build-wasm.sh
# Результат: ./emulator-core/wasm/hash.wasm
# =============================================================================
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

# Самодостаточность: подгружаем emsdk env, если emcc не в PATH.
if ! command -v emcc >/dev/null 2>&1 && [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
  export PATH="$HOME/.local/bin:$PATH"
  source "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1 || true
fi

command -v emcc >/dev/null 2>&1 || { echo "ERROR: emcc не найден (см. reports/agent-environment.md)"; exit 2; }

echo "emcc: $(emcc -v 2>&1 | grep -E 'Emscripten' | head -1)"

emcc hash.c \
  -O3 \
  -o hash.wasm \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS="['_fnv1a32','_checksum_sum']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  --no-entry

echo "OK: $(ls -la hash.wasm)"
