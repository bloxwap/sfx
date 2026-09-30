// A recording stand-in for the Web Audio API: every node, connection, parameter change and start/stop
// is kept so tests can assert on the graph the engine builds, without producing sound.

export type ParamEvent = ['set' | 'exp', number, number] | ['target', number, number, number];

export class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value: number, time: number): this { this.events.push(['set', value, time]); this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, time: number): this { this.events.push(['exp', value, time]); return this; }
  setTargetAtTime(value: number, time: number, constant: number): this { this.events.push(['target', value, time, constant]); this.value = value; return this; }
}

export class FakeNode {
  context: FakeBaseContext;
  kind: string;
  outputs: FakeNode[] = [];
  disconnects = 0;
  constructor(context: FakeBaseContext, kind: string) {
    this.context = context;
    this.kind = kind;
    context.nodes.push(this);
  }
  connect<T extends FakeNode>(node: T): T { this.outputs.push(node); return node; }
  disconnect(): void { this.disconnects++; this.outputs = []; }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeDelay extends FakeNode {
  maxDelayTime: number | undefined;
  delayTime = new FakeParam(0);
}

export class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

export class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(0);
  knee = new FakeParam(0);
  ratio = new FakeParam(0);
  attack = new FakeParam(0);
  release = new FakeParam(0);
}

export class FakeSource extends FakeNode {
  startedAt: number | undefined = undefined;
  stoppedAt: number | undefined = undefined;
  offset: number | undefined;
  onended: (() => void) | null = null;
  start(time = 0, offset?: number): void { this.startedAt = time; this.offset = offset; }
  stop(time?: number): void {
    if (this.startedAt === undefined) throw new Error('InvalidStateError: not started');
    this.stoppedAt = time ?? this.context.currentTime;
    // Only an immediate stop() ends the source during a test; scheduled stops never fire.
    if (time === undefined) queueMicrotask(() => this.onended?.());
  }
  /** Simulates the buffer reaching its end. */
  end(): void { this.onended?.(); }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
}

/** Node classes by the `kind` that `FakeBaseContext.of()` filters on. */
export interface FakeNodes {
  destination: FakeNode;
  gain: FakeGain;
  delay: FakeDelay;
  filter: FakeFilter;
  panner: FakePanner;
  compressor: FakeCompressor;
  oscillator: FakeOscillator;
  source: FakeBufferSource;
}

export class FakeBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array { return this.data[channel]!; }
}

export class FakeBaseContext {
  sampleRate: number;
  currentTime = 0;
  nodes: FakeNode[] = [];
  buffers = 0;
  destination: FakeNode;
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination = new FakeNode(this, 'destination');
  }
  of<K extends keyof FakeNodes>(kind: K): FakeNodes[K][] { return this.nodes.filter((node) => node.kind === kind) as FakeNodes[K][]; }
  createGain(): FakeGain { return new FakeGain(this, 'gain'); }
  createDelay(max?: number): FakeDelay { const n = new FakeDelay(this, 'delay'); n.maxDelayTime = max; return n; }
  createBiquadFilter(): FakeFilter { return new FakeFilter(this, 'filter'); }
  createStereoPanner(): FakePanner { return new FakePanner(this, 'panner'); }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(this, 'compressor'); }
  createOscillator(): FakeOscillator { return new FakeOscillator(this, 'oscillator'); }
  createBufferSource(): FakeBufferSource { return new FakeBufferSource(this, 'source'); }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer { this.buffers++; return new FakeBuffer(channels, length, sampleRate); }
}

/** What `FakeAudioContext.next` can set for the next instance. */
export interface NextContext {
  state?: AudioContextState;
  resume?: (ctx: FakeAudioContext) => Promise<void>;
  throws?: boolean;
  sampleRate?: number;
}

