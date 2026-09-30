// A recording stand-in for the Web Audio API: every node, connection, parameter change and start/stop
// is kept so tests can assert on the graph the engine builds, without producing sound.

export class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); this.value = value; return this; }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exp', value, time]); return this; }
  setTargetAtTime(value, time, constant) { this.events.push(['target', value, time, constant]); this.value = value; return this; }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.outputs = [];
    this.disconnects = 0;
    context.nodes.push(this);
  }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.disconnects++; this.outputs = []; }
}

class FakeSource extends FakeNode {
  constructor(context, kind) {
    super(context, kind);
    this.startedAt = undefined;
    this.stoppedAt = undefined;
    this.onended = null;
  }
  start(time = 0, offset) { this.startedAt = time; this.offset = offset; }
  stop(time) {
    if (this.startedAt === undefined) throw new Error('InvalidStateError: not started');
    this.stoppedAt = time ?? this.context.currentTime;
    // Only an immediate stop() ends the source during a test; scheduled stops never fire.
    if (time === undefined) queueMicrotask(() => this.onended?.());
  }
  /** Simulates the buffer reaching its end. */
  end() { this.onended?.(); }
}

export class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.data[channel]; }
}

export class FakeBaseContext {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.nodes = [];
    this.buffers = 0;
    this.destination = new FakeNode(this, 'destination');
  }
  of(kind) { return this.nodes.filter((node) => node.kind === kind); }
  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(1); return n; }
  createDelay(max) { const n = new FakeNode(this, 'delay'); n.maxDelayTime = max; n.delayTime = new FakeParam(0); return n; }
  createBiquadFilter() {
    const n = new FakeNode(this, 'filter');
    n.type = 'lowpass'; n.frequency = new FakeParam(350); n.Q = new FakeParam(1);
    return n;
  }
  createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(0); return n; }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[key] = new FakeParam(0);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this, 'oscillator');
    n.type = 'sine'; n.frequency = new FakeParam(440); n.detune = new FakeParam(0);
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this, 'source');
    n.buffer = null; n.loop = false; n.playbackRate = new FakeParam(1);
    return n;
  }
  createBuffer(channels, length, sampleRate) { this.buffers++; return new FakeBuffer(channels, length, sampleRate); }
}

/** A controllable AudioContext. `FakeAudioContext.next` configures the next instance's state/resume. */
export class FakeAudioContext extends FakeBaseContext {
  static instances = [];
  static constructed = 0;
  static next = {};
  constructor(options) {
    FakeAudioContext.constructed++;
    const { state = 'running', resume, throws, sampleRate = 48000 } = FakeAudioContext.next;
    if (throws) throw new Error('AudioContext not allowed');
    super(sampleRate);
    this.options = options;
    this.state = state;
    this.resumes = 0;
    this.closed = false;
    this.resumeImpl = resume;
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.resumes++;
    if (this.resumeImpl) return this.resumeImpl(this);
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  static reset() {
    FakeAudioContext.instances = [];
    FakeAudioContext.constructed = 0;
    FakeAudioContext.next = {};
  }
}

/** An OfflineAudioContext whose render resolves to a silent buffer of the requested shape. */
export class FakeOfflineAudioContext extends FakeBaseContext {
  static instances = [];
  static fail = false;
  constructor(channels, length, sampleRate) {
    super(sampleRate);
    this.channels = channels;
    this.length = length;
    FakeOfflineAudioContext.instances.push(this);
  }
  startRendering() {
    if (FakeOfflineAudioContext.fail) return Promise.reject(new Error('render failed'));
    return Promise.resolve(new FakeBuffer(this.channels, this.length, this.sampleRate));
  }
  static reset() {
    FakeOfflineAudioContext.instances = [];
    FakeOfflineAudioContext.fail = false;
  }
}

/** Installs the fakes as browser globals (window.AudioContext, OfflineAudioContext). */
export function installAudio({ offline = true } = {}) {
  FakeAudioContext.reset();
  FakeOfflineAudioContext.reset();
  globalThis.window = globalThis;
  globalThis.AudioContext = FakeAudioContext;
  if (offline) globalThis.OfflineAudioContext = FakeOfflineAudioContext;
  else delete globalThis.OfflineAudioContext;
}

/** Sets navigator.userActivation.hasBeenActive (undefined removes userActivation entirely). */
export function setActivation(hasBeenActive) {
  const value = hasBeenActive === undefined ? {} : { userActivation: { hasBeenActive } };
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A minimal EventTarget that records listeners and dispatches synchronously. */
export class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
  total() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  dispatch(type) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
}

/**
 * Gives the fake window (globalThis) addEventListener/removeEventListener and, unless `document` is
 * false, a document with a settable visibilityState. Returns the targets and a remover.
 */
export function installEvents({ document = true } = {}) {
  const win = new FakeEventTarget();
  globalThis.addEventListener = win.addEventListener.bind(win);
  globalThis.removeEventListener = win.removeEventListener.bind(win);
  const doc = document ? Object.assign(new FakeEventTarget(), { visibilityState: 'visible' }) : undefined;
  if (doc) globalThis.document = doc;
  const uninstall = () => {
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
    delete globalThis.document;
  };
  return { win, doc, uninstall };
}
