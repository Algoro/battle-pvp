// resolve-ts.mjs — подключает resolve-hook для тестов, чтобы node резолвил TS-импорты
// без явного расширения. Запуск: node --import ./tests/resolve-ts.mjs --test tests/*.test.js
import { register } from "node:module";

register("./resolve-ts-hooks.mjs", import.meta.url);
