// ChatPanel.tsx — панель чата (лобби/комната): список сообщений + ввод.
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../engine/lobby-client";

interface Props {
  title: string;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  meId: string;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatPanel({ title, messages, onSend, meId, disabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="chat">
      <div className="chat__title">{title}</div>
      <div className="chat__list" ref={listRef}>
        {messages.length === 0 && <div className="chat__empty">Пока пусто</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat__msg${m.from === meId ? " is-me" : ""}`}>
            <span className="chat__name">{m.name}</span>
            <span className="chat__text">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={placeholder || (disabled ? "Нет соединения" : "Сообщение…")}
          disabled={disabled}
        />
        <button className="btn btn--ghost" disabled={disabled || !text.trim()}>
          →
        </button>
      </form>
    </div>
  );
}
