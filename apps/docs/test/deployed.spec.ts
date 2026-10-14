import { test, expect } from '@playwright/test';
const live = process.env.DOCS_URL;
test.skip(!live, 'Set DOCS_URL to verify the deployed docs');

test('deployed board, controls, demo, search and public resources', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(live!);
  await page.locator('html[data-docs-hydrated=true]').waitFor();
  const success = page.getByRole('button', { name: 'Play success:', exact: false });
  await success.click();
  await expect(page.getByText('Pre-rendered', { exact: true })).toBeVisible();
  await expect(page.locator('.board-code, .board-snippet').filter({ hasText: "play('success')" })).toBeVisible();
  await page.keyboard.press('q');
  await expect(page.locator('.pad--last')).toContainText('chime');
  for (const label of ['Master volume', 'Per-sound volume', 'Playback rate', 'Stereo pan']) {
    const slider = page.getByRole('slider', { name: label });
    const before = await slider.inputValue();
    await slider.focus(); await page.keyboard.press(Number(before) >= Number(await slider.getAttribute('max')) ? 'ArrowLeft' : 'ArrowRight');
    expect(await slider.inputValue()).not.toBe(before);
  }
  await expect(page.locator('canvas.board-scope')).toBeVisible();
  expect(await page.locator('canvas.board-scope').evaluate((element) => (element as HTMLCanvasElement).width > 0 && (element as HTMLCanvasElement).height > 0)).toBe(true);
  await page.locator('.demo-tabs').getByRole('button', { name: 'Activity' }).hover();
  await page.locator('.demo-tabs').getByRole('button', { name: 'Activity' }).click();
  await expect(page.locator('.demo-tabs').getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await expect(page.getByText('Deposited $250.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Deposit amount' }).fill('0');
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await expect(page.getByText('Enter an amount from 1 to 10,000.')).toBeVisible();
  const toggle = page.locator('.demo-switch').first().getByRole('switch');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Disabled', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Search/ }).click();
  await page.getByRole('combobox').fill('binding');
  await expect(page.getByRole('dialog')).toContainText(/bind|Binding/);
  for (const path of ['sitemap.xml', 'llms.txt', 'og/home.png', 'search.json']) {
    const response = await request.get(new URL(path, live!).href);
    expect(response.ok(), path).toBe(true);
  }
  expect(errors).toEqual([]);
});


test('recipe editor edits, previews and copies; semantic preferences survive navigation', async ({ page, context }) => {
  await page.addInitScript(() => {
    const state = { contexts: 0, starts: 0, running: false };
    (window as any).audioProof = state;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options); state.contexts++;
        this.addEventListener('statechange', () => { state.running = this.state === 'running'; });
      }
      override createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => { state.starts++; start(...args); };
        return source;
      }
    };
  });
  await page.goto(new URL('docs/api/recipes/', live!).href);
  await page.locator('html[data-docs-hydrated=true]').waitFor();
  const editor = page.getByRole('region', { name: 'Recipe editor' });
  await expect(editor).toBeVisible();
  const frequency = page.getByRole('slider', { name: 'Recipe frequency' });
  await frequency.fill('880');
  await page.getByRole('slider', { name: 'Recipe decay' }).fill('0.25');
  await expect(editor.locator('pre')).toContainText('880');
  await expect(editor.locator('pre')).toContainText('0.25');
  await editor.getByRole('button', { name: 'Preview sound' }).click();
  // Clipboard support is browser-dependent; verify the actual success/fallback status.
  await editor.getByRole('button', { name: 'Copy recipe' }).click();
  await expect(editor.getByRole('status')).toContainText(/copied|Could not copy/);
  await page.goto(new URL('docs/guides/react/', live!).href);
  await page.locator('html[data-docs-hydrated=true]').waitFor();
  const preview = page.getByRole('region', { name: 'Semantic feedback preview' });
  await expect(preview).toBeVisible();
  await preview.getByRole('slider', { name: 'controls volume', exact: true }).fill('0.2');
  expect(await page.evaluate(() => (window as any).audioProof.contexts)).toBe(0);
  await preview.getByRole('button', { name: 'Accept action' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).audioProof.running)).toBe(true);
  const before = await page.evaluate(() => (window as any).audioProof.starts);
  await preview.getByRole('button', { name: 'Accept action' }).focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).audioProof.starts)).toBe(before + 1);
  await expect(preview.getByRole('status')).toHaveText('Action accepted');
  await preview.getByRole('checkbox', { name: 'Enable sound', exact: true }).uncheck();
  await page.reload();
  await page.locator('html[data-docs-hydrated=true]').waitFor();
  await expect(preview.getByRole('checkbox', { name: 'Enable sound', exact: true })).not.toBeChecked();
  await expect(preview.getByRole('slider', { name: 'controls volume', exact: true })).toHaveValue('0.2');
  await preview.getByRole('button', { name: 'Preview completed outcome' }).click();
  await expect(preview.getByRole('status')).toHaveText('Operation completed');
  expect(await page.evaluate(() => (window as any).audioProof.contexts)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.clearCookies();
});
