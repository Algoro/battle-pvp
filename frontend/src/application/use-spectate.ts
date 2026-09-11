// use-spectate.ts — контроллер режима наблюдателя: снапшоты матча -> ядро.
// React-хук хранит кадр/итог, а сеть дёргает через переданный шлюз (LobbyClient).
import { useRef, useState, type MutableRefObject } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import { base64ToBytes } from "../engine/b64";
import type { MatchGateway, Team } from "../ports";

export interface SpectateSnapshot {
  matchId: string;
  frame: number;
  data: string;
}

export interface UseSpectateOptions {
  emuRef: MutableRefObject<EmulatorDriver | null>;
  onEnter: (matchId: string) => void;
}

export interface UseSpectateResult {
  frame: number;
  finished: Team | null;
  setFinished: (winner: Team | null) => void;
  enter: (gateway: MatchGateway, matchId: string) => void;
  applySnapshot: (m: SpectateSnapshot) => void;
  leave: (gateway: MatchGateway, matchId: string) => void;
}

export function useSpectate(opts: UseSpectateOptions): UseSpectateResult {
  const [frame, setFrame] = useState(0);
  const [finished, setFinished] = useState<Team | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Ждём загрузки ROM/ядра, затем сообщаем серверу о наблюдении.
  const enter = (gateway: MatchGateway, matchId: string): void => {
    const go = () => {
      if (!optsRef.current.emuRef.current) {
        setTimeout(go, 100);
        return;
      }
      setFrame(0);
      setFinished(null);
      gateway.spectate?.(matchId);
      optsRef.current.onEnter(matchId);
    };
    go();
  };

  const applySnapshot = (m: SpectateSnapshot): void => {
    const emu = optsRef.current.emuRef.current;
    if (!emu) return;
    try {
      emu.loadState(base64ToBytes(m.data));
      emu.draw();
      setFrame(m.frame);
    } catch {
      /* битый снапшот */
    }
  };

  const leave = (gateway: MatchGateway, matchId: string): void => {
    gateway.spectateLeave?.(matchId);
    setFinished(null);
  };

  return { frame, finished, setFinished, enter, applySnapshot, leave };
}

export default useSpectate;
