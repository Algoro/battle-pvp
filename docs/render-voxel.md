# Воксельный вид (`mc-voxel`)

Драйвер рендерера «песочный/воксельный» в духе Minecraft: кубические блоки, пиксельные
текстуры, небо и день/ночь, вода, частицы, «живой мир» (птицы, блочные облака, мышки) и
камеры «орбита / от третьего лица / из глаз». Ниже — дизайн и технические детали.

## 1. Цель

Дать рендереру «песочный/воксельный» вид в духе Minecraft: кубические блоки, пиксельные
16×16 текстуры, мягкое освещение с ambient occlusion, небо/облака/туман, анимированная
вода, частицы разрушения, день/ночь; при этом — **максимально настраиваемый** (пак
настроек и пресеты) и **подробный** (мелкие детали: текстуры, частицы, тени, эффекты).

Принципы (не нарушать):
- new `RenderDriver` (не патч): только чтение `SceneState`, никакой записи в RAM, никаких
  `stepFrame/saveState/loadState`; выбор локальный (per-client), не уходит в `LobbySettings`.
- three.js (уже зависимость), процедурные текстуры; **не** используем ассеты/названия
  Mojang. Это «воксельный look», а не Minecraft-контент. Текстовые паки — пользовательские.
- Время/анимации — только от `dtMs`/`scene.frame`, никаких `Date.now` (детерминизм
  отображения не влияет на игру, но правило единое).

## 2. Место в архитектуре

- Новый драйвер `mc-voxel` в `shared/renderers.ts` (`kind:"driver"`,
  `provides:["three","camera","overlay-dom","voxel"]`), совместим с расширениями
  `particles`/`minimap`.
- Существующий `topdown-3d` остаётся как «чистый» стиль; `mc-voxel` — второй 3D-драйвер.
- Предпросмотр на старте — через `RenderPicker`/`RendererPreview` (уже есть): для `mc-voxel`
  показывается живая воксельная демо-сцена с медленным облётом.
- Настройки хранятся локально (`bc_renderDriver`, `bc_renderExtensions` +
  новый `bc_renderOptions` JSON) и применяются на старте и в бою.

Минимальный общий рефакторинг перед драйвером (фаза 0): вынести из `topdown-3d` каркас
three-сцены (renderer/scene/camera/resize/lights) в `frontend/src/render/three/bootstrap.ts`,
чтобы `mc-voxel` и `topdown-3d` делили его без дублирования. `camera-rig.ts`,
`camera-controls.ts`, `scene-state.ts`, `coords.ts` уже общие.

```
frontend/src/render/
  three/
    bootstrap.ts          // WebGLRenderer + Scene + PerspectiveCamera + resize + dispose
  drivers/mc-voxel/
    driver.ts             // RenderDriver: mount/setScene/resize/render/dispose
    options.ts            // схема настроек, пресеты, валидация, сериализация
    atlas.ts              // сборка текстурного атласа
    world/
      blocks.ts           // Domain tile -> BlockId (+ UV в атласе, флаги solid/cutout/emissive)
      mesher.ts           // greedy meshing + culling + AO + vertex colors
      field.ts            // построение поля из SceneState.field, диффы, dirty-chunks
    models/
      tank.ts             // воксельный танк (классы/звёзды/каска/стан/гусеницы)
      base.ts             // орёл — блочная скульптура + состояния
      props.ts            // пули, призы (итемы), точки pacman
    sky/
      sky.ts              // купол градиента, солнце/луна, звёзды, облака, вода
    fx/
      particles.ts        // разрушение кирпича, искры, TNT-взрыв, пыль, muzzle flash
    ambient.ts            // птицы/мышки/облака («живой мир»)
    materials.ts          // opaque / cutout / translucent / emissive материалы
```

## 3. Визуальный язык

- **Геометрия**: только кубы/прямоугольные призмы, жёсткие грани, без сглаживания;
  масштаб блока поля — 1 юнит (8 px ≈ 16×16 текстура).
- **Текстуры**: процедурный пиксель-арт 16×16 (опция 32×32), `NearestFilter`, без
  сглаживания; атлас для минимума draw-call'ов. Палитра ближе к NES/BC, но «блочная».
- **Освещение**: Hemisphere (sky/ground) + Directional «солнце»; ambient occlusion,
  запечённая в vertex colors (smooth lighting как в MC); опционально тени (PCFSoft).
- **Небо**: купол-градиент, солнце/луна (Quad'ы), слоистые плоские облака (медленный
  дрейф), звёзды (Points) ночью; туман в тон неба; режимы `noon/day/sunset/night/cycle`
  (`cycle` — только визуально, от `scene.frame`).
- **Вода**: отдельный translucent-слой, 2 слоя анимированного UV + лёгкая волна; опция
  «прозрачность/глубина».
