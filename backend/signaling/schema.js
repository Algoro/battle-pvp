// schema.js — декларативная валидация входящих WS-сообщений (без внешних зависимостей).
//
// Защищает обработчики relay от неполных/некорректных сообщений и делает контракт
// протокола явным. Валидация — минимально необходимая (обязательные поля), лишние
// поля допускаются для обратной совместимости.
//
// Относительный путь: ./backend/signaling/schema.js

const S = (name, type, required = true) => ({ name, type, required });

// type: "string" | "number" | "boolean" | "object" | "team" | "string?"
const RULES = {
  join: [S("matchId", "string"), S("playerId", "string"), S("team", "team", false)],
  signal: [S("to", "string"), S("matchId", "string"), S("data", "object")],
  "relay.data": [S("to", "string"), S("matchId", "string"), S("data", "string")],
  start: [S("matchId", "string")],
  finish: [S("matchId", "string")],
  pause: [S("matchId", "string", false)],
  resume: [S("matchId", "string", false)],
  "lobby.subscribe": [],
  "lobby.create": [S("playerId", "string")],
  "lobby.join": [S("playerId", "string")],
  "lobby.leave": [S("lobbyId", "string", false)],
  "lobby.team": [S("team", "team")],
  "lobby.ready": [S("lobbyId", "string", false), S("ready", "boolean")],
  "lobby.settings": [S("settings", "object")],
  "lobby.kick": [S("lobbyId", "string", false), S("playerId", "string")],
  "lobby.start": [S("lobbyId", "string", false)],
  "chat.send": [S("text", "string")],
  spectate: [S("matchId", "string")],
  "spectate.data": [S("matchId", "string"), S("data", "string")],
  "spectate.leave": [S("matchId", "string", false)],
};

const TEAMS = new Set(["DEF", "ATT"]);

function typeOk(value, type) {
  switch (type) {
    case "string": return typeof value === "string" && value.length > 0;
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "object": return value !== null && typeof value === "object";
    case "team": return typeof value === "string" && TEAMS.has(value);
    default: return false;
  }
}

/** @returns {{ok:boolean, error?:string}} */
export function validateMessage(msg) {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
    return { ok: false, error: "bad-message" };
  }
  const rules = RULES[msg.type];
  if (!rules) return { ok: false, error: `unknown-type: ${msg.type}` };
  for (const r of rules) {
    const v = msg[r.name];
    if (r.required && (v === undefined || v === null)) return { ok: false, error: `missing: ${r.name}` };
    if (v !== undefined && v !== null && !typeOk(v, r.type)) return { ok: false, error: `bad-field: ${r.name}` };
  }
  return { ok: true };
}

export function knownTypes() {
  return Object.keys(RULES);
}
