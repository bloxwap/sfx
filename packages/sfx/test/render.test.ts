// Renders every recipe with a real Web Audio implementation (node-web-audio-api) and checks the audio
// itself: it is finite, audible, below full scale, decays to silence, sits where it should in the
// stereo field, and carries its fundamental pitch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAudioContext } from 'node-web-audio-api';
import { synthesize } from '../dist/engine.js';
import { duration, recipes, sounds, type BuiltinSoundName as SoundName } from '../dist/recipes.js';

const SAMPLE_RATE = 48000;
const buffers = new Map<SoundName, [Float32Array, Float32Array]>();

async function render(name: SoundName): Promise<[Float32Array, Float32Array]> {
  if (!buffers.has(name)) {
    const ctx = new OfflineAudioContext(2, Math.ceil((duration(name) + 0.1) * SAMPLE_RATE), SAMPLE_RATE);
    synthesize(ctx, recipes[name], ctx.destination, 0);
    const buffer = await ctx.startRendering();
    buffers.set(name, [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()]);
  }
  return buffers.get(name)!;
}

const rms = (data: Float32Array, from = 0, to = data.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** Magnitude of one frequency (Goertzel), normalized by length. */
function magnitude(data: Float32Array, hz: number, from: number, to: number): number {
  const k = (2 * Math.PI * hz) / SAMPLE_RATE;
  const coefficient = 2 * Math.cos(k);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = data[i] + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (to - from);
}

for (const name of sounds) {
  test(`${name} renders clean, audible audio that decays`, async () => {
    const [left, right] = await render(name);
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
      assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]), 'finite samples');
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    assert.ok(peak > 0.05, `audible (peak ${peak.toFixed(3)})`);
    assert.ok(peak < 1, `below full scale (peak ${peak.toFixed(3)})`);
    // The last 20 ms (after the ring-out) are silent: nothing is left running.
    const tail = Math.floor(0.02 * SAMPLE_RATE);
    assert.ok(rms(left, left.length - tail) < 1e-3 && rms(right, right.length - tail) < 1e-3, 'decays to silence');
  });
}

test('centered sounds are mono; panned recipes are stereo', async () => {
  for (const name of sounds) {
    const [left, right] = await render(name);
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference = Math.max(difference, Math.abs(left[i] - right[i]));
    const panned = recipes[name].layers.some((layer) => layer.pan !== undefined);
    if (panned) assert.ok(difference > 0.01, `${name} is stereo`);
    else assert.ok(difference < 1e-6, `${name} is mono`);
  }
});

test('tonal sounds carry their fundamental', async () => {
  // [sound, expected Hz, window start s, window end s, off-pitch Hz for comparison]
  const cases: [SoundName, number, number, number, number][] = [
    ['chime', 1046.5, 0.005, 0.08, 1300],
    ['chime', 1568, 0.1, 0.2, 1300],
    ['success', 1318.51, 0.13, 0.25, 1000],
    ['bloom', 528, 0.05, 0.3, 700],
    ['payout', 2337.5, 0.13, 0.4, 1800],
    ['notification', 873, 0.3, 0.6, 1100],
  ];
  for (const [name, hz, from, to, off] of cases) {
    const [left] = await render(name);
    const start = Math.floor(from * SAMPLE_RATE);
    const end = Math.floor(to * SAMPLE_RATE);
    const on = magnitude(left, hz, start, end);
    const away = magnitude(left, off, start, end);
    assert.ok(on > away * 5, `${name} at ${hz} Hz (${on.toExponential(2)} vs ${away.toExponential(2)} at ${off} Hz)`);
  }
});

test('glides land on their target pitch', async () => {
  // Dry signal only: the echo replays the start of the glide on top of its end.
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE / 4, SAMPLE_RATE);
  synthesize(ctx, { ...recipes.droplet, echo: undefined }, ctx.destination, 0);
  const data = (await ctx.startRendering()).getChannelData(0).slice();
  const start = Math.floor(0.145 * SAMPLE_RATE);
  const end = Math.floor(0.19 * SAMPLE_RATE);
  assert.ok(magnitude(data, 550, start, end) > magnitude(data, 1200, start, end) * 5, 'ends at 550 Hz');
  assert.ok(magnitude(data, 1200, 0, 480) > magnitude(data, 550, 0, 480) * 2, 'starts at 1200 Hz');
});

test('two-stage sounds strike again at 125 ms', async () => {
  for (const name of ['payout', 'loss'] as const) {
    const [left] = await render(name);
    const window = Math.floor(0.01 * SAMPLE_RATE);
    const before = rms(left, Math.floor(0.11 * SAMPLE_RATE), Math.floor(0.11 * SAMPLE_RATE) + window);
    const after = rms(left, Math.floor(0.13 * SAMPLE_RATE), Math.floor(0.13 * SAMPLE_RATE) + window);
    assert.ok(after > before * 1.5, `${name} second stage (${before.toFixed(4)} → ${after.toFixed(4)})`);
  }
});

test('rate stretches time and pitch together', async () => {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  synthesize(ctx, recipes.chime, ctx.destination, 0, 2);
  const data = (await ctx.startRendering()).getChannelData(0).slice();
  const start = Math.floor(0.003 * SAMPLE_RATE);
  const end = Math.floor(0.04 * SAMPLE_RATE);
  assert.ok(magnitude(data, 2093, start, end) > magnitude(data, 1046.5, start, end) * 5, 'an octave up');
});
