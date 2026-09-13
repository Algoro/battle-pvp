// ram-addr.js — re-export of addresses from the single contract (see ../rom-contract.js).
// Kept for backward compatibility of tests/sim; new modules should import
// RAM/AI_READ_RANGES directly from rom-contract.js.
export { RAM, FIELD_SIZE, AI_READ_RANGES } from "../rom-contract.ts";
