// Main-thread cost of one play, per sound, with real Web Audio nodes (node-web-audio-api):
//   live      — build the whole layer graph (oscillators, noise, filters, envelopes, echo) per play,
//               the way a naive synthesizer does
//   buffered  — this library's hot path: one AudioBufferSourceNode reading a pre-rendered buffer
// Fails if the buffered path is not at least MIN_SPEEDUP× cheaper on average, so regressions show up in CI.
import { OfflineAudioContext } from 'node-web-audio-api';
import { synthesize } from '../dist/engine.js';
import { duration, recipes, sounds, type Recipe } from '../dist/recipes.js';

const SAMPLE_RATE = 48000;
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 300);
const MIN_SPEEDUP = 5;

function measure(run: (ctx: OfflineAudioContext) => void): number {
  // Fresh context per batch so node counts don't pile up across measurements.
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  for (let i = 0; i < 20; i++) run(ctx);
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) run(ctx);
  return Number(process.hrtime.bigint() - start) / 1000 / ITERATIONS;
}

function countNodes(recipe: Recipe): number {
  let count = 1 + (recipe.echo ? 4 : 0);
  for (const layer of recipe.layers) count += ('noise' in layer ? 3 : 2) + (layer.pan === undefined ? 0 : 1);
  return count;
}

interface Row { name: string; nodes: number; live: number; buffered: number; speedup: number }
const rows: Row[] = [];
for (const name of sounds) {
  const recipe = recipes[name];
  const renderer = new OfflineAudioContext(2, Math.ceil((duration(name) + 0.1) * SAMPLE_RATE), SAMPLE_RATE);
  synthesize(renderer, recipe, renderer.destination, 0);
  const buffer = await renderer.startRendering();

  const live = measure((ctx) => synthesize(ctx, recipe, ctx.destination, ctx.currentTime));
  const buffered = measure((ctx) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  });
  rows.push({ name, nodes: countNodes(recipe), live, buffered, speedup: live / buffered });
}

console.log(`play() main-thread cost, µs per call (${ITERATIONS} iterations, real Web Audio nodes)\n`);
console.log(`${'sound'.padEnd(13)} ${'nodes'.padStart(5)} ${'live'.padStart(9)} ${'buffered'.padStart(9)} ${'speedup'.padStart(8)}`);
for (const row of rows) {
  console.log(`${row.name.padEnd(13)} ${String(row.nodes).padStart(5)} ${row.live.toFixed(1).padStart(9)} ${row.buffered.toFixed(1).padStart(9)} ${`${row.speedup.toFixed(1)}×`.padStart(8)}`);
}
const mean = (key: 'nodes' | 'live' | 'buffered'): number => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
const speedup = mean('live') / mean('buffered');
console.log(`\n${'mean'.padEnd(13)} ${mean('nodes').toFixed(1).padStart(5)} ${mean('live').toFixed(1).padStart(9)} ${mean('buffered').toFixed(1).padStart(9)} ${`${speedup.toFixed(1)}×`.padStart(8)}`);

if (speedup < MIN_SPEEDUP) {
  console.error(`::error::buffered playback is only ${speedup.toFixed(1)}× cheaper than live synthesis (expected ≥ ${MIN_SPEEDUP}×)`);
  process.exit(1);
}
