/**
 * Workflow D — Library Detail Modal Integration E2E Test
 *
 * Tests the modal's full integration: add both a movie and a TV show entry,
 * verify status/rating/notes updates are reflected immediately (no stale state),
 * and confirm that closing and reopening the modal shows fresh data.
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TMDB_ID, E2E_TV_TMDB_ID } from '../global-setup';
import { createLibraryEntry, deleteLibraryEntry } from '../helpers/api';
import {
  navigateTo,
  getDetailModal,
  changeDetailModalStatus,
  setDetailModalRating,
  saveDetailModalNotes,
  closeDetailModal,
} from '../helpers/pages';

let movieEntryId: string | null = null;
let tvEntryId: string | null = null;

test.beforeAll(async () => {
  const [movieEntry, tvEntry] = await Promise.all([
    createLibraryEntry({ mediaType: 'MOVIE', tmdbId: E2E_MOVIE_TMDB_ID, status: 'PLAN_TO_WATCH' }),
    createLibraryEntry({ mediaType: 'TV', tmdbId: E2E_TV_TMDB_ID, status: 'PLAN_TO_WATCH' }),
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

test.describe('Workflow D — Library Detail Modal Integration', () => {
  test('D1: Library page shows both movie and TV entries', async ({ page }) => {
    test.skip(!movieEntryId || !tvEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    const cards = page.getByTestId('library-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('D2: Open movie modal, change status, close, reopen — no stale data', async ({ page }) => {
    test.skip(!movieEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    // Open first card's modal — find movie card specifically
    // Click "Manage Tracking" on the MOVIE card
    const cards = page.getByTestId('library-card');
    let movieCardIndex = -1;
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).textContent();
      if (text?.includes('Movie') || text?.includes('[E2E] Inception')) {
        movieCardIndex = i;
        break;
      }
    }

    if (movieCardIndex === -1) movieCardIndex = 0; // fallback to first

    await cards.nth(movieCardIndex).getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Change status to Watching
    await changeDetailModalStatus(page, 'Watching');

    // Close modal
    await closeDetailModal(page);

    // Reopen the same card
    await cards.nth(movieCardIndex).getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // The Watching button should be active (highlighted)
    const watchingBtn = getDetailModal(page).getByRole('button', { name: 'Watching' });
    await expect(watchingBtn).toBeVisible();
    // The button should have the active CSS class (sky-500 border)
    await expect(watchingBtn).toHaveClass(/sky-500|sky-300/);
  });

  test('D3: Rating persists after close and reopen', async ({ page }) => {
    test.skip(!movieEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    const cards = page.getByTestId('library-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Open first card
    await cards.first().getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Set rating to 7.5
    await setDetailModalRating(page, '7.5');

    // Close and reopen
    await closeDetailModal(page);

    await cards.first().getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Rating should be 7.5
    const ratingSelect = getDetailModal(page).locator('#detail-rating-select');
    await expect(ratingSelect).toHaveValue('7.5');
  });

  test('D4: Notes persist after close and reopen', async ({ page }) => {
    test.skip(!movieEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    const cards = page.getByTestId('library-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Open first card
    await cards.first().getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await saveDetailModalNotes(page, 'D4 integration test note');

    // Close and reopen
    await closeDetailModal(page);

    await cards.first().getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const notesArea = getDetailModal(page).locator('#detail-notes-input');
    await expect(notesArea).toHaveValue('D4 integration test note');
  });

  test('D5: TV entry modal shows episode section (not movie tracking)', async ({ page }) => {
    test.skip(!tvEntryId, 'beforeAll must succeed');

    await navigateTo(page, '/library');

    // Find TV card
    const cards = page.getByTestId('library-card');
    const count = await cards.count();
    let tvIndex = count - 1; // TV added after movie, likely last
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).textContent();
      if (text?.includes('TV') || text?.includes('[E2E] Breaking')) {
        tvIndex = i;
        break;
      }
    }

    await cards.nth(tvIndex).getByRole('button', { name: 'Manage Tracking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const modal = getDetailModal(page);

    // Should have episode rows (TV tracking section)
    const episodeRows = modal.locator('[data-testid^="episode-row-"]');
    await expect(episodeRows.first()).toBeVisible({ timeout: 10_000 });

    // Should NOT have "Log Viewing Event" button (movie-only feature)
    await expect(modal.getByRole('button', { name: /Log Viewing Event/i })).not.toBeVisible();
  });
});
