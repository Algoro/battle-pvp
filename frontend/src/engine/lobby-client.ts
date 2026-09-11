// lobby-client.ts — браузерный клиент лобби: WS-протокол (список игр, комната, чат) +
// хендофф в матч (negotiation WebRTC/relay -> RollbackSession).
import { RollbackSession } from "../../netcode/rollback/session.js";
import { RelayTransport } from "../../netcode/transport/relay.js";
import { WebRTCTransport } from "../../netcode/transport/webrtc.js";
import { MultiTransport } from "../../netcode/transport/multi.js";
import { getIceServers } from "./ice";
import type { Team } from "../ports";

// Тим — доменный тип: единое определение в ports.ts, здесь ре-экспорт для компонентов.
export type { Team };

export interface LobbyPlayer {
  id: string; name: string; team: Team; ready: boolean; host: boolean; port: number; online: boolean;
}
export interface LobbySettings { defSlots: number; attSlots: number; autoStart: boolean; requireReady: boolean; fillBots: boolean; stage: number; defStars: number; }
export interface LobbyState {
  id: string; code: string; name: string; host: string; state: string;
  settings: LobbySettings; slots: { DEF: number; ATT: number }; capacity: number;
  players: LobbyPlayer[]; createdAt: number;
}
export interface ChatMessage { scope: string; id: string | null; from: string; name: string; text: string; ts: number; }
export interface MatchStart { matchId: string; peers: { playerId: string; team: Team; port: number; name?: string }[]; stage?: number; defStars?: number; }

// Клиент лобби поверх одного WS-соединения. События — через колбэки.
export class LobbyClient {
  private ws!: WebSocket;
  public playerId: string;
  public name: string;

  onLobbies?: (lobbies: LobbyState[]) => void;
  onLobby?: (lobby: LobbyState | null) => void;
  onChat?: (msg: ChatMessage) => void;
  onChatHistory?: (scope: string, id: string | null, messages: ChatMessage[]) => void;
  onMatchStart?: (m: MatchStart) => void;
  onError?: (err: string) => void;
  onKicked?: () => void;
  onPaused?: (by: string) => void;
  onResumed?: (by: string) => void;
  onDisconnected?: () => void;
  onReconnected?: () => void;
  onPeerLeft?: (playerId: string) => void;
  onPeerReconnected?: (playerId: string) => void;
  onMatchFinished?: (winner: Team | null) => void;
  onSpectateStart?: (m: { matchId: string; room: any }) => void;
  onSpectateData?: (m: { matchId: string; frame: number; data: string }) => void;

  private joinWaiters: ((j: any) => void)[] = [];
  private signalHandlers = new Map<string, (m: any) => void>();
  private backendUrl = "";
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private matchCtx: { matchId: string; team: Team } | null = null;
  private cartridgeFingerprint: string | null = null;

  setCartridgeFingerprint(fp: string | null) { this.cartridgeFingerprint = fp; }

  constructor(playerId: string, name: string) {
    this.playerId = playerId;
    this.name = name;
  }

  async connect(backendUrl: string): Promise<void> {
    this.backendUrl = backendUrl;
    this.closedByUser = false;
    await this._open();
    this.send({ type: "lobby.subscribe" });
  }

  private _wsUrl(): string {
    return this.backendUrl
      ? this.backendUrl.replace(/^http/, "ws") + "/ws"
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  }

