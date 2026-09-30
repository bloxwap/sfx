import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAudioContext as RealOfflineAudioContext } from 'node-web-audio-api';
import { FakeAudioContext, FakeOfflineAudioContext, installAudio, installEvents, setActivation, tick } from './fake-audio.mjs';
import {
  activeVoices, configure, dispose, duration, getOutput, getVolume, isEnabled, play, preload, renderBuffer, renderTo, setEnabled,
  setVolume, sounds, stopAll, unlock,
} from '../dist/index.js';

const live = () => FakeAudioContext.instances.at(-1);
const bufferSources = (ctx) => ctx.of('source').filter((node) => node.buffer && node.buffer.numberOfChannels === 2);

async function reset({ offline = true } = {}) {
  await dispose();
  installAudio({ offline });
  setActivation(undefined);
  setEnabled(true);
  setVolume(1);
  configure({ maxVoices: 24, minInterval: 0, resume: 'queue' });
}

/** A suspended context whose resume only completes when the returned `finish()` is called. */
function pendingResume() {
  const control = { finish: () => {} };
  FakeAudioContext.next = {
    state: 'suspended',
    resume: (ctx) => new Promise((resolve) => { control.finish = () => { ctx.state = 'running'; resolve(); }; }),
  };
  return control;
}

/** Advances mock timers `ms` in 1 ms steps, moving the audio clock with them while the context runs. */
function advance(t, ctx, ms) {
  for (let i = 0; i < ms; i++) {
    if (ctx.state === 'running') ctx.currentTime += 0.001;
    t.mock.timers.tick(1);
  }
}

const rms = (data, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

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
    const ctx = live();
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 1175);
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 2);
    assert.equal(activeVoices(), 0);
    const level = ctx.of('gain')[1];
    assert.ok(level.disconnects > 0);
  });

  test('a live voice paused by a suspension mid-sound waits for the rest of it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    play('chime');
    const ctx = live();
    advance(t, ctx, 500);
    ctx.state = 'suspended';
    advance(t, ctx, 1000);
    assert.equal(activeVoices(), 1, '0.676 s of chime has not played yet');
    ctx.state = 'running';
    advance(t, ctx, 675);
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 2);
    assert.equal(activeVoices(), 0);
  });

  test('a live voice on a context that closed is torn down when its timer fires', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    play('chime');
    const ctx = live();
    ctx.state = 'closed';
    t.mock.timers.tick(1177);
    assert.equal(activeVoices(), 0);
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

describe('delay option', () => {
  beforeEach(() => reset());

  test('a buffered play starts on the audio clock, delay seconds after currentTime', async () => {
    await preload(['tick']);
    play('tick');
    const ctx = live();
    ctx.currentTime = 5;
    play('tick', { delay: 0.09 });
    assert.equal(bufferSources(ctx).at(-1).startedAt, 5.09);
  });

  test('delay is clamped to 0–10 and non-finite values mean no delay', async () => {
    await preload(['tick']);
    play('tick');
    const ctx = live();
    ctx.currentTime = 2;
    for (const [delay, at] of [[99, 12], [-1, 2], [Number.NaN, 2], [Number.POSITIVE_INFINITY, 2], ['0.5', 2], [undefined, 2], [10, 12], [0, 2]]) {
      play('tick', { delay });
      assert.equal(bufferSources(ctx).at(-1).startedAt, at, `delay ${delay}`);
    }
  });

  test('a live play schedules every layer and envelope at currentTime + delay', async () => {
    await reset({ offline: false });
    play('tick');
    const ctx = live();
    ctx.currentTime = 1;
    const before = ctx.nodes.length;
    play('press', { delay: 0.25 });
    const added = ctx.nodes.slice(before);
    const [noise] = added.filter((node) => node.kind === 'source');
    assert.equal(noise.startedAt, 1.25);
    const env = added.find((node) => node.kind === 'gain' && node.gain.events.length === 3);
    assert.deepEqual(env.gain.events[0], ['set', 0.0001, 1.25]);
  });

  test('the live voice cleanup timer is extended by the delay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    installAudio({ offline: false });
    play('chime', { delay: 0.5 });
    const ctx = live();
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 1675);
    assert.equal(activeVoices(), 1, 'still ringing: 0.5 s delay + 1.176 s tail');
    advance(t, ctx, 2);
    assert.equal(activeVoices(), 0);
  });

  test('press now, release 90 ms later on the audio clock', async () => {
    await preload(['press', 'release']);
    play('tick');
    const ctx = live();
    ctx.currentTime = 3;
    play('press');
    play('release', { delay: 0.09 });
    const [press, release] = bufferSources(ctx).slice(-2);
    assert.equal(press.startedAt, 3);
    assert.equal(release.startedAt, 3.09);
  });

  test('a request queued while suspended is delayed from the moment it plays after resume', async () => {
    await reset({ offline: false });
    const control = pendingResume();
    play('press', { delay: 0.2 });
    const ctx = live();
    assert.equal(ctx.of('source').length, 0);
    ctx.currentTime = 4;
    control.finish();
    await tick();
    const [noise] = ctx.of('source');
    assert.ok(Math.abs(noise.startedAt - 4.2) < 1e-9);
  });
});

