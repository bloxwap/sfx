'use client';

import { useEffect, useRef, useState } from 'react';
import { bind, play } from '@bloxwap/sfx';

/**
 * A small product UI wired entirely with data-sound-* attributes and one bind() call, scoped to
 * this card. The only imperative plays are the async outcomes (deposit success / error).
 */
export function BindDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(true);
  const [alerts, setAlerts] = useState(false);
  const [amount, setAmount] = useState('250');
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'failed'>('idle');
  const [tab, setTab] = useState('Overview');

  useEffect(() => {
    if (!root.current) return;
    return bind(root.current);
  }, []);

  function deposit() {
    const value = Number(amount);
    setStatus('pending');
    play('loading');
    window.setTimeout(() => {
      if (Number.isFinite(value) && value > 0 && value <= 10_000) {
        setStatus('done');
        play('deposit');
      } else {
        setStatus('failed');
        play('error');
      }
    }, 700);
  }

  return <div ref={root} className="demo-app">
    <nav className="demo-tabs" aria-label="Demo tabs">
      {['Overview', 'Activity', 'Settings'].map((name) => <button
        key={name} type="button" data-sound-hover="tick" data-sound-press="page"
        aria-pressed={tab === name} onClick={() => setTab(name)}
      >{name}</button>)}
    </nav>
    <div className="demo-grid">
      <div className="demo-card">
        <h3>Deposit</h3>
        <p>Amounts from 1 to 10,000 succeed. Try 0 or 20000 to hear the error.</p>
        <div className="demo-row">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Deposit amount" data-sound-press="tick" />
          <button type="button" className="btn btn--sm" data-sound-press data-sound-release onClick={deposit} disabled={status === 'pending'}>
            {status === 'pending' ? 'Depositing…' : 'Deposit'}
          </button>
        </div>
        <p className={`demo-status demo-status--${status}`} role="status">
          {status === 'done' ? `Deposited $${amount}.` : status === 'failed' ? 'Enter an amount from 1 to 10,000.' : status === 'pending' ? 'Waiting for confirmation…' : ' '}
        </p>
      </div>
      <div className="demo-card">
        <h3>Preferences</h3>
        <label className="demo-switch"><span>Dark mode</span>
          <button type="button" role="switch" aria-checked={dark} data-sound-toggle onClick={() => setDark((d) => !d)}><i /></button>
        </label>
        <label className="demo-switch"><span>Price alerts</span>
          <button type="button" role="switch" aria-checked={alerts} data-sound-toggle onClick={() => { setAlerts((a) => !a); if (!alerts) play('notification'); }}><i /></button>
        </label>
        <div className="demo-row">
          <button type="button" className="btn btn--secondary btn--sm" data-sound-hover="whisper" data-sound-press="press" data-sound-release="release">Hover me</button>
          <button type="button" className="btn btn--secondary btn--sm" data-sound-press disabled>Disabled</button>
        </div>
      </div>
    </div>
    <p className="demo-caption">Everything above is wired with <code>data-sound-*</code> attributes and a single <code>bind(root)</code> call.</p>
  </div>;
}
