import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { FakeAudioContext, installAudio, setActivation, tick } from './fake-audio.mjs';

// A DOM for the binding tests. happy-dom's window becomes the global scope the library sees.
const dom = new Window();
for (const key of ['document', 'Node', 'Element', 'HTMLElement', 'Event', 'PointerEvent', 'KeyboardEvent', 'MouseEvent']) {
  globalThis[key] = dom[key];
}
let fine = true;
globalThis.matchMedia = () => ({ get matches() { return fine; } });
let clock = 10_000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });

const { bind, configure, dispose, setEnabled } = await import('../dist/index.js');

/** Count of sounds played, by the recipe fingerprint each leaves in the fake context. */
function played() {
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) return 0;
  // Each live-synthesized play creates one mix gain wired to the bus, then its level gain.
  return ctx.of('gain').filter((node) => node.outputs[0] === ctx.of('gain')[0]).length;
}
/** Frequencies of oscillators started so far (identifies which recipe played). */
const tones = () => (FakeAudioContext.instances.at(-1)?.of('oscillator') ?? []).map((node) => node.frequency.events[0][1]);

function pointer(type, target, init = {}) {
  const event = new dom.PointerEvent(type, { bubbles: type !== 'pointerenter', cancelable: true, pointerType: 'mouse', button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}
const key = (type, target, init) => target.dispatchEvent(new dom.KeyboardEvent(type, { bubbles: true, ...init }));
const click = (target) => target.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));

function element(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  const node = host.firstElementChild;
  document.body.append(node);
  return node;
}

let root;
beforeEach(async () => {
  await dispose();
  installAudio({ offline: false });
  setActivation(true);
  setEnabled(true);
  configure({ minInterval: 0 });
  fine = true;
  clock += 1000;
  document.body.innerHTML = '';
  root = element('<section></section>');
});

describe('bind()', () => {
  test('uses one capture listener per event type, and binding again is a no-op', () => {
    const added = [];
    const original = root.addEventListener.bind(root);
    root.addEventListener = (type, listener, capture) => { added.push([type, capture]); original(type, listener, capture); };
    const unbind = bind(root);
    assert.equal(bind(root), unbind, 'same root returns the same unbind');
    assert.ok(added.every(([, capture]) => capture === true));
    const counts = Object.fromEntries(['pointerenter', 'pointerup', 'click', 'keyup'].map((type) => [type, added.filter(([t]) => t === type).length]));
    assert.deepEqual(counts, { pointerenter: 1, pointerup: 1, click: 1, keyup: 1 });
    unbind();
  });

  test('defaults to the document and plays for elements added later', () => {
    const unbind = bind();
    const button = element('<button data-sound-toggle>Go</button>');
    click(button);
    assert.equal(played(), 1);
    unbind();
    click(button);
    assert.equal(played(), 1, 'silent after unbind');
    unbind();
  });

  test('without a DOM it returns a no-op', () => {
    const saved = globalThis.document;
    delete globalThis.document;
    try {
      const unbind = bind();
      assert.equal(typeof unbind, 'function');
      assert.doesNotThrow(unbind);
    } finally {
      globalThis.document = saved;
    }
    assert.doesNotThrow(() => bind({})());
  });

  test('attribute values pick the sound; empty or invalid values use the default', () => {
    const unbind = bind(root);
    root.innerHTML = '<button id="a" data-sound-toggle="droplet"></button><button id="b" data-sound-toggle="toString"></button><button id="c" data-sound-hover></button>';
    click(root.querySelector('#a'));
    assert.deepEqual(tones(), [1200], 'droplet');
    click(root.querySelector('#b'));
    assert.equal(played(), 2, 'toggle fallback (noise only)');
    assert.deepEqual(tones(), [1200]);
    pointer('pointerenter', root.querySelector('#c'));
    assert.deepEqual(tones(), [1200, 1046.5, 1568], 'hover falls back to chime');
    unbind();
  });

  test('attributes are read when the event fires', () => {
    const unbind = bind(root);
    root.innerHTML = '<button>Go</button>';
    const button = root.firstElementChild;
    click(button);
    assert.equal(played(), 0);
    button.setAttribute('data-sound-toggle', '');
    click(button);
    assert.equal(played(), 1);
    button.removeAttribute('data-sound-toggle');
    click(button);
    assert.equal(played(), 1);
    unbind();
  });

  test('the nearest carrier wins, and carriers outside the root are ignored', () => {
    const outer = element('<div data-sound-toggle="droplet"><section><span>inside</span></section></div>');
    const inner = outer.querySelector('section');
    const unbind = bind(inner);
    click(inner.querySelector('span'));
    assert.equal(played(), 0, 'carrier is outside the bound root');
    inner.setAttribute('data-sound-toggle', 'tick');
    click(inner.querySelector('span'));
    assert.deepEqual(tones(), [2600], 'nearest carrier (tick) inside the root');
    unbind();
  });

  test('events whose target is not an element are ignored', () => {
    const unbind = bind(root);
    root.dispatchEvent(new dom.MouseEvent('click'));
    const text = document.createTextNode('x');
    root.append(text);
    text.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));
    assert.equal(played(), 0);
    unbind();
  });
});

