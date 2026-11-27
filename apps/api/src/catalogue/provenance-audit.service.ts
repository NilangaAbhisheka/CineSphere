import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  DEFAULT_SYNTHETIC_FIXTURE_IDENTITIES,
  loadAndValidateEvidence,
  resolveDefaultFixturesDir,
} from './provenance-audit.evidence.js';
import {
  AuditCatalogueRow,
  AuditMediaType,
  DatabaseIdentityEvidence,
  MediaAuditSummary,
  ProvenanceAuditReport,
  RunProvenanceAuditOptions,
  UnresolvedSampleItem,
  ValidatedEvidenceBundle,
} from './provenance-audit.types.js';

const DEFAULT_SAMPLE_LIMIT = 15;

function hasUsableText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function classifyAndSummarizeMedia(
  mediaType: AuditMediaType,
  rows: readonly AuditCatalogueRow[],
  evidence: ValidatedEvidenceBundle,
  sampleLimit: number = DEFAULT_SAMPLE_LIMIT,
): MediaAuditSummary {
  const completedIds =
    mediaType === 'MOVIE' ? evidence.completedMovieTmdbIds : evidence.completedTvTmdbIds;
  const partialIds =
    mediaType === 'MOVIE' ? evidence.partialMovieTmdbIds : evidence.partialTvTmdbIds;
  const failedIds = mediaType === 'MOVIE' ? evidence.failedMovieTmdbIds : evidence.failedTvTmdbIds;
  const candidateIds =
    mediaType === 'MOVIE' ? evidence.candidateMovieTmdbIds : evidence.candidateTvTmdbIds;
  const syntheticIds =
    mediaType === 'MOVIE' ? evidence.syntheticMovieIdentities : evidence.syntheticTvIdentities;

  const sortedRows = [...rows].sort((a, b) => a.tmdbId - b.tmdbId);
  const dbTmdbIds = new Set(sortedRows.map((r) => r.tmdbId));

  let verifiedTmdb = 0;
  let verifiedSynthetic = 0;
  let unknown = 0;
  let conflictingEvidence = 0;
  let eligibleForEmbeddings = 0;
  let completedCheckpointMatches = 0;
  let unexpectedDatabaseRecords = 0;

  const sampleUnresolved: UnresolvedSampleItem[] = [];
  const sampleConflicting: UnresolvedSampleItem[] = [];

  for (const row of sortedRows) {
    const inCompleted = completedIds.has(row.tmdbId);
    const inSynthetic = syntheticIds.has(row.tmdbId);
    const inPartial = partialIds.has(row.tmdbId);
    const inFailed = failedIds.has(row.tmdbId);
    const inCandidate = candidateIds.has(row.tmdbId);
    const hasSyncedAt = row.syncedAt !== null;
    const usableTitle = hasUsableText(row.titleOrName);
    const usableOverview = hasUsableText(row.overview);

    if (inCompleted) {
      completedCheckpointMatches += 1;
    }
    if (!inCompleted && !inSynthetic) {
      unexpectedDatabaseRecords += 1;
    }

    // Conflict check: both completed TMDB ingestion and synthetic fixture match,
    // OR completed TMDB ingestion without syncedAt
    if (inCompleted && inSynthetic) {
      conflictingEvidence += 1;
      unknown += 1;
      if (sampleConflicting.length < sampleLimit) {
        sampleConflicting.push({
          mediaType,
          tmdbId: row.tmdbId,
          currentProvenance: row.currentProvenance,
          hasSyncedAt,
          hasUsableTitle: usableTitle,
          hasUsableOverview: usableOverview,
          reason: `Conflicting evidence: completed checkpoint AND synthetic fixture (${syntheticIds.get(row.tmdbId)}).`,
          conflicting: true,
        });
      }
      continue;
    }

    if (inCompleted && !hasSyncedAt) {
      conflictingEvidence += 1;
      unknown += 1;
      if (sampleConflicting.length < sampleLimit) {
        sampleConflicting.push({
          mediaType,
          tmdbId: row.tmdbId,
          currentProvenance: row.currentProvenance,
          hasSyncedAt,
          hasUsableTitle: usableTitle,
          hasUsableOverview: usableOverview,
          reason:
            'Conflicting evidence: completed checkpoint match but database row has syncedAt IS NULL.',
          conflicting: true,
        });
      }
      continue;
    }

    if (inCompleted && hasSyncedAt && !inSynthetic) {
      verifiedTmdb += 1;
      if (usableTitle && usableOverview) {
        eligibleForEmbeddings += 1;
      }
      continue;
    }

    if (inSynthetic && !inCompleted) {
      verifiedSynthetic += 1;
      continue;
    }

    // Otherwise: UNKNOWN (never guess from tmdbId, title regex, or syncedAt alone)
    unknown += 1;
    if (sampleUnresolved.length < sampleLimit) {
      let reason =
        'Absent from trusted seeding/probe completion checkpoints and synthetic fixture registry.';
      if (inPartial) {
        reason =
          'Marked partial in seeding/probe checkpoint (excluded from completed TMDB evidence).';
      } else if (inFailed) {
        reason =
          'Marked failed in seeding/probe checkpoint (excluded from completed TMDB evidence).';
      } else if (inCandidate) {
        reason = 'Present in candidate manifest only without verified completion.';
      }
      sampleUnresolved.push({
        mediaType,
        tmdbId: row.tmdbId,
        currentProvenance: row.currentProvenance,
        hasSyncedAt,
        hasUsableTitle: usableTitle,
        hasUsableOverview: usableOverview,
        reason,
        conflicting: false,
      });
    }
  }

  const missingFromDb: number[] = [];
  for (const tid of [...completedIds].sort((a, b) => a - b)) {
    if (!dbTmdbIds.has(tid)) {
      missingFromDb.push(tid);
    }
  }

  return {
    mediaType,
    totalDatabaseRecords: sortedRows.length,
    verifiedTmdb,
    verifiedSynthetic,
    unknown,
    conflictingEvidence,
    manualReviewRequired: unknown,
    eligibleForEmbeddings,
    excludedFromEligibility: sortedRows.length - eligibleForEmbeddings,
    completedCheckpointMatches,
    missingDatabaseRecords: missingFromDb.length,
    unexpectedDatabaseRecords,
    sampleUnresolved,
    sampleConflicting,
    sampleMissingFromDb: missingFromDb.slice(0, sampleLimit),
  };
}

