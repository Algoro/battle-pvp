# Agent-Backend — matchmaking, лобби, signaling relay, персистентность

Дата: 2026-08-23
Окружение: Ubuntu 20.04, без sudo/Docker. Backend — **прямой Node-процесс + SQLite**
(`node:sqlite`), что соответствует Блоку 6 (без Docker до появления root-доступа).

## Структура (относительные пути)
```
./backend/
  server.js                HTTP API + WebSocket (точка входа)
  matchmaking/rooms.js     RoomManager: комнаты, 2 команды, порты, TTL, реконнект
  matchmaking/matchmaker.js очередь пар «DEF+ATT» -> комната
  signaling/relay.js       WebRTC-signaling relay + data relay (fallback)
  persistence/store.js     SQLite: игроки, матчи, player_matches
  tests/backend.test.js     unit + integration (PASS)
  package.json, .gitignore
```

## Реализовано (Блок 6)
- **Лобби/комнаты**: команды DEF (1-2) и ATT (1-2), симметричные правила (разница
  только в спавн-позициях — задокументировано в reports/agent-asm-architect.md).
  Порт игрока: DEF -> 0..1, ATT -> 2..3. Комнаты с **TTL** (по умолчанию 5 мин
  простоя), **реконнект** в течение 30 сек (по sessionId).
- **Matchmaking**: очередь; пара «защитник + атакующий» образует комнату (v1 — 1v1,
  поддерживается до 2v2 через RoomManager). `POST /matchmake`.
- **WebRTC-signaling relay**: WS (`/ws`): `join` -> назначение порта и пиров,
  `signal` -> пересылка SDP/ICE между пирами, `relay.data` -> ретрансляция игровых
  байт (fallback при симметричном NAT), `start`/`finish` -> жизненный цикл матча.
- **Персистентность (SQLite)**: таблицы `players`, `matches`, `player_matches`;
  история матчей и результаты (`GET /matches`).
- HTTP API: `GET /health`, `GET /rooms`, `GET /matches`, `POST /matchmake`.

## API (кратко)
| Метод | Путь | Описание |
|-------|------|----------|
| GET  | /health  | {ok:true} |
| GET  | /rooms   | открытые лобби |
| GET  | /matches | история матчей |
| POST | /matchmake | {playerId, team, name?} -> {room,port,opponent} \| {queued:true} |
| WS   | /ws      | signaling + data relay |

## Тесты (все PASS)
- RoomManager: join/полная команда/порты/реконнект/leave/TTL.
- Matchmaker: пара DEF+ATT образует комнату.
- Store: create/finish/list в SQLite.
- **Интеграция**: HTTP matchmaking + два WS-клиента входят в комнату, сигнал
  SDP/ICE ретранслируется, `finish` -> матч записан в БД.

## Найденные и исправленные ошибки
1. `Room.isActive` игнорировал настраиваемый TTL (использовал DEFAULT). Исправлено —
   TTL прокинут из RoomManager в Room.
2. В тесте ожидание двух WS-клиентов по одному промису срабатывало на первом `open`
   (второй клиент мог быть не готов). Исправлено — ждём открытие каждого отдельно.
3. Матч, стартовавший через matchmaker, не создавал запись в БД, из-за чего `finish`
   не находил строку. Добавлен `store.ensureMatch` (INSERT OR IGNORE) в `_onStart`/
   `_onFinish`.

## Передача управления
**Agent-Frontend**: подключение к `/ws`, сопряжение WebRTC через signaling, запуск
`RollbackSession` с транспортом WebRTC/relay. **Agent-QA**: нагрузочное тестирование
комнат и джиттера/потерь (используя `LocalEndpoint` из netcode и этот backend).
