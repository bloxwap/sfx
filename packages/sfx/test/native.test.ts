import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as web from '../dist/index.js';
import * as nativeEntry from '../dist/native.js';
import {
  activeVoices, bind, configure, define, dispose, getOutput, getVolume, isEnabled, play, preload, renderBuffer, renderTo,
  setEnabled, setVolume, sounds, stopAll, unlock, type NativeSfxModule,
} from '../dist/native.js';
import { recipes } from '../dist/recipes.js';
import { assetFingerprint } from '../scripts/asset-fingerprint.ts';

type Call = [string, ...unknown[]];

/** A recording stand-in for the Expo module. Override any method to change its behavior. */
function fakeModule(overrides: Partial<NativeSfxModule> = {}) {
  const calls: Call[] = [];
  let next = 1;
  let ended: ((event: { voice: number }) => void) | undefined;
  const module: NativeSfxModule = {
    configure: (...args) => { calls.push(['configure', ...args]); },
    preload: async (names) => { calls.push(['preload', names]); return true; },
    addListener: (_event, listener) => { ended = listener; return { remove: () => { ended = undefined; } }; },
    play: (...args) => { calls.push(['play', ...args]); return next++; },
    stop: (voice) => { calls.push(['stop', voice]); },
    stopAll: () => { calls.push(['stopAll']); },
    activeVoices: () => 3,
    setVolume: (volume) => { calls.push(['setVolume', volume]); },
    unlock: async () => true,
    dispose: () => { calls.push(['dispose']); },
    ...overrides,
  };
  return { module, calls, end: (voice: number) => ended?.({ voice }), plays: () => calls.filter(([name]) => name === 'play') };
}

const g = globalThis as { expo?: unknown };

function install(module: NativeSfxModule | null): void {
  g.expo = module ? { modules: { BloxwapSfxEngine: module } } : undefined;
}

async function reset(): Promise<void> {
  install(null);
  await dispose();
  setEnabled(true);
  setVolume(1);
  for (const category of ['hover', 'controls', 'feedback', 'money'] as const) setVolume(1, { category });
  configure({ maxVoices: 16, minInterval: 0, audioSession: 'ambient' });
}

beforeEach(reset);
afterEach(reset);

