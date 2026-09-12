// TowerDefenceSetup.tsx — предстартовый экран tower defence: карта, сложность,
// мобильный танк. Показывает превью стадии из ROM и запускает режим.
import { useMemo, useState } from "react";
import StagePreview from "./StagePreview";
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
  const [map, setMap] = useState(TD_MAP_LIST[0].id);
  const [difficulty, setDifficulty] = useState<TdDifficulty>("normal");
  const [mobileTank, setMobileTank] = useState(true);
  const diff = difficultyById(difficulty);
  // Предпросмотр строится из общих данных карты (ROM ещё не пропатчен TD-фичей).
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
        Покупайте неподвижные танки-башни на очки от уничтожения врагов. Не дайте волнам ATT
        добраться до базы.
      </p>

      <div className="td-setup__row">
        <div className="td-setup__maps">
          {TD_MAP_LIST.map((m) => (
            <button
              key={m.id}
              className={`btn ${map === m.id ? "btn--primary" : "btn--ghost"}`}
              onClick={() => setMap(m.id)}
            >
              {m.title}
            </button>
          ))}
        </div>
        <StagePreview emulator={emulator} stage={tdMapStage(map)} blocks={previewBlocks} size={160} />
      </div>

      <div className="td-setup__row">
        <span className="td-setup__label">Сложность:</span>
        {TD_DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            className={`btn ${difficulty === d.id ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setDifficulty(d.id)}
          >
            {d.title}
          </button>
        ))}
        <span className="td-setup__stat">очков: {diff.startPoints} · волн: {TD_WAVES.length}</span>
      </div>

      <label className="td-setup__check">
        <input type="checkbox" checked={mobileTank} onChange={(e) => setMobileTank(e.target.checked)} />
        Мобильный танк-командир (управление с клавиатуры)
      </label>

      <div className="td-setup__actions">
        <button className="btn btn--primary" onClick={start}>В бой</button>
        <button className="btn btn--ghost" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
