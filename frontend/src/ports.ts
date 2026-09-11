// ports.ts — порты (интерфейсы) фронтенда. Слой application и компоненты зависят от
// контрактов, а не от конкретных реализаций (jsnes, WebRTC, WebSocket, React).
// Реализации-адаптеры живут в ./engine (EmulatorDriver, LobbyClient, NetClient).

export type Team = "DEF" | "ATT";

export interface FrameInput {
  port: number;
  buttons: number;
}

// Порт игрового ядра: детерминированная симуляция + снимки состояния.
// Реализуется EmulatorDriver (обёртка PvPNes/jsnes) и fake-ядром в тестах.
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

// Порт транспорта netcode.
export interface Transport {
  send(buf: Uint8Array): void;
  onMessage(cb: (buf: Uint8Array) => void): void;
  onClose?(cb: () => void): void;
  isOpen?(): boolean;
}

// Порт времени (для ping/pong) — инъектируется, в тестах подменяется.
export interface Clock {
  now(): number;
}

// Порт событий (события матча/сессии наружу).
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

// Шлюз лобби/матча: то, что application-контроллеру нужно от сети.
// Структурно реализуется LobbyClient и NetClient (см. ./engine).
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

// Шлюз быстрого матча (matchmaking + один пир). Реализуется NetClient (./engine/net).
export interface QuickMatchGateway extends MatchGateway {
  peerId: string | null;
  setCartridgeFingerprint(fp: string | null): void;
  matchmake(playerId: string, team: Team, name?: string): Promise<MatchmakeResult>;
  connect(): Promise<void>;
}

export default {};
