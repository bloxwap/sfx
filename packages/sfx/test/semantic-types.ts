import { approvedCues, semanticPresets, type FeedbackIntent } from '../dist/semantic.js';

type Presets = Record<FeedbackIntent, { sound: (typeof approvedCues)[number] | null; cooldown: number }>;

// Keep the negative fixture in tsconfig.dev.json's checked test directory.
export const unapprovedPresets = {
  ...semanticPresets,
  // @ts-expect-error loss is a built-in sound, but is not an approved semantic cue
  warning: { sound: 'loss', cooldown: 400 },
} as const satisfies Presets;
