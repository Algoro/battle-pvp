# tower-defense-plan.md — режим Tower Defence (план реализации)

> Статус: **реализовано (фазы 0–6, кроме HP базы)**. Сделано в фазе 6: башни попадают
> в `SceneState.towers` и рисуются в `topdown-3d`/`mc-voxel` (модель неподвижного
> DEF-танка, звёзды = уровень), типы врагов выдаются из очереди волны (`TD_WAVES[].types`).
> Не сделано: HP базы с ремонтом (база по-прежнему выдерживает одно попадание).
> 3D-рендер башен и типы врагов проверены живым прогоном (Playwright, оба драйвера).
>
> Согласованные рамки — ответы заказчика: соло против ИИ; in-game редактор расстановки
> (адаптация `StagePreview`); враги идут к базе и стреляют по башням; очки за убийства →
> покупка башен.
>
> Фактическая структура: общие данные/геометрия — `shared/tower-defence.ts` (без
> импортов); ядро — `patching/patches/tower-defence.ts` + `features/tower-defence.ts`
> (`td-levels.ts` ре-экспортит геометрию; урон вынесен в `features/enemy-damage.ts`);
> фронт — `components/TowerDefenceSetup.tsx`, `TowerDefenceView.tsx`,
> `TowerPlacementEditor.tsx`; вход — кнопка «Tower Defence» в `LobbyBrowser`.
> Тесты: `emulator-core/tests/{tower-defence,tower-defence-runtime,td-levels}.test.ts`,
> `frontend/tests/tower-defence.test.ts`, правила в `qa/tests/architecture.test.ts`.

## 1. Цель и рамки

Превратить Battle City в **tower defence для одного игрока (DEF)**:

1. Есть специально устроенные уровни — коридоры/дорожки от точек спавна ATT к базе.
2. В начале раунда и между волнами игрок **покупает и расставляет неподвижные
   танки-башни** за очки, заработанные уничтожением врагов.
3. Волны ИИ-атакующих идут по коридорам к базе, стреляют по башням и стенам.
4. Победа — пережить все волны; поражение — уничтожена база (орёл) или кончились
   жизни (если включён мобильный танк).

Рамки (жёстко):

- **Только соло.** Сеть/rollback/spectator в TD не участвуют. TD-рантайм должен
  быть детерминированным (без `Date.now`/`Math.random`), но не обязан быть
  rollback-совместимым: `ctx.state` допустим для игрового состояния TD.
- **Не ломать базу.** Fingerprint базы (`94cb0636`), golden-тесты, netcode и
  golden-хэши не меняются: TD живёт только как опциональная фича (`tower-defence`).
- **jsnes/ROM неизменяемы.** Только in-memory патчи PRG + подклассы.

## 2. Игровой цикл (state machine)

```
LOBBY
  └─ “Tower Defence” → TD Setup (карта, сложность, мобильный танк вкл/выкл)
        └─ startSolo(team:"DEF", stage:tdMap, features:["tower-defence"], tdOptions)
              │
              ▼
        TD BUILD (эмулятор не шагает; редактор расстановки)
              │  «В бой»
              ▼
        TD WAVE (шаг эмулятора 60 Гц, рантайм рулит волной)
              │  враги кончились / база пала
              ▼
        TD INTERMISSION (итоги волны, начисление очков/бонус)
              │
              ├─ есть следующая волна → TD BUILD
              └─ волн больше нет     → TD VICTORY
                                     база пала/жизни 0 → TD DEFEAT
```

Режим TD-фазы — байт `RAM.TD_STATE` (см. §5), чтобы ROM и фронт понимали фазу.
Точки, башни, снаряды, волны — в `ctx.state` рантайма (соло, rollback не нужен),
наружу отдаются через новый API эмулятора (§7).

## 3. Слой 1 — общие данные `shared/tower-defence.ts`

Новый модуль без импортов (как `shared/features.ts` и `shared/renderers.ts`) —
единый источник для UI, рантайма и тестов.

