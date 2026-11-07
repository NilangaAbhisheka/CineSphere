/**
 * phase3-prisma-errors.integration.spec.ts
 *
 * Stage 3.3.D — Prisma 6.19.3 Live Database Error Structure Verification Experiments.
 * Empirically discovers and documents the exact JavaScript error class, error code,
 * meta payload, and message structure for:
 *   E-1: Unique constraint violation (23505)
 *   E-2: Trigger-raised exception (P0001)
 *   E-2b: Trigger-raised exception via $executeRaw
 *   E-3: CHECK constraint violation (23514)
 *   E-4: Foreign-key constraint violation (23503)
 *   E-5: Deadlock / Serialization failure (40P01 / 40001)
 */

import { PrismaClient, Prisma, MediaType, LibraryStatus } from '@prisma/client';
import { Client } from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public';

const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL } },
});

let _counter = 600_000_000 + Math.floor(Math.random() * 50_000_000);
function uniqueTmdbId(): number {
  return ++_counter;
}

export interface ObservedPrismaError {
  experiment: string;
  operation: string;
  constructorName: string;
  code?: string;
  meta?: unknown;
  message: string;
  databaseErrorCode?: string;
}

interface GenericErrorRecord {
  constructor: { name: string };
  code?: string;
  meta?: Record<string, unknown>;
  message: string;
}

export const observedErrors: Record<string, ObservedPrismaError> = {};

