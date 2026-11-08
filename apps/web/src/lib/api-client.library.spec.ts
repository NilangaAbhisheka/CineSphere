/**
 * api-client.library.spec.ts
 *
 * Unit tests for the library-related methods on ApiClient.
 * Global fetch is mocked — no network calls are made.
 */

import { ApiClientError } from '@/lib/api-client';
import {
  CreateLibraryEntryRequest,
  LibraryEntryListItem,
  LibraryEntryResponse,
  PaginatedResult,
} from '@cinesphere/shared';

// ── helpers ──────────────────────────────────────────────────────────────────

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

// Minimal library list item fixture
function makeListItem(overrides: Partial<LibraryEntryListItem> = {}): LibraryEntryListItem {
  return {
    id: 'lib-1',
    mediaType: 'MOVIE',
    status: 'PLAN_TO_WATCH',
    personalRating: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: {
      id: 'mov-1',
      tmdbId: 100,
      title: 'Test Movie',
      posterPath: null,
      releaseDate: '2020-01-01',
      voteAverage: 7.5,
    },
    tvShow: null,
    watchStats: {
      totalWatchCount: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
      episodesWatched: 0,
      totalEpisodes: 0,
      completionPercentage: 0,
    },
    ...overrides,
  } as unknown as LibraryEntryListItem;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ApiClient — library methods', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.resetModules();
  });

  // We import the singleton after overriding fetch
  async function getClient() {
    const { apiClient } = await import('@/lib/api-client');
    return apiClient;
  }

  describe('listLibrary', () => {
    it('calls GET /library and returns a paginated result', async () => {
      const payload: PaginatedResult<LibraryEntryListItem> = {
        items: [makeListItem()],
        totalResults: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      globalThis.fetch = makeFetchOk(payload);
      const client = await getClient();
      const result = await client.listLibrary();
      expect(result.totalResults).toBe(1);
      expect(result.items).toHaveLength(1);
      expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain('/library');
    });

    it('passes status and mediaType query params', async () => {
      globalThis.fetch = makeFetchOk({
        items: [],
        totalResults: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      const client = await getClient();
      await client.listLibrary({ status: 'COMPLETED', mediaType: 'MOVIE', page: 2 });
      const url: string = (globalThis.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('status=COMPLETED');
      expect(url).toContain('mediaType=MOVIE');
      expect(url).toContain('page=2');
    });
  });

  describe('createLibraryEntry', () => {
    it('calls POST /library with the DTO body', async () => {
      const responseEntry = { id: 'lib-new', mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' };
      globalThis.fetch = makeFetchOk(responseEntry, 201);
      const client = await getClient();
      const dto: CreateLibraryEntryRequest = {
        mediaType: 'MOVIE',
        tmdbId: 999,
        mediaId: 'mov-999',
        status: 'PLAN_TO_WATCH',
        personalRating: null,
        notes: null,
      };
      await client.createLibraryEntry(dto);
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/library');
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body as string) as CreateLibraryEntryRequest;
      expect(sent.tmdbId).toBe(999);
      expect(sent.mediaType).toBe('MOVIE');
    });

    it('throws ApiClientError with status 409 on duplicate', async () => {
      globalThis.fetch = makeFetchError(409, { message: 'Conflict' });
      const client = await getClient();
      await expect(
        client.createLibraryEntry({
          mediaType: 'MOVIE',
          tmdbId: 1,
          mediaId: 'm1',
          status: 'WATCHING',
          personalRating: null,
          notes: null,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('updateLibraryEntry', () => {
    it('calls PATCH /library/:id', async () => {
      globalThis.fetch = makeFetchOk({ id: 'lib-1', status: 'COMPLETED' });
      const client = await getClient();
      await client.updateLibraryEntry('lib-1', { status: 'COMPLETED' });
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/library/lib-1');
      expect(init.method).toBe('PATCH');
    });
  });

  describe('deleteLibraryEntry', () => {
    it('calls DELETE /library/:id and handles 204', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: jest.fn() });
      const client = await getClient();
      await expect(client.deleteLibraryEntry('lib-1')).resolves.toBeUndefined();
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/library/lib-1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('createViewingEvent', () => {
    it('calls POST /library/:id/viewing-events', async () => {
      globalThis.fetch = makeFetchOk({ id: 'ev-1', watchedAt: '2026-01-01T00:00:00Z' }, 201);
      const client = await getClient();
      await client.createViewingEvent('lib-1', { watchedAt: '2026-01-01T00:00:00Z' });
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toContain('/library/lib-1/viewing-events');
    });
  });

  describe('createEpisodeProgress', () => {
    it('calls POST /library/:id/episode-progress with episodeId body', async () => {
      globalThis.fetch = makeFetchOk({ libraryEntryId: 'lib-1', episodeId: 'ep-5' }, 201);
      const client = await getClient();
      await client.createEpisodeProgress('lib-1', 'ep-5');
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/library/lib-1/episode-progress');
      expect(JSON.parse(init.body as string)).toEqual({ episodeId: 'ep-5' });
    });
  });

  describe('deleteEpisodeProgress', () => {
    it('calls DELETE /library/:id/episode-progress/:episodeId', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: jest.fn() });
      const client = await getClient();
      await client.deleteEpisodeProgress('lib-1', 'ep-5');
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/library/lib-1/episode-progress/ep-5');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('markAllWatched', () => {
    it('defaults includeSpecials to false', async () => {
      globalThis.fetch = makeFetchOk({ addedCount: 10 });
      const client = await getClient();
      await client.markAllWatched('lib-1');
      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ includeSpecials: false });
    });

    it('passes includeSpecials=true when explicitly set', async () => {
      globalThis.fetch = makeFetchOk({ addedCount: 12 });
      const client = await getClient();
      await client.markAllWatched('lib-1', true);
      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ includeSpecials: true });
    });
  });

  describe('ApiClientError', () => {
    it('carries status and name', () => {
      const err = new ApiClientError(404, 'Not found');
      expect(err.status).toBe(404);
      expect(err.name).toBe('ApiClientError');
      expect(err.message).toBe('Not found');
    });

    it('carries responseBody when provided', () => {
      const body = { message: 'Conflict', error: 'Conflict' };
      const err = new ApiClientError(409, 'Conflict', body);
      expect(err.responseBody).toEqual(body);
    });
  });
});
