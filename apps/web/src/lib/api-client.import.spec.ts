/**
 * api-client.import.spec.ts
 *
 * Unit tests for import methods on ApiClient.
 * Global fetch is mocked — no network calls are made.
 */

import { apiClient, ApiClientError } from '@/lib/api-client';
import { ImportResponse } from '@cinesphere/shared';

function makeFetchOk(body: unknown, status = 200): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

function makeFetchError(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

describe('ApiClient — import methods', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockSuccessResponse: ImportResponse = {
    success: true,
    total: 2,
    imported: 2,
    skipped: 0,
    errors: [],
    summary: 'Imported 2 entries.',
  };

  describe('importJson()', () => {
    it('sends file as FormData via POST to /import/json', async () => {
      const mockFetch = makeFetchOk(mockSuccessResponse);
      globalThis.fetch = mockFetch;

      const file = new File(['{"version":"1.0","entries":[]}'], 'test.json', {
        type: 'application/json',
      });

      const result = await apiClient.importJson(file);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/import/json');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(result).toEqual(mockSuccessResponse);
    });

    it('throws ApiClientError when API returns 400', async () => {
      const errorBody = {
        success: false,
        total: 1,
        imported: 0,
        skipped: 0,
        errors: [{ index: 0, message: 'Invalid format' }],
        summary: 'Import failed with 1 validation error.',
      };
      globalThis.fetch = makeFetchError(400, errorBody);

      const file = new File(['bad'], 'test.json', { type: 'application/json' });

      await expect(apiClient.importJson(file)).rejects.toThrow(ApiClientError);
    });

    it('throws ApiClientError with 0 status on network failure', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const file = new File(['{}'], 'test.json', { type: 'application/json' });

      await expect(apiClient.importJson(file)).rejects.toThrow('Network offline');
    });
  });

  describe('importCsv()', () => {
    it('sends file as FormData via POST to /import/csv', async () => {
      const mockFetch = makeFetchOk(mockSuccessResponse);
      globalThis.fetch = mockFetch;

      const file = new File(['tmdb_id,media_type,status\n550,MOVIE,COMPLETED'], 'test.csv', {
        type: 'text/csv',
      });

      const result = await apiClient.importCsv(file);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/import/csv');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(result).toEqual(mockSuccessResponse);
    });

    it('throws ApiClientError when CSV import fails', async () => {
      globalThis.fetch = makeFetchError(413, { message: 'File too large' });

      const file = new File(['large content'], 'huge.csv', { type: 'text/csv' });

      await expect(apiClient.importCsv(file)).rejects.toThrow('File too large');
    });
  });
});
