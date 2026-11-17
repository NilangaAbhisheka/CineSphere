import { BadRequestException } from '@nestjs/common';
import { StatsService } from './stats.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { IClock } from './clock.interface.js';

const MOCK_USER_ID = '11111111-1111-4111-a111-111111111111';

function makePrismaMock() {
  return {
    userLibraryEntry: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({
        _avg: { personalRating: null as number | null },
        _count: { personalRating: 0 },
      }),
      groupBy: jest.fn().mockResolvedValue(
        [] as Array<{
          personalRating: number | null;
          _count: { _all: number };
        }>,
      ),
    },
    viewingEvent: {
      count: jest.fn().mockResolvedValue(0),
    },
    episodeProgress: {
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

describe('StatsService', () => {
  let service: StatsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let userBootstrap: { getUserId: jest.Mock };
  let mockClock: IClock;

  // Fixed deterministic clock: 2026-11-15T12:00:00.000Z
  const FIXED_NOW = new Date('2026-11-15T12:00:00.000Z');

  beforeEach(() => {
    prisma = makePrismaMock();
    userBootstrap = { getUserId: jest.fn().mockReturnValue(MOCK_USER_ID) };
    mockClock = { now: () => new Date(FIXED_NOW.getTime()) };

    service = new StatsService(
      prisma as unknown as PrismaService,
      userBootstrap as unknown as SingleUserBootstrap,
      mockClock,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── 1. getOverview ──────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns zeroes and null rating when the user library is empty', async () => {
      const overview = await service.getOverview();

      expect(userBootstrap.getUserId).toHaveBeenCalledTimes(1);
      expect(overview).toEqual({
        moviesCompleted: 0,
        movieViewingEvents: 0,
        episodesWatched: 0,
        tvShowsCompleted: 0,
        averagePersonalRating: null,
      });
    });

    it('counts completed movies without viewing events independently', async () => {
      prisma.userLibraryEntry.count.mockImplementation(
        (args: { where?: { mediaType?: string; status?: string } } | undefined) => {
          if (args?.where?.mediaType === 'MOVIE' && args?.where?.status === 'COMPLETED') {
            return Promise.resolve(2);
          }
          return Promise.resolve(0);
        },
      );
      prisma.viewingEvent.count.mockResolvedValue(0);

      const overview = await service.getOverview();

      expect(overview.moviesCompleted).toBe(2);
      expect(overview.movieViewingEvents).toBe(0);
    });

    it('counts repeat viewing events independently of completed movie count', async () => {
      prisma.userLibraryEntry.count.mockImplementation(
        (args: { where?: { mediaType?: string; status?: string } } | undefined) => {
          if (args?.where?.mediaType === 'MOVIE' && args?.where?.status === 'COMPLETED') {
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        },
      );
      prisma.viewingEvent.count.mockResolvedValue(3);

      const overview = await service.getOverview();

      expect(overview.moviesCompleted).toBe(1);
      expect(overview.movieViewingEvents).toBe(3);
    });

    it('decouples completed TV shows from watched episodes', async () => {
      prisma.userLibraryEntry.count.mockImplementation(
        (args: { where?: { mediaType?: string; status?: string } } | undefined) => {
          if (args?.where?.mediaType === 'TV' && args?.where?.status === 'COMPLETED') {
            return Promise.resolve(0);
          }
          return Promise.resolve(0);
        },
      );
      prisma.episodeProgress.count.mockResolvedValue(25);

      const overview = await service.getOverview();

      expect(overview.tvShowsCompleted).toBe(0);
      expect(overview.episodesWatched).toBe(25);
    });

    it('rounds average personal rating to one decimal place', async () => {
      prisma.userLibraryEntry.aggregate.mockResolvedValue({
        _avg: { personalRating: 8.24 },
        _count: { personalRating: 5 },
      });

      const overview = await service.getOverview();
      expect(overview.averagePersonalRating).toBe(8.2);

      prisma.userLibraryEntry.aggregate.mockResolvedValue({
        _avg: { personalRating: 8.26 },
        _count: { personalRating: 5 },
      });

      const overview2 = await service.getOverview();
      expect(overview2.averagePersonalRating).toBe(8.3);
    });

    it('returns null averagePersonalRating when count of rated titles is zero', async () => {
      prisma.userLibraryEntry.aggregate.mockResolvedValue({
        _avg: { personalRating: null },
        _count: { personalRating: 0 },
      });

      const overview = await service.getOverview();
      expect(overview.averagePersonalRating).toBeNull();
    });
  });

  // ── 2. getGenres ────────────────────────────────────────────────────────────

  describe('getGenres', () => {
    it('returns an empty array when the user has no completed titles', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([]);

      const genres = await service.getGenres();
      expect(genres).toEqual([]);
    });

    it('aggregates distinct completed titles across multiple genres without double-counting per title', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'movie-1',
          mediaType: 'MOVIE',
          movie: {
            genres: [
              { tmdbId: 28, name: 'Action' },
              { tmdbId: 878, name: 'Science Fiction' },
            ],
          },
          tvShow: null,
        },
        {
          id: 'tv-1',
          mediaType: 'TV',
          movie: null,
          tvShow: {
            genres: [{ tmdbId: 878, name: 'Science Fiction' }],
          },
        },
      ]);

      const genres = await service.getGenres();

      expect(genres).toHaveLength(2);
      // Sci-Fi: 2 titles / 2 total = 100%
      expect(genres[0]).toEqual({
        genreId: 878,
        name: 'Science Fiction',
        completedTitleCount: 2,
        percentage: 100,
      });
      // Action: 1 title / 2 total = 50%
      expect(genres[1]).toEqual({
        genreId: 28,
        name: 'Action',
        completedTitleCount: 1,
        percentage: 50,
      });
    });

    it('includes completed titles without genres in the denominator', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'movie-with-genre',
          mediaType: 'MOVIE',
          movie: {
            genres: [{ tmdbId: 28, name: 'Action' }],
          },
          tvShow: null,
        },
        {
          id: 'movie-without-genre',
          mediaType: 'MOVIE',
          movie: {
            genres: [],
          },
          tvShow: null,
        },
      ]);

      const genres = await service.getGenres();

      expect(genres).toHaveLength(1);
      // Denominator is 2 titles; Action has 1 title -> 50%
      expect(genres[0]).toEqual({
        genreId: 28,
        name: 'Action',
        completedTitleCount: 1,
        percentage: 50,
      });
    });

    it('sorts genres descending by completedTitleCount and tie-breaks alphabetically by name', async () => {
      prisma.userLibraryEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          mediaType: 'MOVIE',
          movie: {
            genres: [
              { tmdbId: 18, name: 'Drama' },
              { tmdbId: 35, name: 'Comedy' },
            ],
          },
          tvShow: null,
        },
      ]);

      const genres = await service.getGenres();

      expect(genres).toHaveLength(2);
      // Both have count 1, Comedy comes before Drama alphabetically
      expect(genres[0].name).toBe('Comedy');
      expect(genres[1].name).toBe('Drama');
    });
  });

  // ── 3. getActivity ──────────────────────────────────────────────────────────

  describe('getActivity', () => {
    it('defaults to trailing 12 months ending in current UTC month when parameters are omitted', async () => {
      // Mock clock is 2026-11-15T12:00:00.000Z -> range is 2025-12 to 2026-11 (12 months)
      prisma.$queryRaw.mockResolvedValue([]);

      const activity = await service.getActivity({});

      expect(activity.from).toBe('2025-12');
      expect(activity.to).toBe('2026-11');
      expect(activity.items).toHaveLength(12);
      expect(activity.items[0].period).toBe('2025-12');
      expect(activity.items[0].label).toBe('Dec 2025');
      expect(activity.items[11].period).toBe('2026-11');
      expect(activity.items[11].label).toBe('Nov 2026');
      expect(activity.items.every((i) => i.totalActivity === 0)).toBe(true);
    });

    it('uses current UTC month as "to" when only "from" is supplied', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const activity = await service.getActivity({ from: '2026-08' });

      expect(activity.from).toBe('2026-08');
      expect(activity.to).toBe('2026-11');
      expect(activity.items).toHaveLength(4); // Aug, Sep, Oct, Nov
      expect(activity.items.map((i) => i.period)).toEqual([
        '2026-08',
        '2026-09',
        '2026-10',
        '2026-11',
      ]);
    });

    it('uses 12-month inclusive range ending at "to" when only "to" is supplied', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const activity = await service.getActivity({ to: '2025-06' });

      expect(activity.from).toBe('2024-07');
      expect(activity.to).toBe('2025-06');
      expect(activity.items).toHaveLength(12);
      expect(activity.items[0].period).toBe('2024-07');
      expect(activity.items[11].period).toBe('2025-06');
    });

    it('uses exact supplied range when both "from" and "to" are provided', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const activity = await service.getActivity({ from: '2026-01', to: '2026-03' });

      expect(activity.from).toBe('2026-01');
      expect(activity.to).toBe('2026-03');
      expect(activity.items).toHaveLength(3);
      expect(activity.items.map((i) => i.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    });

    it('throws BadRequestException if "from" month is after "to" month', async () => {
      await expect(service.getActivity({ from: '2026-05', to: '2026-01' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts exactly 60 inclusive calendar months', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      // 2022-01 to 2026-12 is (2026-2022)*12 + (12-1) + 1 = 48 + 11 + 1 = 60 months
      const activity = await service.getActivity({ from: '2022-01', to: '2026-12' });

      expect(activity.items).toHaveLength(60);
      expect(activity.from).toBe('2022-01');
      expect(activity.to).toBe('2026-12');
    });

    it('rejects 61 inclusive calendar months with BadRequestException', async () => {
      // 2021-12 to 2026-12 is 61 months
      await expect(service.getActivity({ from: '2021-12', to: '2026-12' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('merges movie viewings and episode progress rows and fills zero-activity months', async () => {
      prisma.$queryRaw.mockImplementation((query: unknown) => {
        const queryObj = query as { strings?: string[] } | string[] | string;
        const sqlText = Array.isArray(queryObj)
          ? queryObj.join(' ')
          : ((queryObj as { strings?: string[] })?.strings?.join(' ') ?? String(queryObj));
        if (sqlText.includes('viewing_events')) {
          return Promise.resolve([
            { period: '2026-05', count: 3 },
            { period: '2026-06', count: 1 },
          ]);
        }
        if (sqlText.includes('episode_progress')) {
          return Promise.resolve([
            { period: '2026-05', count: 24 },
            { period: '2026-07', count: 10 },
          ]);
        }
        return Promise.resolve([]);
      });

      const activity = await service.getActivity({ from: '2026-05', to: '2026-08' });

      expect(activity.items).toHaveLength(4);
      // May: 3 movies + 24 episodes = 27
      expect(activity.items[0]).toEqual({
        period: '2026-05',
        label: 'May 2026',
        movieViewings: 3,
        episodesWatched: 24,
        totalActivity: 27,
      });
      // Jun: 1 movie + 0 episodes = 1
      expect(activity.items[1]).toEqual({
        period: '2026-06',
        label: 'Jun 2026',
        movieViewings: 1,
        episodesWatched: 0,
        totalActivity: 1,
      });
      // Jul: 0 movies + 10 episodes = 10
      expect(activity.items[2]).toEqual({
        period: '2026-07',
        label: 'Jul 2026',
        movieViewings: 0,
        episodesWatched: 10,
        totalActivity: 10,
      });
      // Aug: 0 movies + 0 episodes = 0 (zero-activity preserved)
      expect(activity.items[3]).toEqual({
        period: '2026-08',
        label: 'Aug 2026',
        movieViewings: 0,
        episodesWatched: 0,
        totalActivity: 0,
      });
    });
  });

  // ── 4. getRatings ───────────────────────────────────────────────────────────

  describe('getRatings', () => {
    it('returns all 19 half-step buckets in order and counts unrated library entries', async () => {
      prisma.userLibraryEntry.groupBy.mockResolvedValue([
        { personalRating: 8.5, _count: { _all: 4 } },
        { personalRating: 7.0, _count: { _all: 3 } },
        { personalRating: 10.0, _count: { _all: 1 } },
      ]);
      prisma.userLibraryEntry.count.mockResolvedValue(5);

      const ratings = await service.getRatings();

      expect(ratings.buckets).toHaveLength(19);
      expect(ratings.buckets[0]).toEqual({ rating: 1.0, count: 0 });
      expect(ratings.buckets[12]).toEqual({ rating: 7.0, count: 3 });
      expect(ratings.buckets[15]).toEqual({ rating: 8.5, count: 4 });
      expect(ratings.buckets[18]).toEqual({ rating: 10.0, count: 1 });
      expect(ratings.unratedLibraryEntries).toBe(5);
      expect(ratings.totalRated).toBe(8); // 4 + 3 + 1
    });

    it('returns all 19 buckets with count 0 when no titles have personal ratings', async () => {
      prisma.userLibraryEntry.groupBy.mockResolvedValue([]);
      prisma.userLibraryEntry.count.mockResolvedValue(2);

      const ratings = await service.getRatings();

      expect(ratings.buckets).toHaveLength(19);
      expect(ratings.buckets.every((b) => b.count === 0)).toBe(true);
      expect(ratings.unratedLibraryEntries).toBe(2);
      expect(ratings.totalRated).toBe(0);
    });
  });
});
