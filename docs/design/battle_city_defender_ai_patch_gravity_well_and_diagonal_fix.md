# Единый патч: устранение эффекта «чёрной дыры» и бага диагонального перемещения

Этот патч объединяет два независимых, но часто проявляющихся вместе фикса: (1) защитник перестаёт уходить далеко от базы за спавном/призами/гранатой из-за ложного фонового сигнала угрозы, и (2) на мелкой сетке разрушения кирпича танк может физически «срезать» угол блока по диагонали, чего в оригинальной игре не бывает — оба бага искажают одни и те же расчёты пути и времени, поэтому чинить их нужно вместе.

## Часть 1. Эффект «чёрной дыры» (гравитационная яма вокруг базы)

### Диагноз

1. **Слишком грубое anti-decoy правило.** Статичный радиус (`decoy_radius`) почти всегда блокировал цели дальше базы, потому что условие «нет других врагов с LOS на базу» почти никогда истинно на реальных картах — правило вырождалось в постоянный запрет.
2. **Фоновый сигнал угрозы никогда не гаснет.** Компонент `1/DistanceToBase(e)` в оценке угрозы не равен нулю даже для танка без реальных шансов дойти до базы — вместе с порогом гистерезиса это не даёт дальним альтернативам (спавн, призы, граната) набрать перевес и «затягивает» защитника к базе как гравитацией.
3. **Расстояние использовалось как прокси риска**, хотя это разные вещи: далёкая цель не обязательно decoy-ловушка, близкая не обязательно безопасна.

### Фикс: feasibility по времени вместо статичного радиуса

```python
def predicted_arrival_time_pessimistic(enemy, base, fine_grid, horizon_ticks):
    optimistic = path_length(fine_astar(enemy.pos, base, fine_grid, rules)) / enemy.speed
    eroded_grid = simulate_erosion(fine_grid, ticks=horizon_ticks, shooters=all_active_tanks())
    pessimistic = path_length(fine_astar(enemy.pos, base, eroded_grid, rules)) / enemy.speed
    return min(optimistic, pessimistic)


def feasible_excursion(target, self, perception, safety_margin=0.7):
    t_there = path_length(fine_astar(self.pos, target, perception.fine_grid, rules)) / self.speed
    t_action = expected_action_duration(target)
    t_back = path_length(fine_astar(target, defend_anchor(perception), perception.fine_grid, rules)) / self.speed
    total_time = t_there + t_action + t_back

    credible = [e for e in perception.enemies
                if predicted_arrival_time_pessimistic(e, perception.base, perception.fine_grid, EXCURSION_HORIZON) < float('inf')]
    worst_case = min(
        (predicted_arrival_time_pessimistic(e, perception.base, perception.fine_grid, EXCURSION_HORIZON) for e in credible),
        default=float('inf')
    )
    return total_time < worst_case * safety_margin


def allow_intercept(e, self, perception):
    return feasible_excursion(e.position, self, perception) or threat_to_base(e, perception) > CRITICAL_THREAT_THRESHOLD
```

### Фикс: шумовой порог для фонового сигнала

```python
THREAT_NOISE_FLOOR = 0.05  # калибруется тестами

def effective_threat(e, perception):
    raw = threat_to_base(e, perception)
    return raw if raw > THREAT_NOISE_FLOOR else 0.0
```

`U_defend` считается через `effective_threat`, а `U_spawn_denial`, `U_bonus`, `U_rush_bonus`, `u_grenade_bonus` — через `feasible_excursion` вместо жёсткого радиуса:

```
U_spawn_denial(sp) = kill_value_before_mobility if feasible_excursion(sp, self, perception) else 0
U_bonus(b)          = BonusValue(b) / (1 + SafetyRisk) if feasible_excursion(b, self, perception) else BonusValue(b) * PARTIAL_RISK_FACTOR
```

Это устраняет «чёрную дыру»: защитник теперь уходит за спавном, гранатой или дальним призом ровно тогда, когда успевает вернуться раньше, чем любая реальная угроза дойдёт до базы — а не никогда, как было при статичном радиусе.

## Часть 2. Баг ложного диагонального перемещения

### Диагноз

