// Regenerate the approved HIG subset. No browser/native playback dependency enters Metro.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { run } from '../dist/cli/index.js';
import { approvedCues, semanticPresets, semanticSource } from '../dist/semantic.js';
import { recipes, duration } from '../dist/recipes.js';
import { synthesize } from '../dist/engine.js';

const out = process.argv[2] ?? fileURLToPath(new URL('../assets/hig', import.meta.url));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
const sampleRate = 48000;
const flags = ['--out', out, '--sounds', approvedCues.join(','), '--sample-rate', String(sampleRate), '--bit-depth', '16', '--channels', '1', '--trim'];
await mkdir(out, { recursive: true });
if (await run(flags)) throw new Error('Approved cue export failed');
const cues = [];
for (const name of approvedCues) {
  const wav = await readFile(join(out, `${name}.wav`));
  const samples = (wav.length - 44) / 2;
  let peak = 0, energy = 0;
  for (let i = 44; i < wav.length; i += 2) {
    const value = wav.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(value)); energy += value * value;
  }
  // Validate the recipe envelope separately, including its trailing silence before trimming.
  const context = new OfflineAudioContext(1, Math.ceil((duration(name) + 0.1) * sampleRate), sampleRate);
  synthesize(context as unknown as BaseAudioContext, recipes[name], context.destination as unknown as AudioNode, 0);
  const audio = await context.startRendering();
  const tail = audio.getChannelData(0).slice(-960);
  if (!(peak > 0.01 && peak < 1 && samples > 0 && samples / sampleRate < 2 && tail.every(x => Number.isFinite(x) && Math.abs(x) < 0.001))) throw new Error(`Invalid cue envelope/levels: ${name}`);
  cues.push({ name, file: `${name}.wav`, recipe: recipes[name], recipeSha256: createHash('sha256').update(JSON.stringify(recipes[name])).digest('hex'), sha256: createHash('sha256').update(wav).digest('hex'), frames: samples, durationMs: samples / sampleRate * 1000, peak, rms: Math.sqrt(energy / samples) });
}
await writeFile(join(out, 'manifest.json'), JSON.stringify({
  schemaVersion: 1, semanticSource, package: `@bloxwap/sfx@${packageJson.version}`, sourceRepository: 'https://github.com/bloxwap/sfx',
  renderer: `node-web-audio-api@${lock.packages['node_modules/node-web-audio-api'].version}`,
  command: 'npm ci && npm run export:hig',
  flags: flags.map(value => value === out ? 'packages/sfx/assets/hig' : value),
  format: { sampleRate, channels: 1, bitDepth: 16, encoding: 'PCM', trimThresholdDb: -60, trimPadMs: 20 },
  variance: 'Noise uses Math.random; regenerations may differ in samples, hashes, trim duration and levels. Review versioned artifacts and bounded envelope/level checks; byte identity is not guaranteed across renderers or platforms.',
  semanticPresets, cues,
}, null, 2) + '\n');
