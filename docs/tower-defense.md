# Режим Tower Defence

Соло-режим обороны (скрытая фича `tower-defence`): игрок DEF покупает и расставляет
неподвижные танки-башни за очки от уничтожения врагов, волны ИИ-атакующих идут к базе.
Документ описывает игровой цикл, данные, ROM-патч, RAM-контракт, рантайм, фронтенд,
экономику, победу/поражение, тесты и ограничения.

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
  range: number;       // в блоках поля (16 px)
  fireInterval: number;// кадров между выстрелами
  projectileSpeed: number; // px/кадр
  upgradeCost: number; // стоимость апгрейда
  hp: number;          // прочность
  icon: number;        // иконка-подсказка для UI
}
export const TOWER_TYPES: TowerTypeInfo[] = [
  { id: "gun",    ... }, // 1 ствол, средняя скорострельность
  { id: "rapid",  ... }, // короткая дистанция, быстро
  { id: "sniper", ... }, // длинная дистанция, пробивает броню
  { id: "cannon", ... }, // медленный, высокий урон
];
export const TOWER_IDS = TOWER_TYPES.map(t => t.id);
export const TD_WAVES: { count: number; interval: number; types: number[] }[];
export const TD_POINTS_PER_KILL: Record<number, number>; // тип ROM-танка → очки
export const TD_MAPS: { id; title; rows }[]; export const TD_MAP_LIST; // карты
```

Здесь же — общая геометрия: `TD_SIZE = 13`, блок 16 px (`TD_BASE_*` — зона базы),
функции `tdMapById`, `tdBlocks`, `tdBuildableCells`, `tdSpawnCells`, `buildTdStageBytes`.
UI и рантайм используют один модуль `shared/tower-defence.ts` (без импортов).

## 4. Слой 2 — «конструктор уровней» и ROM-патч

### 4.1 Адаптация конструктора стадий

Сейчас единственный «конструктор уровней» — `features/pacman-maze.ts`
(DFS-лабиринт → 91-байтный формат стадии). Адаптируем его в **TD-конструктор**:

- Новый `emulator-core/features/td-levels.ts`:
  - ASCII-карты 13×13 (символы: `#` бетон, `.` пол, `S` спавн ATT, `E` пол у базы) —
    читаемый и правится вручную;
  - `buildTdStageBytes(ascii): Uint8Array` — та же упаковка, что в `pacman-maze`
    (14 нибблов/строку, stride 7 = 91, чётный индекс — старший ниббл);
  - `tdSpawnCells(map)`, `tdBuildableCells(map)`, `isWallBlock`, `isBaseCell` — экспорт
    для редактора и рантайма (без `Math.random`).
- 3 карты: `snake` (змейка), `lanes` (коридоры), `zigzag` (зигзаг) — разные дорожки.

Проверка: байты карты читаются `readStage()` и совпадают с ASCII (round-trip тест).

### 4.2 ROM-дескриптор `patches/tower-defence.ts`

По образцу `patches/pacman.ts`:

- `writes` для стадий 1..3 (`tbl_F07A`, по 91 байту) — карты TD.
- Хук завершения стадии `sub_C728_check_condition_for_stage_ending` ($C728):
  патчим вход, чтобы в TD-режиме стадия **не завершалась** по `enemies_left==0`
  во время BUILD/INTERMISSION (см. §5). Варианты:
  - реализовано: JMP на рутину `sub_td_stage_end_check` в свободной зоне `$FF50..$FFF9`;
    пока `TD_STATE != 0` и игры нет — вернуть A=0 (Z=1, «стадия не окончена»),
    поражение (game over) проходит.
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

Выбранная карта передаётся через `featureCommand("tower-defence", {type:"configure"})` (не через RAM).

Адреса фиксируются в `rom-contract.ts`; сочетаемость TD с другими фичами
проверяется тестами патчинга (при пересечении рутин линкер даёт `PATCH_OVERLAP`).

Точки, список башен (клетка, тип, hp, кулдаун, направление), снаряды (x, y, dir,
owner, ttl), номер волны — в `ctx.state`. `onLoadState` сбрасывает производное
состояние (в TD `saveState/loadState` не используются; ограничение
задокументировать).

## 6. Слой 3 — рантайм `features/tower-defence.ts`

Реализовано двумя модулями:

- `features/tower-defence.ts` — диспетчер хуков и состояние: экономика,
  постановка/продажа/апгрейд, таргетинг/LOS, снаряды, урон по башням, волны, фазы.
- `features/enemy-damage.ts` — общий `damageEnemy()` (броня/носитель приза/смерть),
  вынесен из `friendly-fire-att.ts` и переиспользуется им и башнями.

Хуки:

- `init`: `TD_STATE=BUILD`, состояние, точки; RAM до старта игры не трогается.
- `preFrame`: обработка `ctx.orders` (канал фичи); в BUILD после старта матча
  обнуляются счётчики спавна, чтобы волны не пошли до «В бой».
- `postFrame`: очки за переход врага `alive→взрыв`; выдача типа волны на спавне;
  наведение/выстрелы башен; движение снарядов и урон; урон по башням от вражеских
  пуль; в WAVE — контроль волны, в INTERMISSION — пауза → BUILD/VICTORY;
  при `GAME_OVER != 0x80` (или 0 жизней командира) → DEFEAT.