describe('Stage 3.3.D — Prisma 6.19.3 Error Structure Experiments', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-1: Unique Constraint Violation (PostgreSQL 23505)
  // ────────────────────────────────────────────────────────────────────────────
  it('E-1: Inspects Prisma error on Unique Constraint Violation (23505)', async () => {
    const user = await prisma.user.create({ data: { displayName: 'E-1 User' } });
    const show = await prisma.tvShow.create({ data: { tmdbId: uniqueTmdbId(), name: 'E-1 Show' } });
    const season = await prisma.season.create({ data: { tmdbId: uniqueTmdbId(), seasonNumber: 1, tvShowId: show.id } });
    const ule = await prisma.userLibraryEntry.create({
      data: {
        userId: user.id,
        mediaType: MediaType.TV,
        tvShowId: show.id,
        status: LibraryStatus.WATCHING,
      },
    });

    // First insert succeeds
    await prisma.seasonRating.create({
      data: {
        libraryEntryId: ule.id,
        seasonId: season.id,
        rating: new Prisma.Decimal('8.00'),
      },
    });

    let caughtError: unknown;
    try {
      // Second insert with same (libraryEntryId, seasonId) triggers unique violation
      await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: season.id,
          rating: new Prisma.Decimal('9.00'),
        },
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as GenericErrorRecord;

    const record: ObservedPrismaError = {
      experiment: 'E-1: Unique Constraint Violation (23505)',
      operation: 'prisma.seasonRating.create(duplicate)',
      constructorName: err.constructor.name,
      code: err.code,
      meta: err.meta,
      message: err.message,
    };
    observedErrors['E-1'] = record;

    console.log('\n--- Observed E-1 Error ---');
    console.log('Constructor:', record.constructorName);
    console.log('Code:', record.code);
    console.log('Meta:', JSON.stringify(record.meta, null, 2));
    console.log('Message snippet:', record.message.slice(0, 200));

    expect(caughtError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err.code).toBe('P2002');
    expect(err.meta?.target).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-2: Trigger-Raised Exception (PostgreSQL P0001) via Model API
  // ────────────────────────────────────────────────────────────────────────────
  it('E-2: Inspects Prisma error on Trigger-Raised Exception (P0001)', async () => {
    const user = await prisma.user.create({ data: { displayName: 'E-2 User' } });
    const show1 = await prisma.tvShow.create({ data: { tmdbId: uniqueTmdbId(), name: 'E-2 Show 1' } });
    const show2 = await prisma.tvShow.create({ data: { tmdbId: uniqueTmdbId(), name: 'E-2 Show 2' } });
    const season2 = await prisma.season.create({ data: { tmdbId: uniqueTmdbId(), seasonNumber: 1, tvShowId: show2.id } });
    const episode2 = await prisma.episode.create({ data: { tmdbId: uniqueTmdbId(), episodeNumber: 1, seasonId: season2.id } });

    // ULE is for show1
    const ule = await prisma.userLibraryEntry.create({
      data: {
        userId: user.id,
        mediaType: MediaType.TV,
        tvShowId: show1.id,
        status: LibraryStatus.WATCHING,
      },
    });

    let caughtError: unknown;
    try {
      // episode2 belongs to show2, which does not match ule (show1) -> trigger raises P0001
      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: episode2.id,
        },
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as GenericErrorRecord;

    const record: ObservedPrismaError = {
      experiment: 'E-2: Trigger-Raised Exception (P0001)',
      operation: 'prisma.episodeProgress.create(mismatched TV show)',
      constructorName: err.constructor.name,
      code: err.code,
      meta: err.meta,
      message: err.message,
    };
    observedErrors['E-2'] = record;

    console.log('\n--- Observed E-2 Error ---');
    console.log('Constructor:', record.constructorName);
    console.log('Code:', record.code);
    console.log('Meta:', JSON.stringify(record.meta, null, 2));
    console.log('Message snippet:', record.message.slice(0, 300));

    expect(caughtError).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect(err.message).toContain('P0001');
    expect(err.message).toContain('tracks tvShow');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-2b: Trigger-Raised Exception via $executeRaw
  // ────────────────────────────────────────────────────────────────────────────
  it('E-2b: Inspects Prisma error on Trigger-Raised Exception via $executeRaw', async () => {
    const user = await prisma.user.create({ data: { displayName: 'E-2b User' } });
    const show1 = await prisma.tvShow.create({ data: { tmdbId: uniqueTmdbId(), name: 'E-2b Show 1' } });
    const show2 = await prisma.tvShow.create({ data: { tmdbId: uniqueTmdbId(), name: 'E-2b Show 2' } });
    const season2 = await prisma.season.create({ data: { tmdbId: uniqueTmdbId(), seasonNumber: 1, tvShowId: show2.id } });
    const episode2 = await prisma.episode.create({ data: { tmdbId: uniqueTmdbId(), episodeNumber: 1, seasonId: season2.id } });

    const ule = await prisma.userLibraryEntry.create({
      data: {
        userId: user.id,
        mediaType: MediaType.TV,
        tvShowId: show1.id,
        status: LibraryStatus.WATCHING,
      },
    });

    let caughtError: unknown;
    try {
      await prisma.$executeRaw`INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES (${ule.id}::uuid, ${episode2.id}::uuid)`;
    } catch (e: unknown) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as GenericErrorRecord;

    console.log('\n--- Observed E-2b ($executeRaw) Error ---');
    console.log('Constructor:', err.constructor.name);
    console.log('Code:', err.code);
    console.log('Meta:', JSON.stringify(err.meta, null, 2));
    console.log('Message snippet:', err.message.slice(0, 300));

    expect(err.code).toBe('P2010');
    expect(err.meta?.code).toBe('P0001');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-3: CHECK Constraint Violation (PostgreSQL 23514)
  // ────────────────────────────────────────────────────────────────────────────
  it('E-3: Inspects Prisma error on CHECK Constraint Violation (23514)', async () => {
    const user = await prisma.user.create({ data: { displayName: 'E-3 User' } });
    const movie = await prisma.movie.create({ data: { tmdbId: uniqueTmdbId(), title: 'E-3 Movie' } });

    let caughtError: unknown;
    try {
      // personalRating 7.24 violates half-step CHECK constraint
      await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
          personalRating: new Prisma.Decimal('7.24'),
        },
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as GenericErrorRecord;

    const record: ObservedPrismaError = {
      experiment: 'E-3: CHECK Constraint Violation (23514)',
      operation: 'prisma.userLibraryEntry.create(invalid rating 7.24)',
      constructorName: err.constructor.name,
      code: err.code,
      meta: err.meta,
      message: err.message,
    };
    observedErrors['E-3'] = record;

    console.log('\n--- Observed E-3 Error ---');
    console.log('Constructor:', record.constructorName);
    console.log('Code:', record.code);
    console.log('Meta:', JSON.stringify(record.meta, null, 2));
    console.log('Message snippet:', record.message.slice(0, 300));

    expect(caughtError).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect(err.message).toContain('chk_user_library_entries_personal_rating_half_step');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-4: Foreign-Key Violation (PostgreSQL 23503)
  // ────────────────────────────────────────────────────────────────────────────
  it('E-4: Inspects Prisma error on Foreign-Key Constraint Violation (23503)', async () => {
    const user = await prisma.user.create({ data: { displayName: 'E-4 User' } });
    const nonExistentUuid = '00000000-0000-0000-0000-000000000000';

    let caughtError: unknown;
    try {
      // References non-existent movieId
      await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: nonExistentUuid,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as GenericErrorRecord;

    const record: ObservedPrismaError = {
      experiment: 'E-4: Foreign-Key Violation (23503)',
      operation: 'prisma.userLibraryEntry.create(non-existent movieId)',
      constructorName: err.constructor.name,
      code: err.code,
      meta: err.meta,
      message: err.message,
    };
    observedErrors['E-4'] = record;

    console.log('\n--- Observed E-4 Error ---');
    console.log('Constructor:', record.constructorName);
    console.log('Code:', record.code);
    console.log('Meta:', JSON.stringify(record.meta, null, 2));
    console.log('Message snippet:', record.message.slice(0, 200));

    expect(caughtError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err.code).toBe('P2003');
    expect(err.meta?.constraint).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // E-5: Deadlock / Serialization Failure (PostgreSQL 40P01)
  // ────────────────────────────────────────────────────────────────────────────
  it('E-5: Inspects error on deliberate PostgreSQL Deadlock (40P01)', async () => {
    // Create two test users to cross-lock
    const u1 = await prisma.user.create({ data: { displayName: 'Deadlock User 1' } });
    const u2 = await prisma.user.create({ data: { displayName: 'Deadlock User 2' } });

    const clientA = new Client({ connectionString: DB_URL });
    const clientB = new Client({ connectionString: DB_URL });
    await Promise.all([clientA.connect(), clientB.connect()]);

    let deadlockError: unknown;

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Tx A locks User 1
      await clientA.query('SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE', [u1.id]);

      // Tx B locks User 2
      await clientB.query('SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE', [u2.id]);

      // Tx A tries to lock User 2 (blocks waiting for Tx B)
      const aLocksB = clientA.query('SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE', [u2.id]);

      // Give PostgreSQL a moment to register Tx A's wait
      await new Promise((r) => setTimeout(r, 50));

      // Tx B tries to lock User 1 (creates circular wait: A waits for B, B waits for A)
      const bLocksA = clientB.query('SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE', [u1.id]);

      // One of the two queries will be aborted by PostgreSQL deadlock detector!
      const results = await Promise.allSettled([aLocksB, bLocksA]);

      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      if (rejected) {
        deadlockError = rejected.reason;
      }
    } finally {
      try { await clientA.query('ROLLBACK'); } catch { /* ignore */ }
      try { await clientB.query('ROLLBACK'); } catch { /* ignore */ }
      await clientA.end();
      await clientB.end();
    }

    expect(deadlockError).toBeDefined();
    const dErr = deadlockError as GenericErrorRecord;

    const record: ObservedPrismaError = {
      experiment: 'E-5: Deadlock (40P01)',
      operation: 'Two concurrent transactions cross-locking User 1 and User 2',
      constructorName: dErr.constructor.name,
      code: dErr.code,
      message: dErr.message,
      databaseErrorCode: dErr.code,
    };
    observedErrors['E-5'] = record;

    console.log('\n--- Observed E-5 Error ---');
    console.log('Constructor:', record.constructorName);
    console.log('PostgreSQL SQLSTATE code:', dErr.code);
    console.log('Message snippet:', dErr.message);

    expect(dErr.code).toBe('40P01');
    expect(dErr.message).toContain('deadlock detected');
  });
});