```ts
export interface TowerTypeInfo {
  id: string;
  title: string;
  description: string;
  cost: number;
  damage: number;
  range: number;       // в клетках поля (тайлы 8px)
  fireInterval: number;// кадров между выстрелами
  projectileSpeed: number; // px/кадр
  upgradeCost: number; // стоимость апгрейда
}
export const TOWER_TYPES: TowerTypeInfo[] = [
  { id: "gun",    ... }, // 1 ствол, средняя скорострельность
  { id: "rapid",  ... }, // короткая дистанция, быстро
  { id: "sniper", ... }, // длинная дистанция, пробивает броню
  { id: "cannon", ... }, // медленный, высокий урон
];
export const TOWER_IDS = TOWER_TYPES.map(t => t.id);
export const TD_WAVES: WaveDef[] = [ { count, types, interval, reward }, ... ];
export const TD_POINTS_PER_KILL: Record<number, number>; // тип ROM-танка → очки
export const TD_LEVELS: { id: string; title: string }[];  // метаданные карт
```

Здесь же — общая геометрия: `TD_GRID = 13`, `TD_CELL = 16`, конверсии
`cellToBlock`, `blockToCell`, `isBuildableCell`, `TD_START_POINTS`. UI и рантайм
используют одни и те же функции (тестируемо, без дублирования).

## 4. Слой 2 — «конструктор уровней» и ROM-патч

### 4.1 Адаптация конструктора стадий

Сейчас единственный «конструктор уровней» — `features/pacman-maze.ts`
(DFS-лабиринт → 91-байтный формат стадии). Адаптируем его в **TD-конструктор**:

- Новый `emulator-core/features/td-levels.ts`:
  - ASCII-карты 13×13 (символы: `#` бетон, `.` пол, `S` спавн ATT, `E` база,
    `*` строимая клетка, `x` запрет строительства) — читаемый и правится вручную;
  - `buildTdStageBytes(ascii): Uint8Array` — та же упаковка, что в `pacman-maze`
    (14 нибблов/строку, stride 7 = 91, чётный индекс — старший ниббл);
  - `tdSpawnBlocks(map)`, `tdBaseBlocks(map)`, `tdBuildableCells(map)` — экспорт
    для редактора и рантайма;
  - детерминированный LCG, если карту нужно генерировать (без `Math.random`).
- 3 стартовых карты: `loop` (кольцо), `snake` (змейка), `spiral` (спираль) —
  разные по длине дорожек и числу строимых клеток.

Проверка: байты карты читаются `readStage()` и совпадают с ASCII (round-trip тест).

### 4.2 ROM-дескриптор `patches/tower-defence.ts`

По образцу `patches/pacman.ts`:

- `writes` для стадий 1..3 (`tbl_F07A`, по 91 байту) — карты TD.
- Хук завершения стадии `sub_C728_check_condition_for_stage_ending` ($C728):
  патчим вход, чтобы в TD-режиме стадия **не завершалась** по `enemies_left==0`
  во время BUILD/INTERMISSION (см. §5). Варианты:
  - (основной) JMP на свободную зону $EF75+ (после рутин PvP) → если
    `TD_STATE != WAVE`, вернуть Z=1 («стадия не окончена»); иначе оригинал;
  - (запасной) держать в BUILD `enemies_left = 1` и не давать ему упасть до
    WAVE, а в WAVE перехватывать переход 0→1 в рантайме.
  Выбор подтверждаем spike-тестом в фазе 0.
- База и спавны на TD-картах: орёл в центре низа, точки спавна ATT по краям —
  как в оригинальном формате (проверяем `field`-коллизии тестом).

### 4.3 Регистрация

- `shared/features.ts`: добавить `{ id: "tower-defence", hidden: true, ... }`
  (`hidden` — не показывать в общем `FeaturePicker`; TD включается отдельным
  экраном). Расширить `FeatureInfo` полем `hidden?: boolean`.
- `patching/registry.ts`: `registerFeature({ id:"tower-defence", patch, runtime })`.
- `assertFeaturesConsistent()` сам сверит манифест и реестр.
- Backend: `SUPPORTED_FEATURES` получит id автоматически, но `FeaturePicker`
  фильтрует `hidden` — в лобби чекбокс не появится.

