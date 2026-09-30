// WAV export: encodeWav() headers and sample encoding checked byte by byte, trimSilence(), and the
// sfx-wav CLI run in-process (real node-web-audio-api renders into a temp dir, plus injected failures).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { OfflineAudioContext } from 'node-web-audio-api';
import { encodeWav, trimSilence } from '../dist/wav.js';
import { duration, sounds } from '../dist/index.js';
import { HELP, run } from '../bin/cli.mjs';

/** An AudioBuffer-like over plain arrays. */
const audio = (channels, sampleRate = 48000) => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0].length,
  getChannelData: (c) => Float32Array.from(channels[c]),
});

const ascii = (view, at) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
const int24 = (view, at) => (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16));

/** A file's bytes as a standalone ArrayBuffer. */
const bytes = (file) => {
  const data = readFileSync(file);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.length);
};

/** Decodes with an independent reader (node-web-audio-api) to prove the files are valid WAV. */
async function decode(wav, sampleRate = 48000) {
  return new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(wav.slice(0));
}

describe('encodeWav', () => {
  test('16-bit PCM header, field by field', () => {
    const wav = encodeWav(audio([[0, 0, 0], [0, 0, 0]], 44100));
    const v = new DataView(wav);
    assert.equal(wav.byteLength, 44 + 3 * 4);
    assert.equal(ascii(v, 0), 'RIFF');
    assert.equal(v.getUint32(4, true), wav.byteLength - 8);
    assert.equal(ascii(v, 8), 'WAVE');
    assert.equal(ascii(v, 12), 'fmt ');
    assert.equal(v.getUint32(16, true), 16);
    assert.equal(v.getUint16(20, true), 1, 'PCM');
    assert.equal(v.getUint16(22, true), 2, 'channels');
    assert.equal(v.getUint32(24, true), 44100, 'sample rate');
    assert.equal(v.getUint32(28, true), 44100 * 4, 'byte rate');
    assert.equal(v.getUint16(32, true), 4, 'block align');
    assert.equal(v.getUint16(34, true), 16, 'bits per sample');
    assert.equal(ascii(v, 36), 'data');
    assert.equal(v.getUint32(40, true), 12);
  });

  test('16-bit samples are scaled, rounded, clamped and interleaved', () => {
    const left = [0, 1, -1, 0.5, -0.5, 2, -2, NaN];
    const right = [0.25, -0.25, 0, 0, 0, 0, 0, 1];
    const v = new DataView(encodeWav(audio([left, right]), { bitDepth: 16 }));
    const got = Array.from({ length: 16 }, (_, i) => v.getInt16(44 + i * 2, true));
    assert.deepEqual(got.filter((_, i) => i % 2 === 0), [0, 32767, -32768, 16384, -16384, 32767, -32768, 0]);
    assert.deepEqual(got.filter((_, i) => i % 2 === 1), [8192, -8192, 0, 0, 0, 0, 0, 32767]);
  });

  test('24-bit samples are three little-endian bytes, and an odd data chunk gets a pad byte', () => {
    const wav = encodeWav(audio([[1, -1, 0.5, -0.25, 3]]), { bitDepth: 24 });
    const v = new DataView(wav);
    assert.equal(v.getUint16(20, true), 1, 'PCM');
    assert.equal(v.getUint16(22, true), 1);
    assert.equal(v.getUint32(28, true), 48000 * 3);
    assert.equal(v.getUint16(32, true), 3);
    assert.equal(v.getUint16(34, true), 24);
    assert.equal(v.getUint32(40, true), 15, 'data size excludes the pad');
    assert.equal(wav.byteLength, 44 + 15 + 1);
    assert.equal(v.getUint32(4, true), wav.byteLength - 8, 'RIFF size includes the pad');
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => int24(v, 44 + i * 3)), [8388607, -8388608, 4194304, -2097152, 8388607]);
    assert.deepEqual([...new Uint8Array(wav, 44, 3)], [0xff, 0xff, 0x7f]);
    assert.deepEqual([...new Uint8Array(wav, 47, 3)], [0x00, 0x00, 0x80]);
    assert.equal(v.getUint8(wav.byteLength - 1), 0);
  });

  test('32-bit is IEEE float with an extended fmt chunk and a fact chunk', () => {
    const wav = encodeWav(audio([[0.25, 2, -3, NaN], [-0.125, 0, 1, -1]]), { bitDepth: 32 });
    const v = new DataView(wav);
    assert.equal(wav.byteLength, 58 + 4 * 8);
    assert.equal(v.getUint32(4, true), wav.byteLength - 8);
    assert.equal(v.getUint32(16, true), 18, 'fmt size');
    assert.equal(v.getUint16(20, true), 3, 'IEEE float');
    assert.equal(v.getUint16(22, true), 2);
    assert.equal(v.getUint32(28, true), 48000 * 8);
    assert.equal(v.getUint16(32, true), 8);
    assert.equal(v.getUint16(34, true), 32);
    assert.equal(v.getUint16(36, true), 0, 'cbSize');
    assert.equal(ascii(v, 38), 'fact');
    assert.equal(v.getUint32(42, true), 4);
    assert.equal(v.getUint32(46, true), 4, 'sample frames');
    assert.equal(ascii(v, 50), 'data');
    assert.equal(v.getUint32(54, true), 32);
    const got = Array.from({ length: 8 }, (_, i) => v.getFloat32(58 + i * 4, true));
    assert.deepEqual(got, [0.25, -0.125, 1, 0, -1, 1, 0, -1]);
  });

  test('channels: 1 averages every channel; 2 duplicates mono or keeps the first two', () => {
    const stereo = audio([[1, 0.5], [0, -0.5]]);
    const mono = new DataView(encodeWav(stereo, { channels: 1, bitDepth: 32 }));
    assert.equal(mono.getUint16(22, true), 1);
    assert.equal(mono.getUint16(32, true), 4);
    assert.deepEqual([mono.getFloat32(58, true), mono.getFloat32(62, true)], [0.5, 0]);

    const up = new DataView(encodeWav(audio([[0.5, -0.25]]), { channels: 2, bitDepth: 32 }));
    assert.equal(up.getUint16(22, true), 2);
    assert.deepEqual([0, 1, 2, 3].map((i) => up.getFloat32(58 + i * 4, true)), [0.5, 0.5, -0.25, -0.25]);

    const surround = audio([[0.5], [0.25], [0.125]]);
    const kept = new DataView(encodeWav(surround, { channels: 2, bitDepth: 32 }));
    assert.deepEqual([0, 1].map((i) => kept.getFloat32(58 + i * 4, true)), [0.5, 0.25]);
    const same = new DataView(encodeWav(surround, { bitDepth: 32 }));
    assert.equal(same.getUint16(22, true), 3, 'defaults to the buffer’s channel count');
    assert.deepEqual([0, 1, 2].map((i) => same.getFloat32(58 + i * 4, true)), [0.5, 0.25, 0.125]);
    const averaged = new DataView(encodeWav(surround, { channels: 1, bitDepth: 32 }));
    assert.ok(Math.abs(averaged.getFloat32(58, true) - 0.875 / 3) < 1e-7);
  });

  test('empty buffers, short channel data and fractional sample rates', () => {
    const empty = new DataView(encodeWav(audio([[]])));
    assert.equal(empty.byteLength, 44);
    assert.equal(empty.getUint32(40, true), 0);
    const short = { numberOfChannels: 1, sampleRate: 44100.4, length: 3, getChannelData: () => new Float32Array([1]) };
    const v = new DataView(encodeWav(short));
    assert.equal(v.getUint32(24, true), 44100);
    assert.deepEqual([0, 1, 2].map((i) => v.getInt16(44 + i * 2, true)), [32767, 0, 0]);
  });

  test('rejects formats it cannot write', () => {
    const ok = audio([[0]]);
    assert.throws(() => encodeWav(ok, { bitDepth: 8 }), /bitDepth must be 16, 24 or 32/);
    assert.throws(() => encodeWav(ok, { channels: 3 }), /channels must be 1 or 2/);
    assert.throws(() => encodeWav({ ...ok, numberOfChannels: 0 }), /numberOfChannels/);
    assert.throws(() => encodeWav({ ...ok, numberOfChannels: 33 }), /numberOfChannels/);
    assert.throws(() => encodeWav({ ...ok, numberOfChannels: 1.5 }), /numberOfChannels/);
    assert.throws(() => encodeWav({ ...ok, length: -1 }), /length/);
    assert.throws(() => encodeWav({ ...ok, length: 1.5 }), /length/);
    assert.throws(() => encodeWav({ ...ok, sampleRate: 0 }), RangeError);
    assert.throws(() => encodeWav({ ...ok, sampleRate: NaN }), /sampleRate/);
    assert.throws(() => encodeWav({ ...ok, sampleRate: 2 ** 32 }), /sampleRate/);
    const huge = { numberOfChannels: 2, sampleRate: 48000, length: 2 ** 30, getChannelData: () => assert.fail('read samples') };
    assert.throws(() => encodeWav(huge, { bitDepth: 32 }), /4 GiB/);
  });

  test('an independent decoder reads every bit depth back', async () => {
    const left = [0, 0.5, -0.5, 0.25];
    const right = [0.125, -1, 1, 0];
    for (const bitDepth of [16, 24, 32]) {
      const decoded = await decode(encodeWav(audio([left, right], 48000), { bitDepth }));
      assert.equal(decoded.numberOfChannels, 2);
      assert.equal(decoded.length, 4);
      const tolerance = bitDepth === 16 ? 1e-4 : 1e-6;
      const l = decoded.getChannelData(0);
      const r = decoded.getChannelData(1);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(l[i] - left[i]) < tolerance, `${bitDepth}-bit left[${i}] = ${l[i]}`);
        assert.ok(Math.abs(r[i] - right[i]) < tolerance, `${bitDepth}-bit right[${i}] = ${r[i]}`);
      }
    }
  });
});

