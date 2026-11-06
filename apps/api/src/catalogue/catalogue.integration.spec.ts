/**
 * catalogue.integration.spec.ts
 *
 * Phase 2A — Catalogue database integration tests.
 * These tests run against a real PostgreSQL instance (the development database).
 * They verify data integrity constraints, relationships, and schema correctness
 * that cannot be validated with mocked Prisma clients.
 *
 * SETUP: Requires the Docker Compose PostgreSQL container to be running and
 * migrations to be applied before executing.
 *
 * Run from the monorepo root:
 *   pnpm --filter @cinesphere/api test:integration
 *
 * Or from apps/api:
 *   pnpm exec dotenv -e ../../.env -- jest --testPathPattern=catalogue.integration
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Counter-based IDs to avoid INT4 overflow.
// TMDB IDs in real data are < 10,000,000, so we keep these small and unique per test run.
let _idCounter = 900_000_000 + Math.floor(Math.random() * 90_000_000);

function uniqueTmdbId(): number {
  return ++_idCounter;
}

async function createGenre(tmdbId?: number) {
  const id = tmdbId ?? uniqueTmdbId();
  return prisma.genre.upsert({
    where: { tmdbId: id },
    update: {},
    create: { tmdbId: id, name: `Genre-${id}` },
  });
}

async function createKeyword(tmdbId?: number) {
  const id = tmdbId ?? uniqueTmdbId();
  return prisma.keyword.upsert({
    where: { tmdbId: id },
    update: {},
    create: { tmdbId: id, name: `Keyword-${id}` },
  });
}

async function createMovie(overrides?: Partial<Parameters<typeof prisma.movie.create>[0]['data']>) {
  const tmdbId = uniqueTmdbId();
  return prisma.movie.create({
    data: {
      tmdbId,
      title: `Test Movie ${tmdbId}`,
      ...overrides,
    },
  });
}

async function createTvShow(
  overrides?: Partial<Parameters<typeof prisma.tvShow.create>[0]['data']>,
) {
  const tmdbId = uniqueTmdbId();
  return prisma.tvShow.create({
    data: {
      tmdbId,
      name: `Test Show ${tmdbId}`,
      ...overrides,
    },
  });
}

async function createPerson(
  overrides?: Partial<Parameters<typeof prisma.person.create>[0]['data']>,
) {
  const tmdbId = uniqueTmdbId();
  return prisma.person.create({
    data: {
      tmdbId,
      name: `Person ${tmdbId}`,
      ...overrides,
    },
  });
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Catalogue Integration Tests', () => {
  describe('Genre', () => {
    it('stores a genre with a unique TMDB ID', async () => {
      const tmdbId = uniqueTmdbId();
      const genre = await prisma.genre.create({ data: { tmdbId, name: 'Action' } });
      expect(genre.tmdbId).toBe(tmdbId);
      expect(genre.name).toBe('Action');
    });

    it('rejects duplicate TMDB IDs', async () => {
      const tmdbId = uniqueTmdbId();
      await prisma.genre.create({ data: { tmdbId, name: 'Comedy' } });
      await expect(
        prisma.genre.create({ data: { tmdbId, name: 'Comedy Duplicate' } }),
      ).rejects.toThrow();
    });
  });

  describe('Keyword', () => {
    it('stores a keyword with a unique TMDB ID', async () => {
      const tmdbId = uniqueTmdbId();
      const kw = await prisma.keyword.create({ data: { tmdbId, name: 'space' } });
      expect(kw.tmdbId).toBe(tmdbId);
    });

    it('rejects duplicate keyword TMDB IDs', async () => {
      const tmdbId = uniqueTmdbId();
      await prisma.keyword.create({ data: { tmdbId, name: 'ocean' } });
      await expect(
        prisma.keyword.create({ data: { tmdbId, name: 'ocean again' } }),
      ).rejects.toThrow();
    });
  });

  describe('Movie', () => {
    it('creates a movie with all nullable metadata fields absent', async () => {
      const movie = await createMovie();
      expect(movie.id).toBeDefined();
      expect(movie.overview).toBeNull();
      expect(movie.releaseDate).toBeNull();
      expect(movie.runtime).toBeNull();
      expect(movie.adult).toBe(false);
    });

    it('creates a movie with optional metadata', async () => {
      const movie = await createMovie({
        overview: 'A great film',
        runtime: 120,
        voteAverage: 7.5,
        voteCount: 1000,
        adult: false,
        originalLanguage: 'en',
      });
      expect(movie.runtime).toBe(120);
      expect(movie.voteAverage).toBe(7.5);
    });

    it('rejects duplicate movie TMDB IDs', async () => {
      const movie = await createMovie();
      await expect(
        prisma.movie.create({ data: { tmdbId: movie.tmdbId, title: 'Duplicate' } }),
      ).rejects.toThrow();
    });

    it('associates a movie with genres', async () => {
      const movie = await createMovie();
      const genre1 = await createGenre();
      const genre2 = await createGenre();

      await prisma.movie.update({
        where: { id: movie.id },
        data: { genres: { connect: [{ tmdbId: genre1.tmdbId }, { tmdbId: genre2.tmdbId }] } },
      });

      const fetched = await prisma.movie.findUnique({
        where: { id: movie.id },
        include: { genres: true },
      });
      expect(fetched?.genres).toHaveLength(2);
    });

    it('associates a movie with keywords', async () => {
      const movie = await createMovie();
      const kw = await createKeyword();

      await prisma.movie.update({
        where: { id: movie.id },
        data: { keywords: { connect: [{ tmdbId: kw.tmdbId }] } },
      });

      const fetched = await prisma.movie.findUnique({
        where: { id: movie.id },
        include: { keywords: true },
      });
      expect(fetched?.keywords).toHaveLength(1);
    });

    it('genres are shared between movies and TV shows', async () => {
      const genre = await createGenre();
      const movie = await createMovie();
      const show = await createTvShow();

      await prisma.movie.update({
        where: { id: movie.id },
        data: { genres: { connect: { tmdbId: genre.tmdbId } } },
      });
      await prisma.tvShow.update({
        where: { id: show.id },
        data: { genres: { connect: { tmdbId: genre.tmdbId } } },
      });

      const fetchedMovie = await prisma.movie.findUnique({
        where: { id: movie.id },
        include: { genres: true },
      });
      const fetchedShow = await prisma.tvShow.findUnique({
        where: { id: show.id },
        include: { genres: true },
      });

      expect(fetchedMovie?.genres[0].tmdbId).toBe(genre.tmdbId);
      expect(fetchedShow?.genres[0].tmdbId).toBe(genre.tmdbId);
    });
  });

  describe('TvShow', () => {
    it('creates a TV show with nullable metadata absent', async () => {
      const show = await createTvShow();
      expect(show.id).toBeDefined();
      expect(show.overview).toBeNull();
      expect(show.status).toBeNull();
      expect(show.numberOfSeasons).toBeNull();
    });

    it('rejects duplicate TV show TMDB IDs', async () => {
      const show = await createTvShow();
      await expect(
        prisma.tvShow.create({ data: { tmdbId: show.tmdbId, name: 'Duplicate' } }),
      ).rejects.toThrow();
    });

    it('associates keywords shared with movies', async () => {
      const kw = await createKeyword();
      const show = await createTvShow();
      const movie = await createMovie();

      await prisma.tvShow.update({
        where: { id: show.id },
        data: { keywords: { connect: { tmdbId: kw.tmdbId } } },
      });
      await prisma.movie.update({
        where: { id: movie.id },
        data: { keywords: { connect: { tmdbId: kw.tmdbId } } },
      });

      const fetchedShow = await prisma.tvShow.findUnique({
        where: { id: show.id },
        include: { keywords: true },
      });
      expect(fetchedShow?.keywords[0].tmdbId).toBe(kw.tmdbId);
    });
  });

  describe('Season', () => {
    it('creates a season attached to a TV show', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1, name: 'Season 1' },
      });
      expect(season.seasonNumber).toBe(1);
      expect(season.tvShowId).toBe(show.id);
    });

    it('supports season zero (specials)', async () => {
      const show = await createTvShow();
      const special = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 0, name: 'Specials' },
      });
      expect(special.seasonNumber).toBe(0);
    });

    it('rejects duplicate season numbers within the same TV show', async () => {
      const show = await createTvShow();
      await prisma.season.create({ data: { tvShowId: show.id, seasonNumber: 1 } });
      await expect(
        prisma.season.create({ data: { tvShowId: show.id, seasonNumber: 1 } }),
      ).rejects.toThrow();
    });

    it('allows the same season number on different TV shows', async () => {
      const show1 = await createTvShow();
      const show2 = await createTvShow();
      const s1 = await prisma.season.create({ data: { tvShowId: show1.id, seasonNumber: 1 } });
      const s2 = await prisma.season.create({ data: { tvShowId: show2.id, seasonNumber: 1 } });
      expect(s1.id).not.toBe(s2.id);
    });

    it('cascades deletion to seasons when a TV show is deleted', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1 },
      });
      await prisma.tvShow.delete({ where: { id: show.id } });
      const found = await prisma.season.findUnique({ where: { id: season.id } });
      expect(found).toBeNull();
    });
  });

  describe('Episode', () => {
    it('creates an episode attached to a season', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1 },
      });
      const episode = await prisma.episode.create({
        data: { seasonId: season.id, episodeNumber: 1, name: 'Pilot' },
      });
      expect(episode.episodeNumber).toBe(1);
      expect(episode.seasonId).toBe(season.id);
    });

    it('rejects duplicate episode numbers within the same season', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1 },
      });
      await prisma.episode.create({ data: { seasonId: season.id, episodeNumber: 1 } });
      await expect(
        prisma.episode.create({ data: { seasonId: season.id, episodeNumber: 1 } }),
      ).rejects.toThrow();
    });

    it('allows nullable episode metadata', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1 },
      });
      const ep = await prisma.episode.create({
        data: { seasonId: season.id, episodeNumber: 2 },
      });
      expect(ep.name).toBeNull();
      expect(ep.runtime).toBeNull();
    });

    it('cascades deletion to episodes when a season is deleted', async () => {
      const show = await createTvShow();
      const season = await prisma.season.create({
        data: { tvShowId: show.id, seasonNumber: 1 },
      });
      const ep = await prisma.episode.create({
        data: { seasonId: season.id, episodeNumber: 1 },
      });
      await prisma.season.delete({ where: { id: season.id } });
      const found = await prisma.episode.findUnique({ where: { id: ep.id } });
      expect(found).toBeNull();
    });
  });

  describe('Person', () => {
    it('creates a person with a unique TMDB ID', async () => {
      const person = await createPerson();
      expect(person.id).toBeDefined();
      expect(person.tmdbId).toBeDefined();
    });

    it('rejects duplicate person TMDB IDs', async () => {
      const person = await createPerson();
      await expect(
        prisma.person.create({ data: { tmdbId: person.tmdbId, name: 'Duplicate' } }),
      ).rejects.toThrow();
    });
  });

  describe('PersonCredit', () => {
    it('creates a person-to-movie credit', async () => {
      const person = await createPerson();
      const movie = await createMovie();
      const credit = await prisma.personCredit.create({
        data: { personId: person.id, movieId: movie.id },
      });
      expect(credit.movieId).toBe(movie.id);
      expect(credit.tvShowId).toBeNull();
    });

    it('creates a person-to-TV-show credit', async () => {
      const person = await createPerson();
      const show = await createTvShow();
      const credit = await prisma.personCredit.create({
        data: { personId: person.id, tvShowId: show.id },
      });
      expect(credit.tvShowId).toBe(show.id);
      expect(credit.movieId).toBeNull();
    });

    it('rejects a credit with both movieId and tvShowId (CHECK constraint)', async () => {
      const person = await createPerson();
      const movie = await createMovie();
      const show = await createTvShow();
      await expect(
        prisma.$executeRaw`
          INSERT INTO person_credits ("id", "personId", "movieId", "tvShowId")
          VALUES (gen_random_uuid(), ${person.id}::uuid, ${movie.id}::uuid, ${show.id}::uuid)
        `,
      ).rejects.toThrow();
    });

    it('rejects a credit with neither movieId nor tvShowId (CHECK constraint)', async () => {
      const person = await createPerson();
      await expect(
        prisma.$executeRaw`
          INSERT INTO person_credits ("id", "personId", "movieId", "tvShowId")
          VALUES (gen_random_uuid(), ${person.id}::uuid, NULL, NULL)
        `,
      ).rejects.toThrow();
    });

    it('rejects duplicate person-to-movie credits', async () => {
      const person = await createPerson();
      const movie = await createMovie();
      await prisma.personCredit.create({ data: { personId: person.id, movieId: movie.id } });
      await expect(
        prisma.personCredit.create({ data: { personId: person.id, movieId: movie.id } }),
      ).rejects.toThrow();
    });

    it('rejects duplicate person-to-TV-show credits', async () => {
      const person = await createPerson();
      const show = await createTvShow();
      await prisma.personCredit.create({ data: { personId: person.id, tvShowId: show.id } });
      await expect(
        prisma.personCredit.create({ data: { personId: person.id, tvShowId: show.id } }),
      ).rejects.toThrow();
    });

    it('retrieves all movies and TV shows for a person in one query', async () => {
      const person = await createPerson();
      const movie1 = await createMovie();
      const movie2 = await createMovie();
      const show1 = await createTvShow();

      await prisma.personCredit.createMany({
        data: [
          { personId: person.id, movieId: movie1.id },
          { personId: person.id, movieId: movie2.id },
          { personId: person.id, tvShowId: show1.id },
        ],
      });

      const credits = await prisma.personCredit.findMany({
        where: { personId: person.id },
        include: { movie: true, tvShow: true },
      });

      expect(credits).toHaveLength(3);
      const movieCredits = credits.filter((c) => c.movie !== null);
      const tvCredits = credits.filter((c) => c.tvShow !== null);
      expect(movieCredits).toHaveLength(2);
      expect(tvCredits).toHaveLength(1);
    });

    it('cascades deletion when a person is deleted', async () => {
      const person = await createPerson();
      const movie = await createMovie();
      const credit = await prisma.personCredit.create({
        data: { personId: person.id, movieId: movie.id },
      });
      await prisma.person.delete({ where: { id: person.id } });
      const found = await prisma.personCredit.findUnique({ where: { id: credit.id } });
      expect(found).toBeNull();
    });

    it('cascades deletion when a movie is deleted', async () => {
      const person = await createPerson();
      const movie = await createMovie();
      const credit = await prisma.personCredit.create({
        data: { personId: person.id, movieId: movie.id },
      });
      await prisma.movie.delete({ where: { id: movie.id } });
      const found = await prisma.personCredit.findUnique({ where: { id: credit.id } });
      expect(found).toBeNull();
    });
  });
});
