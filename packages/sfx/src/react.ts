'use client';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { bind, type BindOptions } from './bind.js';
import { play, setEnabled as applyEnabled, setVolume as applyVolume, unlock, type PlayOptions } from './engine.js';
import { categories, type SoundCategory } from './recipes.js';
import { semanticPresets, type FeedbackIntent } from './semantic.js';
import type { SoundName } from './recipes.js';

const STORAGE_KEY = 'bloxwap:sfx';
const defaults: { enabled: boolean; volume: number; categoryVolumes?: Partial<Record<SoundCategory, number>> } = { enabled: true, volume: 1 };
let preference = defaults;
const listeners = new Set<() => void>();

export interface SoundPreference {
  enabled: boolean;
  volume: number;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  /** Persisted category multipliers; old master-volume records remain valid. */
  categoryVolumes?: Partial<Record<SoundCategory, number>>;
  setCategoryVolume(category: SoundCategory, volume: number): void;
}

function read(value: string | null): typeof defaults {
  try {
    const data = JSON.parse(value ?? 'null');
    if (typeof data?.enabled === 'boolean' && typeof data.volume === 'number' && Number.isFinite(data.volume)) {
      const categoryVolumes: Partial<Record<SoundCategory, number>> = {};
      for (const category of categories) {
        const value = data.categoryVolumes?.[category];
        if (typeof value === 'number' && Number.isFinite(value)) categoryVolumes[category] = Math.min(1, Math.max(0, value));
      }
      return { enabled: data.enabled, volume: Math.min(1, Math.max(0, data.volume)), ...(Object.keys(categoryVolumes).length ? { categoryVolumes } : {}) };
    }
  } catch { /* corrupted or inaccessible storage keeps the defaults */ }
  return defaults;
}

function update(next: typeof defaults): void {
  if (next.enabled === preference.enabled && next.volume === preference.volume && JSON.stringify(next.categoryVolumes) === JSON.stringify(preference.categoryVolumes)) return;
  preference = next;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key === STORAGE_KEY || event.key === null) update(read(event.newValue));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}

function save(next: typeof defaults): void {
  update(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage is optional */ }
}

const settings = {
  setCategoryVolume: (category: SoundCategory, volume: number): void => {
    if (categories.includes(category) && Number.isFinite(volume)) save({ ...preference, categoryVolumes: { ...preference.categoryVolumes, [category]: Math.min(1, Math.max(0, volume)) } });
  },
  setEnabled: (enabled: boolean): void => { save({ ...preference, enabled }); },
  setVolume: (volume: number): void => {
    if (Number.isFinite(volume)) save({ ...preference, volume: Math.min(1, Math.max(0, volume)) });
  },
};
function applyCategories(value: SoundPreference): void {
  for (const category of categories) applyVolume(value.categoryVolumes?.[category] ?? 1, { category });
}
const SoundContext = createContext<SoundPreference | null>(null);

function usePreferenceStore(): SoundPreference {
  const snapshot = useSyncExternalStore(subscribe, () => preference, () => defaults);
  useEffect(() => {
    try { update(read(localStorage.getItem(STORAGE_KEY))); } catch { /* private browsing */ }
  }, []);
  return useMemo(() => ({ ...snapshot, ...settings }), [snapshot]);
}

/** Shared mute/volume preferences, persisted after mount and synchronized across tabs. SSR-safe. */
export function useSoundPreference(): SoundPreference {
  const saved = usePreferenceStore();
  const context = useContext(SoundContext);
  const value = context ?? saved;
  useEffect(() => { applyEnabled(value.enabled); applyVolume(value.volume); applyCategories(value); }, [value.enabled, value.volume, value.categoryVolumes]);
  return value;
}

export interface SoundProviderProps {
  children?: ReactNode;
  /** Overrides the stored setting while mounted. Omit to use the persisted preference. */
  enabled?: boolean;
  volume?: number;
  /** Unlock on the first trusted pointer/key interaction. Default true; muted providers attach no listeners. */
  unlockOnInteraction?: boolean;
}

/** Mount one provider near the app root to control the shared audio engine. */
export function SoundProvider({ children, enabled, volume, unlockOnInteraction = true }: SoundProviderProps) {
  const saved = usePreferenceStore();
  const value = useMemo(() => ({ ...saved, enabled: enabled ?? saved.enabled, volume: volume ?? saved.volume }), [saved, enabled, volume]);
  useEffect(() => { applyEnabled(value.enabled); applyVolume(value.volume); applyCategories(value); }, [value.enabled, value.volume, value.categoryVolumes]);
  useEffect(() => () => { applyEnabled(preference.enabled); applyVolume(preference.volume); applyCategories({ ...preference, ...settings }); }, []);
  useEffect(() => {
    if (!unlockOnInteraction || !value.enabled || value.volume <= 0) return;
    const onInteraction = (event: Event): void => {
      if (event.isTrusted) void unlock();
    };
    document.addEventListener('pointerdown', onInteraction, { capture: true });
    document.addEventListener('keydown', onInteraction, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onInteraction, true);
      document.removeEventListener('keydown', onInteraction, true);
    };
  }, [unlockOnInteraction, value.enabled, value.volume]);
  return createElement(SoundContext.Provider, { value }, children);
}

/** Binds the mounted subtree and removes its listeners on unmount or when options change. */
export function useBindSounds(ref: RefObject<HTMLElement | null>, options: BindOptions = {}): void {
  const { keyboard, hoverInterval } = options;
  useEffect(() => {
    if (!ref.current) return;
    return bind(ref.current, { ...(keyboard === undefined ? {} : { keyboard }), ...(hoverInterval === undefined ? {} : { hoverInterval }) });
  }, [ref, keyboard, hoverInterval]);
}

/** A stable event handler for a sound, with optional per-call overrides. */
export function useSound(name: SoundName, options?: PlayOptions): (overrides?: PlayOptions) => void {
  return useCallback((overrides?: PlayOptions) => play(name, { ...options, ...overrides }), [name, options]);
}


export interface SoundHandlerOptions extends PlayOptions {
  disabled?: boolean;
  busy?: boolean;
  suppressed?: boolean;
}

/** Compose only onClick (keyboard clicks included), never both pointerdown and click.
 * The host runs first; cancellation, nested targets and disabled/busy state suppress sound.
 */
export function useSoundHandler<E extends SyntheticEvent>(name: SoundName, handler?: (event: E) => void, options: SoundHandlerOptions = {}): (event: E) => void {
  const preference = useSoundPreference();
  return useCallback((event: E) => {
    handler?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget && (event.target as Element).closest('button,a,input,select,[role="button"],[role="switch"]') !== event.currentTarget || options.disabled || options.busy || options.suppressed || !preference.enabled || preference.volume <= 0) return;
    play(name, options);
  }, [name, handler, options, preference.enabled, preference.volume]);
}

/** HIG semantic mapping; outcomes must be called after the operation completes.
 * Reduced motion is an explicit quieter preset, independent of saved mute/master volume.
 * HIG hosts should use their FeedbackController for deduplication and channel ownership.
 */
export function useSemanticSound(intent: FeedbackIntent, reducedMotion = false): () => void {
  const preference = useSoundPreference();
  return useCallback(() => {
    const preset = semanticPresets[intent];
    if (preset.sound && preference.enabled && preference.volume > 0) play(preset.sound, { minInterval: preset.cooldown, volume: reducedMotion ? 0.5 : 1 });
  }, [intent, reducedMotion, preference.enabled, preference.volume]);
}
