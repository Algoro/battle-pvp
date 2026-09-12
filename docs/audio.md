# Звук и музыка

Звук и музыка — это вывод **APU из jsnes** (не отдельные ассеты). APU полностью
реализован в неизменном `vendor/jsnes`; ядро лишь включает его опциями и отдаёт сэмплы
в браузерный аудио-слой. Отдельных записей музыки нет — играет родной звук ROM.

## Как устроено

```
PvPNes (BattleCityPAPU) --onAudioSampleGroup("music"|"sfx", L,R)--> EmulatorDriver
    --> AudioOutput (AudioWorklet: 2 группы, раздельные gain) --> динамики
```

- `PvPNes` по умолчанию молчит (`sampleRate: 0`). Звук включается опциями
  `sampleRate: 48000` + `onAudioSampleGroup`.
- **Раздельные группы** (подкласс `emulator-core/papu-ext.ts`, jsnes не тронут):
  - `music` = pulse1 + pulse2 + triangle;
  - `sfx` = noise + DMC.
- `EmulatorDriver` передаёт обе группы в `AudioOutput`
  (`frontend/src/engine/audio.ts`) с отдельными буферами/gain.
- `AudioOutput`: `AudioContext` + `AudioWorklet`, раздельные громкость и mute для
  музыки и эффектов (сохраняются в `localStorage`), suspend при скрытии вкладки.
- **Autoplay policy**: контекст поднимается после первого жеста (клик/клавиша).

## Rollback и звук

APU-состояние входит в `saveState/loadState`, поэтому при откате переигровка кадров не
должна повторно эмитить сэмплы. Для этого введён гейт:

- `PvPNes.setAudioSuppressed(bool)` — при `true` `onAudioSample` не вызывается.
- `RollbackSession` включает гейт на время `_rollback` и catch-up после resync.

Так откаты не дают дублей/щелчков, а звук в норме идёт непрерывно.

## Определённость и сеть

- Звук **не влияет** на `getFrameHash()` и на игровое состояние (проверено тестом).
- Звук локальный: каждый клиент (игрок или наблюдатель, который рендерит) воспроизводит
  свой; сервер/Docker звук не выводят.
- Headless-инстансы (ИИ-эвалы, тесты) остаются с `sampleRate: 0`.

## API

```js
const emu = new PvPNes({
  patchSet: "pvp", sampleRate: 48000,
  onAudioSampleGroup: (group, l, r) => { /* group: "music" | "sfx" */ },
});
emu.setAudioSuppressed(true);   // глушить на время переигровки
```

Если `onAudioSampleGroup` не задан, APU отдаёт суммарный микс через `onAudioSample(L,R)`
(обратная совместимость).

Фронтенд-вывод:

```js
audio.pushGroup("music", l, r);
audio.setMusicVolume(0.4); audio.setMusicMuted(false);
audio.setSfxVolume(0.7);   audio.setSfxMuted(false);
```

## UI

В HUD боя — две строки: «Музыка» и «Эффекты», у каждой кнопка mute и слайдер громкости
(`AudioControl`). Настройки запоминаются.

## Тесты

- `emulator-core/tests/audio.test.ts`: эмиссия сэмплов; маршрутизация групп music/sfx;
  гейт глушит обе группы; `getFrameHash()` не зависит от звука.
- `netcode/tests/recovery.test.ts`: откат включает/снимает гейт, сэмплы во время
  переигровки не эмитятся.
- E2E: `AudioContext` поднимается, `posted > 0` для обеих групп (`window.__bcAudio.stats()`).

## Ограничения и развитие

- Группы разделены **по каналам APU**: `music` = pulse+triangle, `sfx` = noise+DMC.
  Если отдельные эффекты в игре используют pulse-каналы, они попадут в группу «музыка»
  (это стандартный компромисс channel-based подхода).
- При заметных артефактах на откатах заложен запас: перенос аудио в отдельный «теневой»
  инстанс, идущий по подтверждённым кадрам (без переигровок).