describe('native entry', () => {
  test('exports every runtime name the web entry does, so "@bloxwap/sfx" works on both', () => {
    assert.deepEqual(Object.keys(nativeEntry).sort(), Object.keys(web).sort());
  });

  test('package.json routes React Native to the native entry and publishes the native module', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg['react-native'], './dist/native.js');
    assert.deepEqual(Object.keys(pkg.exports['.']), ['types', 'react-native', 'import']);
    assert.equal(pkg.exports['.']['react-native'], './dist/native.js');
    assert.equal(pkg.exports['./native'].import, './dist/native.js');
    for (const file of ['native/assets', 'ios', 'android/src', 'android/build.gradle', 'BloxwapSfx.podspec', 'expo-module.config.json']) assert.ok(pkg.files.includes(file), file);
    const config = JSON.parse(readFileSync(new URL('../expo-module.config.json', import.meta.url), 'utf8'));
    assert.equal(config.apple.podspecPath, 'BloxwapSfx.podspec');
  });

  test('is a silent no-op without the native module (Expo Go, Jest, the server)', async () => {
    for (const expo of [undefined, {}, { modules: {} }]) {
      g.expo = expo;
      assert.doesNotThrow(() => play('tick'));
      await preload();
      assert.equal(await unlock(), false);
      assert.equal(activeVoices(), 0);
      assert.doesNotThrow(() => { stopAll(); setVolume(0.5); });
    }
  });

  test('configures the module once, with the master volume, before its first sound', () => {
    const fake = fakeModule();
    install(fake.module);
    setVolume(0.4);
    configure({ maxVoices: 200.7, audioSession: 'manual' });
    play('tick');
    play('press');
    assert.deepEqual(fake.calls.filter(([name]) => name !== 'play'), [['setVolume', 0.4], ['configure', 64, 'manual'], ['setVolume', 0.4]]);
    configure({ minInterval: 0 });
    play('release');
    assert.equal(fake.calls.filter(([name]) => name === 'configure').length, 1, 'minInterval alone needs no reconfigure');
    configure({ maxVoices: 4 });
    play('toggle');
    assert.deepEqual(fake.calls.filter(([name]) => name === 'configure').at(-1), ['configure', 4, 'manual']);
  });

  test('ignores invalid configure fields', () => {
    const fake = fakeModule();
    install(fake.module);
    configure({ maxVoices: 0, minInterval: -1, audioSession: 'loud' as never });
    configure({ maxVoices: 'x' as never, minInterval: 'x' as never });
    play('tick');
    play('tick');
    assert.deepEqual(fake.calls.find(([name]) => name === 'configure'), ['configure', 16, 'ambient']);
    assert.equal(fake.plays().length, 2, 'minInterval stays 0');
  });

  test('failed configuration is retried before playback', () => {
    let attempts = 0;
    const fake = fakeModule({ configure: () => { if (++attempts === 1) throw new Error('not ready'); } });
    install(fake.module);
    assert.doesNotThrow(() => play('tick'));
    assert.equal(fake.plays().length, 0);
    play('tick');
    assert.equal(attempts, 2);
    assert.equal(fake.plays().length, 1);
  });

  test('passes gain, pan, rate and delay through, clamped like the web engine', () => {
    const fake = fakeModule();
    install(fake.module);
    play();
    play('tick', { volume: 5, pan: -3, rate: 9, delay: 20 });
    play('press', { volume: 0.5, pan: 0.25, rate: 0.1, delay: -1 });
    assert.deepEqual(fake.plays(), [
      ['play', 'chime', 1, 0, 1, 0],
      ['play', 'tick', 2, -1, 4, 10],
      ['play', 'press', 0.5, 0.25, 0.25, 0],
    ]);
  });

  test('applies category volumes and the per-play category override', () => {
    const fake = fakeModule();
    install(fake.module);
    setVolume(0.5, { category: 'money' });
    setVolume(0.25, { category: 'controls' });
    setVolume(0.9, { category: 'bogus' as never });
    play('payout');
    play('payout', { category: 'controls', minInterval: 0 });
    play('payout', { category: 'bogus' as never, minInterval: 0 });
    assert.deepEqual(fake.plays().map(([, , gain]) => gain), [0.5, 0.25, 0.5]);
    assert.equal(getVolume({ category: 'money' }), 0.5);
    assert.equal(getVolume({ category: 'bogus' as never }), 1);
  });

  test('a zero gain plays nothing and does not arm the retrigger guard', () => {
    const fake = fakeModule();
    install(fake.module);
    configure({ minInterval: 1000 });
    play('tick', { volume: 0 });
    play('tick');
    assert.equal(fake.plays().length, 1);
  });

  test('drops muted, unknown, custom and aborted plays', () => {
    const fake = fakeModule();
    install(fake.module);
    setEnabled(false);
    play('tick');
    assert.equal(isEnabled(), false);
    setEnabled('yes' as never);
    assert.equal(isEnabled(), false);
    setEnabled(true);
    play('nope' as never);
    play('toString' as never);
    const custom = define('native-custom', { level: 1, layers: [{ wave: 'sine', freq: 440, at: 0, attack: 0.01, decay: 0.1, peak: 0.1 }] });
    assert.equal(custom, 'native-custom');
    play(custom);
    play('tick', { signal: AbortSignal.abort() });
    assert.equal(fake.plays().length, 0);
  });

  test('guards retriggers with the configured or per-play interval', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const saved = globalThis.performance;
    Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
    try {
      const fake = fakeModule();
      install(fake.module);
      configure({ minInterval: 50 });
      play('tick');
      play('tick');
      t.mock.timers.tick(60);
      play('tick');
      play('tick', { minInterval: 0 });
      play('tick', { minInterval: -1 });
      play('tick', { minInterval: 'x' as never });
      assert.equal(fake.plays().length, 3);
    } finally {
      Object.defineProperty(globalThis, 'performance', { value: saved, configurable: true, writable: true });
    }
  });

  test('a module whose play throws leaves the caller unharmed', () => {
    install(fakeModule({ play: () => { throw new Error('boom'); } }).module);
    assert.doesNotThrow(() => play('tick', { signal: new AbortController().signal }));
  });

  test('an abort signal stops only its own voice, until the sound has rung out', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = fakeModule();
    install(fake.module);
    const first = new AbortController();
    play('tick', { signal: first.signal });
    play('press');
    first.abort();
    assert.deepEqual(fake.calls.filter(([name]) => name === 'stop'), [['stop', 1]]);

    const late = new AbortController();
    play('payout', { signal: late.signal, delay: 1, rate: 2 });
    t.mock.timers.tick(1000 + (web.duration('payout') / 2) * 1000 + 100);
    fake.end(3);
    late.abort();
    assert.equal(fake.calls.filter(([name]) => name === 'stop').length, 1, 'listener is gone after the sound ends');

    const dropped = new AbortController();
    install(fakeModule({ play: () => 0 }).module);
    play('toggle', { signal: dropped.signal });
    dropped.abort();

    const failing = new AbortController();
    install(fakeModule({ stop: () => { throw new Error('gone'); } }).module);
    play('release', { signal: failing.signal });
    assert.doesNotThrow(() => failing.abort());
  });

  test('preload decodes built-in sounds only, all by default, and never rejects', async () => {
    const fake = fakeModule();
    install(fake.module);
    await preload();
    await preload(['tick', 'nope' as never, 'native-custom']);
    assert.deepEqual(fake.calls.filter(([name]) => name === 'preload'), [['preload', [...sounds]], ['preload', ['tick']]]);
    install(fakeModule({ preload: async () => { throw new Error('missing'); } }).module);
    await assert.doesNotReject(preload());
  });

  test('unlock resolves true only when the engine reports it is running', async () => {
    install(fakeModule().module);
    assert.equal(await unlock(), true);
    install(fakeModule({ unlock: async () => 'yes' as never }).module);
    assert.equal(await unlock(), false);
    install(fakeModule({ unlock: async () => { throw new Error('no session'); } }).module);
    assert.equal(await unlock(), false);
  });

  test('master volume clamps, ignores non-numbers and reaches the module', () => {
    const fake = fakeModule();
    install(fake.module);
    setVolume(3);
    setVolume(Number.NaN);
    setVolume('loud' as never);
    assert.equal(getVolume(), 1);
    setVolume(-1);
    assert.equal(getVolume(), 0);
    assert.deepEqual(fake.calls, [['setVolume', 0]]);
    install(fakeModule({ setVolume: () => { throw new Error('boom'); } }).module);
    assert.doesNotThrow(() => setVolume(0.5));
    assert.equal(getVolume(), 0.5);
  });

  test('stopAll, activeVoices and dispose forward to the module and never throw', async () => {
    const fake = fakeModule();
    install(fake.module);
    stopAll();
    assert.equal(activeVoices(), 3);
    await dispose();
    assert.deepEqual(fake.calls, [['stopAll'], ['dispose']]);
    const boom = () => { throw new Error('boom'); };
    install(fakeModule({ stopAll: boom, activeVoices: boom, dispose: boom }).module);
    assert.doesNotThrow(stopAll);
    assert.equal(activeVoices(), 0);
    await assert.doesNotReject(dispose());
  });

  test('dispose reconfigures the next engine', async () => {
    const fake = fakeModule();
    install(fake.module);
    play('tick');
    await dispose();
    play('tick');
    assert.equal(fake.calls.filter(([name]) => name === 'configure').length, 2);
  });

  test('web-only APIs have inert native stand-ins', async () => {
    assert.equal(getOutput(), null);
    assert.equal(renderTo({} as BaseAudioContext, 'tick'), false);
    assert.equal(await renderBuffer('tick'), null);
    const unbind = bind();
    assert.equal(typeof unbind, 'function');
    assert.doesNotThrow(unbind);
  });
});

