// clock.ts — порт Clock для домена: время инъектируется, в тестах подменяется fake-часами.
// Единственное определение контракта — в ../ports.ts (чтобы не было двух источников истины).
//
// Относительный путь: ./backend/domain/clock.ts
import type { Clock } from "../ports.ts";

export type { Clock };

/** Системные часы (миллисекунды epoch). */
export const systemClock: Clock = {
  now() {
    return Date.now();
  },
};

export default systemClock;
