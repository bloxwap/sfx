import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Window } from 'happy-dom';
import { createElement, act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SoundProvider, useSound, useSoundHandler, useSoundPreference, useBindSounds } from '../dist/react.native.js';
import { dispose, configure, setEnabled, setVolume, type NativeSfxModule } from '../dist/native.js';
import { FakeAudioContext, globals, asReal } from './fake-audio.ts';

test('React Native hooks use native playback without browser preferences or gesture listeners', async () => {
  const dom = new Window({ url: 'https://native.test' });
  globals.window = dom; globals.document = dom.document; globals.IS_REACT_ACT_ENVIRONMENT = true;
  (dom as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  globals.localStorage = { getItem() { throw new Error('native must not access localStorage'); } };
  const played: string[] = [];
  const module: NativeSfxModule = {
    configure() {}, setVolume() {}, addListener: () => ({ remove() {} }),
    play(name) { played.push(name); return played.length; },
    stop() {}, stopAll() {}, activeVoices: () => 0, preload: async () => true, unlock: async () => true, dispose() {},
  };
  globals.expo = { modules: { BloxwapSfxEngine: module } };
  configure({ minInterval: 0 }); setEnabled(true); setVolume(1);
  let play!: () => void, press!: (event: { defaultPrevented: boolean; target: number; currentTarget: number }) => void;
  function Control() {
    const ref = useRef(null); useBindSounds(ref);
    useSoundPreference(); play = useSound('tick'); press = useSoundHandler('success');
    return null;
  }
  const root = createRoot(asReal(dom.document.body));
  try {
    await act(async () => root.render(createElement(SoundProvider, null, createElement(Control))));
    play(); press({ defaultPrevented: false, target: 1, currentTarget: 2 });
    assert.deepEqual(played, ['tick', 'success']);
    assert.equal(FakeAudioContext.constructed, 0);
  } finally {
    await act(async () => root.unmount()); await dispose(); delete globals.expo; await dom.happyDOM.abort();
  }
});

test('the react-native export condition selects native React hooks', () => {
  execFileSync(process.execPath, ['--conditions=react-native', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {useSound} from '@bloxwap/sfx/react';
    import {useSound as native} from './dist/react.native.js';
    assert.equal(useSound, native);
  `], { cwd: new URL('..', import.meta.url) });
});
