// store.ts — персистентность матчей/игроков на SQLite (node:sqlite).
// Без Docker/root — прямой Node-процесс + файл БД. Относительный путь к БД.
//
// Относительный путь: ./backend/persistence/store.ts
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import type { ChatMessage, MatchPlayer } from "../ports.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, "..", "data");
mkdirSync(DB_DIR, { recursive: true });

export class Store {
  db: DatabaseSync;

  /**
   * @param dbPath  путь к файлу БД (относительный от ./backend)
   */
  constructor(dbPath: string = join(DB_DIR, "battlecity.sqlite")) {
    this.db = new DatabaseSync(dbPath);
    this._migrate();
  }

  _migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id          TEXT PRIMARY KEY,
        created_at  INTEGER NOT NULL,
        finished_at INTEGER,
        winner_team TEXT,
        state       TEXT NOT NULL DEFAULT 'lobby'
      );
      CREATE TABLE IF NOT EXISTS player_matches (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        team     TEXT NOT NULL,
        PRIMARY KEY (match_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        seq       INTEGER PRIMARY KEY AUTOINCREMENT,
        scope     TEXT NOT NULL,
        scope_id  TEXT,
        player_id TEXT NOT NULL,
        name      TEXT NOT NULL,
        text      TEXT NOT NULL,
        ts        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_scope ON chat_messages (scope, scope_id, seq);
    `);
  }

  upsertPlayer(playerId: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO players (id, name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
      )
      .run(playerId, name, Date.now());
  }

  createMatch(matchId: string, players: MatchPlayer[]): void {
    this.db
      .prepare(`INSERT INTO matches (id, created_at, state) VALUES (?, ?, 'lobby')`)
      .run(matchId, Date.now());
    const ins = this.db.prepare(
      `INSERT INTO player_matches (match_id, player_id, team) VALUES (?, ?, ?)`,
    );
    for (const p of players) ins.run(matchId, p.playerId, p.team);
  }

  // Создать запись матча, если её ещё нет (INSERT OR IGNORE). Используется
  // в relay: комната могла стартовать через matchmaker без записи в БД.
  ensureMatch(matchId: string, players: MatchPlayer[]): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO matches (id, created_at, state) VALUES (?, ?, 'lobby')`)
      .run(matchId, Date.now());
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO player_matches (match_id, player_id, team) VALUES (?, ?, ?)`,
    );
    for (const p of players) ins.run(matchId, p.playerId, p.team);
  }

  finishMatch(matchId: string, winnerTeam: string | null): void {
    this.db
      .prepare(`UPDATE matches SET finished_at = ?, winner_team = ?, state = 'finished' WHERE id = ?`)
      .run(Date.now(), winnerTeam, matchId);
  }

  // --- чат (история переписки, SQLite) ---
  insertChat(m: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO chat_messages (scope, scope_id, player_id, name, text, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(m.scope, m.id ?? null, m.from, m.name, m.text, m.ts);
  }

  // Последние сообщения канала в хронологическом порядке.
  listChat(scope: string, id: string | null, limit = 100): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT scope, scope_id AS id, player_id AS "from", name, text, ts
         FROM chat_messages WHERE scope = ? AND scope_id IS ?
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(scope, id ?? null, limit);
    return rows.reverse() as unknown as ChatMessage[];
  }

  listMatches(limit = 20): object[] {
    return this.db
      .prepare(
        `SELECT m.id, m.created_at, m.finished_at, m.winner_team, m.state,
                GROUP_CONCAT(pm.player_id || ':' || pm.team, ',') AS players
         FROM matches m
         LEFT JOIN player_matches pm ON pm.match_id = m.id
         GROUP BY m.id
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  close(): void {
    this.db.close();
  }
}

export default Store;