@Injectable()
export class ProvenanceAuditService {
  constructor(private readonly prisma: PrismaService) {}

  public async runAudit(options: RunProvenanceAuditOptions = {}): Promise<ProvenanceAuditReport> {
    const expectedDb = options.expectedDatabaseName ?? 'cinesphere';
    const fixturesDir = options.fixturesDir ?? resolveDefaultFixturesDir();
    const syntheticIdentities = options.syntheticIdentities ?? DEFAULT_SYNTHETIC_FIXTURE_IDENTITIES;
    const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;

    // 1. Validate evidence artifacts before trusting any IDs
    const evidence = loadAndValidateEvidence(fixturesDir, syntheticIdentities);

    // 2. Verify target database identity (fail-closed)
    const conn = await this.prisma.checkConnection();
    if (
      !conn.connected ||
      !conn.databaseName ||
      conn.port == null ||
      !conn.systemIdentifier ||
      conn.databaseOid == null
    ) {
      throw new Error(
        `Provenance audit aborted: failed to verify target database identity (${conn.error ?? 'incomplete metadata'}).`,
      );
    }
    if (conn.databaseName !== expectedDb) {
      throw new Error(
        `Provenance audit aborted: connected to database "${conn.databaseName}", expected "${expectedDb}".`,
      );
    }

    // 3. Execute all catalogue reads inside a single REPEATABLE READ + READ ONLY snapshot
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

        const txState = await tx.$queryRaw<
          Array<{ transaction_isolation: string; transaction_read_only: string }>
        >`
          SELECT
            current_setting('transaction_isolation') AS transaction_isolation,
            current_setting('transaction_read_only') AS transaction_read_only
        `;
        const iso = txState[0]?.transaction_isolation ?? '';
        const ro = txState[0]?.transaction_read_only ?? '';
        if (iso.toLowerCase() !== 'repeatable read' || ro.toLowerCase() !== 'on') {
          throw new Error(
            `Provenance audit aborted: expected REPEATABLE READ + READ ONLY session, got isolation="${iso}", read_only="${ro}".`,
          );
        }

        const movieRows = await tx.movie.findMany({
          select: {
            id: true,
            tmdbId: true,
            title: true,
            overview: true,
            syncedAt: true,
            provenance: true,
          },
          orderBy: { tmdbId: 'asc' },
        });

        const tvRows = await tx.tvShow.findMany({
          select: {
            id: true,
            tmdbId: true,
            name: true,
            overview: true,
            syncedAt: true,
            provenance: true,
          },
          orderBy: { tmdbId: 'asc' },
        });

        return {
          transactionIsolation: iso,
          transactionReadOnly: ro,
          movies: movieRows.map((m): AuditCatalogueRow => ({
            id: m.id,
            tmdbId: m.tmdbId,
            titleOrName: m.title,
            overview: m.overview,
            syncedAt: m.syncedAt,
            currentProvenance: m.provenance,
          })),
          tvShows: tvRows.map((t): AuditCatalogueRow => ({
            id: t.id,
            tmdbId: t.tmdbId,
            titleOrName: t.name,
            overview: t.overview,
            syncedAt: t.syncedAt,
            currentProvenance: t.provenance,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const dbEvidence: DatabaseIdentityEvidence = {
      databaseName: conn.databaseName,
      host: conn.host,
      port: conn.port,
      systemIdentifier: conn.systemIdentifier,
      databaseOid: conn.databaseOid,
      transactionIsolation: snapshot.transactionIsolation,
      transactionReadOnly: snapshot.transactionReadOnly,
    };

    const moviesSummary = classifyAndSummarizeMedia(
      'MOVIE',
      snapshot.movies,
      evidence,
      sampleLimit,
    );
    const tvSummary = classifyAndSummarizeMedia('TV', snapshot.tvShows, evidence, sampleLimit);

    return {
      auditVersion: '1.0.0',
      mode: 'READ_ONLY_DRY_RUN',
      databaseModified: false,
      database: dbEvidence,
      artifacts: evidence.artifacts,
      seedingEvidenceTrusted: evidence.seedingTrusted,
      probeEvidenceTrusted: evidence.probesTrusted,
      classificationRulesApplied: {
        TMDB: 'Verified completed seeding/probe checkpoint ID + DB row exists + syncedAt IS NOT NULL + no conflicting synthetic evidence',
        SYNTHETIC:
          'Verified record-level fixture/test identity + DB row exists + no contradicting completed TMDB evidence',
        UNKNOWN:
          'Absent, partial, failed, candidate-only, invalid-checkpoint, or conflicting evidence preserved as UNKNOWN',
        ELIGIBILITY: 'provenance = TMDB AND usable title/name AND usable overview',
      },
      movies: moviesSummary,
      tvShows: tvSummary,
    };
  }
}
