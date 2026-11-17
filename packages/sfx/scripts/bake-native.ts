// Bakes every built-in recipe to the PCM files the React Native engine ships (native/assets/bloxwap-sfx).
// Run after changing a renderer input: `npm run bake:native`. test/native.test.ts rejects stale assets.
//
// Renders in headless Chromium (Playwright) because that is the engine web users hear: node-web-audio-api
// renders sawtooth-heavy cues (notification) about 2 dB quieter. Math.random is seeded, so a re-bake on the
// same Chromium build reproduces every file's length and level; Chromium's float path may still round a few
// samples of the busiest stereo cues to the neighbouring 16-bit step, which is inaudible.
//
// Format: 48 kHz (the iPhone and most Android mixers' native rate, so the OS never resamples), 16-bit PCM,
// trimmed 20 ms past -60 dB. Mono unless the recipe pans a layer, so mono cues cost half the memory.
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { duration, recipes, sounds } from '../dist/recipes.js';
import { encodeWav, trimSilence } from '../dist/wav.js';
import { assetFingerprint } from './asset-fingerprint.ts';

const SAMPLE_RATE = 48000;
const SEED = 0x5f3759df;
// Both native mixers cap gain at 1. Bake 2x, then divide requested gain by 2 at playback.
const ASSET_GAIN = 2;
const out = process.argv[2] ?? fileURLToPath(new URL('../native/assets/bloxwap-sfx', import.meta.url));

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  bundle: true,
  format: 'iife',
  globalName: 'sfx',
  write: false,
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Seed before the engine loads: its shared noise buffer and every noise layer's read offset use Math.random.
  await page.setContent('<!doctype html><title>bake</title>');
  await page.evaluate((seed: number) => {
    let state = seed >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const entries = [];
  let pcmBytes = 0;
  for (const name of sounds) {
    const recipe = recipes[name];
    const channels = recipe.layers.some((layer) => layer.pan) ? 2 : 1;
    const encoded: string[] = await page.evaluate(async ({ name, channels, sampleRate, seconds, gain }) => {
      const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
      if (!(window as unknown as { sfx: { renderTo(c: BaseAudioContext, n: string, o: { volume: number }): boolean } }).sfx.renderTo(ctx, name, { volume: gain })) throw new Error(`renderTo rejected ${name}`);
      const buffer = await ctx.startRendering();
      return Array.from({ length: channels }, (_, c) => {
        const bytes = new Uint8Array(buffer.getChannelData(c).buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      });
    }, { name, channels, sampleRate: SAMPLE_RATE, seconds: duration(name) + 0.2, gain: ASSET_GAIN });
    const data = encoded.map((base64) => {
      const bytes = Buffer.from(base64, 'base64');
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    });
    const audio = trimSilence({ numberOfChannels: channels, sampleRate: SAMPLE_RATE, length: data[0]!.length, getChannelData: (c) => data[c]! });
    let peak = 0;
    for (const samples of audio.channels) for (const x of samples) peak = Math.max(peak, Math.abs(x));
    if (!(peak > 0.01 && peak <= 1)) throw new Error(`${name}: peak ${peak} is out of range`);
    const wav = new Uint8Array(encodeWav(audio, { bitDepth: 16 }));
    await writeFile(join(out, `${name}.wav`), wav);
    pcmBytes += audio.length * channels * 4;
    entries.push({
      name,
      channels,
      frames: audio.length,
      durationMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
      peakDb: Math.round(2000 * Math.log10(peak)) / 100,
      recipeSha256: createHash('sha256').update(JSON.stringify(recipe)).digest('hex'),
      sha256: createHash('sha256').update(wav).digest('hex'),
    });
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    sourceSha256: assetFingerprint('native'),
    renderer: `chromium ${browser.version()}`,
    command: 'npm run bake:native',
    format: { sampleRate: SAMPLE_RATE, bitDepth: 16, encoding: 'PCM', trimThresholdDb: -60, trimPadMs: 20, gain: ASSET_GAIN },
    seed: SEED,
    sounds: entries,
  }, null, 2) + '\n');
  const files = (await readdir(out)).filter((file) => file.endsWith('.wav'));
  const fileBytes = entries.reduce((sum, entry) => sum + 44 + entry.frames * entry.channels * 2, 0);
  console.log(`Baked ${files.length} sounds to ${out}: ${(fileBytes / 1024).toFixed(0)} KiB on disk, ${(pcmBytes / 1024).toFixed(0)} KiB as float32 PCM.`);
  for (const entry of entries) console.log(`  ${entry.name.padEnd(13)} ${String(entry.durationMs).padStart(5)} ms  ${entry.channels === 2 ? 'stereo' : 'mono  '}  ${entry.peakDb} dBFS`);
} finally {
  await browser.close();
}
