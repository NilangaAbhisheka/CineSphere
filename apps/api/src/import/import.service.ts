// ==============================================================================
// CineSphere — Import Service
// Phase 4.4: Orchestrates JSON and CSV import logic.
// Observability (Option C / OBS-3): Records one pipeline_runs row per import
// invocation without altering validation, transaction semantics, or responses.
//
// Architecture:
//   1. Validate entire payload (collect all errors — never partial writes).
//   2. Resolve catalogue references via TMDB (outside transactions).
//   3. Persist all data in a single READ COMMITTED transaction.
//   4. On any failure: full rollback; existing data untouched.
// ==============================================================================

import { BadRequestException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { PipelineRunStatus, PipelineTriggerType, Prisma } from '@prisma/client';
import { ImportResponse, ImportValidationError } from '@cinesphere/shared';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import {
  IMPORT_HEARTBEAT_INTERVAL_MS,
  PIPELINE_ERROR_CODES,
  PIPELINE_NAMES,
} from '../observability/observability.constants.js';
import {
  HeartbeatThrottler,
  PipelineTrackingService,
} from '../observability/pipeline-tracking.service.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import {
  validateJsonImport,
  validateCsvImport,
  ImportDocument,
  ImportEntry,
  CsvImportRow,
} from './import.validator.js';

// Max file sizes
const MAX_JSON_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB

class ImportPersistenceError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly recordsRead: number,
  ) {
    super('Import persistence transaction failed.');
  }
}

