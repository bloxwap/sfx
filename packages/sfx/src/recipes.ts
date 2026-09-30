/**
 * The sound catalog as plain data. Each recipe is a list of layers — band-limited oscillators or
 * filtered noise — shaped by an exponential attack/decay envelope, plus an optional filtered echo.
 * The engine renders a recipe once to a buffer, so this table is read at render time, never per play.
 */

/** Oscillator shapes a tone layer can use. */
export type Waveform = 'sine' | 'triangle' | 'sawtooth' | 'square';
/** Biquad responses a noise layer can use. */
export type NoiseFilter = 'lowpass' | 'bandpass' | 'highpass';

interface LayerTiming {
  /** Start offset from the trigger, in seconds. */
  readonly at: number;
  /** Seconds from silence to `peak` (exponential). */
  readonly attack: number;
  /** Seconds from `peak` back to silence (exponential). */
  readonly decay: number;
  /** Linear envelope peak, before the recipe level. */
  readonly peak: number;
  /** Stereo position from -1 (left) to 1 (right). Omitted means centered. */
  readonly pan?: number;
}

/** An oscillator layer, optionally gliding exponentially from `freq` to `to`. */
export interface ToneLayer extends LayerTiming {
  readonly wave: Waveform;
  readonly freq: number;
  readonly to?: number;
  /** Glide duration in seconds; defaults to the envelope length. */
  readonly glide?: number;
  /** Static detune in cents. */
  readonly detune?: number;
}

/** A white-noise layer through one biquad filter. */
export interface NoiseLayer extends LayerTiming {
  readonly noise: NoiseFilter;
  readonly freq: number;
  readonly q?: number;
}

export type Layer = ToneLayer | NoiseLayer;

/** A lowpassed feedback delay that trails the dry sound. */
export interface Echo {
  readonly delay: number;
  readonly feedback: number;
  readonly wet: number;
  readonly lowpass: number;
}

export interface Recipe {
  /** Output level applied to the summed layers (and fed to the echo). */
  readonly level: number;
  readonly layers: readonly Layer[];
  readonly echo?: Echo;
}

type ToneExtras = Pick<ToneLayer, 'to' | 'glide' | 'detune' | 'pan'>;

function tone(wave: Waveform, freq: number, at: number, attack: number, decay: number, peak: number, extras?: ToneExtras): ToneLayer {
  return { wave, freq, at, attack, decay, peak, ...extras };
}

function noise(filter: NoiseFilter, freq: number, q: number | undefined, at: number, attack: number, decay: number, peak: number, pan?: number): NoiseLayer {
  const layer: NoiseLayer = { noise: filter, freq, at, attack, decay, peak };
  return q === undefined && pan === undefined ? layer : { ...layer, ...(q === undefined ? {} : { q }), ...(pan === undefined ? {} : { pan }) };
}

function echo(delay: number, feedback: number, wet: number, lowpass: number): Echo {
  return { delay, feedback, wet, lowpass };
}

