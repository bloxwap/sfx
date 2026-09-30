import { categoryOf, echoTail, getRecipe, isCategory, isSound, recipes, registerRecipe, sourceEnd, type Recipe, type SoundName, type SoundCategory } from './recipes.js';

/** Per-play adjustments. All are optional and cheap: they add at most two nodes to a voice. */
export interface PlayOptions {
  /** Override the default group for this play (custom sounds default to feedback). */
  category?: SoundCategory;
  /** Linear gain for this play, 0–2. Default 1. */
  volume?: number;
  /** Playback rate: 2 is an octave up and twice as fast. Clamped to 0.25–4. Default 1. */
  rate?: number;
  /** Stereo position from -1 (left) to 1 (right). Default 0. */
  pan?: number;
  /**
   * Seconds to wait before the sound starts, scheduled on the audio clock so main-thread jank cannot
   * shift it. Clamped to 0–10. Default 0. For a key tap: `play('press'); play('release', { delay: 0.09 })`.
   */
  delay?: number;
  /** Overrides configure({ minInterval }) for this call: milliseconds within which a repeat of this sound is dropped. */
  minInterval?: number;
  /**
   * Plays even before the page has seen a user gesture, for capture or kiosk browsers (OBS, CEF) that
   * never get one. Muting, invalid names and the retrigger guard still apply.
   */
  force?: boolean;
}

/** Options for renderTo(): the per-play adjustments plus where to connect the sound. */
export interface RenderOptions extends Pick<PlayOptions, 'volume' | 'rate' | 'pan' | 'delay'> {
  /** Node the sound connects to. Default: the context's destination. */
  destination?: AudioNode;
}

/** Engine tuning. Every field is optional; call once at startup or whenever you need. */
export interface EngineOptions {
  /** Opt-in startup volume of 0.5 for reduced-motion users, unless a master volume was set explicitly. */
  respectReducedMotion?: boolean;
  /** Most voices sounding at once; the oldest is cut when a new one starts. Default 24. */
  maxVoices?: number;
  /** Milliseconds within which a repeat of the same sound is dropped. Default 16 (one frame). */
  minInterval?: number;
  /**
   * What play() does while the context is suspended. 'queue' (default) waits for the resume, plays each
   * sound once and drops requests older than 250 ms. 'eager' schedules the sound at once and resumes
   * alongside it, for the lowest first-sound latency; sounds requested during a long suspension then
   * play together when it ends.
   */
  resume?: 'queue' | 'eager';
}

type Ctx = BaseAudioContext;
interface Voice { readonly name: SoundName; stop(): void }
type ContextConstructor = new (options?: AudioContextOptions) => AudioContext;
type OfflineConstructor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

const FLOOR = 0.0001;
const PAD = 0.05;
const NOISE_SECONDS = 1;
const FALLBACK_RATE = 48000;
/** Requests that waited longer than this for a suspended context are dropped, not played late. */
const STALE_MS = 250;

let enabled = true;
let volume = 1;
let explicitVolume = false;
const categoryVolumes: Record<SoundCategory, number> = { hover: 1, controls: 1, feedback: 1, money: 1 };
let maxVoices = 24;
let minInterval = 16;
let eager = false;

let context: AudioContext | null = null;
let bus: GainNode | null = null;
let output: AudioNode | null = null;
let resuming: Promise<void> | null = null;
let queued: { name: SoundName; options: PlayOptions | undefined; at: number }[] = [];
let listeners: (() => void)[] = [];

const voices = new Set<Voice>();
const lastPlayed = new Map<SoundName, number>();
const rendered = new Map<SoundName, AudioBuffer>();
const rendering = new Map<SoundName, Promise<AudioBuffer | null>>();
const noiseBuffers = new WeakMap<Ctx, AudioBuffer>();

/** Milliseconds from a monotonic clock where available. */
export const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());
/** Clamps a number into range; anything non-finite (including undefined) becomes `fallback`. */
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
/** Neither running nor closed: suspended, or WebKit's 'interrupted'. */
const asleep = (ctx: AudioContext): boolean => ctx.state !== 'running' && ctx.state !== 'closed';

