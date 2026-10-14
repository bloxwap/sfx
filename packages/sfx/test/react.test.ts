import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createElement, useRef, act, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { useBindSounds, useSound, useSoundPreference, SoundProvider, useSoundHandler, useSemanticSound, type SoundPreference } from '../dist/react.js';
import { dispose, getVolume, getOutput, unlock, isEnabled, preload, setEnabled, setVolume } from '../dist/index.js';
import { FakeAudioContext, asReal, globals, installAudio, setActivation } from './fake-audio.ts';
const dom = new Window({ url: 'https://example.test' });
let root: Root | undefined;
function setup() {
  installAudio(); setActivation(true); setEnabled(true); setVolume(1);
  globals.window = dom;
  globals.document = dom.document;
  globals.localStorage = dom.localStorage;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  (dom as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  root = createRoot(asReal<HTMLElement>(container));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; await dispose(); dom.document.body.innerHTML = ''; dom.localStorage.clear(); });

test('the React subpath renders on the server without creating audio', () => {
  function Preference() { const value = useSoundPreference(); return createElement('span', null, String(value.enabled)); }
  const html = renderToString(createElement(SoundProvider, null, createElement(Preference)));
  assert.equal(html, '<span>true</span>');
});

test('preferences hydrate after mount, synchronize consumers and tabs, clamp and persist', async () => {
  setup();
  dom.localStorage.setItem('bloxwap:sfx', JSON.stringify({ enabled: false, volume: 0.25 }));
  const seen: SoundPreference[] = [];
  function Preference({ index }: { index: number }) { seen[index] = useSoundPreference(); return null; }
  await act(async () => root!.render(createElement(StrictMode, null, createElement(Preference, { index: 0 }), createElement(Preference, { index: 1 }))));
  assert.equal(isEnabled(), false); assert.equal(getVolume(), 0.25);
  await act(async () => { seen[0].setEnabled(true); seen[0].setVolume(2); });
  assert.equal(seen[1].enabled, true); assert.equal(seen[1].volume, 1);
  assert.deepEqual(JSON.parse(dom.localStorage.getItem('bloxwap:sfx')!), { enabled: true, volume: 1 });
  await act(async () => { seen[0].setVolume(NaN); seen[0].setVolume(1); });
  assert.equal(getVolume(), 1);
  const event = (key: string | null, newValue: string | null) => dom.dispatchEvent(new dom.StorageEvent('storage', asReal({ key, newValue })));
  await act(async () => { event('other', '{"enabled":false,"volume":0}'); });
  assert.equal(isEnabled(), true);
  await act(async () => { event('bloxwap:sfx', '{"enabled":false,"volume":-1}'); });
  assert.equal(isEnabled(), false); assert.equal(getVolume(), 0);
  await act(async () => { event(null, null); });
  assert.equal(isEnabled(), true); assert.equal(getVolume(), 1);
  for (const value of ['{', '{}', '{"enabled":"no","volume":1}', '{"enabled":true,"volume":"bad"}', '{"enabled":true,"volume":1e999}']) {
    await act(async () => { event('bloxwap:sfx', value); });
    assert.equal(getVolume(), 1);
  }
});

test('provider overrides persisted settings and restores them on unmount', async () => {
  setup();
  let seen!: SoundPreference;
  function Preference() { seen = useSoundPreference(); return null; }
  await act(async () => root!.render(createElement(SoundProvider, { enabled: false, volume: 0.3 }, createElement(Preference))));
  assert.equal(seen.enabled, false); assert.equal(seen.volume, 0.3);
  assert.equal(isEnabled(), false); assert.equal(getVolume(), 0.3);
  await act(async () => { seen.setVolume(0.8); });
  assert.equal(seen.volume, 0.3); assert.equal(getVolume(), 0.3);
  await act(async () => root!.render(createElement(SoundProvider, null, createElement(Preference))));
  assert.equal(getVolume(), 0.8);
  await act(async () => root!.render(null));
  assert.equal(getVolume(), 0.8);
});

test('unavailable storage does not break effects or preference changes', async () => {
  setup();
  globals.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let seen!: SoundPreference;
  function Preference() { seen = useSoundPreference(); return null; }
  await act(async () => root!.render(createElement(Preference)));
  await act(async () => { seen.setEnabled(false); seen.setVolume(0.4); });
  assert.equal(isEnabled(), false); assert.equal(getVolume(), 0.4);
});

