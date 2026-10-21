import { test, expect } from '@playwright/test';
import { compareCache } from '../cache-equivalence.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('body[data-ready=true]').waitFor();
});

test('preload and every offline render are audible, finite, stereo and decay', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { sfx, stats } = window as any;
    await sfx.preload();
    const results = [];
    for (const name of sfx.sounds) {
      const buffer = await sfx.renderBuffer(name, { sampleRate: 48000 });
      if (!buffer) throw new Error(`No buffer for ${name}`);
      let peak = 0, tail = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (const sample of data) {
          if (!Number.isFinite(sample)) throw new Error(`Non-finite ${name}`);
          peak = Math.max(peak, Math.abs(sample));
        }
        for (let i = data.length - 960; i < data.length; i++) tail = Math.max(tail, Math.abs(data[i]));
      }
      results.push({ name, peak, tail, channels: buffer.numberOfChannels, duration: buffer.duration, expected: sfx.duration(name) + 0.1 });
    }
    return { results, contexts: stats.contexts };
  });
  expect(result.contexts).toBe(0);
  expect(result.results).toHaveLength(19);
  for (const sound of result.results) {
    expect(sound.peak, sound.name).toBeGreaterThan(0.05);
    expect(sound.peak, sound.name).toBeLessThan(1);
    expect(sound.tail, sound.name).toBeLessThan(0.001);
    expect(sound.channels).toBe(2);
    expect(sound.duration).toBeCloseTo(sound.expected, 4);
  }
});

test('play before a gesture stays silent; a real click unlocks cached playback', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
  expect(await page.evaluate(() => (window as any).beforeGestureContexts)).toBe(0);
  await page.evaluate(async () => { await (window as any).sfx.preload(); });
  await page.locator('#control').click();
  await expect.poll(() => page.evaluate(() => (window as any).context.state)).toBe('running');
  // A cold native audio backend can exceed the documented 250 ms queue lifetime.
  // Verify playback once the first click has unlocked the context.
  await page.locator('#control').click();
  await expect.poll(() => page.evaluate(() => (window as any).stats.starts)).toBeGreaterThanOrEqual(2);
  expect(warnings.filter(message => /autoplay|not allowed|user gesture/i.test(message))).toEqual([]);
});

test('aborting delayed buffered and live voices preserves unrelated playback', async ({ page }) => {
  await page.locator('#unlock').click();
  await expect.poll(() => page.evaluate(() => (window as any).context.state)).toBe('running');
  const before = await page.evaluate(async () => {
    const { sfx } = window as any;
    await sfx.preload(['tick', 'press']);
    const controller = new AbortController();
    sfx.play('tick', { delay: 10, signal: controller.signal });
    sfx.play('chime', { delay: 10, signal: controller.signal });
    sfx.play('press', { delay: 10 });
    const voices = sfx.activeVoices();
    controller.abort();
    return voices;
  });
  expect(before).toBe(3);
  // Native buffer sources must report onended even when stopped before their scheduled start.
  await expect.poll(() => page.evaluate(() => (window as any).sfx.activeVoices())).toBe(1);
  await page.evaluate(() => (window as any).sfx.stopAll());
});

test('bind handles native hover, pointer, keyboard, toggle, disabled and teardown', async ({ page }) => {
  await page.locator('#unlock').click();
  await expect.poll(() => page.evaluate(() => (window as any).context.state)).toBe('running');
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'Desktop test browser has a fine pointer').toBe(true);
  await page.evaluate(async () => { const w = window as any; await w.sfx.preload(); w.sfx.configure({ minInterval: 0 }); });
  const starts = () => page.evaluate(() => (window as any).stats.starts);
  let before = await starts();
  await page.locator('#control').hover();
  await expect.poll(starts).toBe(before + 1);
  before = await starts();
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(starts).toBe(before + 2);
  before = await starts();
  await page.locator('#control').focus(); await page.keyboard.press('Space');
  await expect.poll(starts).toBe(before + 2);
  before = await starts();
  await page.locator('#toggle').click();
  await expect.poll(starts).toBe(before + 1);
  before = await starts();
  await page.locator('#disabled').dispatchEvent('pointerdown', { button: 0 });
  expect(await starts()).toBe(before);
  await page.evaluate(() => (window as any).unbind());
  await page.locator('#toggle').click();
  expect(await starts()).toBe(before);
});

test('WebKit recovers the interrupted state through its native context', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'WebKit-specific state');
  await page.locator('#unlock').click();
  await page.evaluate(async () => {
    const w = window as any;
    await w.context.suspend();
    // Desktop automation cannot trigger a phone call. Shadow only the reported state while the
    // underlying native context is suspended, then remove it when the engine asks to resume.
    Object.defineProperty(w.context, 'state', { configurable: true, value: 'interrupted' });
    const resume = w.context.resume.bind(w.context);
    w.context.resume = () => { delete w.context.state; return resume(); };
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).context.state)).toBe('running');
  expect(await page.evaluate(() => (window as any).stats.resumes)).toBeGreaterThan(0);
});

test('mono cache preserves stereo output at center and non-zero pan', async ({ page }) => {
  await page.addScriptTag({ content: `window.compareCache = ${compareCache.toString()};` });
  const { bytes, maxDiff } = await page.evaluate(async () => {
    const { recipes } = await import('/dist/recipes.js' as string);
    return (window as any).compareCache((window as any).sfx, recipes, OfflineAudioContext, 1e-5);
  });
  console.log(`mono vs stereo cache: max sample difference ${maxDiff}`);
  expect(bytes).toBeLessThanOrEqual(3_050_000);
});
