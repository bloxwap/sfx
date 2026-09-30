'use client';
import { createContext, createElement, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { bind, type BindOptions } from './bind.js';
import { play, setEnabled as applyEnabled, setVolume as applyVolume, type PlayOptions } from './engine.js';
import type { SoundName } from './recipes.js';

const STORAGE_KEY = 'bloxwap:sfx';
const defaults = { enabled: true, volume: 1 };
let preference = defaults;
const listeners = new Set<() => void>();

export interface SoundPreference {
  enabled: boolean;
  volume: number;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
}

function read(value: string | null): typeof defaults {
  try {
    const data = JSON.parse(value ?? 'null');
    if (typeof data?.enabled === 'boolean' && typeof data.volume === 'number' && Number.isFinite(data.volume)) {
      return { enabled: data.enabled, volume: Math.min(1, Math.max(0, data.volume)) };
    }
  } catch { /* corrupted or inaccessible storage keeps the defaults */ }
  return defaults;
}

function update(next: typeof defaults): void {
  if (next.enabled === preference.enabled && next.volume === preference.volume) return;
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
  setEnabled: (enabled: boolean): void => { save({ ...preference, enabled }); },
  setVolume: (volume: number): void => {
    if (Number.isFinite(volume)) save({ ...preference, volume: Math.min(1, Math.max(0, volume)) });
  },
};
const SoundContext = createContext<SoundPreference | null>(null);

function usePreferenceStore(): SoundPreference {
  const snapshot = useSyncExternalStore(subscribe, () => preference, () => defaults);
  useEffect(() => {
    try { update(read(localStorage.getItem(STORAGE_KEY))); } catch { /* private browsing */ }
  }, []);
  return { ...snapshot, ...settings };
}

/** Shared mute/volume preferences, persisted after mount and synchronized across tabs. SSR-safe. */
export function useSoundPreference(): SoundPreference {
  const saved = usePreferenceStore();
  const context = useContext(SoundContext);
  const value = context ?? saved;
  useEffect(() => { applyEnabled(value.enabled); applyVolume(value.volume); }, [value.enabled, value.volume]);
  return value;
}

export interface SoundProviderProps {
  children?: ReactNode;
  /** Overrides the stored setting while mounted. Omit to use the persisted preference. */
  enabled?: boolean;
  volume?: number;
}

/** Mount one provider near the app root to control the shared audio engine. */
export function SoundProvider({ children, enabled, volume }: SoundProviderProps) {
  const saved = usePreferenceStore();
  const value = { ...saved, enabled: enabled ?? saved.enabled, volume: volume ?? saved.volume };
  useEffect(() => { applyEnabled(value.enabled); applyVolume(value.volume); }, [value.enabled, value.volume]);
  useEffect(() => () => { applyEnabled(preference.enabled); applyVolume(preference.volume); }, []);
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
