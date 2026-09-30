import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeOfflineAudioContext, installAudio, setActivation, tick } from './fake-audio.mjs';
import {
  activeVoices, configure, dispose, getOutput, getVolume, isEnabled, play, preload, setEnabled, setVolume, sounds, stopAll, unlock,
} from '../dist/index.js';

const live = () => FakeAudioContext.instances.at(-1);
const bufferSources = (ctx) => ctx.of('source').filter((node) => node.buffer && node.buffer.numberOfChannels === 2);

async function reset({ offline = true } = {}) {
  await dispose();
  installAudio({ offline });
  setActivation(undefined);
  setEnabled(true);
  setVolume(1);
  configure({ maxVoices: 24, minInterval: 0 });
}

describe('play() gating', () => {
  beforeEach(() => reset());

  test('unknown, inherited and non-string names are silent and create no context', () => {
    for (const name of ['toString', '__proto__', 'constructor', 'nope', '', null, 42, {}]) {
      assert.doesNotThrow(() => play(name));
    }
    assert.equal(FakeAudioContext.constructed, 0);
  });

  test('defaults to chime', () => {
    play();
    const osc = live().of('oscillator').map((node) => node.frequency.events[0][1]);
    assert.deepEqual(osc, [1046.5, 1568]);
  });

  test('a page without a user gesture yet creates no context; the first play after one does', () => {
    setActivation(false);
    play('chime');
    assert.equal(FakeAudioContext.constructed, 0);
    setActivation(true);
    play('chime');
    assert.equal(FakeAudioContext.constructed, 1);
  });

  test('setEnabled(false) mutes; non-booleans are ignored', () => {
    setEnabled(false);
    play('chime');
    assert.equal(FakeAudioContext.constructed, 0);
    setEnabled('yes');
    assert.equal(isEnabled(), false);
    setEnabled(true);
    assert.equal(isEnabled(), true);
  });

  test('a constructor that throws is swallowed and retried on the next play', () => {
    FakeAudioContext.next = { throws: true };
    assert.doesNotThrow(() => play('chime'));
    assert.doesNotThrow(() => play('chime'));
    assert.equal(FakeAudioContext.constructed, 2);
    assert.equal(getOutput(), null);
  });

  test('a context whose nodes throw never breaks the caller', async () => {
    const saved = FakeAudioContext.prototype.createGain;
    FakeAudioContext.prototype.createGain = () => { throw new Error('bus'); };
    try {
      assert.doesNotThrow(() => play('chime'));
      assert.equal(getOutput(), null);
      assert.equal(await unlock(), false);
    } finally {
      FakeAudioContext.prototype.createGain = saved;
    }
    play('tick');
    const ctx = live();
    ctx.createOscillator = () => { throw new Error('oscillator'); };
    assert.doesNotThrow(() => play('chime'));
  });

  test('a queued sound whose graph throws is skipped after resume', async () => {
    FakeAudioContext.next = { state: 'suspended' };
    play('chime');
    live().createOscillator = () => { throw new Error('oscillator'); };
    await tick();
    assert.equal(live().state, 'running');
  });

  test('no navigator global means no activation gate', () => {
    delete globalThis.navigator;
    play('tick');
    assert.equal(FakeAudioContext.constructed, 1);
  });

  test('no window (SSR) is a silent no-op', () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      assert.doesNotThrow(() => play('chime'));
      assert.equal(FakeAudioContext.constructed, 0);
    } finally {
      globalThis.window = saved;
    }
  });

  test('the prefixed webkitAudioContext is used when AudioContext is missing', () => {
    globalThis.webkitAudioContext = FakeAudioContext;
    delete globalThis.AudioContext;
    try {
      play('tick');
      assert.equal(FakeAudioContext.constructed, 1);
    } finally {
      delete globalThis.webkitAudioContext;
    }
  });

  test('repeats of one sound inside minInterval are dropped, other sounds are not', () => {
    configure({ minInterval: 10_000 });
    play('tick');
    play('tick');
    play('press');
    const ctx = live();
    assert.equal(ctx.of('oscillator').length, 1, 'one tick (its only oscillator)');
    assert.equal(ctx.of('filter').length, 2, 'one tick noise filter + one press noise filter');
  });

  test('works with no performance global', () => {
    const saved = globalThis.performance;
    Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
    try {
      play('tick');
      assert.equal(FakeAudioContext.constructed, 1);
    } finally {
      Object.defineProperty(globalThis, 'performance', { value: saved, configurable: true, writable: true });
    }
  });
});

