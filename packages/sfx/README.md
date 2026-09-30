<h1 align="center">SFX</h1>

<p align="center">
  <strong>Interface sounds for the web, synthesized with Web Audio.<br>No audio files, zero dependencies.
  <a href="https://bloxwap.github.io/sfx/">Try the sound board</a>.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bloxwap/sfx"><img alt="npm version" src="https://img.shields.io/npm/v/@bloxwap/sfx?color=blue&style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@bloxwap/sfx"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@bloxwap/sfx.svg?style=flat-square"></a>
  <a href="https://github.com/bloxwap/sfx/actions/workflows/tests.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/bloxwap/sfx/tests.yml?branch=main&label=tests&style=flat-square"></a>
  <a href="https://bundlejs.com/?q=@bloxwap/sfx"><img alt="Bundle size" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdeno.bundlejs.com%2F%3Fq%3D%40bloxwap%2Fsfx&amp;query=%24.size.compressedSize&amp;label=minzipped+size&amp;style=flat-square&amp;color=blue"></a>
</p>

## Features

- **19 sounds** for hovers, presses, toggles, confirmations, errors, loading, and money moments.
- **Zero files, zero dependencies.** Every sound is a small recipe of oscillators and filtered noise.
- **One node per play.** Each sound is rendered once with an `OfflineAudioContext` and cached. After
  that, a play is a single `AudioBufferSourceNode`, 5–75× cheaper on the main thread than building
  the synth graph each time.
- **A mixed output.** One master bus with volume control and a limiter, so overlapping sounds don't
  clip. Voice stealing and retrigger guards stop sounds from piling up.
- **Declarative binding.** Add `data-sound-*` attributes and call `bind()` once. It uses delegated
  listeners with no MutationObserver, handles keyboard press and release, skips disabled controls,
  and returns an unbind function.
- **Safe everywhere.** Importing is SSR-safe. `play()` never throws, and it waits for the browser's
  first user gesture before touching audio.
- **Tested.** 100% line, branch, and function coverage, including real offline renders of every sound.

## Installation

```sh
npm install @bloxwap/sfx
```

ESM only. Works in all modern browsers, and is a silent no-op on the server.

## Usage

Declarative: add attributes, then call `bind()` once.

```html
<button data-sound-press data-sound-release>Save</button>
<a href="/docs" data-sound-hover="tick">Docs</a>
<button role="switch" data-sound-toggle>Dark mode</button>
```

```ts
import { bind } from '@bloxwap/sfx';

const unbind = bind(); // the whole document, including elements added later
```

Imperative: play a sound from your own code.

```ts
import { play, preload, setVolume } from '@bloxwap/sfx';

preload(); // optional: render every sound now so the first play is as cheap as the rest
setVolume(0.6);

try {
  await save();
  play('success');
} catch {
  play('error');
}

play('tick', { volume: 0.5, rate: 1.25, pan: -0.3 });
```

## Attributes

| Attribute            | Plays on                         | Default sound |
| -------------------- | -------------------------------- | ------------- |
| `data-sound-hover`   | mouse `pointerenter`             | `chime`       |
| `data-sound-press`   | primary `pointerdown`, Enter/Space down | `press` |
| `data-sound-release` | primary `pointerup`, Enter/Space up     | `release` |
| `data-sound-toggle`  | `click` (including keyboard)     | `toggle`      |

Set the value to a sound name to choose a different sound (`data-sound-hover="tick"`). Hover sounds
play only for a mouse on a fine pointer, at most one every 150 ms. Controls that are disabled,
`aria-disabled="true"`, or `inert` stay silent.

## Sounds

| Sound | Character | Good for |
| --- | --- | --- |
| `chime` | soft rising two-note bell | default hover |
| `sparkle` | quick four-note twinkle | playful accents |
| `droplet` | single note gliding down | dismiss, collapse |
| `bloom` | warm slow swell | reveal, expand |
| `whisper` | breathy quiet texture | dense lists |
| `tick` | crisp instant tick | navigation hover |
| `press` | dull muted knock | pointer down |
| `release` | bright springy tick | pointer up |
| `toggle` | mechanical click-clack | switches, tabs |
| `success` | warm three-note confirmation | completed actions |
| `error` | soft descending refusal | recoverable errors |
| `page` | papery flick and glass tick | pages, carousels |
| `loading` | brief unresolved rise | work starting |
| `ready` | focus tick and open fifth | content ready |
| `payout` | deep two-stage coin | payouts, rewards |
| `deposit` | wide metallic shimmer | deposits, credits |
| `pluck` | tight falling pluck | pickups, selections |
| `notification` | bright physical bell | messages, activity |
| `loss` | heavy two-stage fall | losses, negative outcomes |

## API

```ts
import {
  play, preload, bind, unlock,
  setEnabled, isEnabled, setVolume, getVolume, configure,
  stopAll, activeVoices, getOutput, dispose,
  sounds, isSound, duration,
  type SoundName, type PlayOptions, type BindOptions, type EngineOptions,
} from '@bloxwap/sfx';
```

| Function | Description |
| --- | --- |
| `play(name = 'chime', options?)` | Plays a sound now. `options`: `volume` (0–2), `rate` (0.25–4), `pan` (-1–1). Never throws. |
| `preload(names?)` | Renders sounds (all of them by default) to buffers. Safe to call before any user gesture. |
| `bind(root = document, options?)` | Wires `data-sound-*` attributes under `root`. Returns `unbind()`. Options: `keyboard`, `hoverInterval`. |
| `unlock()` | Creates and resumes audio from inside a gesture. `bind()` calls it on the first press. |
| `setEnabled(on)` / `isEnabled()` | Global mute. Sounds already playing finish. |
| `setVolume(0–1)` / `getVolume()` | Master volume, with a short glide to avoid clicks. |
| `configure({ maxVoices, minInterval })` | Voice cap (default 24) and per-sound retrigger guard (default 16 ms). |
| `stopAll()` / `activeVoices()` | Stops every playing sound / counts them. |
| `getOutput()` | The last node before the speakers, for an `AnalyserNode` or a recorder. |
| `dispose()` | Closes the audio context and clears caches. |
| `sounds` / `isSound(value)` / `duration(name)` | The catalog, a type guard, and each sound's length in seconds. |

The raw recipe data is available from `@bloxwap/sfx/recipes`.

## Documentation

Guides, the full API reference, and a live sound board: **https://bloxwap.github.io/sfx/**

## License

MIT