function contextConstructor(): ContextConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: ContextConstructor; webkitAudioContext?: ContextConstructor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function offlineConstructor(): OfflineConstructor | undefined {
  return (globalThis as { OfflineAudioContext?: OfflineConstructor }).OfflineAudioContext;
}

/** False only when the browser reports that the page has not seen a user gesture yet. */
function activated(): boolean {
  if (typeof navigator === 'undefined') return true;
  const activation = (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
  return activation?.hasBeenActive !== false;
}

/** The shared context and its master bus (volume → limiter → speakers), created on first need. */
function audio(): AudioContext | null {
  if (context) return context;
  const Constructor = contextConstructor();
  if (!Constructor) return null;
  let ctx: AudioContext;
  let gain: GainNode;
  let last: AudioNode;
  try {
    ctx = new Constructor({ latencyHint: 'interactive' });
    gain = ctx.createGain();
    gain.gain.value = volume;
    last = gain;
    // A fast, hard-knee limiter keeps overlapping sounds from clipping. Feature-detected.
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;
      gain.connect(limiter);
      last = limiter;
    }
    last.connect(ctx.destination);
  } catch {
    return null;
  }
  context = ctx;
  bus = gain;
  output = last;
  listeners = [
    listen(typeof document === 'undefined' ? undefined : document, 'visibilitychange', onVisibility),
    listen(window, 'pageshow', wake),
    listen(window, 'focus', wake),
  ];
  return ctx;
}

/** Resumes a context the browser suspended or interrupted (backgrounding, a phone call) once the page is back. */
function wake(): void {
  if (context && asleep(context) && activated()) void resume(context);
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') wake();
}

/** Adds a listener where the target supports it; returns its remover. */
function listen(target: EventTarget | undefined, type: string, listener: () => void): () => void {
  if (typeof target?.addEventListener !== 'function') return () => {};
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

/** One second of white noise per context, shared by every noise layer (each reads from a random offset). */
function noiseFor(ctx: Ctx): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.max(1, Math.floor(NOISE_SECONDS * ctx.sampleRate));
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

function envelope(param: AudioParam, start: number, attack: number, end: number, peak: number): void {
  param.setValueAtTime(FLOOR, start);
  param.exponentialRampToValueAtTime(Math.max(FLOOR, peak), start + attack);
  param.exponentialRampToValueAtTime(FLOOR, end);
}

/**
 * Schedules a recipe's layers and echo into `ctx`, starting at `t0`. Used for both the one-time
 * offline render and the live path; `rate` stretches time and pitch like a buffer's playbackRate.
 * Returns the recipe's level node (already connected to `out`) so the caller can detach it.
 */
export function synthesize(ctx: Ctx, recipe: Recipe, out: AudioNode, t0: number, rate = 1, gain = 1): AudioNode[] {
  const level = ctx.createGain();
  level.gain.value = recipe.level * gain;
  level.connect(out);
  const nodes: AudioNode[] = [level];
  const e = recipe.echo;
  if (e) {
    // Echo: level → delay → lowpass → (feedback → delay) + (wet → out)
    const delay = ctx.createDelay(1);
    const lowpass = ctx.createBiquadFilter();
    const feedback = ctx.createGain();
    const wet = ctx.createGain();
    delay.delayTime.value = e.delay / rate;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.min(e.lowpass * rate, ctx.sampleRate / 2);
    feedback.gain.value = e.feedback;
    wet.gain.value = e.wet;
    level.connect(delay).connect(lowpass);
    lowpass.connect(feedback).connect(delay);
    lowpass.connect(wet).connect(out);
    nodes.push(delay, lowpass, feedback, wet);
  }
  const panners = typeof (ctx as { createStereoPanner?: unknown }).createStereoPanner === 'function';
  const nyquist = ctx.sampleRate / 2;
  for (const layer of recipe.layers) {
    const start = t0 + layer.at / rate;
    const attack = layer.attack / rate;
    const end = start + attack + layer.decay / rate;
    const env = ctx.createGain();
    envelope(env.gain, start, attack, end, layer.peak);
    let source: AudioScheduledSourceNode;
    if ('noise' in layer) {
      const buffer = noiseFor(ctx);
      const player = ctx.createBufferSource();
      player.buffer = buffer;
      player.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = layer.noise;
      filter.frequency.value = Math.min(layer.freq * rate, nyquist);
      if (layer.q !== undefined) filter.Q.value = layer.q;
      player.connect(filter).connect(env);
      player.start(start, Math.random() * buffer.duration);
      source = player;
    } else {
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(Math.min(layer.freq * rate, nyquist), start);
      if (layer.to !== undefined) {
        const glide = (layer.glide ?? layer.attack + layer.decay) / rate;
        osc.frequency.exponentialRampToValueAtTime(Math.min(layer.to * rate, nyquist), start + glide);
      }
      if (layer.detune) osc.detune.value = layer.detune;
      osc.connect(env);
      osc.start(start);
      source = osc;
    }
    source.stop(end + PAD);
    if (layer.pan !== undefined && panners) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(layer.pan, -1, 1, 0), start);
      env.connect(panner).connect(level);
    } else {
      env.connect(level);
    }
  }
  return nodes;
}

