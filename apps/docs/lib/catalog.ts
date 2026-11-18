import { categories, categoryOf, sounds, type BuiltinSoundName, type SoundCategory } from '@bloxwap/sfx';
export { version as packageVersion } from '@bloxwap/sfx/package.json';

/** Sound board groups, in the order pads are laid out (and keyboard keys assigned). */
const groupDetails: Record<SoundCategory, { title: string; color: string }> = {
  hover: { title: 'Hover and ambience', color: 'var(--bloxwap-blue)' },
  controls: { title: 'Controls', color: 'var(--bloxwap-green)' },
  feedback: { title: 'Feedback', color: 'var(--bloxwap-yellow)' },
  money: { title: 'Money', color: 'var(--bloxwap-pink)' },
};
export const GROUPS = categories.map(category => ({ ...groupDetails[category], sounds: sounds.filter(name => categoryOf(name) === category) }));

/** Keyboard shortcuts for the pads, left to right, top to bottom. */
export const KEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b', 'p', 'y', 'u', 'i', 'o', 'h', 'j', 'k', 'l', 'n', 'm'];
if (KEYS.length < sounds.length || new Set(KEYS).size !== KEYS.length) throw new Error('Each catalog sound needs a unique keyboard shortcut');

const DESCRIPTIONS: Record<BuiltinSoundName, [character: string, useFor: string]> = {
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
  'block-break': ['Dry crack and scattered bright ticks', 'A line breaking through a block'],
};

export function describe(name: BuiltinSoundName): string {
  return DESCRIPTIONS[name][0];
}

export function useFor(name: BuiltinSoundName): string {
  return DESCRIPTIONS[name][1];
}
