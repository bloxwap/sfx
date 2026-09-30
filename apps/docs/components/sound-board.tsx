'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX, Zap } from 'lucide-react';
import { getOutput, play, preload, setEnabled, setVolume, sounds, type SoundName } from '@bloxwap/sfx';
import { CopyButton } from './copy-button';
import { GROUPS, KEYS, describe } from '@/lib/catalog';

/** Keyboard key → sound, in pad order (QWERTY rows), so the board plays like a sampler. */
const KEY_TO_SOUND = new Map<string, SoundName>();
GROUPS.flatMap((group) => group.sounds).forEach((name, index) => { if (KEYS[index]) KEY_TO_SOUND.set(KEYS[index], name); });
const SOUND_TO_KEY = new Map([...KEY_TO_SOUND].map(([key, name]) => [name, key]));

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
  const [master, setMaster] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [pan, setPan] = useState(0);
  const [gain, setGain] = useState(1);
  const [sequence, setSequence] = useState(false);
  const [ready, setReady] = useState(false);
  const scope = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
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
        node.fftSize = 1024;
        output.connect(node);
        analyser.current = node;
      }
    }
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

  // Oscilloscope: draws only while sound is audible, then idles (no rAF when silent).
  useEffect(() => {
    const canvas = scope.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let frame = 0;
    let quiet = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const color = getComputedStyle(canvas).color;
    function draw() {
      frame = requestAnimationFrame(draw);
      if (!canvas || !context) return;
      const node = analyser.current;
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 2 * ratio;
      context.strokeStyle = color;
      context.beginPath();
      if (!node) {
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
        return;
      }
      data ??= new Uint8Array(node.fftSize);
      node.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        const x = (i / (data.length - 1)) * width;
        const y = (v / 255) * height;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
        peak = Math.max(peak, Math.abs(v - 128));
      }
      context.stroke();
      quiet = peak < 2 ? quiet + 1 : 0;
    }
    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
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
            key={`${name}-${flash[name] ?? 0}`}
            className={`pad${flash[name] ? ' pad--hit' : ''}${last === name ? ' pad--last' : ''}`}
            style={{ '--pad': group.color } as React.CSSProperties}
            onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); trigger(name); } }}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); trigger(name); } }}
            aria-label={`Play ${name}: ${describe(name)}`}
          >
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
