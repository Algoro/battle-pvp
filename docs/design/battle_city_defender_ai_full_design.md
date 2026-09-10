# Полный дизайн ИИ для танков-защитников в Battle City

## 1. Игровые механики (основа для проектирования)

### 1.1 Типы тайлов и их правила
| Тайл | Проходимость для танка | Проходимость для пули | Разрушаемость | Особый эффект |
|---|---|---|---|---|
| Кирпич (Brick) | Нет | Нет | Разрушается выстрелом (Power — быстрее/сильнее) | Укрытие и расходный тактический ресурс |
| Сталь (Steel) | Нет | Нет | Не разрушается (кроме игрока с 3+ звёздами) | Постоянный барьер, основа для «бутылочных горлышек» |
| Дерево/Куст (Trees) | Да | Да | Не разрушается | Скрывает юнита от визуального сканирования, не от коллизии |
| Вода (Water) | Нет | Да | Не разрушается | Пули пролетают насквозь — опасная зона у берега |
| Лёд (Ice) | Да | Да | Не разрушается | Танк скользит по инерции после отпускания направления |
| База/Орёл (Base) | N/A | Уязвима | Окружена кирпичом/сталью (после лопаты) | Финальная цель защиты, потеря = проигрыш |

### 1.2 Типы танков
| Тип | Скорость | Хиты | Огневая мощь | Роль |
|---|---|---|---|---|
| Basic/Light | Низкая | 1 | Обычная, медленный перезаряд | Низкая угроза, «мясо» |
| Fast/Speed | Очень высокая | 1 | Обычная | Наивысший приоритет перехвата — успевает до базы быстрее всех |
| Power | Средняя | 1 | Высокая, быстрый прострел кирпича, очередями | Опасен в открытом бою и при штурме стен |
| Armor/Heavy | Низкая | 4 (1 — если это мигающий бонусный танк) | Средняя | Требует укрытий и фланга, не дуэли |

### 1.3 Бонусы
| Бонус | Эффект | Контекст максимальной ценности |
|---|---|---|
| Звезда (Star) | Апгрейд оружия/скорости, накопительно до 3 уровней | В начале волны |
| Лопата (Shovel) | Кирпич стен базы → сталь на время | Критично, когда база под атакой |
| Шлем (Helmet) | Временная неуязвимость | При выходе из укрытия/на респауне |
| Танк (Tank icon) | +1 жизнь | Постоянно высокий приоритет, но не выше защиты базы |
| Пистолет/Оружие (Gun) | Мгновенный макс. апгрейд | Как звезда, но безусловно ценнее |
| Гранта/Бомба (Grenade) | Уничтожает все вражеские танки на экране | При скоплении 3+ врагов |
| Часы (Clock) | Заморозка всех врагов на экране | Только при угрозе базе от нескольких танков |

### 1.4 Мигающие (бонусные) танки
- 4-й, 11-й и 18-й враг на уровне становится **мигающим**; попадание по нему создаёт бонус в одной из 16 фиксированных точек экрана.
- Если мигающий танк — **Armor**, для бонуса достаточно **одного** попадания вместо четырёх.
- За уровень выпадает максимум **3 бонуса**; не собранный бонус исчезает при появлении следующего мигающего танка.
- Место появления бонуса всегда физически достижимо.

### 1.5 Декои и уровень в целом
- На поздних уровнях часть врагов имитирует атаку, чтобы отвлечь защитника от базы, пока другой танк заходит с фланга.
- На уровне ровно **20 вражеских танков**, появляющихся из ограниченного числа точек сверху карты; поражение базы или потеря жизней = проигрыш даже при уничтожении всех 20.
- Танк защищён полем неуязвимости **3 секунды** после респауна и в начале уровня; враги при появлении такой защиты не имеют.

### 1.6 Снаряды и кооператив
- Снаряды, столкнувшиеся в полёте, уничтожают друг друга — одна из ключевых механик серии.
- Число снарядов в полёте ограничено: 1 без апгрейда, до 2 при 2+ звёздах.
- Танки физически не проходят друг через друга.
- В кооперативе попадание союзной пули замораживает танк на случайное время (движение блокировано, поворот/стрельба доступны).

## 2. Архитектура ИИ

Гибридная **Utility-based** система с верхним слоем конечного автомата (FSM) и слоем A*-навигации с модификаторами стоимости по типу тайла.

