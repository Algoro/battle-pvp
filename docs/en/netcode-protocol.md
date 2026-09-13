> 🌐 **English** · [Русский](../netcode-protocol.md)

# Network protocol netcode (frame format)

Rollback netcode (similar to GGPO). Relative paths: `./netcode/*`.
Packet format — **version 2**: each packet starts with a tag byte (`PKT`),
which makes routing unambiguous (previously hash/snapshot could be erroneously
decoded as a frame).

## Packet tags (`netcode/protocol/frame.ts`)
| Tag | Packet | Layout (LE) |
|---|---|---|
| 1 `INPUT` | input of one frame | `uint8 type, uint32 frame, uint8 count, repeat{uint8 port,uint8 buttons}` |
| 2 `BATCH` | redundant pack of the last N frames | `uint8 type, uint32 headFrame, uint8 frames, repeat{uint32 frame, uint8 count, repeat{port,buttons}}` |
| 3 `HASH` | hash verification | `uint8 type, uint32 frame, uint32 hash` |
| 4 `PING` / 5 `PONG` | latency | `uint8 type, uint32 seq, uint32 t(ms)` |
| 6 `SNAP_REQ` | snapshot request | `uint8 type, uint32 frame` |
| 7 `SNAP` | snapshot chunk | `uint8 type, uint32 frame, uint32 hash, uint16 seq, uint16 total, bytes` |

`BATCH.headFrame` = the sender's next frame (needed for catch-up after resync).
The snapshot is split into chunks by `SNAP_CHUNK_BYTES` (16 KiB): `encodeSnapshot(frame, hash, bytes)`.

## Rollback session (`netcode/rollback/session.ts`)
- `advanceFrame(myInputs)` — saves state, simulates a frame, sends a **redundant** pack of
  the last `redundancy` (4 by default) frames, periodically hash-checks confirmed
  frames (`confirmDelay` 20), pings every 60 frames.
- Prediction of missing input = "repeat the last known opponent input".
- On late input — rollback to `states[frame]`, replay forward; `states[f]`
  is re-saved on each replay. Duplicate inputs are deduplicated by port.
- **Redundancy** hides single-packet losses (without irreversible desync).
- **Latency**: `latency {ms}` events; `peer-unresponsive` when silent for > 600 frames.
- **Reconnect**: `rebindTransport(transport)` re-binds the session to a new transport
  (events `transport-closed` / `transport-rebound`).
- **Desync-recovery**: when hashes diverge, the non-authoritative client (lower `playerId`,
  or an explicit `authority`) requests a full snapshot from the authority, applies it
  (`resync`) and **catches up** the frame counter using `headFrame`, simulating the missed
  frames by prediction (real inputs will correct them via rollback). Events: `desync`,
  `resync-request`, `snapshot-sent`, `resync`, `catch-up`.
- `onEvent` events: `frame`, `rollback {fromFrame,toFrame}`, `desync {frame,localHash,remoteHash}`,
  `latency {ms}`, `transport-closed`, `transport-rebound`, `resync*`.

## Transports (contract `{ send(buf), onMessage(cb), onClose?(cb), isOpen?() }`)
- `transport/local.ts` — in-process (latency/jitter/loss, deterministic PRNG) for tests.
- `transport/webrtc.ts` — WebRTC DataChannel (primary, P2P).
- `transport/relay.ts` — via backend (fallback for symmetric NAT):
  WS messages `{type:'relay.data', matchId, to/from, data: base64}`.
- `transport/multi.ts` — `MultiTransport`: broadcasting/multiplexing N transports (2v2/N players);
  `send()` goes to all, incoming ones are merged into a single stream.

## Backend signaling (WS `/ws`)
- `join` → assigns a port and peers; a repeated `join` with the same `playerId` in an ongoing match
  = **reconnect** (`joined{reconnected:true}`); partners receive `peer.left` / `peer.reconnected`.
- `room` contains `players[{playerId,team,online}]` (presence).
- `signal` → forwarding SDP/ICE; `relay.data` → relaying game bytes;
  `pause`/`resume` → match pause (e.g., tab in the background); `start`/`finish` → lifecycle.
- `chat.send` (scope `global` / `lobby` / `match`) and chat history;
  `spectate` / `spectate.data` / `spectate.leave` — spectator mode.

## Cartridge fingerprint
Clients send a `cartridgeFingerprint` on join; the server verifies it (lobby, matchmaker,
`join`) and does not start a match when patches diverge (`cartridge-mismatch`).

## Connection UX (frontend)
- `LobbyClient` auto-reconnects the WS (backoff), `rejoinMatch()` returns to the same room.
- `MatchController.renegotiate()` (called from `App`) re-pairs the transport with opponents (`negotiateAll`), then
  `session.rebindTransport`. Screens: "Connecting…", "Reconnecting…", "Waiting for opponent…";
  HUD: mode (webrtc/relay), ping, rollbacks, **DESYNC**.

## Criteria
- Determinism: two instances with identical input → identical `getFrameHash()` every frame.
- Latency of 50–150 ms without desyncs lasting longer than 1 frame (they converge, desyncCount==0).
- 10% packet loss with redundancy → they converge; without redundancy → desync is detected.
- Reconnect: `rebindTransport` continues the match; `peer.left`/`peer.reconnected` at the partner.