Танки в Battle City двигаются строго по 4 осям, без диагонали. Сетка удвоенного разрешения (нужна для учёта частичного разрушения кирпича) при наивной реализации соседей допускает переход по диагонали через угол блока, где расчищена только одна диагональная суб-клетка (например, TL и BR открыты, TR и BL — нет). Это даёт танку нелегальный «срез» угла, которого не может быть по правилам игры, и одновременно **искажает те же самые расчёты**, что и часть 1 (`predicted_arrival_time_pessimistic`, `feasible_excursion`) — ETA получается заниженной, feasibility может ложно сработать как «безопасно», хотя реальный (ортогональный) путь длиннее.

### Фикс: строго ортогональный граф соседей

```python
ORTHOGONAL_STEPS = [(1, 0), (-1, 0), (0, 1), (0, -1)]

def fine_grid_neighbors(pos):
    x, y = pos
    return [(x + dx, y + dy) for dx, dy in ORTHOGONAL_STEPS]
```

### Фикс: валидация ведущей кромки хитбокса

```python
def validate_orthogonal_passage(fine_grid, from_pos, to_pos, tile_type_rules):
    dx, dy = to_pos[0] - from_pos[0], to_pos[1] - from_pos[1]
    assert (dx, dy) in ORTHOGONAL_STEPS, "Диагональный переход запрещён правилами игры"

    if not can_occupy(fine_grid, to_pos, tile_type_rules):
        return False

    edge_cells = leading_edge_cells(to_pos, direction=(dx, dy))
    return all(
        fine_grid.get(c) is not None and tile_type_rules.is_passable(fine_grid.get(c))
        for c in edge_cells
    )
```

`leading_edge_cells` возвращает именно те две суб-клетки, которые хитбокс «пробивает первыми» при движении в данном направлении — если хотя бы одна закрыта, переход невозможен, даже если противоположная диагональная пара открыта.

## Часть 3. Объединённый `fine_astar` — единая точка правды для обоих фиксов

```python
def fine_astar(start, goal, fine_grid, tile_type_rules):
    def cost(pos, next_pos):
        if not validate_orthogonal_passage(fine_grid, pos, next_pos, tile_type_rules):
            return float('inf')
        return SURFACE_COST[dominant_surface(fine_grid, next_pos)]  # ice=1.5, tree=1.2, empty=1
    return astar_search(start, goal, neighbors_fn=fine_grid_neighbors, cost_fn=cost)
```

Это критично: `feasible_excursion` и `predicted_arrival_time_pessimistic` из части 1 вызывают именно эту версию `fine_astar`. Если бы диагональный баг остался неисправленным, feasibility-модель из части 1 продолжала бы иногда ошибаться — считать рейд безопасным на основе заниженной по диагонали оценки пути врага. Поэтому оба фикса нужно ставить как одну неделимую пару, а не по отдельности.

## Часть 4. Итоговый эффект

| Было | Стало |
|---|---|
| Защитник никогда не уходит от базы дальше `decoy_radius`, даже если это безопасно | Уходит, когда `feasible_excursion` подтверждает, что успеет вернуться раньше реальной угрозы |
| Фоновая «угроза» от далёких безопасных танков держит защитника у базы постоянно | `effective_threat` гасит сигнал ниже `THREAT_NOISE_FLOOR` |
| Танк может проскочить по диагонали через частично разрушенный угол блока | `validate_orthogonal_passage` + `fine_grid_neighbors` запрещают это на уровне графа пути |
| ETA врага/защитника может быть заниженной из-за диагональных срезов, искажая feasibility | `fine_astar` с исправленным графом даёт консервативную и корректную оценку для обеих моделей |

## Часть 5. Что тестировать вместе (не по отдельности)

- Сценарий: далёкий приз/граната/точка спавна доступны только в обход частично разрушенного угла — нужно убедиться, что `feasible_excursion` теперь считает **честный ортогональный обход**, а не ошибочно короткий диагональный путь.
- Юнит-тест на блок с диагонально-открытыми TL+BR (TR+BL закрыты) — должен быть непроходим с любой стороны.
- Регресс на `safety_margin`: после исправления диагонального бага реальные ETA стали чуть больше — возможно, потребуется скорректировать `safety_margin` и `THREAT_NOISE_FLOOR`, откалиброванные ранее на заниженных (диагональных) оценках пути.
- Проверка, что после фикса защитник всё же **иногда** доходит до спавна/гранаты/дальних призов в сценариях с низкой плотностью врагов — то есть «чёрная дыра» не вернулась в виде более консервативной, но всё ещё чрезмерно строгой оценки после исправления диагонали.
