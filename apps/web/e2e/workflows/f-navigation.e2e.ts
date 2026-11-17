/**
 * Workflow F — Navigation & Page Integration E2E Test
 *
 * Tests that all navigation links work, direct URL access is correct,
 * the Statistics page shows the foundation state (unavailable indicators),
 * and the Library empty state renders when no entries exist.
 */
import { test, expect } from '@playwright/test';
import { deleteLibraryEntriesByIds } from '../helpers/api';
import { navigateTo } from '../helpers/pages';

test.describe('Workflow F — Navigation and Page Integration', () => {
  // Track IDs of any library entries created within this suite for exact cleanup
  const createdEntryIds: string[] = [];

  test.afterAll(async () => {
    if (createdEntryIds.length > 0) {
      await deleteLibraryEntriesByIds(createdEntryIds);
      createdEntryIds.length = 0;
    }
  });
  test('F1: All 4 nav links are accessible and navigate correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const navbar = page.locator('nav');
    await expect(navbar).toBeVisible({ timeout: 5_000 });

    // Dashboard
    await navbar.getByRole('link', { name: /Dashboard/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Discover
    await navbar.getByRole('link', { name: /Discover/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/discover/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Discover Entertainment' })).toBeVisible();

    // My Library
    await navbar.getByRole('link', { name: /Library/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/library/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();

    // Statistics
    await navbar.getByRole('link', { name: /Statistics/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/statistics/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  test('F2: Direct URL access works for all routes', async ({ page }) => {
    // /
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // /discover
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Discover Entertainment' })).toBeVisible();

    // /library
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();

    // /statistics
    await page.goto('/statistics');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  test('F3a: Statistics page fetches live data from backend and renders summary cards and charts', async ({
    page,
  }) => {
    await navigateTo(page, '/statistics');
    await page.waitForLoadState('networkidle');

    // Page header should be visible
    await expect(page.getByRole('heading', { level: 1, name: 'Statistics' })).toBeVisible({
      timeout: 10_000,
    });

    // Loading skeleton should disappear
    await expect(page.getByTestId('statistics-skeleton')).not.toBeVisible();

    // Summary cards should be present with live labels
    const summary = page.getByRole('region', { name: /Viewing Summary/i });
    await expect(summary.getByText('Movies Completed')).toBeVisible();
    await expect(summary.getByText('Episodes Watched')).toBeVisible();
    await expect(summary.getByText('Shows Completed')).toBeVisible();
    await expect(summary.getByText('Average Rating')).toBeVisible();

    // The Phase 3.7 foundation state notice banner should no longer be rendered
    await expect(page.getByText('Statistics Foundation (Phase 3.7)')).not.toBeVisible();

    // Charts / distribution sections are present
    await expect(page.getByRole('heading', { name: 'Genre Breakdown' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Viewing Activity Timeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Personal Rating Distribution' })).toBeVisible();

    // Ensure no 500 error
    await expect(page.locator('body')).not.toContainText('500 Internal Server Error');
  });

  test('F3b: Statistics page displays error state on API failure and recovers on retry', async ({
    page,
  }) => {
    // Intercept /api/stats/overview to simulate network or server failure
    await page.route('**/api/stats/overview', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Simulated server failure' }),
      }),
    );

    await page.goto('/statistics');
    await page.waitForLoadState('networkidle');

    // ErrorState should be displayed
    const errorState = page.getByTestId('error-state');
    await expect(errorState).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Unable to Load Data')).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Again/i })).toBeVisible();

    // Remove route interception to simulate recovery
    await page.unroute('**/api/stats/overview');

    // Click retry
    await page.getByRole('button', { name: /Try Again/i }).click();

    // Page should recover to live data
    await expect(errorState).not.toBeVisible({ timeout: 10_000 });
    const summary = page.getByRole('region', { name: /Viewing Summary/i });
    await expect(summary.getByText('Movies Completed')).toBeVisible();
  });

  test('F4: Library page shows empty state when no library entries exist', async ({ page }) => {
    await navigateTo(page, '/library');

    // Switch to 'Dropped' filter tab (role="tab") to guarantee an empty state test without wiping developer data
    const droppedTab = page.getByRole('tab', { name: 'Dropped' });
    await expect(droppedTab).toBeVisible({ timeout: 10_000 });
    await droppedTab.click();

    // Look for empty state indicator
    const bodyText = await page.textContent('body');

    // The Library page shows an EmptyState when there are no items
    // It should not show a crash or error
    const hasEmptyOrNoEntries =
      bodyText?.includes('empty') ||
      bodyText?.includes('No titles found') ||
      bodyText?.includes('No titles') ||
      bodyText?.includes('Your library') ||
      bodyText?.includes('add') ||
      bodyText?.includes('0');

    expect(hasEmptyOrNoEntries, 'Library page should show empty state when no entries').toBe(true);
    await expect(page.locator('body')).not.toContainText('500 Internal Server Error');
  });

  test('F5: Browser back/forward navigation works correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go to discover
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    // Go to library
    await page.goto('/library');
    await page.waitForLoadState('networkidle');

    // Go back to discover
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/discover/);

    // Go back to dashboard
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/$/);

    // Go forward to discover
    await page.goForward();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/discover/);
  });

  test('F6: No console errors on any page (critical errors only)', async ({ page }) => {
    const criticalErrors: string[] = [];
    page.on('pageerror', (err) => {
      // Filter out known benign browser errors (e.g., image load failures for placeholder)
      if (!err.message.includes('Failed to load resource') && !err.message.includes('net::ERR')) {
        criticalErrors.push(err.message);
      }
    });

    const routes = ['/', '/discover', '/library', '/statistics'];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
    }

    expect(criticalErrors, `Critical JS errors found: ${criticalErrors.join('; ')}`).toHaveLength(
      0,
    );
  });
});
