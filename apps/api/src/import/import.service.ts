// ==============================================================================
// CineSphere — Import Service
// Phase 4.4: Orchestrates JSON and CSV import logic.
//
// Architecture:
//   1. Validate entire payload (collect all errors — never partial writes).
//   2. Resolve catalogue references via TMDB (outside transactions).
//   3. Persist all data in a single READ COMMITTED transaction.
//   4. On any failure: full rollback; existing data untouched.
// ==============================================================================

import { BadRequestException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImportResponse, ImportValidationError } from '@cinesphere/shared';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
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

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userBootstrap: SingleUserBootstrap,
    private readonly tmdbService: TmdbService,
  ) {}

  // ── JSON Import ──────────────────────────────────────────────────────────────

  public async importJson(fileBuffer: Buffer): Promise<ImportResponse> {
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

    // Validate structure
    const { document, errors } = validateJsonImport(raw);

    if (errors.length > 0) {
      return this.validationFailureResponse(errors, 0);
    }

    return this.processJsonDocument(document!);
  }

  // ── CSV Import ───────────────────────────────────────────────────────────────

  public async importCsv(fileBuffer: Buffer): Promise<ImportResponse> {
    if (fileBuffer.byteLength > MAX_CSV_BYTES) {
      throw new PayloadTooLargeException(
        `CSV import file exceeds the maximum allowed size of ${MAX_CSV_BYTES / 1024 / 1024} MB.`,
      );
    }

    const csvText = fileBuffer.toString('utf-8');
    const { rows, errors } = validateCsvImport(csvText);

    if (errors.length > 0) {
      return this.validationFailureResponse(errors, 0);
    }

    return this.processCsvRows(rows);
  }

  // ── JSON Processing ──────────────────────────────────────────────────────────

  private async processJsonDocument(document: ImportDocument): Promise<ImportResponse> {
    const userId = this.userBootstrap.getUserId();
    const entries = document.entries;
    const total = entries.length;

    if (total === 0) {
      return {
        success: true,
        total: 0,
        imported: 0,
        skipped: 0,
        errors: [],
        summary: 'Import file contained no entries.',
      };
    }

    // Phase 1: Resolve all catalogue references OUTSIDE the transaction.
    // If a TMDB item doesn't exist locally, ingest it via TmdbService.
    // Collect any resolution errors (missing TMDB IDs etc.) before persisting.
    const resolutionResults = await this.resolveJsonEntries(entries);

    if (resolutionResults.errors.length > 0) {
      return this.validationFailureResponse(resolutionResults.errors, total);
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
        success: true,
        total,
        imported: 0,
        skipped: skippedCount,
        errors: [],
        summary: `All ${skippedCount} ${skippedCount === 1 ? 'entry' : 'entries'} already exist in your library — nothing imported.`,
      };
    }

    // Phase 3: Persist all new data in a single READ COMMITTED transaction.
    const importedCount = await this.persistJsonEntries(
      userId,
      newEntries,
      resolutionResults.resolvedIds,
    );

    const totalSkipped = skippedCount;
    return {
      success: true,
      total,
      imported: importedCount,
      skipped: totalSkipped,
      errors: [],
      summary:
        `Imported ${importedCount} ${importedCount === 1 ? 'entry' : 'entries'}` +
        (totalSkipped > 0 ? `, skipped ${totalSkipped} already existing` : '') +
        '.',
    };
  }

  /**
   * Resolve TMDB IDs → internal UUIDs for all entries.
   * Returns a map keyed by entry index.
   */
  private async resolveJsonEntries(entries: ImportEntry[]): Promise<{
    resolvedIds: Map<number, { movieId?: string; tvShowId?: string }>;
    errors: ImportValidationError[];
  }> {
    const resolvedIds = new Map<number, { movieId?: string; tvShowId?: string }>();
    const errors: ImportValidationError[] = [];

    for (let i = 0; i < entries.length; i++) {
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
                  watchedAt: ev.watchedAt ? new Date(ev.watchedAt) : new Date(),
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

              if (!episode) {
                this.logger.warn(
                  `Import: Episode TMDB ID ${ep.episodeTmdbId} not found in catalogue — skipping episode progress record.`,
                );
                continue;
              }

              // Verify episode belongs to the correct TV show
              if (episode.season.tvShowId !== resolved.tvShowId) {
                this.logger.warn(
                  `Import: Episode TMDB ID ${ep.episodeTmdbId} belongs to a different TV show — skipping.`,
                );
                continue;
              }

              // Use createMany with skipDuplicates to handle concurrent inserts safely
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
                  watchedAt: ep.watchedAt ? new Date(ep.watchedAt) : new Date(),
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

              if (!season) {
                this.logger.warn(
                  `Import: Season TMDB ID ${sr.seasonTmdbId} not found in catalogue — skipping season rating.`,
                );
                continue;
              }

              if (season.tvShowId !== resolved.tvShowId) {
                this.logger.warn(
                  `Import: Season TMDB ID ${sr.seasonTmdbId} belongs to a different TV show — skipping.`,
                );
                continue;
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

  private async processCsvRows(rows: CsvImportRow[]): Promise<ImportResponse> {
    const userId = this.userBootstrap.getUserId();
    const total = rows.length;

    if (total === 0) {
      return {
        success: true,
        total: 0,
        imported: 0,
        skipped: 0,
        errors: [],
        summary: 'CSV file contained no data rows.',
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
      const row = rows[i];
      const tmdbId = parseInt(row.tmdb_id.trim(), 10);
      const mediaType = row.media_type.trim().toUpperCase();
      const rowNumber = i + 1; // 1-based for display

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
      return this.validationFailureResponse(resolutionErrors, total);
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
        success: true,
        total,
        imported: 0,
        skipped: skippedCount,
        errors: [],
        summary: `All ${skippedCount} ${skippedCount === 1 ? 'entry' : 'entries'} already exist in your library — nothing imported.`,
      };
    }

    // Persist in a single transaction
    const importedCount = await this.prisma.$transaction(
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

    return {
      success: true,
      total,
      imported: importedCount,
      skipped: skippedCount,
      errors: [],
      summary:
        `Imported ${importedCount} ${importedCount === 1 ? 'entry' : 'entries'}` +
        (skippedCount > 0 ? `, skipped ${skippedCount} already existing` : '') +
        '.',
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
      summary: `Import failed with ${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'}. No data was written.`,
    };
  }
}
