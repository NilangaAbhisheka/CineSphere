import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';
import {
  ActivityTimelineData,
  GenreStatItem,
  RatingStatsData,
  StatsOverviewSummary,
} from '@cinesphere/shared';
import { ActivityQueryDto } from './dto/activity-query.dto.js';

describe('StatsController', () => {
  let controller: StatsController;
  let service: jest.Mocked<
    Pick<StatsService, 'getOverview' | 'getGenres' | 'getActivity' | 'getRatings'>
  >;

  const mockOverview: StatsOverviewSummary = {
    moviesCompleted: 14,
    movieViewingEvents: 19,
    episodesWatched: 182,
    tvShowsCompleted: 6,
    averagePersonalRating: 8.2,
  };

  const mockGenres: GenreStatItem[] = [
    { genreId: 878, name: 'Science Fiction', completedTitleCount: 12, percentage: 60 },
  ];

  const mockActivity: ActivityTimelineData = {
    from: '2026-05',
    to: '2026-10',
    items: [
      {
        period: '2026-05',
        label: 'May 2026',
        movieViewings: 3,
        episodesWatched: 24,
        totalActivity: 27,
      },
    ],
  };

  const mockRatings: RatingStatsData = {
    buckets: [{ rating: 8.5, count: 4 }],
    unratedLibraryEntries: 5,
    totalRated: 4,
  };

  beforeEach(() => {
    service = {
      getOverview: jest.fn().mockResolvedValue(mockOverview),
      getGenres: jest.fn().mockResolvedValue(mockGenres),
      getActivity: jest.fn().mockResolvedValue(mockActivity),
      getRatings: jest.fn().mockResolvedValue(mockRatings),
    };

    controller = new StatsController(service as unknown as StatsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getOverview', () => {
    it('should delegate to statsService.getOverview and return overview summary', async () => {
      const result = await controller.getOverview();
      expect(service.getOverview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockOverview);
    });
  });

  describe('getGenres', () => {
    it('should delegate to statsService.getGenres and return genre distribution', async () => {
      const result = await controller.getGenres();
      expect(service.getGenres).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockGenres);
    });
  });

  describe('getActivity', () => {
    it('should delegate to statsService.getActivity with query params', async () => {
      const query: ActivityQueryDto = { from: '2026-05', to: '2026-10' };
      const result = await controller.getActivity(query);
      expect(service.getActivity).toHaveBeenCalledTimes(1);
      expect(service.getActivity).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockActivity);
    });
  });

  describe('getRatings', () => {
    it('should delegate to statsService.getRatings and return rating distribution', async () => {
      const result = await controller.getRatings();
      expect(service.getRatings).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRatings);
    });
  });
});
