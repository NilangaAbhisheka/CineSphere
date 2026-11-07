export type MediaType = 'movie' | 'tv';

export interface MediaGenre {
  id: number;
  name: string;
}

export interface MediaKeyword {
  id: number;
  name: string;
}

export interface MediaSummary {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  voteCount: number;
  popularity: number;
  releaseDate?: string;
  genres: MediaGenre[];
}

export interface PersonSummary {
  id: string;
  tmdbId: number;
  name: string;
}

export interface PersonCreditSummary {
  id: string;
  personId: string;
  personName?: string;
  movieId?: string | null;
  tvShowId?: string | null;
}

export interface CastMemberSummary {
  id: string;
  personId: string;
  tmdbId: number;
  name: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  totalResults: number;
  totalPages: number;
}

export interface MovieListItem {
  id: string;
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtime: number | null;
  originalLanguage: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: MediaGenre[];
}

export interface MovieDetails extends MovieListItem {
  adult: boolean;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  keywords: MediaKeyword[];
  cast: CastMemberSummary[];
}

export interface EpisodeDetails {
  id: string;
  tmdbId: number | null;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface SeasonDetails {
  id: string;
  tmdbId: number | null;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: string | null;
  episodes: EpisodeDetails[];
}

export interface TvShowListItem {
  id: string;
  tmdbId: number;
  name: string;
  originalName: string | null;
  overview: string | null;
  firstAirDate: string | null;
  lastAirDate: string | null;
  originalLanguage: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  status: string | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  genres: MediaGenre[];
}

export interface TvShowDetails extends TvShowListItem {
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  keywords: MediaKeyword[];
  cast: CastMemberSummary[];
  seasons: SeasonDetails[];
}
