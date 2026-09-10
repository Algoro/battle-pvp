// App.tsx — конечный автомат интерфейса: lobby (браузер/комната) -> game (solo/online).
import { useEffect, useRef, useState } from "react";
import LobbyBrowser from "./components/LobbyBrowser";
import LobbyRoom from "./components/LobbyRoom";
import CreateRoomDialog from "./components/CreateRoomDialog";
import GameCanvas from "./components/GameCanvas";
import SpectateView from "./components/SpectateView";
import { EmulatorDriver, FrameInput } from "./engine/emulator";
import { KeyboardInput } from "./engine/input";
import { buildSoloInputs, isGameplayStarted, isTankAlive, BTN_START } from "./engine/game-state";
import { bytesToBase64, base64ToBytes } from "./engine/b64";
import NetClient, { Team } from "./engine/net";
import LobbyClient, { LobbyState, ChatMessage, LobbySettings, MatchStart } from "./engine/lobby-client";

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
  const sessionRef = useRef<any>(null);
  const myPortsRef = useRef<number[]>([]);
  const myTeamRef = useRef<Team>("DEF");
  const matchIdRef = useRef<string | null>(null);
  const oppRef = useRef<{ team: Team; port: number; playerId: string } | null>(null);
  const isAuthorityRef = useRef(false);
  const renegotiatingRef = useRef(false);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const setPause = (v: boolean) => { pausedRef.current = v; setPaused(v); };
  const emuRef = useRef<EmulatorDriver | null>(null);
  const kbRef = useRef<KeyboardInput | null>(null);

  // Состояние соединения для UX (экран «Соединение…», режим, задержка, DESYNC).
  const [net, setNet] = useState<{
    status: "solo" | "connecting" | "online" | "reconnecting" | "offline";
    mode: string;
    latency: number;
    desyncs: number;
    rollbacks: number;
    peerOffline: boolean;
  }>({ status: "solo", mode: "", latency: 0, desyncs: 0, rollbacks: 0, peerOffline: false });

  // События rollback-сессии -> состояние соединения.
  const handleNetEvent = (e: any) => {
    switch (e.type) {
      case "latency":
        setNet((s) => ({ ...s, latency: e.ms }));
        break;
      case "rollback":
        setNet((s) => ({ ...s, rollbacks: s.rollbacks + 1 }));
        break;
      case "desync":
        setNet((s) => ({ ...s, desyncs: s.desyncs + 1, status: "reconnecting" }));
        break;
      case "resync":
        setNet((s) => ({ ...s, status: "online" }));
        break;
      case "transport-closed":
        setNet((s) => ({ ...s, status: "reconnecting" }));
        if (lcRef.current?.isOpen?.()) renegotiate().catch(() => {});
        break;
      default:
        break;
    }
  };

  // Пере-сопряжение транспорта с соперником (после обрыва/реконнекта).
  const renegotiate = async () => {
    const lc = lcRef.current;
    const opp = oppRef.current;
    const mid = matchIdRef.current;
    const sess = sessionRef.current;
    if (!lc || !opp || !mid || !sess) return;
    if (renegotiatingRef.current) return;
    if (!lc.isOpen?.()) return; // ждём восстановления WS
    renegotiatingRef.current = true;
    try {
      setNet((s) => ({ ...s, status: "reconnecting" }));
      const { transport, mode } = await lc.negotiate(opp.playerId, mid);
      sess.rebindTransport(transport);
      setNet((s) => ({ ...s, status: "online", mode, peerOffline: false }));
      setPause(false);
    } catch (e: any) {
      setError(String(e?.message || e));
      setNet((s) => ({ ...s, status: "offline" }));
    } finally {
      renegotiatingRef.current = false;
    }
  };

  const [meId] = useState(loadId);
  const [meName, setMeName] = useState(() => loadName() || "Игрок");
  const lcRef = useRef<LobbyClient | null>(null);
  const [lobbies, setLobbies] = useState<LobbyState[]>([]);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [globalChat, setGlobalChat] = useState<ChatMessage[]>([]);
  const [roomChat, setRoomChat] = useState<ChatMessage[]>([]);
  const [matchChat, setMatchChat] = useState<ChatMessage[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverWinner, setServerWinner] = useState<Team | null>(null);
  const resultSentRef = useRef(false);
  const [specFrame, setSpecFrame] = useState(0);
  const [specFinished, setSpecFinished] = useState<Team | null>(null);

  // грузим ROM один раз
  useEffect(() => {
    if (!rom) fetch(ROM_URL).then((r) => r.arrayBuffer()).then(setRom);
  }, [rom]);

  // netcode-инвариант: сообщаем отпечаток пропатченного картриджа лобби-клиенту.
  useEffect(() => {
    const fp = emuRef.current?.cartridgeFingerprint?.() ?? null;
    lcRef.current?.setCartridgeFingerprint?.(fp);
  }, [rom]);

  if (!emuRef.current && rom) {
    const emu = new EmulatorDriver();
    emu.loadROM(rom);
    emuRef.current = emu;
    kbRef.current = new KeyboardInput();
    kbRef.current.attach(window);
    (window as any).__bc = emu;
  }

  // Общий старт онлайн-матча: детерминированный сброс ядра (общий «кадр 0»),
  // пометка человеческих танков, СИНХРОННЫЙ автостарт партии (порт 0 Start),
  // затем negotiation + RollbackSession. Всё, кроме negotiation, идентично у обоих клиентов.
  const beginOnlineMatch = async (opts: {
    myTeam: Team;
    myPorts: number[];
    matchId: string;
    opps: { team: Team; port: number; playerId: string }[];
    negotiate: () => Promise<{ transport: any; mode?: string }>;
    createSession: (emu: EmulatorDriver, transport: any, myPorts: number[], remotePorts: number[], extra?: any) => any;
  }) => {
    const { myTeam, myPorts, opps } = opts;
    const emu = emuRef.current!;

    // 1) детерминированный сброс → идентичное начальное состояние у обоих
    emu.reset({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    // 2) человеческие танки (мои и соперников) — чтобы локальный ИИ за них не играл
    const mark = (team: Team, port: number) => (team === "DEF" ? emu.setHumanDefTank(port) : emu.setHumanTank(port));
    for (const p of myPorts) mark(myTeam, p);
    for (const o of opps) mark(o.team, o.port);

    // 3) синхронный старт партии: кормим порт 0 Start каждые 30 кадров, пока игра не начнётся.
    //    Последовательность детерминирована и одинакова у обоих клиентов → состояния сходятся.
    let started = false;
    for (let f = 1; f <= 1200 && !started; f++) {
      emu.stepFrame(buildSoloInputs({ port: 0, team: "DEF", frame: f, started: false, userButtons: 0, attTankAlive: true }));
      if (isGameplayStarted(emu.readMem(0x80))) started = true;
    }

    // 4) транспорт (WebRTC/relay): со всеми соперниками сразу
    let transport: any = null;
    let mode = "";
    setNet((s) => ({ ...s, status: "connecting", mode: "", desyncs: 0, rollbacks: 0, peerOffline: false, latency: 0 }));
    if (opps.length) {
      const r = await opts.negotiate();
      transport = r.transport;
      mode = r.mode || "";
    }

    // 5) rollback-сессия
    myPortsRef.current = myPorts;
    myTeamRef.current = myTeam;
    matchIdRef.current = opts.matchId;
    try { (window as any).__matchId = opts.matchId; } catch {}
    oppRef.current = opps[0] || null;
    pausedRef.current = false;
    setPaused(false);
    const allIds = [meId, ...opps.map((o) => o.playerId)];
    const authority = meId === allIds.slice().sort()[0];
    const extra = { playerId: meId, authority };
    isAuthorityRef.current = authority;
    const remotePorts = opps.map((o) => o.port);
    const sess = transport ? opts.createSession(emu, transport, myPorts, remotePorts, extra) : null;
    sessionRef.current = sess;
    setNet((s) => ({ ...s, status: transport ? "online" : "solo", mode: mode || (transport ? "online" : "solo") }));
    const primary = myPorts[0] ?? (myTeam === "DEF" ? 0 : 2);
    setLobby(null);
    setMatchChat([]);
    setScreen({ name: "game", mode: "online", team: myTeam, port: primary });
  };

  // Хендофф лобби -> матч.
  const startOnlineMatch = async (lc: LobbyClient, m: MatchStart) => {
    const myPorts = m.peers.filter((p) => p.playerId === meId).map((p) => p.port);
    const myTeam: Team = m.peers.find((p) => p.playerId === meId)?.team || "DEF";
    const opps = m.peers.filter((p) => p.playerId !== meId).map((p) => ({ team: p.team, port: p.port, playerId: p.playerId }));
    lc.rejoinMatch(m.matchId, myTeam);
    try {
      await beginOnlineMatch({
        myTeam,
        myPorts,
        matchId: m.matchId,
        opps,
        negotiate: () => lc.negotiateAll(opps.map((o) => o.playerId), m.matchId),
        createSession: (emu, transport, mp, rp, extra) => lc.createSession(emu, transport, mp, rp, handleNetEvent, extra),
      });
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  // Вход в режим наблюдателя: подписываемся на снапшоты матча.
  const enterSpectate = (lc: LobbyClient, matchId: string) => {
    const go = () => {
      if (!emuRef.current) { setTimeout(go, 100); return; } // ждём загрузки ROM
      setSpecFrame(0);
      setSpecFinished(null);
      setMatchChat([]);
      setNet((s) => ({ ...s, status: "online", mode: "spectate" }));
      lc.spectate(matchId);
      setScreen({ name: "spectate", matchId });
    };
    go();
  };

  // Лобби-клиент: один WS на всё лобби + хендофф в матч.
  useEffect(() => {
    const lc = new LobbyClient(meId, loadName() || "Игрок");
    lcRef.current = lc;
    lc.onLobbies = setLobbies;
    lc.onLobby = (l) => { setLobby(l); setBusy(false); };
    lc.onChat = (m) =>
      m.scope === "global"
        ? setGlobalChat((p) => [...p.slice(-99), m])
        : m.scope === "match"
          ? setMatchChat((p) => [...p.slice(-99), m])
          : setRoomChat((p) => [...p.slice(-99), m]);
    lc.onChatHistory = (scope, _id, msgs) =>
      scope === "global" ? setGlobalChat(msgs) : scope === "match" ? setMatchChat(msgs) : setRoomChat(msgs);
    lc.onError = (e) => { setError(e); setBusy(false); };
    lc.onKicked = () => { setError("Вас исключили из комнаты"); setLobby(null); setBusy(false); };
    lc.onPaused = () => setPause(true);
    lc.onResumed = () => setPause(false);
    // Реконнект: при обрыве замираем, после возврата обе стороны пере-сопрягают транспорт.
    lc.onDisconnected = () => {
      setNet((s) => ({ ...s, status: "reconnecting" }));
      setPause(true);
    };
    lc.onReconnected = () => { renegotiate().catch(() => {}); };
    lc.onPeerLeft = () => {
      setNet((s) => ({ ...s, status: "reconnecting", peerOffline: true }));
      setPause(true);
    };
    lc.onPeerReconnected = () => {
      setNet((s) => ({ ...s, peerOffline: false }));
      renegotiate().catch(() => {});
    };
    // Согласованный конец матча от сервера (победитель определён и записан).
    lc.onMatchFinished = (winner) => {
      setServerWinner((winner as Team) ?? null);
      setSpecFinished((winner as Team) ?? null);
    };
    // Наблюдатель: получаем снапшоты состояния и рисуем их.
    lc.onSpectateStart = () => {};
    lc.onSpectateData = (m) => {
      const emu = emuRef.current;
      if (!emu) return;
      try {
        emu.loadState(base64ToBytes(m.data));
        emu.draw();
        setSpecFrame(m.frame);
      } catch { /* игнорируем битый снапшот */ }
    };
    lc.onMatchStart = (m) => { startOnlineMatch(lc, m).catch((e) => setError(String(e?.message || e))); };
    lc.connect(BACKEND)
      .then(() => {
        // режим наблюдателя ?spectate=MATCHID
        const specId = new URLSearchParams(location.search).get("spectate");
        if (specId) { enterSpectate(lc, specId); return; }
        // авто-вход по инвайт-ссылке ?lobby=CODE — только после открытия WS
        const code = new URLSearchParams(location.search).get("lobby");
        if (code) {
          setBusy(true);
          lc.join({ code })
            .then(() => history.replaceState(null, "", location.pathname))
            .catch((e) => { setError(String(e?.message || e)); setBusy(false); });
        }
      })
      .catch(() => setError("Нет связи с сервером"));
    return () => lc.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // не затираем дефолтное имя, если оно задано через ?name= (мульти-игрок в одном браузере)
    const urlName = new URLSearchParams(location.search).get("name");
    if (!urlName) { try { localStorage.setItem("bc_playerName", meName); } catch {} }
    if (lcRef.current) lcRef.current.name = meName;
  }, [meName]);

  useEffect(() => {
    // Скрытие вкладки останавливает rAF у этого клиента → без паузы соперник «убежит»
    // и rollback разъедется. Поэтому при фоне — пауза матча у ОБОИХ, при возврате — resume.
    const onVis = () => {
      const lc = lcRef.current;
      const mid = matchIdRef.current;
      if (!lc || !mid) return;
      if (document.hidden) { setPause(true); lc.pauseMatch(mid); }
      else { setPause(false); lc.resumeMatch(mid); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSolo = (team: Team) => {
    if (team === "ATT" && emuRef.current) emuRef.current.setHumanTank(2);
    if (team === "DEF" && emuRef.current) emuRef.current.setHumanDefTank(0);
    setScreen({ name: "game", mode: "solo", team });
  };

  const startQuickMatch = async (team: Team) => {
    setBusy(true); setError(null);
    try {
      const nc = new NetClient(BACKEND);
      nc.setCartridgeFingerprint(emuRef.current?.cartridgeFingerprint?.() ?? null);
      const match = await nc.matchmake(meId, team, meName);
      await nc.connect();
      nc.peerId = match.opponent;
      const oppTeam: Team = team === "DEF" ? "ATT" : "DEF";
      await beginOnlineMatch({
        myTeam: team,
        myPorts: team === "DEF" ? [0] : [2],
        matchId: match.matchId,
        opps: [{ team: oppTeam, port: team === "DEF" ? 2 : 0, playerId: match.opponent }],
        negotiate: () => nc.negotiate(),
        createSession: (emu, transport, mp, rp, extra) => nc.createSession(emu, transport, mp, rp, extra),
      });
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  // Один игровой кадр онлайна: только МОИ порты (+ авто-респавн Start для ATT).
  const onlineAdvance = (buttons: number) => {
    if (pausedRef.current) return; // пауза (вкладка в фоне / пауза соперника) — не шагаем
    const sess = sessionRef.current;
    if (!sess) return;
    const emu = emuRef.current!;
    const myInputs: FrameInput[] = myPortsRef.current.map((p) => ({ port: p, buttons }));
    if (myTeamRef.current === "ATT" && myInputs.length) {
      const p = myInputs[0].port;
      if (!isTankAlive(emu.readMem(0xa0 + p)) && sess.currentFrame % 30 === 0) {
        myInputs[0].buttons |= BTN_START;
      }
    }
    sess.advanceFrame(myInputs);

    // Наблюдатели: авторитет периодически рассылает полный снапшот состояния.
    if (isAuthorityRef.current && matchIdRef.current && sess.currentFrame > 0 && sess.currentFrame % 30 === 0) {
      try {
        const bytes = emuRef.current!.saveState();
        lcRef.current?.sendSpectateData?.(matchIdRef.current, sess.currentFrame, bytesToBase64(bytes));
      } catch { /* наблюдатели не критичны */ }
    }
  };

  // Возврат в лобби без перезагрузки страницы (WS-соединение сохраняется).
  const returnToLobby = () => {
    sessionRef.current = null;
    matchIdRef.current = null;
    oppRef.current = null;
    pausedRef.current = false;
    resultSentRef.current = false;
    setPaused(false);
    setServerWinner(null);
    setMatchChat([]);
    setNet({ status: "solo", mode: "", latency: 0, desyncs: 0, rollbacks: 0, peerOffline: false });
    lcRef.current?.clearMatchContext?.();
    setScreen({ name: "lobby" });
  };

  // Локально определённый результат онлайн-матча: сообщаем серверу (один раз).
  const handleOnlineResult = (winner: string | null) => {
    const s = sessionRef.current;
    const mid = matchIdRef.current;
    if (!s || !mid || resultSentRef.current) return;
    resultSentRef.current = true;
    lcRef.current?.finishMatch?.(mid, (winner as Team) || null);
  };

  // --- обработчики лобби ---
  const lc = () => lcRef.current!;
  const doCreate = async (name: string, settings: LobbySettings) => {
    setBusy(true); setError(null);
    try { await lc().create(settings, name); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };
  const doJoin = async (lobbyId: string) => {
    setBusy(true); setError(null);
    try { await lc().join({ lobbyId }); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };
  const doJoinCode = async (code: string) => {
    setBusy(true); setError(null);
    try { await lc().join({ code }); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };
  const doLeave = () => { if (lobby) lc().leave(lobby.id); };

  if (screen.name === "spectate") {
    return (
      <SpectateView
        emulator={emuRef.current!}
        meId={meId}
        chat={matchChat}
        frame={specFrame}
        finished={specFinished}
        onSendChat={(text) => lcRef.current?.sendChat?.("match", text, screen.matchId)}
        onExit={() => {
          lcRef.current?.spectateLeave?.(screen.matchId);
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
        serverWinner={serverWinner}
        onExit={returnToLobby}
        onResult={screen.mode === "online" ? handleOnlineResult : undefined}
        chat={screen.mode === "online" ? matchChat : undefined}
        meId={meId}
        onSendChat={screen.mode === "online" ? (text) => { const mid = matchIdRef.current; if (mid) lcRef.current?.sendChat?.("match", text, mid); } : undefined}
        online={screen.mode === "online"
          ? { advance: onlineAdvance, draw: () => emuRef.current!.draw(), onEvent: () => {}, paused, connection: net }
          : undefined}
      />
    );
  }

  return (
    <>
      {lobby ? (
        <LobbyRoom
          lobby={lobby}
          meId={meId}
          error={error}
          onLeave={doLeave}
          onTeam={(t) => lc().setTeam(lobby.id, t)}
          onReady={(r) => lc().setReady(lobby.id, r)}
          onStart={() => lc().start(lobby.id)}
          onKick={(id) => lc().kick(lobby.id, id)}
          onSettings={(s) => lc().setSettings(lobby.id, s)}
          chat={roomChat}
          onSendChat={(text) => lc().sendChat("lobby", text, lobby.id)}
        />
      ) : (
        <LobbyBrowser
          lobbies={lobbies}
          meId={meId}
          meName={meName}
          onNameChange={setMeName}
          error={error}
          busy={busy}
          onCreate={() => { setError(null); setShowCreate(true); }}
          onJoin={doJoin}
          onJoinCode={doJoinCode}
          onQuickMatch={() => startQuickMatch("DEF")}
          onSolo={startSolo}
          chat={globalChat}
          onSendChat={(text) => lc().sendChat("global", text)}
        />
      )}
      {showCreate && (
        <CreateRoomDialog
          onCancel={() => setShowCreate(false)}
          onCreate={(name, settings) => { setShowCreate(false); doCreate(name, settings); }}
        />
      )}
    </>
  );
}