type TrackedImportOutcome =
  | {
      kind: 'succeeded';
      response: ImportResponse;
      recordsRead: number;
      recordsInserted: number;
      recordsSkipped: number;
    }
  | {
      kind: 'failed_response';
      response: ImportResponse;
      errorCode: string;
      failurePhase: string;
      recordsRead: number;
      recordsRejected: number;
      validationErrorCount: number;
    };

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userBootstrap: SingleUserBootstrap,
    private readonly tmdbService: TmdbService,
    private readonly pipelineTracking: PipelineTrackingService,
  ) {}

  // ── JSON Import ──────────────────────────────────────────────────────────────

  public async importJson(fileBuffer: Buffer): Promise<ImportResponse> {
    return this.runTrackedImport(
      PIPELINE_NAMES.IMPORT_JSON,
      'json',
      fileBuffer.byteLength,
      async (onProgress, setRecordsRead) => {
        if (fileBuffer.byteLength > MAX_JSON_BYTES) {
          throw new PayloadTooLargeException(
            `JSON import file exceeds the maximum allowed size of ${MAX_JSON_BYTES / 1024 / 1024} MB.`,
          );
        }

        let raw: unknown;
        try {
          raw = JSON.parse(fileBuffer.toString('utf-8'));
        } catch {
          throw new BadRequestException('Failed to parse JSON: file contains invalid JSON syntax.');
        }

        const parsedEntryCount =
          typeof raw === 'object' &&
          raw !== null &&
          !Array.isArray(raw) &&
          Array.isArray((raw as { entries?: unknown }).entries)
            ? (raw as { entries: unknown[] }).entries.length
            : 0;
        setRecordsRead(parsedEntryCount);

        // Validate structure
        const { document, errors } = validateJsonImport(raw);

        if (errors.length > 0) {
          return {
            kind: 'failed_response',
            response: this.validationFailureResponse(errors, 0),
            errorCode: PIPELINE_ERROR_CODES.VALIDATION_FAILED,
            failurePhase: 'schema_validation',
            recordsRead: parsedEntryCount,
            recordsRejected: this.countDistinctRejectedIndices(errors, 0),
            validationErrorCount: errors.length,
          };
        }

        return this.processJsonDocument(document!, onProgress, setRecordsRead);
      },
    );
  }

  // ── CSV Import ───────────────────────────────────────────────────────────────

  public async importCsv(fileBuffer: Buffer): Promise<ImportResponse> {
    return this.runTrackedImport(
      PIPELINE_NAMES.IMPORT_CSV,
      'csv',
      fileBuffer.byteLength,
      async (onProgress, setRecordsRead) => {
        if (fileBuffer.byteLength > MAX_CSV_BYTES) {
          throw new PayloadTooLargeException(
            `CSV import file exceeds the maximum allowed size of ${MAX_CSV_BYTES / 1024 / 1024} MB.`,
          );
        }

        const csvText = fileBuffer.toString('utf-8');
        const { rows, errors } = validateCsvImport(csvText);

        if (errors.length > 0) {
          // CSV data rows start at physical line 2 (index > 0); header/parse errors use index 0.
          const rejectedRows = this.countDistinctRejectedIndices(errors, 1);
          const recordsRead = Math.max(rows.length, rejectedRows);
          setRecordsRead(recordsRead);

          return {
            kind: 'failed_response',
            response: this.validationFailureResponse(errors, 0),
            errorCode: PIPELINE_ERROR_CODES.VALIDATION_FAILED,
            failurePhase: 'schema_validation',
            recordsRead,
            recordsRejected: rejectedRows,
            validationErrorCount: errors.length,
          };
        }

        setRecordsRead(rows.length);
        return this.processCsvRows(rows, onProgress);
      },
    );
  }

  // ── Tracked Import Wrapper ───────────────────────────────────────────────────

  private async runTrackedImport(
    pipelineName: string,
    format: 'json' | 'csv',
    fileSizeBytes: number,
    execute: (
      onProgress: () => Promise<void>,
      setRecordsRead: (count: number) => void,
    ) => Promise<TrackedImportOutcome>,
  ): Promise<ImportResponse> {
    const runId = await this.pipelineTracking.startRun({
      pipelineName,
      triggerType: PipelineTriggerType.MANUAL,
      metadata: { format, fileSizeBytes },
    });

    const throttler = new HeartbeatThrottler(IMPORT_HEARTBEAT_INTERVAL_MS);
    const onProgress = async (): Promise<void> => {
      await throttler.maybeBeat(runId, this.pipelineTracking);
    };

    let latestRecordsRead = 0;
    const setRecordsRead = (count: number): void => {
      latestRecordsRead = count;
    };

    let finalized = false;

    try {
      const outcome = await execute(onProgress, setRecordsRead);

      if (outcome.kind === 'succeeded') {
        await this.pipelineTracking.completeRun(runId, {
          status: PipelineRunStatus.SUCCEEDED,
          recordsRead: outcome.recordsRead,
          recordsInserted: outcome.recordsInserted,
          recordsUpdated: 0,
          recordsSkipped: outcome.recordsSkipped,
          recordsRejected: 0,
        });
      } else {
        await this.pipelineTracking.failRun(runId, {
          errorCode: outcome.errorCode,
          recordsRead: outcome.recordsRead,
          recordsInserted: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          recordsRejected: outcome.recordsRejected,
          metadata: {
            format,
            fileSizeBytes,
            failurePhase: outcome.failurePhase,
            validationErrorCount: outcome.validationErrorCount,
          },
        });
      }

      finalized = true;
      return outcome.response;
    } catch (error: unknown) {
      let errorCode: string = PIPELINE_ERROR_CODES.UNEXPECTED_ERROR;
      let failurePhase = 'unexpected';
      let recordsRead = latestRecordsRead;
      let rethrowError: unknown = error;

      if (error instanceof PayloadTooLargeException) {
        errorCode = PIPELINE_ERROR_CODES.PAYLOAD_TOO_LARGE;
        failurePhase = 'size_limit';
        recordsRead = 0;
      } else if (error instanceof BadRequestException) {
        errorCode = PIPELINE_ERROR_CODES.MALFORMED_JSON;
        failurePhase = 'json_parse';
        recordsRead = 0;
      } else if (error instanceof ImportPersistenceError) {
        errorCode = PIPELINE_ERROR_CODES.PERSISTENCE_ERROR;
        failurePhase = 'persistence';
        recordsRead = error.recordsRead;
        rethrowError = error.originalError;
      }

      await this.pipelineTracking.failRun(runId, {
        errorCode,
        recordsRead,
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        // Atomic DB rollback / runtime failure must not mark input records as validation-rejected
        recordsRejected: 0,
        metadata: {
          format,
          fileSizeBytes,
          failurePhase,
        },
      });

      finalized = true;
      throw rethrowError;
    } finally {
      if (!finalized) {
        await this.pipelineTracking.failRun(runId, {
          errorCode: PIPELINE_ERROR_CODES.UNEXPECTED_ERROR,
          recordsRead: latestRecordsRead,
          recordsRejected: 0,
          metadata: {
            format,
            fileSizeBytes,
            failurePhase: 'unexpected',
          },
        });
      }
    }
  }

  private countDistinctRejectedIndices(
    errors: ImportValidationError[],
    minValidIndex: number,
  ): number {
    const indices = new Set<number>();
    for (const err of errors) {
      if (
        typeof err.index === 'number' &&
        Number.isInteger(err.index) &&
        err.index >= minValidIndex
      ) {
        indices.add(err.index);
      }
    }
    return indices.size;
  }

  // ── JSON Processing ──────────────────────────────────────────────────────────

  private async processJsonDocument(
    document: ImportDocument,
    onProgress: () => Promise<void>,
    setRecordsRead: (count: number) => void,
  ): Promise<TrackedImportOutcome> {
    const userId = this.userBootstrap.getUserId();
    const entries = document.entries;
    const total = entries.length;
    setRecordsRead(total);

    if (total === 0) {
      return {
        kind: 'succeeded',
        response: {
          success: true,
          total: 0,
          imported: 0,
          skipped: 0,
          errors: [],
          summary: 'Import file contained no entries.',
        },
        recordsRead: 0,
        recordsInserted: 0,
        recordsSkipped: 0,
      };
    }

    // Phase 1: Resolve all catalogue references OUTSIDE the transaction.
    // If a TMDB item doesn't exist locally, ingest it via TmdbService.
    // Collect any resolution errors (missing TMDB IDs etc.) before persisting.
    const resolutionResults = await this.resolveJsonEntries(entries, onProgress);

    if (resolutionResults.errors.length > 0) {
      return {
        kind: 'failed_response',
        response: this.validationFailureResponse(resolutionResults.errors, total),
        errorCode: PIPELINE_ERROR_CODES.REFERENCE_RESOLUTION_FAILED,
        failurePhase: 'tmdb_resolution',
        recordsRead: total,
        recordsRejected: this.countDistinctRejectedIndices(resolutionResults.errors, 0),
        validationErrorCount: resolutionResults.errors.length,
      };
    }

    // Phase 1b: Validate episode and season references against the catalogue.
    // If any referenced episode/season does not exist or belongs to a different show,
    // reject the entire import — never silently discard supplied progress records.
    const referenceErrors = await this.validateJsonEntryReferences(
      entries,
      resolutionResults.resolvedIds,
    );

    if (referenceErrors.length > 0) {
      return {
        kind: 'failed_response',
        response: this.validationFailureResponse(referenceErrors, total),
        errorCode: PIPELINE_ERROR_CODES.REFERENCE_VALIDATION_FAILED,
        failurePhase: 'reference_validation',
        recordsRead: total,
        recordsRejected: this.countDistinctRejectedIndices(referenceErrors, 0),
        validationErrorCount: referenceErrors.length,
      };
    }

    // Phase 2: Check which entries already exist in the user's library.
    // Existing entries are SKIPPED (not overwritten) — safe import semantics.
    const { newEntries, skippedCount } = await this.partitionJsonEntries(
      userId,
      entries,
      resolutionResults.resolvedIds,
    );

    if (newEntries.length === 0) {
      return {
        kind: 'succeeded',
        response: {
          success: true,
          total,
          imported: 0,
          skipped: skippedCount,
          errors: [],
          summary: `All ${skippedCount} ${skippedCount === 1 ? 'entry' : 'entries'} already exist in your library — nothing imported.`,
        },
        recordsRead: total,
        recordsInserted: 0,
        recordsSkipped: skippedCount,
      };
    }

    // Phase 3: Persist all new data in a single READ COMMITTED transaction.
    let importedCount: number;
    try {
      importedCount = await this.persistJsonEntries(
        userId,
        newEntries,
        resolutionResults.resolvedIds,
      );
    } catch (persistErr: unknown) {
      throw new ImportPersistenceError(persistErr, total);
    }

    const totalSkipped = skippedCount;
    return {
      kind: 'succeeded',
      response: {
        success: true,
        total,
        imported: importedCount,
        skipped: totalSkipped,
        errors: [],
        summary:
          `Imported ${importedCount} ${importedCount === 1 ? 'entry' : 'entries'}` +
          (totalSkipped > 0 ? `, skipped ${totalSkipped} already existing` : '') +
          '.',
      },
      recordsRead: total,
      recordsInserted: importedCount,
      recordsSkipped: totalSkipped,
    };
  }

  /**
   * Resolve TMDB IDs → internal UUIDs for all entries.
   * Returns a map keyed by entry index.
   */
  private async resolveJsonEntries(
    entries: ImportEntry[],
    onProgress: () => Promise<void>,
  ): Promise<{
    resolvedIds: Map<number, { movieId?: string; tvShowId?: string }>;
    errors: ImportValidationError[];
  }> {
    const resolvedIds = new Map<number, { movieId?: string; tvShowId?: string }>();
    const errors: ImportValidationError[] = [];

    for (let i = 0; i < entries.length; i++) {
      await onProgress();
      const entry = entries[i];
      try {
        if (entry.mediaType === 'MOVIE') {
          const movie = await this.resolveOrIngestMovie(entry.tmdbId);
          if (!movie) {
            errors.push({
              index: i,
              field: 'tmdbId',
              message: `Entry ${i}: Could not resolve movie with TMDB ID ${entry.tmdbId}. Verify the TMDB ID is correct.`,
            });
          } else {
            resolvedIds.set(i, { movieId: movie.id });
          }
        } else {
          const tvShow = await this.resolveOrIngestTvShow(entry.tmdbId);
          if (!tvShow) {
            errors.push({
              index: i,
              field: 'tmdbId',
              message: `Entry ${i}: Could not resolve TV show with TMDB ID ${entry.tmdbId}. Verify the TMDB ID is correct.`,
            });
          } else {
            resolvedIds.set(i, { tvShowId: tvShow.id });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          index: i,
          field: 'tmdbId',
          message: `Entry ${i}: Failed to resolve TMDB ID ${entry.tmdbId} — ${msg}`,
        });
      }
    }

    return { resolvedIds, errors };
  }

  /**
   * Validate that all referenced episode and season TMDB IDs exist in the local
   * catalogue (post-ingestion) and belong to the correct TV show.
   * Never silently discard or skip missing/mismatched sub-records.
   */
  private async validateJsonEntryReferences(
    entries: ImportEntry[],
    resolvedIds: Map<number, { movieId?: string; tvShowId?: string }>,
  ): Promise<ImportValidationError[]> {
    const errors: ImportValidationError[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.mediaType !== 'TV') continue;

      const resolved = resolvedIds.get(i);
      if (!resolved?.tvShowId) continue;

      // Validate episode references
      if (entry.episodeProgress && entry.episodeProgress.length > 0) {
        for (let epIdx = 0; epIdx < entry.episodeProgress.length; epIdx++) {
          const ep = entry.episodeProgress[epIdx];
          const episode = await this.prisma.episode.findFirst({
            where: { tmdbId: ep.episodeTmdbId },
            select: { id: true, season: { select: { tvShowId: true } } },
          });

          if (!episode) {
            errors.push({
              index: i,
              field: `episodeProgress[${epIdx}].episodeTmdbId`,
              message: `Entry ${i}: Episode TMDB ID ${ep.episodeTmdbId} not found in catalogue.`,
            });
          } else if (episode.season.tvShowId !== resolved.tvShowId) {
            errors.push({
              index: i,
              field: `episodeProgress[${epIdx}].episodeTmdbId`,
              message: `Entry ${i}: Episode TMDB ID ${ep.episodeTmdbId} belongs to a different TV show.`,
            });
          }
        }
      }

      // Validate season references
      if (entry.seasonRatings && entry.seasonRatings.length > 0) {
        for (let srIdx = 0; srIdx < entry.seasonRatings.length; srIdx++) {
          const sr = entry.seasonRatings[srIdx];
          const season = await this.prisma.season.findFirst({
            where: { tmdbId: sr.seasonTmdbId },
            select: { id: true, tvShowId: true },
          });

          if (!season) {
            errors.push({
              index: i,
              field: `seasonRatings[${srIdx}].seasonTmdbId`,
              message: `Entry ${i}: Season TMDB ID ${sr.seasonTmdbId} not found in catalogue.`,
            });
          } else if (season.tvShowId !== resolved.tvShowId) {
            errors.push({
              index: i,
              field: `seasonRatings[${srIdx}].seasonTmdbId`,
              message: `Entry ${i}: Season TMDB ID ${sr.seasonTmdbId} belongs to a different TV show.`,
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Partition entries into new (to import) vs already existing (to skip).
   */
  private async partitionJsonEntries(
    userId: string,
    entries: ImportEntry[],
    resolvedIds: Map<number, { movieId?: string; tvShowId?: string }>,
  ): Promise<{ newEntries: Array<{ entry: ImportEntry; index: number }>; skippedCount: number }> {
    const newEntries: Array<{ entry: ImportEntry; index: number }> = [];
    let skippedCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const resolved = resolvedIds.get(i);
      if (!resolved) continue;

      const exists = await this.entryExistsForUser(userId, resolved.movieId, resolved.tvShowId);
      if (exists) {
        skippedCount++;
      } else {
        newEntries.push({ entry: entries[i], index: i });
      }
    }

    return { newEntries, skippedCount };
  }

  /**
   * Persist all new JSON entries in a single READ COMMITTED transaction.
   */
  private async persistJsonEntries(
    userId: string,
    newEntries: Array<{ entry: ImportEntry; index: number }>,
    resolvedIds: Map<number, { movieId?: string; tvShowId?: string }>,
  ): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        let importedCount = 0;

        for (const { entry, index } of newEntries) {
          const resolved = resolvedIds.get(index)!;

          // Create the library entry
          const libraryEntry = await tx.userLibraryEntry.create({
            data: {
              userId,
              mediaType: entry.mediaType === 'MOVIE' ? 'MOVIE' : 'TV',
              movieId: resolved.movieId ?? null,
              tvShowId: resolved.tvShowId ?? null,
              status: entry.status as 'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED',
              personalRating:
                entry.personalRating !== undefined && entry.personalRating !== null
                  ? new Prisma.Decimal(entry.personalRating.toFixed(2))
                  : null,
              notes: entry.notes ?? null,
              ...(entry.createdAt ? { createdAt: new Date(entry.createdAt) } : {}),
            },
          });

          // Viewing events (movies only)
          if (
            entry.mediaType === 'MOVIE' &&
            entry.viewingEvents &&
            entry.viewingEvents.length > 0
          ) {
            for (const ev of entry.viewingEvents) {
              await tx.viewingEvent.create({
                data: {
                  libraryEntryId: libraryEntry.id,
                  watchedAt: new Date(ev.watchedAt),
                  rating:
                    ev.rating !== undefined && ev.rating !== null
                      ? new Prisma.Decimal(ev.rating.toFixed(2))
                      : null,
                  notes: ev.notes ?? null,
                },
              });
            }
          }

          // Episode progress (TV only)
          if (
            entry.mediaType === 'TV' &&
            entry.episodeProgress &&
            entry.episodeProgress.length > 0
          ) {
            // Resolve episode TMDB IDs → internal episode UUIDs
            for (const ep of entry.episodeProgress) {
              const episode = await tx.episode.findFirst({
                where: { tmdbId: ep.episodeTmdbId },
                select: { id: true, season: { select: { tvShowId: true } } },
              });

              if (!episode || episode.season.tvShowId !== resolved.tvShowId) {
                throw new Error(
                  `Episode TMDB ID ${ep.episodeTmdbId} unexpectedly invalid or mismatched during persistence.`,
                );
              }

              // Use upsert to handle concurrent inserts safely
              await tx.episodeProgress.upsert({
                where: {
                  libraryEntryId_episodeId: {
                    libraryEntryId: libraryEntry.id,
                    episodeId: episode.id,
                  },
                },
                create: {
                  libraryEntryId: libraryEntry.id,
                  episodeId: episode.id,
                  watchedAt: ep.watchedAt ? new Date(ep.watchedAt) : null,
                },
                update: {}, // already exists (shouldn't happen for a new entry)
              });
            }
          }

          // Season ratings (TV only)
          if (entry.mediaType === 'TV' && entry.seasonRatings && entry.seasonRatings.length > 0) {
            for (const sr of entry.seasonRatings) {
              const season = await tx.season.findFirst({
                where: { tmdbId: sr.seasonTmdbId },
                select: { id: true, tvShowId: true },
              });

              if (!season || season.tvShowId !== resolved.tvShowId) {
                throw new Error(
                  `Season TMDB ID ${sr.seasonTmdbId} unexpectedly invalid or mismatched during persistence.`,
                );
              }

              await tx.seasonRating.upsert({
                where: {
                  libraryEntryId_seasonId: {
                    libraryEntryId: libraryEntry.id,
                    seasonId: season.id,
                  },
                },
                create: {
                  libraryEntryId: libraryEntry.id,
                  seasonId: season.id,
                  rating: new Prisma.Decimal(sr.rating.toFixed(2)),
                },
                update: {},
              });
            }
          }

          importedCount++;
        }

        return importedCount;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  // ── CSV Processing ───────────────────────────────────────────────────────────

  private async processCsvRows(
    rows: CsvImportRow[],
    onProgress: () => Promise<void>,
  ): Promise<TrackedImportOutcome> {
    const userId = this.userBootstrap.getUserId();
    const total = rows.length;

    if (total === 0) {
      return {
        kind: 'succeeded',
        response: {
          success: true,
          total: 0,
          imported: 0,
          skipped: 0,
          errors: [],
          summary: 'CSV file contained no data rows.',
        },
        recordsRead: 0,
        recordsInserted: 0,
        recordsSkipped: 0,
      };
    }

    // Resolve catalogue references
    const resolutionErrors: ImportValidationError[] = [];
    const resolvedRows: Array<{
      row: CsvImportRow;
      rowNumber: number;
      movieId?: string;
      tvShowId?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      await onProgress();
      const row = rows[i];
      const tmdbId = parseInt(row.tmdb_id.trim(), 10);
      const mediaType = row.media_type.trim().toUpperCase();
      const rowNumber = row._rowNumber ?? i + 1;

      try {
        if (mediaType === 'MOVIE') {
          const movie = await this.resolveOrIngestMovie(tmdbId);
          if (!movie) {
            resolutionErrors.push({
              index: rowNumber,
              field: 'tmdb_id',
              message: `Row ${rowNumber}: Could not resolve movie with TMDB ID ${tmdbId}.`,
            });
          } else {
            resolvedRows.push({ row, rowNumber, movieId: movie.id });
          }
        } else {
          const tvShow = await this.resolveOrIngestTvShow(tmdbId);
          if (!tvShow) {
            resolutionErrors.push({
              index: rowNumber,
              field: 'tmdb_id',
              message: `Row ${rowNumber}: Could not resolve TV show with TMDB ID ${tmdbId}.`,
            });
          } else {
            resolvedRows.push({ row, rowNumber, tvShowId: tvShow.id });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        resolutionErrors.push({
          index: rowNumber,
          field: 'tmdb_id',
          message: `Row ${rowNumber}: Failed to resolve TMDB ID ${tmdbId} — ${msg}`,
        });
      }
    }

    if (resolutionErrors.length > 0) {
      return {
        kind: 'failed_response',
        response: this.validationFailureResponse(resolutionErrors, total),
        errorCode: PIPELINE_ERROR_CODES.REFERENCE_RESOLUTION_FAILED,
        failurePhase: 'tmdb_resolution',
        recordsRead: total,
        recordsRejected: this.countDistinctRejectedIndices(resolutionErrors, 1),
        validationErrorCount: resolutionErrors.length,
      };
    }

    // Partition into new vs existing
    let skippedCount = 0;
    const toImport: typeof resolvedRows = [];

    for (const resolved of resolvedRows) {
      const exists = await this.entryExistsForUser(userId, resolved.movieId, resolved.tvShowId);
      if (exists) {
        skippedCount++;
      } else {
        toImport.push(resolved);
      }
    }

    if (toImport.length === 0) {
      return {
        kind: 'succeeded',
        response: {
          success: true,
          total,
          imported: 0,
          skipped: skippedCount,
          errors: [],
          summary: `All ${skippedCount} ${skippedCount === 1 ? 'entry' : 'entries'} already exist in your library — nothing imported.`,
        },
        recordsRead: total,
        recordsInserted: 0,
        recordsSkipped: skippedCount,
      };
    }

    // Persist in a single transaction
    let importedCount: number;
    try {
      importedCount = await this.prisma.$transaction(
        async (tx) => {
          let count = 0;

          for (const { row, movieId, tvShowId } of toImport) {
            const status = row.status.trim().toUpperCase() as
              'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED';
            const mediaType = row.media_type.trim().toUpperCase() as 'MOVIE' | 'TV';

            const personalRating =
              row.personal_rating && row.personal_rating.trim() !== ''
                ? parseFloat(row.personal_rating.trim())
                : null;

            const createdAt =
              row.created_at && row.created_at.trim() !== ''
                ? new Date(row.created_at.trim())
                : undefined;

            await tx.userLibraryEntry.create({
              data: {
                userId,
                mediaType,
                movieId: movieId ?? null,
                tvShowId: tvShowId ?? null,
                status,
                personalRating:
                  personalRating !== null ? new Prisma.Decimal(personalRating.toFixed(2)) : null,
                notes: row.notes && row.notes.trim() !== '' ? row.notes.trim() : null,
                ...(createdAt ? { createdAt } : {}),
              },
            });

            count++;
          }

          return count;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (persistErr: unknown) {
      throw new ImportPersistenceError(persistErr, total);
    }

    return {
      kind: 'succeeded',
      response: {
        success: true,
        total,
        imported: importedCount,
        skipped: skippedCount,
        errors: [],
        summary:
          `Imported ${importedCount} ${importedCount === 1 ? 'entry' : 'entries'}` +
          (skippedCount > 0 ? `, skipped ${skippedCount} already existing` : '') +
          '.',
      },
      recordsRead: total,
      recordsInserted: importedCount,
      recordsSkipped: skippedCount,
    };
  }

  // ── Catalogue Resolution Helpers ─────────────────────────────────────────────

  private async resolveOrIngestMovie(tmdbId: number): Promise<{ id: string } | null> {
    // Check local catalogue first
    const existing = await this.prisma.movie.findUnique({
      where: { tmdbId },
      select: { id: true },
    });

    if (existing) return existing;

    // Attempt TMDB ingestion
    try {
      const ingested = await this.tmdbService.ingestMovie(tmdbId);
      return { id: ingested.id };
    } catch (err: unknown) {
      this.logger.warn(`Import: Could not ingest movie TMDB ID ${tmdbId}: ${String(err)}`);
      return null;
    }
  }

  private async resolveOrIngestTvShow(tmdbId: number): Promise<{ id: string } | null> {
    const existing = await this.prisma.tvShow.findUnique({
      where: { tmdbId },
      select: { id: true },
    });

    if (existing) return existing;

    try {
      const ingested = await this.tmdbService.ingestTvShow(tmdbId);
      return { id: ingested.id };
    } catch (err: unknown) {
      this.logger.warn(`Import: Could not ingest TV show TMDB ID ${tmdbId}: ${String(err)}`);
      return null;
    }
  }

  private async entryExistsForUser(
    userId: string,
    movieId?: string,
    tvShowId?: string,
  ): Promise<boolean> {
    if (movieId) {
      const count = await this.prisma.userLibraryEntry.count({
        where: { userId, movieId },
      });
      return count > 0;
    }

    if (tvShowId) {
      const count = await this.prisma.userLibraryEntry.count({
        where: { userId, tvShowId },
      });
      return count > 0;
    }

    return false;
  }

  // ── Response Helpers ─────────────────────────────────────────────────────────

  private validationFailureResponse(
    errors: ImportValidationError[],
    total: number,
  ): ImportResponse {
    return {
      success: false,
      total,
      imported: 0,
      skipped: 0,
      errors,
      summary: `Import failed with ${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'}. No personal tracking records were written.`,
    };
  }
}