describe('master bus', () => {
  beforeEach(() => reset());

  test('volume → limiter → destination, created once with the interactive latency hint', () => {
    play('tick');
    play('press');
    assert.equal(FakeAudioContext.constructed, 1);
    const ctx = live();
    assert.deepEqual(ctx.options, { latencyHint: 'interactive' });
    const [bus] = ctx.of('gain');
    const [limiter] = ctx.of('compressor');
    assert.deepEqual(bus.outputs, [limiter]);
    assert.deepEqual(limiter.outputs, [ctx.destination]);
    assert.equal(limiter.ratio.value, 20);
    assert.equal(getOutput(), limiter);
  });

  test('without a compressor the bus connects straight to the speakers', () => {
    const saved = FakeAudioContext.prototype.createDynamicsCompressor;
    FakeAudioContext.prototype.createDynamicsCompressor = undefined;
    try {
      play('tick');
      const [bus] = live().of('gain');
      assert.deepEqual(bus.outputs, [live().destination]);
      assert.equal(getOutput(), bus);
    } finally {
      FakeAudioContext.prototype.createDynamicsCompressor = saved;
    }
  });

  test('setVolume clamps to 0–1 and glides the live bus', () => {
    setVolume(3);
    assert.equal(getVolume(), 1);
    setVolume(-1);
    assert.equal(getVolume(), 0);
    setVolume(Number.NaN);
    setVolume('loud');
    assert.equal(getVolume(), 0);
    setVolume(0.5);
    play('tick');
    const [bus] = live().of('gain');
    assert.equal(bus.gain.value, 0.5);
    setVolume(0.25);
    assert.deepEqual(bus.gain.events.at(-1), ['target', 0.25, 0, 0.01]);
  });

  test('setVolume falls back to .value where setTargetAtTime is missing', () => {
    play('tick');
    const [bus] = live().of('gain');
    bus.gain.setTargetAtTime = undefined;
    setVolume(0.3);
    assert.equal(bus.gain.value, 0.3);
  });
});

describe('rendering', () => {
  beforeEach(() => reset());

  test('the first play synthesizes live and renders a stereo buffer; later plays use one buffer node', async () => {
    play('chime');
    const ctx = live();
    assert.equal(ctx.of('oscillator').length, 2, 'live synthesis on first play');
    assert.equal(FakeOfflineAudioContext.instances.length, 1);
    const offline = FakeOfflineAudioContext.instances[0];
    assert.equal(offline.channels, 2);
    assert.equal(offline.sampleRate, ctx.sampleRate);
    // 1.176 s by the cleanup formula (source end + echo tail + two pads).
    assert.equal(offline.length, Math.ceil(1.176 * ctx.sampleRate));
    await tick();

    const before = ctx.nodes.length;
    play('chime');
    const added = ctx.nodes.slice(before);
    assert.deepEqual(added.map((node) => node.kind), ['source'], 'exactly one node per buffered play');
    assert.equal(added[0].buffer.numberOfChannels, 2);
    assert.deepEqual(added[0].outputs, [ctx.of('gain')[0]], 'straight into the bus');
    assert.equal(added[0].startedAt, 0);
  });

  test('a render in flight is shared, not repeated', async () => {
    await Promise.all([preload(['tick']), preload(['tick'])]);
    assert.equal(FakeOfflineAudioContext.instances.length, 1);
    await preload(['tick']);
    assert.equal(FakeOfflineAudioContext.instances.length, 1, 'cached after the first render');
  });

  test('preload renders every sound before any gesture, without an AudioContext', async () => {
    setActivation(false);
    await preload();
    assert.equal(FakeOfflineAudioContext.instances.length, sounds.length);
    assert.equal(FakeAudioContext.constructed, 0);
    assert.ok(FakeOfflineAudioContext.instances.every((ctx) => ctx.sampleRate === 48000));
    await preload(['toString', 'nope']);
    assert.equal(FakeOfflineAudioContext.instances.length, sounds.length, 'invalid names are skipped');
  });

  test('without OfflineAudioContext every play synthesizes live', async () => {
    await reset({ offline: false });
    await preload(['tick']);
    play('tick');
    await tick();
    play('tick');
    assert.equal(live().of('oscillator').length, 2);
  });

  test('a failed render falls back to live synthesis and can be retried', async () => {
    FakeOfflineAudioContext.fail = true;
    await preload(['tick']);
    play('tick');
    assert.equal(live().of('oscillator').length, 1);
    await tick();
    FakeOfflineAudioContext.fail = false;
    await preload(['tick']);
    const ctx = live();
    const before = ctx.nodes.length;
    play('tick');
    assert.deepEqual(ctx.nodes.slice(before).map((n) => n.kind), ['source']);
  });

  test('the noise buffer is allocated once per context and read from random offsets', async () => {
    await reset({ offline: false });
    play('deposit');
    play('toggle');
    const ctx = live();
    assert.equal(ctx.buffers, 1);
    const noise = ctx.of('source');
    assert.equal(noise.length, 12, "10 deposit + 2 toggle noise layers");
    assert.ok(noise.every((node) => node.loop && node.buffer === noise[0].buffer));
    assert.ok(noise.every((node) => node.offset >= 0 && node.offset < 1));
  });
});

