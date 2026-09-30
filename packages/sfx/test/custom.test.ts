import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAudioContext } from 'node-web-audio-api';
import { define, duration, isSound, play, preload, renderBuffer, renderTo, dispose, type Recipe, type Layer } from '../dist/index.js';
import { getRecipe, recipes } from '../dist/recipes.js';
import { installAudio, setActivation, FakeAudioContext, asReal } from './fake-audio.ts';
const tone = { wave: 'sine', freq: 440, at: 0, attack: 0.01, decay: 0.1, peak: 0.5 } as const;
const recipe: Recipe = { level: 0.5, layers: [tone] };

test('defined recipes render, preload and play without changing built-ins or caller data', async () => {
  const name = define('coin', recipe);
  assert.equal(name, 'coin'); assert.equal(isSound(name), true);
  assert.equal(isSound('not-defined'), false); assert.equal(isSound({}), false);
  assert.equal(getRecipe('chime'), recipes.chime);
  assert.equal(duration('coin'), 0.11);
  assert.notEqual(getRecipe('coin'), recipe);
  assert.ok(Object.isFrozen(getRecipe('coin').layers[0]));
  assert.ok(!Object.isFrozen(recipe));
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  assert.ok(renderTo(asReal(ctx), name));
  const audio = await ctx.startRendering();
  assert.ok(audio.getChannelData(0).some(sample => Math.abs(sample) > 0.05));
  installAudio(); setActivation(true);
  await preload([name]);
  play(name);
  assert.ok(FakeAudioContext.instances.length > 0);
  assert.ok(await renderBuffer(name));
  await dispose();
  assert.ok(isSound(name), 'definitions survive disposal of playback resources');
});

test('custom noise, glide, pan and echo preserve independent immutable data', () => {
  define('echo-coin', { level: 1, layers: [{ ...tone, to: 880, glide: 0.05, detune: 3, pan: 0.5 }, { noise: 'lowpass', freq: 1000, q: 1, at: 0, attack: 0.01, decay: 0.1, peak: 0.1 }], echo: { delay: 0.1, feedback: 0.2, wet: 0.3, lowpass: 3000 } });
  assert.ok(Object.isFrozen(getRecipe('echo-coin').echo));
  define('noise-coin', { level: 1, layers: [{ noise: 'highpass', freq: 1000, at: 0, attack: 0.01, decay: 0.1, peak: 0 }] });
  define('zero-echo', { ...recipe, echo: { delay: 1, feedback: 0, wet: 0, lowpass: 3000 } });
});

test('invalid names and recipes cannot poison the renderer or overwrite a built-in', () => {
  for (const name of ['', ' ', '__proto__', 'toString', 'chime']) assert.throws(() => define(name, recipe), RangeError);
  const invalidRecipes: unknown[] = [null, { ...recipe, level: NaN }, { ...recipe, level: -1 }, { ...recipe, layers: null }, { ...recipe, layers: [] }];
  for (const value of invalidRecipes) assert.throws(() => define('invalid', value as Recipe), RangeError);
  const invalidLayers: unknown[] = [
    ...(['at', 'attack', 'decay', 'peak', 'freq'] as const).map(key => ({ ...tone, [key]: -1 })),
    { ...tone, pan: 2 }, { ...tone, pan: NaN }, { ...tone, wave: 'bad' }, { ...tone, to: 0 }, { ...tone, glide: 0 }, { ...tone, detune: Infinity },
    { ...tone, noise: 'bad' }, { ...tone, noise: 'bandpass', q: -1 },
  ];
  for (const layer of invalidLayers) assert.throws(() => define('invalid', { ...recipe, layers: [layer as Layer] }), RangeError);
  const echo = { delay: 0.1, feedback: 0.2, wet: 0.2, lowpass: 3000 };
  for (const [key, value] of [['delay', 0], ['delay', 2], ['feedback', -1], ['feedback', 1], ['wet', -1], ['lowpass', 0]] as const) {
    assert.throws(() => define('invalid', { ...recipe, echo: { ...echo, [key]: value } }), RangeError);
  }
  assert.equal(isSound('invalid'), false);
});


test('redefining a custom sound invalidates the old playback buffer', async () => {
  installAudio(); setActivation(true);
  define('replaceable', recipe);
  await preload(['replaceable']);
  define('replaceable', { ...recipe, layers: [{ ...tone, freq: 880 }] });
  play('replaceable');
  const context = FakeAudioContext.instances.at(-1)!;
  assert.ok(context.of('oscillator').some(node => node.frequency.events[0][1] === 880));
  await dispose();
});
