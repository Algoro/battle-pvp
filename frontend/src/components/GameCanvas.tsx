// GameCanvas.tsx — игровой экран: canvas-рендер эмулятора, HUD команд,
// индикатор задержки/rollback, экран результата.
import { useEffect, useRef, useState } from "react";
import { EmulatorDriver } from "../engine/emulator";
import { KeyboardInput } from "../engine/input";
import type { Team } from "../engine/net";
import { buildSoloInputs, determineWinner, isGameplayStarted, isTankAlive } from "../engine/game-state";
import AIControls from "./AIControls";
import TracePanel from "./TracePanel";
import ChatPanel from "./ChatPanel";
import type { ChatMessage } from "../engine/lobby-client";
import type { AudioOutput } from "../engine/audio";
import { GameHud, GameOverlays, type ConnectionInfo } from "./GameUi";

interface Props {
  emulator: EmulatorDriver;
  keyboard: KeyboardInput;
  team: Team;
  port: number; // логический порт игрока
  online?: {
    // Один шаг детерминированного ядра с МОИМИ кнопками (remote добавляет сессия).
    advance: (buttons: number) => void;
    draw: () => void;
    onEvent: (e: any) => void;
    paused?: boolean;
    connection?: ConnectionInfo;
  };
  onResult?: (winner: string | null) => void;
  serverWinner?: string | null;
  onExit?: () => void;
  chat?: ChatMessage[];
  meId?: string;
  onSendChat?: (text: string) => void;
  audio?: AudioOutput;
}

// Чтение статуса команд из RAM (адреса совпадают с bank_ram.inc).
function hudState(emu: EmulatorDriver) {
  return {
    livesDef: emu.readMem(0x51),
    livesDef2: emu.readMem(0x52),
    enemiesLeft: emu.readMem(0x80),
    gameOver: emu.readMem(0x68),
    stage: emu.readMem(0x85),
  };
}

export default function GameCanvas({ emulator, keyboard, team, port, online, onResult, serverWinner, onExit, chat, meId, onSendChat, audio }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ livesDef: 0, livesDef2: 0, enemiesLeft: 0, gameOver: 0, stage: 0xff });
  const [status, setStatus] = useState({ rollbacks: 0, desyncs: 0, latency: 0, mode: "solo" });
  const [result, setResult] = useState<string | null>(null);

  // Онлайн: индикаторы берём из состояния соединения (App), а не из событий сессии.
  const conn = online?.connection;
  useEffect(() => {
    if (conn) setStatus({ rollbacks: conn.rollbacks, desyncs: conn.desyncs, latency: conn.latency, mode: conn.mode || (online ? "online" : "solo") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.rollbacks, conn?.desyncs, conn?.latency, conn?.mode]);

  // соло-режим: автостарт матча + (для ATT) авто-респавн танка игрока.
  // В ОНЛАЙНЕ соло-цикл НЕ запускается — иначе двойной шаг ядра и рассинхрон.
  useEffect(() => {
    if (online) return; // онлайном рулит rollback-сессия (ниже)
    if (!canvasRef.current) return;
    emulator.attachCanvas(canvasRef.current);

    let raf = 0;
    let frame = 0;
    let started = false;
    const loop = () => {
      frame++;
      if (isGameplayStarted(emulator.readMem(0x80))) started = true;
      const inputs = buildSoloInputs({
        port,
        team,
        frame,
        started,
        userButtons: keyboard.mask(),
        attTankAlive: isTankAlive(emulator.readMem(0xa2)),
      });
      emulator.step(inputs);
      setHud(hudState(emulator));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // онлайн-режим: фиксированный шаг 60 Гц — ровно один advanceFrame на игровой кадр,
  // затем один draw(). remote-входы и rollback берёт на себя RollbackSession.
  const onlineRef = useRef(online);
  onlineRef.current = online;
  useEffect(() => {
    if (!online) return;
    if (canvasRef.current) emulator.attachCanvas(canvasRef.current);
    let raf = 0;
    let last = performance.now();
    let accum = 0;
    const STEP = 1000 / 60;
    const tick = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      accum += dt;
      const o = onlineRef.current!;
      let guard = 0;
      while (accum >= STEP && guard++ < 2) {
        o.advance(keyboard.mask());
        accum -= STEP;
      }
      o.draw();
      setHud(hudState(emulator));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!online]);

  // P3: детект конца матча и атрибуция победителя — ТОЛЬКО в реальной игре
  // (stage 1..35). На титуле/демо (stage=0xFF) не определяем результат.
  useEffect(() => {
    if (result) return;
    const w = determineWinner(hud.stage, hud.gameOver, hud.enemiesLeft);
    if (w) {
      setResult(w);
      onResult?.(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.gameOver, hud.enemiesLeft, hud.stage]);

  // Согласованный результат от сервера (на случай, если локальный детект не сработал).
  useEffect(() => {
    if (!result && serverWinner) setResult(serverWinner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverWinner]);

  return (
    <div className="game">
      <GameHud team={team} hud={hud} audio={audio} online={!!online} status={status} />
      <div className="game__body">
        <div className="game__board">
          <canvas ref={canvasRef} className="screen" />
          <div className="controls-hint">WASD/стрелки — движение, Z — огонь, Enter — старт</div>
        </div>
        <aside className="game__side">
          {!online && <AIControls emulator={emulator} defHumanTank={team === "DEF"} />}
          {online && chat && meId && onSendChat && (
            <ChatPanel title="Чат матча" messages={chat} meId={meId} onSend={onSendChat} />
          )}
          <TracePanel emulator={emulator} />
        </aside>
      </div>
      <GameOverlays online={!!online} conn={conn} paused={online?.paused} result={result} team={team} onExit={onExit} />
    </div>
  );
}
