// ==============================================================================
// CineSphere — Statistics Shared Contracts
// Phase 3 Stage 3.7 / Phase 4
// ==============================================================================

export interface StatsOverviewSummary {
  /** Completed movie library entries (UserLibraryEntry with mediaType = 'MOVIE' and status = 'COMPLETED') */
  moviesCompleted: number;

  /** Total persisted movie ViewingEvent records across all movie library entries */
  movieViewingEvents: number;

  /** Total persisted TV EpisodeProgress records across all TV library entries */
  episodesWatched: number;

  /** Completed TV series library entries (UserLibraryEntry with mediaType = 'TV' and status = 'COMPLETED') */
  tvShowsCompleted: number;

  /** Arithmetic mean of non-null UserLibraryEntry.personalRating values (1.0-10.0), or null if no ratings exist */
  averagePersonalRating: number | null;
}

export interface GenreStatItem {
  genreId: number;
  name: string;
  /** Count of distinct completed movie and TV titles associated with this genre */
  completedTitleCount: number;
  /** Percentage of all completed titles that carry this genre (0-100) */
  percentage: number;
}

export interface ActivityTimelineItem {
  /** Calendar month in YYYY-MM format (e.g., "2026-05") */
  period: string;

  /** Human-readable period label (e.g., "May 2026") */
  label: string;

  /** Count of movie ViewingEvents logged in this month */
  movieViewings: number;

  /** Count of TV EpisodeProgress records logged in this month */
  episodesWatched: number;

  /** Combined movie viewings and episodes watched in this month */
  totalActivity: number;
}

export interface ActivityTimelineData {
  /** Earliest month in the requested range (YYYY-MM) */
  from: string;

  /** Latest month in the requested range (YYYY-MM) */
  to: string;

  /** Complete chronological monthly sequence, including zero-activity months */
  items: ActivityTimelineItem[];
}

export interface RatingDistributionBucket {
  /** Rating value from 1.0 to 10.0 in 0.5 increments */
  rating: number;

  /** Number of UserLibraryEntry records assigned this exact personal rating */
  count: number;
}

export interface RatingStatsData {
  /** Exactly 19 buckets covering 1.0 through 10.0 in 0.5 half-step increments */
  buckets: RatingDistributionBucket[];

  /** Count of UserLibraryEntry records where personalRating is null */
  unratedLibraryEntries: number;

  /** Sum of counts across all 19 buckets */
  totalRated: number;
}

export interface StatisticsPageData {
  summary: StatsOverviewSummary;
  genres: GenreStatItem[];
  activity: ActivityTimelineData;
  ratings: RatingStatsData;
}
