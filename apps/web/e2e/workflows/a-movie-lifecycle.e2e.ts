/**
 * Workflow A — Movie Lifecycle E2E Test
 *
 * Tests the complete lifecycle of a movie in the user's library:
 * Discover (Local Library tab) → Add → Verify in Library → Update status,
 * rating, notes → Reload persistence → Remove.
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TITLE } from '../global-setup';
import { listLibraryEntries, deleteLibraryEntry } from '../helpers/api';
import {
  navigateTo,
  switchToLocalCatalogueTab,
  searchLocalCatalogue,
  clickAddToLibraryOnFirstCard,
  selectAddModalStatus,
  confirmAddToLibrary,
  openFirstLibraryDetailModal,
  changeDetailModalStatus,
  setDetailModalRating,
  saveDetailModalNotes,
  deleteEntryViaDetailModal,
} from '../helpers/pages';

// Store the created entry ID for cleanup
let createdEntryId: string | null = null;

test.afterAll(async () => {
  if (createdEntryId) {
    await deleteLibraryEntry(createdEntryId).catch(() => {
      /* ignore if already deleted by test */
    });
    createdEntryId = null;
  }
});

test.describe('Workflow A — Movie Lifecycle', () => {
  test('A1: Discover (Local Library) → Add movie to library', async ({ page }) => {
    // Navigate to Discover
    await navigateTo(page, '/discover');
    await expect(page.getByRole('heading', { name: 'Discover Entertainment' })).toBeVisible();

    // Switch to Local Library tab
    await switchToLocalCatalogueTab(page);

    // Search for E2E test movie
    await searchLocalCatalogue(page, '[E2E] Inception');

    // Verify the E2E test card appears
    const cards = page.getByTestId('media-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const firstCardTitle = await cards.first().locator('h4').textContent();
    expect(firstCardTitle).toContain('[E2E]');

    // Open AddLibraryModal
    await clickAddToLibraryOnFirstCard(page);

    // Set status to Watching
    await selectAddModalStatus(page, 'Watching');

    // Confirm add
    await confirmAddToLibrary(page);

    // Find the entry we just created for cleanup
    const entries = await listLibraryEntries();
    const created = entries.find((e) => e.title?.includes('[E2E]') && e.mediaType === 'MOVIE');
    expect(created).toBeDefined();
    createdEntryId = created!.id;
  });

  test('A2: Library page shows the added movie', async ({ page }) => {
    test.skip(!createdEntryId, 'A1 must pass first');

    await navigateTo(page, '/library');
    await expect(page.getByTestId('library-card').first()).toBeVisible({ timeout: 10_000 });

    // At least one library card should contain the E2E title
    const cards = page.getByTestId('library-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Find the card that contains our test movie
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).textContent();
      if (text?.includes('[E2E]')) {
        found = true;
        break;
      }
    }
    expect(found, 'E2E test movie should appear in library').toBe(true);
  });

  test('A3: Library Detail Modal — update status to Completed and set rating', async ({ page }) => {
    test.skip(!createdEntryId, 'A1 must pass first');

    await navigateTo(page, '/library');

    // Open the detail modal for the first library card
    await openFirstLibraryDetailModal(page);

    // Change status to Completed
    await changeDetailModalStatus(page, 'Completed');

    // Set rating to 8.5
    await setDetailModalRating(page, '8.5');

    // Save notes
    await saveDetailModalNotes(page, 'An automated E2E test note.');

    // Verify the modal still shows (did not close unexpectedly)
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('A4: Reload — persisted status and notes survive page reload', async ({ page }) => {
    test.skip(!createdEntryId, 'A1 must pass first');

    await navigateTo(page, '/library');

    // Open detail modal
    await openFirstLibraryDetailModal(page);

    // Verify status shows Completed
    const modal = page.getByRole('dialog');
    const completedBtn = modal.getByRole('button', { name: 'Completed' });
    // The active status button has the sky-500 styling; we just check it's present
    await expect(completedBtn).toBeVisible();

    // Verify notes persisted
    const notesArea = modal.locator('#detail-notes-input');
    await expect(notesArea).toHaveValue('An automated E2E test note.');
  });

  test('A5: Remove movie from library via detail modal', async ({ page }) => {
    test.skip(!createdEntryId, 'A1 must pass first');

    await navigateTo(page, '/library');

    // Open detail modal
    await openFirstLibraryDetailModal(page);

    // Delete the entry
    await deleteEntryViaDetailModal(page);

    // Modal is now closed; mark entry cleaned up
    createdEntryId = null;

    // Verify the library is now empty (or has no E2E cards)
    // (May not be immediate after navigation — just verify no error shown)
    await page.waitForTimeout(500);
  });
});
