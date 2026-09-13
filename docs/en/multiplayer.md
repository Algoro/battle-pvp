> 🌐 **English** · [Русский](../multiplayer.md)

# Multiplayer

## Roles and team sizes

The Battle City engine uses 8 logical ports:
- **DEF** — ports `0,1` (hardware `$4016/$4017`), at most 2 tanks;
- **ATT** — ports `2..7` (via the network RAM zone, see `rom-patching.md`), up to 6 tanks.

Total up to **8 human players** (2 defenders + 6 attackers); empty slots are filled by AI.

## Lobby

- Room creation by code (4 characters), list of open lobbies, join by code/link.
- Settings: `defSlots` (1–2), `attSlots` (1–6), `autoStart`, `requireReady`, `fillBots`.
- Player ready status, kick, chat (global / lobby / match), chat history in SQLite.
- Start: the host presses "Start" or auto-start triggers (full lobby + all ready).

## Matchmaking (quick match)

`POST /matchmake` puts a player into the queue; a pair is formed only between
opposite teams **with the same cartridge fingerprint** (`cartridgeFingerprint`).

## Netcode (briefly)

Full description — `netcode-protocol.md`.

- **Rollback (GGPO approach)**: the client simulates frames locally, predicting the opponent's
  input; on late input — rollback to the saved state and replay.
- **Loss resilience**: redundant sending of the last N input frames.
- **Desync detection**: periodic verification of `getFrameHash()`; on divergence —
  request a full snapshot from the authority and resync.
- **Latency**: ping/pong, `latency` event.

## Start and stage selection

- The host selects the starting stage (1–35) in the lobby; the choice **has a preview**: the preview
  is built from ROM data in memory (13×13 layout + CHR tiles + palettes), without external images.
- The host also sets the **defenders' starting stars** (0–3) and the **"4★"** option
  (`defPistol`) — the maximum upgrade + the "pistol" super-weapon at the start of the match; as in the
  game, after death the level and weapon are reset.
- Solo mode and quick match also start from the selected/first stage.
- Stage/stars/pistol are passed in `match.start` (`stage`, `defStars`, `defPistol`) and
  injected into the game deterministically on all clients (the same PC hook at the moment of reading
  `ram_stage`), so there is no desync.

## Reconnect

- The WS auto-reconnects with backoff, `LobbyClient.rejoinMatch()` returns to the same room.
- A repeated `join` with the same `playerId` in an ongoing match = reconnect: the server sends
  `joined{reconnected:true}`, to partners — `peer.reconnected`; a drop — `peer.left`.
- The transport is re-paired (`negotiateAll` + `session.rebindTransport`).
- On a drop the match freezes (pause), the UI shows "Reconnecting…"/"Waiting for opponent…".

## Spectator

Viewing without control: `?spectate=MATCHID`. The spectator receives periodic state snapshots
from the authoritative player, renders the frame and can read/write to the match chat
(data is sent to spectators only by a player of the room).

## End of match

The winner is determined deterministically; the server broadcasts `match.finished{winner}`,
clients show the result with the player's perspective and return to the lobby **without**
reloading the page (the WS connection is preserved).

## Cartridge fingerprint

Since the game code is patched in memory, it is important that all participants have the same
set of patches. On join a `cartridgeFingerprint` is sent (FNV-1a32 of the patched PRG):
- the lobby does not start on divergence (`cartridge-mismatch`);
- the matchmaker pairs only identical cartridges;
- `join` into a room with a different cartridge is rejected.
