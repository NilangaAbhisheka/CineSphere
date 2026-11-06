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
}
