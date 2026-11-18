// ==============================================================================
// CineSphere — Export Service Unit Tests
// Phase 4.5
// ==============================================================================

import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { ExportService } from './export.service.js';

describe('ExportService', () => {
  let exportService: ExportService;
  let mockPrisma: {
    $transaction: jest.Mock;
    userLibraryEntry: {
      findMany: jest.Mock;
    };
  };
  let mockUserBootstrap: jest.Mocked<SingleUserBootstrap>;

  const TEST_USER_ID = 'e3eebc99-9c0b-4ef8-bb6d-6bb9bd380e33';

  beforeEach(() => {
    mockUserBootstrap = {
      getUserId: jest.fn().mockReturnValue(TEST_USER_ID),
    } as unknown as jest.Mocked<SingleUserBootstrap>;

    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>, _options?: unknown) => {
        return cb(mockPrisma);
      }),
      userLibraryEntry: {
        findMany: jest.fn(),
      },
    };

    exportService = new ExportService(mockPrisma as unknown as PrismaService, mockUserBootstrap);
  });

  describe('Isolation Level & User Scoping', () => {
    it('executes query inside REPEATABLE READ transaction for single user', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([]);

      await exportService.exportJson();

      expect(mockUserBootstrap.getUserId).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
      expect(mockPrisma.userLibraryEntry.findMany).toHaveBeenCalledWith({
        where: { userId: TEST_USER_ID },
        include: expect.any(Object),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  });

  describe('JSON Export', () => {
    it('exports an empty library as a valid ExportDocument', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([]);

      const jsonStr = await exportService.exportJson();
      const parsed = JSON.parse(jsonStr);

      expect(parsed.version).toBe('1.0');
      expect(typeof parsed.exportedAt).toBe('string');
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect(parsed.entries).toHaveLength(0);
    });

    it('exports a movie entry with viewing events, ratings, notes, and dates', async () => {
      const createdAt = new Date('2024-01-15T10:00:00.000Z');
      const watchedAt = new Date('2024-01-15T20:00:00.000Z');

      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'movie-entry-1',
          userId: TEST_USER_ID,
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('8.50'),
          notes: 'One of my favourites',
          createdAt,
          updatedAt: createdAt,
          movie: { tmdbId: 550 },
          tvShow: null,
          viewingEvents: [
            {
              id: 've-1',
              watchedAt,
              rating: new Prisma.Decimal('8.50'),
              notes: 'First viewing',
            },
          ],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      const jsonStr = await exportService.exportJson();
      const parsed = JSON.parse(jsonStr);

      expect(parsed.entries).toHaveLength(1);
      const entry = parsed.entries[0];

      expect(entry.tmdbId).toBe(550);
      expect(entry.mediaType).toBe('MOVIE');
      expect(entry.status).toBe('COMPLETED');
      expect(entry.personalRating).toBe(8.5);
      expect(entry.notes).toBe('One of my favourites');
      expect(entry.createdAt).toBe('2024-01-15T10:00:00.000Z');

      // Movie-specific data present
      expect(entry.viewingEvents).toHaveLength(1);
      expect(entry.viewingEvents[0]).toEqual({
        watchedAt: '2024-01-15T20:00:00.000Z',
        rating: 8.5,
        notes: 'First viewing',
      });

      // Media-inapplicable fields must be absent
      expect(entry.episodeProgress).toBeUndefined();
      expect(entry.seasonRatings).toBeUndefined();
    });

    it('exports a TV entry with episode progress (including null watchedAt) and season ratings', async () => {
      const createdAt = new Date('2024-02-01T10:00:00.000Z');
      const watchedAt1 = new Date('2024-02-02T20:00:00.000Z');

      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'tv-entry-1',
          userId: TEST_USER_ID,
          mediaType: 'TV',
          status: 'WATCHING',
          personalRating: new Prisma.Decimal('9.00'),
          notes: 'Brilliant series',
          createdAt,
          updatedAt: createdAt,
          movie: null,
          tvShow: { tmdbId: 1399 },
          viewingEvents: [],
          episodeProgresses: [
            {
              episodeId: 'ep-1',
              watchedAt: watchedAt1,
              episode: { tmdbId: 63056, episodeNumber: 1, season: { seasonNumber: 1 } },
            },
            {
              episodeId: 'ep-2',
              watchedAt: null, // Nullable watchedAt
              episode: { tmdbId: 63057, episodeNumber: 2, season: { seasonNumber: 1 } },
            },
          ],
          seasonRatings: [
            {
              id: 'sr-1',
              seasonId: 'season-1',
              rating: new Prisma.Decimal('9.00'),
              season: { tmdbId: 3624, seasonNumber: 1 },
            },
          ],
        },
      ]);

      const jsonStr = await exportService.exportJson();
      const parsed = JSON.parse(jsonStr);

      expect(parsed.entries).toHaveLength(1);
      const entry = parsed.entries[0];

      expect(entry.tmdbId).toBe(1399);
      expect(entry.mediaType).toBe('TV');
      expect(entry.status).toBe('WATCHING');
      expect(entry.personalRating).toBe(9);
      expect(entry.notes).toBe('Brilliant series');

      // TV-specific nested data present
      expect(entry.episodeProgress).toEqual([
        { episodeTmdbId: 63056, watchedAt: '2024-02-02T20:00:00.000Z' },
        { episodeTmdbId: 63057, watchedAt: null },
      ]);
      expect(entry.seasonRatings).toEqual([{ seasonTmdbId: 3624, rating: 9 }]);

      // Movie-inapplicable field must be absent
      expect(entry.viewingEvents).toBeUndefined();
    });

    it('handles unrated library entries and viewing events with null ratings/notes', async () => {
      const createdAt = new Date('2024-03-01T10:00:00.000Z');
      const watchedAt = new Date('2024-03-01T20:00:00.000Z');

      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'movie-unrated',
          userId: TEST_USER_ID,
          mediaType: 'MOVIE',
          status: 'PLAN_TO_WATCH',
          personalRating: null,
          notes: null,
          createdAt,
          updatedAt: createdAt,
          movie: { tmdbId: 100 },
          tvShow: null,
          viewingEvents: [
            {
              id: 've-unrated',
              watchedAt,
              rating: null,
              notes: null,
            },
          ],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      const jsonStr = await exportService.exportJson();
      const parsed = JSON.parse(jsonStr);
      const entry = parsed.entries[0];

      expect(entry.personalRating).toBeNull();
      expect(entry.notes).toBeNull();
      expect(entry.viewingEvents[0].rating).toBeNull();
      expect(entry.viewingEvents[0].notes).toBeNull();
    });
  });

  describe('Zero Silent Data Loss Enforcement', () => {
    it('throws InternalServerErrorException when a movie entry lacks a TMDB ID', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'corrupt-movie-entry',
          userId: TEST_USER_ID,
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: null,
          notes: null,
          createdAt: new Date(),
          movie: null, // missing relation
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      await expect(exportService.exportJson()).rejects.toThrow(InternalServerErrorException);
      await expect(exportService.exportJson()).rejects.toThrow(
        /Library entry "corrupt-movie-entry" \(MOVIE\) lacks an associated catalogue TMDB ID/,
      );
    });

    it('throws InternalServerErrorException when a TV show entry lacks a TMDB ID', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'corrupt-tv-entry',
          userId: TEST_USER_ID,
          mediaType: 'TV',
          status: 'COMPLETED',
          personalRating: null,
          notes: null,
          createdAt: new Date(),
          movie: null,
          tvShow: null, // missing relation
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      await expect(exportService.exportJson()).rejects.toThrow(InternalServerErrorException);
      await expect(exportService.exportJson()).rejects.toThrow(
        /Library entry "corrupt-tv-entry" \(TV\) lacks an associated catalogue TMDB ID/,
      );
    });

    it('throws InternalServerErrorException when an episode progress record lacks a TMDB ID', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'tv-entry-1',
          tvShowId: 'show-1',
          userId: TEST_USER_ID,
          mediaType: 'TV',
          status: 'WATCHING',
          personalRating: null,
          notes: null,
          createdAt: new Date(),
          movie: null,
          tvShow: { tmdbId: 100 },
          viewingEvents: [],
          episodeProgresses: [
            {
              episodeId: 'episode-missing-tmdb',
              watchedAt: new Date(),
              episode: { tmdbId: null }, // Null TMDB ID
            },
          ],
          seasonRatings: [],
        },
      ]);

      await expect(exportService.exportJson()).rejects.toThrow(InternalServerErrorException);
      await expect(exportService.exportJson()).rejects.toThrow(
        /Episode progress record for episode "episode-missing-tmdb" on TV show "show-1" lacks a catalogue TMDB ID/,
      );
    });

    it('throws InternalServerErrorException when a season rating record lacks a TMDB ID', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'tv-entry-1',
          tvShowId: 'show-1',
          userId: TEST_USER_ID,
          mediaType: 'TV',
          status: 'WATCHING',
          personalRating: null,
          notes: null,
          createdAt: new Date(),
          movie: null,
          tvShow: { tmdbId: 100 },
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [
            {
              id: 'sr-1',
              seasonId: 'season-missing-tmdb',
              rating: new Prisma.Decimal('8.00'),
              season: { tmdbId: null }, // Null TMDB ID
            },
          ],
        },
      ]);

      await expect(exportService.exportJson()).rejects.toThrow(InternalServerErrorException);
      await expect(exportService.exportJson()).rejects.toThrow(
        /Season rating record for season "season-missing-tmdb" on TV show "show-1" lacks a catalogue TMDB ID/,
      );
    });
  });

  describe('CSV Export', () => {
    it('exports an empty library with header row and CRLF line ending', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([]);

      const csv = await exportService.exportCsv();

      expect(csv).toBe('tmdb_id,media_type,status,personal_rating,notes,created_at\r\n');
    });

    it('exports entries with correct formatting and status', async () => {
      const createdAt1 = new Date('2024-01-15T10:00:00.000Z');
      const createdAt2 = new Date('2024-02-01T12:00:00.000Z');

      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'm-1',
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('8.50'),
          notes: 'Great movie',
          createdAt: createdAt1,
          movie: { tmdbId: 550 },
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
        {
          id: 't-1',
          mediaType: 'TV',
          status: 'PLAN_TO_WATCH',
          personalRating: null,
          notes: null,
          createdAt: createdAt2,
          movie: null,
          tvShow: { tmdbId: 1399 },
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      const csv = await exportService.exportCsv();
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe('tmdb_id,media_type,status,personal_rating,notes,created_at');
      expect(lines[1]).toBe('550,movie,COMPLETED,8.5,Great movie,2024-01-15T10:00:00.000Z');
      expect(lines[2]).toBe('1399,tv,PLAN_TO_WATCH,,,2024-02-01T12:00:00.000Z');
      expect(lines[3]).toBe(''); // trailing empty string after last CRLF
    });

    it('escapes commas, double quotes, and embedded newlines per RFC 4180', async () => {
      const createdAt = new Date('2024-01-15T10:00:00.000Z');

      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'm-comma',
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('7.00'),
          notes: 'Action, Drama, Thriller',
          createdAt,
          movie: { tmdbId: 101 },
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
        {
          id: 'm-quote',
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('9.50'),
          notes: 'A "masterpiece" of modern cinema',
          createdAt,
          movie: { tmdbId: 102 },
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
        {
          id: 'm-newline',
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('8.00'),
          notes: 'Line 1\nLine 2\r\nLine 3',
          createdAt,
          movie: { tmdbId: 103 },
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      const csv = await exportService.exportCsv();

      // Check comma escaping: wrapped in quotes
      expect(csv).toContain(
        '101,movie,COMPLETED,7.0,"Action, Drama, Thriller",2024-01-15T10:00:00.000Z',
      );

      // Check quote escaping: internal quotes doubled and wrapped in quotes
      expect(csv).toContain(
        '102,movie,COMPLETED,9.5,"A ""masterpiece"" of modern cinema",2024-01-15T10:00:00.000Z',
      );

      // Check newline escaping: multiline wrapped in quotes
      expect(csv).toContain(
        '103,movie,COMPLETED,8.0,"Line 1\nLine 2\r\nLine 3",2024-01-15T10:00:00.000Z',
      );
    });

    it('throws in CSV export when an entry lacks a catalogue TMDB ID', async () => {
      mockPrisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'corrupt-entry',
          mediaType: 'MOVIE',
          status: 'COMPLETED',
          personalRating: null,
          notes: null,
          createdAt: new Date(),
          movie: null,
          tvShow: null,
          viewingEvents: [],
          episodeProgresses: [],
          seasonRatings: [],
        },
      ]);

      await expect(exportService.exportCsv()).rejects.toThrow(InternalServerErrorException);
    });
  });
});