const recipeTable = {
  // A soft rising fifth, C6 → G6, with a light echo. The default sound.
  chime: {
    level: 1.75,
    echo: echo(0.12, 0.25, 0.18, 4000),
    layers: [
      tone('sine', 1046.5, 0, 0.006, 0.22, 0.09),
      tone('sine', 1568, 0.09, 0.006, 0.26, 0.08),
    ],
  },
  // A quick A-major arpeggio, 45 ms apart.
  sparkle: {
    level: 2.9,
    echo: echo(0.07, 0.35, 0.22, 6000),
    layers: [
      tone('sine', 1760, 0, 0.003, 0.09, 0.045),
      tone('sine', 2217, 0.045, 0.003, 0.09, 0.04),
      tone('sine', 2637, 0.09, 0.003, 0.1, 0.038),
      tone('sine', 3520, 0.135, 0.003, 0.12, 0.032),
    ],
  },
  // One falling sine, like a drop of water.
  droplet: {
    level: 1.85,
    echo: echo(0.09, 0.2, 0.15, 3000),
    layers: [tone('sine', 1200, 0, 0.004, 0.2, 0.075, { to: 550, glide: 0.14 })],
  },
  // A slow two-sine swell; the 12-cent detune beats gently.
  bloom: {
    level: 1.3,
    echo: echo(0.15, 0.2, 0.12, 2500),
    layers: [
      tone('sine', 528, 0, 0.06, 0.32, 0.06),
      tone('sine', 528, 0, 0.06, 0.34, 0.05, { detune: 12 }),
    ],
  },
  // A breathy swell of dark noise, for dense lists.
  whisper: {
    level: 3.75,
    layers: [noise('lowpass', 1200, 0.7, 0, 0.04, 0.16, 0.05)],
  },
  // A crisp band of noise with a tiny high ping.
  tick: {
    level: 2.5,
    layers: [
      noise('bandpass', 5400, 1.8, 0, 0.001, 0.018, 0.14),
      tone('sine', 2600, 0, 0.001, 0.012, 0.018),
    ],
  },
  // A muted knock: a key bottoming out.
  press: {
    level: 3.2,
    layers: [noise('bandpass', 1700, 1.4, 0, 0.001, 0.02, 0.13)],
  },
  // A brighter, springier tick: the key coming back up.
  release: {
    level: 2.75,
    layers: [
      noise('bandpass', 4600, 1.8, 0, 0.001, 0.016, 0.12),
      tone('sine', 3200, 0.006, 0.001, 0.05, 0.02),
    ],
  },
  // A low click, then a higher clack 24 ms later.
  toggle: {
    level: 3.3,
    layers: [
      noise('bandpass', 2200, 1.6, 0, 0.001, 0.016, 0.12),
      noise('bandpass', 3800, 1.6, 0.024, 0.001, 0.02, 0.1),
    ],
  },
  // A warm rising A-major triad.
  success: {
    level: 2.4,
    echo: echo(0.1, 0.22, 0.16, 4500),
    layers: [
      tone('sine', 880, 0, 0.004, 0.09, 0.06),
      tone('sine', 1108.73, 0.06, 0.004, 0.1, 0.06),
      tone('sine', 1318.51, 0.12, 0.004, 0.18, 0.07),
    ],
  },
  // A low knock, then a falling major third (A4 → F4).
  error: {
    level: 4.1,
    layers: [
      noise('bandpass', 850, 1.1, 0, 0.001, 0.035, 0.13),
      tone('triangle', 440, 0.025, 0.004, 0.09, 0.045),
      tone('triangle', 349.23, 0.1, 0.004, 0.14, 0.04),
    ],
  },
  // A papery flick, a brighter swish, and a glass tick.
  page: {
    level: 2.4,
    layers: [
      noise('lowpass', 1800, 0.7, 0, 0.006, 0.08, 0.11),
      noise('bandpass', 4200, 1.2, 0.04, 0.004, 0.065, 0.08),
      tone('sine', 2400, 0.075, 0.002, 0.045, 0.02),
    ],
  },
  // An unresolved lift: a sine rising a fifth over a breath of noise.
  loading: {
    level: 2.1,
    echo: echo(0.11, 0.18, 0.12, 2800),
    layers: [
      noise('lowpass', 1400, 0.6, 0, 0.035, 0.14, 0.035),
      tone('sine', 420, 0, 0.025, 0.18, 0.05, { to: 630, glide: 0.18 }),
    ],
  },
  // A focus tick opening into an E5 + B5 fifth.
  ready: {
    level: 2.6,
    echo: echo(0.13, 0.2, 0.13, 3600),
    layers: [
      noise('bandpass', 3200, 1.7, 0, 0.001, 0.018, 0.1),
      tone('sine', 659.25, 0.025, 0.012, 0.2, 0.05),
      tone('sine', 987.77, 0.025, 0.012, 0.22, 0.035),
    ],
  },
  // A two-stage coin: a metallic body, then a stronger strike an octave up 125 ms later.
  payout: {
    level: 0.68,
    layers: [
      tone('sine', 1168.75, 0, 0.008, 1.15, 0.1),
      tone('sine', 2337.5, 0.125, 0.004, 0.575, 0.49),
      tone('sawtooth', 580, 0, 0.001, 0.055, 0.14, { to: 1168.75, glide: 0.018, pan: -0.82 }),
      tone('sawtooth', 580, 0.00085, 0.001, 0.055, 0.12, { to: 1168.75, glide: 0.018, pan: 0.82 }),
      tone('sawtooth', 1160, 0.125, 0.0005, 0.0275, 0.4, { to: 2337.5, glide: 0.009, pan: -0.24 }),
      tone('sine', 6240, 0, 0.001, 0.065, 0.025, { pan: 0.3 }),
      tone('sine', 15082, 0, 0.001, 0.065, 0.004, { pan: -0.42 }),
      tone('sine', 12480, 0.125, 0.0005, 0.0325, 0.055, { pan: -0.26 }),
      tone('sine', 17836, 0.125, 0.0005, 0.032, 0.01, { pan: 0.38 }),
      noise('bandpass', 3205, 0.9, 0, 0.001, 0.05, 0.22, 0.78),
      noise('highpass', 5200, undefined, 0, 0.001, 0.035, 0.12, -0.76),
      noise('bandpass', 6410, 1.1, 0.125, 0.0005, 0.032, 0.18, -0.55),
      noise('highpass', 10400, undefined, 0.125, 0.0005, 0.018, 0.2, 0.68),
      tone('sine', 25, 0, 0.07, 0.55, 0.027, { pan: 0.62 }),
      tone('sine', 50, 0.125, 0.035, 0.275, 0.09, { pan: -0.68 }),
      tone('sine', 69, 0.125, 0.02, 0.28, 0.025, { pan: 0.52 }),
    ],
  },
  // A wide metallic credit shimmer from paired left/right noise resonators.
  deposit: {
    level: 0.63,
    layers: [
      noise('highpass', 5200, undefined, 0, 0.014, 0.11, 0.28, -0.78),
      noise('highpass', 6000, undefined, 0.012, 0.014, 0.12, 0.34, 0.8),
      noise('bandpass', 9100, 4.2, 0, 0.014, 0.3, 0.18, -0.38),
      noise('bandpass', 9115, 4.8, 0.0012, 0.016, 0.34, 0.24, 0.68),
      noise('bandpass', 6460, 3.5, 0, 0.016, 0.22, 0.12, -0.64),
      noise('bandpass', 6507, 3.8, 0.0018, 0.018, 0.23, 0.14, 0.52),
      noise('bandpass', 12700, 3.5, 0, 0.012, 0.11, 0.14, 0.25),
      noise('bandpass', 14420, 4, 0, 0.014, 0.34, 0.14, -0.72),
      noise('bandpass', 14870, 3.5, 0.012, 0.014, 0.39, 0.16, 0.74),
      tone('sine', 12850, 0, 0.012, 0.09, 0.025, { to: 9112, glide: 0.018, pan: 0.2 }),
      tone('sine', 15050, 0.01, 0.014, 0.16, 0.015, { to: 14420, glide: 0.025, pan: -0.18 }),
      noise('bandpass', 2600, 1.8, 0, 0.015, 0.14, 0.04, -0.1),
      tone('sine', 257, 0, 0.016, 0.13, 0.005, { pan: -0.45 }),
      tone('sine', 437, 0, 0.018, 0.11, 0.004, { pan: 0.38 }),
    ],
  },
  // A snappy pluck: a square wave dropping an octave, C5 → C4, with odd partials.
  pluck: {
    level: 0.62,
    layers: [
      noise('bandpass', 1500, 1.1, 0, 0.0095, 0.002, 0.012, -0.12),
      tone('square', 523.25, 0.011, 0.0012, 0.017, 0.46, { to: 261.63, glide: 0.0082, pan: -0.04 }),
      tone('sine', 1569.75, 0.011, 0.0007, 0.006, 0.28, { to: 784.88, glide: 0.0082, pan: -0.1 }),
      tone('sine', 2616.25, 0.011, 0.0006, 0.005, 0.16, { to: 1308.15, glide: 0.0082, pan: -0.08 }),
      noise('bandpass', 5350, 3.2, 0.011, 0.0005, 0.006, 0.2, -0.18),
      noise('bandpass', 9000, 1.1, 0.0105, 0.0004, 0.004, 0.1, -0.32),
      noise('highpass', 12000, undefined, 0.0105, 0.0003, 0.003, 0.035, -0.46),
      noise('bandpass', 1750, 1, 0.012, 0.0005, 0.012, 0.08, 0.08),
    ],
  },
  // A physical bell: a stereo pre-touch, a broadband strike, and a 12 Hz beating tail.
  notification: {
    level: 0.62,
    layers: [
      noise('bandpass', 2300, 1.1, 0, 0.0105, 0.006, 0.07, -0.75),
      noise('bandpass', 5500, 1.4, 0, 0.0108, 0.006, 0.055, 0.75),
      tone('sawtooth', 440, 0.011, 0.00035, 0.006, 0.62, { to: 880, glide: 0.0012 }),
      tone('sine', 880, 0.011, 0.00045, 0.055, 0.24),
      noise('bandpass', 1900, 1, 0.011, 0.00035, 0.011, 0.11),
      noise('highpass', 7000, undefined, 0.011, 0.0003, 0.007, 0.055),
      tone('sine', 873, 0.011, 0.0007, 0.78, 0.085, { pan: -0.58 }),
      tone('sine', 885, 0.0116, 0.0007, 0.8, 0.085, { pan: 0.58 }),
      tone('sine', 1184, 0.0115, 0.0007, 0.42, 0.014, { pan: 0.32 }),
      tone('sine', 3485, 0.011, 0.0005, 0.19, 0.075, { pan: -0.6 }),
      tone('sine', 3575, 0.01135, 0.0005, 0.2, 0.08, { pan: 0.62 }),
      tone('sine', 6764, 0.011, 0.0004, 0.23, 0.022, { pan: 0.72 }),
      tone('sine', 8853, 0.011, 0.00035, 0.11, 0.008, { pan: -0.65 }),
      tone('sine', 11287, 0.0114, 0.00035, 0.17, 0.009, { pan: 0.7 }),
    ],
  },
  // A heavy two-stage fall; the second stage lands 125 ms later and harder.
  loss: {
    level: 0.54,
    layers: [
      tone('sine', 260, 0, 0.0105, 0.18, 0.48, { to: 52, glide: 0.06 }),
      tone('sawtooth', 800, 0, 0.0105, 0.085, 0.17, { to: 200, glide: 0.03 }),
      tone('sine', 200, 0, 0.0105, 0.115, 0.06),
      noise('bandpass', 3200, 1, 0, 0.01, 0.026, 0.055, -0.58),
      noise('highpass', 7600, undefined, 0, 0.011, 0.022, 0.04, 0.58),
      tone('sine', 400, 0.125, 0.0105, 0.34, 0.68, { to: 52, glide: 0.07 }),
      tone('sawtooth', 600, 0.125, 0.0105, 0.13, 0.22, { to: 147, glide: 0.035 }),
      tone('sine', 147, 0.125, 0.0105, 0.17, 0.08),
      noise('bandpass', 2700, 1, 0.125, 0.0105, 0.05, 0.09, -0.68),
      noise('bandpass', 6700, 1.2, 0.1265, 0.0105, 0.045, 0.07, 0.7),
      noise('highpass', 10500, undefined, 0.125, 0.01, 0.028, 0.035, -0.42),
    ],
  },
} satisfies Record<string, Recipe>;

