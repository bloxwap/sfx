/**
 * The React Native engine: the same API and the same recipes as the web entry, played from PCM baked at
 * build time from those recipes (native/assets/bloxwap-sfx) by the package's own Expo module. iOS mixes
 * in-memory buffers through one AVAudioEngine; Android plays them from one SoundPool. A play is one
 * synchronous native call with no seek, no bridge round trip and no per-voice media player.
 *
 * Metro picks this file through the package's "react-native" export condition, so app code keeps
 * importing "@bloxwap/sfx". Without the native module (Expo Go, Jest, a binary built before the package
 * was installed) every call is a silent no-op, exactly like the web entry on a server.
 *
 * Differences from the web entry: sounds registered with define() are validated but stay silent (there is
 * no synthesizer on device); renderTo(), renderBuffer() and getOutput() have nothing to render into; bind()
 * returns a no-op because there is no DOM; and `rate` is limited to 0.5–2 on Android.
 */
import { categoryOf, isCategory, isSound, recipes, registerRecipe, type Recipe, type SoundName } from './recipes.js';
import { getVolume, isEnabled, setEnabled, setVolume as saveVolume, subscribePreference } from './preferences.js';
export { getVolume, isEnabled, setEnabled };
import type { bind as webBind } from './bind.js';
import type { EngineOptions, PlayOptions, VolumeOptions, renderBuffer as webRenderBuffer, renderTo as webRenderTo } from './engine.js';

/** The Expo module's JavaScript surface (ios/BloxwapSfxModule.swift, android/.../BloxwapSfxModule.kt). */
export interface NativeSfxModule {
  configure(maxVoices: number, audioSession: string): void;
  preload(names: string[]): Promise<boolean>;
  addListener(event: 'onVoiceEnded', listener: (event: { voice: number }) => void): { remove(): void };
  /** Starts a sound and returns its voice id, or 0 when it was dropped. */
  play(name: string, gain: number, pan: number, rate: number, delay: number): number;
  stop(voice: number): void;
  stopAll(): void;
  activeVoices(): number;
  setVolume(volume: number): void;
  unlock(): Promise<boolean>;
  dispose(): void;
}

const NOOP = (): void => {};
const own = Object.prototype.hasOwnProperty;

let minInterval = 16;
let maxVoices = 16;
let audioSession: 'ambient' | 'manual' = 'ambient';
let configured = false;
let generation = 0;
let connected: NativeSfxModule | null = null;
let subscription: { remove(): void } | undefined;
const watching = new Map<number, () => void>();
function clearWatching(): void {
  for (const release of watching.values()) release();
  watching.clear();
}
function detach(): void {
  generation++;
  clearWatching();
  try { subscription?.remove(); } catch { /* already detached */ }
  subscription = undefined;
  connected = null;
  configured = false;
}
const lastPlayed = new Map<SoundName, number>();

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
const builtin = (name: SoundName): boolean => own.call(recipes, name);

/** Expo installs native modules on globalThis.expo.modules (SDK 50+), so no import of expo is needed. */
function native(): NativeSfxModule | null {
  return (globalThis as { expo?: { modules?: { BloxwapSfxEngine?: NativeSfxModule } } }).expo?.modules?.BloxwapSfxEngine ?? null;
}

/** Hands the engine settings to the module once, before its first sound. */
function ready(): NativeSfxModule | null {
  const module = native();
  if (module !== connected) detach();
  if (!module) return null;
  if (!configured) {
    try {
      module.configure(maxVoices, audioSession);
      module.setVolume(getVolume());
      subscription ??= module.addListener('onVoiceEnded', ({ voice }) => {
        if (connected !== module) return;
        watching.get(voice)?.();
        watching.delete(voice);
      });
      connected = module;
      configured = true;
    } catch { return null; }
  }
  return module;
}

/**
 * Plays a sound now (or after `options.delay`). Never throws: unknown or custom names, a muted engine, an
 * aborted `options.signal`, or a missing native module make it a silent no-op. `force` has no effect: native
 * apps need no user gesture.
 */
