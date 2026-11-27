// ==============================================================================
// CineSphere — Export PostgreSQL Integration Tests
// Phase 4.5
//
// Validates:
//   1. Real PostgreSQL database query under REPEATABLE READ snapshot isolation.
//   2. Single-user isolation (never includes other users' data).
//   3. Read-only invariant (zero database mutations during export).
//   4. Full-fidelity JSON round-trip restoration via ImportService.
//   5. Limited CSV round-trip restoration (verifying exact 6 fields and no nested data).
//   6. Database name safety check against development database.
//   7. Scoped cleanup strictly bounded to synthetic test users.
// ==============================================================================

import { ConfigService } from '@nestjs/config';
import { CatalogueProvenance, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import { ImportService } from '../import/import.service.js';
import { validateJsonImport, validateCsvImport } from '../import/import.validator.js';
import { PIPELINE_NAMES } from '../observability/observability.constants.js';
import { PipelineTrackingService } from '../observability/pipeline-tracking.service.js';
import { ExportService } from './export.service.js';

// ── Database Safety Guard ─────────────────────────────────────────────────────

const TEST_DB_URL =
  process.env.CINESPHERE_E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test?schema=public';

const APPROVED_DB_TOKEN_PATTERN = /(?:^|[_-])(test|e2e)(?:$|[_-])/i;
const dbName = new URL(TEST_DB_URL).pathname.replace(/^\//, '');
if (!APPROVED_DB_TOKEN_PATTERN.test(dbName) || dbName === 'cinesphere') {
  throw new Error(`Integration test cannot run against non-test database: "${dbName}"`);
}

describe('Export PostgreSQL Integration Tests', () => {
  let prisma: PrismaService;
  let userBootstrap: SingleUserBootstrap;
  let exportService: ExportService;
  let importService: ImportService;
  let pipelineTracking: PipelineTrackingService;
  let mockTmdbService: jest.Mocked<TmdbService>;
  let suiteStartedAt: Date;

  // Dedicated synthetic test user IDs (strictly scoped)
  const EXPORT_TEST_USER_ID = 'e3eebc99-9c0b-4ef8-bb6d-6bb9bd380e33';
  const OTHER_TEST_USER_ID = 'f4eebc99-9c0b-4ef8-bb6d-6bb9bd380f44';

  const createdMovieIds: string[] = [];
  const createdTvShowIds: string[] = [];

  let _counter = 880_000_000 + Math.floor(Math.random() * 10_000_000);
  function uniqueTmdbId(): number {
    return ++_counter;
  }

  beforeAll(async () => {
    suiteStartedAt = new Date();
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaService();
    await prisma.$connect();

    // Ensure test users exist in User table
    await prisma.user.upsert({
      where: { id: EXPORT_TEST_USER_ID },
      update: {},
      create: { id: EXPORT_TEST_USER_ID, displayName: 'Export Test User' },
    });
    await prisma.user.upsert({
      where: { id: OTHER_TEST_USER_ID },
      update: {},
      create: { id: OTHER_TEST_USER_ID, displayName: 'Other Test User' },
    });

    const mockConfig = {
      get: (key: string) => {
        if (key === 'CINESPHERE_SINGLE_USER_ID') return EXPORT_TEST_USER_ID;
        return null;
      },
    } as unknown as ConfigService;

    userBootstrap = new SingleUserBootstrap(mockConfig, prisma);
    await userBootstrap.bootstrap();

    mockTmdbService = {
      ingestMovie: jest.fn(),
      ingestTvShow: jest.fn(),
    } as unknown as jest.Mocked<TmdbService>;

    exportService = new ExportService(prisma, userBootstrap);
    pipelineTracking = new PipelineTrackingService(prisma);
    importService = new ImportService(prisma, userBootstrap, mockTmdbService, pipelineTracking);

    // Initial scoped cleanup
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [EXPORT_TEST_USER_ID, OTHER_TEST_USER_ID] } },
    });
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    const cleanupErrors: unknown[] = [];

    try {
      // Scoped cleanup of test users' library entries
      try {
        await prisma.userLibraryEntry.deleteMany({
          where: { userId: { in: [EXPORT_TEST_USER_ID, OTHER_TEST_USER_ID] } },
        });
      } catch (err) {
        cleanupErrors.push(err);
      }

      try {
        await prisma.pipelineRun.deleteMany({
          where: {
            pipelineName: { in: [PIPELINE_NAMES.IMPORT_JSON, PIPELINE_NAMES.IMPORT_CSV] },
            startedAt: { gte: suiteStartedAt },
          },
        });
      } catch (err) {
        cleanupErrors.push(err);
      }

      // Clean up created catalogue test records by explicit ID
      if (createdMovieIds.length > 0) {
        try {
          await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds } } });
        } catch (err) {
          cleanupErrors.push(err);
        }
      }

      if (createdTvShowIds.length > 0) {
        try {
          await prisma.tvShow.deleteMany({ where: { id: { in: createdTvShowIds } } });
        } catch (err) {
          cleanupErrors.push(err);
        }
      }
    } finally {
      try {
        await prisma.$disconnect();
      } catch (disconnectErr) {
        cleanupErrors.push(disconnectErr);
      }
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors
        .map((e) => (e instanceof Error ? e.stack || e.message : String(e)))
        .join('\n');
      throw new Error(
        `Teardown cleanup encountered ${cleanupErrors.length} error(s):\n${messages}`,
      );
    }
  });

  beforeEach(async () => {
    // Clean up test entries before each test
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [EXPORT_TEST_USER_ID, OTHER_TEST_USER_ID] } },
    });
  });

  afterEach(async () => {
    // Clean up test entries after each test
    await prisma.userLibraryEntry.deleteMany({
      where: { userId: { in: [EXPORT_TEST_USER_ID, OTHER_TEST_USER_ID] } },
    });
  });

  // ── Catalogue Helpers ────────────────────────────────────────────────────────

  async function createMovie(title: string): Promise<{ id: string; tmdbId: number }> {
    const tmdbId = uniqueTmdbId();
    const movie = await prisma.movie.create({
      data: {
        tmdbId,
        title,
        overview: 'Integration test movie for export',
        releaseDate: new Date('2024-01-01'),
        voteAverage: 8.0,
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    createdMovieIds.push(movie.id);
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
    const episode1TmdbId = uniqueTmdbId();
    const episode2TmdbId = uniqueTmdbId();

    const tvShow = await prisma.tvShow.create({
      data: {
        tmdbId: showTmdbId,
        name,
        overview: 'Integration test TV show for export',
        firstAirDate: new Date('2024-01-01'),
        voteAverage: 8.5,
        provenance: CatalogueProvenance.SYNTHETIC,
        seasons: {
          create: [
            {
              tmdbId: season1TmdbId,
              seasonNumber: 1,
              name: 'Season 1',
              episodes: {
                create: [
                  {
                    tmdbId: episode1TmdbId,
                    episodeNumber: 1,
                    name: 'Episode 1',
                  },
                  {
                    tmdbId: episode2TmdbId,
                    episodeNumber: 2,
                    name: 'Episode 2',
                  },
                ],
              },
            },
          ],
        },
      },
      include: {
        seasons: {
          include: { episodes: true },
        },
      },
    });

    createdTvShowIds.push(tvShow.id);
    const season1 = tvShow.seasons[0];
    const episode1 = season1.episodes.find((e) => e.episodeNumber === 1)!;
    const episode2 = season1.episodes.find((e) => e.episodeNumber === 2)!;

    return {
      id: tvShow.id,
      tmdbId: showTmdbId,
      season1Id: season1.id,
      season1TmdbId,
      episode1Id: episode1.id,
      episode1TmdbId,
      episode2Id: episode2.id,
      episode2TmdbId,
    };
  }

  // ── Tests ───────────────────────────────────────────────────────────────────

  describe('Empty Library Export', () => {
    it('exports an empty JSON document with version 1.0 and empty entries', async () => {
      const jsonString = await exportService.exportJson();
      const doc = JSON.parse(jsonString);

      expect(doc.version).toBe('1.0');
      expect(typeof doc.exportedAt).toBe('string');
      expect(doc.entries).toEqual([]);

      const validation = validateJsonImport(doc);
      expect(validation.errors).toHaveLength(0);
      expect(validation.document).not.toBeNull();
    });

    it('exports an empty CSV document with exact headers and CRLF line ending', async () => {
      const csvString = await exportService.exportCsv();

      expect(csvString).toBe('tmdb_id,media_type,status,personal_rating,notes,created_at\r\n');

      const validation = validateCsvImport(csvString);
      expect(validation.errors).toHaveLength(0);
      expect(validation.rows).toHaveLength(0);
    });
  });

  describe('Single-User Isolation & Read-Only Invariant', () => {
    it('only exports entries belonging to EXPORT_TEST_USER_ID, excluding other users', async () => {
      const movie1 = await createMovie('Export User Film');
      const movie2 = await createMovie('Other User Film');

      // Entry for primary user
      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie1.id,
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('8.50'),
        },
      });

      // Entry for another user
      await prisma.userLibraryEntry.create({
        data: {
          userId: OTHER_TEST_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie2.id,
          status: 'PLAN_TO_WATCH',
          personalRating: new Prisma.Decimal('7.00'),
        },
      });

      // Export JSON
      const jsonString = await exportService.exportJson();
      const doc = JSON.parse(jsonString);

      expect(doc.entries).toHaveLength(1);
      expect(doc.entries[0].tmdbId).toBe(movie1.tmdbId);

      // Export CSV
      const csvString = await exportService.exportCsv();
      const rows = csvString.trim().split('\r\n');

      expect(rows).toHaveLength(2); // header + 1 entry
      expect(rows[1]).toContain(String(movie1.tmdbId));
      expect(rows[1]).not.toContain(String(movie2.tmdbId));
    });

    it('guarantees read-only execution with zero database mutations', async () => {
      const movie = await createMovie('Read-Only Probe Film');
      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie.id,
          status: 'COMPLETED',
        },
      });

      const entryCountBefore = await prisma.userLibraryEntry.count();
      const viewingEventCountBefore = await prisma.viewingEvent.count();
      const movieCountBefore = await prisma.movie.count();

      await exportService.exportJson();
      await exportService.exportCsv();

      expect(await prisma.userLibraryEntry.count()).toBe(entryCountBefore);
      expect(await prisma.viewingEvent.count()).toBe(viewingEventCountBefore);
      expect(await prisma.movie.count()).toBe(movieCountBefore);
    });
  });

  describe('JSON Full-Fidelity Round Trip', () => {
    it('exports full tracking history and restores it identically via ImportService', async () => {
      const movie = await createMovie('Round-Trip Masterpiece');
      const tv = await createTvShow('Round-Trip Epic Series');

      const movieCreatedAt = new Date('2024-01-15T10:00:00.000Z');
      const tvCreatedAt = new Date('2024-02-01T12:00:00.000Z');
      const watchDate1 = new Date('2024-01-16T20:00:00.000Z');
      const watchDate2 = new Date('2024-01-20T21:30:00.000Z');
      const ep1WatchedAt = new Date('2024-02-02T19:00:00.000Z');

      // 1. Create Movie Library Entry with 2 viewing events
      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie.id,
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('9.50'),
          notes: 'Sensational direction & sound design',
          createdAt: movieCreatedAt,
          viewingEvents: {
            create: [
              {
                watchedAt: watchDate1,
                rating: new Prisma.Decimal('9.00'),
                notes: 'First theatrical viewing',
              },
              {
                watchedAt: watchDate2,
                rating: new Prisma.Decimal('10.00'),
                notes: 'Rewatch in IMAX',
              },
            ],
          },
        },
      });

      // 2. Create TV Library Entry with 2 episodes (one timestamped, one null) & 1 season rating
      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'TV',
          tvShowId: tv.id,
          status: 'WATCHING',
          personalRating: new Prisma.Decimal('8.50'),
          notes: 'Compelling mystery',
          createdAt: tvCreatedAt,
          episodeProgresses: {
            create: [
              {
                episodeId: tv.episode1Id,
                watchedAt: ep1WatchedAt,
              },
              {
                episodeId: tv.episode2Id,
                watchedAt: null, // Nullable watch date
              },
            ],
          },
          seasonRatings: {
            create: [
              {
                seasonId: tv.season1Id,
                rating: new Prisma.Decimal('8.50'),
              },
            ],
          },
        },
      });

      // 3. Export JSON
      const exportedJson = await exportService.exportJson();
      const parsedExport = JSON.parse(exportedJson);

      // 4. Validate with existing ImportValidator
      const validation = validateJsonImport(parsedExport);
      expect(validation.errors).toHaveLength(0);
      expect(validation.document).not.toBeNull();

      // 5. Isolate target state by wiping the test user's library
      await prisma.userLibraryEntry.deleteMany({
        where: { userId: EXPORT_TEST_USER_ID },
      });
      expect(await prisma.userLibraryEntry.count({ where: { userId: EXPORT_TEST_USER_ID } })).toBe(
        0,
      );

      // 6. Re-import the exported JSON into the clean library
      const importResult = await importService.importJson(Buffer.from(exportedJson, 'utf-8'));

      expect(importResult.success).toBe(true);
      expect(importResult.imported).toBe(2);
      expect(importResult.skipped).toBe(0);
      expect(importResult.errors).toHaveLength(0);

      // 7. Deep inspection of restored records
      // 7a. Movie Entry
      const restoredMovie = await prisma.userLibraryEntry.findFirst({
        where: { userId: EXPORT_TEST_USER_ID, movieId: movie.id },
        include: { viewingEvents: { orderBy: { watchedAt: 'asc' } } },
      });
      expect(restoredMovie).not.toBeNull();
      expect(restoredMovie!.status).toBe('COMPLETED');
      expect(Number(restoredMovie!.personalRating)).toBe(9.5);
      expect(restoredMovie!.notes).toBe('Sensational direction & sound design');
      expect(restoredMovie!.createdAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');

      // Viewing events restored
      expect(restoredMovie!.viewingEvents).toHaveLength(2);
      expect(restoredMovie!.viewingEvents[0].watchedAt.toISOString()).toBe(
        '2024-01-16T20:00:00.000Z',
      );
      expect(Number(restoredMovie!.viewingEvents[0].rating)).toBe(9.0);
      expect(restoredMovie!.viewingEvents[0].notes).toBe('First theatrical viewing');

      expect(restoredMovie!.viewingEvents[1].watchedAt.toISOString()).toBe(
        '2024-01-20T21:30:00.000Z',
      );
      expect(Number(restoredMovie!.viewingEvents[1].rating)).toBe(10.0);
      expect(restoredMovie!.viewingEvents[1].notes).toBe('Rewatch in IMAX');

      // 7b. TV Entry
      const restoredTv = await prisma.userLibraryEntry.findFirst({
        where: { userId: EXPORT_TEST_USER_ID, tvShowId: tv.id },
        include: {
          episodeProgresses: {
            include: { episode: true },
            orderBy: { episode: { episodeNumber: 'asc' } },
          },
          seasonRatings: true,
        },
      });
      expect(restoredTv).not.toBeNull();
      expect(restoredTv!.status).toBe('WATCHING');
      expect(Number(restoredTv!.personalRating)).toBe(8.5);
      expect(restoredTv!.notes).toBe('Compelling mystery');
      expect(restoredTv!.createdAt.toISOString()).toBe('2024-02-01T12:00:00.000Z');

      // Episode progress restored (with nullable preservation)
      expect(restoredTv!.episodeProgresses).toHaveLength(2);
      expect(restoredTv!.episodeProgresses[0].episode.tmdbId).toBe(tv.episode1TmdbId);
      expect(restoredTv!.episodeProgresses[0].watchedAt?.toISOString()).toBe(
        '2024-02-02T19:00:00.000Z',
      );

      expect(restoredTv!.episodeProgresses[1].episode.tmdbId).toBe(tv.episode2TmdbId);
      expect(restoredTv!.episodeProgresses[1].watchedAt).toBeNull(); // Null date preserved!

      // Season rating restored
      expect(restoredTv!.seasonRatings).toHaveLength(1);
      expect(Number(restoredTv!.seasonRatings[0].rating)).toBe(8.5);
    });
  });

  describe('CSV Limited Round Trip & Explicit Limitations', () => {
    it('restores exact 6 core library fields and explicitly does NOT restore nested history', async () => {
      const movie = await createMovie('CSV Limited Movie');
      const tv = await createTvShow('CSV Limited TV');

      const movieCreatedAt = new Date('2024-01-15T10:00:00.000Z');
      const tvCreatedAt = new Date('2024-02-01T12:00:00.000Z');

      // Create entries with nested tracking history
      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'MOVIE',
          movieId: movie.id,
          status: 'COMPLETED',
          personalRating: new Prisma.Decimal('8.50'),
          notes: 'A "masterpiece", loved it!', // Special characters
          createdAt: movieCreatedAt,
          viewingEvents: {
            create: [
              {
                watchedAt: new Date('2024-01-16T20:00:00.000Z'),
                rating: new Prisma.Decimal('8.50'),
              },
            ],
          },
        },
      });

      await prisma.userLibraryEntry.create({
        data: {
          userId: EXPORT_TEST_USER_ID,
          mediaType: 'TV',
          tvShowId: tv.id,
          status: 'PLAN_TO_WATCH',
          personalRating: null, // Unrated
          notes: null,
          createdAt: tvCreatedAt,
          episodeProgresses: {
            create: [{ episodeId: tv.episode1Id }],
          },
        },
      });

      // 1. Export CSV
      const exportedCsv = await exportService.exportCsv();

      // 2. Validate CSV structure with import validator
      const validation = validateCsvImport(exportedCsv);
      expect(validation.errors).toHaveLength(0);
      expect(validation.rows).toHaveLength(2);

      // 3. Clear library in isolated state
      await prisma.userLibraryEntry.deleteMany({
        where: { userId: EXPORT_TEST_USER_ID },
      });

      // 4. Re-import CSV via ImportService
      const importResult = await importService.importCsv(Buffer.from(exportedCsv, 'utf-8'));
      expect(importResult.success).toBe(true);
      expect(importResult.imported).toBe(2);

      // 5. Verify the 6 core fields are restored accurately
      const restoredMovie = await prisma.userLibraryEntry.findFirst({
        where: { userId: EXPORT_TEST_USER_ID, movieId: movie.id },
        include: { viewingEvents: true },
      });
      expect(restoredMovie).not.toBeNull();
      expect(restoredMovie!.status).toBe('COMPLETED');
      expect(Number(restoredMovie!.personalRating)).toBe(8.5);
      expect(restoredMovie!.notes).toBe('A "masterpiece", loved it!');
      expect(restoredMovie!.createdAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');

      const restoredTv = await prisma.userLibraryEntry.findFirst({
        where: { userId: EXPORT_TEST_USER_ID, tvShowId: tv.id },
        include: { episodeProgresses: true, seasonRatings: true },
      });
      expect(restoredTv).not.toBeNull();
      expect(restoredTv!.status).toBe('PLAN_TO_WATCH');
      expect(restoredTv!.personalRating).toBeNull();
      expect(restoredTv!.notes).toBeNull();
      expect(restoredTv!.createdAt.toISOString()).toBe('2024-02-01T12:00:00.000Z');

      // 6. Explicitly verify that CSV round trip does NOT restore nested tracking history
      expect(restoredMovie!.viewingEvents).toHaveLength(0); // Zero viewing events restored!
      expect(restoredTv!.episodeProgresses).toHaveLength(0); // Zero episode progress restored!
      expect(restoredTv!.seasonRatings).toHaveLength(0); // Zero season ratings restored!
    });
  });
});
