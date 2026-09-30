'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX, Zap } from 'lucide-react';
import { getOutput, play, preload, setEnabled, setVolume, sounds, type SoundName } from '@bloxwap/sfx';
import { CopyButton } from './copy-button';
import { GROUPS, KEYS, describe } from '@/lib/catalog';

/** Keyboard key → sound, in pad order (QWERTY rows), so the board plays like a sampler. */
const KEY_TO_SOUND = new Map<string, SoundName>();
GROUPS.flatMap((group) => group.sounds).forEach((name, index) => { if (KEYS[index]) KEY_TO_SOUND.set(KEYS[index], name); });
const SOUND_TO_KEY = new Map([...KEY_TO_SOUND].map(([key, name]) => [name, key]));

/** Point cloud: log-spaced frequency bands × frames of history, and the fixed camera angle (radians). */
const CLOUD_COLS = 64;
const CLOUD_ROWS = 48;
const CLOUD_VIEW = { yaw: -0.1, pitch: 0.35 };

/** Slider defaults; Reset returns every slider here. */
const DEFAULTS = { master: 0.8, gain: 1, rate: 1, pan: 0 };

function snippet(name: SoundName, volume: number, rate: number, pan: number): string {
  const options = [
    volume !== 1 && `volume: ${volume}`,
    rate !== 1 && `rate: ${rate}`,
    pan !== 0 && `pan: ${pan}`,
  ].filter(Boolean);
  return `play('${name}'${options.length ? `, { ${options.join(', ')} }` : ''});`;
}

