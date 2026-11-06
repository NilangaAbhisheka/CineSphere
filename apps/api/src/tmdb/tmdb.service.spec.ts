import { NotFoundException } from '@nestjs/common';
import { TmdbService } from './tmdb.service.js';
import { TmdbHttpClient } from './tmdb-http.client.js';
import { CatalogueRepository } from './catalogue.repository.js';
import {
  TmdbMovieDetailsResponse,
  TmdbSeasonDetailsResponse,
  TmdbTvShowDetailsResponse,
} from './tmdb.types.js';

describe('TmdbService', () => {
  let service: TmdbService;
  let httpClient: jest.Mocked<TmdbHttpClient>;
  let catalogueRepo: jest.Mocked<CatalogueRepository>;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
    } as unknown as jest.Mocked<TmdbHttpClient>;

    catalogueRepo = {
      saveMovie: jest.fn(),
      saveTvShowHeader: jest.fn(),
      saveSeasonAndEpisodes: jest.fn(),
    } as unknown as jest.Mocked<CatalogueRepository>;

    service = new TmdbService(httpClient, catalogueRepo);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('ingestMovie', () => {
    it('fetches, maps, and persists a movie successfully', async () => {
      const mockMovieResponse: TmdbMovieDetailsResponse = {
        id: 550,
        title: 'Fight Club',
        genres: [{ id: 18, name: 'Drama' }],
        keywords: { id: 550, keywords: [{ id: 825, name: 'support group' }] },
        credits: { id: 550, cast: [{ id: 819, name: 'Edward Norton' }] },
      };

      httpClient.get.mockResolvedValueOnce(mockMovieResponse);
      const mockDate = new Date();
      catalogueRepo.saveMovie.mockResolvedValueOnce({
        id: 'mock-movie-uuid',
        syncedAt: mockDate,
      });

      const result = await service.ingestMovie(550);

      expect(httpClient.get).toHaveBeenCalledWith('/movie/550', {
        append_to_response: 'credits,keywords',
      });
      expect(catalogueRepo.saveMovie).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: 'mock-movie-uuid',
        tmdbId: 550,
        title: 'Fight Club',
        genresCount: 1,
        keywordsCount: 1,
        castCount: 1,
        syncedAt: mockDate,
      });
    });

    it('throws NotFoundException when TMDB returns 404', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('Resource not found on TMDB (HTTP 404)'));

      await expect(service.ingestMovie(9999999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('ingestTvShow', () => {
    it('fetches, maps, and persists a TV show and seasons', async () => {
      const mockTvResponse: TmdbTvShowDetailsResponse = {
        id: 1399,
        name: 'Game of Thrones',
        seasons: [{ id: 3624, season_number: 1 }],
        genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }],
      };

      const mockSeasonResponse: TmdbSeasonDetailsResponse = {
        id: 3624,
        season_number: 1,
        name: 'Season 1',
        episodes: [
          { id: 63056, episode_number: 1, name: 'Winter Is Coming' },
          { id: 63057, episode_number: 2, name: 'The Kingsroad' },
        ],
      };

      httpClient.get
        .mockResolvedValueOnce(mockTvResponse)
        .mockResolvedValueOnce(mockSeasonResponse);

      const mockDate = new Date();
      catalogueRepo.saveTvShowHeader.mockResolvedValueOnce({
        id: 'mock-tv-uuid',
        syncedAt: mockDate,
      });
      catalogueRepo.saveSeasonAndEpisodes.mockResolvedValueOnce({
        seasonId: 'mock-season-uuid',
        episodeCount: 2,
      });

      const result = await service.ingestTvShow(1399);

      expect(httpClient.get).toHaveBeenCalledWith('/tv/1399', {
        append_to_response: 'aggregate_credits,credits,keywords',
      });
      expect(httpClient.get).toHaveBeenCalledWith('/tv/1399/season/1');
      expect(catalogueRepo.saveTvShowHeader).toHaveBeenCalledTimes(1);
      expect(catalogueRepo.saveSeasonAndEpisodes).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: 'mock-tv-uuid',
        tmdbId: 1399,
        name: 'Game of Thrones',
        seasonsCount: 1,
        episodesCount: 2,
        genresCount: 1,
        keywordsCount: 0,
        castCount: 0,
        syncedAt: mockDate,
      });
    });
  });
});
