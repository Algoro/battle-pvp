// clock.js — порт Clock для домена: время инъектируется, в тестах подменяется fake-часами.
// Домен не импортирует node:* — только глобальное время через этот адаптер по умолчанию.
//
// Относительный путь: ./backend/domain/clock.js

/** Системные часы (миллисекунды epoch). */
export const systemClock = {
  now() {
    return Date.now();
  },
};

export default systemClock;
