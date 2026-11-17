'use client';
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { BindOptions } from './bind.js';
import type { PlayOptions } from './engine.js';
import { categories, type SoundCategory, type SoundName } from './recipes.js';
import { semanticPresets, type FeedbackIntent } from './semantic.js';
import { defaults, getPreference, getSavedPreference, restorePreference, subscribePreference, subscribeSavedPreference, overridePreference, setEnabled, setVolume, type Preference } from './preferences.js';

const STORAGE_KEY = 'bloxwap:sfx';
export interface SoundPreference extends Preference {
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  setCategoryVolume(category: SoundCategory, volume: number): void;
}
function read(value: string | null): Preference {
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


let persistenceUsers = 0;
let disconnectPersistence: () => void;
/** Hydrate once per mounted app, then keep both imperative and React writes in the same store. */
function persist(): () => void {
  if (persistenceUsers++ === 0) {
    try { restorePreference(read(localStorage.getItem(STORAGE_KEY))); } catch { /* storage is optional */ }
    let reading = false;
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      reading = true;
      try { restorePreference(read(event.newValue)); } finally { reading = false; }
    };
    const unsubscribe = subscribeSavedPreference(() => {
      if (!reading) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getSavedPreference())); } catch { /* private browsing */ } }
    });
    window.addEventListener('storage', onStorage);
    disconnectPersistence = () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }
  return () => { if (--persistenceUsers === 0) disconnectPersistence(); };
}
const settings = {
  setEnabled,
  setVolume: (volume: number): void => setVolume(volume),
  setCategoryVolume: (category: SoundCategory, volume: number): void => setVolume(volume, { category }),
};
export interface SoundProviderProps {
  children?: ReactNode;
  /** Overrides saved preferences while mounted. Later mounted providers have precedence. */
  enabled?: boolean;
  volume?: number;
  unlockOnInteraction?: boolean;
}
export interface SoundHandlerOptions extends PlayOptions { disabled?: boolean; busy?: boolean; suppressed?: boolean }
export interface SoundEvent { defaultPrevented: boolean; target: unknown; currentTarget: unknown }
const CONTROLS = 'button,a,input,select,textarea,summary,[contenteditable="true"],[role="button"],[role="switch"],[role="tab"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="combobox"],[role="slider"],[role="spinbutton"]';
type Backend = Pick<typeof import('./index.js'), 'play' | 'unlock' | 'bind'>;

/** Both entry points share preference policy; only their playback and environment adapters differ. */
export function createBindings(engine: Backend, web: boolean) {
  function useSoundPreference(): SoundPreference {
    const value = useSyncExternalStore(subscribePreference, getPreference, () => defaults);
    useEffect(() => { if (web) return persist(); }, []);
    return useMemo(() => ({ ...value, ...settings }), [value]);
  }
  function SoundProvider({ children, enabled, volume, unlockOnInteraction = true }: SoundProviderProps) {
    const owner = useRef({});
    const preference = useSoundPreference();
    useEffect(() => {
      overridePreference(owner.current, { ...(enabled === undefined ? {} : { enabled }), ...(volume === undefined ? {} : { volume }) });
    }, [enabled, volume]);
    useEffect(() => { const token = owner.current; return () => overridePreference(token, null); }, []);
    useEffect(() => {
      if (!web || !unlockOnInteraction || !preference.enabled || preference.volume <= 0) return;
      const onInteraction = (event: Event): void => { if (event.isTrusted) void engine.unlock(); };
      document.addEventListener('pointerdown', onInteraction, true);
      document.addEventListener('keydown', onInteraction, true);
      return () => {
        document.removeEventListener('pointerdown', onInteraction, true);
        document.removeEventListener('keydown', onInteraction, true);
      };
    }, [unlockOnInteraction, preference.enabled, preference.volume]);
    return createElement(Fragment, null, children);
  }
  function useBindSounds(ref: RefObject<HTMLElement | null>, options: BindOptions = {}): void {
    const binding = useRef<{ element: HTMLElement; keyboard: boolean | undefined; hoverInterval: number | undefined; unbind(): void } | null>(null);
    useEffect(() => {
      const previous = binding.current;
      if (previous && previous.element === ref.current && previous.keyboard === options.keyboard && previous.hoverInterval === options.hoverInterval) return;
      previous?.unbind();
      binding.current = ref.current ? { element: ref.current, keyboard: options.keyboard, hoverInterval: options.hoverInterval, unbind: engine.bind(ref.current, options) } : null;
    });
    useEffect(() => () => { binding.current?.unbind(); binding.current = null; }, []);
  }
  function useSound(name: SoundName, options?: PlayOptions): (overrides?: PlayOptions) => void {
    return useCallback((overrides?: PlayOptions) => engine.play(name, { ...options, ...overrides }), [name, options]);
  }
  function useSoundHandler<E extends SoundEvent>(name: SoundName, handler?: (event: E) => void, options: SoundHandlerOptions = {}): (event: E) => void {
    const preference = useSoundPreference();
    return useCallback((event: E) => {
      handler?.(event);
      if (event.defaultPrevented || options.disabled || options.busy || options.suppressed || !preference.enabled || preference.volume <= 0) return;
      if (web && event.target !== event.currentTarget) {
        const target = event.target as Element | null;
        const host = event.currentTarget as Element;
        const control = target?.closest?.(CONTROLS);
        if (control && control !== host && host.contains(control)) return;
      }
      engine.play(name, options);
    }, [name, handler, options, preference.enabled, preference.volume]);
  }
  function useSemanticSound(intent: FeedbackIntent, reducedMotion = false): () => void {
    const preference = useSoundPreference();
    return useCallback(() => {
      const preset = semanticPresets[intent];
      if (preset.sound && preference.enabled && preference.volume > 0) engine.play(preset.sound, { minInterval: preset.cooldown, volume: reducedMotion ? 0.5 : 1 });
    }, [intent, reducedMotion, preference.enabled, preference.volume]);
  }
  return { SoundProvider, useSoundPreference, useBindSounds, useSound, useSoundHandler, useSemanticSound };
}
