import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogueService } from './catalogue.service.js';
import { CatalogueRepository } from '../tmdb/catalogue.repository.js';

describe('CatalogueService', () => {
  let service: CatalogueService;
  let catalogueRepo: jest.Mocked<CatalogueRepository>;

  beforeEach(() => {
    catalogueRepo = {
      findMovies: jest.fn(),
      findMovieById: jest.fn(),
      findTvShows: jest.fn(),
      findTvShowById: jest.fn(),
      findGenres: jest.fn(),
    } as unknown as jest.Mocked<CatalogueRepository>;

    service = new CatalogueService(catalogueRepo);
  });

  describe('listMovies', () => {
    it('throws BadRequestException if minRating > maxRating', async () => {
      await expect(
        service.listMovies({
          minRating: 8.5,
          maxRating: 6.0,
          page: 1,
          limit: 20,
          sortBy: 'popularity',
          sortOrder: 'desc',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns formatted movie list and pagination metadata', async () => {
      const mockDate = new Date('2010-07-16T00:00:00.000Z');
      catalogueRepo.findMovies.mockResolvedValueOnce({
        items: [
          {
            id: 'uuid-1',
            tmdbId: 27205,
            title: 'Inception',
            originalTitle: 'Inception',
            overview: 'Dream within a dream',
            releaseDate: mockDate,
            runtime: 148,
            originalLanguage: 'en',
            popularity: 90.0,
            voteAverage: 8.4,
            voteCount: 30000,
            posterPath: '/path.jpg',
            backdropPath: '/bg.jpg',
            genres: [{ tmdbId: 28, name: 'Action' }],
          },
        ],
        totalResults: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const result = await service.listMovies({
        query: 'Inception',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      expect(result.totalResults).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items[0]).toEqual({
        id: 'uuid-1',
        tmdbId: 27205,
        title: 'Inception',
        originalTitle: 'Inception',
        overview: 'Dream within a dream',
        releaseDate: '2010-07-16',
        runtime: 148,
        originalLanguage: 'en',
        popularity: 90.0,
        voteAverage: 8.4,
        voteCount: 30000,
        posterPath: '/path.jpg',
        backdropPath: '/bg.jpg',
        genres: [{ id: 28, name: 'Action' }],
      });
    });
  });

  describe('getMovieById', () => {
    it('returns complete movie details with genres, keywords, and cast', async () => {
      const now = new Date();
      catalogueRepo.findMovieById.mockResolvedValueOnce({
        id: 'uuid-movie-1',
        tmdbId: 550,
        title: 'Fight Club',
        originalTitle: 'Fight Club',
        overview: 'Soap club',
        releaseDate: new Date('1999-10-15T00:00:00.000Z'),
        runtime: 139,
        originalLanguage: 'en',
        popularity: 65.0,
        voteAverage: 8.4,
        voteCount: 25000,
        posterPath: '/fc.jpg',
        backdropPath: '/fc-bg.jpg',
        adult: false,
        createdAt: now,
        updatedAt: now,
        syncedAt: now,
        genres: [{ tmdbId: 18, name: 'Drama' }],
        keywords: [{ tmdbId: 825, name: 'support group' }],
        personCredits: [
          {
            id: 'credit-1',
            person: {
              id: 'person-1',
              tmdbId: 819,
              name: 'Edward Norton',
            },
          },
        ],
      } as unknown as Awaited<ReturnType<CatalogueRepository['findMovieById']>>);

      const result = await service.getMovieById('uuid-movie-1');

      expect(result.id).toBe('uuid-movie-1');
      expect(result.title).toBe('Fight Club');
      expect(result.releaseDate).toBe('1999-10-15');
      expect(result.genres).toEqual([{ id: 18, name: 'Drama' }]);
      expect(result.keywords).toEqual([{ id: 825, name: 'support group' }]);
      expect(result.cast).toEqual([
        {
          id: 'credit-1',
          personId: 'person-1',
          tmdbId: 819,
          name: 'Edward Norton',
        },
      ]);
    });

    it('throws NotFoundException when movie does not exist', async () => {
      catalogueRepo.findMovieById.mockResolvedValueOnce(null);

      await expect(service.getMovieById('non-existent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listTvShows', () => {
    it('throws BadRequestException if minRating > maxRating', async () => {
      await expect(
        service.listTvShows({
          minRating: 9.0,
          maxRating: 7.0,
          page: 1,
          limit: 20,
          sortBy: 'popularity',
          sortOrder: 'desc',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns formatted TV show list and pagination metadata', async () => {
      const mockDate = new Date('2008-01-20T00:00:00.000Z');
      catalogueRepo.findTvShows.mockResolvedValueOnce({
        items: [
          {
            id: 'uuid-tv-1',
            tmdbId: 1396,
            name: 'Breaking Bad',
            originalName: 'Breaking Bad',
            overview: 'Chemistry teacher turns kingpin',
            firstAirDate: mockDate,
            lastAirDate: mockDate,
            originalLanguage: 'en',
            popularity: 110.0,
            voteAverage: 9.5,
            voteCount: 15000,
            posterPath: '/bb.jpg',
            backdropPath: '/bb-bg.jpg',
            status: 'Ended',
            numberOfSeasons: 5,
            numberOfEpisodes: 62,
            genres: [{ tmdbId: 18, name: 'Drama' }],
          },
        ],
        totalResults: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const result = await service.listTvShows({
        query: 'Breaking Bad',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      expect(result.totalResults).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items[0]).toEqual({
        id: 'uuid-tv-1',
        tmdbId: 1396,
        name: 'Breaking Bad',
        originalName: 'Breaking Bad',
        overview: 'Chemistry teacher turns kingpin',
        firstAirDate: '2008-01-20',
        lastAirDate: '2008-01-20',
        originalLanguage: 'en',
        popularity: 110.0,
        voteAverage: 9.5,
        voteCount: 15000,
        posterPath: '/bb.jpg',
        backdropPath: '/bb-bg.jpg',
        status: 'Ended',
        numberOfSeasons: 5,
        numberOfEpisodes: 62,
        genres: [{ id: 18, name: 'Drama' }],
      });
    });
  });

  describe('getTvShowById', () => {
    it('returns complete TV show details with genres, keywords, cast, and ordered seasons/episodes', async () => {
      const now = new Date();
      catalogueRepo.findTvShowById.mockResolvedValueOnce({
        id: 'uuid-tv-1',
        tmdbId: 1396,
        name: 'Breaking Bad',
        originalName: 'Breaking Bad',
        overview: 'Teacher turns kingpin',
        firstAirDate: new Date('2008-01-20T00:00:00.000Z'),
        lastAirDate: new Date('2013-09-29T00:00:00.000Z'),
        originalLanguage: 'en',
        popularity: 110.0,
        voteAverage: 9.5,
        voteCount: 15000,
        posterPath: '/bb.jpg',
        backdropPath: '/bb-bg.jpg',
        status: 'Ended',
        numberOfSeasons: 5,
        numberOfEpisodes: 62,
        createdAt: now,
        updatedAt: now,
        syncedAt: now,
        genres: [{ tmdbId: 18, name: 'Drama' }],
        keywords: [{ tmdbId: 588, name: 'methamphetamine' }],
        personCredits: [
          {
            id: 'credit-tv-1',
            person: {
              id: 'person-tv-1',
              tmdbId: 17419,
              name: 'Bryan Cranston',
            },
          },
        ],
        seasons: [
          {
            id: 'season-0',
            tmdbId: 9999,
            seasonNumber: 0,
            name: 'Specials',
            overview: null,
            posterPath: null,
            airDate: null,
            episodes: [],
          },
          {
            id: 'season-1',
            tmdbId: 3572,
            seasonNumber: 1,
            name: 'Season 1',
            overview: 'Season 1 overview',
            posterPath: '/s1.jpg',
            airDate: new Date('2008-01-20T00:00:00.000Z'),
            episodes: [
              {
                id: 'ep-1',
                tmdbId: 62085,
                episodeNumber: 1,
                name: 'Pilot',
                overview: 'Pilot episode',
                airDate: new Date('2008-01-20T00:00:00.000Z'),
                runtime: 58,
              },
            ],
          },
        ],
      } as unknown as Awaited<ReturnType<CatalogueRepository['findTvShowById']>>);

      const result = await service.getTvShowById('uuid-tv-1');

      expect(result.id).toBe('uuid-tv-1');
      expect(result.name).toBe('Breaking Bad');
      expect(result.seasons).toHaveLength(2);
      expect(result.seasons[0].seasonNumber).toBe(0);
      expect(result.seasons[1].seasonNumber).toBe(1);
      expect(result.seasons[1].episodes[0].name).toBe('Pilot');
      expect(result.cast[0].name).toBe('Bryan Cranston');
    });

    it('throws NotFoundException when TV show does not exist', async () => {
      catalogueRepo.findTvShowById.mockResolvedValueOnce(null);

      await expect(service.getTvShowById('non-existent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listGenres', () => {
    it('returns mapped genres from repository', async () => {
      catalogueRepo.findGenres.mockResolvedValueOnce([
        { tmdbId: 28, name: 'Action' },
        { tmdbId: 35, name: 'Comedy' },
      ]);

      const result = await service.listGenres();

      expect(result).toEqual([
        { id: 28, name: 'Action' },
        { id: 35, name: 'Comedy' },
      ]);
    });
  });
});