/** Seconds a sound rings for, including its echo and scheduling pad. */
function length(recipe: Recipe): number {
  return sourceEnd(recipe) + PAD + echoTail(recipe) + PAD;
}

/** Renders a sound to a fresh stereo buffer. Resolves null where offline rendering is unavailable or fails. */
async function bake(name: SoundName, sampleRate: number): Promise<AudioBuffer | null> {
  const Offline = offlineConstructor();
  if (!Offline) return null;
  const recipe = getRecipe(name);
  try {
    const offline = new Offline(2, Math.ceil(length(recipe) * sampleRate), sampleRate);
    synthesize(offline, recipe, offline.destination, 0);
    return await offline.startRendering();
  } catch {
    return null;
  }
}

/** Renders a sound once for playback at the live context's rate, sharing a render already in flight. */
function render(name: SoundName): Promise<AudioBuffer | null> {
  const done = rendered.get(name);
  if (done) return Promise.resolve(done);
  let pending = rendering.get(name);
  if (!pending) {
    pending = bake(name, context?.sampleRate ?? FALLBACK_RATE).then((buffer) => {
      // Skip the store when dispose() ran meanwhile: the buffer may be at the old context's rate.
      if (rendering.get(name) === pending) {
        rendering.delete(name);
        if (buffer) rendered.set(name, buffer);
      }
      return buffer;
    });
    rendering.set(name, pending);
  }
  return pending;
}

/** Adds the per-play panner only when it changes something. */
function route(ctx: Ctx, source: AudioNode, options: PlayOptions | undefined, destination: AudioNode): AudioNode[] {
  const extra: AudioNode[] = [];
  let tail = source;
  const pan = clamp(options?.pan, -1, 1, 0);
  if (pan !== 0 && typeof (ctx as { createStereoPanner?: unknown }).createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    tail = tail.connect(panner);
    extra.push(panner);
  }
  tail.connect(destination);
  return extra;
}

function register(voice: Voice): void {
  if (voices.size >= maxVoices) {
    const oldest = voices.values().next().value;
    if (oldest) {
      voices.delete(oldest);
      oldest.stop();
    }
  }
  voices.add(voice);
}

/**
 * Synthesizes a sound into `destination`, starting `delay` seconds after the context's current time.
 * Returns every node it created (for teardown) and the seconds until it has rung out.
 */
function schedule(ctx: Ctx, name: SoundName, options: PlayOptions | undefined, destination: AudioNode): [AudioNode[], number] {
  const recipe = getRecipe(name);
  const rate = clamp(options?.rate, 0.25, 4, 1);
  const delay = clamp(options?.delay, 0, 10, 0);
  const mix = ctx.createGain();
  const nodes = [mix, ...route(ctx, mix, options, destination)];
  nodes.push(...synthesize(ctx, recipe, mix, ctx.currentTime + delay, rate, clamp(options?.volume, 0, 2, 1)));
  return [nodes, delay + length(recipe) / rate];
}