/** Every built-in sound name. */
export type BuiltinSoundName = keyof typeof recipeTable;
/** Built-in or user-defined name; use isSound() to validate strings at runtime. */
export type SoundName = BuiltinSoundName | (string & {});

/** The recipe for every sound, keyed by name. Frozen; treat as read-only data. */
export const recipes: Readonly<Record<BuiltinSoundName, Recipe>> = Object.freeze(recipeTable);

/** All sound names in catalog order. */
export const sounds: readonly BuiltinSoundName[] = Object.freeze(Object.keys(recipeTable) as BuiltinSoundName[]);

const own = Object.prototype.hasOwnProperty;

/** True when `value` names a built-in sound (own keys only, so `"toString"` is rejected). */
export function isSound(value: unknown): value is SoundName {
  return typeof value === 'string' && (own.call(recipeTable, value) || custom.has(value));
}

/** Seconds from the trigger until the last layer's envelope ends. */
export function sourceEnd(recipe: Recipe): number {
  let end = 0;
  for (const layer of recipe.layers) end = Math.max(end, layer.at + layer.attack + layer.decay);
  return end;
}

/** Seconds of echo after the dry sound, until repeats fall below -60 dB. */
export function echoTail(recipe: Recipe): number {
  const e = recipe.echo;
  if (!e || e.feedback <= 0) return 0;
  if (e.feedback >= 1) return e.delay;
  return e.delay * (1 + Math.ceil(Math.log(0.001) / Math.log(e.feedback)));
}