describe('live synthesis graph', () => {
  beforeEach(() => reset({ offline: false }));

  test('envelopes rise and fall exponentially from 0.0001', () => {
    play('press');
    const ctx = live();
    const env = ctx.of('gain').find((node) => node.gain.events.length === 3);
    assert.deepEqual(env.gain.events, [['set', 0.0001, 0], ['exp', 0.13, 0.001], ['exp', 0.0001, 0.021]]);
    const [noise] = ctx.of('source');
    assert.ok(Math.abs(noise.stoppedAt - 0.071) < 1e-9, 'sources stop 50 ms after the envelope');
  });

  test('glides, detune, filters and Q follow the recipe', () => {
    play('droplet');
    play('bloom');
    play('whisper');
    const ctx = live();
    const [drop, bloomA, bloomB] = ctx.of('oscillator');
    assert.deepEqual(drop.frequency.events, [['set', 1200, 0], ['exp', 550, 0.14]]);
    assert.equal(bloomA.detune.value, 0);
    assert.equal(bloomB.detune.value, 12);
    const whisper = ctx.of('filter').find((node) => node.Q.value === 0.7);
    assert.equal(whisper.type, 'lowpass');
    assert.equal(whisper.frequency.value, 1200);
  });

  test('a glide without its own time lasts the whole envelope', async () => {
    const { synthesize } = await import('../dist/engine.js');
    const ctx = new FakeOfflineAudioContext(2, 100, 48000);
    synthesize(ctx, { level: 1, layers: [{ wave: 'sine', freq: 100, to: 200, at: 0, attack: 0.1, decay: 0.2, peak: 0.5 }] }, ctx.destination, 0);
    assert.deepEqual(ctx.of('oscillator')[0].frequency.events[1], ['exp', 200, 0.30000000000000004]);
  });

  test('the echo taps the level node: delay → lowpass → feedback loop and wet send', () => {
    play('chime');
    const ctx = live();
    const [delay] = ctx.of('delay');
    const lowpass = ctx.of('filter')[0];
    assert.equal(delay.delayTime.value, 0.12);
    assert.equal(delay.maxDelayTime, 1);
    assert.equal(lowpass.frequency.value, 4000);
    const [feedback, wet] = lowpass.outputs;
    assert.equal(feedback.gain.value, 0.25);
    assert.deepEqual(feedback.outputs, [delay]);
    assert.equal(wet.gain.value, 0.18);
  });

  test('stereo layers get a panner set at their start time; payout pans both ways', () => {
    play('payout');
    const ctx = live();
    const pans = ctx.of('panner').map((node) => node.pan.events[0]);
    assert.ok(pans.some(([, value]) => value < 0) && pans.some(([, value]) => value > 0));
    assert.ok(pans.some(([, , time]) => time === 0.125));
    assert.ok(ctx.of('oscillator').some((node) => node.startedAt === 0.00085));
  });

  test('layers connect directly where stereo panners are unsupported', () => {
    const saved = FakeAudioContext.prototype.createStereoPanner;
    FakeAudioContext.prototype.createStereoPanner = undefined;
    try {
      play('payout', { pan: -1 });
      assert.equal(live().of('panner').length, 0);
    } finally {
      FakeAudioContext.prototype.createStereoPanner = saved;
    }
  });

  test('rate scales pitch and time; frequencies stay below Nyquist', () => {
    play('tick', { rate: 2 });
    play('payout', { rate: 4 });
    const ctx = live();
    const [ping] = ctx.of('oscillator');
    assert.deepEqual(ping.frequency.events[0], ['set', 5200, 0]);
    assert.ok(ctx.of('oscillator').every((node) => node.frequency.events.every(([, hz]) => hz <= 24000)));
    assert.ok(ctx.of('filter').every((node) => node.frequency.value <= 24000));
  });

  test('the live voice is torn down after its tail', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    play('chime');
    assert.equal(activeVoices(), 1);
    t.mock.timers.tick(1175);
    assert.equal(activeVoices(), 1);
    t.mock.timers.tick(2);
    assert.equal(activeVoices(), 0);
    const level = live().of('gain')[1];
    assert.ok(level.disconnects > 0);
  });
});

