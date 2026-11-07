import { Injectable, Logger } from '@nestjs/common';
import { LibraryStatus, MediaType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { DatabaseErrorMapper } from '../database/database-error.mapper.js';
import { ListLibraryQueryDto } from './dto/list-library-query.dto.js';

export interface EntryWithRelations {
  id: string;
  userId: string;
  mediaType: MediaType;
  movieId: string | null;
  tvShowId: string | null;
  status: LibraryStatus;
  personalRating: Prisma.Decimal | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  movie: {
    id: string;
    tmdbId: number;
    title: string;
    posterPath: string | null;
    backdropPath: string | null;
    releaseDate: Date | null;
    voteAverage: number | null;
    runtime: number | null;
  } | null;
  tvShow: {
    id: string;
    tmdbId: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
    firstAirDate: Date | null;
    voteAverage: number | null;
    numberOfSeasons: number | null;
    numberOfEpisodes: number | null;
  } | null;
  viewingEvents?: Array<{
    id: string;
    libraryEntryId: string;
    watchedAt: Date;
    rating: Prisma.Decimal | null;
    notes: string | null;
  }>;
  episodeProgresses?: Array<{
    libraryEntryId: string;
    episodeId: string;
    watchedAt: Date;
    episode?: {
      id: string;
      episodeNumber: number;
      name: string | null;
      season: {
        seasonNumber: number;
      };
    };
  }>;
  seasonRatings?: Array<{
    id: string;
    libraryEntryId: string;
    seasonId: string;
    rating: Prisma.Decimal;
    createdAt: Date;
    updatedAt: Date;
    season?: {
      seasonNumber: number;
    };
  }>;
  _count?: {
    viewingEvents: number;
    episodeProgresses: number;
  };
}

@Injectable()
export class LibraryRepository {
  private readonly logger = new Logger(LibraryRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  public async createEntry(data: {
    userId: string;
    mediaType: MediaType;
    movieId: string | null;
    tvShowId: string | null;
    status: LibraryStatus;
    personalRating?: number | null;
    notes?: string | null;
  }): Promise<EntryWithRelations> {
    try {
      return await this.prisma.userLibraryEntry.create({
        data: {
          userId: data.userId,
          mediaType: data.mediaType,
          movieId: data.movieId,
          tvShowId: data.tvShowId,
          status: data.status,
          personalRating:
            data.personalRating !== undefined && data.personalRating !== null
              ? new Prisma.Decimal(data.personalRating.toFixed(2))
              : null,
          notes: data.notes ?? null,
        },
        include: {
          movie: {
            select: {
              id: true,
              tmdbId: true,
              title: true,
              posterPath: true,
              backdropPath: true,
              releaseDate: true,
              voteAverage: true,
              runtime: true,
            },
          },
          tvShow: {
            select: {
              id: true,
              tmdbId: true,
              name: true,
              posterPath: true,
              backdropPath: true,
              firstAirDate: true,
              voteAverage: true,
              numberOfSeasons: true,
              numberOfEpisodes: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to create library entry.');
    }
  }

  public async findEntries(
    userId: string,
    query: ListLibraryQueryDto,
  ): Promise<{ items: EntryWithRelations[]; totalResults: number; page: number; limit: number; totalPages: number }> {
    const where: Prisma.UserLibraryEntryWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.mediaType ? { mediaType: query.mediaType } : {}),
    };

    const orderBy: Prisma.UserLibraryEntryOrderByWithRelationInput[] = [];
    if (query.sortBy === 'updatedAt') {
      orderBy.push({ updatedAt: query.sortOrder });
    } else if (query.sortBy === 'createdAt') {
      orderBy.push({ createdAt: query.sortOrder });
    } else if (query.sortBy === 'personalRating') {
      orderBy.push({ personalRating: { sort: query.sortOrder, nulls: 'last' } });
    }
    orderBy.push({ id: 'asc' });

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    try {
      const [totalResults, items] = await Promise.all([
        this.prisma.userLibraryEntry.count({ where }),
        this.prisma.userLibraryEntry.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            movie: {
              select: {
                id: true,
                tmdbId: true,
                title: true,
                posterPath: true,
                backdropPath: true,
                releaseDate: true,
                voteAverage: true,
                runtime: true,
              },
            },
            tvShow: {
              select: {
                id: true,
                tmdbId: true,
                name: true,
                posterPath: true,
                backdropPath: true,
                firstAirDate: true,
                voteAverage: true,
                numberOfSeasons: true,
                numberOfEpisodes: true,
              },
            },
            viewingEvents: {
              select: {
                id: true,
                libraryEntryId: true,
                watchedAt: true,
                rating: true,
                notes: true,
              },
              orderBy: { watchedAt: 'asc' },
            },
            _count: {
              select: {
                viewingEvents: true,
                episodeProgresses: true,
              },
            },
          },
        }),
      ]);

      return {
        items,
        totalResults,
        page,
        limit,
        totalPages: Math.ceil(totalResults / limit) || 1,
      };
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to fetch library entries.');
    }
  }

  public async findEntryById(id: string, userId: string): Promise<EntryWithRelations | null> {
    try {
      return await this.prisma.userLibraryEntry.findFirst({
        where: { id, userId },
        include: {
          movie: {
            select: {
              id: true,
              tmdbId: true,
              title: true,
              posterPath: true,
              backdropPath: true,
              releaseDate: true,
              voteAverage: true,
              runtime: true,
            },
          },
          tvShow: {
            select: {
              id: true,
              tmdbId: true,
              name: true,
              posterPath: true,
              backdropPath: true,
              firstAirDate: true,
              voteAverage: true,
              numberOfSeasons: true,
              numberOfEpisodes: true,
            },
          },
          viewingEvents: {
            orderBy: { watchedAt: 'desc' },
          },
          episodeProgresses: {
            include: {
              episode: {
                select: {
                  id: true,
                  episodeNumber: true,
                  name: true,
                  season: {
                    select: {
                      seasonNumber: true,
                    },
                  },
                },
              },
            },
            orderBy: { watchedAt: 'desc' },
          },
          seasonRatings: {
            include: {
              season: {
                select: {
                  seasonNumber: true,
                },
              },
            },
            orderBy: { season: { seasonNumber: 'asc' } },
          },
          _count: {
            select: {
              viewingEvents: true,
              episodeProgresses: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to find library entry.');
    }
  }

  public async updateEntry(
    id: string,
    data: {
      status?: LibraryStatus;
      personalRating?: number | null;
      notes?: string | null;
    },
  ): Promise<EntryWithRelations> {
    try {
      const updatePayload: Prisma.UserLibraryEntryUpdateInput = {
        updatedAt: new Date(),
      };

      if (data.status !== undefined) {
        updatePayload.status = data.status;
      }
      if (data.personalRating !== undefined) {
        updatePayload.personalRating =
          data.personalRating !== null ? new Prisma.Decimal(data.personalRating.toFixed(2)) : null;
      }
      if (data.notes !== undefined) {
        updatePayload.notes = data.notes;
      }

      return await this.prisma.$transaction(
        async (tx) => {
          return tx.userLibraryEntry.update({
            where: { id },
            data: updatePayload,
            include: {
              movie: {
                select: {
                  id: true,
                  tmdbId: true,
                  title: true,
                  posterPath: true,
                  backdropPath: true,
                  releaseDate: true,
                  voteAverage: true,
                  runtime: true,
                },
              },
              tvShow: {
                select: {
                  id: true,
                  tmdbId: true,
                  name: true,
                  posterPath: true,
                  backdropPath: true,
                  firstAirDate: true,
                  voteAverage: true,
                  numberOfSeasons: true,
                  numberOfEpisodes: true,
                },
              },
              _count: {
                select: {
                  viewingEvents: true,
                  episodeProgresses: true,
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to update library entry.');
    }
  }

  public async deleteEntry(id: string): Promise<void> {
    try {
      await this.prisma.userLibraryEntry.delete({
        where: { id },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to delete library entry.');
    }
  }

  public async createViewingEvent(data: {
    libraryEntryId: string;
    watchedAt?: Date;
    rating?: number | null;
    notes?: string | null;
  }) {
    try {
      return await this.prisma.viewingEvent.create({
        data: {
          libraryEntryId: data.libraryEntryId,
          watchedAt: data.watchedAt ?? new Date(),
          rating:
            data.rating !== undefined && data.rating !== null
              ? new Prisma.Decimal(data.rating.toFixed(2))
              : null,
          notes: data.notes ?? null,
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to record viewing event.');
    }
  }

  public async findEpisodeProgress(libraryEntryId: string, episodeId: string) {
    try {
      return await this.prisma.episodeProgress.findUnique({
        where: {
          libraryEntryId_episodeId: {
            libraryEntryId,
            episodeId,
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to query episode progress.');
    }
  }

  public async createEpisodeProgress(libraryEntryId: string, episodeId: string) {
    try {
      return await this.prisma.episodeProgress.create({
        data: {
          libraryEntryId,
          episodeId,
        },
        include: {
          episode: {
            select: {
              id: true,
              episodeNumber: true,
              name: true,
              season: {
                select: {
                  seasonNumber: true,
                },
              },
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to record episode progress.');
    }
  }

  public async deleteEpisodeProgress(libraryEntryId: string, episodeId: string): Promise<number> {
    try {
      const res = await this.prisma.episodeProgress.deleteMany({
        where: {
          libraryEntryId,
          episodeId,
        },
      });
      return res.count;
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to remove episode progress.');
    }
  }

  public async markAllWatched(
    libraryEntryId: string,
    tvShowId: string,
    includeSpecials: boolean,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ result: number }>>`
            INSERT INTO "episode_progress" ("library_entry_id", "episode_id", "watched_at")
            SELECT ${libraryEntryId}::uuid, e."id", CURRENT_TIMESTAMP
            FROM "episodes" e
            JOIN "seasons" s ON e."seasonId" = s."id"
            WHERE s."tvShowId" = ${tvShowId}::uuid
              AND (${includeSpecials}::boolean = TRUE OR s."seasonNumber" > 0)
            ON CONFLICT ("library_entry_id", "episode_id") DO NOTHING
            RETURNING 1 AS result;
          `;
          return rows.length;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to mark all episodes as watched.');
    }
  }

  public async findSeasonRating(libraryEntryId: string, seasonId: string) {
    try {
      return await this.prisma.seasonRating.findUnique({
        where: {
          libraryEntryId_seasonId: {
            libraryEntryId,
            seasonId,
          },
        },
        include: {
          season: {
            select: {
              seasonNumber: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to query season rating.');
    }
  }

  public async createSeasonRating(libraryEntryId: string, seasonId: string, rating: number) {
    try {
      return await this.prisma.seasonRating.create({
        data: {
          libraryEntryId,
          seasonId,
          rating: new Prisma.Decimal(rating.toFixed(2)),
        },
        include: {
          season: {
            select: {
              seasonNumber: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to create season rating.');
    }
  }

  public async updateSeasonRating(id: string, rating: number) {
    try {
      return await this.prisma.seasonRating.update({
        where: { id },
        data: {
          rating: new Prisma.Decimal(rating.toFixed(2)),
          updatedAt: new Date(),
        },
        include: {
          season: {
            select: {
              seasonNumber: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      throw DatabaseErrorMapper.translate(err, 'Failed to update season rating.');
    }
  }
}
