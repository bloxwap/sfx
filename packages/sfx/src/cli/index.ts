// sfx-wav: renders the recipes to WAV files (for native apps) with node-web-audio-api's
// OfflineAudioContext, through the same public renderTo() the browser build uses.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { duration, isSound, renderTo, sounds, type SoundName } from '../index.js';
import { encodeWav, trimSilence, type AudioBufferLike, type WavOptions } from '../wav.js';

export const HELP = `Usage: sfx-wav [options]

Renders @bloxwap/sfx sounds to WAV files, one per sound.

Options:
  --out <dir>                 Output directory (default ./sfx)
  --sounds <a,b,c>            Sounds to render (default all; "" for none, with --combo)
  --sample-rate <hz>          3000-768000 (default 48000)
  --bit-depth <16|24|32>      16/24-bit PCM or 32-bit float (default 16)
  --channels <1|2>            Mono (averaged) or stereo (default 2)
  --trim                      Cut trailing audio below -60 dB, keeping 20 ms
  --combo <name=sound@s,...>  Mix sounds into one file, each starting at its offset
                              in seconds (repeatable), e.g. tap=press@0,release@0.09
  -h, --help                  Show this help

Example:
  sfx-wav --out assets/sfx --sounds tick,toggle,success --combo tap=press@0,release@0.09

Needs the optional peer dependency node-web-audio-api:
  npm install --save-dev node-web-audio-api

Sounds: ${sounds.join(', ')}`;

const INSTALL = 'npm install --save-dev node-web-audio-api';
/** Seconds rendered past the last sound's end, as the engine's own renders do. */
const TAIL = 0.1;
const NAME = /^[\w-][\w.-]*$/;

interface Part { sound: SoundName; at: number }
interface Job { name: string; parts: Part[] }
interface Plan {
  out: string;
  sampleRate: number;
  bitDepth: WavOptions['bitDepth'];
  channels: WavOptions['channels'];
  trim: boolean;
  jobs: Job[];
}

type OfflineConstructor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Replaceable I/O for tests: the module loader, file system, console and working directory. */
export interface RunDeps {
  load?: () => Promise<{ OfflineAudioContext: OfflineConstructor }>;
  fs?: {
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
  };
  log?: (message: string) => void;
  error?: (message: string) => void;
  cwd?: string;
}

/** Turns argv into a render plan. Throws an Error whose message is shown to the user. */
function parse(argv: string[], cwd: string): Plan | { help: true } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      out: { type: 'string' },
      sounds: { type: 'string' },
      'sample-rate': { type: 'string' },
      'bit-depth': { type: 'string' },
      channels: { type: 'string' },
      trim: { type: 'boolean' },
      combo: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return { help: true };
  const sampleRate = Number(values['sample-rate'] ?? 48000);
  if (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 768000) {
    throw new Error(`--sample-rate must be a whole number from 3000 to 768000, got "${values['sample-rate']}"`);
  }
  const jobs: Job[] = [];
  const names = values.sounds === undefined ? sounds : values.sounds.split(',').map((s) => s.trim()).filter(Boolean);
  for (const sound of names) {
    if (!isSound(sound)) throw new Error(`unknown sound "${sound}" (choose from ${sounds.join(', ')})`);
    jobs.push({ name: sound, parts: [{ sound, at: 0 }] });
  }
  for (const spec of values.combo ?? []) jobs.push(combo(spec));
  if (!jobs.length) throw new Error('nothing to render');
  // Compared ignoring case: macOS and Windows file systems would write both to one file.
  const seen = new Set<string>();
  for (const { name } of jobs) {
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`two outputs are named "${name}" (names are compared ignoring case)`);
    seen.add(key);
  }
  return {
    out: resolve(cwd, values.out ?? 'sfx'),
    sampleRate,
    bitDepth: choice(values['bit-depth'], '--bit-depth', [16, 24, 32] as const),
    channels: choice(values.channels, '--channels', [1, 2] as const),
    trim: values.trim === true,
    jobs,
  };
}

