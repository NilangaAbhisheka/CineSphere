import { CatalogueProvenance } from '@prisma/client';

export type AuditMediaType = 'MOVIE' | 'TV';

export type AuditClassification = 'TMDB' | 'SYNTHETIC' | 'UNKNOWN';

export type ArtifactValidationStatus = 'VALID' | 'INVALID' | 'MISSING';

export interface ArtifactValidationSummary {
  name: string;
  path: string;
  status: ArtifactValidationStatus;
  schemaVersion: string | null;
  storedDigest: string | null;
  computedDigest: string | null;
  digestValid: boolean;
  pairedWith: string | null;
  pairingValid: boolean;
  duplicateCount: number;
  malformedCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  errors: string[];
}

export interface SyntheticFixtureIdentity {
  mediaType: AuditMediaType;
  tmdbId: number;
  source: string;
}

export interface ValidatedEvidenceBundle {
  artifacts: {
    seedingManifest: ArtifactValidationSummary;
    seedingCheckpoint: ArtifactValidationSummary;
    probesFixture: ArtifactValidationSummary;
    probeCheckpoint: ArtifactValidationSummary;
  };
  seedingTrusted: boolean;
  probesTrusted: boolean;
  completedMovieTmdbIds: ReadonlySet<number>;
  completedTvTmdbIds: ReadonlySet<number>;
  partialMovieTmdbIds: ReadonlySet<number>;
  partialTvTmdbIds: ReadonlySet<number>;
  failedMovieTmdbIds: ReadonlySet<number>;
  failedTvTmdbIds: ReadonlySet<number>;
  candidateMovieTmdbIds: ReadonlySet<number>;
  candidateTvTmdbIds: ReadonlySet<number>;
  syntheticMovieIdentities: ReadonlyMap<number, string>;
  syntheticTvIdentities: ReadonlyMap<number, string>;
}

export interface AuditCatalogueRow {
  id: string;
  tmdbId: number;
  titleOrName: string | null;
  overview: string | null;
  syncedAt: Date | null;
  currentProvenance: CatalogueProvenance;
}

export interface UnresolvedSampleItem {
  mediaType: AuditMediaType;
  tmdbId: number;
  currentProvenance: CatalogueProvenance;
  hasSyncedAt: boolean;
  hasUsableTitle: boolean;
  hasUsableOverview: boolean;
  reason: string;
  conflicting: boolean;
}

export interface MediaAuditSummary {
  mediaType: AuditMediaType;
  totalDatabaseRecords: number;
  verifiedTmdb: number;
  verifiedSynthetic: number;
  unknown: number;
  conflictingEvidence: number;
  manualReviewRequired: number;
  eligibleForEmbeddings: number;
  excludedFromEligibility: number;
  completedCheckpointMatches: number;
  missingDatabaseRecords: number;
  unexpectedDatabaseRecords: number;
  sampleUnresolved: UnresolvedSampleItem[];
  sampleConflicting: UnresolvedSampleItem[];
  sampleMissingFromDb: number[];
}

export interface DatabaseIdentityEvidence {
  databaseName: string;
  host?: string;
  port: number;
  systemIdentifier: string;
  databaseOid: number;
  transactionIsolation: string;
  transactionReadOnly: string;
}

export interface ProvenanceAuditReport {
  auditVersion: '1.0.0';
  mode: 'READ_ONLY_DRY_RUN';
  databaseModified: false;
  database: DatabaseIdentityEvidence;
  artifacts: ValidatedEvidenceBundle['artifacts'];
  seedingEvidenceTrusted: boolean;
  probeEvidenceTrusted: boolean;
  classificationRulesApplied: {
    TMDB: string;
    SYNTHETIC: string;
    UNKNOWN: string;
    ELIGIBILITY: string;
  };
  movies: MediaAuditSummary;
  tvShows: MediaAuditSummary;
}

export interface RunProvenanceAuditOptions {
  expectedDatabaseName?: string;
  fixturesDir?: string;
  syntheticIdentities?: readonly SyntheticFixtureIdentity[];
  sampleLimit?: number;
}
