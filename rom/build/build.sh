#!/bin/bash
# =============================================================================
# build.sh — пересборка ROM из открытого дизассемблера ./rom/disasm
# тулчейном ca65/ld65 (cc65), установленным Agent-Environment в ~/.local/bin.
# Относительный путь: ./rom/build/build.sh
#
# Использование:
#   ./rom/build/build.sh                 # обычная сборка
#   NES_OUTPUT_FILE_DIFF=1 ./rom/build/build.sh   # сравнить с .old (если есть)
#
# После сборки выводит SHA-1/CRC32 результата и сравнивает с базовой ревизией
# дизассемблера (e1061c92..., заданной в assemble.sh).
# =============================================================================
set -euo pipefail

# Корень репозитория
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/../.."

# Тулчейн cc65 (user-space) — приоритет над системным
export PATH="$HOME/.local/bin:$PATH"

BASE_SHA1="E1061C9241B06A965FB7845CB951D921ACA010EF"
DISASM_DIR="./rom/disasm"

if [ ! -f "$DISASM_DIR/assemble.sh" ]; then
  echo "ERROR: не найден $DISASM_DIR/assemble.sh" >&2
  exit 2
fi

echo "==> Пересборка ROM в $DISASM_DIR"
(
  cd "$DISASM_DIR"
  bash assemble.sh
)

ROM_OUT="$DISASM_DIR/_battle_city.nes"
if [ ! -f "$ROM_OUT" ]; then
  echo "ERROR: ROM не создан: $ROM_OUT" >&2
  exit 3
fi

SHA1=$(sha1sum "$ROM_OUT" | awk '{print $1}' | tr '[:lower:]' '[:upper:]')
CRC32=$(python3.11 -c "import zlib;d=open('$ROM_OUT','rb').read();print('%08x'%(zlib.crc32(d)&0xffffffff))")
SIZE=$(wc -c < "$ROM_OUT")

echo "--------------------------------------------"
echo "  Файл:    $ROM_OUT"
echo "  Размер:  $SIZE байт (ожидаемо 24592)"
echo "  SHA-1:   $SHA1"
echo "  CRC32:   $CRC32"
echo "  База:    $BASE_SHA1"
if [ "$SHA1" = "$BASE_SHA1" ]; then
  echo "  RESULT:  OK — совпадает с базовой ревизией дизассемблера"
else
  echo "  RESULT:  РАСХОЖДЕНИЕ с базой (см. reports/agent-environment.md)"
fi
echo "--------------------------------------------"
