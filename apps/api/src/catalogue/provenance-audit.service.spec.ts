import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CatalogueProvenance } from '@prisma/client';
import {
  computeManifestDigest,
  computeProbesDigest,
  loadAndValidateEvidence,
  resolveDefaultFixturesDir,
} from './provenance-audit.evidence.js';
import { classifyAndSummarizeMedia } from './provenance-audit.service.js';
import { AuditCatalogueRow } from './provenance-audit.types.js';

function createTempFixtures(
  overrides: {
    manifest?: (m: Record<string, unknown>) => void;
    seedingCp?: (cp: Record<string, unknown>) => void;
    probes?: (p: Array<Record<string, unknown>>) => void;
    probeCp?: (pcp: Record<string, unknown>) => void;
    omitFiles?: string[];
  } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesphere-audit-test-'));

  const manifest: Record<string, unknown> = {
    schema_version: '1.0.0',
    is_executable: true,
    filtering_criteria: { min_overview_length: 30 },
    movies: [
      { tmdb_id: 11, original_language: 'en' },
      { tmdb_id: 12, original_language: 'fr' },
    ],
    tv_shows: [
      { tmdb_id: 100, original_language: 'en' },
      { tmdb_id: 101, original_language: 'ja' },
      { tmdb_id: 102, original_language: 'en' },
    ],
  };
  manifest.manifest_digest = computeManifestDigest(manifest);
  overrides.manifest?.(manifest);

  const seedingCp: Record<string, unknown> = {
    schema_version: '1.0.0',
    manifest_digest: manifest.manifest_digest,
    completed_movie_ids: [11],
    completed_tv_ids: [100, 101],
    partial_tv_ids: [101],
    failed_ids: [{ media_type: 'tv', tmdb_id: 102 }],
  };
  overrides.seedingCp?.(seedingCp);

  const probesList: Array<Record<string, unknown>> = [
    { probe_id: 'PB-01', media_type: 'movie', tmdb_id: 27205, title: 'Inception' },
    { probe_id: 'PB-31', media_type: 'tv', tmdb_id: 1396, title: 'Breaking Bad' },
  ];
  overrides.probes?.(probesList);
  const probesDoc = probesList;

  const probesDigest = computeProbesDigest(probesList);
  const probeCp: Record<string, unknown> = {
    schema_version: '1.0.0',
    probes_digest: probesDigest,
    completed_probe_ids: ['PB-01', 'PB-31'],
    partial_tv_probe_ids: [],
    failed_probes: [],
  };
  overrides.probeCp?.(probeCp);

  const files: Record<string, unknown> = {
    'seeding_candidate_manifest.json': manifest,
    'seeding_checkpoint.json': seedingCp,
    'probes_v1.json': probesDoc,
    'probe_ingestion_checkpoint.json': probeCp,
  };

  const omit = new Set(overrides.omitFiles ?? []);
  for (const [name, content] of Object.entries(files)) {
    if (!omit.has(name)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2), 'utf8');
    }
  }
  return dir;
}