describe('play options', () => {
  beforeEach(async () => {
    await reset();
    await preload(['tick']);
  });

  test('volume, rate and pan add a gain and a panner only when they change something', () => {
    play('tick');
    const ctx = live();
    let before = ctx.nodes.length;
    play('tick', { volume: 1, rate: 1, pan: 0 });
    assert.deepEqual(ctx.nodes.slice(before).map((n) => n.kind), ['source']);
    before = ctx.nodes.length;
    play('tick', { volume: 0.5, rate: 1.5, pan: -0.5 });
    const [source, gain, panner] = ctx.nodes.slice(before);
    assert.deepEqual([source.kind, gain.kind, panner.kind], ['source', 'gain', 'panner']);
    assert.equal(source.playbackRate.value, 1.5);
    assert.equal(gain.gain.value, 0.5);
    assert.equal(panner.pan.value, -0.5);
    assert.deepEqual(panner.outputs, [ctx.of('gain')[0]]);
  });

  test('out-of-range options are clamped; volume 0 plays nothing', () => {
    play('tick');
    const ctx = live();
    let before = ctx.nodes.length;
    play('tick', { volume: 0 });
    assert.equal(ctx.nodes.length, before);
    play('tick', { volume: 9, rate: 99, pan: 5 });
    const [source, gain, panner] = ctx.nodes.slice(before);
    assert.equal(source.playbackRate.value, 4);
    assert.equal(gain.gain.value, 2);
    assert.equal(panner.pan.value, 1);
    before = ctx.nodes.length;
    play('tick', { rate: Number.NaN, pan: Number.NaN, volume: Number.POSITIVE_INFINITY });
    assert.deepEqual(ctx.nodes.slice(before).map((n) => n.kind), ['source'], 'non-finite values fall back to defaults');
  });
});

describe('voices', () => {
  beforeEach(async () => {
    await reset();
    await preload(['tick', 'press']);
  });

  test('ended buffer voices disconnect themselves', () => {
    play('tick', { volume: 0.5 });
    const ctx = live();
    const source = bufferSources(ctx).at(-1);
    assert.equal(activeVoices(), 1);
    source.end();
    assert.equal(activeVoices(), 0);
    assert.equal(source.disconnects, 1);
    assert.equal(ctx.of('gain').at(-1).disconnects, 1);
  });

  test('the oldest voice is cut when maxVoices is reached', async () => {
    configure({ maxVoices: 2 });
    play('tick');
    play('press');
    play('tick');
    const [first, second, third] = bufferSources(live());
    assert.equal(first.stoppedAt, 0);
    assert.equal(second.stoppedAt, undefined);
    assert.equal(third.stoppedAt, undefined);
    await tick();
    assert.equal(activeVoices(), 2);
  });

  test('stopAll stops buffered and live voices', async () => {
    play('tick');
    play('chime', { pan: 0.5 });
    assert.equal(activeVoices(), 2);
    stopAll();
    assert.equal(activeVoices(), 0);
    assert.equal(bufferSources(live())[0].stoppedAt, 0);
    stopAll();
    await tick();
  });

  test('stopping a voice twice is harmless', () => {
    play('tick');
    const [source] = bufferSources(live());
    source.stop = () => { throw new Error('InvalidStateError'); };
    assert.doesNotThrow(() => stopAll());
  });

  test('configure ignores invalid values', () => {
    configure({ maxVoices: 0, minInterval: -1 });
    configure({ maxVoices: 'many' });
    configure({});
    for (let i = 0; i < 30; i++) play(i % 2 ? 'tick' : 'press');
    assert.equal(activeVoices(), 24);
  });
});

