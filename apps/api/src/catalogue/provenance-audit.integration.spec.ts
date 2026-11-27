import { CatalogueProvenance, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ProvenanceAuditService } from './provenance-audit.service.js';

let _counter = 770_000_000 + Math.floor(Math.random() * 20_000_000);
function nextTmdbId(): number {
  return ++_counter;
}

describe('ProvenanceAuditService PostgreSQL Read-Only Integration Tests', () => {
  let prisma: PrismaService;
  let auditService: ProvenanceAuditService;
  const createdMovieIds: string[] = [];
  const createdTvIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    auditService = new ProvenanceAuditService(prisma);
  });

  afterAll(async () => {
    if (createdMovieIds.length > 0) {
      await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds } } });
    }
    if (createdTvIds.length > 0) {
      await prisma.tvShow.deleteMany({ where: { id: { in: createdTvIds } } });
    }
    await prisma.$disconnect();
  });

  it('fails closed when expectedDatabaseName does not match the connected database', async () => {
    await expect(
      auditService.runAudit({ expectedDatabaseName: 'nonexistent_wrong_database' }),
    ).rejects.toThrow(/expected "nonexistent_wrong_database"/);
  });

  it('executes in REPEATABLE READ + READ ONLY session and leaves all catalogue rows unchanged', async () => {
    const conn = await prisma.checkConnection();
    expect(conn.connected).toBe(true);
    expect(conn.databaseName).toBeDefined();

    const syntheticTmdbId = nextTmdbId();
    const unknownTmdbId = nextTmdbId();

    const synthMovie = await prisma.movie.create({
      data: {
        tmdbId: syntheticTmdbId,
        title: 'Audit Read-Only Synthetic Movie',
        overview: 'Synthetic test fixture',
        provenance: CatalogueProvenance.SYNTHETIC,
      },
    });
    const unknownTv = await prisma.tvShow.create({
      data: {
        tmdbId: unknownTmdbId,
        name: 'Audit Read-Only Unknown TV',
        overview: 'Unknown provenance fixture',
      },
    });
    createdMovieIds.push(synthMovie.id);
    createdTvIds.push(unknownTv.id);

    const beforeMovieCount = await prisma.movie.count();
    const beforeTvCount = await prisma.tvShow.count();

    const report = await auditService.runAudit({
      expectedDatabaseName: conn.databaseName,
      syntheticIdentities: [
        {
          mediaType: 'MOVIE',
          tmdbId: syntheticTmdbId,
          source: 'provenance-audit.integration.spec.ts',
        },
      ],
    });

    expect(report.mode).toBe('READ_ONLY_DRY_RUN');
    expect(report.databaseModified).toBe(false);
    expect(report.database.databaseName).toBe(conn.databaseName);
    expect(report.database.transactionIsolation.toLowerCase()).toBe('repeatable read');
    expect(report.database.transactionReadOnly.toLowerCase()).toBe('on');
    expect(report.seedingEvidenceTrusted).toBe(true);
    expect(report.probeEvidenceTrusted).toBe(true);
    expect(report.movies.verifiedSynthetic).toBeGreaterThanOrEqual(1);
    expect(report.tvShows.unknown).toBeGreaterThanOrEqual(1);

    // Verify zero database mutations occurred
    expect(await prisma.movie.count()).toBe(beforeMovieCount);
    expect(await prisma.tvShow.count()).toBe(beforeTvCount);
    expect(
      (await prisma.movie.findUniqueOrThrow({ where: { id: synthMovie.id } })).provenance,
    ).toBe(CatalogueProvenance.SYNTHETIC);
    expect(
      (await prisma.tvShow.findUniqueOrThrow({ where: { id: unknownTv.id } })).provenance,
    ).toBe(CatalogueProvenance.UNKNOWN);

    // Verify READ ONLY transaction rejects writes (SQLSTATE 25006)
    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          await tx.movie.update({
            where: { id: synthMovie.id },
            data: { title: 'Should Fail In ReadOnly' },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    ).rejects.toThrow(/read-only/i);
  });
});
