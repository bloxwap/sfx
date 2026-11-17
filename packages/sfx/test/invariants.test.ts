import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { OfflineAudioContext } from 'node-web-audio-api';
import * as sfx from '../dist/index.js';
import { recipes, registerRecipe, echoTail } from '../dist/recipes.js';
import { trimSilence } from '../dist/wav.js';
import { FakeAudioContext, FakeOfflineAudioContext, FakeBuffer, globals, installAudio, setActivation, tick, asReal } from './fake-audio.ts';

const tone = { wave: 'sine' as const, freq: 440, at: 0, attack: 0.01, decay: 0.1, peak: 0.2 };
beforeEach(async () => {
  await sfx.dispose(); installAudio(); setActivation(true);
  sfx.setEnabled(true); sfx.setVolume(1);
  for (const category of sfx.categories) sfx.setVolume(1, { category });
  sfx.configure({ maxVoices: 24, minInterval: 0, resume: 'queue' });
});
afterEach(() => sfx.dispose());

for (const reject of [false, true]) test(`retired resume ${reject ? 'rejection' : 'resolution'} cannot change a new session`, async () => {
  let old!: () => void, current!: () => void;
  FakeAudioContext.next = { state: 'suspended', resume: () => new Promise((resolve, fail) => { old = () => reject ? fail(new Error('closed')) : resolve(); }) };
  sfx.play('tick'); await sfx.dispose();
  FakeAudioContext.next = { state: 'suspended', resume: ctx => new Promise(resolve => { current = () => { ctx.state = 'running'; resolve(); }; }) };
  sfx.play('success'); old(); await tick();
  sfx.play('press');
  assert.equal(FakeAudioContext.instances.at(-1)!.resumes, 1);
  current(); await tick();
  assert.equal(sfx.activeVoices(), 2);
});

test('queue expiry makes room for a fresh request and retains its original options', async (t) => {
  let clock = 1000, finish!: () => void;
  t.mock.method(performance, 'now', () => clock);
  await sfx.preload(['success']);
  FakeAudioContext.next = { state: 'suspended', resume: ctx => new Promise(resolve => { finish = () => { ctx.state = 'running'; resolve(); }; }) };
  for (let i = 0; i < 17; i++) sfx.play('tick');
  clock += 400;
  const options = { volume: 0.4 };
  sfx.play('success', options); options.volume = 0;
  finish(); await tick();
  assert.equal(sfx.activeVoices(), 1);
  assert.equal(FakeAudioContext.instances.at(-1)!.of('gain').at(-1)!.gain.value, 0.4);
});

test('lowering the cap trims immediately; non-finite limits do not disable guards', async () => {
  await sfx.preload(['tick']);
  for (let i = 0; i < 5; i++) sfx.play('tick');
  sfx.configure({ maxVoices: 1 });
  assert.equal(sfx.activeVoices(), 1);
  sfx.configure({ maxVoices: Infinity, minInterval: Infinity });
  sfx.play('tick', { minInterval: Infinity });
  assert.equal(sfx.activeVoices(), 1);
  assert.equal(FakeAudioContext.instances.at(-1)!.of('source').length, 6);
});

test('all registration paths invalidate caches and built-ins are deeply frozen', async () => {
  assert.equal(Reflect.set(recipes.chime.layers[0]!, 'freq', 42), false);
  assert.ok(Object.isFrozen(recipes.chime.layers));
  assert.ok(Object.isFrozen(recipes.chime.echo));
  assert.ok(Object.isFrozen(sfx.categories));
  registerRecipe('direct-registration', { level: 1, layers: [tone] });
  await sfx.preload(['direct-registration']);
  registerRecipe('direct-registration', { level: 1, layers: [{ ...tone, freq: 880 }] });
  sfx.play('direct-registration');
  assert.equal(FakeAudioContext.instances.at(-1)!.of('oscillator')[0]!.frequency.events[0]![1], 880);
});