- `render`: башни/снаряды блитятся спрайтовыми тайлами прямо в кадровый буфер PPU
  (`ppuBuffer`), т.к. BG-таблица указывает на PT1, а танки — в PT0.
- `onLoadState`: сброс производного (в TD `saveState/loadState` не используются).

Взаимодействие с ядром (`pvp.ts`):

- `featureCommand("tower-defence", order)` — приказы `configure/place/sell/upgrade/startWave`
  (кладёт в `ctx.orders`, обрабатывается в `preFrame`).
- `getFeatureState("tower-defence")` — снимок для UI: фаза, очки, волна/всего волн,
  список башен, снаряды, `started`.
- Валидность/стоимость считаются в рантайме по `shared/tower-defence.ts` (UI не
  дублирует правила). `MatchController.startTowerDefence(config)` настраивает матч.

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

### 7.3 Игровой экран `components/TowerDefenceView.tsx`

- Ведёт цикл эмулятора (авто-старт матча, затем rAF `stepFrame`), рендерит боевой
  вид через общий `RenderSystem`.
- В BUILD показывает редактор и магазин, шлёт `emu.featureCommand("tower-defence", ...)`;
  HUD читает `emu.getFeatureState("tower-defence")`; результат — по фазе `TD_STATE`.

### 7.4 Интеграция

- `App.tsx`: экран `{ name: "td" }` + модалка настройки (`showTdSetup`);
  `GameCanvas` не меняется — TD рисует отдельный `TowerDefenceView`.
- HUD — внутри `TowerDefenceView` (очки, волна `n/N`, фаза, магазин, результат).
- `engine/emulator.ts`: прокси `featureCommand`/`getFeatureState`; `styles.css`: стили TD.

## 8. Экономика и волны

- **Очки за убийство** (по типу ROM-танка, как в оригинальном счёте):
  базовый 100, скорострельный 200, быстрый 300, бронированный 400 (+ бонус за
  волну). `TD_POINTS_PER_KILL` — в `shared`.
- **Стартовый капитал** зависит от сложности; хватает на 2–3 башни.
- **Стоимость/апгрейд/продажа** — в `TOWER_TYPES`; продажа — 60% вложенного.
- **Башни живут между волнами**, покупка/перестановка — в BUILD.
  (Продажа и перенос — по желанию, в фазе 5.)
- **Волны**: `TD_WAVES` — массив `{ count, interval, types }`; сложность масштабирует
  count, рантайм выдаёт тип врага из `types` на спавне. Спавн через `enemies_left`/`SPAWN_TIMER`.
- **База**: классическая (одно попадание) — поражение. При желании в фазе 5:
  HP базы с ремонтом между волнами (перехват `sub_E2A9_HQ_handler`).
- **Жизни**: если мобильный танк включён — стандартные 3, поражение при 0.

## 9. Победа/поражение

- Рантайм пишет `TD_STATE = VICTORY/DEFEAT`; фронт показывает результат.
- Условия: VICTORY — пройдены все волны; DEFEAT — `GAME_OVER==0` (орёл),
  либо жизни DEF исчерпаны (если танк включён).
- `determineWinner` не трогаем (используется в netcode/пакмане); в TD-ветке
  `GameCanvas` результат определяется только по `TD_STATE`.

## 10. Тесты

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

## 11. Риски и ограничения

- **Перехват завершения стадии**: `sub_C728` возвращает Z=0 при `enemies_left==0`;
  в BUILD это недопустимо. Spike фазы 0 подтверждает хук; запасной вариант —
  держать `enemies_left=1` вне WAVE.
- **AI-путь по коридорам**: враги используют существующий `lookahead` (цель —
  база); карты должны быть проходимы и не ломать навигацию (`fine-grid`).
- **2D-оверлей**: башни/снаряды блитятся спрайтовыми тайлами прямо в кадровый буфер
  PPU (`ppuBuffer`) — BG не подходит (фоновая таблица PT1, танки в PT0), а OAM-запись
  из хуков в видимый кадр не доживает.
- **RAM**: авторитет TD — в `ctx.state`; rollback/`loadState` в TD не
  поддерживаются (задокументировать). `TD_STATE` — единственный новый байт.
- **Баланс**: числа (очки/стоимость/волны) тюнятся в фазе 5, вынесены в `shared`.
- **3D**: реализовано — `SceneState.towers` + `render/tower-visual.ts`, башни рисуются
  в `topdown-3d`/`mc-voxel`.

## 12. Вне рамок

- Сетевой TD (rollback-совместимая экономика/расстановка).
- Кампания/метапрогрессия между матчами, сохранения.
- Новые CHR-ассеты: используем тайлы оригинального ROM.

## 13. Быстрые ссылки

- `shared/features.ts`, `shared/renderers.ts` — образцы манифестов без импортов.
- `emulator-core/patching/runtime.ts` — контракт `FeatureRuntime`/`KernelApi`.
- `emulator-core/features/pacman-maze.ts` — конструктор стадии (образец).
- `emulator-core/features/friendly-fire-att.ts` — JS-урон по врагу (образец).
- `emulator-core/features/railgun.ts` — отрисовка поверх ROM (образец).
- `frontend/src/components/StagePreview.tsx` — основа редактора расстановки.
- `frontend/src/application/match-controller.ts` — точка старта соло-режима.
- `vendor/nes-disasm/Battle City/bank_FF.asm` — `sub_C728`, `DE15` (kill), `DB48` (spawn).
