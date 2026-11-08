/**
 * Workflow C — TV Episode Progress E2E Test
 *
 * Tests that episode progress is tracked correctly for a TV show library
 * entry.  Verifies toggle (mark watched / unmark), persistence across reload,
 * and that individual episode state is independent.
 */
import { test, expect } from '@playwright/test';
import { E2E_TV_TMDB_ID } from '../global-setup';
import { createLibraryEntry, deleteLibraryEntry, listLibraryEntries } from '../helpers/api';
import { navigateTo, openFirstLibraryDetailModal, getDetailModal } from '../helpers/pages';

let createdEntryId: string | null = null;

// We'll store episode IDs found in the UI to toggle them
let episodeIds: string[] = [];

test.beforeAll(async () => {
  const entry = await createLibraryEntry({
    mediaType: 'TV',
    tmdbId: E2E_TV_TMDB_ID,
    status: 'WATCHING',
  });
  createdEntryId = entry.id;
});

test.afterAll(async () => {
  if (createdEntryId) {
    await deleteLibraryEntry(createdEntryId).catch(() => {});
    createdEntryId = null;
  }
});

test.describe('Workflow C — TV Episode Progress', () => {
  test('C1: Library Detail Modal shows Season 1 with 3 episodes', async ({ page }) => {
    test.skip(!createdEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');
    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);

    // Find all episode rows (data-testid="episode-row-{uuid}")
    const rows = modal.locator('[data-testid^="episode-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Collect episode IDs for subsequent tests
    episodeIds = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      const testId = await rows.nth(i).getAttribute('data-testid');
      if (testId) {
        const id = testId.replace('episode-row-', '');
        episodeIds.push(id);
      }
    }
    expect(episodeIds.length).toBe(3);
  });

  test('C2: Mark Episode 1 as watched', async ({ page }) => {
    test.skip(!createdEntryId || episodeIds.length < 1, 'C1 must pass first');

    await navigateTo(page, '/library');
    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);
    const ep1Row = modal.getByTestId(`episode-row-${episodeIds[0]}`);

    // Episode 1 should be unwatched initially
    const btn = ep1Row.getByRole('button');
    await expect(btn).toContainText('Mark Watched', { timeout: 5_000 });

    // Click to mark watched
    await btn.click();
    await page.waitForTimeout(1_000);
    await page.waitForLoadState('networkidle');

    // Should now show Watched
    await expect(btn).toContainText('Watched', { timeout: 5_000 });
  });

  test('C3: Mark Episode 2 as watched — Episodes 1 and 2 are both watched', async ({ page }) => {
    test.skip(!createdEntryId || episodeIds.length < 2, 'C2 must pass first');

    await navigateTo(page, '/library');
    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);

    // Episode 1 should still be watched
    const ep1Btn = modal.getByTestId(`episode-row-${episodeIds[0]}`).getByRole('button');
    await expect(ep1Btn).toContainText('Watched', { timeout: 5_000 });

    // Mark Episode 2
    const ep2Btn = modal.getByTestId(`episode-row-${episodeIds[1]}`).getByRole('button');
    await expect(ep2Btn).toContainText('Mark Watched');
    await ep2Btn.click();
    await page.waitForTimeout(1_000);
    await page.waitForLoadState('networkidle');
    await expect(ep2Btn).toContainText('Watched', { timeout: 5_000 });

    // Episode 3 should still be unwatched
    const ep3Btn = modal.getByTestId(`episode-row-${episodeIds[2]}`).getByRole('button');
    await expect(ep3Btn).toContainText('Mark Watched');
  });

  test('C4: Reload — episode progress persists', async ({ page }) => {
    test.skip(!createdEntryId || episodeIds.length < 2, 'C3 must pass first');

    // Navigate away and return
    await navigateTo(page, '/');
    await navigateTo(page, '/library');
    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);

    // Both Episode 1 and 2 should still be watched
    const ep1Btn = modal.getByTestId(`episode-row-${episodeIds[0]}`).getByRole('button');
    const ep2Btn = modal.getByTestId(`episode-row-${episodeIds[1]}`).getByRole('button');
    const ep3Btn = modal.getByTestId(`episode-row-${episodeIds[2]}`).getByRole('button');

    await expect(ep1Btn).toContainText('Watched', { timeout: 5_000 });
    await expect(ep2Btn).toContainText('Watched', { timeout: 5_000 });
    await expect(ep3Btn).toContainText('Mark Watched');
  });

  test('C5: Unmark Episode 1 — Episode 2 remains watched', async ({ page }) => {
    test.skip(!createdEntryId || episodeIds.length < 2, 'C4 must pass first');

    await navigateTo(page, '/library');
    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);

    // Unmark Episode 1
    const ep1Btn = modal.getByTestId(`episode-row-${episodeIds[0]}`).getByRole('button');
    await expect(ep1Btn).toContainText('Watched', { timeout: 5_000 });
    await ep1Btn.click();
    await page.waitForTimeout(1_000);
    await page.waitForLoadState('networkidle');

    // Episode 1 is now unwatched
    await expect(ep1Btn).toContainText('Mark Watched', { timeout: 5_000 });

    // Episode 2 is still watched
    const ep2Btn = modal.getByTestId(`episode-row-${episodeIds[1]}`).getByRole('button');
    await expect(ep2Btn).toContainText('Watched');
  });
});
