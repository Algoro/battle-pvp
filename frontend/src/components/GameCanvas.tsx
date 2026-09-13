// GameCanvas.tsx — game screen: emulator canvas render, team HUD,
// latency/rollback indicator, result screen.
import { useEffect, useRef, useState } from "react";
import { EmulatorDriver } from "../engine/emulator";
import { KeyboardInput } from "../engine/input";
import type { Team } from "../engine/net";
import { buildSoloInputs, determineWinner, isGameplayStarted, isTankAlive } from "../engine/game-state";
import AIControls from "./AIControls";
import TracePanel from "./TracePanel";
import ChatPanel from "./ChatPanel";
import RenderSettings from "./RenderSettings";
import { RenderSystem } from "../render/render-system";
import { readScene } from "../render/scene-state";
import type { ChatMessage } from "../engine/lobby-client";
import type { AudioOutput } from "../engine/audio";
import { GameHud, GameOverlays, type ConnectionInfo } from "./GameUi";
import { useT } from "../i18n/index.tsx";

interface Props {
  emulator: EmulatorDriver;
  keyboard: KeyboardInput;
  team: Team;
  port: number; // logical player port
  online?: {
    // One step of the deterministic core with MY buttons (remote is added by the session).
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

// Read team status from RAM (addresses match bank_ram.inc).
function hudState(emu: EmulatorDriver) {
  return {
    livesDef: emu.readMem(0x51),
    livesDef2: emu.readMem(0x52),
    enemiesLeft: emu.readMem(0x80),
    gameOver: emu.readMem(0x68),
    stage: emu.readMem(0x85),
    pacmanWin: emu.readMem(0x1fe),
  };
}

export default function GameCanvas({ emulator, keyboard, team, port, online, onResult, serverWinner, onExit, chat, meId, onSendChat, audio }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [render, setRender] = useState<RenderSystem | null>(null);
  const [hud, setHud] = useState({ livesDef: 0, livesDef2: 0, enemiesLeft: 0, gameOver: 0, stage: 0xff, pacmanWin: 0 });
  const [status, setStatus] = useState({ rollbacks: 0, desyncs: 0, latency: 0, mode: "solo" });
  const [result, setResult] = useState<string | null>(null);

  // Render layer: the driver/extensions are chosen by RenderSettings. The core only updates
  // state, while the frame is drawn by RenderSystem (2D/3D/…), without affecting determinism.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sys = new RenderSystem({ container: el, scene: () => readScene(emulator) });
    sys.setViewer({ port });
    emulator.setFrameRenderer(() => sys.frame());
    setRender(sys);
    return () => {
      emulator.setFrameRenderer(null);
      sys.dispose();
      setRender(null);
    };
  }, [emulator, port]);

  // Online: take indicators from the connection state (App), not from session events.
  const conn = online?.connection;
  useEffect(() => {
    if (conn) setStatus({ rollbacks: conn.rollbacks, desyncs: conn.desyncs, latency: conn.latency, mode: conn.mode || (online ? "online" : "solo") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.rollbacks, conn?.desyncs, conn?.latency, conn?.mode]);

  // solo mode: auto-start the match + (for ATT) auto-respawn of the player's tank.
  // In ONLINE mode the solo loop is NOT started — otherwise the core would step twice and desync.
  useEffect(() => {
    if (online) return; // online is driven by the rollback session (below)
    if (!containerRef.current) return;

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

  // online mode: fixed 60 Hz step — exactly one advanceFrame per game frame,
  // then one draw(). Remote inputs and rollback are handled by RollbackSession.
  const onlineRef = useRef(online);
  onlineRef.current = online;
  useEffect(() => {
    if (!online) return;
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

  // P3: match end detection and winner attribution — ONLY in a real game
  // (stage 1..35). On the title/demo (stage=0xFF) we do not determine the result.
  useEffect(() => {
    if (result) return;
    const w = determineWinner(hud.stage, hud.gameOver, hud.enemiesLeft, hud.pacmanWin);
    if (w) {
      setResult(w);
      onResult?.(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.gameOver, hud.enemiesLeft, hud.stage, hud.pacmanWin]);

  // Agreed result from the server (in case local detection did not fire).
  useEffect(() => {
    if (!result && serverWinner) setResult(serverWinner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverWinner]);

  return (
    <div className="game">
      <GameHud team={team} hud={hud} audio={audio} online={!!online} status={status} />
      <div className="game__body">
        <div className="game__board">
          <div ref={containerRef} className="screen-stage" />
          <RenderSettings system={render} />
          <div className="controls-hint">{t("WASD/стрелки — движение, Z — огонь, Enter — старт")}</div>
        </div>
        <aside className="game__side">
          {!online && <AIControls emulator={emulator} defHumanTank={team === "DEF"} />}
          {online && chat && meId && onSendChat && (
            <ChatPanel title={t("Чат матча")} messages={chat} meId={meId} onSend={onSendChat} />
          )}
          <TracePanel emulator={emulator} />
        </aside>
      </div>
      <GameOverlays online={!!online} conn={conn} paused={online?.paused} result={result} team={team} onExit={onExit} />
    </div>
  );
}
