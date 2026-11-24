import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build with the fetch endpoint mocked per test,
// so they need no network and no Netlify CLI. Set PW_CHANNEL=chrome to use an installed Chrome.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: 'npm run build:app && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
