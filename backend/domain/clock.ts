// clock.ts — Clock port for the domain: time is injected, replaced by fake clocks in tests.
// The single contract definition lives in ../ports.ts (so there is no second source of truth).
//
// Relative path: ./backend/domain/clock.ts
import type { Clock } from "../ports.ts";

export type { Clock };

/** System clock (epoch milliseconds). */
export const systemClock: Clock = {
  now() {
    return Date.now();
  },
};

export default systemClock;
