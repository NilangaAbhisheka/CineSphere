/**
 * Workflow G — Data Import (JSON & CSV) E2E Test
 *
 * Tests the Stage 4.4 Data Import interface:
 * Navigation to /import from Library, page rendering, format guide cards,
 * dropzone interaction, validation error reporting (atomic rollback on bad JSON),
 * and successful CSV import with result link back to My Library.
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TMDB_ID } from '../global-setup';
import { deleteLibraryEntriesByIds, listLibraryEntries } from '../helpers/api';
import { navigateTo } from '../helpers/pages';

test.describe('Workflow G — Data Import', () => {
  const createdEntryIds: string[] = [];

  test.afterAll(async () => {
    // Collect any [E2E] library entries created during the test
    const entries = await listLibraryEntries().catch(() => []);
    for (const entry of entries) {
      if (entry.title.includes('[E2E]') && !createdEntryIds.includes(entry.id)) {
        createdEntryIds.push(entry.id);
      }
    }
    if (createdEntryIds.length > 0) {
      await deleteLibraryEntriesByIds(createdEntryIds);
      createdEntryIds.length = 0;
    }
  });

  test('G1: Import page is accessible from Library and renders format guide and dropzone', async ({
    page,
  }) => {
    await navigateTo(page, '/library');
    await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();

    // Click "Import Data" link in the library header
    const importLink = page.getByRole('link', { name: 'Import Data' });
    await expect(importLink).toBeVisible();
    await importLink.click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/import/);
    // Actual heading on the import page
    await expect(page.getByRole('heading', { name: 'Import Library Data' })).toBeVisible();
    await expect(
      page.getByText('Import your personal movie and TV tracking data from a JSON or CSV file.'),
    ).toBeVisible();

    // Format guide cards — the card titles are bold spans, not headings
    await expect(page.getByText('JSON', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('CSV', { exact: true }).first()).toBeVisible();

    // Dropzone
    await expect(page.getByRole('button', { name: 'File drop area' })).toBeVisible();
  });

  test('G2: Uploading an invalid JSON file reports validation errors without importing', async ({
    page,
  }) => {
    await navigateTo(page, '/import');

    // Invalid JSON payload: status is not a valid LibraryStatus
    const invalidJson = JSON.stringify({
      version: '1.0',
      exportedAt: '2026-11-17T00:00:00.000Z',
      entries: [
        {
          mediaType: 'MOVIE',
          tmdbId: E2E_MOVIE_TMDB_ID,
          status: 'INVALID_STATUS_VALUE',
        },
      ],
    });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'invalid-library.json',
      mimeType: 'application/json',
      buffer: Buffer.from(invalidJson),
    });

    // After selecting the file, the dropzone shows the filename and format badge (lowercase 'json')
    await expect(page.getByRole('button', { name: 'File drop area' })).toContainText(
      'invalid-library.json',
    );

    // Click Import File
    const importButton = page.getByRole('button', { name: 'Import File' });
    await expect(importButton).toBeEnabled();
    await importButton.click();

    // Should display the validation error panel
    await expect(
      page.getByRole('alert').filter({ hasText: 'Import Failed — Validation Errors' }),
    ).toBeVisible({ timeout: 10_000 });

    // Error list should mention an invalid status
    await expect(page.getByText(/must be one of/i)).toBeVisible();

    // Footer confirms no personal tracking records were written
    await expect(
      page.getByText(
        'No personal tracking records were written. Fix the errors in your file and try again.',
      ),
    ).toBeVisible();
  });

  test('G3: Uploading a valid CSV file imports the entry and shows a success summary', async ({
    page,
  }) => {
    // Ensure the E2E movie is not already in the library so the import is not skipped
    const initialEntries = await listLibraryEntries().catch(() => []);
    const existing = initialEntries.filter((e) => e.title.includes('[E2E]'));
    if (existing.length > 0) {
      await deleteLibraryEntriesByIds(existing.map((e) => e.id));
    }

    await navigateTo(page, '/import');

    // Valid CSV targeting the seeded E2E movie
    const validCsv = [
      'tmdb_id,media_type,status,personal_rating,notes,created_at',
      `${E2E_MOVIE_TMDB_ID},movie,PLAN_TO_WATCH,9.0,Imported via E2E test,2026-11-17`,
    ].join('\n');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'e2e-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(validCsv),
    });

    // Dropzone shows the uploaded filename
    await expect(page.getByRole('button', { name: 'File drop area' })).toContainText(
      'e2e-import.csv',
    );

    // Click Import File
    const importButton = page.getByRole('button', { name: 'Import File' });
    await expect(importButton).toBeEnabled();
    await importButton.click();

    // Success result panel
    await expect(page.getByRole('status').filter({ hasText: '✓ Import Complete' })).toBeVisible({
      timeout: 15_000,
    });

    // "View My Library" link navigates back to /library
    const viewLibraryLink = page.getByRole('link', { name: 'View My Library' });
    await expect(viewLibraryLink).toBeVisible();
    await viewLibraryLink.click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByText('[E2E] Inception Test Film')).toBeVisible();
  });
});