describe('hover', () => {
  test('mouse on a fine pointer only', () => {
    const unbind = bind(root);
    root.innerHTML = '<a data-sound-hover="tick">x</a>';
    const link = root.firstElementChild;
    pointer('pointerenter', link, { pointerType: 'touch' });
    pointer('pointerenter', link, { pointerType: 'pen' });
    assert.equal(played(), 0);
    fine = false;
    pointer('pointerenter', link);
    assert.equal(played(), 0);
    fine = true;
    pointer('pointerenter', link);
    assert.equal(played(), 1);
    pointer('pointerenter', root);
    assert.equal(played(), 1, 'no carrier');
    unbind();
  });

  test('one hover sound per 150 ms across the page; throttled events do not extend the window', () => {
    const unbind = bind(root);
    root.innerHTML = '<a data-sound-hover="tick">1</a><a data-sound-hover="tick">2</a>';
    const [a, b] = root.children;
    pointer('pointerenter', a);
    clock += 100;
    pointer('pointerenter', b);
    assert.equal(played(), 1);
    clock += 51;
    pointer('pointerenter', b);
    assert.equal(played(), 2);
    unbind();
  });

  test('hoverInterval is configurable', () => {
    const unbind = bind(root, { hoverInterval: 0 });
    root.innerHTML = '<a data-sound-hover="tick">1</a>';
    pointer('pointerenter', root.firstElementChild);
    pointer('pointerenter', root.firstElementChild);
    assert.equal(played(), 2);
    unbind();
  });

  test('moving between an element’s own children does not replay it', () => {
    const unbind = bind(root);
    root.innerHTML = '<a data-sound-hover="tick"><b><i>x</i></b></a>';
    const link = root.firstElementChild;
    pointer('pointerenter', link.querySelector('i'), { relatedTarget: link });
    assert.equal(played(), 0);
    pointer('pointerenter', link, { relatedTarget: root });
    assert.equal(played(), 1);
    unbind();
  });
});

describe('press and release', () => {
  test('pointer down and up play press and release, for touch too', () => {
    const unbind = bind(root);
    root.innerHTML = '<button data-sound-press data-sound-release>Save</button>';
    const button = root.firstElementChild;
    pointer('pointerdown', button, { pointerType: 'touch' });
    assert.deepEqual(tones(), [], 'press is noise only');
    pointer('pointerup', button, { pointerType: 'touch' });
    assert.deepEqual(tones(), [3200], 'release has its high ping');
    assert.equal(played(), 2);
    unbind();
  });

  test('secondary buttons are ignored', () => {
    const unbind = bind(root);
    root.innerHTML = '<button data-sound-press data-sound-release>Save</button>';
    pointer('pointerdown', root.firstElementChild, { button: 2 });
    pointer('pointerup', root.firstElementChild, { button: 1 });
    assert.equal(played(), 0);
    unbind();
  });

  test('disabled, aria-disabled and inert controls are silent', () => {
    const unbind = bind(root);
    root.innerHTML = '<button disabled data-sound-toggle>a</button><div aria-disabled="true"><span data-sound-toggle>b</span></div><div inert><span data-sound-toggle>c</span></div>';
    click(root.querySelector('button'));
    click(root.querySelectorAll('span')[0]);
    click(root.querySelectorAll('span')[1]);
    assert.equal(played(), 0);
    unbind();
  });

  test('Enter and Space press and release, without key repeat, paired per element', () => {
    const unbind = bind(root);
    root.innerHTML = '<button data-sound-press data-sound-release>Save</button><input>';
    const [button, input] = root.children;
    key('keydown', button, { key: 'Enter' });
    key('keydown', button, { key: 'Enter', repeat: true });
    key('keyup', button, { key: 'Enter' });
    assert.equal(played(), 2);
    key('keydown', button, { key: 'a' });
    key('keyup', button, { key: ' ' });
    assert.equal(played(), 2, 'other keys and unpaired key-ups are silent');
    key('keydown', button, { key: ' ' });
    key('keyup', button, { key: ' ' });
    assert.equal(played(), 4);
    key('keydown', input, { key: 'Enter' });
    assert.equal(played(), 4, 'no carrier');
    unbind();
  });

  test('keyboard: false leaves keys silent', () => {
    const unbind = bind(root, { keyboard: false });
    root.innerHTML = '<button data-sound-press>Save</button>';
    key('keydown', root.firstElementChild, { key: 'Enter' });
    assert.equal(played(), 0);
    unbind();
  });
});

describe('multiple roots', () => {
  test('an event plays once even when several bound roots see it', () => {
    const inner = document.createElement('div');
    root.append(inner);
    const unbindOuter = bind(root);
    const unbindInner = bind(inner);
    inner.innerHTML = '<button data-sound-toggle data-sound-press data-sound-release data-sound-hover>x</button>';
    const button = inner.firstElementChild;
    click(button);
    pointer('pointerdown', button);
    pointer('pointerup', button);
    pointer('pointerenter', button);
    key('keydown', button, { key: 'Enter' });
    key('keyup', button, { key: 'Enter' });
    assert.equal(played(), 6);
    unbindOuter();
    unbindInner();
  });

  test('a stale unbind does not remove a newer binding', () => {
    const first = bind(root);
    first();
    const second = bind(root);
    first();
    root.innerHTML = '<button data-sound-toggle>x</button>';
    click(root.firstElementChild);
    assert.equal(played(), 1);
    second();
  });
});

describe('unlock on first gesture', () => {
  test('the first pointer or key press resumes a suspended context, then the listener detaches', async () => {
    FakeAudioContext.next = { state: 'suspended' };
    const removed = [];
    const original = root.removeEventListener.bind(root);
    root.removeEventListener = (type, listener, capture) => { removed.push(type); original(type, listener, capture); };
    const unbind = bind(root);
    pointer('pointerdown', root);
    await tick();
    assert.equal(FakeAudioContext.instances[0].resumes, 1);
    assert.deepEqual(removed.sort(), ['keydown', 'pointerdown']);
    unbind();
  });

  test('gestures keep trying while audio cannot start', async () => {
    FakeAudioContext.next = { throws: true };
    const unbind = bind(root);
    key('keydown', root, { key: 'x' });
    key('keydown', root, { key: 'x' });
    await tick();
    assert.equal(FakeAudioContext.constructed, 2);
    unbind();
  });
});
