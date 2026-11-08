import {
  ContinueWatchingItem,
  DashboardOverviewResponse,
  DashboardStats,
  QuickPickItem,
  RecentActivityItem,
} from '@cinesphere/shared';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

const MOCK_STATS: DashboardStats = {
  totalMovies: 10,
  completedMovies: 7,
  watchingTvShows: 3,
  completedTvShows: 2,
  totalEpisodesWatched: 150,
  totalViewingEvents: 15,
  recentActivityCount: 8,
};

const MOCK_CONTINUE_WATCHING: ContinueWatchingItem[] = [
  {
    libraryEntryId: 'entry-1',
    tvShow: {
      id: 'tv-1',
      tmdbId: 100,
      name: 'Breaking Bad',
      posterPath: '/bb.jpg',
      backdropPath: null,
    },
    episodesWatched: 20,
    totalEligibleEpisodes: 62,
    progressPercentage: 32,
    nextEpisode: { episodeId: 'ep-21', episodeNumber: 1, seasonNumber: 3, name: 'No Más' },
    lastWatchedAt: '2026-10-15T18:00:00.000Z',
  },
];

const MOCK_RECENT_ACTIVITY: RecentActivityItem[] = [
  {
    activityType: 'MOVIE',
    watchedAt: '2026-10-20T12:00:00.000Z',
    libraryEntryId: 'entry-m1',
    movie: { id: 'mov-1', tmdbId: 500, title: 'Inception', posterPath: '/inc.jpg' },
    viewingEventRating: 9.0,
  },
];

const MOCK_QUICK_PICKS: QuickPickItem[] = [
  {
    id: 'mov-99',
    tmdbId: 999,
    mediaType: 'MOVIE',
    title: 'Popular Film',
    posterPath: '/pf.jpg',
    backdropPath: null,
    releaseYear: '2024',
    voteAverage: 8.5,
  },
];

const MOCK_OVERVIEW: DashboardOverviewResponse = {
  stats: MOCK_STATS,
  continueWatching: MOCK_CONTINUE_WATCHING,
  recentActivity: MOCK_RECENT_ACTIVITY,
  quickPicks: MOCK_QUICK_PICKS,
};

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: jest.Mocked<
    Pick<
      DashboardService,
      'getOverview' | 'getStats' | 'getContinueWatching' | 'getRecentActivity' | 'getQuickPicks'
    >
  >;

  beforeEach(() => {
    service = {
      getOverview: jest.fn().mockResolvedValue(MOCK_OVERVIEW),
      getStats: jest.fn().mockResolvedValue(MOCK_STATS),
      getContinueWatching: jest.fn().mockResolvedValue(MOCK_CONTINUE_WATCHING),
      getRecentActivity: jest.fn().mockResolvedValue(MOCK_RECENT_ACTIVITY),
      getQuickPicks: jest.fn().mockResolvedValue(MOCK_QUICK_PICKS),
    };

    controller = new DashboardController(service as unknown as DashboardService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── getOverview ──────────────────────────────────────────────────────────

  describe('getOverview()', () => {
    it('calls service.getOverview() and returns its result', async () => {
      const result = await controller.getOverview();
      expect(service.getOverview).toHaveBeenCalledTimes(1);
      expect(result).toBe(MOCK_OVERVIEW);
    });

    it('returns all four sections in the overview', async () => {
      const result = await controller.getOverview();
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('continueWatching');
      expect(result).toHaveProperty('recentActivity');
      expect(result).toHaveProperty('quickPicks');
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('calls service.getStats() and returns its result', async () => {
      const result = await controller.getStats();
      expect(service.getStats).toHaveBeenCalledTimes(1);
      expect(result).toBe(MOCK_STATS);
    });
  });

  // ─── getContinueWatching ──────────────────────────────────────────────────

  describe('getContinueWatching()', () => {
    it('calls service with default limit 10 when no query param', async () => {
      const result = await controller.getContinueWatching(undefined);
      expect(service.getContinueWatching).toHaveBeenCalledWith(10);
      expect(result).toBe(MOCK_CONTINUE_WATCHING);
    });

    it('passes parsed limit from query string', async () => {
      await controller.getContinueWatching('5');
      expect(service.getContinueWatching).toHaveBeenCalledWith(5);
    });

    it('clamps limit to minimum of 1', async () => {
      await controller.getContinueWatching('0');
      expect(service.getContinueWatching).toHaveBeenCalledWith(1);
    });

    it('clamps limit to maximum of 50', async () => {
      await controller.getContinueWatching('999');
      expect(service.getContinueWatching).toHaveBeenCalledWith(50);
    });

    it('falls back to 10 for non-numeric limit', async () => {
      await controller.getContinueWatching('abc');
      expect(service.getContinueWatching).toHaveBeenCalledWith(10);
    });
  });

  // ─── getRecentActivity ───────────────────────────────────────────────────

  describe('getRecentActivity()', () => {
    it('calls service with default limit 10', async () => {
      const result = await controller.getRecentActivity(undefined);
      expect(service.getRecentActivity).toHaveBeenCalledWith(10);
      expect(result).toBe(MOCK_RECENT_ACTIVITY);
    });

    it('passes parsed limit from query string', async () => {
      await controller.getRecentActivity('20');
      expect(service.getRecentActivity).toHaveBeenCalledWith(20);
    });

    it('clamps limit to 50', async () => {
      await controller.getRecentActivity('100');
      expect(service.getRecentActivity).toHaveBeenCalledWith(50);
    });
  });

  // ─── getQuickPicks ───────────────────────────────────────────────────────

  describe('getQuickPicks()', () => {
    it('calls service with default limit 10', async () => {
      const result = await controller.getQuickPicks(undefined);
      expect(service.getQuickPicks).toHaveBeenCalledWith(10);
      expect(result).toBe(MOCK_QUICK_PICKS);
    });

    it('passes parsed limit from query string', async () => {
      await controller.getQuickPicks('6');
      expect(service.getQuickPicks).toHaveBeenCalledWith(6);
    });
  });
});
