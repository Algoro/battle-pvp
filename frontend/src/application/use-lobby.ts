// use-lobby.ts — лобби-логика App, вынесенная в хук (декомпозиция god-компонента).
// Управляет LobbyClient, состоянием лобби/чатов/ошибок и действиями над лобби.
// Внешние события (матч, реконнект, spectator) отдаются через getHandlers() — так хук
// не зависит от порядка определения функций в App и не держит устаревшие замыкания.
import { useEffect, useRef, useState } from "react";
import LobbyClient, { LobbyState, ChatMessage, LobbySettings } from "../engine/lobby-client";

export interface LobbyHandlers {
  onMatchStart: (lc: LobbyClient, m: any) => void;
  onSpectateUrl: (lc: LobbyClient, matchId: string) => void;
  onDisconnected: () => void;
  onReconnected: () => void;
  onPeerLeft: () => void;
  onPeerReconnected: () => void;
  onMatchFinished: (winner: any) => void;
  onSpectateData: (m: any) => void;
}

export function useLobbyClient(meId: string, initialName: string, getHandlers: () => LobbyHandlers, backend: string) {
  const [lobbies, setLobbies] = useState<LobbyState[]>([]);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [globalChat, setGlobalChat] = useState<ChatMessage[]>([]);
  const [roomChat, setRoomChat] = useState<ChatMessage[]>([]);
  const [matchChat, setMatchChat] = useState<ChatMessage[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meName, setMeName] = useState(initialName);

  const lcRef = useRef<LobbyClient | null>(null);
  const handlersRef = useRef(getHandlers);
  handlersRef.current = getHandlers;

  // Один WS на всё лобби + хендофф в матч.
  useEffect(() => {
    const lc = new LobbyClient(meId, initialName || "Игрок");
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
    lc.onMatchFinished = (winner) => handlersRef.current().onMatchFinished(winner);
    lc.onSpectateStart = () => {};
    lc.onSpectateData = (m) => handlersRef.current().onSpectateData(m);
    lc.onMatchStart = (m) => handlersRef.current().onMatchStart(lc, m);
    lc.connect(backend)
      .then(() => {
        const specId = new URLSearchParams(location.search).get("spectate");
        if (specId) { handlersRef.current().onSpectateUrl(lc, specId); return; }
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

  // Реконнект-события (перевешиваем на актуальные обработчики через ref).
  useEffect(() => {
    const lc = lcRef.current;
    if (!lc) return;
    lc.onDisconnected = () => handlersRef.current().onDisconnected();
    lc.onReconnected = () => handlersRef.current().onReconnected();
    lc.onPeerLeft = () => handlersRef.current().onPeerLeft();
    lc.onPeerReconnected = () => handlersRef.current().onPeerReconnected();
  }, []);

  useEffect(() => {
    const urlName = new URLSearchParams(location.search).get("name");
    if (!urlName) { try { localStorage.setItem("bc_playerName", meName); } catch {} }
    if (lcRef.current) lcRef.current.name = meName;
  }, [meName]);

  const lc = () => lcRef.current!;
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };

  const actions = {
    create: (name: string, settings: LobbySettings) => run(() => lc().create(settings, name)),
    join: (lobbyId: string) => run(() => lc().join({ lobbyId })),
    joinCode: (code: string) => run(() => lc().join({ code })),
    leave: () => { if (lobby) lc().leave(lobby.id); },
    team: (t: any) => lc().setTeam(lobby!.id, t),
    ready: (r: boolean) => lc().setReady(lobby!.id, r),
    start: () => lc().start(lobby!.id),
    kick: (id: string) => lc().kick(lobby!.id, id),
    settings: (s: Partial<LobbySettings>) => lc().setSettings(lobby!.id, s),
    sendRoomChat: (text: string) => lc().sendChat("lobby", text, lobby!.id),
    sendGlobalChat: (text: string) => lc().sendChat("global", text),
  };

  return {
    lcRef, lc,
    lobbies, lobby, setLobby,
    globalChat, roomChat, matchChat, setMatchChat,
    showCreate, setShowCreate,
    busy, setBusy, error, setError, meName, setMeName,
    actions,
  };
}

export default useLobbyClient;
