import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  MappedGenre,
  MappedKeyword,
  MappedMovieData,
  MappedPerson,
  MappedSeasonData,
  MappedTvShowData,
} from './tmdb.mapper.js';

export interface MovieFilterOptions {
  query?: string;
  page?: number;
  limit?: number;
  genreId?: number;
  year?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  sortBy?: 'popularity' | 'rating' | 'releaseDate' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface TvShowFilterOptions {
  query?: string;
  page?: number;
  limit?: number;
  genreId?: number;
  firstAirDateYear?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  status?: string;
  sortBy?: 'popularity' | 'rating' | 'firstAirDate' | 'name';
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class CatalogueRepository {
  private readonly logger = new Logger(CatalogueRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  public async upsertGenres(genres: MappedGenre[]): Promise<void> {
    for (const g of genres) {
      await this.prisma.genre.upsert({
        where: { tmdbId: g.tmdbId },
        update: { name: g.name },
        create: { tmdbId: g.tmdbId, name: g.name },
      });
    }
  }

  public async upsertKeywords(keywords: MappedKeyword[]): Promise<void> {
    for (const k of keywords) {
      await this.prisma.keyword.upsert({
        where: { tmdbId: k.tmdbId },
        update: { name: k.name },
        create: { tmdbId: k.tmdbId, name: k.name },
      });
    }
  }

  public async upsertPersons(persons: MappedPerson[]): Promise<Map<number, string>> {
    const personIdMap = new Map<number, string>();

    for (const p of persons) {
      const record = await this.prisma.person.upsert({
        where: { tmdbId: p.tmdbId },
        update: { name: p.name },
        create: { tmdbId: p.tmdbId, name: p.name },
        select: { id: true, tmdbId: true },
      });
      personIdMap.set(record.tmdbId, record.id);
    }

    return personIdMap;
  }

  public async saveMovie(data: MappedMovieData): Promise<{ id: string; syncedAt: Date }> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Ensure genres and keywords are upserted
        for (const g of data.genres) {
          await tx.genre.upsert({
            where: { tmdbId: g.tmdbId },
            update: { name: g.name },
            create: { tmdbId: g.tmdbId, name: g.name },
          });
        }

        for (const k of data.keywords) {
          await tx.keyword.upsert({
            where: { tmdbId: k.tmdbId },
            update: { name: k.name },
            create: { tmdbId: k.tmdbId, name: k.name },
          });
        }

        const now = new Date();

        // 2. Upsert movie
        const movie = await tx.movie.upsert({
          where: { tmdbId: data.tmdbId },
          update: {
            title: data.title,
            originalTitle: data.originalTitle,
            overview: data.overview,
            releaseDate: data.releaseDate,
            runtime: data.runtime,
            originalLanguage: data.originalLanguage,
            popularity: data.popularity,
            voteAverage: data.voteAverage,
            voteCount: data.voteCount,
            posterPath: data.posterPath,
            backdropPath: data.backdropPath,
            adult: data.adult,
            syncedAt: now,
            genres: {
              set: data.genres.map((g) => ({ tmdbId: g.tmdbId })),
            },
            keywords: {
              set: data.keywords.map((k) => ({ tmdbId: k.tmdbId })),
            },
          },
          create: {
            tmdbId: data.tmdbId,
            title: data.title,
            originalTitle: data.originalTitle,
            overview: data.overview,
            releaseDate: data.releaseDate,
            runtime: data.runtime,
            originalLanguage: data.originalLanguage,
            popularity: data.popularity,
            voteAverage: data.voteAverage,
            voteCount: data.voteCount,
            posterPath: data.posterPath,
            backdropPath: data.backdropPath,
            adult: data.adult,
            syncedAt: now,
            genres: {
              connect: data.genres.map((g) => ({ tmdbId: g.tmdbId })),
            },
            keywords: {
              connect: data.keywords.map((k) => ({ tmdbId: k.tmdbId })),
            },
          },
          select: { id: true, syncedAt: true },
        });

        // 3. Upsert persons and sync person credits
        const currentCredits = await tx.personCredit.findMany({
          where: { movieId: movie.id },
          select: { id: true, personId: true },
        });
        const currentCreditPersonIds = new Set(currentCredits.map((c) => c.personId));
        const targetPersonIds = new Set<string>();

        for (const p of data.cast) {
          const personRecord = await tx.person.upsert({
            where: { tmdbId: p.tmdbId },
            update: { name: p.name },
            create: { tmdbId: p.tmdbId, name: p.name },
            select: { id: true },
          });

          targetPersonIds.add(personRecord.id);

          if (!currentCreditPersonIds.has(personRecord.id)) {
            await tx.personCredit.create({
              data: {
                movieId: movie.id,
                personId: personRecord.id,
              },
            });
          }
        }

        // Remove credits for cast members no longer in the updated credits list
        for (const credit of currentCredits) {
          if (!targetPersonIds.has(credit.personId)) {
            await tx.personCredit.delete({
              where: { id: credit.id },
            });
          }
        }

        return { id: movie.id, syncedAt: movie.syncedAt || now };
      },
      { maxWait: 10000, timeout: 20000 },
    );
  }

