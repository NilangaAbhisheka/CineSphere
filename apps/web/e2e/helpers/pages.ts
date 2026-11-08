/**
 * E2E Page Helpers — CineSphere Stage 3.8
 *
 * Reusable Playwright actions and selectors for common UI workflows.
 * Keep these free of test assertions; assertions belong in the test files.
 */
import { type Page, expect } from '@playwright/test';

// ── Navigation ───────────────────────────────────────────────────────────────

export async function navigateTo(page: Page, path: '/' | '/discover' | '/library' | '/statistics') {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

// ── Discover page ─────────────────────────────────────────────────────────────

/**
 * Switches to the "Local Library" (catalogue) tab on the Discover page.
 * Waits for the catalogue search input to be visible.
 */
export async function switchToLocalCatalogueTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Local Library' }).click();
  await expect(page.getByTestId('catalogue-search-input')).toBeVisible();
}

/**
 * Types a search query into the catalogue search input and waits for
 * results to appear (or the empty state to show).
 */
export async function searchLocalCatalogue(page: Page, query: string): Promise<void> {
  const input = page.getByTestId('catalogue-search-input');
  await input.fill(query);
  // Wait for debounce + network + render
  await page.waitForTimeout(600);
  await page.waitForLoadState('networkidle');
}

/**
 * Clicks "Add to Library" on the first media card visible and waits for
 * the AddLibraryModal to appear.
 */
export async function clickAddToLibraryOnFirstCard(page: Page): Promise<void> {
  const firstCard = page.getByTestId('media-card').first();
  await expect(firstCard).toBeVisible({ timeout: 10_000 });
  const addBtn = firstCard.getByRole('button', { name: 'Add to Library' });
  await addBtn.click();
  // Wait for modal dialog to appear
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}

/**
 * Selects a status button inside the AddLibraryModal.
 * @param status The status button label text (e.g. 'Watching', 'Completed').
 */
export async function selectAddModalStatus(page: Page, status: string): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: status }).click();
}

/**
 * Confirms adding to library by clicking the "Add to Library" submit button
 * inside the modal and waits for it to close.
 */
export async function confirmAddToLibrary(page: Page): Promise<void> {
  const modal = page.getByRole('dialog');
  await modal
    .getByRole('button', { name: /Add to Library/i })
    .last()
    .click();
  // The modal auto-closes after 1 second on success; wait up to 8s
  await expect(modal).not.toBeVisible({ timeout: 8_000 });
}

// ── Library page ──────────────────────────────────────────────────────────────

/**
 * Opens the Library Detail Modal for the first library card found.
 */
export async function openFirstLibraryDetailModal(page: Page): Promise<void> {
  const firstCard = page.getByTestId('library-card').first();
  await expect(firstCard).toBeVisible({ timeout: 10_000 });
  await firstCard.getByRole('button', { name: 'Manage Tracking' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}

/**
 * Returns the Library Detail Modal locator (throws if not visible).
 */
export function getDetailModal(page: Page) {
  return page.getByRole('dialog');
}

/**
 * Changes the status of the currently open Library Detail Modal entry.
 * Waits for the auto-save to complete.
 */
export async function changeDetailModalStatus(page: Page, status: string): Promise<void> {
  await getDetailModal(page).getByRole('button', { name: status }).click();
  // Status change auto-saves; wait a moment for the network request
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
}

/**
 * Sets the personal rating dropdown in the Library Detail Modal.
 * @param ratingValue e.g. '8.5' — must match an option value exactly.
 */
export async function setDetailModalRating(page: Page, ratingValue: string): Promise<void> {
  await getDetailModal(page).locator('#detail-rating-select').selectOption(ratingValue);
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
}

/**
 * Fills the notes textarea and clicks Save in the Library Detail Modal.
 */
export async function saveDetailModalNotes(page: Page, notes: string): Promise<void> {
  const modal = getDetailModal(page);
  await modal.locator('#detail-notes-input').fill(notes);
  await modal.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
}

/**
 * Removes the library entry via the detail modal's "Remove from Library"
 * → "Confirm Remove" flow.
 */
export async function deleteEntryViaDetailModal(page: Page): Promise<void> {
  const modal = getDetailModal(page);
  await modal.getByRole('button', { name: 'Remove from Library' }).click();
  await modal.getByRole('button', { name: 'Confirm Remove' }).click();
  // Modal closes after deletion
  await expect(modal).not.toBeVisible({ timeout: 8_000 });
}

/**
 * Closes the Library Detail Modal using the close button.
 */
export async function closeDetailModal(page: Page): Promise<void> {
  await getDetailModal(page).getByRole('button', { name: 'Close modal' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 });
}

// ── Movie viewing event ───────────────────────────────────────────────────────

/**
 * Logs a viewing event for a movie entry in the Library Detail Modal.
 * Clicks "+ Log Viewing Event" and uses the current date.
 */
export async function logViewingEvent(page: Page): Promise<void> {
  const modal = getDetailModal(page);
  await modal.getByRole('button', { name: /Log Viewing Event/i }).click();
  await page.waitForTimeout(1_000);
  await page.waitForLoadState('networkidle');
}

// ── TV episode progress ────────────────────────────────────────────────────────

/**
 * Finds an episode row by its `data-testid="episode-row-{id}"` and clicks
 * the toggle button (Mark Watched / Watched).
 */
export async function toggleEpisodeByTestId(page: Page, episodeId: string): Promise<void> {
  const row = page.getByTestId(`episode-row-${episodeId}`);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.getByRole('button').click();
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle');
}

/**
 * Returns whether an episode row shows the "Watched" state (green button).
 */
export async function isEpisodeWatched(page: Page, episodeId: string): Promise<boolean> {
  const row = page.getByTestId(`episode-row-${episodeId}`);
  const btn = row.getByRole('button');
  const text = await btn.textContent();
  return (text ?? '').includes('Watched');
}
