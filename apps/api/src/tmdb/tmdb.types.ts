export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbMovieKeywordsResponse {
  id: number;
  keywords?: TmdbKeyword[];
}

export interface TmdbTvKeywordsResponse {
  id: number;
  results?: TmdbKeyword[];
}

export interface TmdbCastMember {
  id: number;
  name: string;
  original_name?: string;
  popularity?: number;
  profile_path?: string | null;
  cast_id?: number;
  character?: string;
  credit_id?: string;
  order?: number;
}

export interface TmdbCreditsResponse {
  id: number;
  cast: TmdbCastMember[];
}

export interface TmdbMovieDetailsResponse {
  id: number;
  title: string;
  original_title?: string | null;
  overview?: string | null;
  release_date?: string | null;
  runtime?: number | null;
  original_language?: string | null;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  adult?: boolean;
  genres?: TmdbGenre[];
  keywords?: TmdbMovieKeywordsResponse;
  credits?: TmdbCreditsResponse;
}

export interface TmdbTvSeasonSummary {
  id?: number | null;
  season_number: number;
  name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  air_date?: string | null;
  episode_count?: number | null;
}

export interface TmdbTvShowDetailsResponse {
  id: number;
  name: string;
  original_name?: string | null;
  overview?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  original_language?: string | null;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  status?: string | null;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  genres?: TmdbGenre[];
  seasons?: TmdbTvSeasonSummary[];
  keywords?: TmdbTvKeywordsResponse;
  credits?: TmdbCreditsResponse;
  aggregate_credits?: TmdbCreditsResponse;
}

export interface TmdbEpisodeDetails {
  id?: number | null;
  episode_number: number;
  name?: string | null;
  overview?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  still_path?: string | null;
}

export interface TmdbSeasonDetailsResponse {
  id?: number | null;
  season_number: number;
  name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  air_date?: string | null;
  episodes: TmdbEpisodeDetails[];
}
