// TowerDefenceView.tsx — игровой экран tower defence: цикл кадров, редактор расстановки,
// HUD (очки/волна), результат. Соло-режим, рендер — через общий RenderSystem.
import { useEffect, useMemo, useRef, useState } from "react";
import { EmulatorDriver } from "../engine/emulator";
import type { KeyboardInput } from "../engine/input";
import { BTN_START } from "../engine/game-state";
import { RenderSystem } from "../render/render-system";
import { readScene } from "../render/scene-state";
import TowerPlacementEditor, { type EditorTower } from "./TowerPlacementEditor";
import RenderSettings from "./RenderSettings";
import {
  TD_PHASE,
  TOWER_TYPES,
  tdBuildableCells,
  tdMapById,
  tdMapStage,
  type TdConfig,
} from "../../../shared/tower-defence.ts";

interface TdStatus {
  phase: number;
  started: boolean;
  points: number;
  wave: number;
  totalWaves: number;
  towers: EditorTower[];
}

interface Props {
  emulator: EmulatorDriver;
  keyboard: KeyboardInput;
  config: TdConfig;
  onExit: () => void;
}

export default function TowerDefenceView({ emulator, keyboard, config, onExit }: Props) {
  const gameRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TdStatus | null>(null);
  const [selectedType, setSelectedType] = useState(TOWER_TYPES[0].id);
  const [render, setRender] = useState<RenderSystem | null>(null);

  const stage = tdMapStage(config.map);
  const buildable = useMemo(() => new Set(tdBuildableCells(tdMapById(config.map))), [config.map]);
  const phase = status?.phase ?? TD_PHASE.BUILD;
  const inWave = phase === TD_PHASE.WAVE || phase === TD_PHASE.INTERMISSION;
  const finished = phase === TD_PHASE.VICTORY || phase === TD_PHASE.DEFEAT;

  // Цикл ядра: автостарт матча, затем кадры с вводом мобильного танка.
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      frame++;
      const started = emulator.readMem(0x68) === 0x80;
      const buttons = !started ? (frame % 30 === 0 ? BTN_START : 0) : config.mobileTank ? keyboard.mask() : 0;
      emulator.step([{ port: 0, buttons }]);
      setStatus((emulator.getTowerDefence() as TdStatus) ?? null);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emulator, config.mobileTank]);

  // Рендер боевого вида (монтируется только в фазе волны).
  useEffect(() => {
    const el = gameRef.current;
    if (!el || !inWave) return;
    const sys = new RenderSystem({ container: el, scene: () => readScene(emulator) });
    sys.setViewer({ port: 0 });
    emulator.setFrameRenderer(() => sys.frame());
    setRender(sys);
    return () => {
      emulator.setFrameRenderer(null);
      sys.dispose();
      setRender(null);
    };
  }, [emulator, inWave]);

  const towers: EditorTower[] = status?.towers ?? [];

  const onCell = (cell: number) => {
    if (phase !== TD_PHASE.BUILD) return;
    const existing = towers.find((t) => t.cell === cell);
    if (existing) emulator.tdOrder({ type: "upgrade", cell });
    else emulator.tdOrder({ type: "place", cell, towerType: selectedType });
  };
  const onContextCell = (cell: number) => {
    if (phase !== TD_PHASE.BUILD) return;
    emulator.tdOrder({ type: "sell", cell });
  };

  return (
    <div className="game td">
      <div className="hud">
        <span className="ok">Tower Defence</span>
        <span>Очки: <b>{status?.points ?? 0}</b></span>
        <span>Волна: {status?.wave ?? 0}/{status?.totalWaves ?? 0}</span>
        <span>
          Фаза:{" "}
          {phase === TD_PHASE.BUILD
            ? "сборка"
            : phase === TD_PHASE.WAVE
              ? "бой"
              : phase === TD_PHASE.INTERMISSION
                ? "передышка"
                : phase === TD_PHASE.VICTORY
                  ? "победа"
                  : "поражение"}
        </span>
        <button className="btn btn--ghost" onClick={onExit}>В лобби</button>
      </div>

      {!inWave && !finished && (
        <div className="td__build">
          <div className="td__shop">
            <div className="td__shop-title">Башни</div>
            {TOWER_TYPES.map((t) => (
              <button
                key={t.id}
                className={`btn ${selectedType === t.id ? "btn--primary" : "btn--ghost"}`}
                onClick={() => setSelectedType(t.id)}
              >
                {t.title} · {t.cost}
                <small>{t.description}</small>
              </button>
            ))}
            <div className="td__tip">ЛКМ по клетке — поставить (или улучшить башню), ПКМ — продать.</div>
            <button
              className="btn btn--primary"
              disabled={!status?.started || (phase !== TD_PHASE.BUILD && phase !== TD_PHASE.INTERMISSION)}
              onClick={() => emulator.tdOrder({ type: "startWave" })}
            >
              {status?.started ? "▶ В бой" : "Загрузка…"}
            </button>
          </div>
          <TowerPlacementEditor
            emulator={emulator}
            stage={stage}
            buildable={buildable}
            towers={towers}
            onCell={onCell}
            onContextCell={onContextCell}
            size={416}
          />
        </div>
      )}

      {inWave && (
        <div className="game__board">
          <div ref={gameRef} className="screen-stage" />
          <RenderSettings system={render} />
        </div>
      )}

      {finished && (
        <div className="result">
          <h2>{phase === TD_PHASE.VICTORY ? "Победа! База устояла." : "Поражение. База пала."}</h2>
          <button onClick={onExit}>Вернуться в лобби</button>
        </div>
      )}
    </div>
  );
}