```
[Perception] → [Threat & Opportunity Evaluation] → [Utility Scoring] → [FSM State] → [Path Planning (A*)] → [Motor Control]
```

### 2.1 Perception Layer
Каждый тик: тайлы в радиусе видимости (включая «теневые» зоны под деревьями), позиции и векторы всех танков, траектории летящих пуль, состояние базы, активные бонусы, собственный апгрейд/жизни/кулдаун перезарядки, число оставшихся вражеских спавнов и позиция в очереди (для отслеживания мигающих танков).

### 2.2 Оценка угрозы базе
```
ThreatToBase(e) = W_speed * SpeedFactor(e)
                + W_los   * HasLineOfSightToBase(e)
                + W_dist  * (1 / DistanceToBase(e))
                + W_power * FirepowerFactor(e)
                + W_path  * (1 / PathObstruction(e→base))
```
`SpeedFactor`: Fast=1.0, Power=0.5, Basic=0.4, Armor=0.3. `PathObstruction` учитывает кирпич (стоимость 1) и сталь (стоимость ∞).

### 2.3 Utility-функции по классам действий

**Защита базы:**
```
U_defend = k1*MaxThreatToBase + k2*BaseWallDamage + k3*(EnemiesNearBase/totalEnemies)
```

**Перехват (с проверкой анти-декой):**
```
allow_intercept(e) = Distance(e, base) < decoy_radius
                   OR count(other_enemies_with_LOS_to_base) == 0
U_intercept(e) = ThreatToBase(e) * distancePenaltyFactor - engagementRisk(e)   [только если allow_intercept]
```

**Охота на мигающий танк:**
```
U_hunt_blink(e) = base_priority
                 + BONUS_ARMOR_SHORTCUT * IsArmorType(e)
                 + REMAINING_BONUS_SLOTS_FACTOR
                 - EngagementRisk(e)
```

**Сбор выпавшего бонуса (срочный):**
```
U_rush_bonus = BonusValue(dropped_bonus, context) / (Distance(self, bonus) + PathRisk)
             * urgency_multiplier(time_until_next_blinking_tank)
```

**Сбор обычного бонуса:**
```
U_bonus(b) = BonusValue(b, context) / (Distance(self, b) + SafetyRisk(path_to_b))
```

**Отступление:**
```
U_retreat = w1*(1 - HealthRatio) + w2*IncomingFireCount + w3*(1/NearestCoverDistance)
```

**Простреливание стены (с поправкой на экономию боезапаса):**
```
U_breach = w1*TacticalValueOfOpening - w2*ExposureRisk - ammo_reservation_penalty*incoming_threat_probability
```

**Засада:**
```
U_ambush = w1*PredictedEnemyPathOverlap - w2*TimeToSetup
```

**Агрессия в окне неуязвимости:**
```
U_aggressive_push = base_utility * (2.0 if is_invulnerable else 1.0)
```

Финальное решение — `argmax` по всем `U_*` с гистерезисом ≥15% для смены текущего действия.

## 3. Конечный автомат состояний (FSM)

1. **PATROL** — базовое сканирование карты и обход ключевых точек у базы.
2. **DEFEND_BASE** — при `ThreatToBase > T1`; включает субрежим **HOLD_CORRIDOR**.
3. **INTERCEPT** — перехват угрозы (с проверкой anti-decoy); для Fast-танков заменяется на **LEADING_SHOT**.
4. **HUNT_BLINKING_TANK** — приоритет выше обычного перехвата такого же типа.
5. **RUSH_BONUS_DROP** — сразу после уничтожения мигающего танка.
6. **RETREAT** — низкое здоровье/окружение.
7. **AMBUSH** — засада у предсказанного маршрута или у точки спавна (**SPAWN_DENIAL**, если в радиусе decoy_radius от базы).
8. **COLLECT_BONUS** — обычный сбор бонусов при отсутствии угроз.
9. **BREACH / PATROL** — фоновые действия.

Приоритет переходов:
`DEFEND_BASE > HUNT_BLINKING_TANK > INTERCEPT (не-декой) > RUSH_BONUS_DROP > RETREAT (критично) > AMBUSH/SPAWN_DENIAL > COLLECT_BONUS > BREACH/PATROL`

