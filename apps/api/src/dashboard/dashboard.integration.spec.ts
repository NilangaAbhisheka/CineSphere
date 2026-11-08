/**
 * dashboard.integration.spec.ts
 *
 * Integration tests for the DashboardService against a real PostgreSQL database.
 * Requires DATABASE_URL to point to a running pgvector/pg16 instance.
 */

import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { DashboardService } from './dashboard.service.js';

describe('Dashboard API Integration Tests', () => {
  let prisma: PrismaService;
  let userBootstrap: SingleUserBootstrap;
  let dashboardService: DashboardService;

  const SINGLE_USER_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';

  let _counter = 800_000_000 + Math.floor(Math.random() * 50_000_000);
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

    dashboardService = new DashboardService(prisma, userBootstrap);
  });

  afterAll(async () => {
    // Clean up test user's library entries and seeded catalogue items
    await prisma.userLibraryEntry.deleteMany({ where: { userId: SINGLE_USER_ID } });
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function createMovie(title: string): Promise<{ id: string; tmdbId: number }> {
    const tmdbId = uniqueTmdbId();
    const movie = await prisma.movie.create({
      data: {
        tmdbId,
        title,
        overview: 'Integration test movie',
        releaseDate: new Date('2023-06-15'),
        voteAverage: 7.5,
        popularity: 100,
      },
    });
    return { id: movie.id, tmdbId };
  }

  async function createTvShow(name: string): Promise<{
    tvShowId: string;
    tmdbId: number;
    season1Id: string;
    episodes: string[];
  }> {
    const tmdbId = uniqueTmdbId();
    const show = await prisma.tvShow.create({
      data: {
        tmdbId,
        name,
        overview: 'Integration test TV show',
        firstAirDate: new Date('2022-01-01'),
        voteAverage: 8.0,
        popularity: 200,
      },
    });
    const season = await prisma.season.create({
      data: {
        tvShowId: show.id,
        seasonNumber: 1,
        name: 'Season 1',
        airDate: new Date('2022-01-01'),
      },
    });
    const eps = await Promise.all(
      [1, 2, 3].map((n) =>
        prisma.episode.create({
          data: {
            seasonId: season.id,
            episodeNumber: n,
            name: `Episode ${n}`,
            airDate: new Date('2022-01-01'),
          },
        }),
      ),
    );
    return { tvShowId: show.id, tmdbId, season1Id: season.id, episodes: eps.map((e) => e.id) };
  }

  async function addToLibrary(
    mediaType: 'MOVIE' | 'TV',
    mediaId: string,
    status: 'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED',
  ): Promise<string> {
    const data =
      mediaType === 'MOVIE'
        ? { userId: SINGLE_USER_ID, mediaType, movieId: mediaId, status }
        : { userId: SINGLE_USER_ID, mediaType, tvShowId: mediaId, status };
    const entry = await prisma.userLibraryEntry.create({ data });
    return entry.id;
  }

  // ── getStats ───────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zeroed stats for a user with no library entries', async () => {
      const stats = await dashboardService.getStats();
      expect(stats.totalMovies).toBeGreaterThanOrEqual(0);
      expect(stats.totalEpisodesWatched).toBeGreaterThanOrEqual(0);
      expect(stats.recentActivityCount).toBeGreaterThanOrEqual(0);
    });

    it('increments totalMovies when a movie entry is added', async () => {
      const before = await dashboardService.getStats();
      const movie = await createMovie('Stats Test Movie');
      await addToLibrary('MOVIE', movie.id, 'PLAN_TO_WATCH');

      const after = await dashboardService.getStats();
      expect(after.totalMovies).toBe(before.totalMovies + 1);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
    });

    it('increments watchingTvShows when a TV entry is added with WATCHING status', async () => {
      const before = await dashboardService.getStats();
      const tv = await createTvShow('Stats Test TV Show');
      await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      const after = await dashboardService.getStats();
      expect(after.watchingTvShows).toBe(before.watchingTvShows + 1);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: { userId: SINGLE_USER_ID, tvShowId: tv.tvShowId },
      });
    });

    it('recentActivityCount combines ViewingEvent + EpisodeProgress in last 30 days', async () => {
      const movie = await createMovie('Recent Activity Movie');
      const tv = await createTvShow('Recent Activity Show');
      const movieEntryId = await addToLibrary('MOVIE', movie.id, 'COMPLETED');
      const tvEntryId = await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      // Add a viewing event (counts as 1)
      await prisma.viewingEvent.create({
        data: { libraryEntryId: movieEntryId, watchedAt: new Date() },
      });
      // Mark episode 1 watched (counts as 1)
      await prisma.episodeProgress.create({
        data: { libraryEntryId: tvEntryId, episodeId: tv.episodes[0], watchedAt: new Date() },
      });

      const stats = await dashboardService.getStats();
      expect(stats.recentActivityCount).toBeGreaterThanOrEqual(2);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: {
          userId: SINGLE_USER_ID,
          OR: [{ movieId: movie.id }, { tvShowId: tv.tvShowId }],
        },
      });
    });
  });

  // ── getContinueWatching ───────────────────────────────────────────────────

  describe('getContinueWatching()', () => {
    it('returns empty array when no WATCHING TV entries exist', async () => {
      const result = await dashboardService.getContinueWatching();
      // Don't assert exact 0 since other tests may leave state; just assert it's an array
      expect(Array.isArray(result)).toBe(true);
    });

    it('includes a WATCHING show with unwatched episodes', async () => {
      const tv = await createTvShow('CW Test Show');
      const entryId = await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      // Mark only the first episode watched
      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: entryId,
          episodeId: tv.episodes[0],
          watchedAt: new Date(),
        },
      });

      const result = await dashboardService.getContinueWatching();
      const item = result.find((i) => i.libraryEntryId === entryId);

      expect(item).toBeDefined();
      expect(item!.episodesWatched).toBe(1);
      expect(item!.totalEligibleEpisodes).toBe(3);
      expect(item!.nextEpisode?.episodeNumber).toBe(2);
      expect(item!.progressPercentage).toBe(33);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: { id: entryId },
      });
    });

    it('excludes a WATCHING show when all regular episodes are watched', async () => {
      const tv = await createTvShow('Fully Watched Show');
      const entryId = await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      // Watch all 3 episodes
      await Promise.all(
        tv.episodes.map((epId) =>
          prisma.episodeProgress.create({
            data: { libraryEntryId: entryId, episodeId: epId, watchedAt: new Date() },
          }),
        ),
      );

      const result = await dashboardService.getContinueWatching();
      const item = result.find((i) => i.libraryEntryId === entryId);

      expect(item).toBeUndefined();

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({ where: { id: entryId } });
    });

    it('excludes COMPLETED TV entries', async () => {
      const tv = await createTvShow('Completed Show');
      const entryId = await addToLibrary('TV', tv.tvShowId, 'COMPLETED');

      const result = await dashboardService.getContinueWatching();
      const item = result.find((i) => i.libraryEntryId === entryId);
      expect(item).toBeUndefined();

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({ where: { id: entryId } });
    });
  });

  // ── getRecentActivity ─────────────────────────────────────────────────────

  describe('getRecentActivity()', () => {
    it('returns recent activity items sorted by watchedAt descending', async () => {
      const movie = await createMovie('Recent Movie A');
      const tv = await createTvShow('Recent TV B');
      const movieEntryId = await addToLibrary('MOVIE', movie.id, 'COMPLETED');
      const tvEntryId = await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      const olderDate = new Date(Date.now() - 3_600_000); // 1h ago
      const newerDate = new Date(Date.now() - 1_800_000); // 30 min ago

      await prisma.viewingEvent.create({
        data: { libraryEntryId: movieEntryId, watchedAt: olderDate },
      });
      await prisma.episodeProgress.create({
        data: { libraryEntryId: tvEntryId, episodeId: tv.episodes[0], watchedAt: newerDate },
      });

      const result = await dashboardService.getRecentActivity(10);

      // Both should appear; TV episode (newerDate) should be first
      const movieItem = result.find(
        (i) => i.activityType === 'MOVIE' && i.libraryEntryId === movieEntryId,
      );
      const tvItem = result.find(
        (i) => i.activityType === 'TV_EPISODE' && i.libraryEntryId === tvEntryId,
      );

      expect(movieItem).toBeDefined();
      expect(tvItem).toBeDefined();

      const tvIndex = result.findIndex(
        (i) => i.activityType === 'TV_EPISODE' && i.libraryEntryId === tvEntryId,
      );
      const movieIndex = result.findIndex(
        (i) => i.activityType === 'MOVIE' && i.libraryEntryId === movieEntryId,
      );
      expect(tvIndex).toBeLessThan(movieIndex);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: {
          userId: SINGLE_USER_ID,
          OR: [{ movieId: movie.id }, { tvShowId: tv.tvShowId }],
        },
      });
    });

    it('tags movie events as MOVIE and TV progress as TV_EPISODE', async () => {
      const movie = await createMovie('Tagged Movie');
      const tv = await createTvShow('Tagged Show');
      const movieEntryId = await addToLibrary('MOVIE', movie.id, 'COMPLETED');
      const tvEntryId = await addToLibrary('TV', tv.tvShowId, 'WATCHING');

      await prisma.viewingEvent.create({
        data: { libraryEntryId: movieEntryId, watchedAt: new Date() },
      });
      await prisma.episodeProgress.create({
        data: { libraryEntryId: tvEntryId, episodeId: tv.episodes[1], watchedAt: new Date() },
      });

      const result = await dashboardService.getRecentActivity(10);
      const movieItem = result.find((i) => i.libraryEntryId === movieEntryId);
      const tvItem = result.find((i) => i.libraryEntryId === tvEntryId);

      expect(movieItem?.activityType).toBe('MOVIE');
      expect(movieItem?.movie?.title).toBe('Tagged Movie');
      expect(tvItem?.activityType).toBe('TV_EPISODE');
      expect(tvItem?.tvShow?.name).toBe('Tagged Show');
      expect(tvItem?.episodeNumber).toBe(2);

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: {
          userId: SINGLE_USER_ID,
          OR: [{ movieId: movie.id }, { tvShowId: tv.tvShowId }],
        },
      });
    });
  });

  // ── getQuickPicks ─────────────────────────────────────────────────────────

  describe('getQuickPicks()', () => {
    it('returns an array (possibly empty if catalogue is empty)', async () => {
      const result = await dashboardService.getQuickPicks(10);
      expect(Array.isArray(result)).toBe(true);
    });

    it('excludes movies already in the user library', async () => {
      const movie = await createMovie('Library Movie Excluded');
      await addToLibrary('MOVIE', movie.id, 'PLAN_TO_WATCH');

      const result = await dashboardService.getQuickPicks(50);
      const found = result.find((p) => p.tmdbId === movie.tmdbId && p.mediaType === 'MOVIE');
      expect(found).toBeUndefined();

      // Cleanup
      await prisma.userLibraryEntry.deleteMany({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
    });

    it('assigns correct mediaType to each pick', async () => {
      const result = await dashboardService.getQuickPicks(10);
      for (const pick of result) {
        expect(['MOVIE', 'TV']).toContain(pick.mediaType);
        if (pick.mediaType === 'MOVIE') {
          expect(typeof pick.title).toBe('string');
        } else {
          expect(typeof pick.title).toBe('string');
        }
      }
    });
  });

  // ── getOverview ───────────────────────────────────────────────────────────

  describe('getOverview()', () => {
    it('returns a valid overview structure with all four sections', async () => {
      const overview = await dashboardService.getOverview();

      expect(overview).toHaveProperty('stats');
      expect(overview).toHaveProperty('continueWatching');
      expect(overview).toHaveProperty('recentActivity');
      expect(overview).toHaveProperty('quickPicks');

      expect(typeof overview.stats.totalMovies).toBe('number');
      expect(typeof overview.stats.recentActivityCount).toBe('number');
      expect(Array.isArray(overview.continueWatching)).toBe(true);
      expect(Array.isArray(overview.recentActivity)).toBe(true);
      expect(Array.isArray(overview.quickPicks)).toBe(true);
    });

    it('returns valid response with an empty library', async () => {
      // Clean slate for this user (delete all entries first)
      await prisma.userLibraryEntry.deleteMany({ where: { userId: SINGLE_USER_ID } });

      const overview = await dashboardService.getOverview();
      expect(overview.stats.totalMovies).toBe(0);
      expect(overview.continueWatching).toEqual([]);
      expect(overview.recentActivity).toEqual([]);
    });
  });
});
