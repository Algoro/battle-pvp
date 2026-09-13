> 🌐 [English](en/render-meine-tank.md) · **Русский**

# Воксельный вид `meine-tank` (Minecraft-fidelity)

Отдельный `RenderDriver`, спроектированный ради максимального сходства с Minecraft и
использующий **выборочные** текстуры ресурспака Faithful 32x (не весь пак). Как и все
драйверы рендера — только отображение: читает read-only `SceneState`, не влияет на RAM,
кадры, rollback/desync, хэши и fingerprint.

## 1. Отличия от `mc-voxel`

- `mc-voxel` — процедурный «воксельный стиль»; `meine-tank` — реальные текстуры и
  MC-формы (полный куб, плита, cross-растения, billboard-предметы).
- Новый драйвер самодостаточен: общий только каркас (`three/bootstrap`, `camera-rig`,
  `camera-controls`, `coords`, `render/settings`, `render/types`), внутренности
  `mc-voxel` не импортируются.
- Добавлена настраиваемая фауна (пчёлы, попугаи, куры, летучие мыши, аллеи) на реальных
  entity-скинах.

## 2. Ассеты и лицензия

- Манифест: `frontend/src/render/drivers/meine-tank/textures/manifest.ts` — только нужные
  текстуры (блоки/предметы/частицы/окружение/entity, ~140 файлов).
- Извлечение: `node scripts/build-meine-tank-textures.mjs [pack.zip]` — пишет в
  `frontend/public/textures/meine-tank/` (исходный `.zip` в `.gitignore`).
- Лицензия Faithful v3: `frontend/public/textures/meine-tank/LICENSE.txt`, атрибуция в
  `THIRD_PARTY.md` и `frontend/public/THIRD_PARTY.txt`. Пак не монетизируется.

## 3. Архитектура

```
frontend/src/render/drivers/meine-tank/
  driver.ts            RenderDriver: mount/setScene/setOptions/resize/render/dispose
  options.ts           типы настроек (схема — в shared/renderers.ts)
  materials.ts         opaque / cutout / translucent / water (анимация + волна)
  textures/            manifest, loader, atlas, animated
  world/               blocks, mesher, field, decor
  models/              lib, tank, base, props; mobs/{boxuv, geometry, defs}
  fauna/               manager (спавн/поведение/анимации)
  fx/                  particles (sprite-атлас), sprites
  sky/                 sky (день/ночь, солнце/луна, звёзды, облака)
```

## 4. Мир

- Поле из `SceneState.field`: кирпич → `bricks` (повреждённый — `cracked_stone_bricks`
  с высотой по квадрантам), сталь → `iron_block`, вода → анимированная `water_still`,
  лёд → `blue_ice`, деревья → `oak_leaves` (cutout, биом-тинт), дорога → `dirt_path`,
  земля → `grass_block_top` + `grass_block_side`.
- Мешер: скрытие общих граней, smooth AO, тинт, отдельные пассы (opaque/cutout/
  translucent/water), опциональный контур.
- Темы стадии: `classic` / `desert` / `wasteland` (меняют землю и дорогу).
- Декор (`decor`): цветы, трава, валуны — сид от размеров поля, без коллизий.

## 5. Модели и эффекты

- Танки из block-текстур (корпус команды — `*_concrete`, гусеницы, башня, ствол,
  лампа-бонус, звёзды, каска, стан).
- Штаб — кварц/золото; состояния «укреплён»/«разрушен».
- Призы — плоские MC item-спрайты (в т.ч. анимированные часы `clock_*`), пули —
  `fire_charge`/`magma` со шлейфом.
- Частицы — спрайт-атлас (`explosion_*`, `big_smoke_*`, `flame`, `critical_hit`, …).

## 6. Внешний мир (граница и жизнь за ней)

Арена больше не «висит в пустоте»: опционально вокруг строится плато-граница и
обширный мир за ней (`world/outer.ts`, `world/noise.ts`, `world/biomes.ts`).

- **Граница** (`border`): `off` / `edge` (низкий каменный керб + обрыв-плато) /
  `wall` (стена 2.4 с зубчатым завершением).
