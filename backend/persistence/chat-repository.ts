// chat-repository.ts — SQLite-адаптер порта ChatRepository (домен о SQLite не знает).
// Оборачивает Store, приводя имена методов к контракту порта (insert/list).
//
// Относительный путь: ./backend/persistence/chat-repository.ts
import type { ChatMessage, ChatRepository } from "../ports.ts";
import type { Store } from "./store.ts";

export class SqliteChatRepository implements ChatRepository {
  store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  insert(message: ChatMessage): void {
    this.store.insertChat(message);
  }

  list(scope: string, id: string | null, limit: number): ChatMessage[] {
    return this.store.listChat(scope, id ?? null, limit);
  }
}

export default SqliteChatRepository;