function start(ctx: AudioContext, name: SoundName, options: PlayOptions | undefined): void {
  const destination = bus as GainNode;
  const buffer = rendered.get(name);
  const multiplier = categoryVolumes[isCategory(options?.category) ? options.category : categoryOf(name)];
  const gain = clamp(options?.volume, 0, 2, 1) * multiplier;
  if (gain === 0) return;
  if (multiplier !== 1) options = { ...options, volume: gain };
  const rate = clamp(options?.rate, 0.25, 4, 1);
  if (buffer) {
    // Hot path: one buffer source per play (plus a gain/panner only when asked for).
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (rate !== 1) source.playbackRate.value = rate;
    let head: AudioNode = source;
    const nodes: AudioNode[] = [];
    if (gain !== 1) {
      const level = ctx.createGain();
      level.gain.value = gain;
      head = source.connect(level);
      nodes.push(level);
    }
    nodes.push(...route(ctx, head, options, destination));
    const voice: Voice = {
      name,
      stop() {
        try { source.stop(); } catch { /* already stopped */ }
      },
    };
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    register(voice);
    source.start(ctx.currentTime + clamp(options?.delay, 0, 10, 0));
    return;
  }
  // First play of this sound: synthesize it live now, and render its buffer for next time.
  const [nodes, seconds] = schedule(ctx, name, options, destination);
  const end = ctx.currentTime + seconds;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const voice: Voice = {
    name,
    stop() {
      clearTimeout(timer);
      voices.delete(voice);
      for (const node of nodes) node.disconnect();
    },
  };
  // Tear down by the audio clock, which stands still while the context is suspended, so a sound
  // scheduled before (or paused by) a suspension is not cut off when it finally plays.
  const done = (): void => {
    const left = end - ctx.currentTime;
    if (left > 0 && ctx.state !== 'closed') timer = setTimeout(done, left * 1000);
    else voice.stop();
  };
  timer = setTimeout(done, seconds * 1000);
  register(voice);
  void render(name);
}

function flush(): void {
  const ctx = context;
  const pending = queued;
  queued = [];
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const cutoff = now() - STALE_MS;
  const seen = new Set<SoundName>();
  for (const request of pending) {
    // Play each sound at most once per resume, and only if the user is still waiting for it.
    if (request.at < cutoff || seen.has(request.name)) continue;
    seen.add(request.name);
    try { start(ctx, request.name, request.options); } catch { /* see play() */ }
  }
}

function resume(ctx: AudioContext): Promise<void> {
  if (!resuming) {
    let promise: Promise<void>;
    try {
      promise = Promise.resolve(ctx.resume());
    } catch (error) {
      promise = Promise.reject(error);
    }
    resuming = promise.then(flush, () => { queued = []; }).finally(() => { resuming = null; });
  }
  return resuming;
}

/**
 * Plays a sound now (or after `options.delay`). Never throws: unknown names, a muted engine, a page
 * without a user gesture yet (unless `options.force`), or a browser without Web Audio all make it a
 * silent no-op.
 */
export function play(name: SoundName = 'chime', options?: PlayOptions): void {
  if (!enabled || !isSound(name) || !(options?.force || activated())) return;
  const t = now();
  const last = lastPlayed.get(name);
  const gap = options?.minInterval;
  if (last !== undefined && t - last < (typeof gap === 'number' && gap >= 0 ? gap : minInterval)) return;
  const ctx = audio();
  if (!ctx) return;
  lastPlayed.set(name, t);
  if (ctx.state !== 'running') {
    const wait = !eager || !asleep(ctx);
    if (wait && queued.length < 16) queued.push({ name, options, at: t });
    void resume(ctx);
    if (wait) return;
  }
  try {
    start(ctx, name, options);
  } catch {
    // A browser that rejects a node or parameter must not break the caller's event handler.
  }
}

/**
 * Renders sounds to buffers ahead of time (all of them by default), so their first play is as cheap
 * as every other. Works before any user gesture: rendering is offline and makes no sound.
 */
export async function preload(names: readonly SoundName[] = Object.keys(recipes) as SoundName[]): Promise<void> {
  await Promise.all(names.filter(isSound).map(render));
}

/**
 * Schedules a sound onto any context, such as an OfflineAudioContext baking a video soundtrack, at its
 * current time plus `options.delay`. Ignores muting, activation, voices and caches. Returns false for
 * an unknown name or when the context rejects the graph; never throws.
 */