- **Эффекты**: частицы цвета разрушаемого блока (кирпич/сталь/лёд), искры, TNT-взрыв,
  пыль из-под гусениц, вспышка выстрела (point light на 1 кадр), блик/парение призов,
  лёгкое колыхание листвы (vertex shader), всплеск на воде.
- **Подсветка/очертание**: чёрный outline блоков в стиле MC (опция), подсветка клетки
  под курсором камеры (декоративно, если включено).

## 4. Отображение домена Battle City → блоки

Тайлы буфера коллизий (`@core/domain` `TILE`) → блоки:

| Домен | Значения | Блок | Особенности |
|---|---|---|---|
| Пусто | `0x00` | air | не рендерим |
| Кирпич | `0x01..0x0f`, `0x13/0x14` | bricks | **по квадрантам** (4 под-куба, как `brickHit`): целый/повреждённый; трещины по остатку |
| Сталь | `0x10/0x11` | iron_block / smooth_stone | металл, блики, искры при попадании |
| Вода | `0x12` | water | анимированная, translucent |
| Лёд | `0x21` | packed_ice / blue_ice | полупрозрачный, скользкая грань |
| Деревья | `0x22` | oak_leaves | cutout/alpha, колыхание, скрывает танки (рисуем поверх) |
| Дорога | `0x20..0x7f` (кроме воды/льда/дерева) | dirt_path / gravel | декоративная земля, без коллизии |
| Орёл | `0xc8..0xcb` | base-структура | см. ниже |
| Рамка поля | стальная кайма вне bounds | cobblestone/bedrock frame | граница арены |

**Орёл/штаб**: блочная скульптура на постаменте из кварца/каменного кирпича; состояния:
цел (золотые блоки/«nether star» в клюве), разрушен (обломки/cracked), укреплён (клетка
из iron bars/obsidian-оболочка). Позиция/состояние — из `scene.eagle`.

**Танки (`models/tank.ts`)**: воксельные модели из кубов:
- гусеницы — «iron/gray» блоки с анимированным смещением текстуры траков;
- корпус — шерсть команды (DEF золотая/жёлтая, ATT бело-серая), armored — железная броня
  + накладные плиты, fast — удлинённый корпус;
- башня + ствол (кубический поршень/hopper-текстура);
- мигающий бонус-враг — «sea lantern/redstone lamp» (эмиссия-пульс);
- звёзды DEF — маленькие «gold ingot/nether star» на башне; каска — glass-купол;
  стан — парящие частицы-«искры»; лёд — лёгкий наклон/скольжение.
- Поворот по `dir`, гусеницы анимируются по `moving`.

**Пули** — маленький эмиссивный куб («fire charge/magma») + trail-частицы.
**Призы** — парящие вращающиеся «итемы» (blocky): каска→iron helmet-палитра,
часы→clock, лопата→shovel, звезда→nether star, граната→TNT, жизнь→heart/golden apple,
пистолет→crossbow. Bob+spin+glint.
**Pacman-точки** — «glowstone dust»/XP-орбы (Points/InstancedMesh).

Позиции/центрирование — уже выверенные `coords.ts` (танк: RAM=центр; приз 16×16 и пуля
8×8: RAM=top-left → `spriteCenter`).

## 5. Технический дизайн (three.js)

### 5.1 Атлас текстур
- 16×16 тайлы пакуются в атлас (напр. 8×8 тайлов = 128×128) → одна текстура, 1 материал
  на проход (opaque/cutout/water/emissive), `NearestFilter`, `generateMipmaps:false`.
- Генераторы пиксель-арта на `canvas`: кирпич (смещённые ряды + шов), камень/брусчатка
  (шум), железо (рамка+заклёпки), лёд (грани), бревно (годичные кольца), листва
  (шум+alpha), земля/гравий, шерсть (тинт команды), стекло, TNT, «звезда» и т.д.
- **Текстур-паки**: настройка `texturePack: "builtin" | "<url>"` (PNG-атлас или manifest
  по именам блоков). Сторонние паки не бандлим; пользователь подключает свои.

### 5.2 Чанки, greedy meshing, AO
- Поле 26×26×H разбивается на чанки 8×8 (по высоте 1 слой блоков, H=1 для стен; танки —
  отдельные модели). Пересборка — только грязных чанков (дифф `SceneState.field`).
- `mesher.ts`: greedy meshing одинаковых граней (объединение в квады) + отсечение
  невидимых граней между solid-блоками; грани с alpha/water — отдельные проходы.
- `AO`: для каждого угла грани считаем 3 соседа (классическая MC-формула) → vertex color
  (затенение); режимы `off/simple/smooth`.

