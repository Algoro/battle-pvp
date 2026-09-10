#!/usr/bin/env bash
# init-git.sh — подготовка git-репозитория к публикации на GitHub.
#
# Идемпотентно: создаёт локальный репозиторий (ветка main), подключает jsnes как
# git-сабмодуль (vendor/jsnes) на зафиксированный коммит и делает первый коммит.
#
# Запуск: bash scripts/init-git.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JSNES_URL="https://github.com/bfirsh/jsnes.git"
JSNES_SHA="b8a45d0" # pinned upstream (см. .gitmodules)

if [ ! -d .git ]; then
  git init -b main
fi

# jsnes как сабмодуль (если ещё не оформлен)
if [ ! -f .git/modules/vendor/jsnes/HEAD ] && ! git submodule status vendor/jsnes >/dev/null 2>&1; then
  rm -rf vendor/jsnes
  git submodule add --depth 1 "$JSNES_URL" vendor/jsnes
  git -C vendor/jsnes fetch --depth 1 origin "$JSNES_SHA" || true
  git -C vendor/jsnes checkout "$JSNES_SHA" || true
fi

git submodule update --init --recursive

# подготовить генерируемые компоненты (emulator-core/src), если есть оригинальный ROM
node scripts/prepare.mjs || true

git add -A
git commit -m "Initial public release: Battle City PvP" || echo "Нечего коммитить."

echo
echo "Готово. Дальше:"
echo "  git remote add origin git@github.com:<user>/<repo>.git"
echo "  git push -u origin main"
