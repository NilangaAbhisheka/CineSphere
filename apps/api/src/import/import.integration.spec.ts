// ==============================================================================
// CineSphere — Import Integration Tests
// Phase 4.4
//
// These tests run against a real PostgreSQL database using the same patterns
// as the existing library integration tests.
// ==============================================================================

import { ConfigService } from '@nestjs/config';
import {
  CatalogueProvenance,
  PipelineRunStatus,
  PipelineTriggerType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { PIPELINE_ERROR_CODES, PIPELINE_NAMES } from '../observability/observability.constants.js';
import { PipelineTrackingService } from '../observability/pipeline-tracking.service.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import { ImportService } from './import.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SINGLE_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeJsonBuffer(doc: unknown): Buffer {
  return Buffer.from(JSON.stringify(doc), 'utf-8');
}

function makeCsvBuffer(csv: string): Buffer {
  return Buffer.from(csv, 'utf-8');
}

// ── Integration Tests ─────────────────────────────────────────────────────────

describe('Import Integration Tests', () => {
  let prisma: PrismaService;
  let userBootstrap: SingleUserBootstrap;
  let pipelineTracking: PipelineTrackingService;
  let importService: ImportService;
  let mockTmdbService: jest.Mocked<TmdbService>;
  let suiteStartedAt: Date;

  let _counter = 850_000_000 + Math.floor(Math.random() * 10_000_000);
  function uniqueTmdbId(): number {
    return ++_counter;
  }

  beforeAll(async () => {
    suiteStartedAt = new Date();
    prisma = new PrismaService();
    await prisma.$connect();

    const mockConfig = {
      get: (key: string) => {
        if (key === 'CINESPHERE_SINGLE_USER_ID') return SINGLE_USER_ID;
        return null;
      },
    } as unknown as ConfigService;

    userBootstrap = new SingleUserBootstrap(mockConfig, prisma);
    await userBootstrap.bootstrap();

    mockTmdbService = {
      ingestMovie: jest.fn(),
      ingestTvShow: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    pipelineTracking = new PipelineTrackingService(prisma);
    importService = new ImportService(prisma, userBootstrap, mockTmdbService, pipelineTracking);
  });

  afterAll(async () => {
    // Clean up all entries and pipeline runs created during this suite
    await prisma.userLibraryEntry.deleteMany({ where: { userId: SINGLE_USER_ID } });
    await prisma.pipelineRun.deleteMany({
      where: {
        pipelineName: { in: [PIPELINE_NAMES.IMPORT_JSON, PIPELINE_NAMES.IMPORT_CSV] },
        startedAt: { gte: suiteStartedAt },
      },
    });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean up after each test for isolation
    await prisma.userLibraryEntry.deleteMany({ where: { userId: SINGLE_USER_ID } });
  });

  // ── Catalogue helpers ────────────────────────────────────────────────────────

  async function createMovie(title: string): Promise<{ id: string; tmdbId: number }> {
    const tmdbId = uniqueTmdbId();
    const movie = await prisma.movie.create({
      data: {
        tmdbId,
        title,
        overview: 'Integration test movie',
        releaseDate: new Date('2024-01-01'),
        voteAverage: 8.0,
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    return { id: movie.id, tmdbId };
  }

  async function createTvShow(name: string): Promise<{
    id: string;
    tmdbId: number;
    season1Id: string;
    season1TmdbId: number;
    episode1Id: string;
    episode1TmdbId: number;
    episode2Id: string;
    episode2TmdbId: number;
  }> {
    const showTmdbId = uniqueTmdbId();
    const season1TmdbId = uniqueTmdbId();
    const ep1TmdbId = uniqueTmdbId();
    const ep2TmdbId = uniqueTmdbId();

    const show = await prisma.tvShow.create({
      data: {
        tmdbId: showTmdbId,
        name,
        overview: 'Integration test TV show',
        numberOfSeasons: 1,
        numberOfEpisodes: 2,
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });

    const season = await prisma.season.create({
      data: {
        tmdbId: season1TmdbId,
        seasonNumber: 1,
        name: 'Season 1',
        tvShowId: show.id,
      },
    });

    const ep1 = await prisma.episode.create({
      data: {
        tmdbId: ep1TmdbId,
        episodeNumber: 1,
        name: 'Pilot',
        seasonId: season.id,
      },
    });

    const ep2 = await prisma.episode.create({
      data: {
        tmdbId: ep2TmdbId,
        episodeNumber: 2,
        name: 'Episode 2',
        seasonId: season.id,
      },
    });

    return {
      id: show.id,
      tmdbId: showTmdbId,
      season1Id: season.id,
      season1TmdbId,
      episode1Id: ep1.id,
      episode1TmdbId: ep1TmdbId,
      episode2Id: ep2.id,
      episode2TmdbId: ep2TmdbId,
    };
  }

  // ── JSON Import Tests ────────────────────────────────────────────────────────

  describe('JSON import', () => {
    it('successfully imports a movie library entry', async () => {
      const movie = await createMovie('Import Test Movie A');
      mockTmdbService.ingestMovie.mockResolvedValue({ id: movie.id } as never);
      // Simulate: movie already in catalogue (findUnique returns it)
      // The service calls prisma.movie.findUnique internally — it will find it
      // since we created it.

      const doc = {
        version: '1.0',
        entries: [
          { tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'COMPLETED', personalRating: 8.5 },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify persisted
      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
      expect(ule).not.toBeNull();
      expect(ule!.status).toBe('COMPLETED');
      expect(Number(ule!.personalRating)).toBe(8.5);
    });

    it('successfully imports a TV library entry', async () => {
      const show = await createTvShow('Import Test Show A');

      const doc = {
        version: '1.0',
        entries: [{ tmdbId: show.tmdbId, mediaType: 'TV', status: 'WATCHING' }],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, tvShowId: show.id },
      });
      expect(ule).not.toBeNull();
      expect(ule!.status).toBe('WATCHING');
    });

    it('imports multiple viewing events for a movie', async () => {
      const movie = await createMovie('Import Test Movie B');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: movie.tmdbId,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [
              { watchedAt: '2023-01-15T20:00:00Z', rating: 8.0, notes: 'First watch' },
              { watchedAt: '2023-06-01T19:00:00Z', rating: 8.5, notes: 'Rewatch' },
            ],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
        include: { viewingEvents: true },
      });
      expect(ule?.viewingEvents).toHaveLength(2);
      const ratings = ule!.viewingEvents.map((e) => Number(e.rating)).sort();
      expect(ratings).toEqual([8.0, 8.5]);
    });

    it('imports episode progress for a TV show', async () => {
      const show = await createTvShow('Import Test Show B');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: show.tmdbId,
            mediaType: 'TV',
            status: 'WATCHING',
            episodeProgress: [
              { episodeTmdbId: show.episode1TmdbId, watchedAt: '2023-02-01T20:00:00Z' },
              { episodeTmdbId: show.episode2TmdbId, watchedAt: '2023-02-02T20:00:00Z' },
            ],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, tvShowId: show.id },
        include: { episodeProgresses: true },
      });
      expect(ule?.episodeProgresses).toHaveLength(2);
    });

    it('stores null watchedAt when omitted in episode progress and preserves exact timestamp when provided', async () => {
      const show = await createTvShow('Import Test Show Null WatchedAt');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: show.tmdbId,
            mediaType: 'TV',
            status: 'WATCHING',
            episodeProgress: [
              { episodeTmdbId: show.episode1TmdbId, watchedAt: '2023-02-01T20:00:00Z' },
              { episodeTmdbId: show.episode2TmdbId }, // omitted watchedAt
            ],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, tvShowId: show.id },
        include: {
          episodeProgresses: {
            orderBy: { episodeId: 'asc' },
            include: { episode: true },
          },
        },
      });

      expect(ule?.episodeProgresses).toHaveLength(2);

      const ep1 = ule!.episodeProgresses.find((p) => p.episode.tmdbId === show.episode1TmdbId);
      const ep2 = ule!.episodeProgresses.find((p) => p.episode.tmdbId === show.episode2TmdbId);

      expect(ep1).toBeDefined();
      expect(ep1!.watchedAt).not.toBeNull();
      expect(ep1!.watchedAt?.toISOString()).toBe('2023-02-01T20:00:00.000Z');

      expect(ep2).toBeDefined();
      // Crucial requirement: watchedAt must be null when omitted, not fabricated with current date
      expect(ep2!.watchedAt).toBeNull();

      // Total count in DB is preserved accurately
      const totalProgressCount = await prisma.episodeProgress.count({
        where: { libraryEntryId: ule!.id },
      });
      expect(totalProgressCount).toBe(2);
    });

    it('imports season ratings for a TV show', async () => {
      const show = await createTvShow('Import Test Show C');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: show.tmdbId,
            mediaType: 'TV',
            status: 'COMPLETED',
            seasonRatings: [{ seasonTmdbId: show.season1TmdbId, rating: 9.0 }],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, tvShowId: show.id },
        include: { seasonRatings: true },
      });
      expect(ule?.seasonRatings).toHaveLength(1);
      expect(Number(ule!.seasonRatings[0].rating)).toBe(9.0);
    });

    it('skips entries that already exist in the library', async () => {
      const movie = await createMovie('Import Test Movie Existing');

      // Pre-create library entry
      await prisma.userLibraryEntry.create({
        data: {
          userId: SINGLE_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie.id,
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('7.0'),
        },
      });

      const doc = {
        version: '1.0',
        entries: [{ tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' }],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);

      // Existing entry must NOT be overwritten
      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
      expect(ule!.status).toBe('COMPLETED'); // unchanged
      expect(Number(ule!.personalRating)).toBe(7.0); // unchanged
    });

    it('rolls back entire import when TMDB resolution fails for any entry', async () => {
      const movieA = await createMovie('Rollback Test Movie A');
      const badTmdbId = uniqueTmdbId();

      // badTmdbId doesn't exist and ingestion fails
      mockTmdbService.ingestMovie.mockRejectedValue(new Error('TMDB not found'));

      const doc = {
        version: '1.0',
        entries: [
          { tmdbId: movieA.tmdbId, mediaType: 'MOVIE', status: 'COMPLETED' },
          { tmdbId: badTmdbId, mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' },
        ],
      };

      // Even if movieA resolves, the second entry failing should prevent any writes
      // (validation fails → no transaction started)
      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // No entries should have been written
      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('rejects viewing events with invalid calendar date or missing timezone (no records written)', async () => {
      const movie = await createMovie('Invalid Date Test Movie');

      const invalidDoc = {
        version: '1.0',
        entries: [
          {
            tmdbId: movie.tmdbId,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ watchedAt: '2024-02-30T12:00:00Z' }], // Feb 30 does not exist
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(invalidDoc));
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.field === 'viewingEvents[0].watchedAt')).toBe(true);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('handles duplicate entries within the import file (validation failure)', async () => {
      const movie = await createMovie('Duplicate Test Movie');

      const doc = {
        version: '1.0',
        entries: [
          { tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'COMPLETED' },
          { tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true);

      // Nothing should be written
      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('assigns ownership to the single user (never client-supplied userId)', async () => {
      const movie = await createMovie('Ownership Test Movie');

      const doc = {
        version: '1.0',
        entries: [{ tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'COMPLETED' }],
      };

      await importService.importJson(makeJsonBuffer(doc));

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { movieId: movie.id },
      });
      expect(ule!.userId).toBe(SINGLE_USER_ID);
    });

    it('handles notes correctly', async () => {
      const movie = await createMovie('Notes Test Movie');

      const doc = {
        version: '1.0',
        entries: [
          { tmdbId: movie.tmdbId, mediaType: 'MOVIE', status: 'COMPLETED', notes: 'Amazing film' },
        ],
      };

      await importService.importJson(makeJsonBuffer(doc));

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { movieId: movie.id },
      });
      expect(ule!.notes).toBe('Amazing film');
    });

    it('returns validation error without writes for invalid JSON structure', async () => {
      const result = await importService.importJson(
        makeJsonBuffer({
          version: '1.0',
          entries: [{ tmdbId: -1, mediaType: 'INVALID', status: 'BAD' }],
        }),
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('rejects import if an episode TMDB ID is missing from the catalogue (no silent discard)', async () => {
      const show = await createTvShow('TV Show Missing Episode');
      const nonexistentEpTmdbId = uniqueTmdbId();

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: show.tmdbId,
            mediaType: 'TV',
            status: 'WATCHING',
            episodeProgress: [{ episodeTmdbId: nonexistentEpTmdbId }],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field?.includes('episodeProgress') && e.message.includes('not found'),
        ),
      ).toBe(true);

      // Verify no partial tracking records were written
      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
      const epCount = await prisma.episodeProgress.count({
        where: { libraryEntry: { userId: SINGLE_USER_ID } },
      });
      expect(epCount).toBe(0);
    });

    it('rejects import if an episode TMDB ID belongs to a different TV show', async () => {
      const showA = await createTvShow('TV Show A');
      const showB = await createTvShow('TV Show B');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: showA.tmdbId,
            mediaType: 'TV',
            status: 'WATCHING',
            // Try to assign showB's episode to showA's entry
            episodeProgress: [{ episodeTmdbId: showB.episode1TmdbId }],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes('belongs to a different TV show'))).toBe(
        true,
      );

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('rejects import if a season TMDB ID is missing from the catalogue (no silent discard)', async () => {
      const show = await createTvShow('TV Show Missing Season');
      const nonexistentSeasonTmdbId = uniqueTmdbId();

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: show.tmdbId,
            mediaType: 'TV',
            status: 'COMPLETED',
            seasonRatings: [{ seasonTmdbId: nonexistentSeasonTmdbId, rating: 8.5 }],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field?.includes('seasonRatings') && e.message.includes('not found'),
        ),
      ).toBe(true);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
      const srCount = await prisma.seasonRating.count({
        where: { libraryEntry: { userId: SINGLE_USER_ID } },
      });
      expect(srCount).toBe(0);
    });

    it('rejects import if a season TMDB ID belongs to a different TV show', async () => {
      const showA = await createTvShow('TV Show Alpha');
      const showB = await createTvShow('TV Show Beta');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: showA.tmdbId,
            mediaType: 'TV',
            status: 'COMPLETED',
            seasonRatings: [{ seasonTmdbId: showB.season1TmdbId, rating: 9.0 }],
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes('belongs to a different TV show'))).toBe(
        true,
      );

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('rejects import if viewing event is missing watchedAt (enforces required timestamp)', async () => {
      const movie = await createMovie('Viewing Event Missing WatchedAt Movie');

      const doc = {
        version: '1.0',
        entries: [
          {
            tmdbId: movie.tmdbId,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ rating: 8.5 }], // missing watchedAt
          },
        ],
      };

      const result = await importService.importJson(makeJsonBuffer(doc));

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.field === 'viewingEvents[0].watchedAt')).toBe(true);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });
  });

  // ── CSV Import Tests ─────────────────────────────────────────────────────────

  describe('CSV import', () => {
    it('successfully imports a movie entry from CSV', async () => {
      const movie = await createMovie('CSV Import Movie A');

      const csv = `tmdb_id,media_type,status,personal_rating,notes\n${movie.tmdbId},MOVIE,COMPLETED,8.0,Great film`;
      const result = await importService.importCsv(makeCsvBuffer(csv));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
      expect(ule).not.toBeNull();
      expect(ule!.status).toBe('COMPLETED');
      expect(Number(ule!.personalRating)).toBe(8.0);
      expect(ule!.notes).toBe('Great film');
    });

    it('successfully imports a TV entry from CSV', async () => {
      const show = await createTvShow('CSV Import Show A');

      const csv = `tmdb_id,media_type,status\n${show.tmdbId},TV,WATCHING`;
      const result = await importService.importCsv(makeCsvBuffer(csv));

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, tvShowId: show.id },
      });
      expect(ule).not.toBeNull();
      expect(ule!.status).toBe('WATCHING');
    });

    it('skips existing CSV entries without overwriting', async () => {
      const movie = await createMovie('CSV Skip Movie');

      await prisma.userLibraryEntry.create({
        data: {
          userId: SINGLE_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie.id,
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('9.0'),
        },
      });

      const csv = `tmdb_id,media_type,status,personal_rating\n${movie.tmdbId},MOVIE,PLAN_TO_WATCH,5.0`;
      const result = await importService.importCsv(makeCsvBuffer(csv));

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);

      const ule = await prisma.userLibraryEntry.findFirst({
        where: { userId: SINGLE_USER_ID, movieId: movie.id },
      });
      expect(ule!.status).toBe('COMPLETED'); // unchanged
      expect(Number(ule!.personalRating)).toBe(9.0); // unchanged
    });

    it('returns validation errors for invalid CSV structure', async () => {
      const csv = `wrong_header,bad\nabc,xyz`;
      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('returns validation errors for invalid row data', async () => {
      const csv = `tmdb_id,media_type,status\nabc,INVALID,WRONG`;
      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports validation errors using physical line numbers when earlier rows contain multiline fields', async () => {
      const movie1 = await createMovie('CSV Multiline Movie 1');

      // Line 1: Header
      // Line 2-4: Row 1 (multiline notes)
      // Line 5: Row 2 (invalid status)
      const csv = [
        'tmdb_id,media_type,status,notes',
        `${movie1.tmdbId},MOVIE,COMPLETED,"Note line 1`,
        'Note line 2',
        'Note line 3"',
        '999999,MOVIE,INVALID_STATUS,Invalid row note',
      ].join('\n');

      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(false);
      const statusError = result.errors.find((e) => e.field === 'status');
      expect(statusError).toBeDefined();
      expect(statusError?.index).toBe(5); // Physical CSV line 5
      expect(statusError?.message).toContain('Row 5: "status" must be one of');
    });

    it('handles multiple movies in one CSV', async () => {
      const movie1 = await createMovie('CSV Multi Movie 1');
      const movie2 = await createMovie('CSV Multi Movie 2');

      const csv = [
        'tmdb_id,media_type,status',
        `${movie1.tmdbId},MOVIE,COMPLETED`,
        `${movie2.tmdbId},MOVIE,PLAN_TO_WATCH`,
      ].join('\n');

      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.total).toBe(2);
    });

    it('assigns ownership to the single user', async () => {
      const movie = await createMovie('CSV Ownership Movie');

      const csv = `tmdb_id,media_type,status\n${movie.tmdbId},MOVIE,COMPLETED`;
      await importService.importCsv(makeCsvBuffer(csv));

      const ule = await prisma.userLibraryEntry.findFirst({ where: { movieId: movie.id } });
      expect(ule!.userId).toBe(SINGLE_USER_ID);
    });

    it('handles duplicate tmdb_id in CSV (validation failure, nothing written)', async () => {
      const movie = await createMovie('CSV Dup Movie');

      const csv = [
        'tmdb_id,media_type,status',
        `${movie.tmdbId},MOVIE,COMPLETED`,
        `${movie.tmdbId},MOVIE,PLAN_TO_WATCH`,
      ].join('\n');

      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true);

      const count = await prisma.userLibraryEntry.count({ where: { userId: SINGLE_USER_ID } });
      expect(count).toBe(0);
    });

    it('handles import with created_at field', async () => {
      const movie = await createMovie('CSV CreatedAt Movie');

      const csv = `tmdb_id,media_type,status,created_at\n${movie.tmdbId},MOVIE,COMPLETED,2023-05-10T12:00:00Z`;
      const result = await importService.importCsv(makeCsvBuffer(csv));
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      const ule = await prisma.userLibraryEntry.findFirst({ where: { movieId: movie.id } });
      expect(ule?.createdAt.toISOString()).toContain('2023-05-10');
    });
  });

  describe('Pipeline Tracking Telemetry Integration', () => {
    it('records SUCCEEDED, FAILED, and privacy-safe pipeline_runs rows across real imports', async () => {
      const movie = await createMovie('Telemetry Movie');
      const testStart = new Date();

      // 1. Successful JSON import with personal note & rating (must NOT leak to telemetry)
      const jsonOk = await importService.importJson(
        makeJsonBuffer({
          version: '1.0',
          entries: [
            {
              tmdbId: movie.tmdbId,
              mediaType: 'MOVIE',
              status: 'COMPLETED',
              personalRating: 9.0,
              notes: 'Sensitive personal review note',
            },
          ],
        }),
      );
      expect(jsonOk.success).toBe(true);

      // 2. All-skipped CSV import for the same title
      const csvSkip = await importService.importCsv(
        makeCsvBuffer(`tmdb_id,media_type,status\n${movie.tmdbId},MOVIE,COMPLETED`),
      );
      expect(csvSkip.success).toBe(true);
      expect(csvSkip.skipped).toBe(1);

      // 3. Schema validation failure in CSV
      const csvInvalid = await importService.importCsv(
        makeCsvBuffer(`tmdb_id,media_type,status\n-1,MOVIE,BAD_STATUS`),
      );
      expect(csvInvalid.success).toBe(false);

      const runs = await prisma.pipelineRun.findMany({
        where: { startedAt: { gte: testStart } },
        orderBy: { startedAt: 'asc' },
      });

      expect(runs).toHaveLength(3);

      expect(runs[0]).toMatchObject({
        pipelineName: PIPELINE_NAMES.IMPORT_JSON,
        triggerType: PipelineTriggerType.MANUAL,
        status: PipelineRunStatus.SUCCEEDED,
        recordsRead: 1,
        recordsInserted: 1,
        recordsSkipped: 0,
        recordsRejected: 0,
        errorCode: null,
      });

      expect(runs[1]).toMatchObject({
        pipelineName: PIPELINE_NAMES.IMPORT_CSV,
        triggerType: PipelineTriggerType.MANUAL,
        status: PipelineRunStatus.SUCCEEDED,
        recordsRead: 1,
        recordsInserted: 0,
        recordsSkipped: 1,
        recordsRejected: 0,
        errorCode: null,
      });

      expect(runs[2]).toMatchObject({
        pipelineName: PIPELINE_NAMES.IMPORT_CSV,
        triggerType: PipelineTriggerType.MANUAL,
        status: PipelineRunStatus.FAILED,
        recordsRead: 1,
        recordsInserted: 0,
        recordsSkipped: 0,
        recordsRejected: 1,
        errorCode: PIPELINE_ERROR_CODES.VALIDATION_FAILED,
      });

      const serializedRuns = JSON.stringify(runs);
      expect(serializedRuns).not.toContain('Sensitive personal review note');
      expect(serializedRuns).not.toContain(SINGLE_USER_ID);
      expect(serializedRuns).not.toContain(String(movie.tmdbId));
    });
  });
});