test('binding cleans up on options changes and unmount, and useSound plays', async () => {
  setup();
  function Control({ keyboard, hoverInterval }: { keyboard?: boolean; hoverInterval?: number }) {
    const ref = useRef<HTMLElement | null>(null);
    useBindSounds(ref, { keyboard, hoverInterval });
    const trigger = useSound('success', { minInterval: 0 });
    return createElement('button', { ref, 'data-sound-press': '', onClick: () => trigger({ volume: 0.5 }) }, 'Play');
  }
  await preload(['success', 'press']);
  await act(async () => root!.render(createElement(Control)));
  const button = dom.document.querySelector('button')!;
  await act(async () => { button.dispatchEvent(new dom.PointerEvent('pointerdown', { bubbles: true, button: 0 })); button.click(); });
  assert.ok(FakeAudioContext.instances.at(-1)!.of('source').length >= 2);
  await act(async () => root!.render(createElement(Control, { keyboard: false, hoverInterval: 20 })));
  const context = FakeAudioContext.instances.at(-1)!;
  const before = context.of('source').length;
  await act(async () => root!.render(null));
  button.dispatchEvent(new dom.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  assert.equal(context.of('source').length, before);
  function NoElement() { const ref = useRef<HTMLElement | null>(null); useBindSounds(ref); return null; }
  await act(async () => root!.render(createElement(NoElement)));
});


test('category preferences migrate, persist, synchronize and restore policy overrides', async () => {
  setup();
  dom.localStorage.setItem('bloxwap:sfx', JSON.stringify({ enabled: true, volume: 0.6, categoryVolumes: { controls: 0.2, money: -1, hover: 4, feedback: 'bad', alien: 1 } }));
  let seen!: SoundPreference;
  function Preference() { seen = useSoundPreference(); return null; }
  await act(async () => root!.render(createElement(SoundProvider, { unlockOnInteraction: false }, createElement(Preference))));
  assert.equal(getVolume({ category: 'controls' }), 0.2);
  assert.equal(getVolume({ category: 'money' }), 0);
  assert.equal(getVolume({ category: 'hover' }), 1);
  assert.equal(getVolume({ category: 'feedback' }), 1);
  await act(async () => { seen.setCategoryVolume('feedback', 0.4); seen.setCategoryVolume('controls', NaN); seen.setCategoryVolume('alien' as 'hover', 0.2); });
  assert.equal(getVolume({ category: 'feedback' }), 0.4);
  assert.equal(JSON.parse(dom.localStorage.getItem('bloxwap:sfx')!).categoryVolumes.feedback, 0.4);
  assert.equal(getOutput(), null);
});

test('provider unlock only accepts trusted interactions and removes capture listeners', async (t) => {
  setup();
  const added = t.mock.method(dom.document, 'addEventListener');
  const removed = t.mock.method(dom.document, 'removeEventListener');
  await act(async () => root!.render(createElement(SoundProvider)));
  const calls = added.mock.calls.filter(call => ['pointerdown', 'keydown'].includes(String(call.arguments[0])));
  assert.ok(calls.length >= 2);
  const listener = calls.at(-1)!.arguments[1] as unknown as (event: { isTrusted: boolean }) => void;
  listener({ isTrusted: false }); assert.equal(getOutput(), null);
  await act(async () => listener({ isTrusted: true })); assert.ok(getOutput());
  await act(async () => root!.render(createElement(SoundProvider, { volume: 0 })));
  assert.equal(removed.mock.calls.filter(call => ['pointerdown', 'keydown'].includes(String(call.arguments[0]))).length, calls.length);
  await act(async () => root!.render(createElement(SoundProvider, { enabled: false })));
  assert.equal(added.mock.calls.filter(call => ['pointerdown', 'keydown'].includes(String(call.arguments[0]))).length, calls.length);
});

test('composed handler preserves actions, cancellation and nested controls; semantic outcomes are quiet', async () => {
  setup();
  await unlock(); await preload(['tick', 'toggle', 'success', 'error']);
  let trigger!: (event: any) => void;
  let semantic!: () => void;
  let actions = 0;
  const button = dom.document.createElement('button');
  const span = dom.document.createElement('span'); button.append(span);
  const nested = dom.document.createElement('button'); button.append(nested);
  function Control({ handler, options, intent = 'activate', reduced = false }: any) {
    trigger = useSoundHandler('tick', handler, options);
    semantic = useSemanticSound(intent, reduced);
    return null;
  }
  const host = () => { actions++; };
  const event = (target: typeof button | typeof span = button, prevented = false) => ({ target, currentTarget: button, defaultPrevented: prevented });
  const count = () => FakeAudioContext.instances.at(-1)!.of('source').length;
  await act(async () => root!.render(createElement(Control)));
  let before = count(); trigger(event()); assert.equal(count(), before + 1);
  await act(async () => root!.render(createElement(Control, { handler: host, options: { minInterval: 0 } })));
  before = count(); trigger(event(span)); assert.equal(count(), before + 1); assert.equal(actions, 1);
  before = count(); trigger(event(nested)); trigger(event(button, true)); assert.equal(count(), before); assert.equal(actions, 3);
  for (const flag of ['disabled', 'busy', 'suppressed']) {
    await act(async () => root!.render(createElement(Control, { handler: host, options: { [flag]: true } })));
    before = count(); trigger(event()); assert.equal(count(), before);
  }
  await act(async () => root!.render(createElement(Control, { handler: (e: any) => { e.defaultPrevented = true; } })));
  before = count(); trigger(event()); assert.equal(count(), before);
  await act(async () => root!.render(createElement(SoundProvider, { enabled: false }, createElement(Control))));
  before = count(); trigger(event()); semantic(); assert.equal(count(), before);
  await act(async () => root!.render(createElement(SoundProvider, { volume: 0 }, createElement(Control))));
  before = count(); trigger(event()); semantic(); assert.equal(count(), before);
  for (const intent of ['press', 'activate', 'release', 'cancel', 'selection', 'toggle', 'disclosure', 'success', 'warning', 'error', 'notification']) {
    await act(async () => root!.render(createElement(SoundProvider, { volume: 1, enabled: true }, createElement(Control, { intent, reduced: true }))));
    semantic();
  }
  await act(async () => root!.render(createElement(SoundProvider, { volume: 1, enabled: true }, createElement(Control, { intent: 'error' })))); semantic();
  assert.ok(FakeAudioContext.instances.at(-1)!.of('gain').some(node => node.gain.value === 0.5));
});