  public async saveTvShowHeader(data: MappedTvShowData): Promise<{ id: string; syncedAt: Date }> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Ensure genres and keywords are upserted
        for (const g of data.genres) {
          await tx.genre.upsert({
            where: { tmdbId: g.tmdbId },
            update: { name: g.name },
            create: { tmdbId: g.tmdbId, name: g.name },
          });
        }

        for (const k of data.keywords) {
          await tx.keyword.upsert({
            where: { tmdbId: k.tmdbId },
            update: { name: k.name },
            create: { tmdbId: k.tmdbId, name: k.name },
          });
        }

        const now = new Date();

        // 2. Upsert TV show
        const show = await tx.tvShow.upsert({
          where: { tmdbId: data.tmdbId },
          update: {
            name: data.name,
            originalName: data.originalName,
            overview: data.overview,
            firstAirDate: data.firstAirDate,
            lastAirDate: data.lastAirDate,
            originalLanguage: data.originalLanguage,
            popularity: data.popularity,
            voteAverage: data.voteAverage,
            voteCount: data.voteCount,
            posterPath: data.posterPath,
            backdropPath: data.backdropPath,
            status: data.status,
            numberOfSeasons: data.numberOfSeasons,
            numberOfEpisodes: data.numberOfEpisodes,
            syncedAt: now,
            genres: {
              set: data.genres.map((g) => ({ tmdbId: g.tmdbId })),
            },
            keywords: {
              set: data.keywords.map((k) => ({ tmdbId: k.tmdbId })),
            },
          },
          create: {
            tmdbId: data.tmdbId,
            name: data.name,
            originalName: data.originalName,
            overview: data.overview,
            firstAirDate: data.firstAirDate,
            lastAirDate: data.lastAirDate,
            originalLanguage: data.originalLanguage,
            popularity: data.popularity,
            voteAverage: data.voteAverage,
            voteCount: data.voteCount,
            posterPath: data.posterPath,
            backdropPath: data.backdropPath,
            status: data.status,
            numberOfSeasons: data.numberOfSeasons,
            numberOfEpisodes: data.numberOfEpisodes,
            syncedAt: now,
            genres: {
              connect: data.genres.map((g) => ({ tmdbId: g.tmdbId })),
            },
            keywords: {
              connect: data.keywords.map((k) => ({ tmdbId: k.tmdbId })),
            },
          },
          select: { id: true, syncedAt: true },
        });

        // 3. Upsert cast & sync TV credits
        const currentCredits = await tx.personCredit.findMany({
          where: { tvShowId: show.id },
          select: { id: true, personId: true },
        });
        const currentCreditPersonIds = new Set(currentCredits.map((c) => c.personId));
        const targetPersonIds = new Set<string>();

        for (const p of data.cast) {
          const personRecord = await tx.person.upsert({
            where: { tmdbId: p.tmdbId },
            update: { name: p.name },
            create: { tmdbId: p.tmdbId, name: p.name },
            select: { id: true },
          });

          targetPersonIds.add(personRecord.id);

          if (!currentCreditPersonIds.has(personRecord.id)) {
            await tx.personCredit.create({
              data: {
                tvShowId: show.id,
                personId: personRecord.id,
              },
            });
          }
        }

