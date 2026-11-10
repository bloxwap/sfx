import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { approvedCues, semanticPresets, type FeedbackIntent } from '../dist/semantic.js';
import { recipes } from '../dist/recipes.js';

test('semantic presets and manifest intents only use approved cues', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/hig/manifest.json', import.meta.url), 'utf8'));
  for (const presets of [semanticPresets, manifest.semanticPresets]) {
    for (const [intent, preset] of Object.entries(presets) as [string, { sound: string | null }][]) {
      assert.ok(preset.sound === null || (approvedCues as readonly string[]).includes(preset.sound), intent);
    }
  }
  for (const cue of manifest.cues) {
    const intents = Object.keys(manifest.semanticPresets).filter(intent => manifest.semanticPresets[intent].sound === cue.name);
    assert.ok(intents.length > 0, cue.name);
    for (const intent of intents) {
      const sound = semanticPresets[intent as FeedbackIntent].sound;
      assert.ok(sound !== null && approvedCues.includes(sound), intent);
      assert.equal(sound, cue.name, intent);
    }
  }
});

test('approved artifacts match recipes, semantic intent, format, hashes and envelope/level metadata', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/hig/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.semanticPresets, semanticPresets);
  assert.deepEqual(manifest.cues.map((cue: { name: string }) => cue.name), approvedCues);
  assert.equal(manifest.format.sampleRate, 48000);
  for (const cue of manifest.cues) {
    const bytes = readFileSync(new URL(`../assets/hig/${cue.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), cue.sha256);
    const recipe = recipes[cue.name as keyof typeof recipes];
    assert.deepEqual(cue.recipe, recipe);
    assert.equal(createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), cue.recipeSha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40) / 2, cue.frames);
    assert.equal(cue.durationMs, cue.frames / 48000 * 1000);
    let peak = 0, sum = 0;
    for (let p = 44; p < bytes.length; p += 2) {
      const value = bytes.readInt16LE(p) / 32768;
      peak = Math.max(peak, Math.abs(value)); sum += value * value;
    }
    assert.equal(peak, cue.peak);
    assert.equal(Math.sqrt(sum / cue.frames), cue.rms);
    assert.ok(peak > 0.01 && peak < 1 && cue.durationMs > 20 && cue.durationMs < 2000);
  }
});
