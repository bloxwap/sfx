// Runs in its own process: the hover media query is cached on first use, so a page without
// matchMedia needs a fresh module instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { FakeAudioContext, installAudio, setActivation } from './fake-audio.mjs';

const dom = new Window();
globalThis.document = dom.document;
delete globalThis.matchMedia;
installAudio({ offline: false });
setActivation(true);

const { bind, dispose } = await import('../dist/index.js');

test('hover sounds play where matchMedia is unavailable', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<a data-sound-hover="tick">x</a>';
  document.body.append(root);
  const unbind = bind(root);
  root.firstElementChild.dispatchEvent(new dom.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  unbind();
  assert.deepEqual(FakeAudioContext.instances[0].of('oscillator').map((node) => node.frequency.events[0][1]), [2600]);
  // The fake clock never advances, so the live voice's cleanup timer would keep re-arming.
  await dispose();
});
