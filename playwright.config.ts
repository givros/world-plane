import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  outputDir: './output/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5397',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5397',
    url: 'http://127.0.0.1:5397',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
    },
  ],
});
