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
  await expect.poll(() => page.evaluate(() => (window as any).audioProof.starts)).toBe(1);
  const before = await page.evaluate(() => (window as any).audioProof.starts);
  await preview.getByRole('button', { name: 'Accept action' }).focus();
  // Space clicks on keyup. Keep this independent activation outside play()'s
  // 16 ms same-sound cooldown, even on fast self-hosted WebKit runners.
  await page.keyboard.press('Space', { delay: 50 });
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
  // Poll: Fumadocs' responsive header settles a frame after the viewport changes.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.clearCookies();
});

test('HIG shell: install tabs and copy, search states, callout, 404, keyboard and mobile navigation', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(live!);
  await page.locator('html[data-docs-hydrated=true]').waitFor();

  // Keyboard: the header, hero actions and install tabs are reachable in order with a visible HIG focus ring.
  const reached: string[] = [];
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      if (getComputedStyle(active).outlineStyle === 'none') return 'no-focus-ring';
      return (active.getAttribute('aria-label') ?? active.textContent ?? '').trim();
    }));
  }
  expect(reached).not.toContain('no-focus-ring');
  // WebKit leaves links out of the Tab sequence unless the OS full-keyboard-access setting is on.
  if (browserName !== 'webkit') expect(reached.some(label => label.startsWith('Play the sound board'))).toBe(true);
  expect(reached).toContain('bun');

  // HIG control CSS reads --hig-font-sans (hig#65): with no host bridge, buttons still render in a loaded Bloxwap face.
  const buttonFace = await page.locator('.package-install .hig-button').first().evaluate(async (button) => {
    await document.fonts.ready;
    const family = getComputedStyle(button).fontFamily.split(',')[0].trim().replace(/["']/g, '');
    return { family, loaded: [...document.fonts].some(face => face.family.replace(/["']/g, '') === family && face.status === 'loaded') };
  });
  expect(buttonFace.family).toMatch(/bloxwap/i);
  expect(buttonFace.loaded).toBe(true);

  // HIG Tabs: roving focus with arrow/End keys; every panel copies its own command with a visible or announced result.
  const tabs = page.getByRole('tablist', { name: 'Package manager' });
  await expect(tabs.getByRole('tab', { name: 'bun', exact: true })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'bun', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'npm', exact: true })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'npm', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'yarn', exact: true })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'yarn', exact: true });
  await expect(panel).toContainText('yarn add @bloxwap/sfx');
  await panel.getByRole('button', { name: 'Copy install command' }).click();
  await expect(panel.getByRole('status')).toContainText(/copied|Could not copy/);

  // Search: keyboard shortcut, HIG no-results state, Escape closes.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('zzqxv');
  await expect(page.getByRole('dialog')).toContainText('No matching pages');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // MDX callouts render through the HIG callout without becoming live regions.
  await page.goto(new URL('docs/guides/native/', live!).href);
  const callout = page.locator('.docs-callout [data-severity="warning"]');
  await expect(callout).toContainText('Platform verification');
  await expect(callout).toContainText('No physical iPhone/Android playback');
  await expect(callout).not.toHaveAttribute('role', /.+/);

  // 404 keeps the base path on its recovery link.
  await page.goto(new URL('missing-page/', live!).href);
  await expect(page.getByRole('heading', { name: 'That page is missing.' })).toBeVisible();
  expect(await page.getByRole('link', { name: 'Open documentation' }).getAttribute('href')).toBe(new URL('docs/', live!).pathname);

  // Mobile navigation at 390 px: no horizontal scroll, sidebar opens and navigates to a deep link.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('docs/getting-started/', live!).href);
  await page.locator('html[data-docs-hydrated=true]').waitFor();
  // Poll: Fumadocs' responsive header settles a frame after the viewport changes.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open Sidebar' }).first().click();
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await expect(page).toHaveURL(new URL('docs/api/recipes/', live!).href);
  await expect(page.getByRole('region', { name: 'Recipe editor' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // WebKit reports Next's RSC prefetches that a navigation cancels as "access control checks" page errors;
  // those payloads serve 200 from the static export, so only other errors fail the run.
  expect(errors.filter(message => !message.includes('due to access control checks'))).toEqual([]);
});
