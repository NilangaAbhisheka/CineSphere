import { defineConfig, devices } from '@playwright/test';

/**
 * CineSphere E2E Playwright configuration.
 *
 * Tests run sequentially (workers: 1) because they share a single dev database.
 * The Next.js dev server is started automatically; the NestJS API must be
 * running independently on port 4000 before `pnpm test:e2e` is invoked.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  /* Glob to match test files — use .e2e.ts suffix to prevent Jest collision */
  testMatch: '**/*.e2e.ts',
  /* Run tests sequentially to avoid database side-effect races */
  fullyParallel: false,
  /* Fail CI immediately on test.only leakage */
  forbidOnly: !!process.env.CI,
  /* One retry in CI to reduce flakiness from timing issues */
  retries: process.env.CI ? 1 : 0,
  /* Single worker — shared dev DB requires serial execution */
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'apps/web/playwright-report' }]],
  use: {
    /* Base URL for page.goto('/') calls */
    baseURL: 'http://localhost:3000',
    /* Capture traces on first retry to aid debugging */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Generous default timeout for slow CI environments */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /* Global test lifecycle hooks */
  globalSetup: './apps/web/e2e/global-setup.ts',
  globalTeardown: './apps/web/e2e/global-teardown.ts',
  /* Auto-start NestJS API and Next.js dev server; reuse if already running */
  webServer: [
    {
      command: 'pnpm --filter @cinesphere/api dev',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @cinesphere/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
      },
    },
  ],
});
