# Сетевой протокол netcode (frame format)

Rollback netcode (аналог GGPO). Относительные пути: `./netcode/*`.
Формат пакетов — **версия 2**: каждый пакет начинается байтом-тегом (`PKT`),
что делает маршрутизацию однозначной (раньше hash/snapshot могли быть ошибочно
декодированы как frame).

## Теги пакетов (`netcode/protocol/frame.js`)
| Тег | Пакет | Разметка (LE) |
|---|---|---|
| 1 `INPUT` | ввод одного кадра | `uint8 type, uint32 frame, uint8 count, repeat{uint8 port,uint8 buttons}` |
| 2 `BATCH` | избыточная пачка последних N кадров | `uint8 type, uint32 headFrame, uint8 frames, repeat{uint32 frame, uint8 count, repeat{port,buttons}}` |
| 3 `HASH` | сверка хэша | `uint8 type, uint32 frame, uint32 hash` |
| 4 `PING` / 5 `PONG` | задержка | `uint8 type, uint32 seq, uint32 t(ms)` |
| 6 `SNAP_REQ` | запрос снапшота | `uint8 type, uint32 frame` |
| 7 `SNAP` | кусок снапшота | `uint8 type, uint32 frame, uint32 hash, uint16 seq, uint16 total, bytes` |

`BATCH.headFrame` = следующий кадр отправителя (нужен для догона после resync).
Снапшот режется на куски по `SNAP_CHUNK_BYTES` (16 КиБ): `encodeSnapshot(frame, hash, bytes)`.

## Rollback-сессия (`netcode/rollback/session.js`)
- `advanceFrame(myInputs)` — сохраняет state, симулирует кадр, шлёт **избыточную** пачку
  последних `redundancy` (по умолчанию 4) кадров, периодически hash-check подтверждённых
  кадров (`confirmDelay` 20), ping каждые 60 кадров.
- Предсказание недошедшего ввода = «повтор последнего известного ввода соперника».
- При позднем вводе — откат к `states[frame]`, переигровка вперёд; `states[f]`
  пересохраняется при каждой переигровке. Дубликаты ввода дедуплицируются по порту.
- **Избыточность** скрывает потери одиночных пакетов (без необратимого desync).
- **Задержка**: события `latency {ms}`; `peer-unresponsive` при молчании > 600 кадров.
- **Реконнект**: `rebindTransport(transport)` перевешивает сессию на новый транспорт
  (события `transport-closed` / `transport-rebound`).
- **Desync-recovery**: при расхождении хэшей не-авторитетный клиент (меньший `playerId`,
  либо явный `authority`) запрашивает полный снапшот у авторитета, применяет его
  (`resync`) и **догоняет** счётчик кадра по `headFrame`, пропущенные кадры симулируя
  предсказанием (реальные вводы исправят их через rollback). События: `desync`,
  `resync-request`, `snapshot-sent`, `resync`, `catch-up`.
- События `onEvent`: `frame`, `rollback {fromFrame,toFrame}`, `desync {frame,localHash,remoteHash}`,
  `latency {ms}`, `transport-closed`, `transport-rebound`, `resync*`.

## Транспорты (контракт `{ send(buf), onMessage(cb), onClose?(cb), isOpen?() }`)
- `transport/local.js` — in-process (задержка/джиттер/потери, детерм. PRNG) для тестов.
- `transport/webrtc.js` — WebRTC DataChannel (основной, P2P).
- `transport/relay.js` — через backend (fallback при симметричном NAT):
  WS-сообщения `{type:'relay.data', matchId, to/from, data: base64}`.
- `transport/multi.js` — `MultiTransport`: вещание/мультиплекс N транспортов (2v2/N игроков);
  `send()` уходит во все, входящие объединяются в один поток.

## Backend-сигналинг (WS `/ws`)
- `join` → назначение порта и пиров; повторный `join` с тем же `playerId` в идущем матче
  = **реконнект** (`joined{reconnected:true}`); партнёры получают `peer.left` / `peer.reconnected`.
- `room` содержит `players[{playerId,team,online}]` (presence).
- `signal` → пересылка SDP/ICE; `relay.data` → ретрансляция игровых байт;
  `pause`/`resume` → пауза матча (напр., вкладка в фоне); `start`/`finish` → жизненный цикл.

## UX соединения (frontend)
- `LobbyClient` авто-переподключает WS (backoff), `rejoinMatch()` возвращает в ту же комнату.
- `App.renegotiate()` пере-сопрягает транспорт с соперниками (`negotiateAll`), затем
  `session.rebindTransport`. Экраны: «Соединение…», «Переподключение…», «Ожидание соперника…»;
  HUD: режим (webrtc/relay), ping, rollbacks, **DESYNC**.

## Критерии
- Determinism: два инстанса с одинаковым входом → одинаковый `getFrameHash()` каждый кадр.
- Задержка 50–150 мс без рассинхронов дольше 1 кадра (сходятся, desyncCount==0).
- Потеря 10% пакетов с избыточностью → сходятся; без избыточности → desync детектится.
- Реконнект: `rebindTransport` продолжает матч; `peer.left`/`peer.reconnected` у партнёра.
