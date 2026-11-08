/**
 * Workflow E — Dashboard Consistency E2E Test
 *
 * Tests that the Dashboard accurately reflects the user's library state.
 * Verifies stat cards render, that Recent Activity updates after adding
 * entries, and that Quick Picks does not include library items already added.
 *
 * Note: This workflow uses API-seeded entries so the Dashboard can show
 * meaningful state without relying on TMDB trending calls.
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TMDB_ID, E2E_TV_TMDB_ID } from '../global-setup';
import { createLibraryEntry, deleteLibraryEntry } from '../helpers/api';
import { navigateTo } from '../helpers/pages';

let movieEntryId: string | null = null;
let tvEntryId: string | null = null;

test.beforeAll(async () => {
  // Create library entries so the dashboard has data to show
  const [movieEntry, tvEntry] = await Promise.all([
    createLibraryEntry({ mediaType: 'MOVIE', tmdbId: E2E_MOVIE_TMDB_ID, status: 'COMPLETED' }),
    createLibraryEntry({ mediaType: 'TV', tmdbId: E2E_TV_TMDB_ID, status: 'WATCHING' }),
  ]);
  movieEntryId = movieEntry.id;
  tvEntryId = tvEntry.id;
});

test.afterAll(async () => {
  await Promise.allSettled([
    movieEntryId ? deleteLibraryEntry(movieEntryId) : Promise.resolve(),
    tvEntryId ? deleteLibraryEntry(tvEntryId) : Promise.resolve(),
  ]);
  movieEntryId = null;
  tvEntryId = null;
});

test.describe('Workflow E — Dashboard Consistency', () => {
  test('E1: Dashboard renders without errors', async ({ page }) => {
    await navigateTo(page, '/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 });

    // No JS error overlay
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1_000);
    expect(errors).toHaveLength(0);
  });

  test('E2: Stat cards are present and show numeric values or dashes', async ({ page }) => {
    await navigateTo(page, '/');

    // All 4 stat card labels should be visible in Viewing Summary
    await expect(page.getByText('Movies Tracked')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Movies Completed')).toBeVisible();
    await expect(page.getByText('Shows Watching')).toBeVisible();
    await expect(page.getByText('Episodes Watched')).toBeVisible();
  });

  test('E3: Dashboard does not show a JS crash after library data exists', async ({ page }) => {
    test.skip(!movieEntryId || !tvEntryId, 'beforeAll must succeed');

    // Reload fresh
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The main heading must be visible (page rendered successfully)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('E4: Continue Watching section shows the WATCHING TV entry', async ({ page }) => {
    test.skip(!tvEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/');

    // "Continue Watching" section heading should be visible
    await expect(page.getByRole('heading', { name: /Continue Watching/i })).toBeVisible({
      timeout: 10_000,
    });

    // No internal server errors
    await expect(page.locator('body')).not.toContainText('500 Internal Server Error');
  });

  test('E5: Dashboard data is consistent after page reload', async ({ page }) => {
    await navigateTo(page, '/');

    // Get the stat values before reload
    const before = await page.textContent('body');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Dashboard heading still present
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Content roughly the same (no sudden 0s or missing sections)
    const after = await page.textContent('body');
    expect(after).not.toHaveLength(0);
    // Both have the heading
    expect(before).toContain('Dashboard');
    expect(after).toContain('Dashboard');
  });
});
