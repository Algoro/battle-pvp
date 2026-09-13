// AIControls.tsx — переключение ИИ атакующих/защитников ПРЯМО в игре (на лету).
// Читает доступные режимы у ядра (pvp.js), переключает выбранный мозг через
// emulator.setAttAI/setDefAI. Состояние мозга сбрасывается ядром при смене режима.
import { useState } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import { useT } from "../i18n/index.tsx";

interface Props {
  emulator: EmulatorDriver;
  defHumanTank?: boolean; // играет ли человек за защитников (тогда ИИ рулит только союзником)
  onModeChange?: () => void;
}

const ATT_LABEL: Record<string, string> = {
  plan: "plan (тактический)",
  scan: "scan (сканирование)",
  lookahead: "lookahead (предсказание)",
  "strategy-att": "strategy-att (слой)",
  asm: "asm (родной)",
  off: "выкл (заморозить)",
};
const DEF_LABEL: Record<string, string> = {
  plan: "plan (planDefense)",
  scan: "scan (защита)",
  lookahead: "lookahead (защита)",
  strategy: "strategy (стратегический)",
  off: "выкл (стоять)",
};

export default function AIControls({ emulator, defHumanTank, onModeChange }: Props) {
  const t = useT();
  const [attAI, setAttAI] = useState(emulator.getAttAI());
  const [defAI, setDefAI] = useState(emulator.getDefAI());

  return (
    <div className="aic">
      <div className="aic__title">{t("ИИ на лету")}</div>

      <label className="aic__field">
        <span className="aic__label">{t("Атакующие (враги)")}</span>
        <select value={attAI} onChange={(e) => { setAttAI(e.target.value); emulator.setAttAI(e.target.value); onModeChange?.(); }}>
          {emulator.getAttModes().map((m) => (
            <option key={m} value={m}>{t(ATT_LABEL[m] ?? m)}</option>
          ))}
        </select>
      </label>

      <label className="aic__field">
        <span className="aic__label">{defHumanTank ? t("Защитники (союзник)") : t("Защитники")}</span>
        <select value={defAI} onChange={(e) => { setDefAI(e.target.value); emulator.setDefAI(e.target.value); onModeChange?.(); }}>
          {emulator.getDefModes().map((m) => (
            <option key={m} value={m}>{t(DEF_LABEL[m] ?? m)}</option>
          ))}
        </select>
      </label>

      <p className="aic__hint">
        {t("Смена применится со следующего кадра. Состояние выбранного ИИ сбрасывается (холодный старт).")}
      </p>
    </div>
  );
}