- **Ландшафт** (`outerWorld`): `off` / `hills` (холмы) / `full` (реки, леса, вулканы).
  Высота — seeded fBm + ridge-шум, плато у арены сглаживается, к внешнему краю
  высота затухает.
- **Биомы** (`outerBiome`): `mixed` (по температуре/влажности), `plains`, `forest`,
  `desert`, `snow`, `volcanic`. Поверхность/борт/глубина — реальные блоки
  (`grass_block`, `sand`, `snow`, `basalt`, `blackstone`, …), у травы биом-тинт,
  снег на вершинах, камень выше 18.
- **Реки и вода** (`outerRivers`): каналы по ridge-шуму, вода на уровне −1
  (анимированная `water_still`).
- **Деревья** (`outerTrees`): seeded-посадка (дуб/берёза/ель/кактус) через
  `InstancedMesh`; ствол и несколько ярусов кроны.
- **Вулканы** (`outerVolcano`): 1–2 конуса (basalt/blackstone), кратер с лавой
  (анимированная `lava_still`, эмиссия) и полем `magma`.
- **Реки лавы**: из кратера вниз по склону трассируются русла (steepest descent,
  с расширением). Там, где лава касается воды, клетки воды становятся **обсидианом**.
  Деревья у лавы — **обугленные пни** (`basalt`). Всё считается **один раз** при
  перестройке мира (модуль `world/lava.ts`), пофреймовой симуляции нет.
- **Мобы за границей** (`outerMobs`): кролики и лисы спавнятся на рельефе, ходят по
  высоте (`heightAt`) и облетают/обегают край.
- **Драконы** (`outerDragons`): крупная MC-модель (`enderdragon/dragon`), полёт
  высоко над миром, взмахи крыльев, покачивание.
- **Радиус** (`outerRadius`, 24–96) ограничивает генерацию; мир строится один раз
  при смене настроек, меш — единые буферы по материалам.

## 7. Фауна

- Реальные entity-скины, модели по MC box-UV (`models/mobs/boxuv.ts`,
  `models/mobs/geometry.ts`).
- Виды: **bee, parrot, chicken, bat, allay** (арена) и **rabbit, fox, cow, pig,
  frog, axolotl, dragon** (внешний мир).
- Поведение: блуждание, облёт краёв, реакции на танки в режиме `lively`, ходьба по
  рельефу за границей.
- Полностью настраивается: `fauna` (off/ambient/lively), `faunaDensity`, группы
  (`faunaBees`, `faunaBirds`, `faunaBats`, `faunaAllay`, `faunaSmall`, `faunaLivestock`,
  `faunaAquatic`), `faunaTime`, тени.

## 8. Графика и настройки

Картинка идёт через **HDR-тонмаппинг ACES** (`renderer.toneMapping`) с регулируемой
**экспозицией**, а поверх albedo процедурно строятся **normal-map** (Sobel по яркости) —
блоки и кирпич получают рельеф без внешнего PBR-пака. Материалы — PBR
(`MeshStandardMaterial`: карта + normal-map, roughness/metalness), вода — с волновым
вершинным шейдером.

Схема настроек — в `shared/renderers.ts` (авто-UI): камера и FOV, время суток,
освещение, AO, тени, туман, облака, вода, декор, тема, частицы, размер текстур (32/16),
контур, группа «Графика» (экспозиция, рельеф), блок «Внешний мир» и блок фауны. Пресеты:
`vanilla`, `cinematic`, `lively`, `performance`, `retro16`. Хранятся локально
(`bc_renderOptions`), в лобби не уходят.

Дальнейшие шаги по графике (в работе): safe bloom на эмиссиве, SSAO, отражения воды,
физическое небо и объёмные облака — отдельными опциями.

## 9. Тесты

- `frontend/tests/meine-tank.test.ts` — манифест, маппинг тайлов/тем, настройки,
  `faunaGroups`, частицы, шум (детерминизм/диапазон), выбор биома, снежные вершины.
- `qa/tests/renderers.test.ts` — согласованность манифеста и реестра.
- Живой визуальный прогон — Playwright (`qa/e2e/meine-tank.spec.ts`).
