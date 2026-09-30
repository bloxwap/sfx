import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, isSound, sounds, type BuiltinSoundName as SoundName } from '../dist/index.js';
import { echoTail, recipes, sourceEnd, type NoiseLayer, type ToneLayer } from '../dist/recipes.js';

const ORDER: SoundName[] = [
  'chime', 'sparkle', 'droplet', 'bloom', 'whisper', 'tick', 'press', 'release', 'toggle', 'success',
  'error', 'page', 'loading', 'ready', 'payout', 'deposit', 'pluck', 'notification', 'loss',
];

test('nineteen sounds in catalog order, frozen', () => {
  assert.deepEqual([...sounds], ORDER);
  assert.ok(Object.isFrozen(sounds));
  assert.ok(Object.isFrozen(recipes));
});

test('isSound accepts own names only', () => {
  for (const name of ORDER) assert.equal(isSound(name), true);
  for (const value of ['toString', '__proto__', 'hasOwnProperty', 'Chime', '', null, undefined, 1, {}]) {
    assert.equal(isSound(value), false, String(value));
  }
});

test('recipe levels', () => {
  const levels = Object.fromEntries(ORDER.map((name) => [name, recipes[name].level]));
  assert.deepEqual(levels, {
    chime: 1.75, sparkle: 2.9, droplet: 1.85, bloom: 1.3, whisper: 3.75, tick: 2.5, press: 3.2, release: 2.75,
    toggle: 3.3, success: 2.4, error: 4.1, page: 2.4, loading: 2.1, ready: 2.6, payout: 0.68, deposit: 0.63,
    pluck: 0.62, notification: 0.62, loss: 0.54,
  });
});

test('ring-out times match the reference (source end + echo tail + two 50 ms pads)', () => {
  const expected: Record<SoundName, number> = {
    chime: 1176, sparkle: 918, droplet: 844, bloom: 1400, whisper: 300, tick: 119, press: 121, release: 157,
    toggle: 145, success: 1004, error: 344, page: 222, loading: 965, ready: 1137, payout: 1258, deposit: 516,
    pluck: 129, notification: 912, loss: 576,
  };
  for (const name of ORDER) {
    assert.equal(Math.round((duration(name) + 0.1) * 1000), expected[name], name);
  }
});

test('echo tail edge cases', () => {
  assert.equal(echoTail({ level: 1, layers: [] }), 0);
  assert.equal(echoTail({ level: 1, layers: [], echo: { delay: 0.1, feedback: 0, wet: 1, lowpass: 1 } }), 0);
  assert.equal(echoTail({ level: 1, layers: [], echo: { delay: 0.1, feedback: 1, wet: 1, lowpass: 1 } }), 0.1);
  assert.equal(sourceEnd({ level: 1, layers: [] }), 0);
});

test('every layer is well formed', () => {
  for (const name of ORDER) {
    const recipe = recipes[name];
    assert.ok(recipe.layers.length > 0, name);
    for (const layer of recipe.layers) {
      assert.ok(layer.freq > 0 && layer.freq < 20000, `${name} freq`);
      assert.ok(layer.attack > 0 && layer.decay > 0 && layer.peak > 0 && layer.at >= 0, `${name} envelope`);
      if (layer.pan !== undefined) assert.ok(Math.abs(layer.pan) <= 1, `${name} pan`);
      assert.ok('noise' in layer ? ['lowpass', 'bandpass', 'highpass'].includes(layer.noise) : ['sine', 'triangle', 'sawtooth', 'square'].includes(layer.wave));
    }
  }
});

test('reference-matched recipes keep their signature details', () => {
  const tones = (name: SoundName) => recipes[name].layers.filter((layer): layer is ToneLayer => 'wave' in layer);
  const noises = (name: SoundName) => recipes[name].layers.filter((layer): layer is NoiseLayer => 'noise' in layer);
  for (const name of ['payout', 'deposit', 'pluck', 'notification', 'loss'] as const) assert.equal(recipes[name].echo, undefined, name);

  assert.equal(recipes.payout.layers.length, 16);
  assert.ok(tones('payout').some((l) => l.freq === 1168.75 && l.attack === 0.008));
  assert.ok(tones('payout').some((l) => l.freq === 2337.5 && l.at === 0.125));
  assert.ok(tones('payout').some((l) => l.to === 1168.75 && l.glide === 0.018));

  assert.equal(recipes.deposit.layers.length, 14);
  assert.ok(noises('deposit').some((l) => l.freq === 9100) && noises('deposit').some((l) => l.freq === 14420));
  assert.ok(recipes.deposit.layers.some((l) => l.decay === 0.39));
  assert.ok(recipes.deposit.layers.some((l) => l.pan! <= -0.7) && recipes.deposit.layers.some((l) => l.pan! >= 0.7));

  assert.equal(recipes.pluck.layers.length, 8);
  assert.ok(tones('pluck').some((l) => l.freq === 523.25 && l.to === 261.63 && l.wave === 'square'));
  assert.ok(recipes.pluck.layers.every((l) => Math.abs(l.pan ?? 0) <= 0.5));

  assert.equal(recipes.notification.layers.length, 14);
  const tone = (hz: number) => tones('notification').find((l) => l.freq === hz)!;
  assert.equal(tone(873).decay, 0.78);
  assert.equal(tone(885).decay, 0.8);
  assert.ok(tone(3485).pan! < -0.5 && tone(3575).pan! > 0.5);

  assert.equal(recipes.loss.layers.length, 11);
  for (const [from, to] of [[260, 52], [800, 200], [400, 52], [600, 147]]) {
    assert.ok(tones('loss').some((l) => l.freq === from && l.to === to), `${from}→${to}`);
  }
  assert.ok(recipes.loss.layers.filter((l) => l.at === 0.125).length >= 5);
});
