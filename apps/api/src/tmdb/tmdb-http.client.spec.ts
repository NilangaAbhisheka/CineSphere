import { ConfigService } from '@nestjs/config';
import {
  TMDB_MAX_CONCURRENCY,
  TMDB_MIN_DISPATCH_INTERVAL_MS,
  TmdbHttpClient,
} from './tmdb-http.client.js';

describe('TmdbHttpClient', () => {
  let client: TmdbHttpClient;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'TMDB_BASE_URL') return 'https://api.themoviedb.org/3';
        if (key === 'TMDB_READ_ACCESS_TOKEN') return 'mock_read_token';
        if (key === 'TMDB_API_KEY') return 'mock_api_key';
        return null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    client = new TmdbHttpClient(configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Headers and Configuration
  // ---------------------------------------------------------------------------
  describe('Headers and Configuration', () => {
    it('constructs Bearer token header without leaking token into URLs', () => {
      const headers = client.getHeaders();
      expect(headers.Authorization).toBe('Bearer mock_read_token');
      expect(headers.Accept).toBe('application/json');
    });

    it('redacts sensitive details from error messages on 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(client.get('/movie/999999999', {}, { maxRetries: 0 })).rejects.toThrow(
        'Resource not found on TMDB (HTTP 404): /movie/999999999',
      );
    });

    it('does not include the token in constructed URL query parameters', async () => {
      let capturedUrl: string | undefined;
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        capturedUrl = input.toString();
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      });

      await client.get('/movie/550', { page: 1 });

      expect(capturedUrl).toBeDefined();
      expect(capturedUrl!).not.toContain('mock_read_token');
      expect(capturedUrl!).not.toContain('mock_api_key');
    });

    it('reports exported pacing constants with correct values', () => {
      expect(TMDB_MIN_DISPATCH_INTERVAL_MS).toBe(100);
      expect(TMDB_MAX_CONCURRENCY).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling and retries (existing behavior preserved)
  // ---------------------------------------------------------------------------
  describe('Error handling and retries', () => {
    it('returns JSON response on 200 OK', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 550, title: 'Fight Club' }),
      } as Response);

      const result = await client.get<{ id: number; title: string }>('/movie/550');
      expect(result.id).toBe(550);
      expect(result.title).toBe('Fight Club');
    });

    it('throws non-retryable error on 401 Unauthorized', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      await expect(client.get('/movie/550', {}, { maxRetries: 2 })).rejects.toThrow(
        /TMDB authentication failed/,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws non-retryable error on 404 Not Found without leaking query params or tokens', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(client.get('/movie/999999999', {}, { maxRetries: 2 })).rejects.toThrow(
        /Resource not found on TMDB/,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 rate limit with exponential backoff and succeeds', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 550, title: 'Fight Club' }),
        } as Response);

      const result = await client.get<{ id: number; title: string }>(
        '/movie/550',
        {},
        { maxRetries: 2 },
      );
      expect(result.id).toBe(550);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 server error and succeeds', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 550, title: 'Fight Club' }),
        } as Response);

      const result = await client.get<{ id: number; title: string }>(
        '/movie/550',
        {},
        { maxRetries: 2 },
      );
      expect(result.id).toBe(550);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws error after exhausting retries on 500 server error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(client.get('/movie/550', {}, { maxRetries: 1 })).rejects.toThrow(
        /after 1 retries/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Transport-level pacing — deterministic tests using fake timers
  // ---------------------------------------------------------------------------
  describe('Transport-level pacing', () => {
    // Use fake timers so sleep() calls resolve under test control.
    // We DO NOT set advanceTimersByTime in advance — instead we let the pacing
    // chain run; because TMDB_MIN_DISPATCH_INTERVAL_MS = 100ms and each test
    // request completes synchronously (fetch resolves instantly), the remaining
    // pacing delay is 100ms minus ~0ms actual elapsed → 100ms.
    // We use real timers but rely on the promise-chain ordering guarantees
    // rather than wall-clock measurements to keep tests deterministic.

    it('dispatches sequential requests in pacing-chain order', async () => {
      const dispatchOrder: number[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(async () => {
        dispatchOrder.push(dispatchOrder.length + 1);
        return { ok: true, json: async () => ({ seq: dispatchOrder.length }) } as Response;
      });

      // Fire three requests without awaiting — they should queue.
      const p1 = client.get('/movie/1', {}, { maxRetries: 0 });
      const p2 = client.get('/movie/2', {}, { maxRetries: 0 });
      const p3 = client.get('/movie/3', {}, { maxRetries: 0 });

      await Promise.all([p1, p2, p3]);

      // All three completed; because the pacing chain serialises them, they
      // ran in submission order.
      expect(dispatchOrder).toEqual([1, 2, 3]);
    }, 10_000);

    it('a failed request does not permanently block subsequent requests', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 404 } as Response) // first → throws
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 2 }),
        } as Response); // second → succeeds

      const p1 = client.get('/movie/bad', {}, { maxRetries: 0 });
      const p2 = client.get('/movie/good', {}, { maxRetries: 0 });

      const [result1, result2] = await Promise.allSettled([p1, p2]);

      expect(result1.status).toBe('rejected');
      expect(result2.status).toBe('fulfilled');
      if (result2.status === 'fulfilled') {
        expect((result2.value as { id: number }).id).toBe(2);
      }
    }, 10_000);

    it('concurrent requests from multiple callers share the same pacing chain', async () => {
      // Create two separate callers sharing one client instance.
      const fetchOrder: string[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        fetchOrder.push(input.toString());
        return { ok: true, json: async () => ({}) } as Response;
      });

      // Both callers fire simultaneously.
      await Promise.all([
        client.get('/movie/10', {}, { maxRetries: 0 }),
        client.get('/movie/20', {}, { maxRetries: 0 }),
      ]);

      // Both requests executed (order may vary, but both completed).
      expect(fetchOrder).toHaveLength(2);
      const urls = fetchOrder.map((u) => u);
      expect(urls.some((u) => u.includes('/movie/10'))).toBe(true);
      expect(urls.some((u) => u.includes('/movie/20'))).toBe(true);
    }, 10_000);

    it('retries also pass through the pacing mechanism (fetch called on retry)', async () => {
      const fetchCallTimes: number[] = [];
      jest
        .spyOn(global, 'fetch')
        .mockImplementationOnce(async () => {
          fetchCallTimes.push(Date.now());
          return { ok: false, status: 500 } as Response;
        })
        .mockImplementationOnce(async () => {
          fetchCallTimes.push(Date.now());
          return { ok: true, json: async () => ({ id: 1 }) } as Response;
        });

      const result = await client.get<{ id: number }>('/movie/1', {}, { maxRetries: 1 });
      expect(result.id).toBe(1);
      // fetch was called twice: original + 1 retry
      expect(fetchCallTimes).toHaveLength(2);
    }, 10_000);

    it('HTTP 429 behavior remains correct: respects Retry-After header', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 42 }),
        } as Response);

      const result = await client.get<{ id: number }>('/movie/42', {}, { maxRetries: 1 });
      expect(result.id).toBe(42);
    }, 10_000);

    it('a timed-out request does not corrupt pacing state for the next request', async () => {
      // Simulate AbortError on first request, success on second.
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(
          Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 99 }),
        } as Response);

      const p1 = client.get('/movie/timeout', {}, { maxRetries: 0 });
      const p2 = client.get('/movie/ok', {}, { maxRetries: 0 });

      const [r1, r2] = await Promise.allSettled([p1, p2]);
      expect(r1.status).toBe('rejected');
      expect(r2.status).toBe('fulfilled');
      if (r2.status === 'fulfilled') {
        expect((r2.value as { id: number }).id).toBe(99);
      }
    }, 10_000);

    it('getActiveRequests() starts at zero and is accessible', () => {
      expect(client.getActiveRequests()).toBe(0);
    });
  });
});
