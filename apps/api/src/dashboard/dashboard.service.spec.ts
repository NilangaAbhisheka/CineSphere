import { DashboardService } from './dashboard.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';

const MOCK_USER_ID = '11111111-1111-4111-a111-111111111111';

function makePrismaMock() {
  return {
    userLibraryEntry: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    viewingEvent: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    episodeProgress: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    episode: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    movie: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tvShow: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let userBootstrap: { getUserId: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    userBootstrap = { getUserId: jest.fn().mockReturnValue(MOCK_USER_ID) };
    service = new DashboardService(
      prisma as unknown as PrismaService,
      userBootstrap as unknown as SingleUserBootstrap,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── getStats ──────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns all zeros when library is empty', async () => {
      const stats = await service.getStats();

      expect(stats).toEqual({
        totalMovies: 0,
        completedMovies: 0,
        watchingTvShows: 0,
        completedTvShows: 0,
        totalEpisodesWatched: 0,
        totalViewingEvents: 0,
        recentActivityCount: 0,
      });
    });

    it('combines recentViewingEvents + recentEpisodeProgress for recentActivityCount', async () => {
      // userLibraryEntry.count is called 4 times (totalMovies, completedMovies, watchingTv, completedTv)
      prisma.userLibraryEntry.count
        .mockResolvedValueOnce(5) // totalMovies
        .mockResolvedValueOnce(3) // completedMovies
        .mockResolvedValueOnce(2) // watchingTvShows
        .mockResolvedValueOnce(1); // completedTvShows

      // episodeProgress.count is called 2 times (total, recent)
      prisma.episodeProgress.count
        .mockResolvedValueOnce(40) // totalEpisodesWatched
        .mockResolvedValueOnce(7); // recent

      // viewingEvent.count is called 2 times (total, recent)
      prisma.viewingEvent.count
        .mockResolvedValueOnce(10) // totalViewingEvents
        .mockResolvedValueOnce(4); // recent

      const stats = await service.getStats();

      expect(stats.totalMovies).toBe(5);
      expect(stats.completedMovies).toBe(3);
      expect(stats.watchingTvShows).toBe(2);
      expect(stats.completedTvShows).toBe(1);
      expect(stats.totalEpisodesWatched).toBe(40);
      expect(stats.totalViewingEvents).toBe(10);
      // recentActivityCount = 4 (viewing events) + 7 (episode progress) = 11
      expect(stats.recentActivityCount).toBe(11);
    });

    it('passes userId in all count where clauses', async () => {
      await service.getStats();

      const allCalls = [
        ...prisma.userLibraryEntry.count.mock.calls,
        ...prisma.episodeProgress.count.mock.calls,
        ...prisma.viewingEvent.count.mock.calls,
      ];
      for (const [args] of allCalls) {
        const whereStr = JSON.stringify(args?.where ?? {});
        expect(whereStr).toContain(MOCK_USER_ID);
      }
    });
  });

  // ─── getContinueWatching ──────────────────────────────────────────────────

  describe('getContinueWatching()', () => {
    it('returns empty array when no WATCHING TV entries exist', async () => {
      const result = await service.getContinueWatching();
      expect(result).toEqual([]);
    });

    it('excludes shows where all regular episodes are watched', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          tvShowId: 'show-1',
          tvShow: {
            id: 'show-1',
            tmdbId: 101,
            name: 'Test Show',
            posterPath: null,
            backdropPath: null,
          },
          episodeProgresses: [
            { episodeId: 'ep-1', watchedAt: new Date('2026-01-01') },
            { episodeId: 'ep-2', watchedAt: new Date('2026-01-02') },
          ],
        },
      ]);

      prisma.episode.findMany.mockResolvedValue([
        { id: 'ep-1', episodeNumber: 1, name: 'Pilot', season: { seasonNumber: 1 } },
        { id: 'ep-2', episodeNumber: 2, name: 'Part 2', season: { seasonNumber: 1 } },
      ]);

      const result = await service.getContinueWatching();
      expect(result).toEqual([]);
    });

    it('includes show with unwatched episodes and calculates nextEpisode', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          tvShowId: 'show-1',
          tvShow: {
            id: 'show-1',
            tmdbId: 101,
            name: 'Ongoing Show',
            posterPath: '/poster.jpg',
            backdropPath: null,
          },
          episodeProgresses: [{ episodeId: 'ep-1', watchedAt: new Date('2026-01-10') }],
        },
      ]);

      prisma.episode.findMany.mockResolvedValue([
        { id: 'ep-1', episodeNumber: 1, name: 'Pilot', season: { seasonNumber: 1 } },
        { id: 'ep-2', episodeNumber: 2, name: 'Second', season: { seasonNumber: 1 } },
        { id: 'ep-3', episodeNumber: 3, name: 'Third', season: { seasonNumber: 1 } },
      ]);

      const result = await service.getContinueWatching();
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item.libraryEntryId).toBe('entry-1');
      expect(item.tvShow.name).toBe('Ongoing Show');
      expect(item.episodesWatched).toBe(1);
      expect(item.totalEligibleEpisodes).toBe(3);
      expect(item.progressPercentage).toBe(33);
      expect(item.nextEpisode?.episodeId).toBe('ep-2');
      expect(item.nextEpisode?.episodeNumber).toBe(2);
      expect(item.nextEpisode?.seasonNumber).toBe(1);
      expect(item.lastWatchedAt).toBe(new Date('2026-01-10').toISOString());
    });

    it('shows S01E01 as nextEpisode when no progress exists', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'entry-2',
          tvShowId: 'show-2',
          tvShow: {
            id: 'show-2',
            tmdbId: 202,
            name: 'Fresh Show',
            posterPath: null,
            backdropPath: null,
          },
          episodeProgresses: [],
        },
      ]);

      prisma.episode.findMany.mockResolvedValue([
        { id: 'ep-10', episodeNumber: 1, name: 'Begin', season: { seasonNumber: 1 } },
      ]);

      const result = await service.getContinueWatching();
      expect(result).toHaveLength(1);
      expect(result[0].episodesWatched).toBe(0);
      expect(result[0].lastWatchedAt).toBeNull();
      expect(result[0].nextEpisode?.episodeNumber).toBe(1);
      expect(result[0].nextEpisode?.seasonNumber).toBe(1);
    });

    it('sorts by lastWatchedAt descending, nulls last', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'entry-no-progress',
          tvShowId: 'show-a',
          tvShow: {
            id: 'show-a',
            tmdbId: 1,
            name: 'No Progress',
            posterPath: null,
            backdropPath: null,
          },
          episodeProgresses: [],
        },
        {
          id: 'entry-older',
          tvShowId: 'show-b',
          tvShow: { id: 'show-b', tmdbId: 2, name: 'Older', posterPath: null, backdropPath: null },
          episodeProgresses: [{ episodeId: 'ep-b1', watchedAt: new Date('2026-01-05') }],
        },
        {
          id: 'entry-newer',
          tvShowId: 'show-c',
          tvShow: { id: 'show-c', tmdbId: 3, name: 'Newer', posterPath: null, backdropPath: null },
          episodeProgresses: [{ episodeId: 'ep-c1', watchedAt: new Date('2026-01-20') }],
        },
      ]);

      // All have one unwatched episode remaining
      prisma.episode.findMany
        .mockResolvedValueOnce([
          { id: 'ep-a1', episodeNumber: 1, name: null, season: { seasonNumber: 1 } },
          { id: 'ep-a2', episodeNumber: 2, name: null, season: { seasonNumber: 1 } },
        ])
        .mockResolvedValueOnce([
          { id: 'ep-b1', episodeNumber: 1, name: null, season: { seasonNumber: 1 } },
          { id: 'ep-b2', episodeNumber: 2, name: null, season: { seasonNumber: 1 } },
        ])
        .mockResolvedValueOnce([
          { id: 'ep-c1', episodeNumber: 1, name: null, season: { seasonNumber: 1 } },
          { id: 'ep-c2', episodeNumber: 2, name: null, season: { seasonNumber: 1 } },
        ]);

      const result = await service.getContinueWatching();
      expect(result).toHaveLength(3);
      expect(result[0].tvShow.name).toBe('Newer');
      expect(result[1].tvShow.name).toBe('Older');
      expect(result[2].tvShow.name).toBe('No Progress');
    });
  });

  // ─── getRecentActivity ───────────────────────────────────────────────────

  describe('getRecentActivity()', () => {
    it('returns empty array when no activity exists', async () => {
      const result = await service.getRecentActivity();
      expect(result).toEqual([]);
    });

    it('tags movie events as MOVIE and TV progress as TV_EPISODE', async () => {
      prisma.viewingEvent.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2026-02-15'),
          rating: null,
          libraryEntryId: 'lib-m1',
          libraryEntry: {
            movie: { id: 'mov-1', tmdbId: 10, title: 'The Movie', posterPath: '/m.jpg' },
          },
        },
      ]);
      prisma.episodeProgress.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2026-02-16'),
          libraryEntryId: 'lib-tv1',
          libraryEntry: {
            tvShow: { id: 'tv-1', tmdbId: 20, name: 'The Show', posterPath: '/s.jpg' },
          },
          episode: { episodeNumber: 3, name: 'Episode 3', season: { seasonNumber: 2 } },
        },
      ]);

      const result = await service.getRecentActivity();
      expect(result).toHaveLength(2);
      expect(result[0].activityType).toBe('TV_EPISODE');
      expect(result[0].episodeNumber).toBe(3);
      expect(result[0].seasonNumber).toBe(2);
      expect(result[1].activityType).toBe('MOVIE');
      expect(result[1].movie?.title).toBe('The Movie');
    });

    it('merges and sorts by watchedAt descending', async () => {
      prisma.viewingEvent.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2026-01-10'),
          rating: null,
          libraryEntryId: 'lib-m',
          libraryEntry: { movie: { id: 'm1', tmdbId: 1, title: 'Movie A', posterPath: null } },
        },
      ]);
      prisma.episodeProgress.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2026-01-20'),
          libraryEntryId: 'lib-tv',
          libraryEntry: { tvShow: { id: 'tv1', tmdbId: 2, name: 'Show B', posterPath: null } },
          episode: { episodeNumber: 1, name: null, season: { seasonNumber: 1 } },
        },
      ]);

      const result = await service.getRecentActivity();
      expect(result[0].activityType).toBe('TV_EPISODE');
      expect(result[1].activityType).toBe('MOVIE');
    });

    it('converts Decimal rating to number', async () => {
      // Use a plain number to simulate Decimal.toNumber() behavior — prisma mocks return plain objects
      prisma.viewingEvent.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2026-01-10'),
          rating: { toNumber: () => 7.5, toString: () => '7.50' } as unknown,
          libraryEntryId: 'lib-m',
          libraryEntry: { movie: { id: 'm1', tmdbId: 1, title: 'Rated Movie', posterPath: null } },
        },
      ]);

      const result = await service.getRecentActivity();
      expect(typeof result[0].viewingEventRating).toBe('number');
    });
  });

  // ─── getQuickPicks ───────────────────────────────────────────────────────

  describe('getQuickPicks()', () => {
    it('returns empty array when catalogue is empty', async () => {
      const result = await service.getQuickPicks();
      expect(result).toEqual([]);
    });

    it('excludes titles already in user library', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        { movie: { tmdbId: 100 }, tvShow: null },
        { movie: null, tvShow: { tmdbId: 200 } },
      ]);

      prisma.movie.findMany.mockResolvedValue([]);
      prisma.tvShow.findMany.mockResolvedValue([]);

      await service.getQuickPicks();

      const movieCall = prisma.movie.findMany.mock.calls[0]?.[0] as {
        where?: { tmdbId?: { notIn?: number[] } };
      };
      const tvCall = prisma.tvShow.findMany.mock.calls[0]?.[0] as {
        where?: { tmdbId?: { notIn?: number[] } };
      };

      expect(movieCall.where?.tmdbId?.notIn).toContain(100);
      expect(tvCall.where?.tmdbId?.notIn).toContain(200);
    });

    it('interleaves movies and TV shows up to limit', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([]);
      prisma.movie.findMany.mockResolvedValue([
        {
          id: 'm1',
          tmdbId: 1,
          title: 'Movie 1',
          posterPath: null,
          backdropPath: null,
          releaseDate: new Date('2024-01-01'),
          voteAverage: 8.0,
        },
        {
          id: 'm2',
          tmdbId: 2,
          title: 'Movie 2',
          posterPath: null,
          backdropPath: null,
          releaseDate: null,
          voteAverage: 7.5,
        },
      ]);
      prisma.tvShow.findMany.mockResolvedValue([
        {
          id: 'tv1',
          tmdbId: 10,
          name: 'Show 1',
          posterPath: null,
          backdropPath: null,
          firstAirDate: new Date('2023-06-01'),
          voteAverage: 9.0,
        },
        {
          id: 'tv2',
          tmdbId: 20,
          name: 'Show 2',
          posterPath: null,
          backdropPath: null,
          firstAirDate: null,
          voteAverage: 7.0,
        },
      ]);

      const result = await service.getQuickPicks(4);
      expect(result).toHaveLength(4);
      expect(result[0].mediaType).toBe('MOVIE');
      expect(result[1].mediaType).toBe('TV');
      expect(result[2].mediaType).toBe('MOVIE');
      expect(result[3].mediaType).toBe('TV');
    });

    it('extracts release year from releaseDate and firstAirDate', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([]);
      prisma.movie.findMany.mockResolvedValue([
        {
          id: 'm1',
          tmdbId: 1,
          title: 'Old Film',
          posterPath: null,
          backdropPath: null,
          releaseDate: new Date('1998-07-15'),
          voteAverage: 7.0,
        },
      ]);
      prisma.tvShow.findMany.mockResolvedValue([
        {
          id: 'tv1',
          tmdbId: 10,
          name: 'New Series',
          posterPath: null,
          backdropPath: null,
          firstAirDate: new Date('2026-03-01'),
          voteAverage: 8.0,
        },
      ]);

      const result = await service.getQuickPicks(2);
      const movie = result.find((r) => r.mediaType === 'MOVIE');
      const tv = result.find((r) => r.mediaType === 'TV');
      expect(movie?.releaseYear).toBe('1998');
      expect(tv?.releaseYear).toBe('2026');
    });

    it('returns null releaseYear when date is absent', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([]);
      prisma.movie.findMany.mockResolvedValue([
        {
          id: 'm1',
          tmdbId: 1,
          title: 'No Date',
          posterPath: null,
          backdropPath: null,
          releaseDate: null,
          voteAverage: 7.0,
        },
      ]);
      prisma.tvShow.findMany.mockResolvedValue([]);

      const result = await service.getQuickPicks(1);
      expect(result[0].releaseYear).toBeNull();
    });

    it('handles no library entries — where is empty {}', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([]);
      prisma.movie.findMany.mockResolvedValue([]);
      prisma.tvShow.findMany.mockResolvedValue([]);

      await service.getQuickPicks();

      const movieCall = prisma.movie.findMany.mock.calls[0]?.[0] as {
        where?: Record<string, unknown>;
      };
      expect(movieCall.where).toEqual({});
    });
  });

  // ─── getOverview ─────────────────────────────────────────────────────────

  describe('getOverview()', () => {
    it('returns all four sections combined', async () => {
      const result = await service.getOverview();

      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('continueWatching');
      expect(result).toHaveProperty('recentActivity');
      expect(result).toHaveProperty('quickPicks');
    });

    it('stats section has the correct shape', async () => {
      const result = await service.getOverview();

      expect(typeof result.stats.totalMovies).toBe('number');
      expect(typeof result.stats.recentActivityCount).toBe('number');
    });

    it('continueWatching is an array', async () => {
      const result = await service.getOverview();
      expect(Array.isArray(result.continueWatching)).toBe(true);
    });

    it('quickPicks is an array', async () => {
      const result = await service.getOverview();
      expect(Array.isArray(result.quickPicks)).toBe(true);
    });
  });
});
