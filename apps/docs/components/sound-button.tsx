'use client';

import { Play } from 'lucide-react';
import { play, type SoundName } from '@bloxwap/sfx';

/** An inline "listen" button for the docs: <SoundButton name="payout" />. */
export function SoundButton({ name, label }: { name: SoundName; label?: string }) {
  return <button type="button" className="sound-button not-prose" onClick={() => play(name)} aria-label={`Play ${name}`}>
    <Play aria-hidden="true" />
    <code>{label ?? name}</code>
  </button>;
}
