export type MediaType = 'movie' | 'tv';

export interface MediaGenre {
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