describe('baked native sounds', () => {
  const dir = new URL('../native/assets/bloxwap-sfx/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));

  test('cover every built-in sound in catalog order', () => {
    assert.deepEqual(manifest.sounds.map((sound: { name: string }) => sound.name), sounds);
    assert.deepEqual(manifest.format, { sampleRate: 48000, bitDepth: 16, encoding: 'PCM', trimThresholdDb: -60, trimPadMs: 20, gain: 2 });
  });

  test('are baked from the current recipes (run `npm run bake:native` after a recipe change)', () => {
    assert.equal(manifest.sourceSha256, assetFingerprint('native'), 'Native renderer changed; run npm run bake:native');
    for (const sound of manifest.sounds) {
      const recipe = recipes[sound.name as keyof typeof recipes];
      assert.equal(createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), sound.recipeSha256, `${sound.name} is stale`);
      assert.equal(sound.channels, recipe.layers.some((layer) => layer.pan) ? 2 : 1, `${sound.name} channel count`);
    }
  });

  test('are 48 kHz 16-bit PCM files that match the manifest and the recipe length', () => {
    for (const sound of manifest.sounds) {
      const bytes = readFileSync(new URL(`${sound.name}.wav`, dir));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sound.sha256, sound.name);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      assert.equal(bytes.readUInt16LE(20), 1, 'integer PCM');
      assert.equal(bytes.readUInt16LE(22), sound.channels);
      assert.equal(bytes.readUInt32LE(24), 48000);
      assert.equal(bytes.readUInt16LE(34), 16);
      // The Android engine derives each sound's length from this 44-byte header layout.
      assert.equal(bytes.toString('ascii', 36, 40), 'data');
      assert.equal(bytes.readUInt32LE(40), sound.frames * sound.channels * 2);
      assert.equal(bytes.length, 44 + sound.frames * sound.channels * 2);
      const seconds = sound.frames / 48000;
      assert.ok(seconds > 0.02 && seconds <= web.duration(sound.name) + 0.2, `${sound.name}: ${seconds}s`);
    }
  });
});

