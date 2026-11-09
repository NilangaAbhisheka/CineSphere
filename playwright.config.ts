import { defineConfig, devices } from '@playwright/test';
import { getE2eDatabaseUrl } from './apps/web/e2e/config/database-config';

/**
 * CineSphere E2E Playwright configuration.
 *
 * Database isolation guarantee:
 *   E2E execution requires a dedicated test database (e.g. cinesphere_test).
 *   The URL is validated fail-closed via getE2eDatabaseUrl().  Missing,
 *   malformed, or development database URLs are rejected before any server
 *   starts or any database connection is opened.
 *
 *   The NestJS API process launched for E2E tests receives this dedicated
 *   URL as DATABASE_URL — the variable Prisma reads.  Both global-setup
 *   and the NestJS API process are guaranteed to target the exact same
 *   isolated database.
 *
 * Server isolation guarantee:
 *   In local development, reuseExistingServer is strictly false.  Playwright
 *   will never silently reuse an ordinary development API server that might
 *   be connected to the developer's personal "cinesphere" database.
 *   In CI, reuseExistingServer is true only because the workflow starts a
 *   dedicated production API against the CI test database service before
 *   running Playwright.
 *
 * Required environment variable:
 *   CINESPHERE_E2E_DATABASE_URL — connection string for dedicated test DB.
 */

// Fail-closed validation at configuration time:
const e2eDbUrl = getE2eDatabaseUrl();
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './apps/web/e2e',
  /* Glob to match test files — use .e2e.ts suffix to prevent Jest collision */
  testMatch: '**/*.e2e.ts',
  /* Run tests sequentially to avoid database side-effect races */
  fullyParallel: false,
  /* Fail CI immediately on test.only leakage */
  forbidOnly: isCI,
  /* One retry in CI to reduce flakiness from timing issues */
  retries: isCI ? 1 : 0,
  /* Single worker — shared E2E DB requires serial execution */
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
  webServer: [
    {
      /**
       * NestJS API server.
       * Local: starts a dedicated process targeting CINESPHERE_E2E_DATABASE_URL.
       * reuseExistingServer is false to prevent reusing a development server.
       * CI: reuses the dedicated test API process started by the workflow.
       */
      command: 'pnpm --filter @cinesphere/api dev',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: isCI,
      timeout: 120_000,
      env: {
        DATABASE_URL: e2eDbUrl,
        CINESPHERE_E2E_DATABASE_URL: e2eDbUrl,
        CINESPHERE_SINGLE_USER_ID:
          process.env.CINESPHERE_SINGLE_USER_ID ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      },
    },
    {
      /**
       * Next.js web server.
       * Local: starts a fresh dev server.
       * CI: starts a fresh dev server (unless already running).
       */
      command: 'pnpm --filter @cinesphere/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: isCI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
      },
    },
  ],
});
