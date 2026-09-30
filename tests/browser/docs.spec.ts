import { test, expect } from '@playwright/test';
const live = process.env.DOCS_URL;
test.skip(!live, 'Set DOCS_URL to verify the deployed docs');

test('deployed board, controls, demo, search and public resources', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(live!);
  const success = page.getByRole('button', { name: 'Play success:', exact: false });
  await success.click();
  await expect(page.getByText('Pre-rendered', { exact: true })).toBeVisible();
  await expect(page.locator('.board-code, .board-snippet').filter({ hasText: "play('success')" })).toBeVisible();
  await page.keyboard.press('q');
  await expect(page.locator('.pad--last')).toContainText('chime');
  for (const label of ['Master volume', 'Per-sound volume', 'Playback rate', 'Stereo pan']) {
    const slider = page.getByRole('slider', { name: label });
    const before = await slider.inputValue();
    await slider.focus(); await page.keyboard.press('ArrowRight');
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