describe('trimSilence', () => {
  // 1 kHz so one sample is one millisecond: a peak at 10, -40 dB until 500, then -80 dB to 1000.
  const signal = () => Array.from({ length: 1000 }, (_, i) => (i === 10 ? -1 : i < 500 ? 0.01 : 0.0001));

  test('cuts the tail below -60 dB relative to the peak and keeps 20 ms', () => {
    const source = audio([signal()], 1000);
    const trimmed = trimSilence(source);
    assert.equal(trimmed.length, 520);
    assert.equal(trimmed.sampleRate, 1000);
    assert.equal(trimmed.numberOfChannels, 1);
    assert.equal(trimmed.channels[0].length, 520);
    assert.equal(trimmed.getChannelData(0), trimmed.channels[0]);
    assert.ok(Math.abs(trimmed.channels[0][10] + 1) < 1e-7);
    const wav = new DataView(encodeWav(trimmed));
    assert.equal(wav.getUint32(40, true), 520 * 2, 'encodeWav accepts the result');
  });

  test('thresholdDb and padMs', () => {
    const source = audio([signal()], 1000);
    assert.equal(trimSilence(source, { thresholdDb: -30 }).length, 31);
    assert.equal(trimSilence(source, { padMs: 0 }).length, 500);
    assert.equal(trimSilence(source, { padMs: -5 }).length, 500, 'negative pad is none');
    assert.equal(trimSilence(source, { padMs: 5000 }).length, 1000, 'never longer than the source');
    assert.equal(trimSilence(source, { thresholdDb: 6, padMs: 0 }).length, 11, 'above 0 dB means the peak itself');
    assert.equal(trimSilence(source, { thresholdDb: NaN, padMs: Infinity }).length, 520, 'non-finite options fall back');
  });

  test('uses the latest audible sample across channels and copies the samples', () => {
    const left = new Array(100).fill(0);
    const right = new Array(100).fill(0);
    left[5] = 0.5;
    right[40] = 0.5;
    const source = audio([left, right], 1000);
    const trimmed = trimSilence(source, { padMs: 1 });
    assert.equal(trimmed.length, 42);
    assert.equal(trimmed.channels.length, 2);
    trimmed.channels[1][40] = 0;
    assert.equal(source.getChannelData(1)[40], 0.5);
  });

  test('silence keeps only the pad', () => {
    const trimmed = trimSilence(audio([new Array(100).fill(0)], 1000));
    assert.equal(trimmed.length, 20);
    assert.ok(trimmed.channels[0].every((s) => s === 0));
  });
});