test('recipe validation bounds aggregate duration, layer count, mixed gain and registration count', () => {
  for (const recipe of [
    { level: 1, layers: [{ ...tone, at: 1e308, attack: 1e308 }] },
    { level: 1, layers: Array(65).fill(tone) },
    { level: Number.MAX_VALUE, layers: [{ ...tone, peak: Number.MAX_VALUE }] },
    { level: 1, layers: [tone], echo: { delay: 1, feedback: 0.999999, wet: 1, lowpass: 5000 } },
    { level: 1, layers: [null] },
  ]) assert.throws(() => sfx.define('over-budget', recipe as sfx.Recipe), RangeError);
  assert.throws(() => sfx.define('a'.repeat(129), { level: 1, layers: [tone] }), RangeError);
  assert.throws(() => sfx.define(null as never, { level: 1, layers: [tone] }), RangeError);
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {define} from './dist/index.js';
    const recipe = ${JSON.stringify({ level: 1, layers: [tone] })};
    for(let i=0;i<128;i++) define('bounded-'+i,recipe);
    assert.throws(()=>define('overflow',recipe),RangeError);
    define('bounded-0',recipe);
  `], { cwd: new URL('..', import.meta.url) });
  assert.equal(sfx.duration('unknown'), 0);
});

test('single echoes survive the baked buffer and slow playback allocates enough delay', async () => {
  const recipe = { level: 1, layers: [tone], echo: { delay: 0.5, feedback: 0, wet: 1, lowpass: 5000 } };
  sfx.define('one-repeat', recipe);
  assert.equal(echoTail({ ...recipe, echo: { ...recipe.echo, wet: 0 } }), 0);
  globals.OfflineAudioContext = OfflineAudioContext;
  const audio = await sfx.renderBuffer('one-repeat');
  assert.ok(audio && audio.duration > 0.6);
  assert.ok(audio.getChannelData(0).slice(24000).some(value => Math.abs(value) > 0.1));
  const target = new FakeAudioContext();
  assert.ok(sfx.renderTo(asReal(target), 'one-repeat', { rate: 0.25 }));
  assert.equal(target.of('delay')[0]!.maxDelayTime, 2);
  target.of('source').at(-1)!.end();
});

test('failed initialization closes its context; partial synthesis and routing leave no orphan nodes', async (t) => {
  const gain = t.mock.method(FakeAudioContext.prototype, 'createGain', () => { throw new Error('allocation'); });
  sfx.play('tick');
  assert.equal(FakeAudioContext.instances[0]!.closed, true);
  gain.mock.restore();
  await sfx.unlock();
  const ctx = FakeAudioContext.instances.at(-1)!;
  const oscillator = ctx.createOscillator.bind(ctx);
  let count = 0;
  const broken = t.mock.method(ctx, 'createOscillator', () => { if (++count === 2) throw new Error('allocation'); return oscillator(); });
  sfx.play('chime');
  assert.equal(sfx.activeVoices(), 0);
  assert.ok(ctx.nodes.slice(3).every(node => node.outputs.length === 0));
  broken.mock.restore();
  await sfx.preload(['tick']);
  const before = ctx.nodes.length;
  t.mock.method(ctx, 'createStereoPanner', () => { throw new Error('routing'); });
  sfx.play('tick', { volume: 0.5, pan: 1 });
  assert.equal(sfx.activeVoices(), 0);
  assert.ok(ctx.nodes.slice(before).every(node => node.outputs.length === 0));
});

test('renderTo retires its entire live graph on the audio clock', () => {
  const ctx = new FakeAudioContext();
  assert.ok(sfx.renderTo(asReal(ctx), 'chime', { delay: 2 }));
  const tail = ctx.of('source').at(-1)!;
  assert.ok(tail.startedAt! > 3);
  tail.end();
  assert.ok(ctx.nodes.slice(1).every(node => node.outputs.length === 0 && node.disconnects > 0));
});

test('preload reports missing, failed and invalidated renders', async (t) => {
  assert.equal(await sfx.preload(['unknown']), false);
  FakeOfflineAudioContext.fail = true;
  assert.equal(await sfx.preload(['tick']), false);
  FakeOfflineAudioContext.fail = false;
  let finish!: (buffer: FakeBuffer) => void;
  t.mock.method(FakeOfflineAudioContext.prototype, 'startRendering', () => new Promise<FakeBuffer>(resolve => { finish = resolve; }));
  const preload = sfx.preload(['tick']);
  await sfx.dispose(); finish(new FakeBuffer(1, 32, 48000));
  assert.equal(await preload, false);
});

test('offline render allocation and concurrency stay within their byte budgets', async (t) => {
  sfx.define('large-render', { level: 1, layers: [{ ...tone, decay: 9 }] });
  assert.equal(await sfx.renderBuffer('large-render', { sampleRate: 768000 }), null);
  const pending: Array<() => void> = [];
  t.mock.method(FakeOfflineAudioContext.prototype, 'startRendering', () => new Promise<FakeBuffer>(resolve => { pending.push(() => resolve(new FakeBuffer(1, 1, 48000))); }));
  const a = sfx.renderBuffer('large-render', { sampleRate: 400000 });
  const b = sfx.renderBuffer('large-render', { sampleRate: 400000 });
  assert.equal(await sfx.renderBuffer('large-render', { sampleRate: 400000 }), null);
  for (const finish of pending) finish();
  assert.ok(await a); assert.ok(await b);
});

test('silence trimming uses the same sanitized amplitude as WAV encoding', () => {
  const samples = new Float32Array([Infinity, NaN, 0.5, 0.5]);
  const audio = { numberOfChannels: 1, sampleRate: 48000, length: 4, getChannelData: () => samples };
  assert.equal(trimSilence(audio, { padMs: 0 }).length, 4);
});

test('externally closed contexts are replaced before the next play', async () => {
  sfx.play('tick');
  const old = FakeAudioContext.instances[0]!;
  await old.close();
  sfx.play('press');
  assert.equal(FakeAudioContext.instances.length, 2);
  assert.equal(sfx.getOutput()!.context, FakeAudioContext.instances[1]);
  assert.equal(sfx.activeVoices(), 1);
});

test('render cache evicts oldest buffers when retained PCM exceeds its budget', async () => {
  FakeAudioContext.next = { sampleRate: 768000 };
  await sfx.unlock();
  for (let i = 0; i < 3; i++) {
    sfx.define(`cache-budget-${i}`, { level: 1, layers: [{ ...tone, decay: 9 }] });
    assert.equal(await sfx.preload([`cache-budget-${i}`]), true);
  }
  const before = FakeOfflineAudioContext.instances.length;
  assert.equal(await sfx.preload(['cache-budget-0']), true);
  assert.equal(FakeOfflineAudioContext.instances.length, before + 1, 'oldest sound was evicted and rendered again');
});

test('synchronous offline allocation failures release render reservations', async (t) => {
  t.mock.method(FakeOfflineAudioContext.prototype, 'createGain', () => { throw new Error('out of resources'); });
  assert.equal(await sfx.renderBuffer('tick'), null);
});

test('React and persisted master settings remain explicit for reduced-motion startup policy', () => {
  for (const update of ["setVolume(1)", "restorePreference({ enabled: true, volume: 1 })"]) {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {configure,getVolume} from './dist/index.js';
      import {setVolume,restorePreference} from './dist/preferences.js';
      globalThis.matchMedia=()=>({matches:true});
      ${update};
      configure({respectReducedMotion:true});
      assert.equal(getVolume(),1);
    `], { cwd: new URL('..', import.meta.url) });
  }
});
