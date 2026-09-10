// TracePanel.tsx — лог/трейс решений каждого ИИ с фильтрами событий.
// Получает события из ядра (pvp.js: side, event, goal, dir, fire, tank, frame).
// Опрос ядра по таймеру (не каждый кадр), фильтрация и рендер в прокручиваемый список.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EmulatorDriver } from "../engine/emulator";

interface Props {
  emulator: EmulatorDriver;
}

type Filter = { side: string; event: string; tank: string; goal: string; text: string };

const EVENT_COLORS: Record<string, string> = {
  decision: "#7aa2f7",
  dead: "#ff5c5c",
  attAI: "#ffd54a",
  defAI: "#ffd54a",
};

export default function TracePanel({ emulator }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [cap, setCap] = useState(300);
  const [filter, setFilter] = useState<Filter>({ side: "all", event: "all", tank: "all", goal: "all", text: "" });
  const [events, setEvents] = useState<any[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Включение сбора трейса на ядре.
  useEffect(() => {
    emulator.setTraceEnabled(enabled);
    emulator.setTraceCap(cap);
    if (!enabled) setEvents([]);
  }, [enabled, cap, emulator]);

  // Периодический опрос ядра и автоскролл к последнему событию.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setEvents(emulator.getTrace());
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 350);
    return () => clearInterval(id);
  }, [enabled, emulator]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filter.side !== "all" && e.side !== filter.side) return false;
      if (filter.event !== "all" && e.event !== filter.event) return false;
      if (filter.tank !== "all" && String(e.tank) !== filter.tank) return false;
      if (filter.goal !== "all" && (e.goal ?? "") !== filter.goal) return false;
      if (filter.text && !JSON.stringify(e).toLowerCase().includes(filter.text.toLowerCase())) return false;
      return true;
    });
  }, [events, filter]);

  const sides = ["all", ...new Set(events.map((e) => e.side))];
  const events_ = ["all", ...new Set(events.map((e) => e.event))];
  const tanks = ["all", ...new Set(events.filter((e) => e.tank != null).map((e) => String(e.tank)))];
  const goals = ["all", ...new Set(events.filter((e) => e.goal).map((e) => e.goal))];

  const fmt = (e: any) => {
    const parts = [`f${e.frame}`, `#${e.id}`, `[${e.side}]`];
    if (e.tank != null) parts.push(`T${e.tank}`);
    if (e.event === "decision") {
      parts.push(e.goal ?? "move");
      if (e.dir != null) parts.push("dir=" + ["↑", "←", "↓", "→"][e.dir]);
      if (e.fire) parts.push("🔥");
    } else {
      parts.push(e.event);
      if (e.detail) parts.push(String(e.detail));
    }
    return parts.join(" ");
  };

  return (
    <div className="trace">
      <div className="trace__head">
        <span className="trace__title">Трейс ИИ</span>
        <label className="trace__toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          сбор
        </label>
        <select className="trace__cap" value={cap} onChange={(e) => setCap(Number(e.target.value))} title="лимит строк">
          {[100, 300, 500, 1000].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="trace__clear" onClick={() => emulator.clearTrace()}>очистить</button>
      </div>

      <div className="trace__filters">
        <select value={filter.side} onChange={(e) => setFilter({ ...filter, side: e.target.value })}>
          {sides.map((s) => <option key={s} value={s}>{s === "all" ? "все стороны" : s}</option>)}
        </select>
        <select value={filter.event} onChange={(e) => setFilter({ ...filter, event: e.target.value })}>
          {events_.map((s) => <option key={s} value={s}>{s === "all" ? "все события" : s}</option>)}
        </select>
        <select value={filter.tank} onChange={(e) => setFilter({ ...filter, tank: e.target.value })}>
          {tanks.map((s) => <option key={s} value={s}>{s === "all" ? "все танки" : `T${s}`}</option>)}
        </select>
        <select value={filter.goal} onChange={(e) => setFilter({ ...filter, goal: e.target.value })}>
          {goals.map((s) => <option key={s} value={s}>{s === "all" ? "все цели" : s}</option>)}
        </select>
        <input
          className="trace__search"
          placeholder="поиск…"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
      </div>

      <div className="trace__list" ref={listRef}>
        {filtered.slice(-cap).map((e) => (
          <div
            key={e.id}
            className="trace__row"
            style={{ color: EVENT_COLORS[e.event] ?? "#c9d1d9" }}
          >
            {fmt(e)}
          </div>
        ))}
        {filtered.length === 0 && <div className="trace__empty">нет событий</div>}
      </div>
    </div>
  );
}
