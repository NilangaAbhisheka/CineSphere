import { DiscoverController } from './discover.controller.js';
import { TmdbService } from './tmdb.service.js';
import { TmdbMovieSearchQueryDto, TmdbTvSearchQueryDto } from './dto/discover-tmdb.dto.js';

describe('DiscoverController', () => {
  let controller: DiscoverController;
  let tmdbService: jest.Mocked<TmdbService>;

  beforeEach(() => {
    tmdbService = {
      searchMovies: jest.fn(),
      searchTvShows: jest.fn(),
      getTrendingMovies: jest.fn(),
      getTrendingTvShows: jest.fn(),
      getPopularMovies: jest.fn(),
      getPopularTvShows: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    controller = new DiscoverController(tmdbService);
  });

  describe('searchMovies', () => {
    it('delegates movie search query to tmdbService', async () => {
      const mockResult = {
        page: 1,
        totalPages: 2,
        totalResults: 25,
        results: [{ id: 550, title: 'Fight Club' }],
      };
      tmdbService.searchMovies.mockResolvedValueOnce(mockResult);

      const dto: TmdbMovieSearchQueryDto = {
        query: 'Fight Club',
        page: 1,
        includeAdult: false,
        year: 1999,
        primaryReleaseYear: 1999,
      };

      const result = await controller.searchMovies(dto);

      expect(tmdbService.searchMovies).toHaveBeenCalledWith('Fight Club', 1, false, 1999, 1999);
      expect(result).toBe(mockResult);
    });
  });

  describe('searchTvShows', () => {
    it('delegates TV search query to tmdbService', async () => {
      const mockResult = {
        page: 1,
        totalPages: 1,
        totalResults: 10,
        results: [{ id: 1399, name: 'Game of Thrones' }],
      };
      tmdbService.searchTvShows.mockResolvedValueOnce(mockResult);

      const dto: TmdbTvSearchQueryDto = {
        query: 'Game of Thrones',
        page: 1,
        includeAdult: false,
        firstAirDateYear: 2011,
      };

      const result = await controller.searchTvShows(dto);

      expect(tmdbService.searchTvShows).toHaveBeenCalledWith('Game of Thrones', 1, false, 2011);
      expect(result).toBe(mockResult);
    });
  });

  describe('trending and popular endpoints', () => {
    it('delegates getTrendingMovies to tmdbService', async () => {
      const mockResult = { page: 1, totalPages: 1, totalResults: 5, results: [] };
      tmdbService.getTrendingMovies.mockResolvedValueOnce(mockResult);

      const result = await controller.getTrendingMovies({ page: 1 });
      expect(tmdbService.getTrendingMovies).toHaveBeenCalledWith('day', 1);
      expect(result).toBe(mockResult);
    });

    it('delegates getTrendingTvShows to tmdbService', async () => {
      const mockResult = { page: 1, totalPages: 1, totalResults: 5, results: [] };
      tmdbService.getTrendingTvShows.mockResolvedValueOnce(mockResult);

      const result = await controller.getTrendingTvShows({ page: 2 });
      expect(tmdbService.getTrendingTvShows).toHaveBeenCalledWith('day', 2);
      expect(result).toBe(mockResult);
    });

    it('delegates getPopularMovies to tmdbService', async () => {
      const mockResult = { page: 1, totalPages: 1, totalResults: 5, results: [] };
      tmdbService.getPopularMovies.mockResolvedValueOnce(mockResult);

      const result = await controller.getPopularMovies({ page: 1 });
      expect(tmdbService.getPopularMovies).toHaveBeenCalledWith(1);
      expect(result).toBe(mockResult);
    });

    it('delegates getPopularTvShows to tmdbService', async () => {
      const mockResult = { page: 1, totalPages: 1, totalResults: 5, results: [] };
      tmdbService.getPopularTvShows.mockResolvedValueOnce(mockResult);

      const result = await controller.getPopularTvShows({ page: 1 });
      expect(tmdbService.getPopularTvShows).toHaveBeenCalledWith(1);
      expect(result).toBe(mockResult);
    });
  });
});