        for (const credit of currentCredits) {
          if (!targetPersonIds.has(credit.personId)) {
            await tx.personCredit.delete({
              where: { id: credit.id },
            });
          }
        }

        return { id: show.id, syncedAt: show.syncedAt || now };
      },
      { maxWait: 10000, timeout: 20000 },
    );
  }

  public async saveSeasonAndEpisodes(
    tvShowId: string,
    seasonData: MappedSeasonData,
  ): Promise<{ seasonId: string; episodeCount: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Upsert season by composite key [tvShowId, seasonNumber]
        const season = await tx.season.upsert({
          where: {
            tvShowId_seasonNumber: {
              tvShowId,
              seasonNumber: seasonData.seasonNumber,
            },
          },
          update: {
            tmdbId: seasonData.tmdbId,
            name: seasonData.name,
            overview: seasonData.overview,
            posterPath: seasonData.posterPath,
            airDate: seasonData.airDate,
          },
          create: {
            tvShowId,
            seasonNumber: seasonData.seasonNumber,
            tmdbId: seasonData.tmdbId,
            name: seasonData.name,
            overview: seasonData.overview,
            posterPath: seasonData.posterPath,
            airDate: seasonData.airDate,
          },
          select: { id: true },
        });

        // 2. Upsert episodes by composite key [seasonId, episodeNumber]
        let episodeCount = 0;
        for (const ep of seasonData.episodes) {
          await tx.episode.upsert({
            where: {
              seasonId_episodeNumber: {
                seasonId: season.id,
                episodeNumber: ep.episodeNumber,
              },
            },
            update: {
              tmdbId: ep.tmdbId,
              name: ep.name,
              overview: ep.overview,
              airDate: ep.airDate,
              runtime: ep.runtime,
            },
            create: {
              seasonId: season.id,
              episodeNumber: ep.episodeNumber,
              tmdbId: ep.tmdbId,
              name: ep.name,
              overview: ep.overview,
              airDate: ep.airDate,
              runtime: ep.runtime,
            },
          });
          episodeCount++;
        }

        return { seasonId: season.id, episodeCount };
      },
      { maxWait: 10000, timeout: 20000 },
    );
  }

  public async findMovies(filter: MovieFilterOptions) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.MovieWhereInput = {};

    if (filter.query && filter.query.trim()) {
      where.title = {
        contains: filter.query.trim(),
        mode: 'insensitive',
      };
    }

    if (filter.genreId !== undefined) {
      where.genres = {
        some: {
          tmdbId: filter.genreId,
        },
      };
    }

    if (filter.year !== undefined) {
      const startOfYear = new Date(Date.UTC(filter.year, 0, 1));
      const endOfYear = new Date(Date.UTC(filter.year, 11, 31, 23, 59, 59, 999));
      where.releaseDate = {
        gte: startOfYear,
        lte: endOfYear,
      };
    }

    if (filter.minRating !== undefined || filter.maxRating !== undefined) {
      where.voteAverage = {};
      if (filter.minRating !== undefined) {
        where.voteAverage.gte = filter.minRating;
      }
      if (filter.maxRating !== undefined) {
        where.voteAverage.lte = filter.maxRating;
      }
    }

    if (filter.language && filter.language.trim()) {
      where.originalLanguage = {
        equals: filter.language.trim(),
        mode: 'insensitive',
      };
    }

    const sortBy = filter.sortBy || 'popularity';
    const sortOrder = filter.sortOrder || 'desc';

    let primaryField: keyof Prisma.MovieOrderByWithRelationInput;
    switch (sortBy) {
      case 'rating':
        primaryField = 'voteAverage';
        break;
      case 'releaseDate':
        primaryField = 'releaseDate';
        break;
      case 'title':
        primaryField = 'title';
        break;
      case 'popularity':
      default:
        primaryField = 'popularity';
        break;
    }

    const orderBy: Prisma.MovieOrderByWithRelationInput[] = [
      primaryField === 'title'
        ? { title: sortOrder }
        : { [primaryField]: { sort: sortOrder, nulls: 'last' } },
      { id: 'asc' },
    ];

    const [items, totalResults] = await Promise.all([
      this.prisma.movie.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          tmdbId: true,
          title: true,
          originalTitle: true,
          overview: true,
          releaseDate: true,
          runtime: true,
          originalLanguage: true,
          popularity: true,
          voteAverage: true,
          voteCount: true,
          posterPath: true,
          backdropPath: true,
          genres: {
            select: {
              tmdbId: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.movie.count({ where }),
    ]);

    return {
      items,
      totalResults,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
    };
  }

  public async findMovieById(id: string) {
    return this.prisma.movie.findUnique({
      where: { id },
      include: {
        genres: {
          select: {
            tmdbId: true,
            name: true,
          },
        },
        keywords: {
          select: {
            tmdbId: true,
            name: true,
          },
        },
        personCredits: {
          select: {
            id: true,
            person: {
              select: {
                id: true,
                tmdbId: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  public async findTvShows(filter: TvShowFilterOptions) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.TvShowWhereInput = {};

    if (filter.query && filter.query.trim()) {
      where.name = {
        contains: filter.query.trim(),
        mode: 'insensitive',
      };
    }

    if (filter.genreId !== undefined) {
      where.genres = {
        some: {
          tmdbId: filter.genreId,
        },
      };
    }

    if (filter.firstAirDateYear !== undefined) {
      const startOfYear = new Date(Date.UTC(filter.firstAirDateYear, 0, 1));
      const endOfYear = new Date(Date.UTC(filter.firstAirDateYear, 11, 31, 23, 59, 59, 999));
      where.firstAirDate = {
        gte: startOfYear,
        lte: endOfYear,
      };
    }

    if (filter.minRating !== undefined || filter.maxRating !== undefined) {
      where.voteAverage = {};
      if (filter.minRating !== undefined) {
        where.voteAverage.gte = filter.minRating;
      }
      if (filter.maxRating !== undefined) {
        where.voteAverage.lte = filter.maxRating;
      }
    }

    if (filter.language && filter.language.trim()) {
      where.originalLanguage = {
        equals: filter.language.trim(),
        mode: 'insensitive',
      };
    }

    if (filter.status && filter.status.trim()) {
      where.status = {
        equals: filter.status.trim(),
        mode: 'insensitive',
      };
    }

    const sortBy = filter.sortBy || 'popularity';
    const sortOrder = filter.sortOrder || 'desc';

    let primaryField: keyof Prisma.TvShowOrderByWithRelationInput;
    switch (sortBy) {
      case 'rating':
        primaryField = 'voteAverage';
        break;
      case 'firstAirDate':
        primaryField = 'firstAirDate';
        break;
      case 'name':
        primaryField = 'name';
        break;
      case 'popularity':
      default:
        primaryField = 'popularity';
        break;
    }

    const orderBy: Prisma.TvShowOrderByWithRelationInput[] = [
      primaryField === 'name'
        ? { name: sortOrder }
        : { [primaryField]: { sort: sortOrder, nulls: 'last' } },
      { id: 'asc' },
    ];

    const [items, totalResults] = await Promise.all([
      this.prisma.tvShow.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          tmdbId: true,
          name: true,
          originalName: true,
          overview: true,
          firstAirDate: true,
          lastAirDate: true,
          originalLanguage: true,
          popularity: true,
          voteAverage: true,
          voteCount: true,
          posterPath: true,
          backdropPath: true,
          status: true,
          numberOfSeasons: true,
          numberOfEpisodes: true,
          genres: {
            select: {
              tmdbId: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.tvShow.count({ where }),
    ]);

    return {
      items,
      totalResults,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
    };
  }

  public async findTvShowById(id: string) {
    return this.prisma.tvShow.findUnique({
      where: { id },
      include: {
        genres: {
          select: {
            tmdbId: true,
            name: true,
          },
        },
        keywords: {
          select: {
            tmdbId: true,
            name: true,
          },
        },
        personCredits: {
          select: {
            id: true,
            person: {
              select: {
                id: true,
                tmdbId: true,
                name: true,
              },
            },
          },
        },
        seasons: {
          orderBy: {
            seasonNumber: 'asc',
          },
          include: {
            episodes: {
              orderBy: {
                episodeNumber: 'asc',
              },
            },
          },
        },
      },
    });
  }
}
