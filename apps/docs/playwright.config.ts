import { defineConfig, devices } from '@playwright/test';
// Verifies the deployed site (DOCS_URL) in all three engines; nothing is served locally.
export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: !process.env.CI } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
