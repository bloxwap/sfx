
/** Pinned to bloxwap/hig main; async outcomes are separate from accepted activation.
 * Motion never implicitly enables/disables sound. Reduced mode halves per-play gain.
 */
export const semanticSource = { version: 'hig-0.1.0', repository: 'https://github.com/bloxwap/hig', commit: '1a776b9326c6ba03702894943b3edbfd178c4b40' } as const;
export const semanticPresets = {
  press: { sound: null, cooldown: 0 },
  activate: { sound: 'tick', cooldown: 80 },
  release: { sound: null, cooldown: 0 },
  cancel: { sound: null, cooldown: 0 },
  selection: { sound: 'tick', cooldown: 80 },
  toggle: { sound: 'toggle', cooldown: 80 },
  disclosure: { sound: null, cooldown: 120 },
  success: { sound: 'success', cooldown: 400 },
  warning: { sound: null, cooldown: 400 },
  error: { sound: 'error', cooldown: 400 },
  notification: { sound: null, cooldown: 800 },
} as const;
export type FeedbackIntent = 'press' | 'activate' | 'release' | 'cancel' | 'selection' | 'toggle' | 'disclosure' | 'success' | 'warning' | 'error' | 'notification';
export const approvedCues = ['tick', 'toggle', 'success', 'error'] as const;
