/**
 * stats.integration.spec.ts
 *
 * Phase 4 Stage 4.1 — PostgreSQL Integration Tests for StatsService and StatsController.
 * Runs against a dedicated test database (e.g. cinesphere_test).
 * Validates real PostgreSQL aggregations, UTC monthly grouping, boundary exclusions,
 * genre denominator invariants, and strict cross-user ownership isolation.
 */

import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { CatalogueProvenance } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { StatsService } from './stats.service.js';
import { StatsController } from './stats.controller.js';
import { IClock } from './clock.interface.js';

const TEST_DB_URL =
  process.env.CINESPHERE_E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test?schema=public';

// Safety check: ensure integration tests never target the development database
const APPROVED_DB_TOKEN_PATTERN = /(?:^|[_-])(test|e2e)(?:$|[_-])/i;
const dbName = new URL(TEST_DB_URL).pathname.replace(/^\//, '');
if (!APPROVED_DB_TOKEN_PATTERN.test(dbName) || dbName === 'cinesphere') {
  throw new Error(`Integration test cannot run against non-test database: "${dbName}"`);
}

describe('Stats API PostgreSQL Integration Tests', () => {
  let prisma: PrismaService;
  let userBootstrap: SingleUserBootstrap;
  let statsService: StatsService;
  let statsController: StatsController;

  const PRIMARY_USER_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b41';
  const OTHER_USER_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c42';

  const createdMovieIds: string[] = [];
  const createdTvShowIds: string[] = [];
  const createdGenreIds: number[] = [];

  // Deterministic mock clock: 2026-11-15T12:00:00.000Z
  const FIXED_NOW = new Date('2026-11-15T12:00:00.000Z');
  const mockClock: IClock = { now: () => new Date(FIXED_NOW.getTime()) };

  let _counter = 850_000_000 + Math.floor(Math.random() * 50_000_000);
  function uniqueTmdbId(): number {
    return ++_counter;
  }

  beforeAll(async () => {
    // Override DATABASE_URL in process.env so PrismaService connects to test DB
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaService();
    await prisma.$connect();

    // Clean up test users if existing
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [PRIMARY_USER_ID, OTHER_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [PRIMARY_USER_ID, OTHER_USER_ID] } },
    });

    // Create test users
    await prisma.user.create({
      data: { id: PRIMARY_USER_ID, displayName: 'Stats Test Primary User' },
    });
    await prisma.user.create({
      data: { id: OTHER_USER_ID, displayName: 'Stats Test Other User' },
    });

    const mockConfig = {
      get: (key: string) => {
        if (key === 'CINESPHERE_SINGLE_USER_ID') return PRIMARY_USER_ID;
        return null;
      },
    } as unknown as ConfigService;

    userBootstrap = new SingleUserBootstrap(mockConfig, prisma);
    await userBootstrap.bootstrap();

    statsService = new StatsService(prisma, userBootstrap, mockClock);
    statsController = new StatsController(statsService);
  });

  afterAll(async () => {
    // Clean up library entries and users
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [PRIMARY_USER_ID, OTHER_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [PRIMARY_USER_ID, OTHER_USER_ID] } },
    });
    if (createdMovieIds.length > 0) {
      await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds } } });
    }
    if (createdTvShowIds.length > 0) {
      await prisma.tvShow.deleteMany({ where: { id: { in: createdTvShowIds } } });
    }
    if (createdGenreIds.length > 0) {
      await prisma.genre.deleteMany({ where: { tmdbId: { in: createdGenreIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Ensure clean library state for test users before each test block
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [PRIMARY_USER_ID, OTHER_USER_ID] } },
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function createMovie(title: string, genreTmdbIds: number[] = []): Promise<string> {
    const tmdbId = uniqueTmdbId();
    for (const gid of genreTmdbIds) {
      if (!createdGenreIds.includes(gid)) createdGenreIds.push(gid);
    }
    const movie = await prisma.movie.create({
      data: {
        tmdbId,
        title,
        overview: 'Stats test movie',
        releaseDate: new Date('2024-01-01'),
        provenance: CatalogueProvenance.SYNTHETIC,
        genres: {
          connectOrCreate: genreTmdbIds.map((id) => ({
            where: { tmdbId: id },
            create: { tmdbId: id, name: `Genre-${id}` },
          })),
        },
      },
    });
    createdMovieIds.push(movie.id);
    return movie.id;
  }

  async function createTvShow(
    name: string,
    genreTmdbIds: number[] = [],
  ): Promise<{ tvShowId: string; episodeIds: string[] }> {
    const tmdbId = uniqueTmdbId();
    for (const gid of genreTmdbIds) {
      if (!createdGenreIds.includes(gid)) createdGenreIds.push(gid);
    }
    const tvShow = await prisma.tvShow.create({
      data: {
        tmdbId,
        name,
        overview: 'Stats test TV show',
        firstAirDate: new Date('2024-01-01'),
        provenance: CatalogueProvenance.SYNTHETIC,
        genres: {
          connectOrCreate: genreTmdbIds.map((id) => ({
            where: { tmdbId: id },
            create: { tmdbId: id, name: `Genre-${id}` },
          })),
        },
      },
    });
    createdTvShowIds.push(tvShow.id);

    const season = await prisma.season.create({
      data: {
        tvShowId: tvShow.id,
        seasonNumber: 1,
        name: 'Season 1',
      },
    });

    const ep1 = await prisma.episode.create({
      data: { seasonId: season.id, episodeNumber: 1, name: 'Ep 1' },
    });
    const ep2 = await prisma.episode.create({
      data: { seasonId: season.id, episodeNumber: 2, name: 'Ep 2' },
    });
    const ep3 = await prisma.episode.create({
      data: { seasonId: season.id, episodeNumber: 3, name: 'Ep 3' },
    });

    return { tvShowId: tvShow.id, episodeIds: [ep1.id, ep2.id, ep3.id] };
  }

  // ── 1. Overview Endpoints & Metric Invariants ───────────────────────────────

  describe('GET /api/stats/overview', () => {
    it('returns zeroes and null rating when the user library is empty', async () => {
      const overview = await statsController.getOverview();

      expect(overview).toEqual({
        moviesCompleted: 0,
        movieViewingEvents: 0,
        episodesWatched: 0,
        tvShowsCompleted: 0,
        averagePersonalRating: null,
      });
    });

    it('accurately counts completed movies, repeat viewings, completed TV shows, and episode progress', async () => {
      const movieId1 = await createMovie('Interstellar');
      const movieId2 = await createMovie('Inception');
      const { tvShowId, episodeIds } = await createTvShow('Breaking Bad');

      // Movie 1: COMPLETED, personalRating 8.5, 2 viewing events
      const movieEntry1 = await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movieId1,
          status: 'COMPLETED',
          personalRating: 8.5,
        },
      });
      await prisma.viewingEvent.createMany({
        data: [
          { libraryEntryId: movieEntry1.id, watchedAt: new Date('2026-05-10T14:00:00Z') },
          { libraryEntryId: movieEntry1.id, watchedAt: new Date('2026-06-15T16:00:00Z') },
        ],
      });

      // Movie 2: WATCHING (not completed), personalRating null, 1 viewing event
      const movieEntry2 = await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movieId2,
          status: 'WATCHING',
        },
      });
      await prisma.viewingEvent.create({
        data: { libraryEntryId: movieEntry2.id, watchedAt: new Date('2026-07-01T12:00:00Z') },
      });

      // TV Show: COMPLETED, personalRating 7.0, 3 episodes watched
      const tvEntry = await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'TV',
          tvShowId,
          status: 'COMPLETED',
          personalRating: 7.0,
        },
      });
      for (const epId of episodeIds) {
        await prisma.episodeProgress.create({
          data: {
            libraryEntryId: tvEntry.id,
            episodeId: epId,
            watchedAt: new Date('2026-08-01T18:00:00Z'),
          },
        });
      }

      const overview = await statsController.getOverview();

      expect(overview.moviesCompleted).toBe(1); // Only Movie 1 is completed
      expect(overview.movieViewingEvents).toBe(3); // 2 on Movie 1 + 1 on Movie 2
      expect(overview.tvShowsCompleted).toBe(1); // TV show is completed
      expect(overview.episodesWatched).toBe(3); // 3 episodes checked off
      // Average personal rating: (8.5 + 7.0) / 2 = 7.75 -> rounded to 7.8
      expect(overview.averagePersonalRating).toBe(7.8);
    });

    it('returns null averagePersonalRating when titles exist but none are rated', async () => {
      const movieId = await createMovie('Unrated Film');
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId,
          status: 'COMPLETED',
          personalRating: null,
        },
      });

      const overview = await statsController.getOverview();
      expect(overview.moviesCompleted).toBe(1);
      expect(overview.averagePersonalRating).toBeNull();
    });
  });

  // ── 2. Genre Distribution & Denominator Invariant ───────────────────────────

  describe('GET /api/stats/genres', () => {
    it('returns an empty array when the user has no completed titles', async () => {
      const genres = await statsController.getGenres();
      expect(genres).toEqual([]);
    });

    it('calculates genre percentages using total completed titles (including genre-less titles) as denominator', async () => {
      // 3 genres: 28 (Action), 878 (SciFi), 18 (Drama)
      const sciFiActionMovie = await createMovie('Alien', [28, 878]);
      const { tvShowId: sciFiTv } = await createTvShow('Dark', [878]);
      const noGenreMovie = await createMovie('Art Film', []);
      const planToWatchDramaMovie = await createMovie('Unwatched Drama', [18]);

      // Completed titles:
      // Title 1: Alien [Action, SciFi] (COMPLETED)
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: sciFiActionMovie,
          status: 'COMPLETED',
        },
      });
      // Title 2: Dark [SciFi] (COMPLETED)
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'TV',
          tvShowId: sciFiTv,
          status: 'COMPLETED',
        },
      });
      // Title 3: Art Film [] (COMPLETED - NO GENRES)
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: noGenreMovie,
          status: 'COMPLETED',
        },
      });

      // Non-completed title: Unwatched Drama [Drama] (PLAN_TO_WATCH - should be excluded)
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: planToWatchDramaMovie,
          status: 'PLAN_TO_WATCH',
        },
      });

      const genres = await statsController.getGenres();

      // Total completed titles denominator D = 3
      // Sci-Fi (878): 2 titles -> round((2 / 3) * 100) = 67%
      // Action (28): 1 title -> round((1 / 3) * 100) = 33%
      // Drama (18): 0 completed titles -> omitted from results
      expect(genres).toHaveLength(2);

      expect(genres[0]).toEqual({
        genreId: 878,
        name: 'Genre-878',
        completedTitleCount: 2,
        percentage: 67,
      });

      expect(genres[1]).toEqual({
        genreId: 28,
        name: 'Genre-28',
        completedTitleCount: 1,
        percentage: 33,
      });
    });
  });

  // ── 3. Monthly Activity Timeline (Database-Side Aggregation & UTC) ──────────

  describe('GET /api/stats/activity', () => {
    it('aggregates events in PostgreSQL by UTC month and excludes events outside requested range', async () => {
      const movieId = await createMovie('Tenet');
      const { tvShowId, episodeIds } = await createTvShow('Westworld');

      const movieEntry = await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId,
          status: 'COMPLETED',
        },
      });

      const tvEntry = await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'TV',
          tvShowId,
          status: 'WATCHING',
        },
      });

      // Seed events with precise UTC boundaries:
      // 1. April 30 at 23:59:59.999Z -> UTC month 2026-04 (outside May-June query)
      await prisma.viewingEvent.create({
        data: {
          libraryEntryId: movieEntry.id,
          watchedAt: new Date('2026-04-30T23:59:59.999Z'),
        },
      });

      // 2. May 1 at 00:00:00.000Z -> UTC month 2026-05 (inside May-June query)
      await prisma.viewingEvent.create({
        data: {
          libraryEntryId: movieEntry.id,
          watchedAt: new Date('2026-05-01T00:00:00.000Z'),
        },
      });

      // 3. May 15 episode progress -> UTC month 2026-05
      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: tvEntry.id,
          episodeId: episodeIds[0],
          watchedAt: new Date('2026-05-15T18:00:00.000Z'),
        },
      });

      // 4. July 1 at 00:00:00.000Z -> UTC month 2026-07 (outside May-June query)
      await prisma.viewingEvent.create({
        data: {
          libraryEntryId: movieEntry.id,
          watchedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      });

      // Query exactly May 2026 to June 2026
      const activity = await statsController.getActivity({ from: '2026-05', to: '2026-06' });

      expect(activity.from).toBe('2026-05');
      expect(activity.to).toBe('2026-06');
      expect(activity.items).toHaveLength(2);

      // May: 1 movie viewing (May 1 00:00:00Z) + 1 episode (May 15) = 2
      expect(activity.items[0]).toEqual({
        period: '2026-05',
        label: 'May 2026',
        movieViewings: 1,
        episodesWatched: 1,
        totalActivity: 2,
      });

      // June: 0 viewings, 0 episodes = 0 (preserved zero-activity month)
      expect(activity.items[1]).toEqual({
        period: '2026-06',
        label: 'Jun 2026',
        movieViewings: 0,
        episodesWatched: 0,
        totalActivity: 0,
      });
    });

    it('returns continuous zero-activity months when requested range contains no events', async () => {
      const activity = await statsController.getActivity({ from: '2026-01', to: '2026-03' });

      expect(activity.items).toHaveLength(3);
      expect(activity.items.every((i) => i.totalActivity === 0)).toBe(true);
    });

    it('resolves "from" only by defaulting "to" to current UTC month', async () => {
      // Mock clock is 2026-11
      const activity = await statsController.getActivity({ from: '2026-09' });

      expect(activity.from).toBe('2026-09');
      expect(activity.to).toBe('2026-11');
      expect(activity.items).toHaveLength(3); // Sep, Oct, Nov
    });

    it('resolves "to" only by defaulting "from" to 12 months ending at "to"', async () => {
      const activity = await statsController.getActivity({ to: '2025-06' });

      expect(activity.from).toBe('2024-07');
      expect(activity.to).toBe('2025-06');
      expect(activity.items).toHaveLength(12);
    });

    it('accepts exactly 60 inclusive calendar months and rejects 61', async () => {
      // 2022-01 to 2026-12 is 60 inclusive months
      const activity = await statsController.getActivity({ from: '2022-01', to: '2026-12' });
      expect(activity.items).toHaveLength(60);

      // 2021-12 to 2026-12 is 61 inclusive months -> rejected
      await expect(statsController.getActivity({ from: '2021-12', to: '2026-12' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── 4. Personal Rating Distribution ─────────────────────────────────────────

  describe('GET /api/stats/ratings', () => {
    it('returns all 19 buckets, total rated, and unrated entries from PostgreSQL', async () => {
      const movie1 = await createMovie('Rating Test 1');
      const movie2 = await createMovie('Rating Test 2');
      const movie3 = await createMovie('Rating Test 3');
      const movie4 = await createMovie('Rating Test 4');

      // Rated: 1.0, 5.5, 10.0
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie1,
          status: 'COMPLETED',
          personalRating: 1.0,
        },
      });
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie2,
          status: 'COMPLETED',
          personalRating: 5.5,
        },
      });
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie3,
          status: 'COMPLETED',
          personalRating: 10.0,
        },
      });

      // Unrated
      await prisma.userLibraryEntry.create({
        data: {
          userId: PRIMARY_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie4,
          status: 'PLAN_TO_WATCH',
          personalRating: null,
        },
      });

      const ratings = await statsController.getRatings();

      expect(ratings.buckets).toHaveLength(19);
      expect(ratings.buckets[0]).toEqual({ rating: 1.0, count: 1 }); // 1.0
      expect(ratings.buckets[9]).toEqual({ rating: 5.5, count: 1 }); // 5.5
      expect(ratings.buckets[18]).toEqual({ rating: 10.0, count: 1 }); // 10.0
      expect(ratings.unratedLibraryEntries).toBe(1);
      expect(ratings.totalRated).toBe(3);
    });
  });

  // ── 5. Strict Cross-User Ownership Isolation ────────────────────────────────

  describe('Cross-User Ownership Isolation across all 4 endpoints', () => {
    it('guarantees another users data never bleeds into the current users statistics', async () => {
      const otherMovie = await createMovie('Other Users Movie', [28]);
      const otherTv = await createTvShow('Other Users TV', [878]);

      // Seed data exclusively for OTHER_USER_ID
      const otherEntry = await prisma.userLibraryEntry.create({
        data: {
          userId: OTHER_USER_ID,
          mediaType: 'MOVIE',
          movieId: otherMovie,
          status: 'COMPLETED',
          personalRating: 9.0,
        },
      });

      await prisma.viewingEvent.create({
        data: {
          libraryEntryId: otherEntry.id,
          watchedAt: new Date('2026-11-01T12:00:00Z'),
        },
      });

      const otherTvEntry = await prisma.userLibraryEntry.create({
        data: {
          userId: OTHER_USER_ID,
          mediaType: 'TV',
          tvShowId: otherTv.tvShowId,
          status: 'COMPLETED',
          personalRating: 8.0,
        },
      });

      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: otherTvEntry.id,
          episodeId: otherTv.episodeIds[0],
          watchedAt: new Date('2026-11-02T15:00:00Z'),
        },
      });

      // Primary user has 0 entries seeded in this test block.
      // Verify all 4 endpoints for PRIMARY_USER_ID return pure empty/zero results.

      // 1. Overview
      const overview = await statsController.getOverview();
      expect(overview).toEqual({
        moviesCompleted: 0,
        movieViewingEvents: 0,
        episodesWatched: 0,
        tvShowsCompleted: 0,
        averagePersonalRating: null,
      });

      // 2. Genres
      const genres = await statsController.getGenres();
      expect(genres).toEqual([]);

      // 3. Activity (November 2026)
      const activity = await statsController.getActivity({ from: '2026-11', to: '2026-11' });
      expect(activity.items).toHaveLength(1);
      expect(activity.items[0].totalActivity).toBe(0);

      // 4. Ratings
      const ratings = await statsController.getRatings();
      expect(ratings.totalRated).toBe(0);
      expect(ratings.unratedLibraryEntries).toBe(0);
      expect(ratings.buckets.every((b) => b.count === 0)).toBe(true);
    });
  });
});
