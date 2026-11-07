import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CatalogueRepository } from '../tmdb/catalogue.repository.js';
import { CatalogueService } from './catalogue.service.js';

describe('Catalogue Discovery Integration Tests', () => {
  let prisma: PrismaService;
  let catalogueRepo: CatalogueRepository;
  let catalogueService: CatalogueService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalogueRepo = new CatalogueRepository(prisma);
    catalogueService = new CatalogueService(catalogueRepo);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let counter = 700_000_000 + Math.floor(Math.random() * 50_000_000);
  function nextTmdbId(): number {
    return ++counter;
  }

  describe('Local Movie Discovery & Filtering', () => {
    let genreActionId: number;
    let genreComedyId: number;
    let movie1Id: string;
    let movie2Id: string;
    let movie3Id: string;

    beforeAll(async () => {
      genreActionId = nextTmdbId();
      genreComedyId = nextTmdbId();

      await prisma.genre.createMany({
        data: [
          { tmdbId: genreActionId, name: `Action-${genreActionId}` },
          { tmdbId: genreComedyId, name: `Comedy-${genreComedyId}` },
        ],
      });

      // Movie 1: Inception Alpha (2010, rating 8.8, en, popularity 95, Action)
      const m1 = await prisma.movie.create({
        data: {
          tmdbId: nextTmdbId(),
          title: 'Inception Alpha',
          originalTitle: 'Inception Alpha',
          overview: 'Mind bending heist',
          releaseDate: new Date('2010-07-16T00:00:00.000Z'),
          runtime: 148,
          originalLanguage: 'en',
          popularity: 95.0,
          voteAverage: 8.8,
          voteCount: 15000,
          genres: { connect: [{ tmdbId: genreActionId }] },
        },
      });
      movie1Id = m1.id;

      // Movie 2: Inception Beta (2015, rating 6.5, fr, popularity 40, Comedy)
      const m2 = await prisma.movie.create({
        data: {
          tmdbId: nextTmdbId(),
          title: 'Inception Beta',
          originalTitle: 'Inception Beta',
          overview: 'French comedy dream',
          releaseDate: new Date('2015-04-01T00:00:00.000Z'),
          runtime: 95,
          originalLanguage: 'fr',
          popularity: 40.0,
          voteAverage: 6.5,
          voteCount: 800,
          genres: { connect: [{ tmdbId: genreComedyId }] },
        },
      });
      movie2Id = m2.id;

      // Movie 3: Interstellar Gamma (2014, rating 8.6, en, popularity 85, Action)
      const m3 = await prisma.movie.create({
        data: {
          tmdbId: nextTmdbId(),
          title: 'Interstellar Gamma',
          originalTitle: 'Interstellar Gamma',
          overview: 'Space exploration',
          releaseDate: new Date('2014-11-07T00:00:00.000Z'),
          runtime: 169,
          originalLanguage: 'en',
          popularity: 85.0,
          voteAverage: 8.6,
          voteCount: 12000,
          genres: { connect: [{ tmdbId: genreActionId }] },
        },
      });
      movie3Id = m3.id;
    });

    it('searches movies by title with case-insensitive substring match', async () => {
      const result = await catalogueService.listMovies({
        query: 'inception',
        page: 1,
        limit: 20,
        sortBy: 'title',
        sortOrder: 'asc',
      });

      const foundIds = result.items.map((m) => m.id);
      expect(foundIds).toContain(movie1Id);
      expect(foundIds).toContain(movie2Id);
      expect(foundIds).not.toContain(movie3Id);
    });

    it('filters movies by genreId', async () => {
      const result = await catalogueService.listMovies({
        genreId: genreActionId,
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((m) => m.id);
      expect(foundIds).toContain(movie1Id);
      expect(foundIds).toContain(movie3Id);
      expect(foundIds).not.toContain(movie2Id);
    });

    it('filters movies by release year', async () => {
      const result = await catalogueService.listMovies({
        year: 2010,
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((m) => m.id);
      expect(foundIds).toContain(movie1Id);
      expect(foundIds).not.toContain(movie2Id);
      expect(foundIds).not.toContain(movie3Id);
    });

    it('filters movies by rating range', async () => {
      const result = await catalogueService.listMovies({
        minRating: 8.0,
        maxRating: 9.0,
        page: 1,
        limit: 20,
        sortBy: 'rating',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((m) => m.id);
      expect(foundIds).toContain(movie1Id);
      expect(foundIds).toContain(movie3Id);
      expect(foundIds).not.toContain(movie2Id);
    });

    it('throws BadRequestException if minRating > maxRating', async () => {
      await expect(
        catalogueService.listMovies({
          minRating: 9.0,
          maxRating: 6.0,
          page: 1,
          limit: 20,
          sortBy: 'popularity',
          sortOrder: 'desc',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('filters movies by original language', async () => {
      const result = await catalogueService.listMovies({
        language: 'fr',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((m) => m.id);
      expect(foundIds).toContain(movie2Id);
      expect(foundIds).not.toContain(movie1Id);
      expect(foundIds).not.toContain(movie3Id);
    });

    it('sorts movies ascending and descending with stable pagination', async () => {
      const descResult = await catalogueService.listMovies({
        query: 'Inception',
        sortBy: 'popularity',
        sortOrder: 'desc',
        page: 1,
        limit: 10,
      });

      expect(descResult.items.findIndex((m) => m.id === movie1Id)).toBeLessThan(
        descResult.items.findIndex((m) => m.id === movie2Id),
      );

      const ascResult = await catalogueService.listMovies({
        query: 'Inception',
        sortBy: 'popularity',
        sortOrder: 'asc',
        page: 1,
        limit: 10,
      });

      expect(ascResult.items.findIndex((m) => m.id === movie2Id)).toBeLessThan(
        ascResult.items.findIndex((m) => m.id === movie1Id),
      );
    });

    it('returns empty results when no items match query', async () => {
      const result = await catalogueService.listMovies({
        query: 'NonExistentTitleX99Z123',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      expect(result.items).toHaveLength(0);
      expect(result.totalResults).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('Local TV Discovery & Filtering', () => {
    let genreDramaId: number;
    let show1Id: string;
    let show2Id: string;

    beforeAll(async () => {
      genreDramaId = nextTmdbId();
      await prisma.genre.create({
        data: { tmdbId: genreDramaId, name: `Drama-${genreDramaId}` },
      });

      // Show 1: Breaking Cosmos (2008, rating 9.4, en, status Ended, Drama)
      const s1 = await prisma.tvShow.create({
        data: {
          tmdbId: nextTmdbId(),
          name: 'Breaking Cosmos',
          originalName: 'Breaking Cosmos',
          overview: 'Meth and chemistry',
          firstAirDate: new Date('2008-01-20T00:00:00.000Z'),
          lastAirDate: new Date('2013-09-29T00:00:00.000Z'),
          originalLanguage: 'en',
          popularity: 120.0,
          voteAverage: 9.4,
          voteCount: 18000,
          status: 'Ended',
          numberOfSeasons: 5,
          numberOfEpisodes: 62,
          genres: { connect: [{ tmdbId: genreDramaId }] },
        },
      });
      show1Id = s1.id;

      // Show 2: Better Call Cosmos (2015, rating 8.9, en, status Returning Series, Drama)
      const s2 = await prisma.tvShow.create({
        data: {
          tmdbId: nextTmdbId(),
          name: 'Better Call Cosmos',
          originalName: 'Better Call Cosmos',
          overview: 'Lawyer prequel',
          firstAirDate: new Date('2015-02-08T00:00:00.000Z'),
          lastAirDate: new Date('2022-08-15T00:00:00.000Z'),
          originalLanguage: 'en',
          popularity: 90.0,
          voteAverage: 8.9,
          voteCount: 9000,
          status: 'Returning Series',
          numberOfSeasons: 6,
          numberOfEpisodes: 63,
          genres: { connect: [{ tmdbId: genreDramaId }] },
        },
      });
      show2Id = s2.id;
    });

    it('searches TV shows by name with case-insensitive substring match', async () => {
      const result = await catalogueService.listTvShows({
        query: 'breaking',
        page: 1,
        limit: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      const foundIds = result.items.map((s) => s.id);
      expect(foundIds).toContain(show1Id);
      expect(foundIds).not.toContain(show2Id);
    });

    it('filters TV shows by firstAirDateYear', async () => {
      const result = await catalogueService.listTvShows({
        firstAirDateYear: 2008,
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((s) => s.id);
      expect(foundIds).toContain(show1Id);
      expect(foundIds).not.toContain(show2Id);
    });

    it('filters TV shows by status', async () => {
      const result = await catalogueService.listTvShows({
        status: 'Ended',
        query: 'Cosmos',
        page: 1,
        limit: 20,
        sortBy: 'popularity',
        sortOrder: 'desc',
      });

      const foundIds = result.items.map((s) => s.id);
      expect(foundIds).toContain(show1Id);
      expect(foundIds).not.toContain(show2Id);
    });
  });

  describe('Movie Details Retrieval', () => {
    it('retrieves detailed movie metadata including genres, keywords, and cast credits', async () => {
      const tmdbId = nextTmdbId();
      const genreId = nextTmdbId();
      const kwId = nextTmdbId();
      const personTmdbId = nextTmdbId();

      await prisma.genre.create({ data: { tmdbId: genreId, name: `Genre-${genreId}` } });
      await prisma.keyword.create({ data: { tmdbId: kwId, name: `Kw-${kwId}` } });
      const person = await prisma.person.create({
        data: { tmdbId: personTmdbId, name: 'Lead Actor' },
      });

      const movie = await prisma.movie.create({
        data: {
          tmdbId,
          title: `Detailed Movie ${tmdbId}`,
          overview: 'Deep details',
          releaseDate: new Date('2021-06-15T00:00:00.000Z'),
          genres: { connect: [{ tmdbId: genreId }] },
          keywords: { connect: [{ tmdbId: kwId }] },
          personCredits: {
            create: {
              personId: person.id,
            },
          },
        },
      });

      const details = await catalogueService.getMovieById(movie.id);

      expect(details.id).toBe(movie.id);
      expect(details.title).toBe(`Detailed Movie ${tmdbId}`);
      expect(details.releaseDate).toBe('2021-06-15');
      expect(details.genres).toEqual([{ id: genreId, name: `Genre-${genreId}` }]);
      expect(details.keywords).toEqual([{ id: kwId, name: `Kw-${kwId}` }]);
      expect(details.cast).toHaveLength(1);
      expect(details.cast[0].personId).toBe(person.id);
      expect(details.cast[0].name).toBe('Lead Actor');
    });

    it('throws NotFoundException for unknown movie UUID', async () => {
      await expect(
        catalogueService.getMovieById('a0000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('TV Show Details Retrieval with Hierarchical Seasons', () => {
    it('retrieves detailed TV metadata with seasons and episodes ordered by season and episode numbers', async () => {
      const tmdbId = nextTmdbId();
      const personTmdbId = nextTmdbId();

      const person = await prisma.person.create({
        data: { tmdbId: personTmdbId, name: 'TV Star' },
      });

      const show = await prisma.tvShow.create({
        data: {
          tmdbId,
          name: `TV Hierarchy ${tmdbId}`,
          personCredits: {
            create: {
              personId: person.id,
            },
          },
        },
      });

      // Season 0 (specials)
      const s0 = await prisma.season.create({
        data: {
          tvShowId: show.id,
          seasonNumber: 0,
          name: 'Specials',
          tmdbId: nextTmdbId(),
        },
      });

      await prisma.episode.create({
        data: {
          seasonId: s0.id,
          episodeNumber: 1,
          name: 'Special Episode 1',
          tmdbId: nextTmdbId(),
        },
      });

      // Season 1
      const s1 = await prisma.season.create({
        data: {
          tvShowId: show.id,
          seasonNumber: 1,
          name: 'Season 1',
          tmdbId: nextTmdbId(),
        },
      });

      await prisma.episode.createMany({
        data: [
          {
            seasonId: s1.id,
            episodeNumber: 2,
            name: 'Episode Two',
            tmdbId: nextTmdbId(),
          },
          {
            seasonId: s1.id,
            episodeNumber: 1,
            name: 'Episode One',
            tmdbId: nextTmdbId(),
          },
        ],
      });

      const details = await catalogueService.getTvShowById(show.id);

      expect(details.id).toBe(show.id);
      expect(details.name).toBe(`TV Hierarchy ${tmdbId}`);
      expect(details.seasons).toHaveLength(2);
      expect(details.seasons[0].seasonNumber).toBe(0);
      expect(details.seasons[1].seasonNumber).toBe(1);
      // Verify episodes within season 1 are ordered ascending (1, 2)
      expect(details.seasons[1].episodes[0].episodeNumber).toBe(1);
      expect(details.seasons[1].episodes[0].name).toBe('Episode One');
      expect(details.seasons[1].episodes[1].episodeNumber).toBe(2);
      expect(details.seasons[1].episodes[1].name).toBe('Episode Two');
    });

    it('throws NotFoundException for unknown TV show UUID', async () => {
      await expect(
        catalogueService.getTvShowById('b0000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
