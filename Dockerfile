# =============================================================================
# Battle City PvP — один контейнер: собранный фронт (SPA) + backend (HTTP+WS).
# Требует оригинальный ROM: rom/original/_battle_city.nes (sha1 941ad7ca…).
# jsnes подключается как сабмодуль vendor/jsnes; emulator-core/src генерируется.
#
# Сборка:  docker build -t battle-city-pvp .
# Запуск:  docker run --rm -p 8080:8080 battle-city-pvp
# Открыть: http://localhost:8080
# =============================================================================
# syntax=docker/dockerfile:1

# --- Стадия сборки фронта ------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app/frontend

# зависимости (кэшируются отдельно)
COPY frontend/package*.json ./
RUN npm install

# модули монорепо + неизменный jsnes (сабмодуль) + скрипт подготовки
COPY emulator-core/ /app/emulator-core/
COPY netcode/ /app/netcode/
COPY vendor/jsnes/ /app/vendor/jsnes/
COPY tsconfig.base.json /app/tsconfig.base.json
COPY shared/ /app/shared/
COPY scripts/prepare.mjs /app/scripts/prepare.mjs
COPY rom/original/ /app/rom/original/

# исходники фронта (+ prebuild сгенерирует emulator-core/src и public/rom из оригинала)
COPY frontend/ ./
RUN npm run build

# --- Стадия сборки backend (только prod-зависимости) ----------------------
FROM node:24-slim AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev

# --- Runtime ----------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
COPY shared/ ./shared/
COPY --from=build /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server.ts"]
