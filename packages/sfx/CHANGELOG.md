# Changelog

All notable changes to `@bloxwap/sfx` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

- **Invariant enforcement.** Context replacement isolates pending resumes; failed graph creation rolls back;
  queued plays snapshot options and discard expired requests. Voice limits are finite and trim live web
  voices immediately. `renderTo()` releases live graphs after their audio-clock tail.
- Built-ins are deeply immutable, every registration path invalidates cached renders, and custom recipes
  have bounded count, name length, layers, duration and render memory. Correct single echoes and slow-rate
  delays; unknown `duration()` returns zero and WAV trimming sanitizes non-finite samples.
- **Readiness:** `preload()` now resolves a boolean, false when any sound fails or its result is invalidated.
  Existing callers can continue awaiting it without inspecting the result.
- React and imperative calls share one preference store; mounted providers own their overrides. Bindings
  use independent cleanup leases, follow replaced refs, and handle keyboard pairing, focus loss and disabled
  descendants. Native React imports select the native backend.
- Native completion releases cancellation listeners after playback, stealing or disposal. Android tracks
  its own voices, updates active-stream volume, and isolates load callbacks by pool generation; iOS serializes
  preload and retries failed audio-session setup. Native assets bake at 2× gain to support per-play gain 0–2.
- Asset manifests fingerprint renderer inputs and toolchain versions. Added native SDK compilation and
  Android lifecycle tests via `npm run test:native`. The full web bundle budget is now 8 KiB gzip to include
  lifecycle rollback, resource bounds and preference ownership (previously 6.5 KiB).
- Docs honor saved preferences on direct routes, snapshot and cancel deposits, use current sequence controls,
  release analyser connections, accept click-only activation, and derive catalog counts/version from source.

- **React Native.** `import … from '@bloxwap/sfx'` now resolves to a native entry under Metro (the
  `react-native` export condition; also `@bloxwap/sfx/native`) with the same exports and the same recipes. The
  package includes an Expo module: iOS plays from one `AVAudioEngine` with pooled player nodes and an
  ambient audio session, pauses itself after 3 s of silence, and drops its buffers on memory warnings. Android
  plays from one `SoundPool`. Every play is one synchronous native call. Sounds decode lazily or through
  `preload()`. Supports `volume`, category volumes, `pan`, `rate`, `delay`, `minInterval` and `signal`. Web-only
  APIs (`bind`, `renderTo`, `renderBuffer`, `getOutput`) have inert stand-ins, so shared code runs on all
  platforms. Needs a development build (Expo SDK 52+).
- All 19 recipes are baked to 48 kHz 16-bit PCM in `native/assets/bloxwap-sfx` by `npm run bake:native`
  (rendered in Chromium, seeded). A test fails when a recipe changes without a re-bake.
- `configure({ audioSession: 'ambient' | 'manual' })` (React Native only) lets apps that also play media
  manage the iOS audio session themselves.

## 0.2.1 — 2026-10-20

Performance release. No API changes.

- The first `play()` of a sound no longer renders its playback buffer inside the caller's event handler. The
  cache fill runs after the current task (`requestIdleCallback` where available), which cuts first-play
  main-thread time by about 70% (#59).
- Sounds whose recipes don't pan are cached as mono buffers: 36% less retained sample memory for the catalog and
  about 20% cheaper cached plays in Chromium. Panned plays up-mix explicitly, so output is unchanged.
  `renderBuffer()` still returns stereo (#60).
- `<SoundProvider>` memoizes its context value, so `useSoundPreference()` consumers stop re-rendering with every
  parent render (#61).
- `encodeWav()` is 2–4× faster for 16/24-bit PCM, with byte-identical output (#62).
- Noise samples are generated once per sample rate instead of once per render: about 20% faster `preload()` (#63).
- The cached `play()` path allocates 31–45% less JS garbage per call (#64).

## 0.2.0 — 2026-10-19

- `play()` option `signal`: an `AbortSignal` that stops that play, and only that play. A queued request is
  dropped and a sounding voice stops at once; other voices keep playing. An already aborted signal makes
  `play()` a no-op. This gives each caller (for example one HIG feedback root) per-voice cancellation without
  `stopAll()`.
- `define(name, recipe)` registers or replaces an immutable custom recipe. Built-in names stay reserved.
- Optional React 18/19 bindings at `@bloxwap/sfx/react`: `useBindSounds`, `useSound`, `useSoundPreference`,
  and `<SoundProvider>`. Mute and volume persist in localStorage.
- Category volumes (`hover`, `controls`, `feedback`, `money`) and an opt-in reduced-motion startup preset
  (`configure({ respectReducedMotion: true })`).
- `@bloxwap/sfx/semantic` maps HIG 0.1.0 feedback intents to sounds. Approved native WAV assets ship at
  `@bloxwap/sfx/assets/hig/*`.

## 0.1.0 — 2026-09-29

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