describe('minInterval option', () => {
  beforeEach(async () => {
    await reset();
    await preload(['tick']);
  });

  test('a per-call minInterval overrides the global guard in both directions', () => {
    play('tick');
    const ctx = live();
    play('tick', { minInterval: 10_000 });
    assert.equal(bufferSources(ctx).length, 1, 'dropped by the per-call guard');
    configure({ minInterval: 10_000 });
    play('tick');
    assert.equal(bufferSources(ctx).length, 1, 'dropped by the global guard');
    play('tick', { minInterval: 0 });
    assert.equal(bufferSources(ctx).length, 2, 'the per-call override lets it through');
  });

  test('invalid or negative values fall back to the global value', () => {
    configure({ minInterval: 10_000 });
    play('tick');
    const ctx = live();
    for (const minInterval of [-1, Number.NaN, '0', null]) play('tick', { minInterval });
    assert.equal(bufferSources(ctx).length, 1);
    configure({ minInterval: 0 });
    for (const minInterval of [-1, Number.NaN, '0', null]) play('tick', { minInterval });
    assert.equal(bufferSources(ctx).length, 5);
  });

  test('the override is per sound, like the global guard', () => {
    play('tick', { minInterval: 10_000 });
    play('press', { minInterval: 10_000 });
    play('tick', { minInterval: 10_000 });
    assert.equal(bufferSources(live()).length, 1, 'press rendered live, tick once from its buffer');
    assert.equal(activeVoices(), 2);
  });
});

describe('force option', () => {
  beforeEach(async () => {
    await reset();
    setActivation(false);
  });

  test('skips the user-activation gate', () => {
    play('tick');
    assert.equal(FakeAudioContext.constructed, 0);
    play('tick', { force: true });
    assert.equal(FakeAudioContext.constructed, 1);
    assert.equal(live().of('oscillator').length, 1);
    assert.equal(activeVoices(), 1);
  });

  test('still respects setEnabled(false), invalid names and the retrigger guard', () => {
    setEnabled(false);
    play('tick', { force: true });
    assert.equal(FakeAudioContext.constructed, 0);
    setEnabled(true);
    play('nope', { force: true });
    play('toString', { force: true });
    assert.equal(FakeAudioContext.constructed, 0);
    configure({ minInterval: 10_000 });
    play('tick', { force: true });
    play('tick', { force: true });
    assert.equal(live().of('oscillator').length, 1);
  });

  test('force: false keeps the gate', () => {
    play('tick', { force: false });
    assert.equal(FakeAudioContext.constructed, 0);
  });

  test('a forced play on a suspended context queues and resumes', async () => {
    FakeAudioContext.next = { state: 'suspended' };
    play('tick', { force: true });
    const ctx = live();
    assert.equal(ctx.resumes, 1);
    await tick();
    assert.equal(ctx.of('oscillator').length, 1);
  });
});

