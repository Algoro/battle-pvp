import { loadLang, translate } from "../i18n/translate.ts";
// net.ts — browser network client: matchmaking + WS signaling + rollback.
// Uses the deterministic core (emulator-core) and netcode (rollback).
import { RollbackSession } from "@netcode/rollback/session.ts";
import { RelayTransport } from "@netcode/transport/relay.ts";
import { WebRTCTransport } from "@netcode/transport/webrtc.ts";
import { getIceServers } from "./ice";
import type { Team } from "../ports";

// Team — domain type: single definition in ports.ts, re-exported here for components.
export type { Team };

export interface MatchInfo {
  matchId: string;
  port: number; // logical player port (0..1 DEF, 2..3 ATT)
  team: Team;
  opponent: string;
}

// Enters the room through the backend: matchmaking + WS join + signaling exchange.
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
    if (!data.room) throw new Error(translate(loadLang(), "queued: ожидание соперника"));
    this.match = { matchId: data.room, port: data.port, team, opponent: data.opponent };
    return this.match;
  }

  // Opens the WS and enters the room. onMessage receives signaling/room messages.
  async connect(onMessage?: (msg: any) => void) {
    this.onMsg = onMessage;
    // same-origin (backendUrl="") -> ws from the current location; otherwise ws from base
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

  // WebRTC pairing: SDP/ICE exchange via signaling. Returns WebRTCTransport
  // or, when P2P is unavailable, RelayTransport (fallback through the backend).
  async negotiate(): Promise<{ transport: any; mode: "webrtc" | "relay" }> {
    const dc = new Promise<any>((resolve, reject) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        const ch = pc.createDataChannel("rollback");
        const t = new WebRTCTransport(ch);
        pc.onicecandidate = (e) =>
          e.candidate && this.send({ type: "signal", to: this.peerId, matchId: this.match!.matchId, data: { ice: e.candidate } });
        pc.ondatachannel = () => { /* receiver */ };
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
      // fallback: relay through the backend
      const rt = new RelayTransport(this.ws, this.match!.matchId, this.peerId!);
      return { transport: rt, mode: "relay" };
    }
  }

  // The signature is aligned with LobbyClient/MatchGateway: onEvent comes before extra.
  createSession(emu: any, transport: any, myPorts: number[], remotePorts: number[], onEvent?: (e: any) => void, extra: any = {}): any {
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
