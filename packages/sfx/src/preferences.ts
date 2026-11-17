import { isCategory, type SoundCategory } from './recipes.js';

export interface Preference {
  readonly enabled: boolean;
  readonly volume: number;
  readonly categoryVolumes?: Partial<Record<SoundCategory, number>>;
}
export interface VolumeOptions { category?: SoundCategory }
export type Override = Partial<Pick<Preference, 'enabled' | 'volume'>>;
export const defaults: Preference = Object.freeze({ enabled: true, volume: 1 });
let saved = defaults;
let effective = saved;
let explicitVolume = false;
export const hasExplicitVolume = (): boolean => explicitVolume;
const owners = new Map<object, Override>();
const listeners = new Set<() => void>();
const savedListeners = new Set<() => void>();

const equal = (a: Preference, b: Preference): boolean => a.enabled === b.enabled && a.volume === b.volume && JSON.stringify(a.categoryVolumes) === JSON.stringify(b.categoryVolumes);
const unit = (value: number): number => Math.min(1, Math.max(0, value));
export const getPreference = (): Preference => effective;
export const getSavedPreference = (): Preference => saved;
export function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function subscribeSavedPreference(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => { savedListeners.delete(listener); };
}
function publish(): void {
  let next = saved;
  for (const override of owners.values()) next = { ...next, ...override };
  if (equal(effective, next)) return;
  effective = Object.freeze(next);
  for (const listener of listeners) listener();
}
export function restorePreference(next: Preference, explicit = true): void {
  if (explicit && next !== defaults) explicitVolume = true;
  if (equal(saved, next)) return;
  saved = Object.freeze({ ...next, ...(next.categoryVolumes ? { categoryVolumes: Object.freeze({ ...next.categoryVolumes }) } : {}) });
  publish();
  for (const listener of savedListeners) listener();
}
/** Later mounted providers win for the fields they override; removal reveals the previous owner. */
export function overridePreference(owner: object, value: Override | null): void {
  if (value === null) owners.delete(owner);
  else owners.set(owner, {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.volume === 'number' && Number.isFinite(value.volume) ? { volume: unit(value.volume) } : {}),
  });
  publish();
}
export function setEnabled(value: boolean): void {
  if (typeof value === 'boolean') restorePreference({ ...saved, enabled: value }, false);
}
export const isEnabled = (): boolean => effective.enabled;
export function setVolume(value: number, options?: VolumeOptions): void {
  if (!Number.isFinite(value)) return;
  if (options?.category !== undefined) {
    if (isCategory(options.category)) restorePreference({ ...saved, categoryVolumes: { ...saved.categoryVolumes, [options.category]: unit(value) } }, false);
  } else restorePreference({ ...saved, volume: unit(value) });
}
export function getVolume(options?: VolumeOptions): number {
  return isCategory(options?.category) ? effective.categoryVolumes?.[options.category] ?? 1 : effective.volume;
}
