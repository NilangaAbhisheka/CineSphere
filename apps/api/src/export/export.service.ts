// ==============================================================================
// CineSphere — Export Service
// Phase 4.5: Data Export
//
// Responsibilities:
//   1. Resolve current user through SingleUserBootstrap (strictly single-user scoped).
//   2. Retrieve personal library entries and associated tracking data under a
//      single point-in-time snapshot using REPEATABLE READ transaction isolation.
//   3. Enforce Zero Silent Data Loss: if any catalogue entity lacks a valid TMDB ID,
//      or an expected relation is missing, fail clearly with InternalServerErrorException.
//   4. Apply deterministic primary and secondary sorting to entries and nested relations.
//   5. Serialize full-fidelity JSON (compatible with v1.0 importer).
//   6. Serialize RFC 4180 compliant CSV (flat 6-column projection).
// ==============================================================================

import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExportDocument, ImportEntry } from '@cinesphere/shared';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userBootstrap: SingleUserBootstrap,
  ) {}

  /**
   * Exports the user's complete personal library as a full-fidelity JSON string.
   * Compatible with CineSphere JSON Importer v1.0.
   */
  public async exportJson(): Promise<string> {
    const rawEntries = await this.fetchUserLibraryEntries();
    const entries: ImportEntry[] = [];

    for (const entry of rawEntries) {
      if (entry.mediaType === 'MOVIE') {
        if (!entry.movie || entry.movie.tmdbId === null || entry.movie.tmdbId === undefined) {
          throw new InternalServerErrorException(
            `Export failed: Library entry "${entry.id}" (MOVIE) lacks an associated catalogue TMDB ID and cannot be exported without data loss.`,
          );
        }

        entries.push({
          tmdbId: entry.movie.tmdbId,
          mediaType: 'MOVIE',
          status: entry.status,
          personalRating: entry.personalRating !== null ? Number(entry.personalRating) : null,
          notes: entry.notes ?? null,
          createdAt: entry.createdAt.toISOString(),
          viewingEvents: entry.viewingEvents.map((v) => ({
            watchedAt: v.watchedAt.toISOString(),
            rating: v.rating !== null ? Number(v.rating) : null,
            notes: v.notes ?? null,
          })),
        });
      } else {
        if (!entry.tvShow || entry.tvShow.tmdbId === null || entry.tvShow.tmdbId === undefined) {
          throw new InternalServerErrorException(
            `Export failed: Library entry "${entry.id}" (TV) lacks an associated catalogue TMDB ID and cannot be exported without data loss.`,
          );
        }

        // Validate and map episode progress records
        const episodeProgress = entry.episodeProgresses.map((ep) => {
          if (!ep.episode || ep.episode.tmdbId === null || ep.episode.tmdbId === undefined) {
            throw new InternalServerErrorException(
              `Export failed: Episode progress record for episode "${ep.episodeId}" on TV show "${entry.tvShowId}" lacks a catalogue TMDB ID and cannot be exported to v1.0 format without data loss.`,
            );
          }

          return {
            episodeTmdbId: ep.episode.tmdbId,
            watchedAt: ep.watchedAt ? ep.watchedAt.toISOString() : null,
          };
        });

        // Validate and map season rating records
        const seasonRatings = entry.seasonRatings.map((sr) => {
          if (!sr.season || sr.season.tmdbId === null || sr.season.tmdbId === undefined) {
            throw new InternalServerErrorException(
              `Export failed: Season rating record for season "${sr.seasonId}" on TV show "${entry.tvShowId}" lacks a catalogue TMDB ID and cannot be exported to v1.0 format without data loss.`,
            );
          }

          return {
            seasonTmdbId: sr.season.tmdbId,
            rating: Number(sr.rating),
          };
        });

        entries.push({
          tmdbId: entry.tvShow.tmdbId,
          mediaType: 'TV',
          status: entry.status,
          personalRating: entry.personalRating !== null ? Number(entry.personalRating) : null,
          notes: entry.notes ?? null,
          createdAt: entry.createdAt.toISOString(),
          episodeProgress,
          seasonRatings,
        });
      }
    }

    const doc: ExportDocument = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entries,
    };

    return JSON.stringify(doc, null, 2);
  }

  /**
   * Exports the user's personal library as an RFC 4180 compliant CSV string.
   * Flat 6-column projection: tmdb_id,media_type,status,personal_rating,notes,created_at
   */
  public async exportCsv(): Promise<string> {
    const rawEntries = await this.fetchUserLibraryEntries();
    const rows: string[] = ['tmdb_id,media_type,status,personal_rating,notes,created_at'];

    for (const entry of rawEntries) {
      let tmdbId: number;

      if (entry.mediaType === 'MOVIE') {
        if (!entry.movie || entry.movie.tmdbId === null || entry.movie.tmdbId === undefined) {
          throw new InternalServerErrorException(
            `Export failed: Library entry "${entry.id}" (MOVIE) lacks an associated catalogue TMDB ID and cannot be exported without data loss.`,
          );
        }
        tmdbId = entry.movie.tmdbId;
      } else {
        if (!entry.tvShow || entry.tvShow.tmdbId === null || entry.tvShow.tmdbId === undefined) {
          throw new InternalServerErrorException(
            `Export failed: Library entry "${entry.id}" (TV) lacks an associated catalogue TMDB ID and cannot be exported without data loss.`,
          );
        }
        tmdbId = entry.tvShow.tmdbId;
      }

      const mediaType = entry.mediaType.toLowerCase();
      const status = entry.status;
      const rating = entry.personalRating !== null ? Number(entry.personalRating).toFixed(1) : '';
      const notes = entry.notes ?? '';
      const createdAt = entry.createdAt.toISOString();

      const line = [
        this.escapeCsvField(tmdbId),
        this.escapeCsvField(mediaType),
        this.escapeCsvField(status),
        this.escapeCsvField(rating),
        this.escapeCsvField(notes),
        this.escapeCsvField(createdAt),
      ].join(',');

      rows.push(line);
    }

    // Join with standard CRLF (\r\n) per RFC 4180 and append trailing CRLF
    return rows.join('\r\n') + '\r\n';
  }

  /**
   * Executes a read-only query under REPEATABLE READ snapshot isolation to guarantee
   * that all relation queries observe one point-in-time consistent database snapshot.
   */
  private async fetchUserLibraryEntries() {
    const userId = this.userBootstrap.getUserId();

    return this.prisma.$transaction(
      async (tx) => {
        return tx.userLibraryEntry.findMany({
          where: { userId },
          include: {
            movie: { select: { tmdbId: true } },
            tvShow: { select: { tmdbId: true } },
            viewingEvents: {
              select: {
                id: true,
                watchedAt: true,
                rating: true,
                notes: true,
              },
              orderBy: [{ watchedAt: 'asc' }, { id: 'asc' }],
            },
            episodeProgresses: {
              select: {
                episodeId: true,
                watchedAt: true,
                episode: {
                  select: {
                    tmdbId: true,
                    episodeNumber: true,
                    season: { select: { seasonNumber: true } },
                  },
                },
              },
              orderBy: [
                { episode: { season: { seasonNumber: 'asc' } } },
                { episode: { episodeNumber: 'asc' } },
                { episodeId: 'asc' },
              ],
            },
            seasonRatings: {
              select: {
                id: true,
                seasonId: true,
                rating: true,
                season: { select: { tmdbId: true, seasonNumber: true } },
              },
              orderBy: [{ season: { seasonNumber: 'asc' } }, { id: 'asc' }],
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  /**
   * RFC 4180 escaping rule:
   * If a field contains a comma, quote, or newline, it must be enclosed in quotes,
   * and any internal quote must be doubled ("").
   */
  private escapeCsvField(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
