// App.tsx — композиция экранов (presenter): лобби -> игра/наблюдение.
// Вся сетевая и игровая оркестрация вынесена в application-контроллеры
// (useMatch / useSpectate / useLobbyClient); здесь — маршрутизация и компоновка.
import { useEffect, useRef, useState } from "react";
import LobbyBrowser from "./components/LobbyBrowser";
import LobbyRoom from "./components/LobbyRoom";
import CreateRoomDialog from "./components/CreateRoomDialog";
import GameCanvas from "./components/GameCanvas";
import SpectateView from "./components/SpectateView";
import { EmulatorDriver } from "./engine/emulator";
import { KeyboardInput } from "./engine/input";
import { AudioOutput } from "./engine/audio";
import NetClient from "./engine/net";
import type { Team } from "./ports";
import { useLobbyClient } from "./application/use-lobby";
import { useMatch } from "./application/use-match";
import { useSpectate } from "./application/use-spectate";

// Пустой VITE_BACKEND_URL => same-origin (SPA и API в одном контейнере/хосте).
const BACKEND = import.meta.env.VITE_BACKEND_URL || "";
const ROM_URL = import.meta.env.BASE_URL + "rom/battle_city.nes";

type Screen =
  | { name: "lobby" }
  | { name: "game"; mode: "solo"; team: Team }
  | { name: "game"; mode: "online"; team: Team; port: number }
  | { name: "spectate"; matchId: string };

