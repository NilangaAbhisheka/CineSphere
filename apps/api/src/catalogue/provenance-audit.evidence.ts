import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  ArtifactValidationSummary,
  AuditMediaType,
  SyntheticFixtureIdentity,
  ValidatedEvidenceBundle,
} from './provenance-audit.types.js';

const SUPPORTED_SCHEMA_VERSION = '1.0.0';
const CANONICAL_MOVIE_TARGET = 1408;
const CANONICAL_TV_TARGET = 555;
const CANONICAL_MOVIE_NONENG_FRACTION = 0.25;
const CANONICAL_TV_NONENG_FRACTION = 0.2;

export const DEFAULT_SYNTHETIC_FIXTURE_IDENTITIES: readonly SyntheticFixtureIdentity[] = [
  {
    mediaType: 'MOVIE',
    tmdbId: 9_000_001,
    source: 'apps/web/e2e/global-setup.ts#E2E_MOVIE_TMDB_ID',
  },
  {
    mediaType: 'TV',
    tmdbId: 9_000_002,
    source: 'apps/web/e2e/global-setup.ts#E2E_TV_TMDB_ID',
  },
];

export function resolveDefaultFixturesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'ml/benchmark/fixtures'),
    path.resolve(process.cwd(), '../../ml/benchmark/fixtures'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function pythonJsonString(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => {
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

/**
 * Deterministic JSON serializer matching Python's `json.dumps(obj, sort_keys=True)`
 * (using `, ` and `: ` separators, `ensure_ascii=True`, and lexicographically sorted object keys).
 */
export function pythonSortedJsonDumps(value: unknown): string {
  if (typeof value === 'string') {
    return pythonJsonString(value);
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonSortedJsonDumps(item)).join(', ')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 0) {
    return '{}';
  }
  const entries = keys.map((k) => `${pythonJsonString(k)}: ${pythonSortedJsonDumps(record[k])}`);
  return `{${entries.join(', ')}}`;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function normalizeMediaType(raw: unknown): AuditMediaType | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'MOVIE' || upper === 'TV') {
    return upper;
  }
  return null;
}

function readJsonFile(
  filePath: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${path.basename(filePath)}` };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: `Malformed JSON in ${path.basename(filePath)}: ${err instanceof Error ? err.message : 'parse error'}`,
    };
  }
}

function emptyArtifactSummary(name: string, filePath: string): ArtifactValidationSummary {
  return {
    name,
    path: filePath,
    status: 'INVALID',
    schemaVersion: null,
    storedDigest: null,
    computedDigest: null,
    digestValid: false,
    pairedWith: null,
    pairingValid: false,
    duplicateCount: 0,
    malformedCount: 0,
    completedCount: 0,
    partialCount: 0,
    failedCount: 0,
    errors: [],
  };
}

export function computeManifestDigest(manifest: Record<string, unknown>): string {
  const filteringCriteria =
    manifest.filtering_criteria && typeof manifest.filtering_criteria === 'object'
      ? manifest.filtering_criteria
      : {};
  const movies = Array.isArray(manifest.movies)
    ? (manifest.movies as Array<Record<string, unknown>>)
    : [];
  const tvShows = Array.isArray(manifest.tv_shows)
    ? (manifest.tv_shows as Array<Record<string, unknown>>)
    : [];

  const movieIds = movies.map((c) => c.tmdb_id as number).sort((a, b) => a - b);
  const tvIds = tvShows.map((c) => c.tmdb_id as number).sort((a, b) => a - b);

  const movieLanguages = movies
    .map(
      (c) =>
        [
          c.tmdb_id as number,
          typeof c.original_language === 'string' ? c.original_language : '',
        ] as [number, string],
    )
    .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1].localeCompare(b[1])));

  const tvLanguages = tvShows
    .map(
      (c) =>
        [
          c.tmdb_id as number,
          typeof c.original_language === 'string' ? c.original_language : '',
        ] as [number, string],
    )
    .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1].localeCompare(b[1])));

  const payload: Record<string, unknown> = {
    schema_version: typeof manifest.schema_version === 'string' ? manifest.schema_version : '',
    filtering_criteria: filteringCriteria,
    movie_ids: movieIds,
    tv_ids: tvIds,
    movie_languages: movieLanguages,
    tv_languages: tvLanguages,
    canonical_movie_target: CANONICAL_MOVIE_TARGET,
    canonical_tv_target: CANONICAL_TV_TARGET,
    canonical_movie_noneng_fraction: CANONICAL_MOVIE_NONENG_FRACTION,
    canonical_tv_noneng_fraction: CANONICAL_TV_NONENG_FRACTION,
  };
  if ('is_executable' in manifest) {
    payload.is_executable = manifest.is_executable;
  }
  return sha256Hex(pythonSortedJsonDumps(payload));
}

export function computeProbesDigest(probes: Array<Record<string, unknown>>): string {
  const normalized = probes.map((p) => ({
    probe_id: String(p.probe_id ?? '').trim(),
    media_type: String(p.media_type ?? '')
      .trim()
      .toUpperCase(),
    tmdb_id: p.tmdb_id,
    title: String(p.title ?? '').trim(),
  }));
  normalized.sort((a, b) => (a.probe_id < b.probe_id ? -1 : a.probe_id > b.probe_id ? 1 : 0));
  return sha256Hex(pythonSortedJsonDumps(normalized));
}

export function loadAndValidateEvidence(
  fixturesDir: string = resolveDefaultFixturesDir(),
  syntheticIdentities: readonly SyntheticFixtureIdentity[] = DEFAULT_SYNTHETIC_FIXTURE_IDENTITIES,
): ValidatedEvidenceBundle {
  const manifestPath = path.join(fixturesDir, 'seeding_candidate_manifest.json');
  const seedingCpPath = path.join(fixturesDir, 'seeding_checkpoint.json');
  const probesPath = path.join(fixturesDir, 'probes_v1.json');
  const probeCpPath = path.join(fixturesDir, 'probe_ingestion_checkpoint.json');

  const manifestSummary = emptyArtifactSummary('seeding_candidate_manifest.json', manifestPath);
  const seedingCpSummary = emptyArtifactSummary('seeding_checkpoint.json', seedingCpPath);
  const probesSummary = emptyArtifactSummary('probes_v1.json', probesPath);
  const probeCpSummary = emptyArtifactSummary('probe_ingestion_checkpoint.json', probeCpPath);

  const candidateMovieIds = new Set<number>();
  const candidateTvIds = new Set<number>();
  const completedMovieIds = new Set<number>();
  const completedTvIds = new Set<number>();
  const partialMovieIds = new Set<number>();
  const partialTvIds = new Set<number>();
  const failedMovieIds = new Set<number>();
  const failedTvIds = new Set<number>();

  // ── 1. Validate seeding_candidate_manifest.json ────────────────────────────
  const manifestRes = readJsonFile(manifestPath);
  if (!manifestRes.ok) {
    manifestSummary.status = fs.existsSync(manifestPath) ? 'INVALID' : 'MISSING';
    manifestSummary.errors.push(manifestRes.error);
  } else if (
    !manifestRes.data ||
    typeof manifestRes.data !== 'object' ||
    Array.isArray(manifestRes.data)
  ) {
    manifestSummary.errors.push('Manifest root must be a JSON object.');
  } else {
    const m = manifestRes.data as Record<string, unknown>;
    manifestSummary.schemaVersion = typeof m.schema_version === 'string' ? m.schema_version : null;
    if (manifestSummary.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      manifestSummary.errors.push(
        `Unsupported schema_version "${String(manifestSummary.schemaVersion)}" (expected ${SUPPORTED_SCHEMA_VERSION}).`,
      );
    }

    const moviesArr = Array.isArray(m.movies) ? (m.movies as Array<Record<string, unknown>>) : null;
    const tvArr = Array.isArray(m.tv_shows) ? (m.tv_shows as Array<Record<string, unknown>>) : null;
    if (!moviesArr || !tvArr) {
      manifestSummary.errors.push('Manifest must contain "movies" and "tv_shows" arrays.');
    } else {
      for (const item of moviesArr) {
        if (!item || typeof item !== 'object' || !isPositiveInt(item.tmdb_id)) {
          manifestSummary.malformedCount += 1;
          continue;
        }
        if (candidateMovieIds.has(item.tmdb_id)) {
          manifestSummary.duplicateCount += 1;
        }
        candidateMovieIds.add(item.tmdb_id);
      }
      for (const item of tvArr) {
        if (!item || typeof item !== 'object' || !isPositiveInt(item.tmdb_id)) {
          manifestSummary.malformedCount += 1;
          continue;
        }
        if (candidateTvIds.has(item.tmdb_id)) {
          manifestSummary.duplicateCount += 1;
        }
        candidateTvIds.add(item.tmdb_id);
      }
      if (manifestSummary.malformedCount > 0) {
        manifestSummary.errors.push(
          `Manifest contains ${manifestSummary.malformedCount} malformed entries.`,
        );
      }
      if (manifestSummary.duplicateCount > 0) {
        manifestSummary.errors.push(
          `Manifest contains ${manifestSummary.duplicateCount} duplicate candidate IDs.`,
        );
      }
      manifestSummary.storedDigest =
        typeof m.manifest_digest === 'string' ? m.manifest_digest : null;
      manifestSummary.computedDigest = computeManifestDigest(m);
      manifestSummary.digestValid =
        manifestSummary.storedDigest !== null &&
        manifestSummary.storedDigest === manifestSummary.computedDigest;
      if (!manifestSummary.digestValid) {
        manifestSummary.errors.push('Manifest SHA-256 digest mismatch.');
      }
    }
    manifestSummary.completedCount = candidateMovieIds.size + candidateTvIds.size;
    manifestSummary.pairingValid = true;
    if (manifestSummary.errors.length === 0) {
      manifestSummary.status = 'VALID';
    }
  }

  // ── 2. Validate seeding_checkpoint.json ────────────────────────────────────
  const cpMovieSet = new Set<number>();
  const cpTvSet = new Set<number>();
  const seedingCpRes = readJsonFile(seedingCpPath);
  seedingCpSummary.pairedWith = 'seeding_candidate_manifest.json';

  if (!seedingCpRes.ok) {
    seedingCpSummary.status = fs.existsSync(seedingCpPath) ? 'INVALID' : 'MISSING';
    seedingCpSummary.errors.push(seedingCpRes.error);
  } else if (
    !seedingCpRes.data ||
    typeof seedingCpRes.data !== 'object' ||
    Array.isArray(seedingCpRes.data)
  ) {
    seedingCpSummary.errors.push('Seeding checkpoint root must be a JSON object.');
  } else {
    const cp = seedingCpRes.data as Record<string, unknown>;
    seedingCpSummary.schemaVersion =
      typeof cp.schema_version === 'string' ? cp.schema_version : null;
    if (seedingCpSummary.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      seedingCpSummary.errors.push(
        `Unsupported checkpoint schema_version "${String(seedingCpSummary.schemaVersion)}".`,
      );
    }

    seedingCpSummary.storedDigest =
      typeof cp.manifest_digest === 'string' ? cp.manifest_digest : null;
    seedingCpSummary.computedDigest = manifestSummary.computedDigest;
    seedingCpSummary.digestValid =
      manifestSummary.status === 'VALID' &&
      seedingCpSummary.storedDigest !== null &&
      seedingCpSummary.storedDigest === manifestSummary.storedDigest;
    seedingCpSummary.pairingValid = seedingCpSummary.digestValid;
    if (!seedingCpSummary.pairingValid) {
      seedingCpSummary.errors.push(
        'Seeding checkpoint manifest_digest does not match validated manifest.',
      );
    }

    const rawMovies = Array.isArray(cp.completed_movie_ids) ? cp.completed_movie_ids : null;
    const rawTv = Array.isArray(cp.completed_tv_ids) ? cp.completed_tv_ids : null;
    const rawPartialTv = Array.isArray(cp.partial_tv_ids) ? cp.partial_tv_ids : null;
    const rawFailed = Array.isArray(cp.failed_ids) ? cp.failed_ids : null;

    if (!rawMovies || !rawTv || !rawPartialTv || !rawFailed) {
      seedingCpSummary.errors.push(
        'Seeding checkpoint missing required arrays (completed_movie_ids, completed_tv_ids, partial_tv_ids, failed_ids).',
      );
    } else {
      for (const id of rawMovies) {
        if (!isPositiveInt(id)) {
          seedingCpSummary.malformedCount += 1;
          continue;
        }
        if (cpMovieSet.has(id)) {
          seedingCpSummary.duplicateCount += 1;
        }
        if (manifestSummary.status === 'VALID' && !candidateMovieIds.has(id)) {
          seedingCpSummary.malformedCount += 1;
          seedingCpSummary.errors.push(`Completed movie ID ${id} absent from paired manifest.`);
        }
        cpMovieSet.add(id);
      }
      for (const id of rawTv) {
        if (!isPositiveInt(id)) {
          seedingCpSummary.malformedCount += 1;
          continue;
        }
        if (cpTvSet.has(id)) {
          seedingCpSummary.duplicateCount += 1;
        }
        if (manifestSummary.status === 'VALID' && !candidateTvIds.has(id)) {
          seedingCpSummary.malformedCount += 1;
          seedingCpSummary.errors.push(`Completed TV ID ${id} absent from paired manifest.`);
        }
        cpTvSet.add(id);
      }
      for (const id of rawPartialTv) {
        if (!isPositiveInt(id)) {
          seedingCpSummary.malformedCount += 1;
          continue;
        }
        partialTvIds.add(id);
      }
      for (const entry of rawFailed) {
        if (typeof entry === 'string') {
          const match = /^(movie|tv)_(\d+)$/i.exec(entry.trim());
          if (!match) {
            seedingCpSummary.malformedCount += 1;
            continue;
          }
          const mt = match[1].toUpperCase() as AuditMediaType;
          const tid = Number(match[2]);
          if (mt === 'MOVIE') failedMovieIds.add(tid);
          else failedTvIds.add(tid);
          continue;
        }
        if (!entry || typeof entry !== 'object') {
          seedingCpSummary.malformedCount += 1;
          continue;
        }
        const rec = entry as Record<string, unknown>;
        const mt = normalizeMediaType(rec.media_type);
        if (!mt || !isPositiveInt(rec.tmdb_id)) {
          seedingCpSummary.malformedCount += 1;
          continue;
        }
        if (mt === 'MOVIE') failedMovieIds.add(rec.tmdb_id);
        else failedTvIds.add(rec.tmdb_id);
      }

      seedingCpSummary.partialCount = partialTvIds.size;
      seedingCpSummary.failedCount = failedMovieIds.size + failedTvIds.size;
      if (seedingCpSummary.duplicateCount > 0) {
        seedingCpSummary.errors.push(
          `Seeding checkpoint contains ${seedingCpSummary.duplicateCount} duplicate completed IDs.`,
        );
      }
      if (seedingCpSummary.malformedCount > 0) {
        seedingCpSummary.errors.push(
          `Seeding checkpoint contains ${seedingCpSummary.malformedCount} malformed or unpaired entries.`,
        );
      }
    }

    if (seedingCpSummary.errors.length === 0) {
      seedingCpSummary.status = 'VALID';
      for (const id of cpMovieSet) {
        if (!failedMovieIds.has(id)) completedMovieIds.add(id);
      }
      for (const id of cpTvSet) {
        if (!partialTvIds.has(id) && !failedTvIds.has(id)) completedTvIds.add(id);
      }
      seedingCpSummary.completedCount = completedMovieIds.size + completedTvIds.size;
    }
  }

  // ── 3. Validate probes_v1.json ─────────────────────────────────────────────
  const probeById = new Map<string, { mediaType: AuditMediaType; tmdbId: number }>();
  const seenProbeComposite = new Set<string>();
  const probesRes = readJsonFile(probesPath);
  if (!probesRes.ok) {
    probesSummary.status = fs.existsSync(probesPath) ? 'INVALID' : 'MISSING';
    probesSummary.errors.push(probesRes.error);
  } else if (!Array.isArray(probesRes.data)) {
    probesSummary.errors.push('probes_v1.json root must be a JSON array.');
  } else {
    const probesArr = probesRes.data as Array<Record<string, unknown>>;
    if (probesArr.length === 0) {
      probesSummary.errors.push('probes_v1.json must contain a non-empty array.');
    } else {
      for (const p of probesArr) {
        const pid = typeof p?.probe_id === 'string' ? p.probe_id.trim() : '';
        const mt = normalizeMediaType(p?.media_type);
        const tid = p?.tmdb_id;
        if (!pid || !mt || !isPositiveInt(tid) || typeof p?.title !== 'string') {
          probesSummary.malformedCount += 1;
          continue;
        }
        const composite = `${mt}:${tid}`;
        if (probeById.has(pid) || seenProbeComposite.has(composite)) {
          probesSummary.duplicateCount += 1;
        }
        probeById.set(pid, { mediaType: mt, tmdbId: tid });
        seenProbeComposite.add(composite);
      }
      if (probesSummary.malformedCount > 0) {
        probesSummary.errors.push(
          `probes_v1.json has ${probesSummary.malformedCount} malformed entries.`,
        );
      }
      if (probesSummary.duplicateCount > 0) {
        probesSummary.errors.push(
          `probes_v1.json has ${probesSummary.duplicateCount} duplicate identities.`,
        );
      }
      probesSummary.computedDigest = computeProbesDigest(probesArr);
      probesSummary.storedDigest = probesSummary.computedDigest;
      probesSummary.digestValid = true;
      probesSummary.pairingValid = true;
      probesSummary.completedCount = probeById.size;
      if (probesSummary.errors.length === 0) {
        probesSummary.status = 'VALID';
      }
    }
  }

  // ── 4. Validate probe_ingestion_checkpoint.json ────────────────────────────
  const probeCpRes = readJsonFile(probeCpPath);
  probeCpSummary.pairedWith = 'probes_v1.json';
  const cpProbeSet = new Set<string>();
  const cpPartialProbeSet = new Set<string>();
  const cpFailedProbeSet = new Set<string>();

  if (!probeCpRes.ok) {
    probeCpSummary.status = fs.existsSync(probeCpPath) ? 'INVALID' : 'MISSING';
    probeCpSummary.errors.push(probeCpRes.error);
  } else if (
    !probeCpRes.data ||
    typeof probeCpRes.data !== 'object' ||
    Array.isArray(probeCpRes.data)
  ) {
    probeCpSummary.errors.push('Probe checkpoint root must be a JSON object.');
  } else {
    const pcp = probeCpRes.data as Record<string, unknown>;
    probeCpSummary.schemaVersion =
      typeof pcp.schema_version === 'string' ? pcp.schema_version : null;
    if (probeCpSummary.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      probeCpSummary.errors.push(
        `Unsupported probe checkpoint schema_version "${String(probeCpSummary.schemaVersion)}".`,
      );
    }

    probeCpSummary.storedDigest = typeof pcp.probes_digest === 'string' ? pcp.probes_digest : null;
    probeCpSummary.computedDigest = probesSummary.computedDigest;
    probeCpSummary.digestValid =
      probesSummary.status === 'VALID' &&
      probeCpSummary.storedDigest !== null &&
      probeCpSummary.storedDigest === probesSummary.computedDigest;
    probeCpSummary.pairingValid = probeCpSummary.digestValid;
    if (!probeCpSummary.pairingValid) {
      probeCpSummary.errors.push('Probe checkpoint probes_digest does not match probes_v1.json.');
    }

    const rawCompleted = Array.isArray(pcp.completed_probe_ids) ? pcp.completed_probe_ids : null;
    const rawPartial = Array.isArray(pcp.partial_tv_probe_ids) ? pcp.partial_tv_probe_ids : null;
    const rawFailed = Array.isArray(pcp.failed_probes) ? pcp.failed_probes : null;

    if (!rawCompleted || !rawPartial || !rawFailed) {
      probeCpSummary.errors.push(
        'Probe checkpoint missing required arrays (completed_probe_ids, partial_tv_probe_ids, failed_probes).',
      );
    } else {
      for (const pid of rawCompleted) {
        if (typeof pid !== 'string' || !probeById.has(pid)) {
          probeCpSummary.malformedCount += 1;
          continue;
        }
        if (cpProbeSet.has(pid)) {
          probeCpSummary.duplicateCount += 1;
        }
        cpProbeSet.add(pid);
      }
      for (const pid of rawPartial) {
        if (typeof pid !== 'string' || !probeById.has(pid)) {
          probeCpSummary.malformedCount += 1;
          continue;
        }
        cpPartialProbeSet.add(pid);
        const spec = probeById.get(pid);
        if (spec?.mediaType === 'TV') partialTvIds.add(spec.tmdbId);
        else if (spec?.mediaType === 'MOVIE') partialMovieIds.add(spec.tmdbId);
      }
      for (const entry of rawFailed) {
        const pid =
          typeof entry === 'string'
            ? entry
            : entry &&
                typeof entry === 'object' &&
                typeof (entry as Record<string, unknown>).probe_id === 'string'
              ? ((entry as Record<string, unknown>).probe_id as string)
              : null;
        if (!pid || !probeById.has(pid)) {
          probeCpSummary.malformedCount += 1;
          continue;
        }
        cpFailedProbeSet.add(pid);
        const spec = probeById.get(pid);
        if (spec?.mediaType === 'TV') failedTvIds.add(spec.tmdbId);
        else if (spec?.mediaType === 'MOVIE') failedMovieIds.add(spec.tmdbId);
      }

      probeCpSummary.partialCount = cpPartialProbeSet.size;
      probeCpSummary.failedCount = cpFailedProbeSet.size;
      if (probeCpSummary.duplicateCount > 0) {
        probeCpSummary.errors.push(
          `Probe checkpoint has ${probeCpSummary.duplicateCount} duplicate probe IDs.`,
        );
      }
      if (probeCpSummary.malformedCount > 0) {
        probeCpSummary.errors.push(
          `Probe checkpoint has ${probeCpSummary.malformedCount} unknown/malformed probe IDs.`,
        );
      }
    }

    if (probeCpSummary.errors.length === 0) {
      probeCpSummary.status = 'VALID';
      let validCompletedProbes = 0;
      for (const pid of cpProbeSet) {
        if (cpPartialProbeSet.has(pid) || cpFailedProbeSet.has(pid)) continue;
        const spec = probeById.get(pid);
        if (!spec) continue;
        validCompletedProbes += 1;
        if (spec.mediaType === 'MOVIE') completedMovieIds.add(spec.tmdbId);
        else completedTvIds.add(spec.tmdbId);
      }
      probeCpSummary.completedCount = validCompletedProbes;
    }
  }

  // ── 5. Synthetic fixture identities ────────────────────────────────────────
  const syntheticMovieIdentities = new Map<number, string>();
  const syntheticTvIdentities = new Map<number, string>();
  for (const item of syntheticIdentities) {
    if (!isPositiveInt(item.tmdbId)) continue;
    if (item.mediaType === 'MOVIE') syntheticMovieIdentities.set(item.tmdbId, item.source);
    else syntheticTvIdentities.set(item.tmdbId, item.source);
  }

  return {
    artifacts: {
      seedingManifest: manifestSummary,
      seedingCheckpoint: seedingCpSummary,
      probesFixture: probesSummary,
      probeCheckpoint: probeCpSummary,
    },
    seedingTrusted: manifestSummary.status === 'VALID' && seedingCpSummary.status === 'VALID',
    probesTrusted: probesSummary.status === 'VALID' && probeCpSummary.status === 'VALID',
    completedMovieTmdbIds: completedMovieIds,
    completedTvTmdbIds: completedTvIds,
    partialMovieTmdbIds: partialMovieIds,
    partialTvTmdbIds: partialTvIds,
    failedMovieTmdbIds: failedMovieIds,
    failedTvTmdbIds: failedTvIds,
    candidateMovieTmdbIds: candidateMovieIds,
    candidateTvTmdbIds: candidateTvIds,
    syntheticMovieIdentities,
    syntheticTvIdentities,
  };
}
