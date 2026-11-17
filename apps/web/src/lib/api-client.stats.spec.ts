/**
 * api-client.stats.spec.ts
 *
 * Unit tests for statistics methods on ApiClient.
 * Global fetch is mocked — no network calls are made.
 */

import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  ActivityTimelineData,
  GenreStatItem,
  RatingStatsData,
  StatsOverviewSummary,
} from '@cinesphere/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ApiClient — stats methods', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── getStatsOverview ───────────────────────────────────────────────────────

  describe('getStatsOverview()', () => {
    it('calls GET /api/stats/overview and returns summary statistics', async () => {
      const mockSummary: StatsOverviewSummary = {
        moviesCompleted: 10,
        movieViewingEvents: 12,
        episodesWatched: 50,
        tvShowsCompleted: 3,
        averagePersonalRating: 8.5,
      };

      globalThis.fetch = makeFetchOk(mockSummary);

      const result = await apiClient.getStatsOverview();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/stats/overview');
      expect(init.method).toBe('GET');
      expect(result).toEqual(mockSummary);
    });

    it('passes abort signal when provided', async () => {
      globalThis.fetch = makeFetchOk({});
      const controller = new AbortController();

      await apiClient.getStatsOverview(controller.signal);

      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(init.signal).toBe(controller.signal);
    });

    it('throws ApiClientError when server responds with 500', async () => {
      globalThis.fetch = makeFetchError(500, { message: 'Internal server error' });

      await expect(apiClient.getStatsOverview()).rejects.toThrow(ApiClientError);
    });
  });

  // ── getStatsGenres ─────────────────────────────────────────────────────────

  describe('getStatsGenres()', () => {
    it('calls GET /api/stats/genres and returns genre statistics', async () => {
      const mockGenres: GenreStatItem[] = [
        { genreId: 28, name: 'Action', completedTitleCount: 5, percentage: 50 },
        { genreId: 18, name: 'Drama', completedTitleCount: 3, percentage: 30 },
      ];

      globalThis.fetch = makeFetchOk(mockGenres);

      const result = await apiClient.getStatsGenres();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/stats/genres');
      expect(init.method).toBe('GET');
      expect(result).toEqual(mockGenres);
    });

    it('passes abort signal when provided', async () => {
      globalThis.fetch = makeFetchOk([]);
      const controller = new AbortController();

      await apiClient.getStatsGenres(controller.signal);

      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(init.signal).toBe(controller.signal);
    });
  });

  // ── getStatsActivity ───────────────────────────────────────────────────────

  describe('getStatsActivity()', () => {
    it('calls GET /api/stats/activity without query params when none are provided', async () => {
      const mockActivity: ActivityTimelineData = {
        from: '2025-12',
        to: '2026-11',
        items: [
          {
            period: '2026-10',
            label: 'Oct 2026',
            movieViewings: 2,
            episodesWatched: 10,
            totalActivity: 12,
          },
        ],
      };

      globalThis.fetch = makeFetchOk(mockActivity);

      const result = await apiClient.getStatsActivity();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/stats/activity');
      expect(result).toEqual(mockActivity);
    });

    it('appends from and to query parameters when provided', async () => {
      const mockActivity: ActivityTimelineData = {
        from: '2026-01',
        to: '2026-06',
        items: [],
      };

      globalThis.fetch = makeFetchOk(mockActivity);

      await apiClient.getStatsActivity({ from: '2026-01', to: '2026-06' });

      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/stats/activity?from=2026-01&to=2026-06');
    });

    it('throws ApiClientError when date range is rejected with 400', async () => {
      globalThis.fetch = makeFetchError(400, {
        message: 'Invalid date range: from must be <= to',
      });

      await expect(apiClient.getStatsActivity({ from: '2026-12', to: '2026-01' })).rejects.toThrow(
        ApiClientError,
      );
    });

    it('passes abort signal when provided', async () => {
      globalThis.fetch = makeFetchOk({ from: '2026-01', to: '2026-06', items: [] });
      const controller = new AbortController();

      await apiClient.getStatsActivity(undefined, controller.signal);

      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(init.signal).toBe(controller.signal);
    });
  });

  // ── getStatsRatings ────────────────────────────────────────────────────────

  describe('getStatsRatings()', () => {
    it('calls GET /api/stats/ratings and returns rating distribution', async () => {
      const mockRatings: RatingStatsData = {
        buckets: [
          { rating: 1.0, count: 0 },
          { rating: 8.5, count: 4 },
        ],
        unratedLibraryEntries: 2,
        totalRated: 4,
      };

      globalThis.fetch = makeFetchOk(mockRatings);

      const result = await apiClient.getStatsRatings();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/stats/ratings');
      expect(init.method).toBe('GET');
      expect(result).toEqual(mockRatings);
    });

    it('passes abort signal when provided', async () => {
      globalThis.fetch = makeFetchOk({ buckets: [], unratedLibraryEntries: 0, totalRated: 0 });
      const controller = new AbortController();

      await apiClient.getStatsRatings(controller.signal);

      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(init.signal).toBe(controller.signal);
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe('Network and error handling', () => {
    it('throws ApiClientError with status 0 on network connection failure', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

      await expect(apiClient.getStatsOverview()).rejects.toMatchObject({
        name: 'ApiClientError',
        status: 0,
        message: 'Failed to fetch',
      });
    });
  });
});