describe('suspended contexts', () => {
  beforeEach(() => reset());

  test('plays while suspended share one resume and play once each after it', async () => {
    let finish;
    FakeAudioContext.next = { state: 'suspended', resume: (ctx) => new Promise((resolve) => { finish = () => { ctx.state = 'running'; resolve(); }; }) };
    play('tick');
    play('tick');
    play('press');
    const ctx = live();
    assert.equal(ctx.resumes, 1);
    assert.equal(ctx.of('oscillator').length, 0, 'nothing renders until running');
    finish();
    await tick();
    assert.equal(ctx.of('oscillator').length, 1, 'tick played once');
    assert.equal(ctx.of('filter').length, 2, 'tick + press noise');
  });

  test('requests older than 250 ms are dropped instead of playing late', async (t) => {
    let finish;
    FakeAudioContext.next = { state: 'suspended', resume: (ctx) => new Promise((resolve) => { finish = () => { ctx.state = 'running'; resolve(); }; }) };
    const saved = globalThis.performance;
    let clock = 1000;
    Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
    t.after(() => Object.defineProperty(globalThis, 'performance', { value: saved, configurable: true, writable: true }));
    play('tick');
    clock += 300;
    play('press');
    finish();
    await tick();
    const ctx = live();
    assert.equal(ctx.of('oscillator').length, 0, 'stale tick dropped');
    assert.equal(ctx.of('filter').length, 1, 'fresh press played');
  });

  test('a rejected or throwing resume is swallowed', async () => {
    FakeAudioContext.next = { state: 'suspended', resume: () => Promise.reject(new Error('blocked')) };
    assert.doesNotThrow(() => play('chime'));
    await tick();
    assert.equal(live().of('oscillator').length, 0);
    await dispose();
    FakeAudioContext.next = { state: 'suspended', resume: () => { throw new Error('sync'); } };
    assert.doesNotThrow(() => play('chime'));
    await tick();
    assert.equal(live().of('oscillator').length, 0);
  });

  test('muting while a resume is pending drops the queued sounds', async () => {
    let finish;
    FakeAudioContext.next = { state: 'suspended', resume: (ctx) => new Promise((resolve) => { finish = () => { ctx.state = 'running'; resolve(); }; }) };
    play('chime');
    setEnabled(false);
    setEnabled(true);
    finish();
    await tick();
    assert.equal(live().of('oscillator').length, 0);
  });

  test('a context that resumes but is not running plays nothing', async () => {
    FakeAudioContext.next = { state: 'suspended', resume: () => Promise.resolve() };
    play('chime');
    await tick();
    assert.equal(live().of('oscillator').length, 0);
  });
});

describe('unlock()', () => {
  beforeEach(() => reset());

  test('creates and resumes the context inside a gesture', async () => {
    FakeAudioContext.next = { state: 'suspended' };
    assert.equal(await unlock(), true);
    assert.equal(live().resumes, 1);
    assert.equal(await unlock(), true);
    assert.equal(live().resumes, 1, 'already running');
  });

  test('reports false before a gesture, without Web Audio, or when resume fails', async () => {
    setActivation(false);
    assert.equal(await unlock(), false);
    setActivation(true);
    FakeAudioContext.next = { throws: true };
    assert.equal(await unlock(), false);
    FakeAudioContext.next = { state: 'suspended', resume: () => Promise.reject(new Error('no')) };
    assert.equal(await unlock(), false);
  });
});

describe('dispose()', () => {
  beforeEach(() => reset());

  test('closes the context and forgets buffers', async () => {
    await preload(['tick']);
    play('tick');
    const ctx = live();
    await dispose();
    assert.equal(ctx.closed, true);
    assert.equal(getOutput(), null);
    play('tick');
    assert.equal(FakeAudioContext.constructed, 2);
    assert.equal(live().of('oscillator').length, 1, 'buffers were forgotten, so it synthesizes live');
  });

  test('tolerates contexts without close() or whose close() rejects', async () => {
    play('tick');
    live().close = undefined;
    await dispose();
    play('tick');
    live().close = () => Promise.reject(new Error('closed'));
    await assert.doesNotReject(dispose());
  });
});