### 3.1 Реактивный слой микро-действий (прерывает любое состояние)
| Микро-действие | Приоритет | Условие |
|---|---|---|
| COUNTER_SHOT | Наивысший | Пуля летит по той же линии, уклонение невозможно |
| HULL_BLOCK | Критический | Нет боезапаса, враг на последнем коридоре к базе |
| LEADING_SHOT | Высокий (замена погони) | Цель — Fast-танк, валидна точка пересечения |

## 4. Тактика по типам врагов
- **Basic**: минимальный приоритет, атака «по возможности».
- **Fast**: приоритет №1 на перехват при LOS на базу; используется `LEADING_SHOT`, не погоня.
- **Power**: не вступать в открытую дуэль, использовать угловые укрытия и засаду — прорезает кирпич быстрее и опаснее в лоб.
- **Armor**: фланговый обход, не фронтальный обмен; если он мигающий — резкий рост приоритета (1 хит = бонус).

## 5. Тактика по тайлам
- **Кирпич**: щит + расходуемый ресурс — разрушается только при тактической необходимости, не «на всякий случай» (см. ammo discipline).
- **Сталь**: используется для построения «бутылочных горлышек» под `HOLD_CORRIDOR`.
- **Дерево**: маршрут для скрытого выхода на фланг; враг может физически быть под деревом даже если не виден.
- **Вода**: жёсткий барьер маршрута, но пули летят сквозь — не задерживаться на берегу без укрытия.
- **Лёд**: избегать точных маневров (уклонение, перехват) — рассчитывать инерционный запас перед сменой направления.

## 6. Тактические механики реагирования

### 6.1 Блокирование снаряда своим снарядом (COUNTER_SHOT)
Столкновение двух снарядов уничтожает оба. Полезно в узких коридорах без возможности увернуться, особенно против Fast-танков.
```python
def should_counter_shot(incoming_bullet, self):
    same_lane = is_aligned(incoming_bullet.trajectory, self.position)
    if not same_lane:
        return False
    time_to_impact = distance(incoming_bullet, self) / incoming_bullet.speed
    my_bullet_travel_time = distance_to_intercept_point(self, incoming_bullet) / self.bullet_speed
    can_dodge = has_side_movement_option(self) and time_to_impact > dodge_time_required
    return my_bullet_travel_time <= time_to_impact and (not can_dodge or is_holding_critical_position(self))
```
Ограничение: занимает единственный/один из двух слотов боезапаса до попадания текущего снаряда.

### 6.2 Удержание коридора (HOLD_CORRIDOR)
Заранее вычисленные «sweet spot» позиции за укрытием, откуда виден весь коридор к базе, но сам защитник минимально уязвим.
```python
def find_corridor_anchor(base_pos, tilemap):
    corridors = extract_straight_paths_to(base_pos, tilemap)
    return [c.entry_point_behind_cover for c in corridors]
```
```
U_hold_corridor = corridor_criticality(corridor) * (1 - reload_cooldown_ratio)
```

### 6.3 Уничтожение на спавне (SPAWN_DENIAL)
Враги не защищены при появлении. Полезно только если точка спавна в радиусе `decoy_radius` от базы — иначе конфликтует с anti-decoy правилом.
```
U_spawn_denial(spawn_point) = kill_value_before_mobility * within_decoy_radius(spawn_point, base) - abandon_base_risk
```

### 6.4 Физическая блокировка корпусом (HULL_BLOCK)
Аварийная тактика при отсутствии боезапаса: танк физически занимает проход. Безопасна с активным Шлемом, рискованна против Power без него.
```
U_hull_block = CRITICAL if (no_ammo_available AND enemy_on_final_corridor AND ally_or_reload_incoming) else LOW
requires: self.has_helmet_active OR acceptable_risk(enemy.firepower)
```

### 6.5 Выстрел на опережение (LEADING_SHOT)
Вместо погони за Fast-танком — расчёт точки пересечения:
```python
def compute_lead_point(enemy, self):
    for t in range(max_lead_ticks):
        future_pos = enemy.pos + enemy.velocity * t
        bullet_travel_time = distance(self.pos, future_pos) / self.bullet_speed
        if abs(bullet_travel_time - t) < TOLERANCE and line_of_sight_clear(self.pos, future_pos):
            return future_pos
    return None
```

### 6.6 Экономия боезапаса (Ammo Discipline)
Постоянный модификатор для `U_breach` и любых необязательных выстрелов — штраф пропорционален вероятности появления угрозы, требующей немедленной реакции.

