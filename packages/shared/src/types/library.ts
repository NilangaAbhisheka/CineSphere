export type LibraryMediaType = 'MOVIE' | 'TV';

export type LibraryStatus = 'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED';

/**
 * Backward compatibility alias for earlier prototype typing
 */
export type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped';

export interface ViewingEventResponse {
  id: string;
  libraryEntryId: string;
  watchedAt: string;
  rating: number | null;
  notes: string | null;
}

export interface EpisodeProgressResponse {
  libraryEntryId: string;
  episodeId: string;
  watchedAt: string;
  episodeNumber?: number;
  seasonNumber?: number;
  name?: string | null;
  alreadyWatched?: boolean;
}

export interface SeasonRatingResponse {
  id: string;
  libraryEntryId: string;
  seasonId: string;
  seasonNumber?: number;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryWatchStats {
  totalWatchCount: number;
  firstWatchedAt: string | null;
  lastWatchedAt: string | null;
  episodesWatched?: number;
  totalEpisodes?: number;
  completionPercentage?: number;
}

export interface LibraryEntryResponse {
  id: string;
  userId: string;
  mediaType: LibraryMediaType;
  movieId: string | null;
  tvShowId: string | null;
  status: LibraryStatus;
  personalRating: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Associated media metadata
  movie?: {
    id: string;
    tmdbId: number;
    title: string;
    posterPath: string | null;
    backdropPath: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
    runtime: number | null;
  } | null;

  tvShow?: {
    id: string;
    tmdbId: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
    firstAirDate: string | null;
    voteAverage: number | null;
    numberOfSeasons: number | null;
    numberOfEpisodes: number | null;
  } | null;

  watchStats: LibraryWatchStats;

  // Detail fields
  viewingEvents?: ViewingEventResponse[];
  episodeProgresses?: EpisodeProgressResponse[];
  seasonRatings?: SeasonRatingResponse[];
}

export type LibraryEntryListItem = LibraryEntryResponse;

export interface CreateLibraryEntryRequest {
  mediaType: LibraryMediaType;
  tmdbId?: number;
  mediaId?: string;
  status: LibraryStatus;
  personalRating?: number | null;
  notes?: string | null;
}

export interface UpdateLibraryEntryRequest {
  status?: LibraryStatus;
  personalRating?: number | null;
  notes?: string | null;
}

export interface CreateViewingEventRequest {
  watchedAt?: string;
  rating?: number | null;
  notes?: string | null;
}

export interface CreateEpisodeProgressRequest {
  episodeId: string;
}

export interface MarkAllWatchedRequest {
  includeSpecials?: boolean;
}

export interface MarkAllWatchedResponse {
  addedCount: number;
}

export interface CreateSeasonRatingRequest {
  seasonId: string;
  rating: number;
}

export interface UpdateSeasonRatingRequest {
  rating: number;
}

export interface ListLibraryQuery {
  status?: LibraryStatus;
  mediaType?: LibraryMediaType;
  page?: number;
  limit?: number;
  sortBy?: 'updatedAt' | 'createdAt' | 'personalRating' | 'title';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Backward compatibility interfaces
 */
export interface UserLibraryEntryDTO {
  id: string;
  userId: string;
  mediaId: string;
  status: WatchStatus;
  personalRating?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  addedAt: string;
  updatedAt: string;
}

export interface WatchProgressDTO {
  id: string;
  libraryEntryId: string;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  lastWatchedAt: string;
}
