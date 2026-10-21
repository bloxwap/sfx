import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAudioContext } from 'node-web-audio-api';
import * as sfx from '../dist/index.js';
import { recipes } from '../dist/recipes.js';
import { globals, installAudio, FakeOfflineAudioContext } from './fake-audio.ts';
import { compareCache } from './cache-equivalence.ts';

test('mono cache matches stereo output at center and non-zero pan for every unpanned built-in', async () => {
  globals.OfflineAudioContext = OfflineAudioContext;
  const { bytes, maxDiff } = await compareCache(sfx, recipes, OfflineAudioContext);
  assert.equal(maxDiff, 0);
  console.log(`48 kHz catalog cache: ${bytes} bytes`);
  assert.ok(bytes <= 3_050_000);
});

test('custom layers with absent or zero pan cache mono; either pan direction caches stereo', async () => {
  installAudio();
  try {
    for (const pan of [undefined, 0, -0.3, 0.3]) {
      const name = sfx.define('cache-channel-test', {
        level: 1,
        layers: [{ wave: 'sine', freq: 440, at: 0, attack: 0.01, decay: 0.1, peak: 0.5, pan }],
      });
      await sfx.preload([name]);
      assert.equal(FakeOfflineAudioContext.instances.at(-1)!.channels, pan ? 2 : 1);
      assert.equal((await sfx.renderBuffer(name))!.numberOfChannels, 2);
    }
  } finally {
    await sfx.dispose();
  }
});
