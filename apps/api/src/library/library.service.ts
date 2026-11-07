import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EpisodeProgressResponse,
  LibraryEntryListItem,
  LibraryEntryResponse,
  LibraryWatchStats,
  MarkAllWatchedResponse,
  PaginatedResult,
  SeasonRatingResponse,
  ViewingEventResponse,
} from '@cinesphere/shared';
import { MediaType } from '@prisma/client';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { PrismaService } from '../database/prisma.service.js';
import { TmdbService } from '../tmdb/tmdb.service.js';
import { EntryWithRelations, LibraryRepository } from './library.repository.js';
import { CreateLibraryEntryDto } from './dto/create-library-entry.dto.js';
import { UpdateLibraryEntryDto } from './dto/update-library-entry.dto.js';
import { ListLibraryQueryDto } from './dto/list-library-query.dto.js';
import { CreateViewingEventDto } from './dto/create-viewing-event.dto.js';
import { CreateEpisodeProgressDto } from './dto/create-episode-progress.dto.js';
import { MarkAllWatchedDto } from './dto/mark-all-watched.dto.js';
import { CreateSeasonRatingDto } from './dto/create-season-rating.dto.js';
import { UpdateSeasonRatingDto } from './dto/update-season-rating.dto.js';

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly libraryRepo: LibraryRepository,
    private readonly userBootstrap: SingleUserBootstrap,
    private readonly tmdbService: TmdbService,
    private readonly prisma: PrismaService,
  ) {}

  public async createLibraryEntry(dto: CreateLibraryEntryDto): Promise<LibraryEntryResponse> {
    const userId = this.userBootstrap.getUserId();

    // Verify identifier constraint: exactly one of tmdbId or mediaId must be present
    const hasTmdbId = dto.tmdbId !== undefined && dto.tmdbId !== null;
    const hasMediaId = dto.mediaId !== undefined && dto.mediaId !== null && dto.mediaId.trim() !== '';

    if ((!hasTmdbId && !hasMediaId) || (hasTmdbId && hasMediaId)) {
      throw new BadRequestException('Either tmdbId or mediaId must be provided, but not both.');
    }

    let movieId: string | null = null;
    let tvShowId: string | null = null;

    // Resolve TMDB IDs through existing ingestion layer OUTSIDE transactions
    if (hasTmdbId) {
      if (dto.mediaType === MediaType.MOVIE) {
        let movie = await this.prisma.movie.findUnique({
          where: { tmdbId: dto.tmdbId! },
          select: { id: true },
        });

        if (!movie) {
          const ingested = await this.tmdbService.ingestMovie(dto.tmdbId!);
          movie = { id: ingested.id };
        }
        movieId = movie.id;
      } else {
        let tvShow = await this.prisma.tvShow.findUnique({
          where: { tmdbId: dto.tmdbId! },
          select: { id: true },
        });

        if (!tvShow) {
          const ingested = await this.tmdbService.ingestTvShow(dto.tmdbId!);
          tvShow = { id: ingested.id };
        }
        tvShowId = tvShow.id;
      }
    } else {
      // Validate internal media UUID exists in PostgreSQL
      if (dto.mediaType === MediaType.MOVIE) {
        const movie = await this.prisma.movie.findUnique({
          where: { id: dto.mediaId! },
          select: { id: true },
        });
        if (!movie) {
          throw new NotFoundException(`Movie with ID ${dto.mediaId} was not found in catalogue.`);
        }
        movieId = movie.id;
      } else {
        const tvShow = await this.prisma.tvShow.findUnique({
          where: { id: dto.mediaId! },
          select: { id: true },
        });
        if (!tvShow) {
          throw new NotFoundException(`TV show with ID ${dto.mediaId} was not found in catalogue.`);
        }
        tvShowId = tvShow.id;
      }
    }

    const created = await this.libraryRepo.createEntry({
      userId,
      mediaType: dto.mediaType,
      movieId,
      tvShowId,
      status: dto.status,
      personalRating: dto.personalRating,
      notes: dto.notes,
    });

    return this.mapEntryToResponse(created);
  }

  public async listLibrary(
    query: ListLibraryQueryDto,
  ): Promise<PaginatedResult<LibraryEntryListItem>> {
    const userId = this.userBootstrap.getUserId();
    const { items, totalResults, page, limit, totalPages } = await this.libraryRepo.findEntries(
      userId,
      query,
    );

    const mappedItems: LibraryEntryListItem[] = items.map((item) => this.mapEntryToResponse(item));

    return {
      items: mappedItems,
      totalResults,
      page,
      limit,
      totalPages,
    };
  }

  public async getLibraryEntry(id: string): Promise<LibraryEntryResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    return this.mapEntryToResponse(entry);
  }

  public async updateLibraryEntry(
    id: string,
    dto: UpdateLibraryEntryDto,
  ): Promise<LibraryEntryResponse> {
    const userId = this.userBootstrap.getUserId();
    const existing = await this.libraryRepo.findEntryById(id, userId);

    if (!existing) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    const updated = await this.libraryRepo.updateEntry(id, dto);
    return this.mapEntryToResponse(updated);
  }

  public async deleteLibraryEntry(id: string): Promise<void> {
    const userId = this.userBootstrap.getUserId();
    const existing = await this.libraryRepo.findEntryById(id, userId);

    if (!existing) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    await this.libraryRepo.deleteEntry(id);
  }

  public async createViewingEvent(
    id: string,
    dto: CreateViewingEventDto,
  ): Promise<ViewingEventResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    const event = await this.libraryRepo.createViewingEvent({
      libraryEntryId: id,
      watchedAt: dto.watchedAt ? new Date(dto.watchedAt) : undefined,
      rating: dto.rating,
      notes: dto.notes,
    });

    return {
      id: event.id,
      libraryEntryId: event.libraryEntryId,
      watchedAt: event.watchedAt.toISOString(),
      rating: event.rating ? Number(event.rating) : null,
      notes: event.notes,
    };
  }

  public async createEpisodeProgress(
    id: string,
    dto: CreateEpisodeProgressDto,
  ): Promise<EpisodeProgressResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    if (entry.mediaType !== MediaType.TV) {
      throw new BadRequestException('Only TV library entries support episode progress.');
    }

    // Idempotency: check if already recorded
    const existing = await this.libraryRepo.findEpisodeProgress(id, dto.episodeId);
    if (existing) {
      return {
        libraryEntryId: existing.libraryEntryId,
        episodeId: existing.episodeId,
        watchedAt: existing.watchedAt.toISOString(),
        alreadyWatched: true,
      };
    }

    const created = await this.libraryRepo.createEpisodeProgress(id, dto.episodeId);

    return {
      libraryEntryId: created.libraryEntryId,
      episodeId: created.episodeId,
      watchedAt: created.watchedAt.toISOString(),
      episodeNumber: created.episode?.episodeNumber,
      seasonNumber: created.episode?.season?.seasonNumber,
      name: created.episode?.name,
      alreadyWatched: false,
    };
  }

  public async deleteEpisodeProgress(id: string, episodeId: string): Promise<void> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    if (entry.mediaType !== MediaType.TV) {
      throw new BadRequestException('Only TV library entries support episode progress.');
    }

    await this.libraryRepo.deleteEpisodeProgress(id, episodeId);
  }

  public async markAllWatched(id: string, dto: MarkAllWatchedDto): Promise<MarkAllWatchedResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    if (entry.mediaType !== MediaType.TV || !entry.tvShowId) {
      throw new BadRequestException('Only TV library entries support mark-all-watched.');
    }

    const addedCount = await this.libraryRepo.markAllWatched(
      id,
      entry.tvShowId,
      dto.includeSpecials ?? false,
    );

    return { addedCount };
  }

  public async createSeasonRating(
    id: string,
    dto: CreateSeasonRatingDto,
  ): Promise<SeasonRatingResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    if (entry.mediaType !== MediaType.TV) {
      throw new BadRequestException('Only TV library entries support season ratings.');
    }

    const rating = await this.libraryRepo.createSeasonRating(id, dto.seasonId, dto.rating);

    return {
      id: rating.id,
      libraryEntryId: rating.libraryEntryId,
      seasonId: rating.seasonId,
      seasonNumber: rating.season?.seasonNumber,
      rating: Number(rating.rating),
      createdAt: rating.createdAt.toISOString(),
      updatedAt: rating.updatedAt.toISOString(),
    };
  }

  public async updateSeasonRating(
    id: string,
    seasonId: string,
    dto: UpdateSeasonRatingDto,
  ): Promise<SeasonRatingResponse> {
    const userId = this.userBootstrap.getUserId();
    const entry = await this.libraryRepo.findEntryById(id, userId);

    if (!entry) {
      throw new NotFoundException(`Library entry with ID ${id} was not found.`);
    }

    if (entry.mediaType !== MediaType.TV) {
      throw new BadRequestException('Only TV library entries support season ratings.');
    }

    const existing = await this.libraryRepo.findSeasonRating(id, seasonId);
    if (!existing) {
      throw new NotFoundException('Season rating not found for this season.');
    }

    const updated = await this.libraryRepo.updateSeasonRating(existing.id, dto.rating);

    return {
      id: updated.id,
      libraryEntryId: updated.libraryEntryId,
      seasonId: updated.seasonId,
      seasonNumber: updated.season?.seasonNumber,
      rating: Number(updated.rating),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private mapEntryToResponse(entry: EntryWithRelations): LibraryEntryResponse {
    const viewingEvents = entry.viewingEvents || [];
    const episodeProgresses = entry.episodeProgresses || [];

    const totalWatchCount = entry._count?.viewingEvents ?? viewingEvents.length;
    let firstWatchedAt: string | null = null;
    let lastWatchedAt: string | null = null;

    if (viewingEvents.length > 0) {
      const dates = viewingEvents.map((e) => e.watchedAt.getTime());
      firstWatchedAt = new Date(Math.min(...dates)).toISOString();
      lastWatchedAt = new Date(Math.max(...dates)).toISOString();
    }

    const watchStats: LibraryWatchStats = {
      totalWatchCount,
      firstWatchedAt,
      lastWatchedAt,
    };

    if (entry.mediaType === MediaType.TV && entry.tvShow) {
      const episodesWatched = entry._count?.episodeProgresses ?? episodeProgresses.length;
      const totalEpisodes = entry.tvShow.numberOfEpisodes ?? 0;
      watchStats.episodesWatched = episodesWatched;
      watchStats.totalEpisodes = totalEpisodes;
      watchStats.completionPercentage =
        totalEpisodes > 0 ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;
    }

    return {
      id: entry.id,
      userId: entry.userId,
      mediaType: entry.mediaType,
      movieId: entry.movieId,
      tvShowId: entry.tvShowId,
      status: entry.status,
      personalRating: entry.personalRating ? Number(entry.personalRating) : null,
      notes: entry.notes,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      movie: entry.movie
        ? {
            id: entry.movie.id,
            tmdbId: entry.movie.tmdbId,
            title: entry.movie.title,
            posterPath: entry.movie.posterPath,
            backdropPath: entry.movie.backdropPath,
            releaseDate: entry.movie.releaseDate
              ? entry.movie.releaseDate.toISOString().split('T')[0]
              : null,
            voteAverage: entry.movie.voteAverage,
            runtime: entry.movie.runtime,
          }
        : null,
      tvShow: entry.tvShow
        ? {
            id: entry.tvShow.id,
            tmdbId: entry.tvShow.tmdbId,
            name: entry.tvShow.name,
            posterPath: entry.tvShow.posterPath,
            backdropPath: entry.tvShow.backdropPath,
            firstAirDate: entry.tvShow.firstAirDate
              ? entry.tvShow.firstAirDate.toISOString().split('T')[0]
              : null,
            voteAverage: entry.tvShow.voteAverage,
            numberOfSeasons: entry.tvShow.numberOfSeasons,
            numberOfEpisodes: entry.tvShow.numberOfEpisodes,
          }
        : null,
      watchStats,
      viewingEvents: entry.viewingEvents
        ? entry.viewingEvents.map((e) => ({
            id: e.id,
            libraryEntryId: e.libraryEntryId,
            watchedAt: e.watchedAt.toISOString(),
            rating: e.rating ? Number(e.rating) : null,
            notes: e.notes,
          }))
        : undefined,
      episodeProgresses: entry.episodeProgresses
        ? entry.episodeProgresses.map((p) => ({
            libraryEntryId: p.libraryEntryId,
            episodeId: p.episodeId,
            watchedAt: p.watchedAt.toISOString(),
            episodeNumber: p.episode?.episodeNumber,
            seasonNumber: p.episode?.season?.seasonNumber,
            name: p.episode?.name,
          }))
        : undefined,
      seasonRatings: entry.seasonRatings
        ? entry.seasonRatings.map((r) => ({
            id: r.id,
            libraryEntryId: r.libraryEntryId,
            seasonId: r.seasonId,
            seasonNumber: r.season?.seasonNumber,
            rating: Number(r.rating),
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          }))
        : undefined,
    };
  }
}
