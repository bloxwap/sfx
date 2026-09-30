import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configure, setVolume, getVolume, preload, play, dispose, categoryOf, isCategory, categories, soundCategories, sounds } from '../dist/index.js';
import { installAudio, globals, FakeAudioContext, setActivation } from './fake-audio.ts';

test('reduced-motion preset is opt-in and preserves an explicitly chosen master volume', () => {
  configure({ respectReducedMotion: false });
  configure({ respectReducedMotion: true }); // matchMedia unavailable
  assert.equal(getVolume(), 1);
  globals.matchMedia = () => ({ matches: false });
  configure({ respectReducedMotion: true });
  assert.equal(getVolume(), 1);
  globals.matchMedia = () => ({ matches: true });
  configure({ respectReducedMotion: true });
  assert.equal(getVolume(), 0.5);
  setVolume(0.8);
  configure({ respectReducedMotion: true });
  assert.equal(getVolume(), 0.8);
  delete globals.matchMedia;
});

test('categories match the sound board and reject arbitrary property names', () => {
  assert.deepEqual(categories, ['hover', 'controls', 'feedback', 'money']);
  assert.equal(Object.keys(soundCategories).length, sounds.length);
  for (const name of sounds) assert.ok(isCategory(categoryOf(name)));
  for (const name of ['unknown', 'toString', '__proto__']) assert.equal(categoryOf(name as typeof sounds[number]), 'feedback');
  for (const value of ['toString', '__proto__', '', {}, null]) assert.equal(isCategory(value), false);
});

test('category mixing scales live and cached sounds independently without affecting offline export', async () => {
  installAudio(); setActivation(true); configure({ minInterval: 0 }); setVolume(0.8);
  setVolume(0.4, { category: 'hover' }); setVolume(0.2, { category: 'money' });
  assert.equal(getVolume(), 0.8); assert.equal(getVolume({ category: 'hover' }), 0.4);
  assert.equal(getVolume({ category: 'controls' }), 1);
  play('chime');
  const context = FakeAudioContext.instances.at(-1)!;
  assert.ok(context.of('gain').some(node => node.gain.value === 1.75 * 0.4), 'live recipe is scaled');
  await preload(['payout', 'tick']);
  play('payout', { volume: 0.5 });
  assert.ok(context.of('gain').some(node => node.gain.value === 0.1), 'cached gain includes per-play and category volume');
  play('tick', { category: 'hover' });
  assert.ok(context.of('gain').some(node => node.gain.value === 0.4), 'override can assign a control sound to hover');
  const before = context.of('source').length;
  setVolume(0, { category: 'money' }); play('payout');
  assert.equal(context.of('source').length, before);
  setVolume(4, { category: 'hover' }); assert.equal(getVolume({ category: 'hover' }), 1);
  setVolume(-1, { category: 'hover' }); assert.equal(getVolume({ category: 'hover' }), 0);
  setVolume(NaN, { category: 'hover' }); assert.equal(getVolume({ category: 'hover' }), 0);
  setVolume(0.1, { category: 'bad' as 'hover' }); assert.equal(getVolume(), 0.8);
  await dispose();
});
