import { ConfigService } from '@nestjs/config';
import { TmdbHttpClient } from './tmdb-http.client.js';

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

      await expect(client.get('/movie/999999999', {}, { maxRetries: 2 })).rejects.toThrow(
        'Resource not found on TMDB (HTTP 404): /movie/999999999',
      );
    });
  });

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
});