function choice<T extends number>(value: string | undefined, flag: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!(allowed as readonly number[]).includes(n)) throw new Error(`${flag} must be ${allowed.join(' or ')}, got "${value}"`);
  return n as T;
}

/** Parses `name=sound@seconds,sound@seconds`; the offset defaults to 0. */
function combo(spec: string): Job {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq);
  if (eq < 0 || !NAME.test(name)) throw new Error(`--combo needs name=sound@seconds,...; got "${spec}"`);
  const parts = spec.slice(eq + 1).split(',').map((part): Part => {
    const match = /^([^@]+)(?:@(.+))?$/.exec(part.trim());
    const at = Number(match?.[2] ?? 0);
    const sound = match?.[1];
    if (!isSound(sound) || !(at >= 0 && at <= 10)) {
      throw new Error(`--combo "${name}": "${part}" must be a sound name with an optional @seconds offset (0-10)`);
    }
    return { sound, at };
  });
  return { name, parts };
}

/** Peak in dBFS of what gets written (after a mono downmix), or -inf for silence. */
function peakDb(audio: AudioBufferLike, channels: WavOptions['channels']): string {
  const data = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const mono = channels === 1;
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    if (mono) {
      let sum = 0;
      for (const samples of data) sum += samples[i];
      peak = Math.max(peak, Math.abs(sum / data.length));
    } else {
      for (const samples of data) peak = Math.max(peak, Math.abs(samples[i]));
    }
  }
  return peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '-inf';
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  return rows.map((row) => row.map((cell, c) => (c ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join('  ')).join('\n');
}

/**
 * Runs the CLI and resolves its exit code: 0 on success, 1 when rendering or writing fails (including
 * a missing node-web-audio-api), 2 for bad arguments. Never throws. `deps` replaces the module loader,
 * file system, console and working directory for tests.
 */
export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const {
    load = () => import('node-web-audio-api'),
    fs = { mkdir, writeFile },
    log = console.log,
    error = console.error,
    cwd = process.cwd(),
  } = deps;
  let plan: Plan | { help: true };
  try {
    plan = parse(argv, cwd);
  } catch (e) {
    error(`sfx-wav: ${(e as Error).message}\nRun sfx-wav --help for usage.`);
    return 2;
  }
  if ('help' in plan) {
    log(HELP);
    return 0;
  }
  let OfflineAudioContext: OfflineConstructor;
  try {
    ({ OfflineAudioContext } = await load());
  } catch (e) {
    error(`sfx-wav: rendering needs the optional peer dependency node-web-audio-api, which could not be loaded (${(e as Error).message}).\nInstall it with: ${INSTALL}`);
    return 1;
  }
  try {
    await fs.mkdir(plan.out, { recursive: true });
    const rows = [['file', 'duration ms', 'peak dBFS']];
    for (const { name, parts } of plan.jobs) {
      const end = Math.max(...parts.map(({ sound, at }) => at + duration(sound)));
      const ctx = new OfflineAudioContext(2, Math.ceil((end + TAIL) * plan.sampleRate), plan.sampleRate);
      for (const { sound, at } of parts) {
        if (!renderTo(ctx, sound, { delay: at })) throw new Error(`could not render "${sound}"`);
      }
      let audio: AudioBufferLike = await ctx.startRendering();
      if (plan.trim) audio = trimSilence(audio);
      const file = `${name}.wav`;
      const options: WavOptions = {};
      if (plan.bitDepth) options.bitDepth = plan.bitDepth;
      if (plan.channels) options.channels = plan.channels;
      const wav = encodeWav(audio, options);
      await fs.writeFile(join(plan.out, file), new Uint8Array(wav));
      rows.push([file, String(Math.round((audio.length / audio.sampleRate) * 1000)), peakDb(audio, plan.channels)]);
    }
    log(`${table(rows)}\n\nWrote ${rows.length - 1} file${rows.length === 2 ? '' : 's'} to ${plan.out}`);
    return 0;
  } catch (e) {
    error(`sfx-wav: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}
