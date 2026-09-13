// wrap-borders.ts — ROM-дескриптор фичи «открытые края».
//
// ROM-рутина `sub_D7CC_create_default_stage_field` (bank_FF.asm:3779) заливает всё
// поле (32×32) тайлом $11 (сталь) и лишь потом чистит внутренние 26×26. Из-за этого
// по краям уровня остаётся неразрушимая серая рамка (и в коллизии, и в nametable).
//
// Патч — ровно одна запись: константу заливки $11 меняем на $00, поэтому рамка
// исчезает и как препятствие, и визуально; внутренние блоки карты остаются. Перенос
// объектов через образовавшийся шов делает JS-рантайм `features/wrap-borders.ts`.
//
// Относительный путь: ./emulator-core/patching/patches/wrap-borders.ts

export const wrapBorders = {
  id: "wrap-borders",
  version: 1,
  description: "Открытые края: без неразрушимой рамки уровня (телепорт по краям — в рантайме)",
  symbols: {},
  free: [],
  routines: [],
  writes: [
    {
      id: "stage-fill-empty",
      at: 0xd7ce, // LDA #$11 внутри sub_D7CC_create_default_stage_field
      len: 2,
      expect: "A9 11",
      bytes: [0xa9, 0x00],
    },
  ],
};

export default wrapBorders;
