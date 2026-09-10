// ram-addr.js — ре-экспорт адресов из единого контракта (см. ../rom-contract.js).
// Оставлено для обратной совместимости тестов/сима; новые модули должны импортировать
// RAM/AI_READ_RANGES напрямую из rom-contract.js.
export { RAM, FIELD_SIZE, AI_READ_RANGES } from "../rom-contract.js";
