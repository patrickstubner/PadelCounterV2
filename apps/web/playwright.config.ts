import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:4173/PadelCounterV2/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