### 6.7 Анти-декой правило
```
allow_intercept(e) = Distance(e, base) < decoy_radius OR count(other_enemies_with_LOS_to_base) == 0
```
Если условие не выполняется — защитник остаётся в `DEFEND_BASE`/`AMBUSH` вместо погони за приманкой.

### 6.8 Кооператив: избегание дружественного огня
```python
def can_fire(self, target_line):
    return not any(intersects(target_line, ally.hitbox) for ally in allies)
```
Если союзник заморожен вражеской/дружественной пулей, второй защитник временно берёт на себя его сектор ответственности.

### 6.9 Сознательно не включённые механики
- **Рикошет снарядов** — отсутствует в игре физически.
- **Push/толкание объектов снарядами** — не относится к оригинальной игре.
- **Высота/вертикаль** — в Battle City отсутствует, весь смысл уже покрыт механикой углов и коридоров.

## 7. Псевдокод главного цикла

```python
def defender_ai_tick(state):
    perception = perceive(state)

    incoming = detect_incoming_bullets(perception)
    for b in incoming:
        if should_counter_shot(b, perception.self):
            return fire_counter_shot(b)

    threats = sorted(
        [(e, threat_to_base(e, perception)) for e in perception.enemies],
        key=lambda x: -x[1]
    )

    candidates = {
        'defend':          u_defend(perception, threats),
        'hunt_blink':       {e.id: u_hunt_blink(e) for e in perception.blinking_enemies},
        'intercept':        {e.id: u_intercept(e, perception) for e, _ in threats if allow_intercept(e)},
        'leading_shot':     {e.id: u_leading_shot(e) for e in perception.fast_enemies},
        'rush_bonus':       u_rush_bonus(perception),
        'bonus':            {b.id: u_bonus(b, perception) for b in perception.bonuses},
        'retreat':          u_retreat(perception),
        'ambush':           u_ambush(perception, threats),
        'spawn_denial':     {sp.id: u_spawn_denial(sp) for sp in perception.spawn_points},
        'hull_block':       u_hull_block(perception),
        'breach':           u_breach_adjusted(perception),
    }

    best_action = select_best(candidates, current_state=perception.fsm_state, hysteresis=0.15)
    path = plan_path(perception.self_pos, best_action.target,
                      tile_cost_fn=tile_cost, avoid=best_action.avoid_tiles)
    return execute(best_action, path)


def tile_cost(tile_type):
    return {
        'empty': 1, 'brick': 3, 'steel': float('inf'),
        'tree': 1.2, 'water': float('inf'), 'ice': 1.5,
    }[tile_type]
```

## 8. Сводная таблица приоритетов верхнего уровня

| Приоритет | Действие | Условие активации |
|---|---|---|
| 0 | COUNTER_SHOT / HULL_BLOCK | Реактивные, прерывают всё |
| 1 | DEFEND_BASE | ThreatToBase > T1 |
| 2 | HUNT_BLINKING_TANK | Появился мигающий танк, угроза базе ниже порога |
| 3 | INTERCEPT / LEADING_SHOT | Fast/Power с LOS на базу, не декой |
| 4 | RUSH_BONUS_DROP | Бонус выпал, таймер до следующего мигающего танка не истёк |
| 5 | RETREAT | HealthRatio ниже порога / нет укрытия |
| 6 | AMBUSH / SPAWN_DENIAL | Свободный ресурс, нет угроз базе, точка спавна в decoy_radius |
| 7 | COLLECT_BONUS | Нет угроз, есть невыбранный обычный бонус |
| 8 | BREACH / PATROL | Фон при отсутствии прочих условий |

## 9. Рекомендации по тестированию и балансировке

- Серии симуляций с разными комбинациями волн (Fast vs Armor), замер среднего времени выживания базы.
- Автоматическая оптимизация весов (`k1..k3`, `w1..w3`, `decoy_radius`) через генетический алгоритм/grid search по метрике «число сохранённых жизней базы за N волн».
- Логирование переходов FSM для отладки дребезга состояний и калибровки порога гистерезиса.
- Отдельное тестирование на картах с преобладанием льда и воды — эти тайлы чаще всего снижают точность перехвата.
- Проверка кооп-сценариев на дружественный огонь и корректную передачу зон ответственности при заморозке союзника.
