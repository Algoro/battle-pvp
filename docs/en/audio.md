> 🌐 **English** · [Русский](../audio.md)

# Sound and music

Sound and music are the **APU output from jsnes** (not separate assets). The APU is fully
implemented in the unmodified `vendor/jsnes`; the core merely enables it with options and
passes samples to the browser audio layer. There are no separate music recordings — the
native ROM sound plays.

## How it works

```
PvPNes (BattleCityPAPU) --onAudioSampleGroup("music"|"sfx", L,R)--> EmulatorDriver
    --> AudioOutput (AudioWorklet: 2 группы, раздельные gain) --> динамики
```

- `PvPNes` is silent by default (`sampleRate: 0`). Sound is enabled with the options
  `sampleRate: 48000` + `onAudioSampleGroup`.
- **Separate groups** (subclass `emulator-core/papu-ext.ts`, jsnes untouched):
  - `music` = pulse1 + pulse2 + triangle;
  - `sfx` = noise + DMC.
- `EmulatorDriver` passes both groups to `AudioOutput`
  (`frontend/src/engine/audio.ts`) with separate buffers/gain.
- `AudioOutput`: `AudioContext` + `AudioWorklet`, separate volume and mute for
  music and effects (persisted in `localStorage`), suspend when the tab is hidden.
- **Autoplay policy**: the context is resumed after the first gesture (click/keypress).

## Rollback and sound

The APU state is part of `saveState/loadState`, so on rollback, replaying frames must not
emit samples again. For this a gate is introduced:

- `PvPNes.setAudioSuppressed(bool)` — when `true`, `onAudioSample` is not called.
- `RollbackSession` enables the gate during `_rollback` and catch-up after resync.

This way rollbacks do not produce duplicates/clicks, and normally sound flows continuously.

## Determinism and network

- Sound **does not affect** `getFrameHash()` or the game state (verified by a test).
- Sound is local: each client (player or spectator that renders) plays
  its own; the server/Docker does not output sound.
- Headless instances (AI evals, tests) stay with `sampleRate: 0`.

## API

```js
const emu = new PvPNes({
  patchSet: "pvp", sampleRate: 48000,
  onAudioSampleGroup: (group, l, r) => { /* group: "music" | "sfx" */ },
});
emu.setAudioSuppressed(true);   // глушить на время переигровки
```

If `onAudioSampleGroup` is not set, the APU emits the combined mix via `onAudioSample(L,R)`
(backward compatibility).

Frontend output:

```js
audio.pushGroup("music", l, r);
audio.setMusicVolume(0.4); audio.setMusicMuted(false);
audio.setSfxVolume(0.7);   audio.setSfxMuted(false);
```

## UI

In the battle HUD there are two rows: "Music" and "Effects", each with a mute button and a
volume slider (`AudioControl`). The settings are remembered.

## Tests

- `emulator-core/tests/audio.test.ts`: sample emission; music/sfx group routing;
  the gate mutes both groups; `getFrameHash()` does not depend on sound.
- `netcode/tests/recovery.test.ts`: rollback enables/disables the gate, samples during
  replay are not emitted.
- E2E: `AudioContext` is resumed, `posted > 0` for both groups (`window.__bcAudio.stats()`).

## Limitations and future work

- The groups are split **by APU channel**: `music` = pulse+triangle, `sfx` = noise+DMC.
  If individual effects in the game use pulse channels, they land in the "music" group
  (a standard trade-off of the channel-based approach).
- If noticeable artifacts appear on rollbacks, a reserve is in place: move audio into a
  separate "shadow" instance that follows confirmed frames (without replays).