function loadId(): string {
  // URL-override: ?player=alice — удобно открывать несколько вкладок под разными игроками
  try {
    const p = new URLSearchParams(location.search).get("player");
    if (p) return p;
  } catch {}
  try {
    const k = "bc_playerId";
    let id = localStorage.getItem(k);
    if (!id) { id = `p_${Math.floor(Math.random() * 1e6)}`; localStorage.setItem(k, id); }
    return id;
  } catch { return `p_${Math.floor(Math.random() * 1e6)}`; }
}
function loadName(): string {
  try {
    const n = new URLSearchParams(location.search).get("name");
    if (n) return n;
  } catch {}
  try { return localStorage.getItem("bc_playerName") || ""; } catch { return ""; }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "lobby" });
  const [rom, setRom] = useState<ArrayBuffer | null>(null);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [meId] = useState(loadId);

  const emuRef = useRef<EmulatorDriver | null>(null);
  const kbRef = useRef<KeyboardInput | null>(null);
  const audioRef = useRef<AudioOutput | null>(null);
  if (!audioRef.current) {
    audioRef.current = new AudioOutput();
    (window as unknown as { __bcAudio?: AudioOutput }).__bcAudio = audioRef.current;
  }

  // Лобби-хук объявляется ниже, но его сеттеры нужны контроллерам — доступ через ref.
  const lRef = useRef<ReturnType<typeof useLobbyClient> | null>(null);

  const match = useMatch({
    meId,
    backend: BACKEND,
    emuRef,
    quickMatch: (backend) => new NetClient(backend),
    lobby: () => lRef.current?.lcRef.current ?? null,
    onReady: ({ mode, team, port, matchId }) => {
      lRef.current?.setLobby(null);
      lRef.current?.setMatchChat([]);
      setCurrentMatchId(matchId ?? null);
      setScreen(mode === "solo" ? { name: "game", mode: "solo", team } : { name: "game", mode: "online", team, port });
    },
    onError: (message) => lRef.current?.setError(message),
  });

  const spectate = useSpectate({
    emuRef,
    onEnter: (matchId) => {
      setCurrentMatchId(matchId);
      lRef.current?.setMatchChat([]);
      match.controller.setPeerStatus({ status: "online", mode: "spectate" });
      setScreen({ name: "spectate", matchId });
    },
  });

  // Лобби-логика и состояние (хук); внешние события отдаются через getHandlers.
  const L = useLobbyClient(meId, loadName() || "Игрок", () => ({
    onMatchStart: (lc, m) => {
      match.controller.startOnline(lc, m).catch((e) => lRef.current?.setError(String(e?.message || e)));
    },
    onSpectateUrl: (lc, matchId) => {
      lRef.current?.setLobby(null);
      spectate.enter(lc, matchId);
    },
    onDisconnected: () => {
      match.controller.setPeerStatus({ status: "reconnecting" });
      match.controller.setPaused(true);
    },
    onReconnected: () => {
      void match.controller.renegotiate();
    },
    onPeerLeft: () => {
      match.controller.setPeerStatus({ status: "reconnecting", peerOffline: true });
      match.controller.setPaused(true);
    },
    onPeerReconnected: () => {
      match.controller.setPeerStatus({ peerOffline: false });
      void match.controller.renegotiate();
    },
    onMatchFinished: (winner) => {
      const w = (winner as Team) ?? null;
      match.controller.setWinner(w);
      spectate.setFinished(w);
    },
    onSpectateData: (m) => spectate.applySnapshot(m),
  }), BACKEND);
  lRef.current = L;
  const lcRef = L.lcRef;

  // грузим ROM один раз
  useEffect(() => {
    if (!rom) fetch(ROM_URL).then((r) => r.arrayBuffer()).then(setRom);
  }, [rom]);

  // netcode-инвариант: сообщаем отпечаток пропатченного картриджа лобби-клиенту.
  useEffect(() => {
    const fp = emuRef.current?.cartridgeFingerprint?.() ?? null;
    lcRef.current?.setCartridgeFingerprint?.(fp);
  }, [rom, lcRef]);

  if (!emuRef.current && rom) {
    const emu = new EmulatorDriver();
    emu.setAudio(audioRef.current);
    emu.loadROM(rom);
    emuRef.current = emu;
    kbRef.current = new KeyboardInput();
    kbRef.current.attach(window);
    (window as unknown as { __bc?: EmulatorDriver }).__bc = emu;
  }

  const startQuickMatch = (team: Team) => {
    L.setBusy(true);
    L.setError(null);
    match.controller
      .startQuickMatch(team, L.meName)
      .catch((e) => {
        lRef.current?.setError(String(e?.message || e));
        lRef.current?.setBusy(false);
      });
  };

  // Возврат в лобби без перезагрузки страницы (WS-соединение сохраняется).
  const returnToLobby = () => {
    setCurrentMatchId(null);
    match.controller.clear();
    L.setMatchChat([]);
    setScreen({ name: "lobby" });
  };

  // Скрытие вкладки останавливает rAF → без паузы соперник «убежит» и rollback разъедется.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) { audioRef.current?.suspend(); } else { audioRef.current?.resume(); }
      match.controller.onVisibilityChange(document.hidden);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (screen.name === "spectate") {
    return (
      <SpectateView
        emulator={emuRef.current!}
        meId={meId}
        chat={L.matchChat}
        frame={spectate.frame}
        finished={spectate.finished}
        onSendChat={(text) => lcRef.current?.sendChat?.("match", text, screen.matchId)}
        onExit={() => {
          const lc = lcRef.current;
          if (lc) spectate.leave(lc, screen.matchId);
          history.replaceState(null, "", location.pathname);
          returnToLobby();
        }}
      />
    );
  }

  if (screen.name === "game") {
    return (
      <GameCanvas
        emulator={emuRef.current!}
        keyboard={kbRef.current!}
        team={screen.team}
        port={screen.mode === "online" ? screen.port : (screen.team === "DEF" ? 0 : 2)}
        serverWinner={match.serverWinner}
        onExit={returnToLobby}
        onResult={screen.mode === "online" ? (winner) => match.controller.reportResult((winner as Team) || null) : undefined}
        chat={screen.mode === "online" ? L.matchChat : undefined}
        meId={meId}
        audio={audioRef.current!}
        onSendChat={screen.mode === "online" ? (text) => { if (currentMatchId) lcRef.current?.sendChat?.("match", text, currentMatchId); } : undefined}
        online={screen.mode === "online"
          ? { advance: (buttons) => match.controller.advance(buttons), draw: () => emuRef.current!.draw(), onEvent: () => {}, paused: match.paused, connection: match.net }
          : undefined}
      />
    );
  }

  return (
    <>
      {L.lobby ? (
        <LobbyRoom
          lobby={L.lobby}
          meId={meId}
          emulator={emuRef.current}
          error={L.error}
          onLeave={L.actions.leave}
          onTeam={L.actions.team}
          onReady={L.actions.ready}
          onStart={L.actions.start}
          onKick={L.actions.kick}
          onSettings={L.actions.settings}
          chat={L.roomChat}
          onSendChat={L.actions.sendRoomChat}
        />
      ) : (
        <LobbyBrowser
          lobbies={L.lobbies}
          meId={meId}
          emulator={emuRef.current}
          meName={L.meName}
          onNameChange={L.setMeName}
          error={L.error}
          busy={L.busy}
          onCreate={() => { L.setError(null); L.setShowCreate(true); }}
          onJoin={L.actions.join}
          onJoinCode={L.actions.joinCode}
          onQuickMatch={() => startQuickMatch("DEF")}
          onSolo={(team, stage, stars, pistol, features) => match.controller.startSolo(team, stage, stars, pistol, features)}
          chat={L.globalChat}
          onSendChat={L.actions.sendGlobalChat}
        />
      )}
      {L.showCreate && (
        <CreateRoomDialog
          emulator={emuRef.current}
          onCancel={() => L.setShowCreate(false)}
          onCreate={(name, settings) => { L.setShowCreate(false); L.actions.create(name, settings); }}
        />
      )}
    </>
  );
}