describe('eager resume', () => {
  beforeEach(async () => {
    await reset();
    configure({ resume: 'eager' });
  });

  test('schedules immediately and resumes concurrently with one shared promise', async () => {
    const control = pendingResume();
    play('tick');
    const ctx = live();
    assert.equal(ctx.of('oscillator').length, 1, 'scheduled while suspended');
    play('press');
    assert.equal(ctx.resumes, 1, 'shared resume');
    assert.equal(activeVoices(), 2);
    control.finish();
    await tick();
    assert.equal(ctx.of('oscillator').length, 1, 'nothing was queued, so nothing replays');
    assert.equal(ctx.of('filter').length, 2);
  });

  test('buffered plays are scheduled while suspended too, and honor delay', async () => {
    await preload(['tick']);
    pendingResume();
    play('tick', { delay: 0.1 });
    const [source] = bufferSources(live());
    assert.equal(source.startedAt, 0.1);
    assert.equal(activeVoices(), 1);
  });

  test('voices are still capped', () => {
    configure({ maxVoices: 1 });
    pendingResume();
    play('tick');
    play('press');
    assert.equal(activeVoices(), 1);
  });

  test('rejected or throwing resumes are swallowed', async () => {
    FakeAudioContext.next = { state: 'suspended', resume: () => Promise.reject(new Error('blocked')) };
    assert.doesNotThrow(() => play('tick'));
    await tick();
    assert.equal(live().of('oscillator').length, 1);
    await dispose();
    FakeAudioContext.next = { state: 'suspended', resume: () => { throw new Error('sync'); } };
    assert.doesNotThrow(() => play('tick'));
    await tick();
    assert.equal(live().of('oscillator').length, 1);
  });

  test("WebKit's interrupted state is resumed eagerly too", () => {
    FakeAudioContext.next = { state: 'interrupted' };
    play('tick');
    const ctx = live();
    assert.equal(ctx.resumes, 1);
    assert.equal(ctx.of('oscillator').length, 1);
  });

  test('a closed context is not scheduled onto', async () => {
    FakeAudioContext.next = { state: 'closed', resume: () => Promise.reject(new Error('closed')) };
    play('tick');
    const ctx = live();
    assert.equal(ctx.of('oscillator').length, 0);
    assert.equal(ctx.resumes, 1);
    await tick();
    assert.equal(ctx.of('oscillator').length, 0);
  });

  test('a live voice is not torn down while its context is still asleep', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    installAudio({ offline: false });
    FakeAudioContext.next = { state: 'suspended', resume: () => new Promise(() => {}) };
    play('chime');
    const ctx = live();
    advance(t, ctx, 1177);
    assert.equal(activeVoices(), 1, 'the clock has not run yet');
    advance(t, ctx, 1177);
    assert.equal(activeVoices(), 1);
    ctx.state = 'running';
    advance(t, ctx, 1175);
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 2);
    assert.equal(activeVoices(), 0);
  });

  test('a live voice that wakes just before a timer window ends still plays in full', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    installAudio({ offline: false });
    FakeAudioContext.next = { state: 'suspended', resume: () => new Promise(() => {}) };
    play('chime');
    const ctx = live();
    advance(t, ctx, 1100);
    ctx.state = 'running';
    advance(t, ctx, 100);
    assert.equal(activeVoices(), 1, 'the window ended 77 ms after the resume, 1.1 s before the sound');
    assert.equal(ctx.of('gain')[1].disconnects, 0);
    advance(t, ctx, 1075);
    assert.equal(activeVoices(), 1);
    advance(t, ctx, 2);
    assert.equal(activeVoices(), 0);
  });

  test('muting while suspended drops sounds already scheduled; muting while running lets them finish', async () => {
    await preload(['tick']);
    const control = pendingResume();
    play('tick');
    play('chime');
    const ctx = live();
    assert.equal(activeVoices(), 2);
    setEnabled(false);
    assert.equal(activeVoices(), 0);
    const [source] = bufferSources(ctx);
    assert.equal(source.stoppedAt, 0);
    const [, mix, level] = ctx.of('gain');
    assert.ok(mix.disconnects > 0 && level.disconnects > 0, 'live graph detached');
    control.finish();
    await tick();
    assert.equal(activeVoices(), 0);
    setEnabled(true);
    play('chime', { minInterval: 0 });
    assert.equal(activeVoices(), 1);
    setEnabled(false);
    assert.equal(activeVoices(), 1, 'running: sounds already playing finish');
  });

  test('invalid values are ignored; queue switches back', async () => {
    configure({ resume: 'later' });
    configure({ resume: true });
    const control = pendingResume();
    play('tick');
    assert.equal(live().of('oscillator').length, 1, 'still eager');
    await dispose();
    configure({ resume: 'queue' });
    const queued = pendingResume();
    play('tick');
    assert.equal(live().of('oscillator').length, 0, 'queued until resume');
    queued.finish();
    control.finish();
    await tick();
    assert.equal(live().of('oscillator').length, 1);
  });
});

