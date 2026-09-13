// TowerDefenceSetup.tsx — tower defence pre-start screen: map, difficulty,
// mobile tank. Shows a stage preview from the ROM and launches the mode.
import { useMemo, useState } from "react";
import StagePreview from "./StagePreview";
import { useT } from "../i18n/index.tsx";
import type { EmulatorDriver } from "../engine/emulator";
import {
  TD_MAP_LIST,
  TD_DIFFICULTIES,
  TD_WAVES,
  difficultyById,
  tdMapById,
  tdBlocks,
  tdMapStage,
  type TdConfig,
  type TdDifficulty,
} from "../../../shared/tower-defence.ts";

interface Props {
  emulator: EmulatorDriver | null;
  onCancel: () => void;
  onStart: (config: TdConfig) => void;
}

export default function TowerDefenceSetup({ emulator, onCancel, onStart }: Props) {
  const t = useT();
  const [map, setMap] = useState(TD_MAP_LIST[0].id);
  const [difficulty, setDifficulty] = useState<TdDifficulty>("normal");
  const [mobileTank, setMobileTank] = useState(true);
  const diff = difficultyById(difficulty);
  // The preview is built from the shared map data (the ROM is not patched with the TD feature yet).
  const previewBlocks = useMemo(() => tdBlocks(tdMapById(map)), [map]);

  const start = () => {
    onStart({
      map,
      difficulty,
      startPoints: diff.startPoints,
      waves: TD_WAVES.length,
      mobileTank,
    });
  };

  return (
    <div className="td-setup">
      <h2>Tower Defence</h2>
      <p className="td-setup__hint">
        {t("Покупайте неподвижные танки-башни на очки от уничтожения врагов. Не дайте волнам ATT добраться до базы.")}
      </p>

      <div className="td-setup__row">
        <div className="td-setup__maps">
          {TD_MAP_LIST.map((m) => (
            <button
              key={m.id}
              className={`btn ${map === m.id ? "btn--primary" : "btn--ghost"}`}
              onClick={() => setMap(m.id)}
            >
              {t(m.title)}
            </button>
          ))}
        </div>
        <StagePreview emulator={emulator} stage={tdMapStage(map)} blocks={previewBlocks} size={160} />
      </div>

      <div className="td-setup__row">
        <span className="td-setup__label">{t("Сложность:")}</span>
        {TD_DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            className={`btn ${difficulty === d.id ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setDifficulty(d.id)}
          >
            {t(d.title)}
          </button>
        ))}
        <span className="td-setup__stat">
          {t("очков: {points} · волн: {waves}", { points: diff.startPoints, waves: TD_WAVES.length })}
        </span>
      </div>

      <label className="td-setup__check">
        <input type="checkbox" checked={mobileTank} onChange={(e) => setMobileTank(e.target.checked)} />
        {t("Мобильный танк-командир (управление с клавиатуры)")}
      </label>

      <div className="td-setup__actions">
        <button className="btn btn--primary" onClick={start}>{t("В бой")}</button>
        <button className="btn btn--ghost" onClick={onCancel}>{t("Отмена")}</button>
      </div>
    </div>
  );
}
