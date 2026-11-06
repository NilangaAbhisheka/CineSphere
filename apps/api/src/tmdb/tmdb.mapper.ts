import {
  TmdbCastMember,
  TmdbGenre,
  TmdbKeyword,
  TmdbMovieDetailsResponse,
  TmdbSeasonDetailsResponse,
  TmdbTvShowDetailsResponse,
} from './tmdb.types.js';

export interface MappedGenre {
  tmdbId: number;
  name: string;
}

export interface MappedKeyword {
  tmdbId: number;
  name: string;
}

export interface MappedPerson {
  tmdbId: number;
  name: string;
}

export interface MappedMovieData {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  releaseDate: Date | null;
  runtime: number | null;
  originalLanguage: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  adult: boolean;
  genres: MappedGenre[];
  keywords: MappedKeyword[];
  cast: MappedPerson[];
}

export interface MappedEpisodeData {
  tmdbId: number | null;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  airDate: Date | null;
  runtime: number | null;
}

export interface MappedSeasonData {
  tmdbId: number | null;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: Date | null;
  episodes: MappedEpisodeData[];
}

export interface MappedTvShowData {
  tmdbId: number;
  name: string;
  originalName: string | null;
  overview: string | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  originalLanguage: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  status: string | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  genres: MappedGenre[];
  keywords: MappedKeyword[];
  cast: MappedPerson[];
  seasons: { seasonNumber: number; tmdbId: number | null }[];
}

export class TmdbMapper {
  public static parseDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  public static mapGenre(g: TmdbGenre): MappedGenre {
    return {
      tmdbId: g.id,
      name: g.name.trim(),
    };
  }

  public static mapKeyword(k: TmdbKeyword): MappedKeyword {
    return {
      tmdbId: k.id,
      name: k.name.trim(),
    };
  }

  public static mapPerson(c: TmdbCastMember): MappedPerson {
    return {
      tmdbId: c.id,
      name: (c.name || c.original_name || 'Unknown').trim(),
    };
  }

  public static mapMovie(response: TmdbMovieDetailsResponse): MappedMovieData {
    const rawKeywords = response.keywords?.keywords || [];
    const rawGenres = response.genres || [];
    const rawCast = response.credits?.cast || [];

    // Deduplicate genres, keywords, cast by tmdbId
    const uniqueGenres = Array.from(
      new Map(rawGenres.map((g) => [g.id, TmdbMapper.mapGenre(g)])).values(),
    );

    const uniqueKeywords = Array.from(
      new Map(rawKeywords.map((k) => [k.id, TmdbMapper.mapKeyword(k)])).values(),
    );

    const uniqueCast = Array.from(
      new Map(
        rawCast.filter((c) => c && c.id).map((c) => [c.id, TmdbMapper.mapPerson(c)]),
      ).values(),
    );

    return {
      tmdbId: response.id,
      title: response.title.trim(),
      originalTitle: response.original_title ? response.original_title.trim() : null,
      overview: response.overview ? response.overview.trim() : null,
      releaseDate: TmdbMapper.parseDate(response.release_date),
      runtime: typeof response.runtime === 'number' ? response.runtime : null,
      originalLanguage: response.original_language ? response.original_language.trim() : null,
      popularity: typeof response.popularity === 'number' ? response.popularity : null,
      voteAverage: typeof response.vote_average === 'number' ? response.vote_average : null,
      voteCount: typeof response.vote_count === 'number' ? response.vote_count : null,
      posterPath: response.poster_path ? response.poster_path.trim() : null,
      backdropPath: response.backdrop_path ? response.backdrop_path.trim() : null,
      adult: Boolean(response.adult),
      genres: uniqueGenres,
      keywords: uniqueKeywords,
      cast: uniqueCast,
    };
  }

  public static mapTvShow(response: TmdbTvShowDetailsResponse): MappedTvShowData {
    // TV keywords are under results: TmdbKeyword[]
    const rawKeywords = response.keywords?.results || [];
    const rawGenres = response.genres || [];
    const rawCast = response.aggregate_credits?.cast || response.credits?.cast || [];

    const uniqueGenres = Array.from(
      new Map(rawGenres.map((g) => [g.id, TmdbMapper.mapGenre(g)])).values(),
    );

    const uniqueKeywords = Array.from(
      new Map(rawKeywords.map((k) => [k.id, TmdbMapper.mapKeyword(k)])).values(),
    );

    const uniqueCast = Array.from(
      new Map(
        rawCast.filter((c) => c && c.id).map((c) => [c.id, TmdbMapper.mapPerson(c)]),
      ).values(),
    );

    const seasons = (response.seasons || []).map((s) => ({
      seasonNumber: s.season_number,
      tmdbId: typeof s.id === 'number' ? s.id : null,
    }));

    return {
      tmdbId: response.id,
      name: response.name.trim(),
      originalName: response.original_name ? response.original_name.trim() : null,
      overview: response.overview ? response.overview.trim() : null,
      firstAirDate: TmdbMapper.parseDate(response.first_air_date),
      lastAirDate: TmdbMapper.parseDate(response.last_air_date),
      originalLanguage: response.original_language ? response.original_language.trim() : null,
      popularity: typeof response.popularity === 'number' ? response.popularity : null,
      voteAverage: typeof response.vote_average === 'number' ? response.vote_average : null,
      voteCount: typeof response.vote_count === 'number' ? response.vote_count : null,
      posterPath: response.poster_path ? response.poster_path.trim() : null,
      backdropPath: response.backdrop_path ? response.backdrop_path.trim() : null,
      status: response.status ? response.status.trim() : null,
      numberOfSeasons:
        typeof response.number_of_seasons === 'number' ? response.number_of_seasons : null,
      numberOfEpisodes:
        typeof response.number_of_episodes === 'number' ? response.number_of_episodes : null,
      genres: uniqueGenres,
      keywords: uniqueKeywords,
      cast: uniqueCast,
      seasons,
    };
  }

  public static mapSeason(response: TmdbSeasonDetailsResponse): MappedSeasonData {
    const rawEpisodes = response.episodes || [];

    // Deduplicate episodes by episodeNumber
    const episodeMap = new Map<number, MappedEpisodeData>();
    for (const ep of rawEpisodes) {
      if (typeof ep.episode_number === 'number') {
        episodeMap.set(ep.episode_number, {
          tmdbId: typeof ep.id === 'number' ? ep.id : null,
          episodeNumber: ep.episode_number,
          name: ep.name ? ep.name.trim() : null,
          overview: ep.overview ? ep.overview.trim() : null,
          airDate: TmdbMapper.parseDate(ep.air_date),
          runtime: typeof ep.runtime === 'number' ? ep.runtime : null,
        });
      }
    }

    return {
      tmdbId: typeof response.id === 'number' ? response.id : null,
      seasonNumber: response.season_number,
      name: response.name ? response.name.trim() : null,
      overview: response.overview ? response.overview.trim() : null,
      posterPath: response.poster_path ? response.poster_path.trim() : null,
      airDate: TmdbMapper.parseDate(response.air_date),
      episodes: Array.from(episodeMap.values()),
    };
  }
}
