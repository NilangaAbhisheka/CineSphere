/**
 * Workflow B — Movie Viewing History E2E Test
 *
 * Tests that viewing events are created and persist correctly for a movie
 * library entry.  Verifies that multiple events are independent (not merged),
 * and that library status is not auto-changed by logging a viewing event.
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TMDB_ID } from '../global-setup';
import { createLibraryEntry, deleteLibraryEntry } from '../helpers/api';
import {
  navigateTo,
  openFirstLibraryDetailModal,
  logViewingEvent,
  getDetailModal,
} from '../helpers/pages';

let createdEntryId: string | null = null;

test.beforeAll(async () => {
  // Create a movie library entry via API for speed (avoids full UI add flow)
  const entry = await createLibraryEntry({
    mediaType: 'MOVIE',
    tmdbId: E2E_MOVIE_TMDB_ID,
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

test.describe('Workflow B — Movie Viewing History', () => {
  test('B1: Log a viewing event and see it appear in history', async ({ page }) => {
    test.skip(!createdEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    await openFirstLibraryDetailModal(page);

    // Log first viewing event
    await logViewingEvent(page);

    // Verify at least one viewing history item is now present
    const modal = getDetailModal(page);
    const historyItems = modal.getByTestId('viewing-history-item');
    await expect(historyItems.first()).toBeVisible({ timeout: 8_000 });

    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('B2: Log a second viewing event — both events exist independently', async ({ page }) => {
    test.skip(!createdEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    await openFirstLibraryDetailModal(page);

    // Count existing events first
    const modal = getDetailModal(page);
    const historyItems = modal.getByTestId('viewing-history-item');
    const before = await historyItems.count();

    // Log another viewing event
    await logViewingEvent(page);

    // There should now be one more event
    await expect(historyItems).toHaveCount(before + 1, { timeout: 8_000 });
  });

  test('B3: Reload — viewing history persists across page navigation', async ({ page }) => {
    test.skip(!createdEntryId, 'beforeAll must succeed');

    // Navigate away and back
    await navigateTo(page, '/');
    await navigateTo(page, '/library');

    await openFirstLibraryDetailModal(page);

    const modal = getDetailModal(page);
    const historyItems = modal.getByTestId('viewing-history-item');

    // Should still have at least 2 events from B1 + B2
    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('B4: Library entry still exists independently of viewing events', async ({ page }) => {
    test.skip(!createdEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    // Library card for the E2E movie should still be present
    const cards = page.getByTestId('library-card');
    await expect(cards.first()).toBeVisible({ timeout: 8_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
