// match-controller.ts — контроллер матча (application-слой фронтенда).
// Инкапсулирует оркестрацию боя: детерминированный старт, negotiation, RollbackSession,
// шаг кадра, реконнект, результат. Не знает о React/DOM: наружу отдаёт события через
// колбэки, а конкретные адаптеры (EmulatorDriver, LobbyClient/NetClient) подаются извне.
import type { EmulatorDriver } from "../engine/emulator";
import type { MatchStart } from "../engine/lobby-client";
import { buildSoloInputs, isGameplayStarted, isTankAlive, BTN_START } from "../engine/game-state";
import { bytesToBase64 } from "../engine/b64";
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
  mode: "solo" | "online";
  team: Team;
  port: number;
  matchId?: string;
}

export interface MatchControllerDeps {
  meId: string;
  backend: string;
  emu: () => EmulatorDriver | null;
  quickMatch: (backend: string) => QuickMatchGateway;
  // Постоянное WS-соединение лобби: реконнект, пауза, spectator, финиш.
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

// Минимальное представление RollbackSession, нужное контроллеру (порт-уровень).
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

  // Постоянный лобби-шлюз (WS): приоритетнее транспорта конкретного матча.
  private lobbyGateway(): MatchGateway | null {
    return this.deps.lobby() ?? this.gateway;
  }

  // --- локальная игра ---
  startSolo(team: Team, stage = 1, stars = 0, pistol = false, features: string[] = [], names: Record<number, string> = {}): void {
    const emu = this.deps.emu();
    if (!emu) return;
    const feats = [...features];
    emu.setPatchFeatures?.(feats);
    emu.setPlayerNames?.(names);
    const forcedStage = feats.includes("pacman") ? 1 : stage; // режим pacman играет только лабиринт (stage 1)
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

  // --- онлайн-матч из лобби ---
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
      names,
      opps,
      negotiate: () =>
        opps.length > 1 && gateway.negotiateAll
          ? gateway.negotiateAll(opps.map((o) => o.playerId), start.matchId)
          : gateway.negotiate(opps[0].playerId, start.matchId),
    });
  }

  // --- быстрый матч (matchmaking + WS negotiation) ---
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
    names?: Record<number, string>;
    opps: OnlineOpponent[];
    negotiate: () => Promise<NegotiatedTransport>;
  }): Promise<void> {
    const emu = this.deps.emu();
    if (!emu) throw new Error("эмулятор не загружен");

    const feats = [...(opts.features || [])];
    emu.setPatchFeatures?.(feats);
    emu.setPlayerNames?.(opts.names || {});
    emu.reset({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    emu.setStartStage(feats.includes("pacman") ? 1 : opts.stage);
    emu.setStartStars(opts.defStars);
    emu.setStartPistol?.(!!opts.defPistol && feats.includes("pistol"));
    const mark = (team: Team, port: number) =>
      team === "DEF" ? emu.setHumanDefTank(port) : emu.setHumanTank(port);
    for (const p of opts.myPorts) mark(opts.myTeam, p);
    for (const o of opts.opps) mark(o.team, o.port);

    // Синхронный автостарт: доводим ядро до начала геймплея детерминированно.
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
      /* не критично */
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

  // Один игровой кадр онлайна: только мои порты (+ авто-респавн Start для ATT).
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
        /* наблюдатели не критичны */
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

  // Пауза/возобновление по видимости вкладки: обе стороны останавливают симуляцию.
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

  // Локально определённый результат онлайн-матча: сообщаем серверу (один раз).
  reportResult(winner: Team | null): void {
    if (!this.session || !this.matchId || this.resultSent) return;
    this.resultSent = true;
    this.lobbyGateway()?.finishMatch?.(this.matchId, winner);
  }

  // Возврат в лобби без перезагрузки страницы.
  clear(): void {
    this.lobbyGateway()?.clearMatchContext?.();
    // Вернуть базовый набор патчей (сеть/fingerprint) и пересоздать ядро.
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