  private async _open(): Promise<void> {
    const ws = new WebSocket(this._wsUrl());
    this.ws = ws;
    ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data));
    ws.onclose = () => this._onClose();
    ws.onerror = () => { /* onclose обработает */ };
    await new Promise<void>((r, j) => {
      ws.onopen = () => r();
      const t = setTimeout(() => j(new Error("ws timeout")), 5000);
      ws.addEventListener("open", () => clearTimeout(t));
    });
  }

  private _onClose() {
    if (this.closedByUser) return;
    this.onDisconnected?.();
    this._scheduleReconnect();
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(400 * 2 ** this.reconnectAttempts, 5000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this._open();
        this.reconnectAttempts = 0;
        this.send({ type: "lobby.subscribe" });
        if (this.matchCtx) {
          this.send({ type: "join", matchId: this.matchCtx.matchId, playerId: this.playerId, team: this.matchCtx.team, name: this.name, cartridgeFingerprint: this.cartridgeFingerprint });
        }
        this.onReconnected?.();
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  // Запомнить контекст матча, чтобы после обрыва WS вернуться в ту же комнату.
  rejoinMatch(matchId: string, team: Team) {
    this.matchCtx = { matchId, team };
  }

  clearMatchContext() {
    this.matchCtx = null;
  }

  // Сообщить серверу о конце матча (согласованный победитель + возврат в лобби).
  finishMatch(matchId: string, winner: Team | null) {
    this.send({ type: "finish", matchId, winner });
    this.matchCtx = null;
  }

  // --- наблюдатель ---
  spectate(matchId: string) { this.send({ type: "spectate", matchId, playerId: this.playerId }); }
  spectateLeave(matchId: string) { this.send({ type: "spectate.leave", matchId }); }
  sendSpectateData(matchId: string, frame: number, data: string) { this.send({ type: "spectate.data", matchId, frame, data }); }

  send(obj: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // --- операции лобби (Promise по lobby.joined) ---
  create(settings: LobbySettings, lobbyName?: string): Promise<{ lobbyId: string; code: string; port: number; team: Team }> {
    const p = this._waitJoin();
    this.send({ type: "lobby.create", playerId: this.playerId, name: this.name, lobbyName, settings, cartridgeFingerprint: this.cartridgeFingerprint });
    return p;
  }
  join(opts: { lobbyId?: string; code?: string; team?: Team }): Promise<{ lobbyId: string; code: string; port: number; team: Team }> {
    const p = this._waitJoin();
    this.send({ type: "lobby.join", playerId: this.playerId, name: this.name, cartridgeFingerprint: this.cartridgeFingerprint, ...opts });
    return p;
  }
  leave(lobbyId?: string) { this.send({ type: "lobby.leave", lobbyId }); this.onLobby?.(null); }
  setTeam(lobbyId: string, team: Team) { this.send({ type: "lobby.team", lobbyId, team }); }
  setReady(lobbyId: string, ready: boolean) { this.send({ type: "lobby.ready", lobbyId, ready }); }
  setSettings(lobbyId: string, settings: Partial<LobbySettings>) { this.send({ type: "lobby.settings", lobbyId, settings }); }
  kick(lobbyId: string, playerId: string) { this.send({ type: "lobby.kick", lobbyId, playerId }); }
  start(lobbyId: string) { this.send({ type: "lobby.start", lobbyId }); }
  sendChat(scope: "global" | "lobby" | "match", text: string, id?: string) { this.send({ type: "chat.send", scope, id, text }); }
  // Пауза матча (при скрытии вкладки) — обе стороны останавливают симуляцию.
  pauseMatch(matchId: string) { this.send({ type: "pause", matchId }); }
  resumeMatch(matchId: string) { this.send({ type: "resume", matchId }); }

  private _waitJoin() {
    return new Promise<any>((res) => this.joinWaiters.push(res));
  }

  _onMessage(m: any) {
    if (m.type === "signal") {
      const h = this.signalHandlers.get(m.from);
      if (h) return h(m);
      return;
    }
    switch (m.type) {
      case "lobbies": this.onLobbies?.(m.lobbies); break;
      case "lobby": this.onLobby?.(m.lobby); break;
      case "lobby.joined": { const w = this.joinWaiters.shift(); w?.(m); break; }
      case "lobby.kicked": this.onKicked?.(); this.onLobby?.(null); break;
      case "chat": this.onChat?.(m); break;
      case "chat.history": this.onChatHistory?.(m.scope, m.id, m.messages); break;
      case "match.start": this.onMatchStart?.(m); break;
      case "paused": this.onPaused?.(m.by); break;
      case "resumed": this.onResumed?.(m.by); break;
      case "peer.left": this.onPeerLeft?.(m.playerId); break;
      case "peer.reconnected": this.onPeerReconnected?.(m.playerId); break;
      case "match.finished": this.onMatchFinished?.(m.winner ?? null); break;
      case "spectate.start": this.onSpectateStart?.(m); break;
      case "spectate.data": this.onSpectateData?.(m); break;
      case "error": this.onError?.(m.error); break;
    }
  }

  // --- хендофф в матч: сопряжение с противником ---
  // Роли детерминированы (меньший playerId = offerer), чтобы не было «glare» двух offer'ов.
  // Возвращает транспорт и режим (webrtc | relay). Сигналинг идёт через тот же WS.
  async negotiate(peerId: string, matchId: string): Promise<{ transport: any; mode: "webrtc" | "relay" }> {
    const iAmOfferer = this.playerId < peerId;
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const dc = new Promise<any>((resolve) => {
      const finish = (ch: RTCDataChannel) => {
        const t = new WebRTCTransport(ch);
        ch.onopen = () => resolve(t);
      };
      if (iAmOfferer) finish(pc.createDataChannel("rollback"));
      else pc.ondatachannel = (e: any) => finish(e.channel);
    });
    pc.onicecandidate = (e) =>
      e.candidate && this.send({ type: "signal", to: peerId, matchId, data: { ice: e.candidate } });
    this.signalHandlers.set(peerId, async (m) => {
      if (m.from !== peerId) return;
      try {
        if (m.data?.sdp) {
          await pc.setRemoteDescription(m.data.sdp);
          if (m.data.sdp.type === "offer") {
            const a = await pc.createAnswer();
            await pc.setLocalDescription(a);
            this.send({ type: "signal", to: peerId, matchId, data: { sdp: pc.localDescription } });
          }
        } else if (m.data?.ice) {
          await pc.addIceCandidate(m.data.ice);
        }
      } catch { /* игнор некорректного сигнала */ }
    });
    if (iAmOfferer) {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      this.send({ type: "signal", to: peerId, matchId, data: { sdp: pc.localDescription } });
    }
    try {
      const t = await Promise.race([
        dc,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("webrtc timeout")), 6000)),
      ]);
      return { transport: t, mode: "webrtc" };
    } catch {
      return { transport: new RelayTransport(this.ws, matchId, peerId), mode: "relay" };
    }
  }

  createSession(emu: any, transport: any, myPorts: number[], remotePorts: number[], onEvent?: (e: any) => void, extra: any = {}): any {
    return new RollbackSession({ game: emu, transport, myPorts, remotePorts, onEvent, window: 120, ...extra });
  }

  // Сопряжение со всеми соперниками (2v2 / N). Один -> обычный транспорт,
  // несколько -> MultiTransport (вещание/мультиплекс).
  async negotiateAll(peerIds: string[], matchId: string): Promise<{ transport: any; mode: "webrtc" | "relay" }> {
    const results: { transport: any; mode: "webrtc" | "relay" }[] = [];
    for (const pid of peerIds) results.push(await this.negotiate(pid, matchId));
    if (results.length === 1) return results[0];
    const transport = new MultiTransport(results.map((r) => r.transport));
    const mode: "webrtc" | "relay" = results.some((r) => r.mode === "relay") ? "relay" : "webrtc";
    return { transport, mode };
  }

  close() { this.closedByUser = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.ws?.close(); }
}

export default LobbyClient;