describe('sfx-wav CLI', () => {
  const temp = () => mkdtempSync(join(tmpdir(), 'sfx-wav-'));
  const ctx = (extra = {}) => {
    const out = { logs: [], errors: [] };
    out.deps = { log: (m) => out.logs.push(m), error: (m) => out.errors.push(m), ...extra };
    return out;
  };
  const header = (file) => new DataView(bytes(file));

  test('--help prints usage and needs no audio module', async () => {
    for (const flag of ['--help', '-h']) {
      const io = ctx({ load: () => assert.fail('loaded audio') });
      assert.equal(await run([flag], io.deps), 0);
      assert.equal(io.logs[0], HELP);
      assert.match(HELP, /--combo/);
      assert.match(HELP, /npm install --save-dev node-web-audio-api/);
    }
  });

  test('renders sounds with the chosen format and prints a table', async () => {
    const dir = temp();
    try {
      const io = ctx();
      const code = await run(['--out', dir, '--sounds', 'tick, press', '--sample-rate=44100', '--bit-depth', '24', '--channels', '1'], io.deps);
      assert.equal(code, 0, io.errors.join('\n'));
      assert.deepEqual(readdirSync(dir).sort(), ['press.wav', 'tick.wav']);
      const v = header(join(dir, 'tick.wav'));
      assert.equal(v.getUint16(22, true), 1);
      assert.equal(v.getUint32(24, true), 44100);
      assert.equal(v.getUint16(34, true), 24);
      const frames = Math.ceil((duration('tick') + 0.1) * 44100);
      assert.equal(v.getUint32(40, true), frames * 3);
      const decoded = await decode(bytes(join(dir, 'tick.wav')), 44100);
      assert.equal(decoded.length, frames);
      const [table] = io.logs;
      assert.match(table, /^file\s+duration ms\s+peak dBFS$/m);
      assert.match(table, new RegExp(`^tick\\.wav\\s+${Math.round((frames / 44100) * 1000)}\\s+-\\d+\\.\\d$`, 'm'));
      assert.match(table, /^press\.wav\s+\d+\s+-\d+\.\d$/m);
      assert.match(table, /Wrote 2 files to /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--combo mixes sounds at their offsets into one file; --trim shortens it', async () => {
    const dir = temp();
    try {
      const io = ctx();
      const code = await run(['--out', dir, '--sounds', '', '--combo', 'tap=press@0,release@0.09', '--combo', 'double.tick=tick,tick@0.1'], io.deps);
      assert.equal(code, 0, io.errors.join('\n'));
      assert.deepEqual(readdirSync(dir).sort(), ['double.tick.wav', 'tap.wav']);
      const tap = await decode(bytes(join(dir, 'tap.wav')));
      assert.equal(tap.length, Math.ceil((0.09 + duration('release') + 0.1) * 48000));
      const left = tap.getChannelData(0);
      const energy = (from, to) => left.slice(Math.round(from * 48000), Math.round(to * 48000)).reduce((a, s) => Math.max(a, Math.abs(s)), 0);
      assert.ok(energy(0, 0.02) > 0.01, 'press at 0');
      assert.ok(energy(0.06, 0.089) < 1e-3, 'quiet between press and release');
      assert.ok(energy(0.09, 0.12) > 0.01, 'release at 90 ms');

      const trimmed = ctx();
      assert.equal(await run(['--out', dir, '--sounds', '', '--trim', '--combo', 'tap=press@0,release@0.09'], trimmed.deps), 0);
      const short = await decode(bytes(join(dir, 'tap.wav')));
      assert.ok(short.length < tap.length && short.length > 0.09 * 48000, `trimmed to ${short.length}`);
      assert.match(trimmed.logs[0], /Wrote 1 file to /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaults: every sound, stereo 16-bit 48 kHz, into ./sfx under the working directory', async () => {
    const dir = temp();
    try {
      const io = ctx({ cwd: dir });
      assert.equal(await run([], io.deps), 0, io.errors.join('\n'));
      assert.deepEqual(readdirSync(join(dir, 'sfx')).sort(), sounds.map((s) => `${s}.wav`).sort());
      const v = header(join(dir, 'sfx', 'chime.wav'));
      assert.deepEqual([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)], [2, 48000, 16]);
      assert.match(io.logs[0], new RegExp(`Wrote ${sounds.length} files`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runs with its real defaults (module loader, file system, console)', async (t) => {
    const dir = temp();
    const log = t.mock.method(console, 'log', () => {});
    try {
      assert.equal(await run(['--out', dir, '--sounds', 'tick']), 0);
      assert.ok(readFileSync(join(dir, 'tick.wav')).length > 44);
      assert.match(log.mock.calls[0].arguments[0], /tick\.wav/);
      const error = t.mock.method(console, 'error', () => {});
      assert.equal(await run(['--nope']), 2);
      assert.equal(error.mock.callCount(), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('bad input exits 2 with a message, before loading audio', async () => {
    const cases = [
      [['--nope'], /Unknown option/],
      [['extra'], /positional/],
      [['--out'], /argument missing/],
      [['--sample-rate', '100'], /--sample-rate must be/],
      [['--sample-rate', 'abc'], /--sample-rate must be/],
      [['--sample-rate', '44100.5'], /--sample-rate must be/],
      [['--bit-depth', '8'], /--bit-depth must be 16 or 24 or 32, got "8"/],
      [['--channels', '3'], /--channels must be 1 or 2/],
      [['--sounds', 'tick,nope'], /unknown sound "nope"/],
      [['--sounds', ' , '], /nothing to render/],
      [['--combo', 'tap'], /--combo needs name=sound@seconds/],
      [['--combo', '=press'], /--combo needs name/],
      [['--combo', '../tap=press'], /--combo needs name/],
      [['--combo', 'tap='], /--combo "tap"/],
      [['--combo', 'tap=nope@0'], /"nope@0" must be a sound name/],
      [['--combo', 'tap=press@'], /--combo "tap"/],
      [['--combo', 'tap=press@x'], /--combo "tap"/],
      [['--combo', 'tap=press@11'], /\(0-10\)/],
      [['--combo', 'tap=press@-1'], /\(0-10\)/],
      [['--sounds', 'tick', '--combo', 'tick=press'], /two outputs are named "tick"/],
      [['--sounds', 'tick', '--combo', 'TICK=payout'], /two outputs are named "TICK" \(names are compared ignoring case\)/],
      [['--sounds', '', '--combo', 'Tap=press', '--combo', 'tap=release'], /two outputs are named "tap"/],
    ];
    for (const [argv, message] of cases) {
      const io = ctx({ load: () => assert.fail('loaded audio') });
      assert.equal(await run(argv, io.deps), 2, argv.join(' '));
      assert.match(io.errors[0], message);
      assert.match(io.errors[0], /Run sfx-wav --help for usage\./);
    }
  });

  test('a missing node-web-audio-api exits 1 with an install hint', async () => {
    const io = ctx({
      load: async () => { throw Object.assign(new Error("Cannot find package 'node-web-audio-api'"), { code: 'ERR_MODULE_NOT_FOUND' }); },
      fs: { mkdir: () => assert.fail('touched the file system'), writeFile: () => assert.fail('wrote') },
    });
    assert.equal(await run(['--sounds', 'tick'], io.deps), 1);
    assert.match(io.errors[0], /optional peer dependency node-web-audio-api/);
    assert.match(io.errors[0], /Cannot find package/);
    assert.match(io.errors[0], /Install it with: npm install --save-dev node-web-audio-api/);
  });

  test('render and write failures exit 1', async () => {
    const dir = temp();
    try {
      class Broken { constructor() { this.currentTime = 0; } createGain() { throw new Error('no nodes'); } }
      const broken = ctx({ load: async () => ({ OfflineAudioContext: Broken }) });
      assert.equal(await run(['--out', dir, '--sounds', 'tick'], broken.deps), 1);
      assert.equal(broken.errors[0], 'sfx-wav: could not render "tick"');

      const file = join(dir, 'taken');
      writeFileSync(file, '');
      const blocked = ctx();
      assert.equal(await run(['--out', file, '--sounds', 'tick'], blocked.deps), 1);
      assert.match(blocked.errors[0], /^sfx-wav: \S+/);

      const odd = ctx({ fs: { mkdir: async () => {}, writeFile: async () => { throw 'disk full'; } } });
      assert.equal(await run(['--out', dir, '--sounds', 'tick'], odd.deps), 1);
      assert.equal(odd.errors[0], 'sfx-wav: disk full');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('silence reports -inf dBFS', async () => {
    const dir = temp();
    try {
      class Silent extends OfflineAudioContext {
        async startRendering() {
          return { numberOfChannels: 2, sampleRate: 48000, length: 480, getChannelData: () => new Float32Array(480) };
        }
      }
      const io = ctx({ load: async () => ({ OfflineAudioContext: Silent }) });
      assert.equal(await run(['--out', dir, '--sounds', 'tick', '--channels', '2'], io.deps), 0);
      assert.match(io.logs[0], /^tick\.wav\s+10\s+-inf$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the bin runs the CLI and sets the exit code', async () => {
    const bin = fileURLToPath(new URL('../bin/sfx-wav.mjs', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [bin, '--help']);
    assert.match(stdout, /Usage: sfx-wav/);
    await assert.rejects(promisify(execFile)(process.execPath, [bin, '--bit-depth', '8']), (error) => error.code === 2 && /--bit-depth/.test(error.stderr));
  });
});
