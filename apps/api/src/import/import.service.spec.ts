// ==============================================================================
// CineSphere — Import Service Unit Tests
// Phase 4.4
// ==============================================================================

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ImportService } from './import.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { TmdbService } from '../tmdb/tmdb.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonBuffer(doc: unknown): Buffer {
  return Buffer.from(JSON.stringify(doc), 'utf-8');
}

function makeCsvBuffer(csv: string): Buffer {
  return Buffer.from(csv, 'utf-8');
}

function makeValidJsonDoc(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    entries: [
      {
        tmdbId: 550,
        mediaType: 'MOVIE',
        status: 'COMPLETED',
        personalRating: 8.5,
        ...overrides,
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ImportService', () => {
  let service: ImportService;
  let mockUserBootstrap: jest.Mocked<SingleUserBootstrap>;
  let mockTmdbService: jest.Mocked<TmdbService>;
  let mockPrismaMovie: { findUnique: jest.Mock; findFirst: jest.Mock };
  let mockPrismatvShow: { findUnique: jest.Mock; findFirst: jest.Mock };
  let mockPrismaULE: { count: jest.Mock; create: jest.Mock };
  let mockPrismaVE: { create: jest.Mock };
  let mockPrismaEP: { upsert: jest.Mock };
  let mockPrismaSR: { upsert: jest.Mock };
  let mockPrismaEpisode: { findFirst: jest.Mock };
  let mockPrismaSeason: { findFirst: jest.Mock };
  let mockPrismaService: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockUserBootstrap = {
      getUserId: jest.fn().mockReturnValue(MOCK_USER_ID),
    } as unknown as jest.Mocked<SingleUserBootstrap>;

    mockTmdbService = {
      ingestMovie: jest.fn(),
      ingestTvShow: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    mockPrismaMovie = { findUnique: jest.fn(), findFirst: jest.fn() };
    mockPrismatvShow = { findUnique: jest.fn(), findFirst: jest.fn() };
    mockPrismaULE = { count: jest.fn(), create: jest.fn() };
    mockPrismaVE = { create: jest.fn() };
    mockPrismaEP = { upsert: jest.fn() };
    mockPrismaSR = { upsert: jest.fn() };
    mockPrismaEpisode = { findFirst: jest.fn() };
    mockPrismaSeason = { findFirst: jest.fn() };

    mockPrismaService = {
      movie: mockPrismaMovie,
      tvShow: mockPrismatvShow,
      userLibraryEntry: mockPrismaULE,
      viewingEvent: mockPrismaVE,
      episodeProgress: mockPrismaEP,
      seasonRating: mockPrismaSR,
      episode: mockPrismaEpisode,
      season: mockPrismaSeason,
      $transaction: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    service = new ImportService(mockPrismaService, mockUserBootstrap, mockTmdbService);
  });

  // ── JSON Import ─────────────────────────────────────────────────────────────

  describe('importJson', () => {
    it('rejects oversized files', async () => {
      const big = Buffer.alloc(6 * 1024 * 1024, 'x');
      await expect(service.importJson(big)).rejects.toThrow(PayloadTooLargeException);
    });

    it('rejects malformed JSON', async () => {
      const buf = Buffer.from('{invalid json}', 'utf-8');
      await expect(service.importJson(buf)).rejects.toThrow(BadRequestException);
    });

    it('returns validation errors for invalid document structure', async () => {
      const result = await service.importJson(makeJsonBuffer({ version: '2.0', entries: [] }));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns success with zero entries for empty entries array', async () => {
      const result = await service.importJson(makeJsonBuffer({ version: '1.0', entries: [] }));
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.imported).toBe(0);
    });

    it('returns validation error for invalid entry', async () => {
      const result = await service.importJson(
        makeJsonBuffer({
          version: '1.0',
          entries: [{ tmdbId: -1, mediaType: 'INVALID', status: 'BAD' }],
        }),
      );
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('skips existing library entries', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue({ id: 'movie-uuid' });
      mockPrismaULE.count.mockResolvedValue(1);

      const result = await service.importJson(makeJsonBuffer(makeValidJsonDoc()));
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
    });

    it('reports resolution failure without crashing', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue(null);
      mockTmdbService.ingestMovie.mockRejectedValue(new Error('TMDB unavailable'));

      const result = await service.importJson(makeJsonBuffer(makeValidJsonDoc()));
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.field === 'tmdbId')).toBe(true);
    });

    it('ingests movie from TMDB if not in local catalogue', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue(null);
      mockTmdbService.ingestMovie.mockResolvedValue({ id: 'movie-uuid-new' } as never);
      mockPrismaULE.count.mockResolvedValue(0);

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<number>) => {
          const mockTx = {
            userLibraryEntry: { create: jest.fn().mockResolvedValue({ id: 'ule-uuid' }) },
            viewingEvent: { create: jest.fn() },
            episodeProgress: { upsert: jest.fn() },
            seasonRating: { upsert: jest.fn() },
            episode: { findFirst: jest.fn() },
            season: { findFirst: jest.fn() },
          };
          return fn(mockTx);
        },
      );

      const result = await service.importJson(makeJsonBuffer(makeValidJsonDoc()));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(mockTmdbService.ingestMovie).toHaveBeenCalledWith(550);
    });

    it('creates viewing events for MOVIE entries', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue({ id: 'movie-uuid' });
      mockPrismaULE.count.mockResolvedValue(0);

      const mockCreatedEntry = { id: 'ule-uuid' };
      const mockTxULE = { create: jest.fn().mockResolvedValue(mockCreatedEntry) };
      const mockTxVE = { create: jest.fn() };

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<number>) => {
          return fn({
            userLibraryEntry: mockTxULE,
            viewingEvent: mockTxVE,
            episodeProgress: { upsert: jest.fn() },
            seasonRating: { upsert: jest.fn() },
            episode: { findFirst: jest.fn() },
            season: { findFirst: jest.fn() },
          });
        },
      );

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [
              { watchedAt: '2023-01-15T20:00:00Z', rating: 8.5 },
              { watchedAt: '2023-06-01T19:00:00Z', rating: 9.0 },
            ],
          },
        ],
      };

      const result = await service.importJson(makeJsonBuffer(doc));
      expect(result.success).toBe(true);
      expect(mockTxVE.create).toHaveBeenCalledTimes(2);
    });
  });

  // ── CSV Import ──────────────────────────────────────────────────────────────

  describe('importCsv', () => {
    it('rejects oversized files', async () => {
      const big = Buffer.alloc(3 * 1024 * 1024, 'x');
      await expect(service.importCsv(big)).rejects.toThrow(PayloadTooLargeException);
    });

    it('returns validation errors for invalid CSV', async () => {
      const result = await service.importCsv(makeCsvBuffer('wrong_col,other\nabc,val'));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns success with zero rows for header-only CSV', async () => {
      const result = await service.importCsv(makeCsvBuffer('tmdb_id,media_type,status\n'));
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
    });

    it('skips already-existing entries', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue({ id: 'movie-uuid' });
      mockPrismaULE.count.mockResolvedValue(1);

      const csv = `tmdb_id,media_type,status\n550,MOVIE,COMPLETED`;
      const result = await service.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
    });

    it('imports a new CSV row successfully', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue({ id: 'movie-uuid' });
      mockPrismaULE.count.mockResolvedValue(0);

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<number>) => {
          return fn({
            userLibraryEntry: { create: jest.fn().mockResolvedValue({ id: 'ule-uuid' }) },
          });
        },
      );

      const csv = `tmdb_id,media_type,status,personal_rating,notes\n550,MOVIE,COMPLETED,8.5,Great`;
      const result = await service.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });

    it('handles TV show CSV rows', async () => {
      mockPrismatvShow.findUnique.mockResolvedValue({ id: 'tv-uuid' });
      mockPrismaULE.count.mockResolvedValue(0);

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<number>) => {
          return fn({
            userLibraryEntry: { create: jest.fn().mockResolvedValue({ id: 'ule-uuid' }) },
          });
        },
      );

      const csv = `tmdb_id,media_type,status\n1399,TV,WATCHING`;
      const result = await service.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });

    it('collects resolution errors for unresolvable TMDB IDs', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue(null);
      mockTmdbService.ingestMovie.mockRejectedValue(new Error('Not found'));

      const csv = `tmdb_id,media_type,status\n999999999,MOVIE,COMPLETED`;
      const result = await service.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports import result summary string', async () => {
      mockPrismaMovie.findUnique.mockResolvedValue({ id: 'movie-uuid' });
      mockPrismaULE.count.mockResolvedValue(0);

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<number>) => {
          return fn({
            userLibraryEntry: { create: jest.fn().mockResolvedValue({ id: 'ule-uuid' }) },
          });
        },
      );

      const csv = `tmdb_id,media_type,status\n550,MOVIE,COMPLETED`;
      const result = await service.importCsv(makeCsvBuffer(csv));
      expect(result.summary).toContain('1');
    });
  });
});