## 5. RAM-контракт TD

Свободной RAM почти нет: `0x01DB–0x01FF` (37 байт) уже заняты фичами, а
`0x0150–0x017F` — стек, `0x0180–0x01DA` — `ram_ppu_buffer`, `0x0200–0x02FF` — OAM.
Поэтому **авторитетное состояние TD держим в `ctx.state`** (соло), а в RAM
добавляем только то, что нужно ROM-хуку и фронту:

| Адрес | Имя | Назначение |
|---|---|---|
| `0x01FF` | `TD_STATE` | 0=off, 1=BUILD, 2=WAVE, 3=INTERMISSION, 4=VICTORY, 5=DEFEAT |
| `0xFC` (план) | `TD_MAP` | выбранная карта (можно передать через startup, не RAM) |

Если для ROM-хука потребуется больше байт — переносим/ужимаем блок фич
(`0x01DB+`), т.к. TD несовместим одновременно с pacman/enemy-prizes в одном
матче; адреса фиксируем в `rom-contract.ts` и покрываем тестом на пересечения.

Точки, список башен (клетка, тип, hp, кулдаун, направление), снаряды (x, y, dir,
owner, ttl), номер волны — в `ctx.state`. `onLoadState` сбрасывает производное
состояние (в TD `saveState/loadState` не используются; ограничение
задокументировать).

## 6. Слой 3 — рантайм `features/tower-defence.ts`

Один `FeatureRuntime`, разбитый на модули (как `pacman-dots` + `pacman-maze`):

- `features/tower-defence.ts` — диспетчер хуков и состояние.
- `features/towers.ts` — список башен: постановка/продажа/апгрейд, HP.
- `features/tower-targeting.ts` — выбор цели: ближайший враг в линии (та же
  строка/столбец, поле между ними свободно), поворот «дула» к цели.
- `features/tower-projectiles.ts` — снаряды: движение, столкновения
  (снаряд↔враг, снаряд↔стена), попадание во врага.
- `features/tower-damage.ts` — общий `damageEnemy()` (броня/носитель приза/
  смерть), **вынести из `friendly-fire-att.ts`** и переиспользовать в обоих
  рантаймах (единый источник, чтобы правила совпадали).
- `features/tower-waves.ts` — волны, спавн, начисление очков и переходы фаз.

Хуки:

- `init`: инициализировать `TD_STATE=BUILD`, точки, пустые башни/снаряды; выключить
  спавн врагов (`enemies_left`, `SPAWN_TIMER`) до старта волны.
- `preFrame`: запомнить флаги танков (детект смерти врага), тик кулдаунов.
- `postFrame`:
  - начисление очков за переход врага `alive→взрыв` (по типу `TANK_TYPE`);
  - урон по башням от вражеских пуль (радиус, как в `sub_E70C`), гибель башни;
  - в WAVE: контроль волны (`enemies_left`, `SPAWN_TIMER/INTERVAL`,
    `TANK_TYPE` из `WaveDef`); когда все враги волны убиты → INTERMISSION;
  - в INTERMISSION: пауза, затем BUILD или VICTORY; при `GAME_OVER==0` → DEFEAT.
- `render`: отрисовка башен/снарядов — **в BG nametable** (надёжный путь,
  как `pacman-dots`/`player-names`), 2×2 тайла для башни (танк) и 1 тайл для
  снаряда. OAM — опционально позже (railgun доказал трюк со свободными слотами).
- `onLoadState`: сброс производного.

Взаимодействие с ядром (`pvp.ts`):

- `setTowerDefence(options | null)` — включить режим и опции (карта, сложность,
  мобильный танк, стартовые очки).
- `getTowerDefence()` — снимок для UI: фаза, очки, волна/всего волн, список
  башен, стоимость/апгрейд, HP базы.
- `placeTower(cell, type)`, `sellTower(cell)`, `upgradeTower(cell)`,
  `startWave()` — вызываются фронтом в BUILD; валидируются в рантайме.