describe('renderTo()', () => {
  beforeEach(() => reset());

  test('schedules a sound onto a caller context at currentTime + delay, into its destination', () => {
    const target = new FakeOfflineAudioContext(2, 48000, 48000);
    target.currentTime = 1;
    assert.equal(renderTo(target, 'tick', { delay: 0.5 }), true);
    const [noise] = target.of('source');
    assert.equal(noise.startedAt, 1.5);
    assert.equal(target.of('oscillator')[0].startedAt, 1.5);
    const [mix] = target.of('gain');
    assert.deepEqual(mix.outputs, [target.destination]);
  });

  test('defaults to no delay and connects to a custom destination', () => {
    const target = new FakeOfflineAudioContext(2, 48000, 48000);
    const destination = target.createGain();
    assert.equal(renderTo(target, 'press', { destination }), true);
    assert.equal(target.of('source')[0].startedAt, 0);
    const mix = target.of('gain')[1];
    assert.deepEqual(mix.outputs, [destination]);
    assert.equal(renderTo(target, 'press'), true);
  });

  test('volume, rate, pan and delay are applied and clamped', () => {
    const target = new FakeOfflineAudioContext(2, 48000, 48000);
    assert.equal(renderTo(target, 'tick', { volume: 0.5, rate: 2, pan: -3, delay: 20 }), true);
    const [mix, level] = target.of('gain');
    const [panner] = target.of('panner');
    assert.deepEqual(mix.outputs, [panner]);
    assert.equal(panner.pan.value, -1);
    assert.deepEqual(panner.outputs, [target.destination]);
    assert.equal(level.gain.value, 2.5 * 0.5, 'recipe level × volume');
    assert.deepEqual(target.of('oscillator')[0].frequency.events[0], ['set', 5200, 10]);
  });

  test('bypasses muting, activation, voices and caches', () => {
    setEnabled(false);
    setActivation(false);
    const target = new FakeOfflineAudioContext(2, 48000, 48000);
    assert.equal(renderTo(target, 'chime'), true);
    assert.equal(target.of('oscillator').length, 2);
    assert.equal(FakeAudioContext.constructed, 0, 'no live context');
    assert.equal(FakeOfflineAudioContext.instances.length, 1, 'no cache render');
    assert.equal(activeVoices(), 0);
  });

  test('works on a live AudioContext without touching the engine', () => {
    const target = new FakeAudioContext();
    assert.equal(renderTo(target, 'tick'), true);
    assert.equal(target.of('oscillator').length, 1);
    assert.equal(getOutput(), null);
  });

  test('returns false for invalid names, bad contexts or graphs that throw; never throws', () => {
    const target = new FakeOfflineAudioContext(2, 48000, 48000);
    for (const name of ['nope', 'toString', '', null, 42]) assert.equal(renderTo(target, name), false);
    assert.equal(target.nodes.length, 1, 'only the destination');
    assert.equal(renderTo(null, 'tick'), false);
    assert.equal(renderTo({}, 'tick'), false);
    target.createOscillator = () => { throw new Error('oscillator'); };
    assert.equal(renderTo(target, 'tick'), false);
  });

  test('renders real audio that starts at the delay (node-web-audio-api)', async () => {
    const rate = 48000;
    const target = new RealOfflineAudioContext(2, Math.ceil((0.3 + duration('press')) * rate), rate);
    assert.equal(renderTo(target, 'press', { delay: 0.2 }), true);
    const buffer = await target.startRendering();
    const left = buffer.getChannelData(0);
    const at = Math.round(0.2 * rate);
    assert.ok(rms(left, 0, at - 16) < 1e-6, 'silent before the delay');
    assert.ok(rms(left, at, at + Math.round(duration('press') * rate)) > 1e-3, 'audible after it');
  });
});

