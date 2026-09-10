// AudioControl.tsx — раздельные громкость и mute для музыки и эффектов.
// Настройки хранятся в AudioOutput (localStorage).
import { useState } from "react";
import type { AudioOutput } from "../engine/audio";

interface Props {
  audio: AudioOutput;
}

function Row(
  { label, muted, volume, onToggle, onChange }: {
    label: string; muted: boolean; volume: number;
    onToggle: () => void; onChange: (v: number) => void;
  },
) {
  return (
    <span className="audio-ctl__row">
      <button className="audio-ctl__btn" onClick={onToggle} title={`${label}: ${muted ? "включить" : "выключить"}`}>
        {muted ? "🔇" : "🔊"}
      </button>
      <span className="audio-ctl__label">{label}</span>
      <input
        className="audio-ctl__range"
        type="range" min={0} max={1} step={0.05}
        value={volume}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        title={`${label} ${Math.round(volume * 100)}%`}
      />
    </span>
  );
}

export default function AudioControl({ audio }: Props) {
  const [musicMuted, setMusicMuted] = useState(audio.musicMuted);
  const [sfxMuted, setSfxMuted] = useState(audio.sfxMuted);
  const [musicVolume, setMusicVolume] = useState(audio.musicVolume);
  const [sfxVolume, setSfxVolume] = useState(audio.sfxVolume);

  return (
    <span className="audio-ctl">
      <Row
        label="Музыка"
        muted={musicMuted}
        volume={musicVolume}
        onToggle={() => { const m = !musicMuted; setMusicMuted(m); audio.setMusicMuted(m); audio.start(); }}
        onChange={(v) => { setMusicVolume(v); audio.setMusicVolume(v); audio.start(); }}
      />
      <Row
        label="Эффекты"
        muted={sfxMuted}
        volume={sfxVolume}
        onToggle={() => { const m = !sfxMuted; setSfxMuted(m); audio.setSfxMuted(m); audio.start(); }}
        onChange={(v) => { setSfxVolume(v); audio.setSfxVolume(v); audio.start(); }}
      />
    </span>
  );
}
