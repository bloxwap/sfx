import { now, play, unlock } from './engine.js';
import { isSound, type SoundName } from './recipes.js';

/** Options for {@link bind}. */
export interface BindOptions {
  /** Map Enter/Space key down/up on press/release elements to their sounds. Default true. */
  keyboard?: boolean;
  /** Milliseconds between hover sounds, shared by every bound root. Default 150. */
  hoverInterval?: number;
}

type Kind = 'hover' | 'press' | 'release' | 'toggle';

const ATTRIBUTE: Record<Kind, string> = {
  hover: 'data-sound-hover',
  press: 'data-sound-press',
  release: 'data-sound-release',
  toggle: 'data-sound-toggle',
};
const SELECTOR: Record<Kind, string> = {
  hover: '[data-sound-hover]',
  press: '[data-sound-press]',
  release: '[data-sound-release]',
  toggle: '[data-sound-toggle]',
};
const FALLBACK: Record<Kind, SoundName> = { hover: 'chime', press: 'press', release: 'release', toggle: 'toggle' };
const INERT = ':disabled, [aria-disabled="true"], [inert]';

/** An event already turned into a sound by one root is ignored by every other root it reaches. */
const handled = new WeakSet<Event>();
const bound = new WeakMap<Node, () => void>();
let lastHover = -Infinity;
let finePointer: MediaQueryList | null | undefined;

function hasFinePointer(): boolean {
  if (finePointer === undefined) {
    // Cached: a MediaQueryList's `matches` stays live, so it is parsed once, not per event.
    finePointer = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;
  }
  return finePointer ? finePointer.matches : true;
}

const isElement = (value: unknown): value is Element =>
  typeof value === 'object' && value !== null && (value as Node).nodeType === 1;

/** The nearest element (target or ancestor) inside `root` carrying the attribute for `kind`. */
function carrier(root: Node, event: Event, kind: Kind): Element | null {
  const target = event.target;
  if (!isElement(target)) return null;
  const element = target.closest(SELECTOR[kind]);
  if (!element || !root.contains(element) || element.closest(INERT)) return null;
  return element;
}

function sound(element: Element, kind: Kind): SoundName {
  const value = element.getAttribute(ATTRIBUTE[kind]);
  return isSound(value) ? value : FALLBACK[kind];
}

function fire(event: Event, element: Element, kind: Kind): void {
  handled.add(event);
  play(sound(element, kind));
}

/**
 * Plays sounds for every `data-sound-hover`, `-press`, `-release` and `-toggle` element under `root`
 * (default: the document), including elements added later. Uses one delegated capture listener per
 * event type, and unlocks audio on the first pointer or key press. Binding the same root again is a
 * no-op. Returns a function that removes the listeners.
 */
export function bind(root?: ParentNode | null, options: BindOptions = {}): () => void {
  const target = (root ?? (typeof document === 'undefined' ? null : document)) as (Node & EventTarget) | null;
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const existing = bound.get(target);
  if (existing) return existing;

  const keyboard = options.keyboard !== false;
  const hoverInterval = options.hoverInterval ?? 150;
  const held = new WeakSet<Element>();

  const onEnter = (event: Event) => {
    if (handled.has(event)) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== 'mouse' || !hasFinePointer()) return;
    const element = carrier(target, event, 'hover');
    if (!element) return;
    // Moving between an element's own children is not a new hover.
    const from = pointer.relatedTarget as Node | null;
    if (from && typeof from === 'object' && element.contains(from)) return;
    const t = now();
    if (t - lastHover < hoverInterval) return;
    lastHover = t;
    fire(event, element, 'hover');
  };

  const onPointer = (kind: 'press' | 'release') => (event: Event) => {
    if (handled.has(event)) return;
    // Primary button only: no sounds for right-click menus or middle-click.
    const button = (event as PointerEvent).button;
    if (button !== undefined && button > 0) return;
    const element = carrier(target, event, kind);
    if (element) fire(event, element, kind);
  };
  const onDown = onPointer('press');
  const onUp = onPointer('release');

  const onClick = (event: Event) => {
    if (handled.has(event)) return;
    const element = carrier(target, event, 'toggle');
    if (element) fire(event, element, 'toggle');
  };

  const onKey = (event: Event) => {
    if (handled.has(event)) return;
    const key = event as KeyboardEvent;
    if (key.key !== 'Enter' && key.key !== ' ') return;
    const down = event.type === 'keydown';
    if (down && key.repeat) return;
    const element = carrier(target, event, down ? 'press' : 'release');
    if (!element) return;
    // Pair each release with a press on the same element, so a key held elsewhere stays silent.
    if (down) held.add(element);
    else if (!held.has(element)) return;
    else held.delete(element);
    fire(event, element, down ? 'press' : 'release');
  };

  // Resume audio inside the first gesture, so the first real sound is not delayed.
  const onGesture = () => {
    void unlock().then((running) => {
      if (running) {
        target.removeEventListener('pointerdown', onGesture, true);
        target.removeEventListener('keydown', onGesture, true);
      }
    });
  };

  const listeners: [string, (event: Event) => void][] = [
    ['pointerdown', onGesture],
    ['keydown', onGesture],
    ['pointerenter', onEnter],
    ['pointerdown', onDown],
    ['pointerup', onUp],
    ['click', onClick],
  ];
  if (keyboard) listeners.push(['keydown', onKey], ['keyup', onKey]);
  for (const [type, listener] of listeners) target.addEventListener(type, listener, true);

  const unbind = () => {
    if (bound.get(target) !== unbind) return;
    bound.delete(target);
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, true);
  };
  bound.set(target, unbind);
  return unbind;
}
