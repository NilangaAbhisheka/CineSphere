import { MovieDetails, TvShowDetails } from '@cinesphere/shared';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { ListMoviesQueryDto } from './dto/list-movies-query.dto.js';
import { ListTvShowsQueryDto } from './dto/list-tv-shows-query.dto.js';

describe('CatalogueController', () => {
  let controller: CatalogueController;
  let catalogueService: jest.Mocked<CatalogueService>;

  beforeEach(() => {
    catalogueService = {
      listMovies: jest.fn(),
      getMovieById: jest.fn(),
      listTvShows: jest.fn(),
      getTvShowById: jest.fn(),
    } as unknown as jest.Mocked<CatalogueService>;

    controller = new CatalogueController(catalogueService);
  });

  describe('listMovies', () => {
    it('delegates query to catalogueService.listMovies', async () => {
      const mockResult = {
        items: [],
        page: 1,
        limit: 20,
        totalResults: 0,
        totalPages: 0,
      };
      catalogueService.listMovies.mockResolvedValueOnce(mockResult);

      const queryDto: ListMoviesQueryDto = {
        query: 'Inception',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      };

      const result = await controller.listMovies(queryDto);

      expect(catalogueService.listMovies).toHaveBeenCalledWith(queryDto);
      expect(result).toBe(mockResult);
    });
  });

  describe('getMovieById', () => {
    it('delegates id to catalogueService.getMovieById', async () => {
      const mockResult = { id: 'uuid-1', title: 'Inception' } as unknown as MovieDetails;
      catalogueService.getMovieById.mockResolvedValueOnce(mockResult);

      const result = await controller.getMovieById('uuid-1');

      expect(catalogueService.getMovieById).toHaveBeenCalledWith('uuid-1');
      expect(result).toBe(mockResult);
    });
  });

  describe('listTvShows', () => {
    it('delegates query to catalogueService.listTvShows', async () => {
      const mockResult = {
        items: [],
        page: 1,
        limit: 20,
        totalResults: 0,
        totalPages: 0,
      };
      catalogueService.listTvShows.mockResolvedValueOnce(mockResult);

      const queryDto: ListTvShowsQueryDto = {
        query: 'Breaking Bad',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      };

      const result = await controller.listTvShows(queryDto);

      expect(catalogueService.listTvShows).toHaveBeenCalledWith(queryDto);
      expect(result).toBe(mockResult);
    });
  });

  describe('getTvShowById', () => {
    it('delegates id to catalogueService.getTvShowById', async () => {
      const mockResult = { id: 'uuid-tv-1', name: 'Breaking Bad' } as unknown as TvShowDetails;
      catalogueService.getTvShowById.mockResolvedValueOnce(mockResult);

      const result = await controller.getTvShowById('uuid-tv-1');

      expect(catalogueService.getTvShowById).toHaveBeenCalledWith('uuid-tv-1');
      expect(result).toBe(mockResult);
    });
  });
});