### 5.3 Материалы и свет
- `materials.ts`: opaque (MeshLambert/Standard + атлас), cutout (leaves, alphaTest),
  translucent (water/ice, depthWrite:false), emissive (лава/лампа/пуля призы).
- `lighting.ts`: HemisphereLight + DirectionalLight (солнце), опционально
  `shadowMap: PCFSoft`, shadow-camera по bounds поля; день/ночь меняет цвет/направление.

### 5.4 Небо и атмосфера (`sky/`)
- Sky dome `BackSide` с вертикальным градиентом (top/horizon), солнце/луна —
  квады с billboard, звёзды — Points, облака — несколько плоских слоёв с медленным
  drift. Туман (`FogExp2`/linear) согласован с горизонтом и `renderDistance`.
- Режимы времени: `noon/day/sunset/night/cycle`; `cycle` анимируется от времени работы
  рендера (визуально), не затрагивая игру.

### 5.5 Камера
- Наследуем общий `CameraRig` (yaw/pitch/roll/zoom/pan + tilt поля). Фактические MC-опции:
  `cameraMode: orbit | third | first` (игра управляется WASD-танком, камера — только вид),
  `cameraFollow` (плавно доворачивать за танком), `fov` (50..95).
  `collision`/`headBob`/`smooth` из исходного дизайна не реализованы.

### 5.6 Эффекты (`fx/`)
- Пул частиц (Points/InstancedMesh) на события из `SceneState` (взрыв танка, попадание
  в кирпич/сталь, выстрел, респавн). Цвета — из текстуры блока. Плотность — настройка.
- Мгновенный point light на выстрел/взрыв (ограниченно, чтобы не бить по перфу).

## 6. Настройки и пресеты

`McVoxelOptions` (JSON в `bc_renderOptions`), с валидацией и дефолтами:

```
cameraMode: "orbit" | "third" | "first"
cameraFollow: boolean
time: "noon" | "day" | "sunset" | "night" | "cycle"
lighting: "mc" | "flat"
ao: "off" | "simple" | "smooth"      # не ambientOcclusion
shadows: "off" | "soft"
fog: 0..1
clouds: "off" | "flat" | "voxel"     # не volumetric
birds: boolean
mice: boolean
water: "off" | "simple" | "animated"
particles: 0..2
textureSize: 16 | 32
fov: 50..95
outline: boolean
vignette: boolean                     # пост-обработка: только виньетка
cloudsDrift: boolean
```

Схема настроек генерирует UI автоматически (`shared/renderers.ts`, `settings`/пресеты).

Пресеты: **Classic Voxel** (noon, mc-свет, AO smooth, тени off), **Survival** (cycle,
тени soft, туман, частицы 2), **Cinematic** (sunset, bloom, grade mc, тени soft),
**Performance** (flat свет, AO off, тени off, renderDistance малый, частицы 0),
**Retro 16** (textureSize16, outline on, без post).

UI: расширение панели выбора вида (`RenderPicker` до старта + `RenderSettings` в бою):
секции «Стиль», «Свет/тени», «Небо/туман», «Вода/частицы», «Камера», «Пост-обработка»,
выбор пресета и «Сброс». Предпросмотр обновляется живьём при смене настроек.

## 7. Производительность

- Атлас + greedy meshing + чанки → единицы draw-call'ов на поле; dirty-пересборка.
- Инстансинг для частиц/точек; пулы объектов; отсечение по фрустуму (встроенное).
- Тени/bloom/volumetric clouds — только по настройке; тени — низкое разрешение.
- Бюджет: **60 fps** при 8 танках на средней GPU; поле ≤ ~5k треугольников (greedy),
  ≤ ~100 draw-call'ов, частицы ≤ 2k.
- Пресет «Performance» как страховка для слабых/мобильных.

## 8. Тесты и enforcement

- Чистые модули: `blocks.ts` (tile→block таблица), `options.ts` (пресеты/валидация),
  `mesher.ts` (greedy-объединение, кол-во квадов, значения AO), `atlas.ts` (раскладка UV).
- Контракт: `mc-voxel` в `shared/renderers.ts` + `assertRenderersConsistent`
  (`qa/tests/renderers.test.ts`); совместимость расширений по capabilities.
- Архитектура (уже есть): рендер не импортирует `pvp.ts`, не вызывает
  `stepFrame/saveState/loadState`, ядро/сеть/бэкенд не тянут слой рендера.
- Инвариант «только отображение»: `readScene` чистый (тест есть); смена драйвера/настроек
  не влияет на хэши/save/load.
- Опционально: Playwright-скриншот предпросмотра (visual smoke), не в обязательный CI.

## 9. Не входит в объём

- Реальные Minecraft-ассеты/мобы/крафт; звук (можно отдельной фазой).
- Изменение игровой логики/правил; любые записи в RAM.
