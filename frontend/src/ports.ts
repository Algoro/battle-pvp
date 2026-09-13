// ports.ts — frontend ports (interfaces). The application layer and components depend on
// contracts, not on concrete implementations (jsnes, WebRTC, WebSocket, React).
// Adapter implementations live in ./engine (EmulatorDriver, LobbyClient, NetClient).

export type Team = "DEF" | "ATT";

export interface FrameInput {
  port: number;
  buttons: number;
}

// Game core port: deterministic simulation + state snapshots.
// Implemented by EmulatorDriver (PvPNes/jsnes wrapper) and the fake core in tests.
export interface GameCore {
  stepFrame(inputs: FrameInput[]): string;
  saveState(): Uint8Array;
  loadState(bytes: Uint8Array): void;
  getFrameHash(): string;
  cartridgeFingerprint?(): string | null;
  setAudioSuppressed?(suppressed: boolean): void;
  setStartStage?(stage: number): void;
  setStartStars?(stars: number): void;
  readMem?(addr: number): number;
  setHumanTank?(tank: number): void;
  setHumanDefTank?(tank: number): void;
  draw?(): void;
}

// Netcode transport port.
export interface Transport {
  send(buf: Uint8Array): void;
  onMessage(cb: (buf: Uint8Array) => void): void;
  onClose?(cb: () => void): void;
  isOpen?(): boolean;
}

// Time port (for ping/pong) — injected, replaced in tests.
export interface Clock {
  now(): number;
}

// Event port (match/session events outward).
export interface EventSink {
  emit(event: unknown): void;
}

export interface NegotiatedTransport {
  transport: Transport;
  mode?: string;
}

export interface NetEvent {
  type: string;
  [key: string]: unknown;
}

// Lobby/match gateway: what the application controller needs from the network.
// Structurally implemented by LobbyClient and NetClient (see ./engine).
export interface MatchGateway {
  rejoinMatch?(matchId: string, team: Team): void;
  clearMatchContext?(): void;
  finishMatch?(matchId: string, winner: Team | null): void;
  negotiate(peerId?: string, matchId?: string): Promise<NegotiatedTransport>;
  negotiateAll?(peerIds: string[], matchId: string): Promise<NegotiatedTransport>;
  createSession(
    core: GameCore,
    transport: Transport,
    myPorts: number[],
    remotePorts: number[],
    onEvent: (e: NetEvent) => void,
    extra?: Record<string, unknown>,
  ): unknown;
  sendSpectateData?(matchId: string, frame: number, data: string): void;
  spectate?(matchId: string): void;
  spectateLeave?(matchId: string): void;
  sendChat?(scope: "global" | "lobby" | "match", text: string, id?: string): void;
  pauseMatch?(matchId: string): void;
  resumeMatch?(matchId: string): void;
  isOpen?(): boolean;
}

export interface MatchmakeResult {
  matchId: string;
  port: number;
  team: Team;
  opponent: string;
}

// Quick match gateway (matchmaking + one peer). Implemented by NetClient (./engine/net).
export interface QuickMatchGateway extends MatchGateway {
  peerId: string | null;
  setCartridgeFingerprint(fp: string | null): void;
  matchmake(playerId: string, team: Team, name?: string): Promise<MatchmakeResult>;
  connect(): Promise<void>;
}

export default {};
