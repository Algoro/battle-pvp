// transport.js — интерфейс транспорта netcode.
//
// Контракт:
//   send(buf: Uint8Array)      — отправить байты сопернику
//   onMessage(cb)               — зарегистрировать обработчик входящих байтов
//
// Реализации: local (эмуляция задержки/потерь для тестов), webrtc (DataChannel),
// relay (через backend-сигналинг). Любая из них может быть вставлена в RollbackSession.
export {};