export function play(name: SoundName = 'chime', options?: PlayOptions): void {
  if (!isEnabled() || !isSound(name) || !builtin(name) || options?.signal?.aborted) return;
  const t = now();
  const last = lastPlayed.get(name);
  const gap = options?.minInterval;
  if (last !== undefined && t - last < (typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 ? gap : minInterval)) return;
  const module = ready();
  if (!module) return;
  const gain = clamp(options?.volume, 0, 2, 1) * getVolume({ category: isCategory(options?.category) ? options.category : categoryOf(name) });
  if (gain === 0) return;
  lastPlayed.set(name, t);
  const rate = clamp(options?.rate, 0.25, 4, 1);
  const delay = clamp(options?.delay, 0, 10, 0);
  let voice = 0;
  try {
    voice = module.play(name, gain, clamp(options?.pan, -1, 1, 0), rate, delay);
  } catch {
    return;
  }
  const signal = options?.signal;
  if (!signal || !voice) return;
  // Native completion accounts for decode delay, platform rate clamping, stealing and interruption.
  const release = (): void => signal.removeEventListener('abort', abort);
  const abort = (): void => {
    release();
    watching.delete(voice);
    try { module.stop(voice); } catch { /* already gone */ }
  };
  watching.set(voice, release);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
}

/** Registers a custom recipe so shared code type-checks and validates the same way; it plays nothing on native. */
export function define<Name extends string>(name: Name, recipe: Recipe): Name {
  const result = registerRecipe(name, recipe);
  lastPlayed.delete(name);
  return result;
}

/**
 * Decodes sounds into native memory ahead of time (all of them by default), so their first play is as
 * cheap as every other. Undecoded sounds load on their first play instead; skip preload() to keep memory
 * to the sounds an app actually uses. Never rejects.
 */
export async function preload(names: readonly SoundName[] = Object.keys(recipes)): Promise<boolean> {
  const module = ready();
  if (!module) return false;
  try {
    const session = generation;
    const valid = names.filter((name) => isSound(name) && builtin(name));
    const loaded = await module.preload(valid);
    return loaded === true && valid.length === names.length && generation === session;
  } catch { return false; }
}

/** Starts the native audio engine so the first sound skips its start-up. Resolves true when it is running. */
export async function unlock(): Promise<boolean> {
  const module = ready();
  if (!module) return false;
  try {
    return (await module.unlock()) === true;
  } catch {
    return false;
  }
}

subscribePreference(() => { try { native()?.setVolume(getVolume()); } catch { configured = false; } });

/** Sets the master volume (0–1), or a category multiplier. */
export function setVolume(value: number, options?: VolumeOptions): void {
  saveVolume(value, options);
}

/**
 * Tunes the engine. `maxVoices` (default 16 on native) and `audioSession` take effect when the engine
 * starts, so call configure() before the first sound or after dispose(). `minInterval` applies at once.
 * `resume` and `respectReducedMotion` are web-only and ignored.
 */
export function configure(options: EngineOptions): void {
  if (typeof options.maxVoices === 'number' && Number.isFinite(options.maxVoices) && options.maxVoices >= 1) maxVoices = Math.min(64, Math.floor(options.maxVoices));
  if (typeof options.minInterval === 'number' && Number.isFinite(options.minInterval) && options.minInterval >= 0) minInterval = options.minInterval;
  if (options.audioSession === 'ambient' || options.audioSession === 'manual') audioSession = options.audioSession;
  if (options.maxVoices !== undefined || options.audioSession !== undefined) configured = false;
}

/** Stops every sound that is currently playing. */
export function stopAll(): void {
  clearWatching();
  try { native()?.stopAll(); } catch { /* nothing to stop */ }
}

/** Number of sounds currently playing. */
export function activeVoices(): number {
  try {
    return native()?.activeVoices() ?? 0;
  } catch {
    return 0;
  }
}

/** Always null on native: there is no Web Audio graph to tap. */
export function getOutput(): AudioNode | null {
  return null;
}

/** Stops everything and frees the native engine and every decoded sound. The next play starts fresh. */
export async function dispose(): Promise<void> {
  lastPlayed.clear();
  detach();
  try { native()?.dispose(); } catch { /* already released */ }
}

/** Always false on native: there is no BaseAudioContext to schedule into. */
export const renderTo: typeof webRenderTo = () => false;

/** Always null on native. Bake files with the sfx-wav CLI instead. */
export const renderBuffer: typeof webRenderBuffer = async () => null;

/** A no-op on native, which has no DOM; call play() from your press handlers. Returns its unbind function. */
export const bind: typeof webBind = () => NOOP;

export type { PlayOptions, RenderOptions, EngineOptions, VolumeOptions } from './engine.js';
export type { BindOptions } from './bind.js';
export { sounds, isSound, duration, type SoundName, type BuiltinSoundName, type Recipe, type Layer, type ToneLayer, type NoiseLayer, type Echo } from './recipes.js';
export { categories, categoryOf, soundCategories, isCategory, type SoundCategory } from './recipes.js';
