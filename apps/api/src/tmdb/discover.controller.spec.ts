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
});
