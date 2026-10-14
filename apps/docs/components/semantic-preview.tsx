'use client';
import { useState } from 'react';
import { categories } from '@bloxwap/sfx';
import { useSoundPreference, useSoundHandler, useSemanticSound } from '@bloxwap/sfx/react';

export function SemanticPreview() {
  const preference = useSoundPreference();
  const [reduced, setReduced] = useState(false);
  const [message, setMessage] = useState('Ready');
  const activate = useSoundHandler('tick', () => setMessage('Action accepted'));
  const success = useSemanticSound('success', reduced);
  return <section className="hig-surface hig-stack" aria-label="Semantic feedback preview">
    <h2>Sound preferences and semantic preview</h2>
    <p>Web Audio preview. Physical output is not verified on this device. Haptics remain independently owned by your host.</p>
    <label className="hig-choice"><input type="checkbox" checked={preference.enabled} onChange={e => preference.setEnabled(e.target.checked)} /> Enable sound</label>
    <label className="hig-field">Sound volume<input type="range" min={0} max={1} step={0.01} value={preference.volume} onChange={e => preference.setVolume(Number(e.target.value))} /></label>
    {categories.map(category => <label className="hig-field" key={category}>{category} volume<input aria-label={`${category} volume`} type="range" min={0} max={1} step={0.01} value={preference.categoryVolumes?.[category] ?? 1} onChange={e => preference.setCategoryVolume(category, Number(e.target.value))} /></label>)}
    <label className="hig-choice"><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /> Quieter reduced-motion sound preset (independent of animation)</label>
    <div className="hig-inline"><button className="hig-button" onClick={activate}>Accept action</button><button className="hig-button" onClick={() => { setMessage('Operation completed'); success(); }}>Preview completed outcome</button></div>
    <p role="status">{message}</p>
  </section>;
}
