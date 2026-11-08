import { Injectable, Logger } from '@nestjs/common';
import {
  ContinueWatchingItem,
  DashboardOverviewResponse,
  DashboardStats,
  NextEpisodeInfo,
  QuickPickItem,
  RecentActivityItem,
} from '@cinesphere/shared';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userBootstrap: SingleUserBootstrap,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public async getOverview(): Promise<DashboardOverviewResponse> {
    const [stats, continueWatching, recentActivity, quickPicks] = await Promise.all([
      this.getStats(),
      this.getContinueWatching(10),
      this.getRecentActivity(10),
      this.getQuickPicks(10),
    ]);

    return { stats, continueWatching, recentActivity, quickPicks };
  }

  public async getStats(): Promise<DashboardStats> {
    const userId = this.userBootstrap.getUserId();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalMovies,
      completedMovies,
      watchingTvShows,
      completedTvShows,
      totalEpisodesWatched,
      totalViewingEvents,
      recentViewingEvents,
      recentEpisodeProgress,
    ] = await Promise.all([
      this.prisma.userLibraryEntry.count({ where: { userId, mediaType: 'MOVIE' } }),
      this.prisma.userLibraryEntry.count({
        where: { userId, mediaType: 'MOVIE', status: 'COMPLETED' },
      }),
      this.prisma.userLibraryEntry.count({
        where: { userId, mediaType: 'TV', status: 'WATCHING' },
      }),
      this.prisma.userLibraryEntry.count({
        where: { userId, mediaType: 'TV', status: 'COMPLETED' },
      }),
      this.prisma.episodeProgress.count({ where: { libraryEntry: { userId } } }),
      this.prisma.viewingEvent.count({ where: { libraryEntry: { userId } } }),
      this.prisma.viewingEvent.count({
        where: {
          libraryEntry: { userId },
          watchedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.episodeProgress.count({
        where: {
          libraryEntry: { userId },
          watchedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    return {
      totalMovies,
      completedMovies,
      watchingTvShows,
      completedTvShows,
      totalEpisodesWatched,
      totalViewingEvents,
      recentActivityCount: recentViewingEvents + recentEpisodeProgress,
    };
  }

  public async getContinueWatching(limit = 10): Promise<ContinueWatchingItem[]> {
    const userId = this.userBootstrap.getUserId();

    // Fetch WATCHING TV library entries with their episode progress and show metadata
    const entries = await this.prisma.userLibraryEntry.findMany({
      where: { userId, mediaType: 'TV', status: 'WATCHING' },
      select: {
        id: true,
        tvShowId: true,
        tvShow: {
          select: {
            id: true,
            tmdbId: true,
            name: true,
            posterPath: true,
            backdropPath: true,
          },
        },
        episodeProgresses: {
          select: {
            episodeId: true,
            watchedAt: true,
          },
        },
      },
    });

    if (entries.length === 0) return [];

    // Build result per entry, then filter and sort
    const results = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.tvShow || !entry.tvShowId) return null;

        // Fetch all regular episodes (seasonNumber > 0) ordered for progression
        const orderedEpisodes = await this.prisma.episode.findMany({
          where: {
            season: {
              tvShowId: entry.tvShowId,
              seasonNumber: { gt: 0 },
            },
          },
          orderBy: [{ season: { seasonNumber: 'asc' } }, { episodeNumber: 'asc' }],
          select: {
            id: true,
            episodeNumber: true,
            name: true,
            season: { select: { seasonNumber: true } },
          },
        });

        const totalEligibleEpisodes = orderedEpisodes.length;
        const watchedEpisodeIds = new Set(entry.episodeProgresses.map((p) => p.episodeId));
        const episodesWatched = orderedEpisodes.filter((e) => watchedEpisodeIds.has(e.id)).length;

        // If all regular episodes are watched, exclude from Continue Watching
        if (totalEligibleEpisodes > 0 && episodesWatched >= totalEligibleEpisodes) {
          return null;
        }

        const nextEpisodeRaw = orderedEpisodes.find((e) => !watchedEpisodeIds.has(e.id));
        const nextEpisode: NextEpisodeInfo | null = nextEpisodeRaw
          ? {
              episodeId: nextEpisodeRaw.id,
              episodeNumber: nextEpisodeRaw.episodeNumber,
              seasonNumber: nextEpisodeRaw.season.seasonNumber,
              name: nextEpisodeRaw.name,
            }
          : null;

        // lastWatchedAt = maximum watchedAt across all episode progresses
        let lastWatchedAt: string | null = null;
        if (entry.episodeProgresses.length > 0) {
          const maxDate = entry.episodeProgresses.reduce<Date | null>((max, p) => {
            return max === null || p.watchedAt > max ? p.watchedAt : max;
          }, null);
          lastWatchedAt = maxDate ? maxDate.toISOString() : null;
        }

        const progressPercentage =
          totalEligibleEpisodes > 0
            ? Math.round((episodesWatched / totalEligibleEpisodes) * 100)
            : 0;

        const item: ContinueWatchingItem = {
          libraryEntryId: entry.id,
          tvShow: {
            id: entry.tvShow.id,
            tmdbId: entry.tvShow.tmdbId,
            name: entry.tvShow.name,
            posterPath: entry.tvShow.posterPath,
            backdropPath: entry.tvShow.backdropPath,
          },
          episodesWatched,
          totalEligibleEpisodes,
          progressPercentage,
          nextEpisode,
          lastWatchedAt,
        };

        return item;
      }),
    );

    // Filter nulls (fully watched shows), sort by lastWatchedAt desc (nulls last)
    const filtered = results.filter((item): item is ContinueWatchingItem => item !== null);
    filtered.sort((a, b) => {
      if (a.lastWatchedAt === null && b.lastWatchedAt === null) return 0;
      if (a.lastWatchedAt === null) return 1;
      if (b.lastWatchedAt === null) return -1;
      return new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime();
    });

    return filtered.slice(0, limit);
  }

  public async getRecentActivity(limit = 10): Promise<RecentActivityItem[]> {
    const userId = this.userBootstrap.getUserId();

    const [movieEvents, episodeEvents] = await Promise.all([
      // Movie viewing events
      this.prisma.viewingEvent.findMany({
        where: { libraryEntry: { userId, mediaType: 'MOVIE' } },
        orderBy: { watchedAt: 'desc' },
        take: limit,
        select: {
          watchedAt: true,
          rating: true,
          libraryEntryId: true,
          libraryEntry: {
            select: {
              movie: {
                select: { id: true, tmdbId: true, title: true, posterPath: true },
              },
            },
          },
        },
      }),
      // TV episode progress events
      this.prisma.episodeProgress.findMany({
        where: { libraryEntry: { userId, mediaType: 'TV' } },
        orderBy: { watchedAt: 'desc' },
        take: limit,
        select: {
          watchedAt: true,
          libraryEntryId: true,
          libraryEntry: {
            select: {
              tvShow: {
                select: { id: true, tmdbId: true, name: true, posterPath: true },
              },
            },
          },
          episode: {
            select: {
              episodeNumber: true,
              name: true,
              season: { select: { seasonNumber: true } },
            },
          },
        },
      }),
    ]);

    const movieItems: RecentActivityItem[] = movieEvents.map((e) => ({
      activityType: 'MOVIE' as const,
      watchedAt: e.watchedAt.toISOString(),
      libraryEntryId: e.libraryEntryId,
      movie: e.libraryEntry.movie
        ? {
            id: e.libraryEntry.movie.id,
            tmdbId: e.libraryEntry.movie.tmdbId,
            title: e.libraryEntry.movie.title,
            posterPath: e.libraryEntry.movie.posterPath,
          }
        : undefined,
      viewingEventRating: e.rating !== null ? Number(e.rating) : null,
    }));

    const tvItems: RecentActivityItem[] = episodeEvents.map((e) => ({
      activityType: 'TV_EPISODE' as const,
      watchedAt: e.watchedAt.toISOString(),
      libraryEntryId: e.libraryEntryId,
      tvShow: e.libraryEntry.tvShow
        ? {
            id: e.libraryEntry.tvShow.id,
            tmdbId: e.libraryEntry.tvShow.tmdbId,
            name: e.libraryEntry.tvShow.name,
            posterPath: e.libraryEntry.tvShow.posterPath,
          }
        : undefined,
      episodeNumber: e.episode?.episodeNumber,
      seasonNumber: e.episode?.season?.seasonNumber,
      episodeName: e.episode?.name ?? null,
    }));

    // Merge and sort by watchedAt descending, slice to limit
    const merged = [...movieItems, ...tvItems];
    merged.sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime());
    return merged.slice(0, limit);
  }

  public async getQuickPicks(limit = 10): Promise<QuickPickItem[]> {
    const userId = this.userBootstrap.getUserId();

    // Get the user's existing library TMDB IDs to exclude
    const libraryEntries = await this.prisma.userLibraryEntry.findMany({
      where: { userId },
      select: {
        movie: { select: { tmdbId: true } },
        tvShow: { select: { tmdbId: true } },
      },
    });

    const excludedMovieTmdbIds = libraryEntries
      .map((e) => e.movie?.tmdbId)
      .filter((id): id is number => id !== undefined && id !== null);

    const excludedTvTmdbIds = libraryEntries
      .map((e) => e.tvShow?.tmdbId)
      .filter((id): id is number => id !== undefined && id !== null);

    const movieLimit = Math.ceil(limit / 2);
    const tvLimit = Math.floor(limit / 2);

    const [movies, tvShows] = await Promise.all([
      this.prisma.movie.findMany({
        where: excludedMovieTmdbIds.length > 0 ? { tmdbId: { notIn: excludedMovieTmdbIds } } : {},
        orderBy: [{ popularity: 'desc' }, { voteAverage: 'desc' }],
        take: movieLimit,
        select: {
          id: true,
          tmdbId: true,
          title: true,
          posterPath: true,
          backdropPath: true,
          releaseDate: true,
          voteAverage: true,
        },
      }),
      this.prisma.tvShow.findMany({
        where: excludedTvTmdbIds.length > 0 ? { tmdbId: { notIn: excludedTvTmdbIds } } : {},
        orderBy: [{ popularity: 'desc' }, { voteAverage: 'desc' }],
        take: tvLimit,
        select: {
          id: true,
          tmdbId: true,
          name: true,
          posterPath: true,
          backdropPath: true,
          firstAirDate: true,
          voteAverage: true,
        },
      }),
    ]);

    const movieItems: QuickPickItem[] = movies.map((m) => ({
      id: m.id,
      tmdbId: m.tmdbId,
      mediaType: 'MOVIE' as const,
      title: m.title,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      releaseYear: m.releaseDate ? String(m.releaseDate.getFullYear()) : null,
      voteAverage: m.voteAverage,
    }));

    const tvItems: QuickPickItem[] = tvShows.map((s) => ({
      id: s.id,
      tmdbId: s.tmdbId,
      mediaType: 'TV' as const,
      title: s.name,
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      releaseYear: s.firstAirDate ? String(s.firstAirDate.getFullYear()) : null,
      voteAverage: s.voteAverage,
    }));

    // Interleave: movie, TV, movie, TV… up to limit
    const interleaved: QuickPickItem[] = [];
    const maxLen = Math.max(movieItems.length, tvItems.length);
    for (let i = 0; i < maxLen && interleaved.length < limit; i++) {
      if (i < movieItems.length && interleaved.length < limit) {
        interleaved.push(movieItems[i]);
      }
      if (i < tvItems.length && interleaved.length < limit) {
        interleaved.push(tvItems[i]);
      }
    }

    return interleaved;
  }
}
