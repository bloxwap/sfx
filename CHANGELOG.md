# Changelog

All notable changes to `@bloxwap/sfx` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.0 — Unreleased

First release.

- 19 synthesized interface sounds: `chime`, `sparkle`, `droplet`, `bloom`, `whisper`, `tick`, `press`,
  `release`, `toggle`, `success`, `error`, `page`, `loading`, `ready`, `payout`, `deposit`, `pluck`,
  `notification`, `loss`.
- `play(name, { volume, rate, pan })`, which never throws and waits for the first user gesture.
- Each sound renders once with an `OfflineAudioContext`; every later play is one `AudioBufferSourceNode`.
- `preload()` renders sounds ahead of time, even before any user gesture.
- A master bus with volume and a limiter, voice stealing (`maxVoices`), and a same-sound retrigger guard.
- `bind()` for `data-sound-hover`, `-press`, `-release`, and `-toggle`: delegated capture listeners,
  keyboard press and release, silent disabled controls, audio unlock on the first gesture, and an
  unbind function.
- `unlock()`, `setEnabled()`, `setVolume()`, `configure()`, `stopAll()`, `activeVoices()`, `getOutput()`,
  `dispose()`, `isSound()`, and `duration()`.
- Recipe data at `@bloxwap/sfx/recipes`.
- `play()` options `delay` (seconds on the audio clock, 0–10), `minInterval` (per-call retrigger guard),
  and `force` (skip the user-gesture check, for capture and kiosk browsers).
- `configure({ resume: 'queue' | 'eager' })`: wait for a suspended context to resume (default), or
  schedule sounds at once and resume alongside them.
- Automatic resume after the page returns (`visibilitychange`, `pageshow`, `focus`), including iOS's
  `'interrupted'` state. `dispose()` removes the listeners.
- `renderTo(context, name, options)` schedules a sound onto any `BaseAudioContext`, such as an
  `OfflineAudioContext` baking a video soundtrack.
- `renderBuffer(name, { sampleRate })` renders one sound to a new `AudioBuffer`.
- WAV export at `@bloxwap/sfx/wav`: `encodeWav()` (16/24-bit PCM, 32-bit float, mono or stereo) and
  `trimSilence()`.
- `sfx-wav` CLI that renders sounds and `--combo` mixes to WAV files for native apps, using the optional
  peer dependency `node-web-audio-api`.