describe('renderBuffer()', () => {
  beforeEach(() => reset());

  test('renders a fresh stereo buffer at 48 kHz before any context exists', async () => {
    setActivation(false);
    const buffer = await renderBuffer('chime');
    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(buffer.sampleRate, 48000);
    assert.equal(buffer.length, Math.ceil(1.176 * 48000));
    assert.equal(FakeAudioContext.constructed, 0);
  });

  test("defaults to the live context's sample rate; an explicit rate wins and is clamped", async () => {
    FakeAudioContext.next = { sampleRate: 44100 };
    play('tick');
    assert.equal((await renderBuffer('tick')).sampleRate, 44100);
    assert.equal((await renderBuffer('tick', { sampleRate: 22050 })).sampleRate, 22050);
    assert.equal((await renderBuffer('tick', { sampleRate: 1 })).sampleRate, 3000);
    assert.equal((await renderBuffer('tick', { sampleRate: 1e9 })).sampleRate, 768000);
    assert.equal((await renderBuffer('tick', { sampleRate: Number.NaN })).sampleRate, 44100);
  });

  test("is independent of play()'s cache", async () => {
    await renderBuffer('tick');
    await renderBuffer('tick');
    assert.equal(FakeOfflineAudioContext.instances.length, 2, 'rendered every time');
    play('tick');
    assert.equal(live().of('oscillator').length, 1, 'play still synthesizes live on first use');
    await tick();
    const [a, b] = await Promise.all([renderBuffer('tick'), renderBuffer('tick')]);
    assert.notEqual(a, b, 'fresh buffers, not the cached one');
  });

  test('resolves null for invalid names, missing or failing offline rendering', async () => {
    assert.equal(await renderBuffer('nope'), null);
    assert.equal(await renderBuffer('toString'), null);
    assert.equal(FakeOfflineAudioContext.instances.length, 0);
    FakeOfflineAudioContext.fail = true;
    assert.equal(await renderBuffer('tick'), null);
    await reset({ offline: false });
    assert.equal(await renderBuffer('tick'), null);
  });

  test('renders real audio (node-web-audio-api)', async (t) => {
    globalThis.OfflineAudioContext = RealOfflineAudioContext;
    t.after(() => { globalThis.OfflineAudioContext = FakeOfflineAudioContext; });
    const buffer = await renderBuffer('chime', { sampleRate: 44100 });
    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(buffer.sampleRate, 44100);
    assert.ok(rms(buffer.getChannelData(0), 0, buffer.length) > 1e-3);
    assert.equal(await renderBuffer('chime', { sampleRate: 100 }).then((b) => b.sampleRate), 3000);
  });
});

describe('render cache', () => {
  beforeEach(() => reset());

  test('an offline constructor that throws synchronously does not poison the cache', async () => {
    const Saved = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = function Broken() { throw new Error('no offline'); };
    await preload(['tick']);
    globalThis.OfflineAudioContext = Saved;
    await preload(['tick']);
    play('tick');
    assert.deepEqual(live().nodes.map((node) => node.kind).slice(-1), ['source'], 'buffered after the retry');
  });

  test('a render still in flight at dispose() is not cached for the next context', async () => {
    FakeAudioContext.next = { sampleRate: 44100 };
    play('tick');
    FakeAudioContext.next = {};
    await dispose();
    await tick();
    play('tick');
    const ctx = live();
    assert.equal(ctx.sampleRate, 48000);
    assert.equal(ctx.of('oscillator').length, 1, 'synthesized live, not played from the 44.1 kHz buffer');
    await tick();
    const before = ctx.nodes.length;
    play('tick');
    assert.equal(ctx.nodes.slice(before)[0].buffer.sampleRate, 48000);
  });
});