/** A controllable AudioContext. `FakeAudioContext.next` configures the next instance's state/resume. */
export class FakeAudioContext extends FakeBaseContext {
  static instances: FakeAudioContext[] = [];
  static constructed = 0;
  static next: NextContext = {};
  options: AudioContextOptions | undefined;
  state: AudioContextState;
  resumes = 0;
  closed = false;
  resumeImpl: NextContext['resume'];
  constructor(options?: AudioContextOptions) {
    FakeAudioContext.constructed++;
    const { state = 'running', resume, throws, sampleRate = 48000 } = FakeAudioContext.next;
    if (throws) throw new Error('AudioContext not allowed');
    super(sampleRate);
    this.options = options;
    this.state = state;
    this.resumeImpl = resume;
    FakeAudioContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.resumes++;
    if (this.resumeImpl) return this.resumeImpl(this);
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  static reset(): void {
    FakeAudioContext.instances = [];
    FakeAudioContext.constructed = 0;
    FakeAudioContext.next = {};
  }
}

/** An OfflineAudioContext whose render resolves to a silent buffer of the requested shape. */
export class FakeOfflineAudioContext extends FakeBaseContext {
  static instances: FakeOfflineAudioContext[] = [];
  static fail = false;
  channels: number;
  length: number;
  constructor(channels: number, length: number, sampleRate: number) {
    super(sampleRate);
    this.channels = channels;
    this.length = length;
    FakeOfflineAudioContext.instances.push(this);
  }
  startRendering(): Promise<FakeBuffer> {
    if (FakeOfflineAudioContext.fail) return Promise.reject(new Error('render failed'));
    return Promise.resolve(new FakeBuffer(this.channels, this.length, this.sampleRate));
  }
  static reset(): void {
    FakeOfflineAudioContext.instances = [];
    FakeOfflineAudioContext.fail = false;
  }
}

/** globalThis as a plain bag, for installing and removing browser globals the DOM types declare read-only. */
export const globals = globalThis as unknown as Record<string, unknown>;

/** Hands a fake to an API typed for the real Web Audio or DOM object. */
export function asReal<T = BaseAudioContext>(fake: object): T {
  return fake as T;
}

/** Installs the fakes as browser globals (window.AudioContext, OfflineAudioContext). */
export function installAudio({ offline = true } = {}): void {
  FakeAudioContext.reset();
  FakeOfflineAudioContext.reset();
  globals.window = globalThis;
  globals.AudioContext = FakeAudioContext;
  if (offline) globals.OfflineAudioContext = FakeOfflineAudioContext;
  else delete globals.OfflineAudioContext;
}

/** Sets navigator.userActivation.hasBeenActive (undefined removes userActivation entirely). */
export function setActivation(hasBeenActive: boolean | undefined): void {
  const value = hasBeenActive === undefined ? {} : { userActivation: { hasBeenActive } };
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Listener = () => void;

/** A minimal EventTarget that records listeners and dispatches synchronously. */
export class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
  count(type: string): number { return this.listeners.get(type)?.size ?? 0; }
  total(): number { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  dispatch(type: string): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
}

/** A FakeEventTarget with the document's settable visibilityState. */
export type FakeDocument = FakeEventTarget & { visibilityState: DocumentVisibilityState };

/**
 * Gives the fake window (globalThis) addEventListener/removeEventListener and, unless `document` is
 * false, a document with a settable visibilityState. Returns the targets and a remover.
 */
export function installEvents({ document = true } = {}): { win: FakeEventTarget; doc: FakeDocument | undefined; uninstall: () => void } {
  const win = new FakeEventTarget();
  globals.addEventListener = win.addEventListener.bind(win);
  globals.removeEventListener = win.removeEventListener.bind(win);
  const doc: FakeDocument | undefined = document ? Object.assign(new FakeEventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }) : undefined;
  if (doc) globals.document = doc;
  const uninstall = (): void => {
    delete globals.addEventListener;
    delete globals.removeEventListener;
    delete globals.document;
  };
  return { win, doc, uninstall };
}