- `canvas`-редактор и рантайм не дублируют правила: расчёт стоимости/валидности
  — в `shared/tower-defence.ts`.

## 7. Слой 4 — фронтенд

### 7.1 Экран настройки `components/TowerDefenceSetup.tsx`

- Выбор карты (превью через `StagePreview`), сложности, вкл/выкл мобильного
  танка, стартовых очков (по сложности).
- Кнопка «Начать» → `match.controller.startTowerDefence(opts)`.
- Точка входа — кнопка в `LobbyBrowser` рядом с «Соло».

### 7.2 Редактор расстановки `components/TowerPlacementEditor.tsx`

Адаптация `StagePreview`:

- Рисует стадию (ROM-тайлы/палитры) + сетку 13×13 + подсветку строимости.
- Мышь/тач: клик по клетке — поставить выбранный тип; повторный/правый — снять;
  клавиатура — перемещение курсора, `Z`/`Enter` — поставить, `X` — продать,
  `U` — апгрейд.
- Панель: доступные типы (стоимость/урон/радиус), текущие очки, волна, кнопка
  «В бой», итоги прошедшей волны.
- Компонент ничего не знает о netcode/ядрах — работает через пропсы/колбэки
  TD-контроллера (правила зависимостей сохраняются).

### 7.3 TD-контроллер `application/td-controller.ts` (+ `use-tower-defence.ts`)

- Машина фаз BUILD/WAVE/INTERMISSION/RESULT поверх `MatchController`/эмулятора.
- В BUILD цикл эмулятора **не шагает**; в WAVE — обычный rAF-цикл `stepFrame`.
- Читает `emu.getTowerDefence()` для HUD; пишет через `placeTower`/`startWave`.
- Определяет победу/поражение по `TD_STATE` (а не по `determineWinner`).

### 7.4 Интеграция

- `App.tsx`: новый `Screen` `{ name:"td-setup" }` и `{ name:"td"; ... }`;
  `GameCanvas` получает `td`-пропс и в TD-режиме работает через TD-контроллер.
- `GameUi.tsx`: расширенный HUD (очки, волна `n/N`, башни, жизни, HP базы).
- `engine/emulator.ts`: прокси-методы TD API; `ports.ts` — типы.
- `styles.css`: стили редактора/HUD.

## 8. Экономика и волны

- **Очки за убийство** (по типу ROM-танка, как в оригинальном счёте):
  базовый 100, скорострельный 200, быстрый 300, бронированный 400 (+ бонус за
  волну). `TD_POINTS_PER_KILL` — в `shared`.
- **Стартовый капитал** зависит от сложности; хватает на 2–3 башни.
- **Стоимость/апгрейд/продажа** — в `TOWER_TYPES`; продажа — 60% вложенного.
- **Башни живут между волнами**, покупка/перестановка — в BUILD.
  (Продажа и перенос — по желанию, в фазе 5.)
- **Волны**: `TD_WAVES` — массив `{ count, types[], interval, reward }`;
  сложность масштабирует count/типы. Спавн через `enemies_left`/`SPAWN_TIMER`.
- **База**: классическая (одно попадание) — поражение. При желании в фазе 5:
  HP базы с ремонтом между волнами (перехват `sub_E2A9_HQ_handler`).
- **Жизни**: если мобильный танк включён — стандартные 3, поражение при 0.

## 9. Победа/поражение

- Рантайм пишет `TD_STATE = VICTORY/DEFEAT`; фронт показывает результат.
- Условия: VICTORY — пройдены все волны; DEFEAT — `GAME_OVER==0` (орёл),
  либо жизни DEF исчерпаны (если танк включён).
- `determineWinner` не трогаем (используется в netcode/пакмане); в TD-ветке
  `GameCanvas` результат определяется только по `TD_STATE`.

## 10. Фазы реализации