export function renderTo(target: BaseAudioContext, name: SoundName, options?: RenderOptions): boolean {
  if (!isSound(name)) return false;
  try {
    schedule(target, name, options, options?.destination ?? target.destination);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders one sound to a new stereo AudioBuffer, separate from play()'s cache. `sampleRate` is clamped
 * to 3000–768000 Hz and defaults to the live context's rate, else 48 kHz. Resolves null for an unknown
 * name or where offline rendering is unavailable or fails.
 */
export async function renderBuffer(name: SoundName, options?: { sampleRate?: number }): Promise<AudioBuffer | null> {
  if (!isSound(name)) return null;
  return bake(name, clamp(options?.sampleRate, 3000, 768000, context?.sampleRate ?? FALLBACK_RATE));
}

/**
 * Creates and resumes the audio context. Call it from a user gesture (bind() does this for you on the
 * first pointer or key press) so the first sound starts without delay. Resolves true when running.
 */
export async function unlock(): Promise<boolean> {
  if (!activated()) return false;
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state !== 'running') await resume(ctx);
  return ctx.state === 'running';
}

/**
 * Turns all future playback on or off. Sounds already playing finish, but muting a suspended context
 * also drops the sounds waiting on it. Non-booleans are ignored.
 */
export function setEnabled(value: boolean): void {
  if (typeof value !== 'boolean') return;
  enabled = value;
  if (value) return;
  // In 'eager' mode sounds requested during a suspension are already scheduled; none has been heard yet.
  if (context && asleep(context)) stopAll();
  else queued = [];
}

export function isEnabled(): boolean {
  return enabled;
}

/** Sets the master volume, 0–1. Changes glide over a few milliseconds to avoid clicks. */
export interface VolumeOptions { category?: SoundCategory }

export function setVolume(value: number, options?: VolumeOptions): void {
  if (typeof value !== 'number' || Number.isNaN(value)) return;
  if (options?.category !== undefined) {
    if (isCategory(options.category)) categoryVolumes[options.category] = clamp(value, 0, 1, categoryVolumes[options.category]);
    return;
  }
  explicitVolume = true;
  volume = clamp(value, 0, 1, volume);
  if (context && bus) {
    const param = bus.gain;
    if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(volume, context.currentTime, 0.01);
    else param.value = volume;
  }
}

export function getVolume(options?: VolumeOptions): number {
  return isCategory(options?.category) ? categoryVolumes[options.category] : volume;
}

/** Tunes voice limits and resume behavior. Unknown or invalid fields are ignored. */
export function configure(options: EngineOptions): void {
  if (options.respectReducedMotion === true && !explicitVolume && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) setVolume(0.5);
  if (typeof options.maxVoices === 'number' && options.maxVoices >= 1) maxVoices = Math.floor(options.maxVoices);
  if (typeof options.minInterval === 'number' && options.minInterval >= 0) minInterval = options.minInterval;
  if (options.resume === 'queue' || options.resume === 'eager') eager = options.resume === 'eager';
}

/** Stops every sound that is currently playing. */
export function stopAll(): void {
  queued = [];
  for (const voice of [...voices]) voice.stop();
  voices.clear();
}

/** Number of sounds currently playing. */
export function activeVoices(): number {
  return voices.size;
}

/**
 * The last node before the speakers, or null before the first sound. Connect an AnalyserNode or a
 * MediaStreamDestination to it to visualize or record the output.
 */
export function getOutput(): AudioNode | null {
  return output;
}

/**
 * Stops everything, closes the audio context, removes its page listeners and forgets rendered buffers.
 * The next play starts fresh.
 */
export async function dispose(): Promise<void> {
  stopAll();
  for (const remove of listeners) remove();
  listeners = [];
  const ctx = context;
  context = null;
  bus = null;
  output = null;
  resuming = null;
  rendered.clear();
  rendering.clear();
  lastPlayed.clear();
  if (ctx && typeof ctx.close === 'function') {
    try { await ctx.close(); } catch { /* already closed */ }
  }
}


/** Defines or replaces a custom sound, invalidating its cached and in-flight renders. */
export function define<Name extends string>(name: Name, recipe: Recipe): Name {
  const result = registerRecipe(name, recipe);
  rendered.delete(name);
  rendering.delete(name);
  lastPlayed.delete(name);
  return result;
}
