// SpectateView.tsx — экран наблюдателя: рендер снапшотов, полученных от игроков,
// и чат матча. Ввод не отправляется (наблюдатель не управляет танками).
import { useEffect, useRef } from "react";
import { EmulatorDriver } from "../engine/emulator";
import ChatPanel from "./ChatPanel";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) emulator.attachCanvas(canvasRef.current);
    emulator.draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="game">
      <div className="hud">
        <span className="ok">Режим: наблюдатель</span>
        <span>кадр: {frame}</span>
        <button className="btn btn--ghost" onClick={onExit}>В лобби</button>
      </div>
      <div className="game__body">
        <div className="game__board">
          <canvas ref={canvasRef} className="screen" />
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
