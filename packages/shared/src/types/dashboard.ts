// ==============================================================================
// CineSphere — Dashboard Shared Types
// Phase 3.6
// ==============================================================================

export interface DashboardStats {
  totalMovies: number;
  completedMovies: number;
  watchingTvShows: number;
  completedTvShows: number;
  totalEpisodesWatched: number;
  totalViewingEvents: number;
  /**
   * Combined count of ViewingEvent records + EpisodeProgress records whose
   * watchedAt timestamp falls within the last 30 days. Each record is counted
   * once; records are not deduplicated by title.
   */
  recentActivityCount: number;
}

export interface NextEpisodeInfo {
  episodeId: string;
  episodeNumber: number;
  seasonNumber: number;
  name: string | null;
}

export interface ContinueWatchingItem {
  libraryEntryId: string;
  tvShow: {
    id: string;
    tmdbId: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
  };
  episodesWatched: number;
  /** Regular episodes only (seasonNumber > 0). */
  totalEligibleEpisodes: number;
  progressPercentage: number;
  nextEpisode: NextEpisodeInfo | null;
  lastWatchedAt: string | null;
}

export type RecentActivityType = 'MOVIE' | 'TV_EPISODE';

export interface RecentActivityItem {
  activityType: RecentActivityType;
  watchedAt: string;
  // MOVIE fields
  libraryEntryId?: string;
  movie?: {
    id: string;
    tmdbId: number;
    title: string;
    posterPath: string | null;
  };
  viewingEventRating?: number | null;
  // TV_EPISODE fields
  tvShow?: {
    id: string;
    tmdbId: number;
    name: string;
    posterPath: string | null;
  };
  episodeNumber?: number;
  seasonNumber?: number;
  episodeName?: string | null;
}

export type QuickPickMediaType = 'MOVIE' | 'TV';

export interface QuickPickItem {
  id: string;
  tmdbId: number;
  mediaType: QuickPickMediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseYear: string | null;
  voteAverage: number | null;
}

export interface DashboardOverviewResponse {
  stats: DashboardStats;
  continueWatching: ContinueWatchingItem[];
  recentActivity: RecentActivityItem[];
  quickPicks: QuickPickItem[];
}
