// use-match.ts — React-хук контроллера матча: связывает MatchController с состоянием UI.
// Вся сетевая/игровая оркестрация живёт в контроллере; хук — только мост к React.
import { useRef, useState, type MutableRefObject } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import type { MatchGateway, QuickMatchGateway, Team } from "../ports";
import {
  INITIAL_NET,
  MatchController,
  type MatchReadyInfo,
  type NetStats,
} from "./match-controller";

export interface UseMatchOptions {
  meId: string;
  backend: string;
  emuRef: MutableRefObject<EmulatorDriver | null>;
  quickMatch: (backend: string) => QuickMatchGateway;
  lobby: () => MatchGateway | null;
  onReady: (info: MatchReadyInfo) => void;
  onError?: (message: string) => void;
}

export interface UseMatchResult {
  net: NetStats;
  paused: boolean;
  serverWinner: Team | null;
  controller: MatchController;
}

export function useMatch(opts: UseMatchOptions): UseMatchResult {
  const [net, setNet] = useState<NetStats>({ ...INITIAL_NET });
  const [paused, setPaused] = useState(false);
  const [serverWinner, setServerWinner] = useState<Team | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const controllerRef = useRef<MatchController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new MatchController({
      meId: opts.meId,
      backend: opts.backend,
      emu: () => optsRef.current.emuRef.current,
      quickMatch: (backend) => optsRef.current.quickMatch(backend),
      lobby: () => optsRef.current.lobby(),
      onNet: setNet,
      onPaused: setPaused,
      onWinner: setServerWinner,
      onError: (message) => optsRef.current.onError?.(message),
      onReady: (info) => optsRef.current.onReady(info),
    });
  }

  return { net, paused, serverWinner, controller: controllerRef.current };
}

export default useMatch;
