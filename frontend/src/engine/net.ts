// net.ts — браузерный сетевой клиент: matchmaking + WS-signaling + rollback.
// Использует детерминированное ядро (emulator-core) и netcode (rollback).
import { RollbackSession } from "../../netcode/rollback/session.js";
import { RelayTransport } from "../../netcode/transport/relay.js";
import { WebRTCTransport } from "../../netcode/transport/webrtc.js";
import { getIceServers } from "./ice";

export type Team = "DEF" | "ATT";

export interface MatchInfo {
  matchId: string;
  port: number; // логический порт игрока (0..1 DEF, 2..3 ATT)
  team: Team;
  opponent: string;
}

// Входит в комнату через backend: матчмейкинг + WS join + обмен signaling.
export class NetClient {
  private ws!: WebSocket;
  public match: MatchInfo | null = null;
  public peerId: string | null = null;
  private onMsg?: (msg: any) => void;
  private pid = "me";
  private pname = "player";
  private fingerprint: string | null = null;

  constructor(private backendUrl: string) {}

  setCartridgeFingerprint(fp: string | null) { this.fingerprint = fp; }

  async matchmake(playerId: string, team: Team, name?: string): Promise<MatchInfo> {
    this.pid = playerId || "me";
    this.pname = name || playerId || "player";
    const res = await fetch(`${this.backendUrl}/matchmake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: this.pid, team, name: this.pname, cartridgeFingerprint: this.fingerprint }),
    });
    const data = await res.json();
    if (!data.room) throw new Error("queued: ожидание соперника");
    this.match = { matchId: data.room, port: data.port, team, opponent: data.opponent };
    return this.match;
  }

  // Открывает WS и входит в комнату. onMessage получает сообщения signaling/room.
  async connect(onMessage?: (msg: any) => void) {
    this.onMsg = onMessage;
    // same-origin (backendUrl="") -> ws из текущего location; иначе ws из base
    const wsUrl = this.backendUrl
      ? this.backendUrl.replace(/^http/, "ws") + "/ws"
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (ev) => this.onMsg?.(JSON.parse(ev.data));
    await new Promise<void>((r, j) => {
      this.ws.onopen = () => r();
      this.ws.onerror = () => j(new Error("ws error"));
    });
    this.ws.send(
      JSON.stringify({
        type: "join",
        matchId: this.match!.matchId,
        playerId: this.pid,
        team: this.match!.team,
        name: this.pname,
        cartridgeFingerprint: this.fingerprint,
      }),
    );
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  // Сопряжение WebRTC: обмен SDP/ICE через signaling. Возвращает WebRTCTransport
  // либо, при недоступности P2P, RelayTransport (fallback через backend).
  async negotiate(): Promise<{ transport: any; mode: "webrtc" | "relay" }> {
    const dc = new Promise<any>((resolve, reject) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        const ch = pc.createDataChannel("rollback");
        const t = new WebRTCTransport(ch);
        pc.onicecandidate = (e) =>
          e.candidate && this.send({ type: "signal", to: this.peerId, matchId: this.match!.matchId, data: { ice: e.candidate } });
        pc.ondatachannel = () => { /* получатель */ };
        this.onMsg = (m) => {
          if (m.type === "signal") {
            if (m.data?.sdp) pc.setRemoteDescription(m.data.sdp).then(() => pc.createAnswer()).then((a) => pc.setLocalDescription(a)).then(() => this.send({ type: "signal", to: this.peerId, matchId: this.match!.matchId, data: { sdp: pc.localDescription } }));
            else if (m.data?.ice) pc.addIceCandidate(m.data.ice);
          }
        };
        ch.onopen = () => resolve(t);
        pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.send({ type: "signal", to: this.peerId, matchId: this.match!.matchId, data: { sdp: pc.localDescription } }));
        setTimeout(() => reject(new Error("webrtc timeout")), 5000);
      } catch (e) {
        reject(e);
      }
    });
    try {
      const t = await dc;
      return { transport: t, mode: "webrtc" };
    } catch {
      // fallback: relay через backend
      const rt = new RelayTransport(this.ws, this.match!.matchId, this.peerId!);
      return { transport: rt, mode: "relay" };
    }
  }

  createSession(emu: any, transport: any, myPorts: number[], remotePorts: number[], extra: any = {}, onEvent?: (e: any) => void): any {
    return new RollbackSession({
      game: emu,
      transport,
      myPorts,
      remotePorts,
      onEvent,
      window: 120,
      ...extra,
    });
  }

  close() {
    this.ws?.close();
  }
}

export default NetClient;
