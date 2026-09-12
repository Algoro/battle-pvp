// SpectateView.tsx — экран наблюдателя: рендер снапшотов, полученных от игроков,
// и чат матча. Ввод не отправляется (наблюдатель не управляет танками).
import { useEffect, useRef, useState } from "react";
import { EmulatorDriver } from "../engine/emulator";
import ChatPanel from "./ChatPanel";
import RenderSettings from "./RenderSettings";
import { RenderSystem } from "../render/render-system";
import { readScene } from "../render/scene-state";
import type { ChatMessage } from "../engine/lobby-client";

interface Props {
  emulator: EmulatorDriver;
  meId: string;
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  frame: number;
  finished: string | null;
  onExit: () => void;
}

export default function SpectateView({ emulator, meId, chat, onSendChat, frame, finished, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [render, setRender] = useState<RenderSystem | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sys = new RenderSystem({ container: el, scene: () => readScene(emulator) });
    sys.setViewer({ port: 0 });
    emulator.setFrameRenderer(() => sys.frame());
    setRender(sys);
    let raf = 0;
    const loop = () => {
      emulator.draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      emulator.setFrameRenderer(null);
      sys.dispose();
      setRender(null);
    };
  }, [emulator]);

  return (
    <div className="game">
      <div className="hud">
        <span className="ok">Режим: наблюдатель</span>
        <span>кадр: {frame}</span>
        <button className="btn btn--ghost" onClick={onExit}>В лобби</button>
      </div>
      <div className="game__body">
        <div className="game__board">
          <div ref={containerRef} className="screen-stage" />
          <RenderSettings system={render} />
          <div className="controls-hint">Просмотр матча (без управления)</div>
        </div>
        <aside className="game__side">
          <ChatPanel title="Чат матча" messages={chat} meId={meId} onSend={onSendChat} />
        </aside>
      </div>
      {finished && (
        <div className="result">
          <h2>Матч завершён. Победила команда {finished === "DEF" ? "защитников" : "атакующих"}</h2>
          <button onClick={onExit}>Вернуться в лобби</button>
        </div>
      )}
    </div>
  );
}
