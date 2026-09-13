// TowerDefenceView.tsx — tower defence game screen: frame loop, placement editor,
// HUD (score/wave), result. Solo mode, rendering via the shared RenderSystem.
import { useEffect, useMemo, useRef, useState } from "react";
import { EmulatorDriver } from "../engine/emulator";
import type { KeyboardInput } from "../engine/input";
import { BTN_START } from "../engine/game-state";
import { RenderSystem } from "../render/render-system";
import { readScene } from "../render/scene-state";
import { useT } from "../i18n/index.tsx";
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
  const t = useT();
  const gameRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TdStatus | null>(null);
  const [selectedType, setSelectedType] = useState(TOWER_TYPES[0].id);
  const [render, setRender] = useState<RenderSystem | null>(null);

  const stage = tdMapStage(config.map);
  const buildable = useMemo(() => new Set(tdBuildableCells(tdMapById(config.map))), [config.map]);
  const phase = status?.phase ?? TD_PHASE.BUILD;
  const inWave = phase === TD_PHASE.WAVE || phase === TD_PHASE.INTERMISSION;
  const finished = phase === TD_PHASE.VICTORY || phase === TD_PHASE.DEFEAT;

  // Core loop: auto-start the match, then frames with the mobile tank input.
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      frame++;
      const started = emulator.readMem(0x68) === 0x80;
      const buttons = !started ? (frame % 30 === 0 ? BTN_START : 0) : config.mobileTank ? keyboard.mask() : 0;
      emulator.step([{ port: 0, buttons }]);
      setStatus((emulator.getFeatureState("tower-defence") as TdStatus) ?? null);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emulator, config.mobileTank]);

  // Render the battle view (mounted only during the wave phase).
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
    if (existing) emulator.featureCommand("tower-defence", { type: "upgrade", cell });
    else emulator.featureCommand("tower-defence", { type: "place", cell, towerType: selectedType });
  };
  const onContextCell = (cell: number) => {
    if (phase !== TD_PHASE.BUILD) return;
    emulator.featureCommand("tower-defence", { type: "sell", cell });
  };

  return (
    <div className="game td">
      <div className="hud">
        <span className="ok">Tower Defence</span>
        <span>{t("Очки:")} <b>{status?.points ?? 0}</b></span>
        <span>{t("Волна: {wave}/{total}", { wave: status?.wave ?? 0, total: status?.totalWaves ?? 0 })}</span>
        <span>
          {t("Фаза:")}{" "}
          {phase === TD_PHASE.BUILD
            ? t("сборка")
            : phase === TD_PHASE.WAVE
              ? t("бой")
              : phase === TD_PHASE.INTERMISSION
                ? t("передышка")
                : phase === TD_PHASE.VICTORY
                  ? t("победа")
                  : t("поражение")}
        </span>
        <button className="btn btn--ghost" onClick={onExit}>{t("В лобби")}</button>
      </div>

      {!inWave && !finished && (
        <div className="td__build">
          <div className="td__shop">
            <div className="td__shop-title">{t("Башни")}</div>
            {TOWER_TYPES.map((tower) => (
              <button
                key={tower.id}
                className={`btn ${selectedType === tower.id ? "btn--primary" : "btn--ghost"}`}
                onClick={() => setSelectedType(tower.id)}
              >
                {t(tower.title)} · {tower.cost}
                <small>{t(tower.description)}</small>
              </button>
            ))}
            <div className="td__tip">{t("ЛКМ по клетке — поставить (или улучшить башню), ПКМ — продать.")}</div>
            <button
              className="btn btn--primary"
              disabled={!status?.started || (phase !== TD_PHASE.BUILD && phase !== TD_PHASE.INTERMISSION)}
              onClick={() => emulator.featureCommand("tower-defence", { type: "startWave" })}
            >
              {status?.started ? t("▶ В бой") : t("Загрузка…")}
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
          <h2>{phase === TD_PHASE.VICTORY ? t("Победа! База устояла.") : t("Поражение. База пала.")}</h2>
          <button onClick={onExit}>{t("Вернуться в лобби")}</button>
        </div>
      )}
    </div>
  );
}
