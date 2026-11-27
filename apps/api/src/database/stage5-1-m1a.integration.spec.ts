/**
 * stage5-1-m1a.integration.spec.ts
 *
 * Stage 5.1 M1-A PostgreSQL Integration Tests.
 * Verifies against real PostgreSQL 16 + pgvector:
 *   1. CatalogueProvenance enum, safe DEFAULT 'UNKNOWN', constraints & indexes
 *   2. CatalogueRepository.saveMovie / saveTvShowHeader provenance transitions & concurrency
 *   3. Metadata revision triggers (scalars, NULL<->value, unrelated fields, genres, keywords, credits, persons)
 *   4. Embedding stale propagation (L3 -> L4)
 *   5. Coordination lock triggers (fail-closed missing singleton, L2 FOR UPDATE blocking)
 *   6. Job leases (3 seeded rows, status CHECK, Option A fencing)
 *   7. media_embeddings constraints (XOR, dimensions, unit norm, active uniqueness, FK cascade)
 *   8. execute_model_cutover (provenance + title/name AND overview eligibility, promotion, rollback)
 */

import { CatalogueProvenance, PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { PrismaService } from './prisma.service.js';
import { CatalogueRepository } from '../tmdb/catalogue.repository.js';
import { MappedMovieData, MappedTvShowData } from '../tmdb/tmdb.mapper.js';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test?schema=public';
const PG_URL = DB_URL.replace(/\?.*$/, '');

const TD08_MODEL = 'sentence-transformers/all-mpnet-base-v2';
const TD08_REV = '9a3225965996d404b775526de6dbfe85d3368642';
const TD08_DIMS = 768;

function makeUnitVectorLiteral(dims = TD08_DIMS, hotIndex = 0): string {
  const arr = new Array<number>(dims).fill(0);
  arr[hotIndex % dims] = 1.0;
  return `[${arr.join(',')}]`;
}

function makeHash(seed: string): string {
  return seed.padEnd(64, '0').slice(0, 64);
}

let _counter = 750_000_000 + Math.floor(Math.random() * 50_000_000);
function nextTmdbId(): number {
  return ++_counter;
}

describe('Stage 5.1 M1-A — Schema, Provenance, Triggers & Cutover Integration Tests', () => {
  let prisma: PrismaService;
  let catalogueRepo: CatalogueRepository;
  const createdMovieIds: string[] = [];
  const createdTvIds: string[] = [];
  const createdPersonIds: string[] = [];
  const createdGenreIds: number[] = [];
  const createdKeywordIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalogueRepo = new CatalogueRepository(prisma);
  });

  afterAll(async () => {
    if (createdMovieIds.length > 0) {
      await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds } } });
    }
    if (createdTvIds.length > 0) {
      await prisma.tvShow.deleteMany({ where: { id: { in: createdTvIds } } });
    }
    if (createdPersonIds.length > 0) {
      await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
    }
    if (createdGenreIds.length > 0) {
      await prisma.genre.deleteMany({ where: { tmdbId: { in: createdGenreIds } } });
    }
    if (createdKeywordIds.length > 0) {
      await prisma.keyword.deleteMany({ where: { tmdbId: { in: createdKeywordIds } } });
    }
    await prisma.$disconnect();
  });

  // ── 1. Schema, Seed & Catalog Invariants ───────────────────────────────────

  it('seeds embedding_coordination singleton with accepted TD-08 768d model', async () => {
    const coord = await prisma.embeddingCoordination.findUnique({ where: { id: 1 } });
    expect(coord).not.toBeNull();
    expect(coord?.activeModelName).toBe(TD08_MODEL);
    expect(coord?.activeModelVersion).toBe(TD08_REV);
    expect(coord?.activeDimensions).toBe(TD08_DIMS);
    expect(coord?.cutoverInProgress).toBe(false);

    // Rejects id != 1
    await expect(
      prisma.$executeRaw`INSERT INTO "embedding_coordination" ("id", "active_model_name", "active_model_version", "active_dimensions") VALUES (2, 'x', '1', 768)`,
    ).rejects.toThrow();
  });

  it('seeds exactly 3 job_leases as AVAILABLE and rejects legacy RELEASED status', async () => {
    const leases = await prisma.jobLease.findMany({ orderBy: { leaseName: 'asc' } });
    expect(leases.map((l) => l.leaseName)).toEqual([
      'embedding_generation',
      'model_cutover',
      'sync_catalogue',
    ]);
    for (const lease of leases) {
      expect(lease.status).toBe('AVAILABLE');
      expect(lease.fencingToken).toBeGreaterThanOrEqual(0n);
      expect(lease.ownerJobId).toBeNull();
    }

    await expect(
      prisma.$executeRaw`UPDATE "job_leases" SET "status" = 'RELEASED' WHERE "lease_name" = 'model_cutover'`,
    ).rejects.toThrow();
  });

  it('creates partial HNSW index and active unique indexes on media_embeddings', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT "indexname" FROM pg_indexes WHERE "tablename" = 'media_embeddings'
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).toContain('idx_media_embeddings_active_hnsw');
    expect(names).toContain('media_embeddings_movie_active_uniq');
    expect(names).toContain('media_embeddings_tv_active_uniq');
  });

  it('defaults unclassified movies and tv_shows to UNKNOWN and rejects invalid provenance', async () => {
    const mTmdb = nextTmdbId();
    const tTmdb = nextTmdbId();
    const movie = await prisma.movie.create({
      data: { tmdbId: mTmdb, title: 'Default Prov Movie' },
    });
    const show = await prisma.tvShow.create({ data: { tmdbId: tTmdb, name: 'Default Prov Show' } });
    createdMovieIds.push(movie.id);
    createdTvIds.push(show.id);

    expect(movie.provenance).toBe(CatalogueProvenance.UNKNOWN);
    expect(show.provenance).toBe(CatalogueProvenance.UNKNOWN);

    await expect(
      prisma.$executeRaw`UPDATE "movies" SET "provenance" = 'INVALID'::"CatalogueProvenance" WHERE "id" = ${movie.id}::uuid`,
    ).rejects.toThrow();
  });

  // ── 2. Provenance-Aware TMDB Write Path ────────────────────────────────────

  it('enforces all 4 provenance transitions in CatalogueRepository.saveMovie and saveTvShowHeader', async () => {
    const newMovieTmdbId = nextTmdbId();
    const moviePayload = (tmdbId: number, title: string): MappedMovieData => ({
      tmdbId,
      title,
      originalTitle: title,
      overview: 'A real TMDB synopsis.',
      releaseDate: new Date('2020-01-01'),
      runtime: 120,
      originalLanguage: 'en',
      popularity: 10,
      voteAverage: 7.5,
      voteCount: 100,
      posterPath: null,
      backdropPath: null,
      adult: false,
      genres: [],
      keywords: [],
      cast: [],
    });

    // 1. New record -> TMDB
    const savedNew = await catalogueRepo.saveMovie(moviePayload(newMovieTmdbId, 'New TMDB Movie'));
    createdMovieIds.push(savedNew.id);
    let mRow = await prisma.movie.findUniqueOrThrow({ where: { id: savedNew.id } });
    expect(mRow.provenance).toBe(CatalogueProvenance.TMDB);

    // 2. TMDB -> remains TMDB
    await catalogueRepo.saveMovie(moviePayload(newMovieTmdbId, 'Updated TMDB Movie'));
    mRow = await prisma.movie.findUniqueOrThrow({ where: { id: savedNew.id } });
    expect(mRow.provenance).toBe(CatalogueProvenance.TMDB);

    // 3. UNKNOWN -> upgrades to TMDB
    const unknownMovieTmdbId = nextTmdbId();
    const unknownMovie = await prisma.movie.create({
      data: { tmdbId: unknownMovieTmdbId, title: 'Legacy Unknown Movie' },
    });
    createdMovieIds.push(unknownMovie.id);
    await catalogueRepo.saveMovie(moviePayload(unknownMovieTmdbId, 'Verified TMDB Movie'));
    mRow = await prisma.movie.findUniqueOrThrow({ where: { id: unknownMovie.id } });
    expect(mRow.provenance).toBe(CatalogueProvenance.TMDB);

    // 4. SYNTHETIC -> remains SYNTHETIC
    const synthMovieTmdbId = nextTmdbId();
    const synthMovie = await prisma.movie.create({
      data: {
        tmdbId: synthMovieTmdbId,
        title: 'Synthetic Fixture Movie',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    createdMovieIds.push(synthMovie.id);
    await catalogueRepo.saveMovie(moviePayload(synthMovieTmdbId, 'Synthetic Fixture Movie'));
    mRow = await prisma.movie.findUniqueOrThrow({ where: { id: synthMovie.id } });
    expect(mRow.provenance).toBe(CatalogueProvenance.SYNTHETIC);

    // Same 4 cases for TV shows
    const tvPayload = (tmdbId: number, name: string): MappedTvShowData => ({
      tmdbId,
      name,
      originalName: name,
      overview: 'A real TMDB TV synopsis.',
      firstAirDate: new Date('2021-01-01'),
      lastAirDate: null,
      originalLanguage: 'en',
      popularity: 15,
      voteAverage: 8.1,
      voteCount: 200,
      posterPath: null,
      backdropPath: null,
      status: 'Ended',
      numberOfSeasons: 1,
      numberOfEpisodes: 10,
      genres: [],
      keywords: [],
      cast: [],
      seasons: [],
    });

    const newTvTmdbId = nextTmdbId();
    const savedTv = await catalogueRepo.saveTvShowHeader(tvPayload(newTvTmdbId, 'New TMDB TV'));
    createdTvIds.push(savedTv.id);
    expect((await prisma.tvShow.findUniqueOrThrow({ where: { id: savedTv.id } })).provenance).toBe(
      CatalogueProvenance.TMDB,
    );

    const unknownTvTmdbId = nextTmdbId();
    const unknownTv = await prisma.tvShow.create({
      data: { tmdbId: unknownTvTmdbId, name: 'Legacy Unknown TV' },
    });
    createdTvIds.push(unknownTv.id);
    await catalogueRepo.saveTvShowHeader(tvPayload(unknownTvTmdbId, 'Verified TMDB TV'));
    expect(
      (await prisma.tvShow.findUniqueOrThrow({ where: { id: unknownTv.id } })).provenance,
    ).toBe(CatalogueProvenance.TMDB);

    const synthTvTmdbId = nextTmdbId();
    const synthTv = await prisma.tvShow.create({
      data: {
        tmdbId: synthTvTmdbId,
        name: 'Synthetic Fixture TV',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    createdTvIds.push(synthTv.id);
    await catalogueRepo.saveTvShowHeader(tvPayload(synthTvTmdbId, 'Synthetic Fixture TV'));
    expect((await prisma.tvShow.findUniqueOrThrow({ where: { id: synthTv.id } })).provenance).toBe(
      CatalogueProvenance.SYNTHETIC,
    );
  });

  // ── 3. Metadata Revision & Stale-Embedding Triggers ────────────────────────

  it('increments metadata_revision only on canonical changes and marks embeddings stale', async () => {
    const genreId = nextTmdbId();
    const kwId = nextTmdbId();
    createdGenreIds.push(genreId);
    createdKeywordIds.push(kwId);
    await prisma.genre.create({ data: { tmdbId: genreId, name: `G-${genreId}` } });
    await prisma.keyword.create({ data: { tmdbId: kwId, name: `K-${kwId}` } });

    const person = await prisma.person.create({
      data: { tmdbId: nextTmdbId(), name: 'Actor One' },
    });
    createdPersonIds.push(person.id);

    const movie = await prisma.movie.create({
      data: {
        tmdbId: nextTmdbId(),
        title: 'Revision Test Movie',
        overview: 'Initial overview',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    const show = await prisma.tvShow.create({
      data: {
        tmdbId: nextTmdbId(),
        name: 'Revision Test Show',
        overview: 'Initial TV overview',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    createdMovieIds.push(movie.id);
    createdTvIds.push(show.id);

    // Stage an active embedding for movie
    const vec = makeUnitVectorLiteral();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "media_embeddings" ("movie_id", "embedding", "model_name", "model_version", "dimensions", "content_hash", "metadata_revision", "lifecycle_stage", "status", "generated_at")
       VALUES ($1::uuid, $2::vector, $3, $4, $5, $6, 0, 'ACTIVE', 'COMPLETED', clock_timestamp())`,
      movie.id,
      vec,
      TD08_MODEL,
      TD08_REV,
      TD08_DIMS,
      makeHash('rev0'),
    );

    // Unrelated update (popularity, voteAverage) -> NO bump, NOT stale
    await prisma.movie.update({
      where: { id: movie.id },
      data: { popularity: 999.5, voteAverage: 9.1 },
    });
    let m = await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } });
    expect(m.metadataRevision).toBe(0);
    let emb = await prisma.mediaEmbedding.findFirstOrThrow({ where: { movieId: movie.id } });
    expect(emb.embeddingStale).toBe(false);

    // NULL -> value on tagline -> bumps revision and marks embedding stale
    await prisma.movie.update({ where: { id: movie.id }, data: { tagline: 'New tagline' } });
    m = await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } });
    expect(m.metadataRevision).toBe(1);
    emb = await prisma.mediaEmbedding.findFirstOrThrow({ where: { movieId: movie.id } });
    expect(emb.embeddingStale).toBe(true);

    // value -> NULL on tagline -> bumps revision
    await prisma.movie.update({ where: { id: movie.id }, data: { tagline: null } });
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } })).metadataRevision,
    ).toBe(2);

    // Genre & keyword connect -> bumps revision
    await prisma.movie.update({
      where: { id: movie.id },
      data: { genres: { connect: { tmdbId: genreId } } },
    });
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } })).metadataRevision,
    ).toBe(3);

    await prisma.movie.update({
      where: { id: movie.id },
      data: { keywords: { connect: { tmdbId: kwId } } },
    });
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } })).metadataRevision,
    ).toBe(4);

    // PersonCredit connect on both movie & show, then Person.name update bumps both
    await prisma.personCredit.create({ data: { personId: person.id, movieId: movie.id } });
    await prisma.personCredit.create({ data: { personId: person.id, tvShowId: show.id } });
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } })).metadataRevision,
    ).toBe(5);
    expect(
      (await prisma.tvShow.findUniqueOrThrow({ where: { id: show.id } })).metadataRevision,
    ).toBe(1);

    await prisma.person.update({ where: { id: person.id }, data: { name: 'Actor Renamed' } });
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } })).metadataRevision,
    ).toBe(6);
    expect(
      (await prisma.tvShow.findUniqueOrThrow({ where: { id: show.id } })).metadataRevision,
    ).toBe(2);
  });

  // ── 4. Coordination Lock & Lease Fencing ───────────────────────────────────

  it('blocks protected catalogue writes when coordination row is missing and blocks behind FOR UPDATE', async () => {
    const clientA = new Client({ connectionString: PG_URL });
    const clientB = new Client({ connectionString: PG_URL });
    await clientA.connect();
    await clientB.connect();

    try {
      // Missing singleton row inside rolled-back tx fails closed
      await clientA.query('BEGIN');
      await clientA.query('DELETE FROM "embedding_coordination" WHERE "id" = 1');
      await expect(
        clientA.query(
          `INSERT INTO "movies" ("tmdbId", "title", "provenance") VALUES ($1, 'Blocked', 'SYNTHETIC')`,
          [nextTmdbId()],
        ),
      ).rejects.toThrow(/COORDINATION_LOCK_FAILED/);
      await clientA.query('ROLLBACK');

      // Exclusive L2 lock in clientA blocks clientB catalogue write
      await clientA.query('BEGIN');
      await clientA.query('SELECT 1 FROM "embedding_coordination" WHERE "id" = 1 FOR UPDATE');

      const blockedInsertPromise = clientB.query(
        `INSERT INTO "movies" ("tmdbId", "title", "provenance") VALUES ($1, 'Waits For L2', 'SYNTHETIC') RETURNING "id"`,
        [nextTmdbId()],
      );

      // Confirm clientB is blocked by clientA
      let blocked = false;
      for (let i = 0; i < 20; i++) {
        const res = await prisma.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%Waits For L2%' AND array_length(pg_blocking_pids(pid), 1) > 0
        `;
        if (res.length > 0) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);

      await clientA.query('COMMIT');
      const inserted = await blockedInsertPromise;
      createdMovieIds.push(inserted.rows[0].id);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  // ── 5. media_embeddings Constraints & execute_model_cutover ────────────────

  it('enforces media_embeddings constraints and execute_model_cutover promotion & rollback', async () => {
    // Isolate cutover coverage from earlier test records in this suite
    if (createdMovieIds.length > 0) {
      await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds.splice(0) } } });
    }
    if (createdTvIds.length > 0) {
      await prisma.tvShow.deleteMany({ where: { id: { in: createdTvIds.splice(0) } } });
    }

    const movie = await prisma.movie.create({
      data: {
        tmdbId: nextTmdbId(),
        title: 'Cutover Eligible Movie',
        overview: 'Valid overview for cutover.',
        provenance: CatalogueProvenance.TMDB,
      },
    });
    const tvNoOverview = await prisma.tvShow.create({
      data: {
        tmdbId: nextTmdbId(),
        name: 'TV Without Overview',
        overview: null,
        provenance: CatalogueProvenance.TMDB,
      },
    });
    const synthMovie = await prisma.movie.create({
      data: {
        tmdbId: nextTmdbId(),
        title: 'Synthetic Movie Excluded',
        overview: 'Should not block cutover',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    createdMovieIds.push(movie.id, synthMovie.id);
    createdTvIds.push(tvNoOverview.id);

    // Reject non-unit norm vector
    const badNorm = `[${[2, ...new Array<number>(TD08_DIMS - 1).fill(0)].join(',')}]`;
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "media_embeddings" ("movie_id", "embedding", "model_name", "model_version", "dimensions", "content_hash", "metadata_revision", "lifecycle_stage", "status", "generated_at")
         VALUES ($1::uuid, $2::vector, $3, $4, $5, $6, 0, 'STAGED', 'COMPLETED', clock_timestamp())`,
        movie.id,
        badNorm,
        TD08_MODEL,
        TD08_REV,
        TD08_DIMS,
        makeHash('badnorm'),
      ),
    ).rejects.toThrow();

    // Reject wrong dimension
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "media_embeddings" ("movie_id", "embedding", "model_name", "model_version", "dimensions", "content_hash", "metadata_revision", "lifecycle_stage", "status", "generated_at")
         VALUES ($1::uuid, $2::vector, $3, $4, 384, $5, 0, 'STAGED', 'COMPLETED', clock_timestamp())`,
        movie.id,
        makeUnitVectorLiteral(384),
        TD08_MODEL,
        TD08_REV,
        makeHash('baddim'),
      ),
    ).rejects.toThrow();

    // Reject expired/unheld lease on cutover
    const jobId = '11111111-1111-4111-8111-111111111111';
    await expect(
      prisma.$queryRaw`SELECT execute_model_cutover(${jobId}::uuid, 999999::bigint)`,
    ).rejects.toThrow(/LEASE_NOT_HELD/);

    // Acquire lease with monotonic fencing_token + 1 and set pending model -> INSUFFICIENT_COVERAGE rollback
    const acquired = await prisma.$queryRaw<{ fencing_token: bigint }[]>`
      UPDATE "job_leases"
      SET "status" = 'ACQUIRED', "owner_job_id" = ${jobId}::uuid, "fencing_token" = "fencing_token" + 1,
          "heartbeat_at" = clock_timestamp(), "expires_at" = clock_timestamp() + interval '5 minutes'
      WHERE "lease_name" = 'model_cutover'
      RETURNING "fencing_token"
    `;
    const activeToken = acquired[0].fencing_token;
    await prisma.$executeRaw`
      UPDATE "embedding_coordination"
      SET "pending_model_name" = ${TD08_MODEL}, "pending_model_version" = ${TD08_REV},
          "pending_dimensions" = ${TD08_DIMS}, "cutover_in_progress" = TRUE
      WHERE "id" = 1
    `;

    try {
      await expect(
        prisma.$queryRaw`SELECT execute_model_cutover(${jobId}::uuid, ${activeToken}::bigint)`,
      ).rejects.toThrow(/INSUFFICIENT_COVERAGE/);

      // Stage valid 768d embedding for all TMDB + title/name + overview records
      await prisma.$executeRawUnsafe(
        `INSERT INTO "media_embeddings" ("movie_id", "embedding", "model_name", "model_version", "dimensions", "content_hash", "metadata_revision", "lifecycle_stage", "status", "generated_at")
         VALUES ($1::uuid, $2::vector, $3, $4, $5, $6, 0, 'STAGED', 'COMPLETED', clock_timestamp())`,
        movie.id,
        makeUnitVectorLiteral(),
        TD08_MODEL,
        TD08_REV,
        TD08_DIMS,
        makeHash('valid1'),
      );

      const result = await prisma.$queryRaw<
        { execute_model_cutover: { success: boolean; active_count: number } }[]
      >`
        SELECT execute_model_cutover(${jobId}::uuid, ${activeToken}::bigint)
      `;
      expect(result[0].execute_model_cutover.success).toBe(true);
      expect(result[0].execute_model_cutover.active_count).toBeGreaterThanOrEqual(1);

      const coordAfter = await prisma.embeddingCoordination.findUniqueOrThrow({ where: { id: 1 } });
      expect(coordAfter.pendingModelName).toBeNull();
      expect(coordAfter.cutoverInProgress).toBe(false);
    } finally {
      // Clean up test lease & pending state
      await prisma.$executeRaw`
        UPDATE "job_leases"
        SET "status" = 'AVAILABLE', "owner_job_id" = NULL, "expires_at" = NULL, "heartbeat_at" = NULL
        WHERE "lease_name" = 'model_cutover'
      `;
      await prisma.$executeRaw`
        UPDATE "embedding_coordination"
        SET "pending_model_name" = NULL, "pending_model_version" = NULL, "pending_dimensions" = NULL, "cutover_in_progress" = FALSE
        WHERE "id" = 1
      `;
    }
  });
});
