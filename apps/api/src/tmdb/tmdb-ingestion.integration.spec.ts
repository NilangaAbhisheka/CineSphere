import { CatalogueRepository } from './catalogue.repository.js';
import { PrismaService } from '../database/prisma.service.js';
import { MappedMovieData, MappedSeasonData, MappedTvShowData } from './tmdb.mapper.js';

describe('TMDB Ingestion Integration Tests', () => {
  let prisma: PrismaService;
  let catalogueRepo: CatalogueRepository;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalogueRepo = new CatalogueRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let counter = 800_000_000 + Math.floor(Math.random() * 50_000_000);
  function nextTmdbId(): number {
    return ++counter;
  }

  describe('Movie Ingestion & Idempotency', () => {
    it('persists a movie with genres, keywords, and cast credits', async () => {
      const tmdbId = nextTmdbId();
      const genreId = nextTmdbId();
      const kwId = nextTmdbId();
      const personId = nextTmdbId();

      const movieData: MappedMovieData = {
        tmdbId,
        title: `Ingestion Movie ${tmdbId}`,
        originalTitle: 'Original Title',
        overview: 'Overview test',
        releaseDate: new Date('2020-01-01'),
        runtime: 120,
        originalLanguage: 'en',
        popularity: 50.5,
        voteAverage: 8.0,
        voteCount: 1000,
        posterPath: '/path.jpg',
        backdropPath: '/back.jpg',
        adult: false,
        genres: [{ tmdbId: genreId, name: 'Sci-Fi' }],
        keywords: [{ tmdbId: kwId, name: 'time travel' }],
        cast: [{ tmdbId: personId, name: 'John Doe' }],
      };

      const result = await catalogueRepo.saveMovie(movieData);
      expect(result.id).toBeDefined();

      const saved = await prisma.movie.findUnique({
        where: { id: result.id },
        include: {
          genres: true,
          keywords: true,
          personCredits: { include: { person: true } },
        },
      });

      expect(saved?.tmdbId).toBe(tmdbId);
      expect(saved?.genres).toHaveLength(1);
      expect(saved?.genres[0].tmdbId).toBe(genreId);
      expect(saved?.keywords).toHaveLength(1);
      expect(saved?.keywords[0].tmdbId).toBe(kwId);
      expect(saved?.personCredits).toHaveLength(1);
      expect(saved?.personCredits[0].person.tmdbId).toBe(personId);
      expect(saved?.personCredits[0].movieId).toBe(result.id);
      expect(saved?.personCredits[0].tvShowId).toBeNull();
    });

    it('is fully idempotent and updates metadata on repeated ingestion', async () => {
      const tmdbId = nextTmdbId();
      const genre1 = nextTmdbId();
      const genre2 = nextTmdbId();
      const actor1 = nextTmdbId();
      const actor2 = nextTmdbId();

      const initialData: MappedMovieData = {
        tmdbId,
        title: 'Initial Title',
        originalTitle: null,
        overview: 'Initial overview',
        releaseDate: null,
        runtime: null,
        originalLanguage: 'en',
        popularity: 10.0,
        voteAverage: null,
        voteCount: null,
        posterPath: null,
        backdropPath: null,
        adult: false,
        genres: [{ tmdbId: genre1, name: 'Action' }],
        keywords: [],
        cast: [{ tmdbId: actor1, name: 'Actor One' }],
      };

      const firstResult = await catalogueRepo.saveMovie(initialData);

      const updatedData: MappedMovieData = {
        tmdbId,
        title: 'Updated Title',
        originalTitle: 'Updated Original',
        overview: 'Updated overview',
        releaseDate: new Date('2021-05-05'),
        runtime: 110,
        originalLanguage: 'fr',
        popularity: 25.0,
        voteAverage: 7.5,
        voteCount: 500,
        posterPath: '/new_poster.jpg',
        backdropPath: '/new_back.jpg',
        adult: false,
        genres: [
          { tmdbId: genre1, name: 'Action' },
          { tmdbId: genre2, name: 'Comedy' },
        ],
        keywords: [{ tmdbId: nextTmdbId(), name: 'sequel' }],
        cast: [{ tmdbId: actor2, name: 'Actor Two' }], // Replaced actor1 with actor2
      };

      const secondResult = await catalogueRepo.saveMovie(updatedData);

      // Verify UUID remains identical
      expect(secondResult.id).toBe(firstResult.id);

      const updated = await prisma.movie.findUnique({
        where: { id: firstResult.id },
        include: {
          genres: true,
          keywords: true,
          personCredits: { include: { person: true } },
        },
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.genres).toHaveLength(2);
      expect(updated?.keywords).toHaveLength(1);
      expect(updated?.personCredits).toHaveLength(1);
      expect(updated?.personCredits[0].person.tmdbId).toBe(actor2);
    });
  });

  describe('TV Show, Season, and Episode Ingestion', () => {
    it('persists a TV show header, seasons, and episodes idempotently', async () => {
      const showTmdbId = nextTmdbId();
      const seasonTmdbId = nextTmdbId();
      const ep1TmdbId = nextTmdbId();
      const ep2TmdbId = nextTmdbId();
      const genreId = nextTmdbId();
      const castId = nextTmdbId();

      const tvData: MappedTvShowData = {
        tmdbId: showTmdbId,
        name: `Ingestion TV Show ${showTmdbId}`,
        originalName: 'Original TV Show',
        overview: 'TV Overview',
        firstAirDate: new Date('2015-01-01'),
        lastAirDate: new Date('2020-01-01'),
        originalLanguage: 'en',
        popularity: 88.0,
        voteAverage: 8.5,
        voteCount: 4000,
        posterPath: '/tv_poster.jpg',
        backdropPath: '/tv_back.jpg',
        status: 'Ended',
        numberOfSeasons: 1,
        numberOfEpisodes: 2,
        genres: [{ tmdbId: genreId, name: 'Mystery' }],
        keywords: [],
        cast: [{ tmdbId: castId, name: 'TV Star' }],
        seasons: [{ seasonNumber: 1, tmdbId: seasonTmdbId }],
      };

      const showResult = await catalogueRepo.saveTvShowHeader(tvData);
      expect(showResult.id).toBeDefined();

      const seasonData: MappedSeasonData = {
        tmdbId: seasonTmdbId,
        seasonNumber: 1,
        name: 'Season 1',
        overview: 'Season overview',
        posterPath: '/season_poster.jpg',
        airDate: new Date('2015-01-01'),
        episodes: [
          {
            tmdbId: ep1TmdbId,
            episodeNumber: 1,
            name: 'Pilot',
            overview: 'Pilot episode',
            airDate: new Date('2015-01-01'),
            runtime: 55,
          },
          {
            tmdbId: ep2TmdbId,
            episodeNumber: 2,
            name: 'Episode 2',
            overview: 'Second episode',
            airDate: new Date('2015-01-08'),
            runtime: 50,
          },
        ],
      };

      const seasonResult = await catalogueRepo.saveSeasonAndEpisodes(showResult.id, seasonData);
      expect(seasonResult.seasonId).toBeDefined();
      expect(seasonResult.episodeCount).toBe(2);

      const savedShow = await prisma.tvShow.findUnique({
        where: { id: showResult.id },
        include: {
          genres: true,
          personCredits: { include: { person: true } },
          seasons: {
            include: { episodes: true },
          },
        },
      });

      expect(savedShow?.name).toBe(`Ingestion TV Show ${showTmdbId}`);
      expect(savedShow?.genres).toHaveLength(1);
      expect(savedShow?.personCredits).toHaveLength(1);
      expect(savedShow?.personCredits[0].tvShowId).toBe(showResult.id);
      expect(savedShow?.personCredits[0].movieId).toBeNull();
      expect(savedShow?.seasons).toHaveLength(1);
      expect(savedShow?.seasons[0].seasonNumber).toBe(1);
      expect(savedShow?.seasons[0].episodes).toHaveLength(2);

      // Re-run ingestion to ensure idempotency
      const rerunShowResult = await catalogueRepo.saveTvShowHeader(tvData);
      const rerunSeasonResult = await catalogueRepo.saveSeasonAndEpisodes(
        rerunShowResult.id,
        seasonData,
      );

      expect(rerunShowResult.id).toBe(showResult.id);
      expect(rerunSeasonResult.seasonId).toBe(seasonResult.seasonId);

      const episodesCount = await prisma.episode.count({
        where: { seasonId: seasonResult.seasonId },
      });
      expect(episodesCount).toBe(2);
    });

    it('persists specials (season 0) with nullable TMDB IDs safely', async () => {
      const showTmdbId = nextTmdbId();

      const tvData: MappedTvShowData = {
        tmdbId: showTmdbId,
        name: `Specials Show ${showTmdbId}`,
        originalName: null,
        overview: null,
        firstAirDate: null,
        lastAirDate: null,
        originalLanguage: null,
        popularity: null,
        voteAverage: null,
        voteCount: null,
        posterPath: null,
        backdropPath: null,
        status: null,
        numberOfSeasons: 1,
        numberOfEpisodes: 1,
        genres: [],
        keywords: [],
        cast: [],
        seasons: [{ seasonNumber: 0, tmdbId: null }],
      };

      const showResult = await catalogueRepo.saveTvShowHeader(tvData);

      const season0Data: MappedSeasonData = {
        tmdbId: null, // absent TMDB season ID
        seasonNumber: 0,
        name: 'Specials',
        overview: null,
        posterPath: null,
        airDate: null,
        episodes: [
          {
            tmdbId: null, // absent TMDB episode ID
            episodeNumber: 1,
            name: 'Special Featurette',
            overview: null,
            airDate: null,
            runtime: null,
          },
        ],
      };

      const seasonResult = await catalogueRepo.saveSeasonAndEpisodes(showResult.id, season0Data);
      expect(seasonResult.seasonId).toBeDefined();

      const savedSeason = await prisma.season.findUnique({
        where: { id: seasonResult.seasonId },
        include: { episodes: true },
      });

      expect(savedSeason?.seasonNumber).toBe(0);
      expect(savedSeason?.tmdbId).toBeNull();
      expect(savedSeason?.episodes[0].episodeNumber).toBe(1);
      expect(savedSeason?.episodes[0].tmdbId).toBeNull();
    });

    it('correctly handles concurrent ingestion without duplicate key errors', async () => {
      const movieTmdbId = nextTmdbId();
      const genreTmdbId = nextTmdbId();
      const actorTmdbId = nextTmdbId();

      const movieData: MappedMovieData = {
        tmdbId: movieTmdbId,
        title: `Concurrent Movie ${movieTmdbId}`,
        originalTitle: null,
        overview: 'Concurrency test',
        releaseDate: new Date('2022-01-01'),
        runtime: 100,
        originalLanguage: 'en',
        popularity: 10,
        voteAverage: 7,
        voteCount: 100,
        posterPath: null,
        backdropPath: null,
        adult: false,
        genres: [{ tmdbId: genreTmdbId, name: 'Sci-Fi' }],
        keywords: [],
        cast: [{ tmdbId: actorTmdbId, name: 'Concurrent Actor' }],
      };

      // Run two simultaneous saves of the exact same movie
      const [res1, res2] = await Promise.all([
        catalogueRepo.saveMovie(movieData),
        catalogueRepo.saveMovie(movieData),
      ]);

      expect(res1.id).toBe(res2.id);

      const count = await prisma.movie.count({ where: { tmdbId: movieTmdbId } });
      expect(count).toBe(1);

      const creditCount = await prisma.personCredit.count({ where: { movieId: res1.id } });
      expect(creditCount).toBe(1);
    });
  });
});