/** Total audible length of a sound in seconds, including its echo tail. */
export function duration(name: SoundName): number {
  const recipe = getRecipe(name);
  return sourceEnd(recipe) + echoTail(recipe);
}


const custom = new Map<string, Recipe>();

/** Resolves built-in and registered recipes. Call isSound() before using an untrusted name. */
export function getRecipe(name: SoundName): Recipe {
  return custom.get(name) ?? recipes[name as BuiltinSoundName];
}

/** Registers an immutable recipe. Built-in sounds and prototype-property names are reserved. */
export function registerRecipe<Name extends string>(name: Name, recipe: Recipe): Name {
  if (!name.trim() || name in Object.prototype || own.call(recipeTable, name)) throw new RangeError('Sound name is empty or already reserved');
  const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
  const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
  if (!recipe || !positive(recipe.level) || !Array.isArray(recipe.layers) || !recipe.layers.length) throw new RangeError('A recipe needs a positive level and layers');
  for (const layer of recipe.layers) {
    if (!nonnegative(layer.at) || !positive(layer.attack) || !positive(layer.decay) || !nonnegative(layer.peak) || !positive(layer.freq)) throw new RangeError('Invalid layer timing, gain or frequency');
    if (layer.pan !== undefined && (!Number.isFinite(layer.pan) || Math.abs(layer.pan) > 1)) throw new RangeError('Invalid layer pan');
    if ('noise' in layer) {
      if (!['lowpass', 'bandpass', 'highpass'].includes(layer.noise) || (layer.q !== undefined && !positive(layer.q))) throw new RangeError('Invalid noise filter');
    } else {
      if (!['sine', 'triangle', 'sawtooth', 'square'].includes(layer.wave) || (layer.to !== undefined && !positive(layer.to)) || (layer.glide !== undefined && !positive(layer.glide)) || (layer.detune !== undefined && !Number.isFinite(layer.detune))) throw new RangeError('Invalid tone');
    }
  }
  const echo = recipe.echo;
  if (echo && (!positive(echo.delay) || echo.delay > 1 || !nonnegative(echo.feedback) || echo.feedback >= 1 || !nonnegative(echo.wet) || !positive(echo.lowpass))) throw new RangeError('Invalid echo');
  custom.set(name, Object.freeze({
    level: recipe.level,
    layers: Object.freeze(recipe.layers.map(layer => Object.freeze({ ...layer }))),
    ...(echo ? { echo: Object.freeze({ ...echo }) } : {}),
  }));
  return name;
}

export const categories = ['hover', 'controls', 'feedback', 'money'] as const;
export type SoundCategory = typeof categories[number];
/** Default groups match the documentation sound board. Custom sounds default to feedback. */
export const soundCategories: Readonly<Partial<Record<SoundName, SoundCategory>>> = Object.freeze({
  chime: 'hover', sparkle: 'hover', droplet: 'hover', bloom: 'hover', whisper: 'hover',
  tick: 'controls', press: 'controls', release: 'controls', toggle: 'controls', page: 'controls',
  success: 'feedback', error: 'feedback', loading: 'feedback', ready: 'feedback', notification: 'feedback',
  payout: 'money', deposit: 'money', pluck: 'money', loss: 'money',
});
export function isCategory(value: unknown): value is SoundCategory {
  return typeof value === 'string' && (categories as readonly string[]).includes(value);
}
export function categoryOf(name: SoundName): SoundCategory {
  return Object.prototype.hasOwnProperty.call(soundCategories, name) ? soundCategories[name]! : 'feedback';
}
