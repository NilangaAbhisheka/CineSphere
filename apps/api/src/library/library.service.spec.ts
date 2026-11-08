import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LibraryStatus, MediaType, Prisma } from '@prisma/client';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { PrismaService } from '../database/prisma.service.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import { LibraryRepository } from './library.repository.js';
import { LibraryService } from './library.service.js';

describe('LibraryService', () => {
  let service: LibraryService;
  let mockLibraryRepo: jest.Mocked<LibraryRepository>;
  let mockUserBootstrap: jest.Mocked<SingleUserBootstrap>;
  let mockTmdbService: jest.Mocked<TmdbService>;
  let mockPrisma: {
    movie: { findUnique: jest.Mock };
    tvShow: { findUnique: jest.Mock };
  };

  const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const MOCK_ENTRY_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const MOCK_MOVIE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const MOCK_TV_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  const MOCK_EPISODE_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const MOCK_SEASON_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

  beforeEach(() => {
    mockLibraryRepo = {
      createEntry: jest.fn(),
      findEntries: jest.fn(),
      findEntryById: jest.fn(),
      updateEntry: jest.fn(),
      deleteEntry: jest.fn(),
      createViewingEvent: jest.fn(),
      findEpisodeProgress: jest.fn(),
      createEpisodeProgress: jest.fn(),
      deleteEpisodeProgress: jest.fn(),
      markAllWatched: jest.fn(),
      findSeasonRating: jest.fn(),
      createSeasonRating: jest.fn(),
      updateSeasonRating: jest.fn(),
    } as unknown as jest.Mocked<LibraryRepository>;

    mockUserBootstrap = {
      getUserId: jest.fn().mockReturnValue(TEST_USER_ID),
    } as unknown as jest.Mocked<SingleUserBootstrap>;

    mockTmdbService = {
      ingestMovie: jest.fn(),
      ingestTvShow: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    mockPrisma = {
      movie: {
        findUnique: jest.fn(),
      },
      tvShow: {
        findUnique: jest.fn(),
      },
    };

    service = new LibraryService(
      mockLibraryRepo,
      mockUserBootstrap,
      mockTmdbService,
      mockPrisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('createLibraryEntry', () => {
    it('throws BadRequestException if neither tmdbId nor mediaId is provided', async () => {
      await expect(
        service.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if both tmdbId and mediaId are provided', async () => {
      await expect(
        service.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          tmdbId: 550,
          mediaId: MOCK_MOVIE_ID,
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ingests movie from TMDB if not already in catalogue', async () => {
      mockPrisma.movie.findUnique.mockResolvedValueOnce(null);
      mockTmdbService.ingestMovie.mockResolvedValueOnce({
        id: MOCK_MOVIE_ID,
        tmdbId: 550,
        title: 'Fight Club',
        genresCount: 1,
        keywordsCount: 1,
        castCount: 1,
        syncedAt: new Date(),
      });

      mockLibraryRepo.createEntry.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.PLAN_TO_WATCH,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: {
          id: MOCK_MOVIE_ID,
          tmdbId: 550,
          title: 'Fight Club',
          posterPath: null,
          backdropPath: null,
          releaseDate: null,
          voteAverage: 8.4,
          runtime: 139,
        },
        tvShow: null,
      });

      const result = await service.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        tmdbId: 550,
        status: LibraryStatus.PLAN_TO_WATCH,
      });

      expect(mockTmdbService.ingestMovie).toHaveBeenCalledWith(550);
      expect(mockLibraryRepo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          movieId: MOCK_MOVIE_ID,
          tvShowId: null,
        }),
      );
      expect(result.id).toBe(MOCK_ENTRY_ID);
    });

    it('throws NotFoundException if mediaId does not exist in catalogue', async () => {
      mockPrisma.movie.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          mediaId: MOCK_MOVIE_ID,
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listLibrary', () => {
    it('queries entries for the authenticated single user and maps responses', async () => {
      mockLibraryRepo.findEntries.mockResolvedValueOnce({
        items: [
          {
            id: MOCK_ENTRY_ID,
            userId: TEST_USER_ID,
            mediaType: MediaType.MOVIE,
            movieId: MOCK_MOVIE_ID,
            tvShowId: null,
            status: LibraryStatus.COMPLETED,
            personalRating: new Prisma.Decimal('9.00'),
            notes: 'Masterpiece',
            createdAt: new Date(),
            updatedAt: new Date(),
            movie: {
              id: MOCK_MOVIE_ID,
              tmdbId: 550,
              title: 'Fight Club',
              posterPath: null,
              backdropPath: null,
              releaseDate: null,
              voteAverage: 8.4,
              runtime: 139,
            },
            tvShow: null,
            viewingEvents: [
              {
                id: 'v1',
                libraryEntryId: MOCK_ENTRY_ID,
                watchedAt: new Date('2026-01-01T00:00:00Z'),
                rating: new Prisma.Decimal('9.00'),
                notes: null,
              },
            ],
            _count: { viewingEvents: 1, episodeProgresses: 0 },
          },
        ],
        totalResults: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const res = await service.listLibrary({
        page: 1,
        limit: 20,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      expect(res.totalResults).toBe(1);
      expect(res.items[0].watchStats.totalWatchCount).toBe(1);
      expect(res.items[0].watchStats.firstWatchedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getLibraryEntry', () => {
    it('throws NotFoundException if entry not found', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce(null);
      await expect(service.getLibraryEntry(MOCK_ENTRY_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLibraryEntry', () => {
    it('throws NotFoundException if entry not found', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce(null);
      await expect(
        service.updateLibraryEntry(MOCK_ENTRY_ID, { status: LibraryStatus.COMPLETED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates entry successfully', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.PLAN_TO_WATCH,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      mockLibraryRepo.updateEntry.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.COMPLETED,
        personalRating: new Prisma.Decimal('8.50'),
        notes: 'Great',
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      const res = await service.updateLibraryEntry(MOCK_ENTRY_ID, {
        status: LibraryStatus.COMPLETED,
        personalRating: 8.5,
        notes: 'Great',
      });

      expect(res.status).toBe(LibraryStatus.COMPLETED);
      expect(res.personalRating).toBe(8.5);
    });
  });

  describe('deleteLibraryEntry', () => {
    it('throws NotFoundException if entry not found', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce(null);
      await expect(service.deleteLibraryEntry(MOCK_ENTRY_ID)).rejects.toThrow(NotFoundException);
    });

    it('calls repository deleteEntry', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.PLAN_TO_WATCH,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      await service.deleteLibraryEntry(MOCK_ENTRY_ID);
      expect(mockLibraryRepo.deleteEntry).toHaveBeenCalledWith(MOCK_ENTRY_ID);
    });
  });

  describe('createViewingEvent', () => {
    it('records viewing event without altering library status', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      const watchedDate = new Date('2026-11-07T12:00:00Z');
      mockLibraryRepo.createViewingEvent.mockResolvedValueOnce({
        id: 'event-uuid',
        libraryEntryId: MOCK_ENTRY_ID,
        watchedAt: watchedDate,
        rating: new Prisma.Decimal('9.50'),
        notes: 'Second watch',
      });

      const res = await service.createViewingEvent(MOCK_ENTRY_ID, {
        watchedAt: watchedDate.toISOString(),
        rating: 9.5,
        notes: 'Second watch',
      });

      expect(res.rating).toBe(9.5);
      expect(res.libraryEntryId).toBe(MOCK_ENTRY_ID);
      expect(mockLibraryRepo.updateEntry).not.toHaveBeenCalled();
    });
  });

  describe('createEpisodeProgress', () => {
    it('rejects MOVIE entries with BadRequestException', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      await expect(
        service.createEpisodeProgress(MOCK_ENTRY_ID, { episodeId: MOCK_EPISODE_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns alreadyWatched: true if progress already recorded (idempotency)', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.TV,
        movieId: null,
        tvShowId: MOCK_TV_ID,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      const watchedDate = new Date('2026-11-01T00:00:00Z');
      mockLibraryRepo.findEpisodeProgress.mockResolvedValueOnce({
        libraryEntryId: MOCK_ENTRY_ID,
        episodeId: MOCK_EPISODE_ID,
        watchedAt: watchedDate,
      });

      const res = await service.createEpisodeProgress(MOCK_ENTRY_ID, {
        episodeId: MOCK_EPISODE_ID,
      });
      expect(res.alreadyWatched).toBe(true);
      expect(mockLibraryRepo.createEpisodeProgress).not.toHaveBeenCalled();
    });
  });

  describe('markAllWatched', () => {
    it('rejects MOVIE entries with BadRequestException', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      await expect(
        service.markAllWatched(MOCK_ENTRY_ID, { includeSpecials: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('calls repository markAllWatched and returns addedCount', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.TV,
        movieId: null,
        tvShowId: MOCK_TV_ID,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      mockLibraryRepo.markAllWatched.mockResolvedValueOnce(12);

      const res = await service.markAllWatched(MOCK_ENTRY_ID, { includeSpecials: false });
      expect(res.addedCount).toBe(12);
      expect(mockLibraryRepo.markAllWatched).toHaveBeenCalledWith(MOCK_ENTRY_ID, MOCK_TV_ID, false);
    });
  });

  describe('createSeasonRating & updateSeasonRating', () => {
    it('rejects MOVIE entries for season ratings', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.MOVIE,
        movieId: MOCK_MOVIE_ID,
        tvShowId: null,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      await expect(
        service.createSeasonRating(MOCK_ENTRY_ID, { seasonId: MOCK_SEASON_ID, rating: 8.5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates season rating if existing record found', async () => {
      mockLibraryRepo.findEntryById.mockResolvedValueOnce({
        id: MOCK_ENTRY_ID,
        userId: TEST_USER_ID,
        mediaType: MediaType.TV,
        movieId: null,
        tvShowId: MOCK_TV_ID,
        status: LibraryStatus.WATCHING,
        personalRating: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        movie: null,
        tvShow: null,
      });

      mockLibraryRepo.findSeasonRating.mockResolvedValueOnce({
        id: 'rating-uuid',
        libraryEntryId: MOCK_ENTRY_ID,
        seasonId: MOCK_SEASON_ID,
        rating: new Prisma.Decimal('7.00'),
        createdAt: new Date(),
        updatedAt: new Date(),
        season: { seasonNumber: 1 },
      });

      mockLibraryRepo.updateSeasonRating.mockResolvedValueOnce({
        id: 'rating-uuid',
        libraryEntryId: MOCK_ENTRY_ID,
        seasonId: MOCK_SEASON_ID,
        rating: new Prisma.Decimal('9.50'),
        createdAt: new Date(),
        updatedAt: new Date(),
        season: { seasonNumber: 1 },
      });

      const res = await service.updateSeasonRating(MOCK_ENTRY_ID, MOCK_SEASON_ID, { rating: 9.5 });
      expect(res.rating).toBe(9.5);
    });
  });
});
