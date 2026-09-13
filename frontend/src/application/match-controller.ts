// match-controller.ts — match controller (frontend application layer).
// Encapsulates battle orchestration: deterministic start, negotiation, RollbackSession,
// frame step, reconnect, result. It knows nothing about React/DOM: it exposes events via
// callbacks, while concrete adapters (EmulatorDriver, LobbyClient/NetClient) are supplied externally.
import type { EmulatorDriver } from "../engine/emulator";
import type { MatchStart } from "../engine/lobby-client";
import { buildSoloInputs, isGameplayStarted, isTankAlive, BTN_START } from "../engine/game-state";
import { bytesToBase64 } from "../engine/b64";
import { tdMapStage, type TdConfig } from "../../../shared/tower-defence.ts";
import { loadLang, translate } from "../i18n/translate.ts";
import type {
  FrameInput,
  MatchGateway,
  NetEvent,
  NegotiatedTransport,
  QuickMatchGateway,
  Team,
  Transport,
} from "../ports";

export interface NetStats {
  status: "solo" | "connecting" | "online" | "reconnecting" | "offline";
  mode: string;
  latency: number;
  desyncs: number;
  rollbacks: number;
  peerOffline: boolean;
}

export const INITIAL_NET: NetStats = {
  status: "solo",
  mode: "",
  latency: 0,
  desyncs: 0,
  rollbacks: 0,
  peerOffline: false,
};

export interface MatchReadyInfo {
  mode: "solo" | "online" | "td";
  team: Team;
  port: number;
  matchId?: string;
}

export interface MatchControllerDeps {
  meId: string;
  backend: string;
  emu: () => EmulatorDriver | null;
  quickMatch: (backend: string) => QuickMatchGateway;
  // Persistent lobby WS connection: reconnect, pause, spectator, finish.
  lobby: () => MatchGateway | null;
  onNet: (net: NetStats) => void;
  onPaused: (paused: boolean) => void;
  onWinner: (winner: Team | null) => void;
  onError: (message: string) => void;
  onReady: (info: MatchReadyInfo) => void;
}

interface OnlineOpponent {
  team: Team;
  port: number;
  playerId: string;
}

// Minimal representation of RollbackSession needed by the controller (port level).
interface SessionPort {
  currentFrame: number;
  advanceFrame(inputs: FrameInput[]): void;
  rebindTransport(transport: Transport): void;
}

export class MatchController {
  private session: SessionPort | null = null;
  private myPorts: number[] = [];
  private myTeam: Team = "DEF";
  private matchId: string | null = null;
  private opponent: OnlineOpponent | null = null;
  private authority = false;
  private paused = false;
  private renegotiating = false;
  private resultSent = false;
  private gateway: MatchGateway | null = null;
  private net: NetStats = { ...INITIAL_NET };
  private readonly deps: MatchControllerDeps;

  constructor(deps: MatchControllerDeps) {
    this.deps = deps;
  }

  private updateNet(patch: Partial<NetStats>): void {
    this.net = { ...this.net, ...patch };
    this.deps.onNet(this.net);
  }

  // Persistent lobby gateway (WS): takes priority over a specific match transport.
  private lobbyGateway(): MatchGateway | null {
    return this.deps.lobby() ?? this.gateway;
  }

