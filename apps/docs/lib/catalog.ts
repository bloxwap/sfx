import type { SoundName } from '@bloxwap/sfx';

/** Sound board groups, in the order pads are laid out (and keyboard keys assigned). */
export const GROUPS: { title: string; color: string; sounds: SoundName[] }[] = [
  { title: 'Hover and ambience', color: 'var(--bloxwap-blue)', sounds: ['chime', 'sparkle', 'droplet', 'bloom', 'whisper'] },
  { title: 'Controls', color: 'var(--bloxwap-green)', sounds: ['tick', 'press', 'release', 'toggle', 'page'] },
  { title: 'Feedback', color: 'var(--bloxwap-yellow)', sounds: ['success', 'error', 'loading', 'ready', 'notification'] },
  { title: 'Money', color: 'var(--bloxwap-pink)', sounds: ['payout', 'deposit', 'pluck', 'loss'] },
];

/** Keyboard shortcuts for the pads, left to right, top to bottom. */
export const KEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b', 'y', 'u', 'i', 'o'];

const DESCRIPTIONS: Record<SoundName, [character: string, useFor: string]> = {
  chime: ['Soft rising two-note bell', 'Default hover'],
  sparkle: ['Quick four-note twinkle', 'Playful accents'],
  droplet: ['Single note gliding down', 'Dismiss, collapse'],
  bloom: ['Warm slow swell', 'Reveal, expand'],
  whisper: ['Breathy quiet texture', 'Dense lists'],
  tick: ['Crisp instant tick', 'Navigation hover'],
  press: ['Dull muted knock', 'Pointer down'],
  release: ['Bright springy tick', 'Pointer up'],
  toggle: ['Mechanical click-clack', 'Switches, tabs'],
  success: ['Warm three-note confirmation', 'Completed actions'],
  error: ['Soft descending refusal', 'Recoverable errors'],
  page: ['Papery flick and glass tick', 'Pages, carousels'],
  loading: ['Brief unresolved rise', 'Work starting'],
  ready: ['Focus tick and open fifth', 'Content ready'],
  payout: ['Deep two-stage coin', 'Payouts, rewards'],
  deposit: ['Wide metallic shimmer', 'Deposits, credits'],
  pluck: ['Tight falling pluck', 'Pickups, selections'],
  notification: ['Bright physical bell', 'Messages, activity'],
  loss: ['Heavy two-stage fall', 'Losses, negative outcomes'],
};

export function describe(name: SoundName): string {
  return DESCRIPTIONS[name][0];
}

export function useFor(name: SoundName): string {
  return DESCRIPTIONS[name][1];
}