test('abort remains effective through native rate clamping and decoding; native completion releases it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = fakeModule(); install(fake.module);
  const controller = new AbortController();
  play('payout', { rate: 4, signal: controller.signal });
  t.mock.timers.tick(410);
  controller.abort();
  assert.deepEqual(fake.calls.filter(([name]) => name === 'stop'), [['stop', 1]]);
  const waiting = new AbortController();
  play('press', { signal: waiting.signal });
  t.mock.timers.tick(240);
  waiting.abort();
  assert.deepEqual(fake.calls.filter(([name]) => name === 'stop').at(-1), ['stop', 2]);
  const done = new AbortController();
  play('tick', { signal: done.signal }); fake.end(3); done.abort();
  assert.equal(fake.calls.filter(([name]) => name === 'stop').length, 2);
});

test('stopAll and disposal release signal subscriptions and invalidate pending preload results', async () => {
  let finish!: (loaded: boolean) => void;
  const fake = fakeModule({ preload: () => new Promise(resolve => { finish = resolve; }) }); install(fake.module);
  const first = new AbortController(), second = new AbortController();
  play('tick', { signal: first.signal }); stopAll(); first.abort();
  play('press', { signal: second.signal });
  const pending = preload(['tick']);
  await dispose(); finish(true); second.abort();
  assert.equal(await pending, false);
  assert.equal(fake.calls.filter(([name]) => name === 'stop').length, 0);
});

test('late completion from a replaced module cannot release a new voice with the same id', () => {
  let oldEnd!: (event: { voice: number }) => void;
  const old = fakeModule({ addListener: (_event, listener) => {
    oldEnd = listener;
    return { remove: () => { throw new Error('module already destroyed'); } };
  } });
  install(old.module); play('tick', { signal: new AbortController().signal });
  const current = fakeModule(); install(current.module);
  const controller = new AbortController();
  play('press', { signal: controller.signal });
  oldEnd({ voice: 1 }); controller.abort();
  assert.deepEqual(current.calls.filter(([name]) => name === 'stop'), [['stop', 1]]);
});

test('an abort during native dispatch still cancels the returned voice', () => {
  const controller = new AbortController();
  const fake = fakeModule({ play: () => { controller.abort(); return 7; } });
  install(fake.module); play('tick', { signal: controller.signal });
  assert.deepEqual(fake.calls.filter(([name]) => name === 'stop'), [['stop', 7]]);
});

test('a failed live volume update is retried before the next sound', () => {
  const fake = fakeModule(); install(fake.module); play('tick');
  const set = fake.module.setVolume;
  fake.module.setVolume = () => { throw new Error('session interrupted'); };
  setVolume(0.3);
  fake.module.setVolume = set;
  play('press');
  assert.deepEqual(fake.calls.filter(([name]) => name === 'setVolume').at(-1), ['setVolume', 0.3]);
});