  // --- local game ---
  startSolo(team: Team, stage = 1, stars = 0, pistol = false, features: string[] = [], names: Record<number, string> = {}, featureOptions: Record<string, Record<string, string | number | boolean>> = {}): void {
    const emu = this.deps.emu();
    if (!emu) return;
    const feats = [...features];
    emu.setPatchFeatures?.(feats);
    emu.setFeatureOptions?.(featureOptions);
    emu.setPlayerNames?.(names);
    const forcedStage = feats.includes("pacman") ? 1 : stage; // pacman mode plays only the maze (stage 1)
    emu.setStartStage(forcedStage);
    emu.setStartStars(stars);
    emu.setStartPistol?.(pistol && feats.includes("pistol"));
    emu.reset({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    if (team === "ATT") emu.setHumanTank(2);
    if (team === "DEF") emu.setHumanDefTank(0);
    this.clearRuntime();
    this.deps.onPaused(false);
    this.updateNet({ ...INITIAL_NET, status: "solo", mode: "solo" });
    this.deps.onReady({ mode: "solo", team, port: team === "DEF" ? 0 : 2 });
  }

  // --- solo tower defence ---
  startTowerDefence(opts: TdConfig): void {
    const emu = this.deps.emu();
    if (!emu) return;
    emu.setPatchFeatures?.(["tower-defence"]);
    emu.setPlayerNames?.({});
    emu.setStartStage(tdMapStage(opts.map));
    emu.setStartStars(0);
    emu.setStartPistol?.(false);
    emu.reset?.({ attAI: "lookahead", defAI: "off", defMode: "none" });
    if (opts.mobileTank) emu.setHumanDefTank?.(0);
    emu.featureCommand?.("tower-defence", {
      type: "configure",
      map: opts.map,
      difficulty: opts.difficulty,
      startPoints: opts.startPoints,
      waves: opts.waves,
      mobileTank: opts.mobileTank,
    });
    this.clearRuntime();
    this.deps.onPaused(false);
    this.updateNet({ ...INITIAL_NET, status: "solo", mode: "tower-defence" });
    this.deps.onReady({ mode: "td", team: "DEF", port: 0 });
  }

  // --- online match from the lobby ---
  async startOnline(gateway: MatchGateway, start: MatchStart): Promise<void> {
    const meId = this.deps.meId;
    const myPorts = start.peers.filter((p) => p.playerId === meId).map((p) => p.port);
    const myTeam: Team = start.peers.find((p) => p.playerId === meId)?.team || "DEF";
    const opps: OnlineOpponent[] = start.peers
      .filter((p) => p.playerId !== meId)
      .map((p) => ({ team: p.team, port: p.port, playerId: p.playerId }));
    this.deps.lobby()?.rejoinMatch?.(start.matchId, myTeam);
    const names: Record<number, string> = {};
    for (const p of start.peers) {
      if (p.name && p.port !== undefined && p.port !== null) names[p.port] = p.name;
    }
    await this.beginOnlineMatch({
      gateway,
      myTeam,
      myPorts,
      matchId: start.matchId,
      stage: start.stage ?? 1,
      defStars: start.defStars ?? 0,
      defPistol: !!start.defPistol,
      features: start.features ?? [],
      featureOptions: start.featureOptions ?? {},
      names,
      opps,
      negotiate: () =>
        opps.length > 1 && gateway.negotiateAll
          ? gateway.negotiateAll(opps.map((o) => o.playerId), start.matchId)
          : gateway.negotiate(opps[0].playerId, start.matchId),
    });
  }

  // --- quick match (matchmaking + WS negotiation) ---
  async startQuickMatch(team: Team, name = ""): Promise<void> {
    const nc = this.deps.quickMatch(this.deps.backend);
    nc.setCartridgeFingerprint(this.deps.emu()?.cartridgeFingerprint() ?? null);
    const match = await nc.matchmake(this.deps.meId, team, name);
    await nc.connect();
    nc.peerId = match.opponent;
    const oppTeam: Team = team === "DEF" ? "ATT" : "DEF";
    const names: Record<number, string> = {};
    if (name) names[team === "DEF" ? 0 : 2] = name;
    await this.beginOnlineMatch({
      gateway: nc,
      myTeam: team,
      myPorts: team === "DEF" ? [0] : [2],
      matchId: match.matchId,
      stage: 1,
      defStars: 0,
      names,
      opps: [{ team: oppTeam, port: team === "DEF" ? 2 : 0, playerId: match.opponent }],
      negotiate: () => nc.negotiate(),
    });
  }

  private async beginOnlineMatch(opts: {
    gateway: MatchGateway;
    myTeam: Team;
    myPorts: number[];
    matchId: string;
    stage: number;
    defStars: number;
    defPistol?: boolean;
    features?: string[];
    featureOptions?: Record<string, Record<string, string | number | boolean>>;
    names?: Record<number, string>;
    opps: OnlineOpponent[];
    negotiate: () => Promise<NegotiatedTransport>;
  }): Promise<void> {
    const emu = this.deps.emu();
    if (!emu) throw new Error(translate(loadLang(), "эмулятор не загружен"));

    const feats = [...(opts.features || [])];
    emu.setPatchFeatures?.(feats);
    emu.setFeatureOptions?.(opts.featureOptions || {});
    emu.setPlayerNames?.(opts.names || {});
    emu.reset({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    emu.setStartStage(feats.includes("pacman") ? 1 : opts.stage);
    emu.setStartStars(opts.defStars);
    emu.setStartPistol?.(!!opts.defPistol && feats.includes("pistol"));
    const mark = (team: Team, port: number) =>
      team === "DEF" ? emu.setHumanDefTank(port) : emu.setHumanTank(port);
    for (const p of opts.myPorts) mark(opts.myTeam, p);
    for (const o of opts.opps) mark(o.team, o.port);

    // Synchronous auto-start: bring the core to the start of gameplay deterministically.
    let started = false;
    for (let f = 1; f <= 1200 && !started; f++) {
      emu.stepFrame(
        buildSoloInputs({ port: 0, team: "DEF", frame: f, started: false, userButtons: 0, attTankAlive: true }),
      );
      if (isGameplayStarted(emu.readMem(0x80))) started = true;
    }

    this.updateNet({ status: "connecting", mode: "", desyncs: 0, rollbacks: 0, peerOffline: false, latency: 0 });
    let transport: Transport | null = null;
    let mode = "";
    if (opts.opps.length) {
      const r = await opts.negotiate();
      transport = r.transport;
      mode = r.mode || "";
    }

    this.myPorts = opts.myPorts;
    this.myTeam = opts.myTeam;
    this.matchId = opts.matchId;
    this.opponent = opts.opps[0] || null;
    this.gateway = opts.gateway;
    this.paused = false;
    this.deps.onPaused(false);
    try {
      (window as unknown as { __matchId?: string }).__matchId = opts.matchId;
    } catch {
      /* not critical */
    }

    const allIds = [this.deps.meId, ...opts.opps.map((o) => o.playerId)];
    this.authority = this.deps.meId === allIds.slice().sort()[0];
    const extra = { playerId: this.deps.meId, authority: this.authority };
    const remotePorts = opts.opps.map((o) => o.port);
    this.session = transport
      ? (opts.gateway.createSession(
          emu,
          transport,
          opts.myPorts,
          remotePorts,
          (e) => this.handleNetEvent(e),
          extra,
        ) as SessionPort)
      : null;
    this.resultSent = false;
    this.updateNet({ status: transport ? "online" : "solo", mode: mode || (transport ? "online" : "solo") });
    const primary = opts.myPorts[0] ?? (opts.myTeam === "DEF" ? 0 : 2);
    this.deps.onReady({ mode: "online", team: opts.myTeam, port: primary, matchId: opts.matchId });
  }

  // One online game frame: only my ports (+ auto-respawn Start for ATT).
  advance(buttons: number): void {
    if (this.paused) return;
    const sess = this.session;
    if (!sess) return;
    const emu = this.deps.emu();
    if (!emu) return;
    const myInputs: FrameInput[] = this.myPorts.map((p) => ({ port: p, buttons }));
    if (this.myTeam === "ATT" && myInputs.length) {
      const p = myInputs[0].port;
      if (!isTankAlive(emu.readMem(0xa0 + p)) && sess.currentFrame % 30 === 0) {
        myInputs[0].buttons |= BTN_START;
      }
    }
    sess.advanceFrame(myInputs);
    if (this.authority && this.matchId && sess.currentFrame > 0 && sess.currentFrame % 30 === 0) {
      try {
        const bytes = emu.saveState();
        this.lobbyGateway()?.sendSpectateData?.(this.matchId, sess.currentFrame, bytesToBase64(bytes));
      } catch {
        /* spectators are not critical */
      }
    }
  }

  handleNetEvent(e: NetEvent): void {
    switch (e.type) {
      case "latency":
        this.updateNet({ latency: Number(e.ms) || 0 });
        break;
      case "rollback":
        this.updateNet({ rollbacks: this.net.rollbacks + 1 });
        break;
      case "desync":
        this.updateNet({ desyncs: this.net.desyncs + 1, status: "reconnecting" });
        break;
      case "resync":
        this.updateNet({ status: "online" });
        break;
      case "transport-closed":
        this.updateNet({ status: "reconnecting" });
        if (this.lobbyGateway()?.isOpen?.()) void this.renegotiate();
        break;
      default:
        break;
    }
  }

  async renegotiate(): Promise<void> {
    const gateway = this.lobbyGateway();
    const opp = this.opponent;
    const mid = this.matchId;
    const sess = this.session;
    if (!gateway || !opp || !mid || !sess) return;
    if (this.renegotiating) return;
    if (gateway.isOpen && !gateway.isOpen()) return;
    this.renegotiating = true;
    try {
      this.updateNet({ status: "reconnecting" });
      const { transport, mode } = await gateway.negotiate(opp.playerId, mid);
      sess.rebindTransport(transport);
      this.updateNet({ status: "online", mode: mode ?? this.net.mode, peerOffline: false });
      this.setPaused(false);
    } catch (e) {
      this.deps.onError(String((e as Error)?.message || e));
      this.updateNet({ status: "offline" });
    } finally {
      this.renegotiating = false;
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.deps.onPaused(paused);
  }

  // Pause/resume by tab visibility: both sides stop the simulation.
  onVisibilityChange(hidden: boolean): void {
    const gateway = this.lobbyGateway();
    if (!gateway || !this.matchId) return;
    if (hidden) {
      this.setPaused(true);
      gateway.pauseMatch?.(this.matchId);
    } else {
      this.setPaused(false);
      gateway.resumeMatch?.(this.matchId);
    }
  }

  setPeerStatus(patch: Partial<NetStats>): void {
    this.updateNet(patch);
  }

  setWinner(winner: Team | null): void {
    this.deps.onWinner(winner);
  }

  // Locally determined result of the online match: report it to the server (once).
  reportResult(winner: Team | null): void {
    if (!this.session || !this.matchId || this.resultSent) return;
    this.resultSent = true;
    this.lobbyGateway()?.finishMatch?.(this.matchId, winner);
  }

  // Return to the lobby without reloading the page.
  clear(): void {
    this.deps.emu()?.setFeatureOptions?.({});
    this.lobbyGateway()?.clearMatchContext?.();
    // Restore the base set of patches (network/fingerprint) and recreate the core.
    const emu = this.deps.emu();
    if (emu) {
      emu.setPatchFeatures?.([]);
      emu.reset?.({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    }
    this.clearRuntime();
    this.deps.onPaused(false);
    this.deps.onWinner(null);
    this.updateNet({ ...INITIAL_NET });
  }

  private clearRuntime(): void {
    this.session = null;
    this.matchId = null;
    this.opponent = null;
    this.gateway = null;
    this.paused = false;
    this.resultSent = false;
    this.renegotiating = false;
  }
}

export default MatchController;
