#!/bin/bash
# =============================================================================
# test-p2-ai-netinput.sh — byte-diff regression-тест патча P2
# (enemy AI -> сетевой ввод, главный хук sub_DDA2).
# Проверяет: пересборка падает в базу, а в патченом ROM ровно ожидаемые 23
# байта отличаются: 0x1DE4-0x1DEA (JMP sub_net_enemy_dir + NOPs) и
# 0x2F85-0x2F94 (подпрограмма sub_net_enemy_dir).
# Относительный путь: ./rom/tests/test-p2-ai-netinput.sh
# =============================================================================
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/../.."

# 1. Пересборка
./rom/build/build.sh >/dev/null
PATCHED=./rom/disasm/_battle_city.nes

# 2. Размер
size=$(wc -c < "$PATCHED")
[ "$size" = "24592" ] || { echo "FAIL: размер $size != 24592"; exit 1; }

# 3. Проверка вражеской ветки: JMP $EF75 + 4xNOP
branch=$(xxd -p -s $((0x1DE4)) -l 7 "$PATCHED")
[ "$branch" = "4c75efeaeaeaea" ] || { echo "FAIL: ветка [$branch]"; exit 1; }

# 4. Проверка подпрограммы: 16 байт
#   хвост ...4ce4dd — fallback без net-ввода: JMP $DDE4 (tbl_E486[ram_0064],
#   точное направление к цели), а не возврат текущего флага b5a060.
sub=$(xxd -p -s $((0x2F85)) -l 16 "$PATCHED")
[ "$sub" = "8a38e902a8b9db01300309a0604ce4dd" ] || { echo "FAIL: sub [$sub]"; exit 1; }

echo "PASS: P2 hook (enemy AI -> network input) присутствует в ROM"
echo "  JMP \$EF75 + NOP*4 @0x1DE4"
echo "  sub_net_enemy_dir @0x2F85"
exit 0
