/**
 * WAV export, so native apps can bundle files rendered from the same recipes. Pure and
 * dependency-free: runs in browsers and Node, and is kept out of the main entry (import "@bloxwap/sfx/wav").
 */

/** Anything shaped like an AudioBuffer: a Web Audio buffer, or the result of trimSilence(). */
export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  /** Sample frames per channel. */
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

/** Output format for encodeWav(). */
export interface WavOptions {
  /** 16 or 24 for integer PCM, 32 for IEEE float. Default 16. */
  bitDepth?: 16 | 24 | 32;
  /** 1 averages every channel into mono; 2 copies a mono source to both sides or keeps the first two. Default: the buffer's. */
  channels?: 1 | 2;
}

/** Options for trimSilence(). */
export interface TrimOptions {
  /** Audio this far below the peak counts as silence. Default -60 (dB). */
  thresholdDb?: number;
  /** Milliseconds kept after the last audible sample. Default 20. */
  padMs?: number;
}

/** Trimmed audio: plain channel arrays that also satisfy AudioBufferLike. */
export interface TrimmedAudio extends AudioBufferLike {
  readonly channels: Float32Array[];
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Encodes audio as a RIFF/WAVE file: little-endian, interleaved, samples clamped to [-1, 1]. 16/24-bit
 * are integer PCM (format 1); 32-bit is IEEE float (format 3, with the fact chunk the spec requires).
 * Throws a RangeError for an invalid format or a buffer too large for WAV's 4 GiB limit.
 */
export function encodeWav(buffer: AudioBufferLike, options: WavOptions = {}): ArrayBuffer {
  const { numberOfChannels: sources, length: frames } = buffer;
  const bitDepth = options.bitDepth ?? 16;
  const channels = options.channels ?? sources;
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) throw new RangeError(`bitDepth must be 16, 24 or 32, got ${bitDepth}`);
  if (options.channels !== undefined && channels !== 1 && channels !== 2) throw new RangeError(`channels must be 1 or 2, got ${channels}`);
  if (!Number.isInteger(sources) || sources < 1 || sources > 32) throw new RangeError(`numberOfChannels must be 1–32, got ${sources}`);
  if (!Number.isInteger(frames) || frames < 0) throw new RangeError(`length must be a whole number of frames, got ${frames}`);
  const bytes = bitDepth / 8;
  const blockAlign = channels * bytes;
  const sampleRate = Math.round(buffer.sampleRate);
  if (!(sampleRate >= 1 && sampleRate * blockAlign <= 0xffffffff)) throw new RangeError(`sampleRate out of range: ${buffer.sampleRate}`);
  const float = bitDepth === 32;
  const fmtSize = float ? 18 : 16;
  // RIFF + fmt + (float: fact) + data chunk headers: 44 bytes for PCM, 58 for float.
  const header = 12 + 8 + fmtSize + (float ? 12 : 0) + 8;
  const dataSize = frames * blockAlign;
  // Chunks are word aligned: an odd-sized data chunk (24-bit mono, odd length) gets a pad byte.
  const pad = dataSize & 1;
  if (header - 8 + dataSize + pad > 0xffffffff) throw new RangeError('audio is too long for a WAV file (4 GiB limit)');

  const inputs = Array.from({ length: sources }, (_, c) => buffer.getChannelData(c));
  const reads: ((i: number) => number)[] =
    channels === 1 && sources > 1
      ? [(i) => { let sum = 0; for (const data of inputs) sum += data[i] as number; return sum / sources; }]
      : Array.from({ length: channels }, (_, c) => {
          const data = inputs[Math.min(c, sources - 1)] as Float32Array;
          return (i: number) => data[i] as number;
        });

  const out = new ArrayBuffer(header + dataSize + pad);
  const view = new DataView(out);
  let p = 0;
  const text = (value: string) => { for (let i = 0; i < 4; i++) view.setUint8(p++, value.charCodeAt(i)); };
  const u16 = (value: number) => { view.setUint16(p, value, true); p += 2; };
  const u32 = (value: number) => { view.setUint32(p, value, true); p += 4; };
  text('RIFF'); u32(header - 8 + dataSize + pad); text('WAVE');
  text('fmt '); u32(fmtSize); u16(float ? 3 : 1); u16(channels); u32(sampleRate); u32(sampleRate * blockAlign);
  u16(blockAlign); u16(bitDepth);
  if (float) { u16(0); text('fact'); u32(4); u32(frames); }
  text('data'); u32(dataSize);

  for (let i = 0; i < frames; i++) {
    for (const read of reads) {
      const x = read(i);
      // NaN (and a short channel's missing samples) become silence.
      const s = x > 1 ? 1 : x < -1 ? -1 : x || 0;
      if (float) {
        view.setFloat32(p, s, true);
      } else {
        // Asymmetric scaling so -1 and 1 hit the integer range's ends exactly.
        const v = Math.round(s < 0 ? s * 2 ** (bitDepth - 1) : s * (2 ** (bitDepth - 1) - 1));
        if (bitDepth === 16) view.setInt16(p, v, true);
        else { view.setUint8(p, v & 255); view.setUint8(p + 1, (v >> 8) & 255); view.setUint8(p + 2, (v >> 16) & 255); }
      }
      p += bytes;
    }
  }
  return out;
}

/**
 * Cuts the tail once audio stays below `thresholdDb` relative to the buffer's peak, keeping `padMs`
 * after the last audible sample. Never lengthens the buffer; copies the kept samples.
 */
export function trimSilence(buffer: AudioBufferLike, options: TrimOptions = {}): TrimmedAudio {
  const { numberOfChannels, sampleRate, length } = buffer;
  const data = Array.from({ length: numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let peak = 0;
  for (const samples of data) {
    for (let i = 0; i < length; i++) {
      const a = Math.abs(samples[i] as number);
      if (a > peak) peak = a;
    }
  }
  const threshold = peak * 10 ** (Math.min(0, finite(options.thresholdDb, -60)) / 20);
  let end = 0;
  if (peak > 0) {
    for (const samples of data) {
      for (let i = length - 1; i >= end; i--) {
        if (Math.abs(samples[i] as number) >= threshold) { end = i + 1; break; }
      }
    }
  }
  const kept = Math.min(length, end + Math.round((Math.max(0, finite(options.padMs, 20)) * sampleRate) / 1000));
  const channels = data.map((samples) => samples.slice(0, kept));
  return { channels, sampleRate, length: kept, numberOfChannels: channels.length, getChannelData: (c) => channels[c] as Float32Array };
}