export function SoundBoard() {
  const [last, setLast] = useState<SoundName>('chime');
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [master, setMaster] = useState(DEFAULTS.master);
  const [muted, setMuted] = useState(false);
  const [hoverPlay, setHoverPlay] = useState(false);
  const [rate, setRate] = useState(DEFAULTS.rate);
  const [pan, setPan] = useState(DEFAULTS.pan);
  const [gain, setGain] = useState(DEFAULTS.gain);
  const changed = master !== DEFAULTS.master || gain !== DEFAULTS.gain || rate !== DEFAULTS.rate || pan !== DEFAULTS.pan;

  function reset() {
    setMaster(DEFAULTS.master);
    setGain(DEFAULTS.gain);
    setRate(DEFAULTS.rate);
    setPan(DEFAULTS.pan);
  }
  const [sequence, setSequence] = useState(false);
  const [ready, setReady] = useState(false);
  const scope = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const wakeScope = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => { setVolume(master); }, [master]);
  useEffect(() => { setEnabled(!muted); }, [muted]);

  const trigger = useCallback((name: SoundName) => {
    play(name, { volume: gain, rate, pan });
    setLast(name);
    setFlash((current) => ({ ...current, [name]: (current[name] ?? 0) + 1 }));
    // The master output exists once the first sound has created the audio context.
    if (!analyser.current) {
      const output = getOutput();
      if (output) {
        const node = output.context.createAnalyser();
        node.fftSize = 2048;
        output.connect(node);
        analyser.current = node;
      }
    }
    wakeScope.current?.();
  }, [gain, rate, pan]);

  // Render all sounds ahead of time after the first gesture, so every later play is one buffer node.
  const warm = useCallback(() => {
    if (ready) return;
    preload().then(() => setReady(true), () => {});
  }, [ready]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const name = KEY_TO_SOUND.get(event.key.toLowerCase());
      if (!name) return;
      event.preventDefault();
      warm();
      trigger(name);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trigger, warm]);

  // Point cloud: a spectrum waterfall drawn in perspective. Runs only while sound is audible, then
  // idles on a flat grid (no rAF when silent).
  useEffect(() => {
    const canvas = scope.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const color = getComputedStyle(canvas).color;
    const history = new Float32Array(CLOUD_COLS * CLOUD_ROWS);
    let head = 0;
    let frame = 0;
    let quiet = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let edges: Int32Array | null = null;

    // Pushes one row of log-spaced band peaks (60 Hz–16 kHz) and returns the loudest band.
    function sample(node: AnalyserNode): number {
      bins ??= new Uint8Array(node.frequencyBinCount);
      if (!edges) {
        const binHz = node.context.sampleRate / 2 / node.frequencyBinCount;
        edges = new Int32Array(CLOUD_COLS + 1);
        for (let c = 0; c <= CLOUD_COLS; c++) {
          const bin = Math.floor((60 * (16000 / 60) ** (c / CLOUD_COLS)) / binHz);
          edges[c] = Math.min(Math.max(bin, c ? edges[c - 1] + 1 : 0), node.frequencyBinCount);
        }
      }
      node.getByteFrequencyData(bins);
      head = (head + 1) % CLOUD_ROWS;
      const row = head * CLOUD_COLS;
      let loudest = 0;
      for (let c = 0; c < CLOUD_COLS; c++) {
        let peak = 0;
        for (let b = edges[c]; b < edges[c + 1]; b++) peak = Math.max(peak, bins[b]);
        const level = (peak / 255) ** 1.4;
        history[row + c] = level;
        loudest = Math.max(loudest, level);
      }
      return loudest;
    }

    function render() {
      if (!canvas || !context) return;
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      const cosYaw = Math.cos(CLOUD_VIEW.yaw), sinYaw = Math.sin(CLOUD_VIEW.yaw);
      const cosPitch = Math.cos(CLOUD_VIEW.pitch), sinPitch = Math.sin(CLOUD_VIEW.pitch);
      // Fit the front row to the width, and the front peaks plus the grid's front edge to the height.
      const focal = Math.min(width * 0.8, height * 2.4);
      const horizon = height * 0.9 - focal * 0.112;
      // Oldest row (back) first, so nearer points paint over farther ones.
      for (let age = CLOUD_ROWS - 1; age >= 0; age--) {
        const row = ((head - age + CLOUD_ROWS) % CLOUD_ROWS) * CLOUD_COLS;
        const z = (age / (CLOUD_ROWS - 1)) * 2 - 1;
        const fade = 1 - (age / CLOUD_ROWS) * 0.75;
        for (let c = 0; c < CLOUD_COLS; c++) {
          const level = history[row + c];
          const x = ((c / (CLOUD_COLS - 1)) * 2 - 1) * 1.8;
          const y = level * 1.3;
          const rx = x * cosYaw + z * sinYaw;
          const rz = z * cosYaw - x * sinYaw;
          const ry = y * cosPitch + rz * sinPitch;
          const depth = 4 + rz * cosPitch - y * sinPitch;
          const scale = focal / depth;
          const size = Math.max(ratio, scale * (0.012 + level * 0.02));
          context.globalAlpha = Math.min(1, (0.32 + level * 0.9) * fade);
          context.fillRect(width / 2 + rx * scale - size / 2, horizon - ry * scale - size / 2, size, size);
        }
      }
      context.globalAlpha = 1;
    }

    function tick() {
      frame = 0;
      const node = analyser.current;
      const loudest = node ? sample(node) : 0;
      render();
      quiet = loudest > 0.002 ? 0 : quiet + 1;
      // Keep scrolling until the last audible row has left the back of the cloud.
      if (quiet < CLOUD_ROWS) frame = requestAnimationFrame(tick);
    }
    function wake() {
      quiet = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    }
    wakeScope.current = wake;

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      render();
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      wakeScope.current = null;
    };
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  function playAll() {
    timers.current.forEach(clearTimeout);
    if (sequence) { timers.current = []; setSequence(false); return; }
    warm();
    setSequence(true);
    const all = GROUPS.flatMap((group) => group.sounds);
    timers.current = all.map((name, index) => window.setTimeout(() => {
      trigger(name);
      if (index === all.length - 1) setSequence(false);
    }, index * 650));
  }

  return <div className="board" onPointerDownCapture={warm}>
    <div className="board-toolbar">
      <canvas ref={scope} className="board-scope" aria-hidden="true" />
      <div className="board-controls">
        <label className="board-slider"><span>Master</span><input type="range" min={0} max={1} step={0.01} value={master} onChange={(e) => setMaster(Number(e.target.value))} aria-label="Master volume" /><output>{Math.round(master * 100)}%</output></label>
        <label className="board-slider"><span>Voice</span><input type="range" min={0} max={1.5} step={0.05} value={gain} onChange={(e) => setGain(Number(e.target.value))} aria-label="Per-sound volume" /><output>{gain.toFixed(2)}</output></label>
        <label className="board-slider"><span>Rate</span><input type="range" min={0.5} max={2} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback rate" /><output>{rate.toFixed(2)}×</output></label>
        <label className="board-slider"><span>Pan</span><input type="range" min={-1} max={1} step={0.1} value={pan} onChange={(e) => setPan(Number(e.target.value))} aria-label="Stereo pan" /><output>{pan > 0 ? 'R' : pan < 0 ? 'L' : 'C'}{pan ? Math.abs(pan).toFixed(1) : ''}</output></label>
        <div className="board-buttons">
          <button type="button" className="btn btn--secondary btn--sm" onClick={playAll}>{sequence ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{sequence ? 'Stop' : 'Play all'}</button>
          <button type="button" className="btn btn--secondary btn--sm" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{muted ? 'Muted' : 'Sound on'}</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reset} disabled={!changed} title="Reset master, voice, rate and pan to their defaults"><RotateCcw aria-hidden="true" />Reset</button>
          <label className="board-switch">
            <button type="button" role="switch" aria-checked={hoverPlay} onClick={() => setHoverPlay((on) => !on)}><i /></button>
            Play on hover
          </label>
          <span className="board-status" title="Sounds are rendered once, then every play is a single buffer node"><Zap aria-hidden="true" />{ready ? 'Pre-rendered' : 'Live synth'}</span>
        </div>
      </div>
    </div>
    <div className="board-groups">
      {GROUPS.map((group) => <section key={group.title} className="board-group" aria-label={group.title}>
        <h3>{group.title}</h3>
        <div className="board-pads">
          {group.sounds.map((name) => <button
            type="button"
            key={name}
            className={`pad${last === name ? ' pad--last' : ''}`}
            style={{ '--pad': group.color } as React.CSSProperties}
            onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); trigger(name); } }}
            onPointerEnter={(event) => { if (hoverPlay && event.pointerType === 'mouse' && event.buttons === 0) trigger(name); }}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); trigger(name); } }}
            aria-label={`Play ${name}: ${describe(name)}`}
          >
            {flash[name] ? <span key={flash[name]} className="pad-flash" aria-hidden="true" /> : null}
            <span className="pad-name">{name}</span>
            <span className="pad-description">{describe(name)}</span>
            {SOUND_TO_KEY.has(name) && <kbd className="pad-key">{SOUND_TO_KEY.get(name)!.toUpperCase()}</kbd>}
          </button>)}
        </div>
      </section>)}
    </div>
    <div className="board-snippet">
      <code>{snippet(last, gain, rate, pan)}</code>
      <CopyButton text={snippet(last, gain, rate, pan)} label="Copy play call" />
    </div>
    <p className="board-hint">Tip: press the keys on the pads to play the board from your keyboard. {sounds.length} sounds, no audio files.</p>
  </div>;
}
