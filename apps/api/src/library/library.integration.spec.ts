import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LibraryStatus, MediaType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import { LibraryRepository } from './library.repository.js';
import { LibraryService } from './library.service.js';

describe('Library API Integration Tests', () => {
  let prisma: PrismaService;
  let userBootstrap: SingleUserBootstrap;
  let libraryRepo: LibraryRepository;
  let libraryService: LibraryService;
  let mockTmdbService: jest.Mocked<TmdbService>;

  const SINGLE_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  let _counter = 900_000_000 + Math.floor(Math.random() * 50_000_000);
  function uniqueTmdbId(): number {
    return ++_counter;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const mockConfig = {
      get: (key: string) => {
        if (key === 'CINESPHERE_SINGLE_USER_ID') return SINGLE_USER_ID;
        return null;
      },
    } as unknown as ConfigService;

    userBootstrap = new SingleUserBootstrap(mockConfig, prisma);
    await userBootstrap.bootstrap();

    mockTmdbService = {
      ingestMovie: jest.fn(),
      ingestTvShow: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    libraryRepo = new LibraryRepository(prisma);
    libraryService = new LibraryService(libraryRepo, userBootstrap, mockTmdbService, prisma);
  });

  afterAll(async () => {
    // Clean up all user library entries created during this test suite
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: SINGLE_USER_ID },
    });
    await prisma.$disconnect();
  });

  async function createMovie(title: string): Promise<{ id: string; tmdbId: number }> {
    const tmdbId = uniqueTmdbId();
    const movie = await prisma.movie.create({
      data: {
        tmdbId,
        title,
        overview: 'Test movie overview',
        releaseDate: new Date('2024-01-01'),
        voteAverage: 8.0,
      },
    });
    return { id: movie.id, tmdbId };
  }

  async function createTvShowWithEpisodes(name: string): Promise<{
    tvShowId: string;
    tmdbId: number;
    specialSeasonId: string;
    specialEpisodeId: string;
    season1Id: string;
    episodes: string[];
  }> {
    const tmdbId = uniqueTmdbId();
    const show = await prisma.tvShow.create({
      data: {
        tmdbId,
        name,
        overview: 'Test show overview',
        firstAirDate: new Date('2024-01-01'),
        numberOfSeasons: 1,
        numberOfEpisodes: 3,
      },
    });

    // Special Season (Season 0)
    const specialSeason = await prisma.season.create({
      data: {
        seasonNumber: 0,
        name: 'Specials',
        tvShowId: show.id,
      },
    });
    const specialEpisode = await prisma.episode.create({
      data: {
        episodeNumber: 1,
        name: 'Special Ep 1',
        seasonId: specialSeason.id,
      },
    });

    // Season 1
    const season1 = await prisma.season.create({
      data: {
        seasonNumber: 1,
        name: 'Season 1',
        tvShowId: show.id,
      },
    });

    const ep1 = await prisma.episode.create({
      data: { episodeNumber: 1, name: 'S1E1', seasonId: season1.id },
    });
    const ep2 = await prisma.episode.create({
      data: { episodeNumber: 2, name: 'S1E2', seasonId: season1.id },
    });
    const ep3 = await prisma.episode.create({
      data: { episodeNumber: 3, name: 'S1E3', seasonId: season1.id },
    });

    return {
      tvShowId: show.id,
      tmdbId,
      specialSeasonId: specialSeason.id,
      specialEpisodeId: specialEpisode.id,
      season1Id: season1.id,
      episodes: [ep1.id, ep2.id, ep3.id],
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Library Entry CRUD & Server-side User Scoping
  // ────────────────────────────────────────────────────────────────────────────
  describe('Library Entry CRUD & Scoping', () => {
    it('creates a MOVIE entry using internal mediaId with server-side userId scoping', async () => {
      const movie = await createMovie('Matrix Reloaded');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.PLAN_TO_WATCH,
        personalRating: 7.5,
        notes: 'Sci-fi classic',
      });

      expect(entry.id).toBeDefined();
      expect(entry.userId).toBe(SINGLE_USER_ID);
      expect(entry.mediaType).toBe('MOVIE');
      expect(entry.movieId).toBe(movie.id);
      expect(entry.tvShowId).toBeNull();
      expect(entry.status).toBe(LibraryStatus.PLAN_TO_WATCH);
      expect(entry.personalRating).toBe(7.5);
      expect(entry.notes).toBe('Sci-fi classic');
      expect(entry.movie?.title).toBe('Matrix Reloaded');
      expect(entry.watchStats.totalWatchCount).toBe(0);
    });

    it('creates a TV entry using internal mediaId', async () => {
      const show = await createTvShowWithEpisodes('Severance');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      expect(entry.id).toBeDefined();
      expect(entry.userId).toBe(SINGLE_USER_ID);
      expect(entry.mediaType).toBe('TV');
      expect(entry.tvShowId).toBe(show.tvShowId);
      expect(entry.movieId).toBeNull();
      expect(entry.status).toBe(LibraryStatus.WATCHING);
      expect(entry.watchStats.episodesWatched).toBe(0);
    });

    it('resolves uningested movie by tmdbId outside transactions', async () => {
      const externalTmdbId = uniqueTmdbId();
      mockTmdbService.ingestMovie.mockImplementationOnce(async (id: number) => {
        const created = await prisma.movie.create({
          data: {
            tmdbId: id,
            title: `On-Demand Movie ${id}`,
          },
        });
        return {
          id: created.id,
          tmdbId: id,
          title: created.title,
          genresCount: 0,
          keywordsCount: 0,
          castCount: 0,
          syncedAt: new Date(),
        };
      });

      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        tmdbId: externalTmdbId,
        status: LibraryStatus.PLAN_TO_WATCH,
      });

      expect(mockTmdbService.ingestMovie).toHaveBeenCalledWith(externalTmdbId);
      expect(entry.movie?.title).toContain('On-Demand Movie');
    });

    it('rejects creating duplicate library entry for the same user and movie (409 Conflict)', async () => {
      const movie = await createMovie('Interstellar Clone');
      await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.PLAN_TO_WATCH,
      });

      await expect(
        libraryService.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          mediaId: movie.id,
          status: LibraryStatus.COMPLETED,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects creating duplicate library entry for the same user and TV show (409 Conflict)', async () => {
      const show = await createTvShowWithEpisodes('Dark SciFi');
      await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.createLibraryEntry({
          mediaType: MediaType.TV,
          mediaId: show.tvShowId,
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects creating entry when both tmdbId and mediaId are provided (400 BadRequest)', async () => {
      await expect(
        libraryService.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          tmdbId: 100,
          mediaId: '00000000-0000-0000-0000-000000000000',
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects creating entry when mediaId does not exist (404 NotFound)', async () => {
      await expect(
        libraryService.createLibraryEntry({
          mediaType: MediaType.MOVIE,
          mediaId: '00000000-0000-0000-0000-000000000000',
          status: LibraryStatus.PLAN_TO_WATCH,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('retrieves library entry by ID with relations', async () => {
      const movie = await createMovie('Gladiator');
      const created = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.PLAN_TO_WATCH,
      });

      const retrieved = await libraryService.getLibraryEntry(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.movie?.title).toBe('Gladiator');
    });

    it('throws NotFoundException for non-existent library entry ID', async () => {
      await expect(
        libraryService.getLibraryEntry('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates library entry status and personal rating under READ COMMITTED', async () => {
      const movie = await createMovie('Memento');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      const updated = await libraryService.updateLibraryEntry(entry.id, {
        status: LibraryStatus.COMPLETED,
        personalRating: 9.5,
        notes: 'Incredible non-linear storytelling',
      });

      expect(updated.status).toBe(LibraryStatus.COMPLETED);
      expect(updated.personalRating).toBe(9.5);
      expect(updated.notes).toBe('Incredible non-linear storytelling');
    });

    it('rejects invalid personal rating via CHECK constraint (e.g. 7.24 or 10.5)', async () => {
      const movie = await createMovie('Tenet');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.updateLibraryEntry(entry.id, {
          personalRating: 7.24,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes library entry successfully', async () => {
      const movie = await createMovie('Dunkirk');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.PLAN_TO_WATCH,
      });

      await libraryService.deleteLibraryEntry(entry.id);
      await expect(libraryService.getLibraryEntry(entry.id)).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. ViewingEvent Append-Only Operations
  // ────────────────────────────────────────────────────────────────────────────
  describe('ViewingEvent Endpoints', () => {
    it('appends viewing events without altering library status, deriving watch counts', async () => {
      const movie = await createMovie('Blade Runner 2049');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      // Record first viewing event
      const event1 = await libraryService.createViewingEvent(entry.id, {
        watchedAt: '2026-01-10T20:00:00.000Z',
        rating: 9.0,
        notes: 'First time viewing in theater',
      });

      expect(event1.id).toBeDefined();
      expect(event1.rating).toBe(9.0);
      expect(event1.notes).toBe('First time viewing in theater');

      // Record rewatch event
      const event2 = await libraryService.createViewingEvent(entry.id, {
        watchedAt: '2026-06-15T22:00:00.000Z',
        rating: 9.5,
        notes: 'Rewatch at home 4K',
      });

      expect(event2.id).toBeDefined();
      expect(event2.rating).toBe(9.5);

      // Verify entry status is unchanged (still WATCHING) and derived stats reflect both events
      const retrieved = await libraryService.getLibraryEntry(entry.id);
      expect(retrieved.status).toBe(LibraryStatus.WATCHING);
      expect(retrieved.watchStats.totalWatchCount).toBe(2);
      expect(retrieved.watchStats.firstWatchedAt).toBe('2026-01-10T20:00:00.000Z');
      expect(retrieved.watchStats.lastWatchedAt).toBe('2026-06-15T22:00:00.000Z');
      expect(retrieved.viewingEvents?.length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. EpisodeProgress & Idempotency
  // ────────────────────────────────────────────────────────────────────────────
  describe('EpisodeProgress Endpoints', () => {
    it('rejects episode progress on MOVIE entries with 400 BadRequest', async () => {
      const movie = await createMovie('Alien');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.createEpisodeProgress(entry.id, {
          episodeId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records episode progress and behaves idempotently on repeat requests', async () => {
      const show = await createTvShowWithEpisodes('Succession');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      const epId = show.episodes[0];

      // First call marks as watched
      const res1 = await libraryService.createEpisodeProgress(entry.id, { episodeId: epId });
      expect(res1.alreadyWatched).toBe(false);
      expect(res1.episodeNumber).toBe(1);

      // Second call is idempotent
      const res2 = await libraryService.createEpisodeProgress(entry.id, { episodeId: epId });
      expect(res2.alreadyWatched).toBe(true);
      expect(res2.episodeId).toBe(epId);

      // Verify watch stats
      const retrieved = await libraryService.getLibraryEntry(entry.id);
      expect(retrieved.watchStats.episodesWatched).toBe(1);
    });

    it('rejects episode progress if episode belongs to a different TV show (trigger P0001 -> 400)', async () => {
      const showA = await createTvShowWithEpisodes('Show Alpha');
      const showB = await createTvShowWithEpisodes('Show Beta');

      const entryA = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: showA.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      // Try to mark Show B's episode on Show A's library entry
      await expect(
        libraryService.createEpisodeProgress(entryA.id, {
          episodeId: showB.episodes[0],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes episode progress cleanly and idempotently', async () => {
      const show = await createTvShowWithEpisodes('Fargo');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      const epId = show.episodes[0];
      await libraryService.createEpisodeProgress(entry.id, { episodeId: epId });

      // Unwatch
      await libraryService.deleteEpisodeProgress(entry.id, epId);

      const retrieved = await libraryService.getLibraryEntry(entry.id);
      expect(retrieved.watchStats.episodesWatched).toBe(0);

      // Idempotent delete does not error
      await expect(libraryService.deleteEpisodeProgress(entry.id, epId)).resolves.not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Mark-All-Watched & Special Season Exclusions
  // ────────────────────────────────────────────────────────────────────────────
  describe('Mark-All-Watched Endpoint', () => {
    it('rejects mark-all-watched on MOVIE entries with 400 BadRequest', async () => {
      const movie = await createMovie('Arrival');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.markAllWatched(entry.id, { includeSpecials: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks only regular season episodes by default, excluding season 0 specials', async () => {
      const show = await createTvShowWithEpisodes('Doctor Who');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      // Mark all regular episodes (should mark 3 episodes from Season 1)
      const res1 = await libraryService.markAllWatched(entry.id, { includeSpecials: false });
      expect(res1.addedCount).toBe(3);

      // Repeat is idempotent and returns addedCount: 0
      const res2 = await libraryService.markAllWatched(entry.id, { includeSpecials: false });
      expect(res2.addedCount).toBe(0);

      // Now include specials (should add the 1 special episode from Season 0)
      const res3 = await libraryService.markAllWatched(entry.id, { includeSpecials: true });
      expect(res3.addedCount).toBe(1);

      // Total episode progress count should now be 4
      const retrieved = await libraryService.getLibraryEntry(entry.id);
      expect(retrieved.watchStats.episodesWatched).toBe(4);

      // Verify no ViewingEvents were generated
      expect(retrieved.watchStats.totalWatchCount).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. SeasonRating Endpoints
  // ────────────────────────────────────────────────────────────────────────────
  describe('SeasonRating Endpoints', () => {
    it('rejects season ratings on MOVIE entries with 400 BadRequest', async () => {
      const movie = await createMovie('Heat');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.MOVIE,
        mediaId: movie.id,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.createSeasonRating(entry.id, {
          seasonId: '00000000-0000-0000-0000-000000000000',
          rating: 8.5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a season rating and rejects duplicate creation with 409 Conflict', async () => {
      const show = await createTvShowWithEpisodes('Chernobyl');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      const rating = await libraryService.createSeasonRating(entry.id, {
        seasonId: show.season1Id,
        rating: 9.5,
      });

      expect(rating.rating).toBe(9.5);
      expect(rating.seasonNumber).toBe(1);

      // Duplicate rating creation on same season
      await expect(
        libraryService.createSeasonRating(entry.id, {
          seasonId: show.season1Id,
          rating: 9.0,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects season rating if season belongs to another TV show (trigger P0001 -> 400)', async () => {
      const showA = await createTvShowWithEpisodes('Show 1');
      const showB = await createTvShowWithEpisodes('Show 2');

      const entryA = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: showA.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.createSeasonRating(entryA.id, {
          seasonId: showB.season1Id,
          rating: 8.0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates existing season rating successfully', async () => {
      const show = await createTvShowWithEpisodes('True Detective');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      await libraryService.createSeasonRating(entry.id, {
        seasonId: show.season1Id,
        rating: 8.5,
      });

      const updated = await libraryService.updateSeasonRating(entry.id, show.season1Id, {
        rating: 10.0,
      });

      expect(updated.rating).toBe(10.0);
    });

    it('throws NotFoundException when updating non-existent season rating', async () => {
      const show = await createTvShowWithEpisodes('The Wire');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.WATCHING,
      });

      await expect(
        libraryService.updateSeasonRating(entry.id, show.season1Id, { rating: 9.0 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Cascade Deletion Behavior
  // ────────────────────────────────────────────────────────────────────────────
  describe('Cascade Deletion Rules', () => {
    it('cascades deletion from UserLibraryEntry to ViewingEvents, EpisodeProgress, and SeasonRatings', async () => {
      const show = await createTvShowWithEpisodes('Breaking Bad Final');
      const entry = await libraryService.createLibraryEntry({
        mediaType: MediaType.TV,
        mediaId: show.tvShowId,
        status: LibraryStatus.COMPLETED,
      });

      // Add viewing event, episode progress, season rating
      await libraryService.createViewingEvent(entry.id, { rating: 10.0 });
      await libraryService.createEpisodeProgress(entry.id, { episodeId: show.episodes[0] });
      await libraryService.createSeasonRating(entry.id, { seasonId: show.season1Id, rating: 10.0 });

      // Delete entry
      await libraryService.deleteLibraryEntry(entry.id);

      // Verify all child rows are removed from database
      const eventsCount = await prisma.viewingEvent.count({ where: { libraryEntryId: entry.id } });
      const progressCount = await prisma.episodeProgress.count({ where: { libraryEntryId: entry.id } });
      const ratingsCount = await prisma.seasonRating.count({ where: { libraryEntryId: entry.id } });

      expect(eventsCount).toBe(0);
      expect(progressCount).toBe(0);
      expect(ratingsCount).toBe(0);
    });
  });
});
