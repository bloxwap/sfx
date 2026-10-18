import { defineConfig, devices } from '@playwright/test';
// Verifies the deployed site (DOCS_URL) in Chromium and WebKit; nothing is served locally.
export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
