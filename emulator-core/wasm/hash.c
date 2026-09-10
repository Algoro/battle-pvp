/*
 * hash.c — детерминированная WASM-утилита для emulator-core.
 * Hot-path функции, выносимые из JS в WASM (для скорости и единообразия):
 *   - fnv1a32: детерминированный хэш состояния (используется getFrameHash).
 *
 * Полный перенос CPU/PPU hot-path в WASM — отдельная миграция (см. agent report);
 * данный модуль служит рабочим доказательством toolchain (emsdk) и точкой
 * интеграции: JS-ядро остаётся авторитетным, но может вызывать WASM-функции.
 */
#include <stdint.h>
#include <stddef.h>

// FNV-1a 32-bit — идентичен JS-реализации в pvp.js (детерминизм).
uint32_t fnv1a32(const uint8_t* buf, size_t len) {
    uint32_t h = 0x811c9dc5u;
    for (size_t i = 0; i < len; i++) {
        h ^= buf[i];
        h *= 0x01000193u;
    }
    return h;
}

// Сумма байтов (простая детерминированная сверка; для тестов/дебага).
uint32_t checksum_sum(const uint8_t* buf, size_t len) {
    uint32_t s = 0;
    for (size_t i = 0; i < len; i++) s += buf[i];
    return s;
}
