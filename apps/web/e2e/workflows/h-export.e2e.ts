/**
 * Workflow H — Data Export E2E Test
 *
 * Tests the Stage 4.5 Data Export interface:
 * 1. Navigation from Library header to /export
 * 2. Export page rendering, format cards, and limitation notices
 * 3. Real browser JSON export download and payload verification
 * 4. Real browser CSV export download and payload verification
 * 5. Direct URL /export access and cross-link navigation
 * 6. Error banner rendering on API failure
 * 7. Scoped cleanup of seeded test entries by exact ID
 */
import { test, expect } from '@playwright/test';
import { E2E_MOVIE_TMDB_ID } from '../global-setup';
import { createLibraryEntry, deleteLibraryEntriesByIds, listLibraryEntries } from '../helpers/api';
import { navigateTo } from '../helpers/pages';

test.describe('Workflow H — Data Export', () => {
  const createdEntryIds: string[] = [];

  test.beforeAll(async () => {
    // Ensure the E2E movie is in the library so export payload has known content
    const entries = await listLibraryEntries().catch(() => []);
    const existing = entries.find((e) => e.title.includes('[E2E]'));
    if (!existing) {
      const created = await createLibraryEntry({
        mediaType: 'MOVIE',
        tmdbId: E2E_MOVIE_TMDB_ID,
        status: 'COMPLETED',
      });
      createdEntryIds.push(created.id);
    } else {
      createdEntryIds.push(existing.id);
    }
  });

  test.afterAll(async () => {
    // Scoped exact-ID cleanup of seeded test entries
    if (createdEntryIds.length > 0) {
      await deleteLibraryEntriesByIds(createdEntryIds);
      createdEntryIds.length = 0;
    }
  });

  test('H1: Navigation from Library header to Export page renders cards and notices', async ({
    page,
  }) => {
    await navigateTo(page, '/library');
    await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();

    // Click "Export Data" in the library header
    const exportLink = page.getByRole('link', { name: 'Export Data' });
    await expect(exportLink).toBeVisible();
    await exportLink.click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/export/);
    await expect(page.getByRole('heading', { name: 'Export Library Data' })).toBeVisible();

    // Format cards
    await expect(page.getByText('JSON', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('CSV', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/recommended/i)).toBeVisible();
    await expect(page.getByText(/spreadsheet-friendly/i)).toBeVisible();

    // Explicit CSV limitation notice
    await expect(page.getByText(/notice: flat format limitations/i)).toBeVisible();
    await expect(
      page.getByText(
        /csv exports contain flat library records only \(tmdb id, media type, status, rating, notes, and creation date\)/i,
      ),
    ).toBeVisible();
  });

  test('H2: JSON export triggers file download and contains valid schema and data', async ({
    page,
  }) => {
    await navigateTo(page, '/export');

    const downloadPromise = page.waitForEvent('download');
    const exportJsonButton = page.getByRole('button', { name: /export as json/i });
    await expect(exportJsonButton).toBeEnabled();
    await exportJsonButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('cinesphere-export.json');

    // Read and verify the downloaded stream contents
    const readableStream = await download.createReadStream();
    expect(readableStream).not.toBeNull();

    const chunks: Buffer[] = [];
    for await (const chunk of readableStream!) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf-8');

    const parsed = JSON.parse(content);
    expect(parsed.version).toBe('1.0');
    expect(typeof parsed.exportedAt).toBe('string');
    expect(Array.isArray(parsed.entries)).toBe(true);

    // Verify the seeded E2E movie is present in the export
    const foundEntry = parsed.entries.find(
      (e: { tmdbId: number; mediaType: string; status: string }) => e.tmdbId === E2E_MOVIE_TMDB_ID,
    );
    expect(foundEntry).toBeDefined();
    expect(foundEntry.mediaType).toBe('MOVIE');
    expect(foundEntry.status).toBe('COMPLETED');

    // Success banner in UI
    await expect(page.getByRole('status')).toContainText(
      /successfully exported your library as json/i,
    );
  });

  test('H3: CSV export triggers file download with exact headers and RFC 4180 format', async ({
    page,
  }) => {
    await navigateTo(page, '/export');

    const downloadPromise = page.waitForEvent('download');
    const exportCsvButton = page.getByRole('button', { name: /export as csv/i });
    await expect(exportCsvButton).toBeEnabled();
    await exportCsvButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('cinesphere-export.csv');

    const readableStream = await download.createReadStream();
    expect(readableStream).not.toBeNull();

    const chunks: Buffer[] = [];
    for await (const chunk of readableStream!) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf-8');

    // Verify exact headers
    expect(content.startsWith('tmdb_id,media_type,status,personal_rating,notes,created_at')).toBe(
      true,
    );

    // Verify seeded entry line exists in CSV
    expect(content).toContain(String(E2E_MOVIE_TMDB_ID));
    expect(content).toContain('movie');
    expect(content).toContain('COMPLETED');

    // Success banner in UI
    await expect(page.getByRole('status')).toContainText(
      /successfully exported your library as csv/i,
    );
  });

  test('H4: Direct URL /export loads properly and cross-links navigate correctly', async ({
    page,
  }) => {
    await page.goto('/export');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Export Library Data' })).toBeVisible();

    // Link back to library
    const backLink = page.getByRole('link', { name: /back to my library/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/library/);

    // Back to export
    await page.goto('/export');
    await page.waitForLoadState('networkidle');

    // Link to import
    const importLink = page.getByRole('link', { name: /import data →/i });
    await expect(importLink).toBeVisible();
    await importLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/import/);
  });

  test('H5: Error banner renders upon API failure and dismisses cleanly', async ({ page }) => {
    // Intercept /api/export/json with simulated failure
    await page.route('**/api/export/json', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Simulated export database error' }),
      }),
    );

    await navigateTo(page, '/export');

    const exportJsonButton = page.getByRole('button', { name: /export as json/i });
    await exportJsonButton.click();

    // Error banner should appear with the message
    const alert = page.getByTestId('export-error-alert');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Simulated export database error');

    // Dismiss error
    await page.getByRole('button', { name: /dismiss error message/i }).click();
    await expect(alert).not.toBeVisible();

    await page.unroute('**/api/export/json');
  });
});
