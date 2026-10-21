// Whole-catalog encodeWav A/B; rendering is outside the measured batches.
import { OfflineAudioContext } from 'node-web-audio-api';
import { mkdir, writeFile } from 'node:fs/promises';
import { rawDir, variantURL } from './paths.ts';
import { median, p95, table } from './stats.ts';

const runs = Number(process.env.BENCH_RUNS ?? 15);
if (!Number.isInteger(runs) || runs < 1) throw Error('BENCH_RUNS must be a positive integer');
const variants = process.argv.length > 2 ? process.argv.slice(2) : ['base'];
(globalThis as any).OfflineAudioContext = OfflineAudioContext;
const builds = await Promise.all(variants.map(async name => {
  const dist = variantURL(name);
  const { renderBuffer, sounds } = await import(new URL('index.js', dist).href) as typeof import('../../dist/index.js');
  const { encodeWav } = await import(new URL('wav.js', dist).href) as typeof import('../../dist/wav.js');
  const buffers = [];
  for (const sound of sounds) {
    const buffer = await renderBuffer(sound, { sampleRate: 48000 });
    if (!buffer) throw Error(`Rendering failed: ${name}/${sound}`);
    buffers.push(buffer);
  }
  return { name, buffers, encodeWav, samples: {} as Record<string, number[]> };
}));

// Interleave each measured run across builds, with one discarded warmup.
for (let run = -1; run < runs; run++) {
  for (const bitDepth of [16, 24, 32] as const) {
    for (const channels of [1, 2] as const) {
      for (const build of builds) {
        const start = performance.now();
        for (const buffer of build.buffers) build.encodeWav(buffer, { bitDepth, channels });
        const elapsed = performance.now() - start;
        if (run >= 0) (build.samples[`${bitDepth}-bit / ${channels}ch`] ??= []).push(elapsed);
      }
    }
  }
}
console.log(`# WAV encoding · Node ${process.version} · 48 kHz · runs=${runs}\n`);
console.log(table(['variant', 'catalog encoding', 'median ms', 'p95 ms'], builds.flatMap(build =>
  Object.entries(build.samples).map(([label, samples]) => [build.name, label, median(samples), p95(samples)]))));
await mkdir(rawDir, { recursive: true });
await writeFile(`${rawDir}/wav-${Date.now()}.json`, JSON.stringify({
  node: process.version, runs, warmup: 1, sampleRate: 48000,
  results: builds.map(({ name, samples }) => ({ name, samples })),
}, null, 2));
