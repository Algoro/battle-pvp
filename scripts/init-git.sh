#!/usr/bin/env bash
# init-git.sh — подготовка git-репозитория к публикации на GitHub.
#
# Идемпотентно: создаёт локальный репозиторий (ветка main), подключает сабмодули:
#   vendor/jsnes      — неизменный эмулятор jsnes (Apache-2.0)
#   vendor/nes-disasm — дизассемблер Battle City (reference, sparse: только Battle City)
# и делает первый коммит. Оригинальный ROM не коммитится (см. .gitignore).
#
# Запуск: bash scripts/init-git.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

add_submodule() {
  local name="$1" url="$2" path="$3" sha="$4" sparse_path="${5:-}"
  if git -C "$path" rev-parse --git-dir >/dev/null 2>&1; then
    echo "[init-git] сабмодуль $path уже на месте"
  else
    rm -rf "$path"
    git clone --depth 1 --filter=blob:none --sparse "$url" "$path"
    git -C "$path" checkout "$sha" 2>/dev/null || true
  fi
  [ -n "$sparse_path" ] && git -C "$path" sparse-checkout set "$sparse_path" || true
}

if [ ! -d .git ]; then git init -b main; fi

add_submodule jsnes      "https://github.com/bfirsh/jsnes.git"                             vendor/jsnes      "b8a45d088e922b6abcd87c4eb1b7237919e9d3d2"
add_submodule nes-disasm "https://github.com/cyneprepou4uk/NES-Games-Disassembly.git"     vendor/nes-disasm "df2c8e55e7f13e5792482527db9e7c9e4a84c6e1" "Battle City"

git submodule update --init --recursive

# подготовить генерируемые компоненты (emulator-core/src), если есть оригинальный ROM
node scripts/prepare.mjs || true

git add -A
git commit -m "Initial public release: Battle City PvP" || echo "[init-git] нечего коммитить"

echo
echo "Готово. Дальше:"
echo "  git remote add origin git@github.com:<user>/<repo>.git"
echo "  git push -u origin main"