describe('ProvenanceAudit Evidence & Classification (Unit)', () => {
  it('validates the real committed repository seeding and probe artifacts with exact digests', () => {
    const bundle = loadAndValidateEvidence(resolveDefaultFixturesDir());

    expect(bundle.seedingTrusted).toBe(true);
    expect(bundle.probesTrusted).toBe(true);
    expect(bundle.artifacts.seedingManifest.status).toBe('VALID');
    expect(bundle.artifacts.seedingCheckpoint.status).toBe('VALID');
    expect(bundle.artifacts.probesFixture.status).toBe('VALID');
    expect(bundle.artifacts.probeCheckpoint.status).toBe('VALID');

    expect(bundle.artifacts.seedingCheckpoint.partialCount).toBe(0);
    expect(bundle.artifacts.seedingCheckpoint.failedCount).toBe(0);
    expect(bundle.completedMovieTmdbIds.size).toBe(1408 + 38);
    expect(bundle.completedTvTmdbIds.size).toBe(545 + 12);
    expect(bundle.syntheticMovieIdentities.get(9_000_001)).toContain('global-setup.ts');
    expect(bundle.syntheticTvIdentities.get(9_000_002)).toContain('global-setup.ts');
  });

  it('fails closed on tampered manifest digest and excludes seeding evidence', () => {
    const dir = createTempFixtures({
      manifest: (m) => {
        m.manifest_digest = '0'.repeat(64);
      },
    });
    try {
      const bundle = loadAndValidateEvidence(dir);
      expect(bundle.artifacts.seedingManifest.status).toBe('INVALID');
      expect(bundle.artifacts.seedingManifest.digestValid).toBe(false);
      expect(bundle.seedingTrusted).toBe(false);
      // Probe evidence remains independent and valid
      expect(bundle.probesTrusted).toBe(true);
      expect(bundle.completedMovieTmdbIds.has(11)).toBe(false);
      expect(bundle.completedMovieTmdbIds.has(27205)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on unsupported schema_version and duplicate probe IDs', () => {
    const dir = createTempFixtures({
      seedingCp: (cp) => {
        cp.schema_version = '0.9.0';
      },
      probeCp: (pcp) => {
        pcp.completed_probe_ids = ['PB-01', 'PB-01'];
      },
    });
    try {
      const bundle = loadAndValidateEvidence(dir);
      expect(bundle.seedingTrusted).toBe(false);
      expect(bundle.artifacts.seedingCheckpoint.status).toBe('INVALID');
      expect(bundle.probesTrusted).toBe(false);
      expect(bundle.artifacts.probeCheckpoint.duplicateCount).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies strict classification rules, conflict detection, and prohibits heuristic shortcuts', () => {
    const dir = createTempFixtures();
    try {
      const bundle = loadAndValidateEvidence(dir, [
        { mediaType: 'MOVIE', tmdbId: 9_000_001, source: 'e2e' },
        { mediaType: 'MOVIE', tmdbId: 27205, source: 'conflicting-synthetic-test' },
      ]);

      const movieRows: AuditCatalogueRow[] = [
        // 11: completed + syncedAt + usable title & overview -> TMDB + eligible
        {
          id: 'm-11',
          tmdbId: 11,
          titleOrName: 'Star Wars',
          overview: 'A long time ago...',
          syncedAt: new Date(),
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
        // 12: candidate-only (not in completed) -> UNKNOWN
        {
          id: 'm-12',
          tmdbId: 12,
          titleOrName: 'Finding Nemo',
          overview: 'Fish story',
          syncedAt: new Date(),
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
        // 27205: completed probe AND synthetic -> CONFLICTING -> UNKNOWN
        {
          id: 'm-27205',
          tmdbId: 27205,
          titleOrName: 'Inception',
          overview: 'Dreams',
          syncedAt: new Date(),
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
        // 9000001: synthetic fixture only -> SYNTHETIC
        {
          id: 'm-9000001',
          tmdbId: 9_000_001,
          titleOrName: '[E2E] Inception Test Film',
          overview: 'E2E test',
          syncedAt: null,
          currentProvenance: CatalogueProvenance.SYNTHETIC,
        },
        // 9999999: high TMDB ID + "Test Mock Fixture" title + syncedAt null, but NOT in synthetic registry -> UNKNOWN
        {
          id: 'm-9999999',
          tmdbId: 9_999_999,
          titleOrName: 'Test Mock Fixture Movie',
          overview: null,
          syncedAt: null,
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
      ];

      const summary = classifyAndSummarizeMedia('MOVIE', movieRows, bundle, 10);
      expect(summary.totalDatabaseRecords).toBe(5);
      expect(summary.verifiedTmdb).toBe(1);
      expect(summary.verifiedSynthetic).toBe(1);
      expect(summary.conflictingEvidence).toBe(1);
      expect(summary.unknown).toBe(3);
      expect(summary.eligibleForEmbeddings).toBe(1);
      expect(summary.excludedFromEligibility).toBe(4);
      expect(summary.missingDatabaseRecords).toBe(0);

      // TV: 100 completed (missing overview -> TMDB but NOT eligible), 101 partial -> UNKNOWN, 102 failed -> UNKNOWN, 1396 completed probe missing from DB
      const tvRows: AuditCatalogueRow[] = [
        {
          id: 't-100',
          tmdbId: 100,
          titleOrName: 'Show Without Overview',
          overview: '   ',
          syncedAt: new Date(),
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
        {
          id: 't-101',
          tmdbId: 101,
          titleOrName: 'Partial TV Show',
          overview: 'Partial overview',
          syncedAt: new Date(),
          currentProvenance: CatalogueProvenance.UNKNOWN,
        },
      ];
      const tvSummary = classifyAndSummarizeMedia('TV', tvRows, bundle, 10);
      expect(tvSummary.verifiedTmdb).toBe(1);
      expect(tvSummary.eligibleForEmbeddings).toBe(0);
      expect(tvSummary.unknown).toBe(1);
      expect(tvSummary.missingDatabaseRecords).toBe(1);
      expect(tvSummary.sampleMissingFromDb).toEqual([1396]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
