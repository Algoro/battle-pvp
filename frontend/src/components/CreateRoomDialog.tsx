// CreateRoomDialog.tsx — создание игры с настройкой числа слотов по сторонам.
import { useState } from "react";
import StageSelect from "./StageSelect";
import StarsSelect from "./StarsSelect";
import FeaturePicker from "./FeaturePicker";
import RenderPicker from "./RenderPicker";
import type { LobbySettings } from "../engine/lobby-client";
import type { EmulatorDriver } from "../engine/emulator";

interface Props {
  onCreate: (name: string, settings: LobbySettings) => void;
  onCancel: () => void;
  emulator?: EmulatorDriver | null;
}

export default function CreateRoomDialog({ onCreate, onCancel, emulator }: Props) {
  const [name, setName] = useState("Моя игра");
  const [defSlots, setDefSlots] = useState(2);
  const [attSlots, setAttSlots] = useState(2);
  const [autoStart, setAutoStart] = useState(false);
  const [requireReady, setRequireReady] = useState(false);
  const [stage, setStage] = useState(1);
  const [defStars, setDefStars] = useState(0);
  const [defPistol, setDefPistol] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);

  return (
    <div className="modal" onClick={onCancel}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <h3>Создать игру</h3>
        <label className="modal__field">
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="modal__field">
          <span>Защитники: {defSlots} (1–2)</span>
          <input type="range" min={1} max={2} value={defSlots} onChange={(e) => setDefSlots(+e.target.value)} />
        </label>
        <label className="modal__field">
          <span>Атакующие: {attSlots} (1–6)</span>
          <input type="range" min={1} max={6} value={attSlots} onChange={(e) => setAttSlots(+e.target.value)} />
        </label>
        <label className="modal__field modal__check">
          <span>Авто-старт при полном лобби</span>
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
        </label>
        <label className="modal__field modal__check">
          <span>Старт только когда все готовы</span>
          <input type="checkbox" checked={requireReady} onChange={(e) => setRequireReady(e.target.checked)} />
        </label>
        <div className="modal__field">
          <StageSelect emulator={emulator ?? null} stage={stage} onChange={setStage} previewSize={140} />
          <StarsSelect
            stars={defStars}
            onChange={setDefStars}
            pistol={defPistol}
            onPistolChange={features.includes("pistol") ? setDefPistol : undefined}
          />
        </div>
        <div className="modal__field">
          <FeaturePicker
            features={features}
            onChange={(next) => {
              setFeatures(next);
              if (!next.includes("pistol")) setDefPistol(false);
            }}
          />
        </div>
        <div className="modal__field">
          <RenderPicker emulator={emulator} stage={stage} />
        </div>
        <p className="modal__hint">Пустые слоты добьёт ИИ. Игра будет ждать подключения игроков, пока ты не нажмёшь «Старт».</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Отмена</button>
          <button
            className="btn btn--primary"
            onClick={() => onCreate(name.trim() || "Игра", { defSlots, attSlots, autoStart, requireReady, fillBots: true, stage, defStars, defPistol, features })}
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}
