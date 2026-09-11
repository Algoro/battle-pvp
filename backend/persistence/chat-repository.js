// chat-repository.js — SQLite-адаптер порта ChatRepository (домен о SQLite не знает).
// Оборачивает Store, приводя имена методов к контракту порта (insert/list).
//
// Относительный путь: ./backend/persistence/chat-repository.js

/** @implements {import('../ports.js').ChatRepository} */
export class SqliteChatRepository {
  /** @param {import('./store.js').Store} store */
  constructor(store) {
    this.store = store;
  }

  insert(message) {
    this.store.insertChat(message);
  }

  list(scope, id, limit) {
    return this.store.listChat(scope, id ?? null, limit);
  }
}

export default SqliteChatRepository;
