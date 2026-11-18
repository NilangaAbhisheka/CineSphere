/**
 * api-client.spec.ts
 *
 * Unit tests for ApiClient export and blob download functionality.
 */

import { apiClient, ApiClientError } from './api-client';

describe('ApiClient - Blob Download & Export', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('exportJsonBlob successfully downloads JSON blob and extracts filename', async () => {
    const mockBlob = new Blob(['{"version":"1.0","entries":[]}'], { type: 'application/json' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-disposition': 'attachment; filename="cinesphere-export.json"',
        'content-type': 'application/json',
      }),
      blob: jest.fn().mockResolvedValue(mockBlob),
    });

    const result = await apiClient.exportJsonBlob();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/export/json'),
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );
    expect(result.filename).toBe('cinesphere-export.json');
    expect(result.blob).toBe(mockBlob);
  });

  it('exportCsvBlob successfully downloads CSV blob with fallback filename', async () => {
    const mockBlob = new Blob(['tmdb_id,media_type,status\r\n'], { type: 'text/csv' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'text/csv',
      }),
      blob: jest.fn().mockResolvedValue(mockBlob),
    });

    const result = await apiClient.exportCsvBlob();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/export/csv'),
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'text/csv' },
      }),
    );
    expect(result.filename).toBe('cinesphere-export.csv');
    expect(result.blob).toBe(mockBlob);
  });

  it('sanitizes path traversal in Content-Disposition filename', async () => {
    const mockBlob = new Blob(['data'], { type: 'application/json' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-disposition': 'attachment; filename="../../../etc/passwd"',
      }),
      blob: jest.fn().mockResolvedValue(mockBlob),
    });

    const result = await apiClient.exportJsonBlob();

    expect(result.filename).toBe('passwd');
  });

  it('throws ApiClientError with structured message on JSON server error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({
        statusCode: 500,
        message: 'Database snapshot failure during export',
        error: 'Internal Server Error',
      }),
    });

    await expect(apiClient.exportJsonBlob()).rejects.toThrow(ApiClientError);
    await expect(apiClient.exportJsonBlob()).rejects.toMatchObject({
      status: 500,
      message: 'Database snapshot failure during export',
      responseBody: {
        statusCode: 500,
        message: 'Database snapshot failure during export',
        error: 'Internal Server Error',
      },
    });
  });

  it('handles non-JSON error responses safely', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    });

    await expect(apiClient.exportCsvBlob()).rejects.toThrow(ApiClientError);
    await expect(apiClient.exportCsvBlob()).rejects.toMatchObject({
      status: 502,
      message: 'API request failed with status 502',
    });
  });

  it('converts network connection errors into ApiClientError with status 0', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(apiClient.exportJsonBlob()).rejects.toThrow(ApiClientError);
    await expect(apiClient.exportJsonBlob()).rejects.toMatchObject({
      status: 0,
      message: 'Failed to fetch',
    });
  });

  it('passes through AbortError directly without wrapping in ApiClientError', async () => {
    const abortError = new DOMException('The user aborted a request.', 'AbortError');
    global.fetch = jest.fn().mockRejectedValue(abortError);

    await expect(apiClient.exportJsonBlob()).rejects.toThrow(DOMException);
    await expect(apiClient.exportJsonBlob()).rejects.not.toThrow(ApiClientError);
  });
});
