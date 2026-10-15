'use client';
import { useState } from 'react';
import { define, play, type Recipe, type ToneLayer } from '@bloxwap/sfx';
import { CopyButton } from './copy-button';

export function RecipeEditor() {
  const [freq, setFrequency] = useState(440);
  const [decay, setDecay] = useState(0.15);
  const [wave, setWave] = useState<ToneLayer['wave']>('sine');
  const recipe: Recipe = { level: 0.6, layers: [{ wave, freq, at: 0, attack: 0.006, decay, peak: 0.2 }] };
  const code = `import { define, play } from '@bloxwap/sfx';\n\ndefine('coin', ${JSON.stringify(recipe, null, 2)});\nplay('coin');`;
  return <section className="recipe-editor hig-surface hig-stack not-prose" aria-label="Recipe editor" data-hig-density="compact">
    <h2 className="hig-heading">Build a sound</h2>
    <div className="recipe-fields">
      <label className="hig-field">Wave
        <select className="hig-input" value={wave} onChange={event => setWave(event.target.value as ToneLayer['wave'])}>
          {(['sine', 'triangle', 'sawtooth', 'square'] as const).map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="hig-field"><span>Frequency <span className="hig-number">{freq} Hz</span></span>
        <input aria-label="Recipe frequency" type="range" min={80} max={2000} step={10} value={freq} onChange={event => setFrequency(Number(event.target.value))} />
      </label>
      <label className="hig-field"><span>Decay <span className="hig-number">{decay.toFixed(2)} s</span></span>
        <input aria-label="Recipe decay" type="range" min={0.02} max={1} step={0.01} value={decay} onChange={event => setDecay(Number(event.target.value))} />
      </label>
    </div>
    <div className="hig-inline">
      <button type="button" className="hig-button" onClick={() => { define('recipe-preview', recipe); play('recipe-preview'); }}>Preview sound</button>
      <CopyButton text={code} label="Copy recipe" />
    </div>
    <pre className="recipe-code" tabIndex={0} aria-label="Recipe source"><code>{code}</code></pre>
  </section>;
}
