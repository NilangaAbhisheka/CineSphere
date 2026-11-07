export interface IngestMovieResult {
  id: string;
  tmdbId: number;
  title: string;
  genresCount: number;
  keywordsCount: number;
  castCount: number;
  syncedAt: Date;
}

export interface IngestTvShowResult {
  id: string;
  tmdbId: number;
  name: string;
  seasonsCount: number;
  episodesCount: number;
  genresCount: number;
  keywordsCount: number;
  castCount: number;
  syncedAt: Date;
  isPartial?: boolean;
}

export interface TmdbSearchResponse<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  results: T[];
}

export interface TmdbMovieSearchResult {
  id: number;
  title: string;
  original_title?: string | null;
  overview?: string | null;
  release_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  original_language?: string | null;
  adult?: boolean;
  genre_ids?: number[];
}

export interface TmdbTvSearchResult {
  id: number;
  name: string;
  original_name?: string | null;
  overview?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  original_language?: string | null;
  adult?: boolean;
  genre_ids?: number[];
}
