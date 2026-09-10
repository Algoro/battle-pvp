// StageSelect.tsx — выбор стадии (1..35) с предпросмотром из ROM в памяти.
import StagePreview from "./StagePreview";
import type { EmulatorDriver } from "../engine/emulator";

interface Props {
  emulator: EmulatorDriver | null;
  stage: number;
  onChange: (stage: number) => void;
  previewSize?: number;
  disabled?: boolean;
}

export default function StageSelect({ emulator, stage, onChange, previewSize = 156, disabled }: Props) {
  const total = emulator?.getStageCount?.() ?? 35;
  const set = (v: number) => onChange(Math.max(1, Math.min(total, v)));
  return (
    <div className="stage-select">
      <div className="stage-select__row">
        <span className="stage-select__label">Стадия {stage} / {total}</span>
        <input
          className="stage-select__range"
          type="range" min={1} max={total} step={1} value={stage}
          disabled={disabled}
          onChange={(e) => set(parseInt(e.target.value, 10))}
        />
        <button className="btn btn--ghost" disabled={disabled || stage <= 1} onClick={() => set(stage - 1)}>−</button>
        <button className="btn btn--ghost" disabled={disabled || stage >= total} onClick={() => set(stage + 1)}>+</button>
      </div>
      <StagePreview emulator={emulator} stage={stage} size={previewSize} />
    </div>
  );
}