describe('lifecycle wake-up', () => {
  let events;
  beforeEach(async () => {
    await reset();
    events = installEvents();
  });
  afterEach(async () => {
    await dispose();
    events.uninstall();
  });

  test('listens for visibilitychange, pageshow and focus once the context exists', () => {
    assert.equal(events.win.total() + events.doc.total(), 0, 'nothing at import or before the first play');
    play('tick');
    play('press');
    assert.equal(events.doc.count('visibilitychange'), 1);
    assert.equal(events.win.count('pageshow'), 1);
    assert.equal(events.win.count('focus'), 1);
  });

  test('resumes an interrupted or suspended context when the page comes back', async () => {
    play('tick');
    const ctx = live();
    for (const fire of [() => events.win.dispatch('focus'), () => events.win.dispatch('pageshow'), () => events.doc.dispatch('visibilitychange')]) {
      ctx.state = 'interrupted';
      fire();
      assert.equal(ctx.state, 'running');
      await tick();
    }
    assert.equal(ctx.resumes, 3);
    ctx.state = 'suspended';
    events.win.dispatch('focus');
    assert.equal(ctx.resumes, 4);
  });

  test('ignores a hidden page, a running or closed context, and pages without activation', async () => {
    play('tick');
    const ctx = live();
    ctx.state = 'suspended';
    events.doc.visibilityState = 'hidden';
    events.doc.dispatch('visibilitychange');
    assert.equal(ctx.resumes, 0);
    ctx.state = 'running';
    events.doc.visibilityState = 'visible';
    events.doc.dispatch('visibilitychange');
    events.win.dispatch('focus');
    ctx.state = 'closed';
    events.win.dispatch('pageshow');
    assert.equal(ctx.resumes, 0);
    ctx.state = 'interrupted';
    setActivation(false);
    events.win.dispatch('focus');
    assert.equal(ctx.resumes, 0);
    setActivation(true);
    events.win.dispatch('focus');
    assert.equal(ctx.resumes, 1);
    await tick();
  });

  test('shares the coalesced resume with play() and swallows rejections', async () => {
    const control = pendingResume();
    play('tick');
    const ctx = live();
    events.win.dispatch('focus');
    events.win.dispatch('pageshow');
    assert.equal(ctx.resumes, 1);
    control.finish();
    await tick();
    assert.equal(ctx.of('oscillator').length, 1, 'the queued play still flushes once');
    ctx.state = 'interrupted';
    ctx.resumeImpl = () => Promise.reject(new Error('interrupted'));
    assert.doesNotThrow(() => events.win.dispatch('focus'));
    await tick();
    assert.equal(ctx.resumes, 2);
  });

  test('dispose() removes the listeners; a new context adds them again', async () => {
    play('tick');
    const ctx = live();
    await dispose();
    assert.equal(events.win.total() + events.doc.total(), 0);
    events.win.dispatch('focus');
    assert.equal(ctx.resumes, 0);
    play('tick');
    assert.equal(events.win.total() + events.doc.total(), 3);
  });

  test('works without a document, and without window.addEventListener', async () => {
    events.uninstall();
    events = installEvents({ document: false });
    play('tick');
    assert.equal(events.win.total(), 2);
    const ctx = live();
    ctx.state = 'interrupted';
    events.win.dispatch('focus');
    assert.equal(ctx.resumes, 1);
    await dispose();
    events.uninstall();
    assert.doesNotThrow(() => play('tick'));
    assert.equal(FakeAudioContext.constructed, 2);
    await assert.doesNotReject(dispose());
  });

  test('no context (SSR or no Web Audio) means no listeners', () => {
    delete globalThis.AudioContext;
    play('tick');
    assert.equal(events.win.total() + events.doc.total(), 0);
  });
});
