// CreateRoomDialog.tsx — creating a game with the number of slots configured per side.
import { useState } from "react";
import StageSelect from "./StageSelect";
import StarsSelect from "./StarsSelect";
import FeaturePicker, { type FeatureOptions } from "./FeaturePicker";
import RenderPicker from "./RenderPicker";
import type { LobbySettings } from "../engine/lobby-client";
import type { EmulatorDriver } from "../engine/emulator";
import { useT } from "../i18n/index.tsx";

interface Props {
  onCreate: (name: string, settings: LobbySettings) => void;
  onCancel: () => void;
  emulator?: EmulatorDriver | null;
}

export default function CreateRoomDialog({ onCreate, onCancel, emulator }: Props) {
  const t = useT();
  const [name, setName] = useState(() => t("Моя игра"));
  const [defSlots, setDefSlots] = useState(2);
  const [attSlots, setAttSlots] = useState(2);
  const [autoStart, setAutoStart] = useState(false);
  const [requireReady, setRequireReady] = useState(false);
  const [stage, setStage] = useState(1);
  const [defStars, setDefStars] = useState(0);
  const [defPistol, setDefPistol] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [featureOptions, setFeatureOptions] = useState<FeatureOptions>({});

  return (
    <div className="modal" onClick={onCancel}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <h3>{t("Создать игру")}</h3>
        <label className="modal__field">
          <span>{t("Название")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="modal__field">
          <span>{t("Защитники: {count} (1–2)", { count: defSlots })}</span>
          <input type="range" min={1} max={2} value={defSlots} onChange={(e) => setDefSlots(+e.target.value)} />
        </label>
        <label className="modal__field">
          <span>{t("Атакующие: {count} (1–6)", { count: attSlots })}</span>
          <input type="range" min={1} max={6} value={attSlots} onChange={(e) => setAttSlots(+e.target.value)} />
        </label>
        <label className="modal__field modal__check">
          <span>{t("Авто-старт при полном лобби")}</span>
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
        </label>
        <label className="modal__field modal__check">
          <span>{t("Старт только когда все готовы")}</span>
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
            options={featureOptions}
            onOptionsChange={(id, values) => setFeatureOptions((prev) => ({ ...prev, [id]: values }))}
          />
        </div>
        <div className="modal__field">
          <RenderPicker emulator={emulator} stage={stage} />
        </div>
        <p className="modal__hint">{t("Пустые слоты добьёт ИИ. Игра будет ждать подключения игроков, пока ты не нажмёшь «Старт».")}</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>{t("Отмена")}</button>
          <button
            className="btn btn--primary"
            onClick={() => onCreate(name.trim() || t("Игра"), { defSlots, attSlots, autoStart, requireReady, fillBots: true, stage, defStars, defPistol, features, featureOptions })}
          >
            {t("Создать")}
          </button>
        </div>
      </div>
    </div>
  );
}