| Фаза | Содержание | Критерий готовности |
|---|---|---|
| 0 | Манифест `hidden`, реестр, пустой рантайм + скелет патча; spike перехвата `sub_C728`; `TD_STATE` в `rom-contract` | `ci.sh` зелёный, golden не изменён, фича включается/выключается |
| 1 | `td-levels.ts`: ASCII→91 байт, 3 карты, round-trip тест; патч пишет стадии 1..3; превью карт | `readStage()` совпадает с ASCII, спавны/база корректны |
| 2 | Ядро башен: постановка/цель/снаряды/урон; `tower-damage.ts` вынесен; враг→башня; BG-рендер | unit: таргетинг, LOS, попадание, броня, гибель башни |
| 3 | Волны, очки, BUILD/WAVE/INTERMISSION, победа/поражение; `setTowerDefence`/`getTowerDefence` | unit: экономика, переходы фаз, win/lose |
| 4 | Setup + редактор расстановки, TD-контроллер/хук, HUD, `App`/`LobbyBrowser` | сборка фронта, e2e-сценарий «setup→build→wave→result» |
| 5 | Баланс, типы/апгрейды/продажа, 3+ карты, сложности, полировка HUD | игровой прогон, тюнинг |
| 6 | 3D-рендер башен (расширение `SceneState`), docs, полный CI | `ci.sh` 9/9, typecheck/eslint чисто |

## 11. Тесты

- `emulator-core/tests/tower-defence.test.ts` — таргетинг/LOS, снаряды, броня,
  урон по башням, экономика, волны, переходы фаз, win/lose.
- `emulator-core/tests/td-levels.test.ts` — ASCII↔байты, спавны/база/строимые клетки.
- `qa/tests/features.test.ts` — манифест↔реестр (существующий, подхватит id).
- `qa/tests/architecture.test.ts` — рантаймы без `pvp`, без `Date`/`Math.random`;
  при необходимости новое правило: `shared/tower-defence.ts` без импортов.
- `frontend/tests/tower-defence.test.ts` — геометрия редактора, стоимость/валидность,
  машина фаз TD-контроллера на fake-портах.
- `qa` e2e (`e2e:online`) не затрагиваем; при желании — отдельная TD-сцена.
- Golden/fingerprint базы — без изменений (фича опциональна).

## 12. Риски и ограничения

- **Перехват завершения стадии**: `sub_C728` возвращает Z=0 при `enemies_left==0`;
  в BUILD это недопустимо. Spike фазы 0 подтверждает хук; запасной вариант —
  держать `enemies_left=1` вне WAVE.
- **AI-путь по коридорам**: враги используют существующий `lookahead` (цель —
  база); карты должны быть проходимы и не ломать навигацию (`fine-grid`).
- **OAM/BG-бюджет**: башни/снаряды рисуем в BG nametable (проверенный путь);
  OAM — только если хватит свободных слотов.
- **RAM**: авторитет TD — в `ctx.state`; rollback/`loadState` в TD не
  поддерживаются (задокументировать). `TD_STATE` — единственный новый байт.
- **Баланс**: числа (очки/стоимость/волны) тюнятся в фазе 5, вынесены в `shared`.
- **3D**: башни в `topdown-3d`/`mc-voxel` появятся после расширения
  `SceneState` (фаза 6), иначе TD — 2D-only.

## 13. Вне рамок

- Сетевой TD (rollback-совместимая экономика/расстановка).
- Кампания/метапрогрессия между матчами, сохранения.
- Новые CHR-ассеты: используем тайлы оригинального ROM.

## 14. Быстрые ссылки

- `shared/features.ts`, `shared/renderers.ts` — образцы манифестов без импортов.
- `emulator-core/patching/runtime.ts` — контракт `FeatureRuntime`/`KernelApi`.
- `emulator-core/features/pacman-maze.ts` — конструктор стадии (образец).
- `emulator-core/features/friendly-fire-att.ts` — JS-урон по врагу (образец).
- `emulator-core/features/railgun.ts` — отрисовка поверх ROM (образец).
- `frontend/src/components/StagePreview.tsx` — основа редактора расстановки.
- `frontend/src/application/match-controller.ts` — точка старта соло-режима.
- `vendor/nes-disasm/Battle City/bank_FF.asm` — `sub_C728`, `DE15` (kill), `DB48` (spawn).
