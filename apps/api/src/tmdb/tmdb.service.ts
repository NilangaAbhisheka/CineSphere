import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IngestMovieResult,
  IngestTvShowResult,
  TmdbMovieSearchResult,
  TmdbSearchResponse,
  TmdbTvSearchResult,
} from '@cinesphere/shared';
import { TmdbHttpClient } from './tmdb-http.client.js';
import { TmdbMapper } from './tmdb.mapper.js';
import { CatalogueRepository } from './catalogue.repository.js';
import {
  RawTmdbSearchResponse,
  TmdbMovieDetailsResponse,
  TmdbSeasonDetailsResponse,
  TmdbTvShowDetailsResponse,
} from './tmdb.types.js';

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);

  constructor(
    private readonly httpClient: TmdbHttpClient,
    private readonly catalogueRepo: CatalogueRepository,
  ) {}

  public async ingestMovie(tmdbId: number): Promise<IngestMovieResult> {
    this.logger.log(`Fetching movie with TMDB ID ${tmdbId}...`);

    let rawMovie: TmdbMovieDetailsResponse;
    try {
      rawMovie = await this.httpClient.get<TmdbMovieDetailsResponse>(`/movie/${tmdbId}`, {
        append_to_response: 'credits,keywords',
      });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('404')) {
        throw new NotFoundException(`Movie with TMDB ID ${tmdbId} was not found on TMDB.`);
      }
      throw error;
    }

    const mapped = TmdbMapper.mapMovie(rawMovie);
    const { id, syncedAt } = await this.catalogueRepo.saveMovie(mapped);

    this.logger.log(`Successfully ingested movie "${mapped.title}" (TMDB ${tmdbId}) -> DB ${id}`);

    return {
      id,
      tmdbId: mapped.tmdbId,
      title: mapped.title,
      genresCount: mapped.genres.length,
      keywordsCount: mapped.keywords.length,
      castCount: mapped.cast.length,
      syncedAt,
    };
  }

  public async ingestTvShow(tmdbId: number): Promise<IngestTvShowResult> {
    this.logger.log(`Fetching TV show with TMDB ID ${tmdbId}...`);

    let rawShow: TmdbTvShowDetailsResponse;
    try {
      rawShow = await this.httpClient.get<TmdbTvShowDetailsResponse>(`/tv/${tmdbId}`, {
        append_to_response: 'aggregate_credits,credits,keywords',
      });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('404')) {
        throw new NotFoundException(`TV show with TMDB ID ${tmdbId} was not found on TMDB.`);
      }
      throw error;
    }

    const mappedShow = TmdbMapper.mapTvShow(rawShow);
    const { id: showId, syncedAt } = await this.catalogueRepo.saveTvShowHeader(mappedShow);

    let totalEpisodes = 0;
    let seasonsSaved = 0;

    // Ingest each season and its episodes in isolated transactions
    for (const s of mappedShow.seasons) {
      try {
        const rawSeason = await this.httpClient.get<TmdbSeasonDetailsResponse>(
          `/tv/${tmdbId}/season/${s.seasonNumber}`,
        );
        const mappedSeason = TmdbMapper.mapSeason(rawSeason);

        const { episodeCount } = await this.catalogueRepo.saveSeasonAndEpisodes(
          showId,
          mappedSeason,
        );
        totalEpisodes += episodeCount;
        seasonsSaved++;
      } catch (seasonErr: unknown) {
        const error = seasonErr as Error;
        this.logger.warn(
          `Could not fetch/persist season ${s.seasonNumber} for show ${tmdbId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Successfully ingested TV show "${mappedShow.name}" (TMDB ${tmdbId}) -> ${seasonsSaved}/${mappedShow.seasons.length} seasons, ${totalEpisodes} episodes`,
    );

    const isPartial = seasonsSaved < mappedShow.seasons.length;

    return {
      id: showId,
      tmdbId: mappedShow.tmdbId,
      name: mappedShow.name,
      seasonsCount: seasonsSaved,
      episodesCount: totalEpisodes,
      genresCount: mappedShow.genres.length,
      keywordsCount: mappedShow.keywords.length,
      castCount: mappedShow.cast.length,
      syncedAt,
      isPartial,
    };
  }

  public async searchMovies(
    query: string,
    page: number = 1,
    includeAdult: boolean = false,
    year?: number,
    primaryReleaseYear?: number,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    this.logger.log(`Searching TMDB movies with query="${query}", page=${page}...`);

    const params: Record<string, string | number | boolean | undefined> = {
      query,
      page,
      include_adult: includeAdult,
    };

    if (year !== undefined) {
      params.year = year;
    }
    if (primaryReleaseYear !== undefined) {
      params.primary_release_year = primaryReleaseYear;
    }

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbMovieSearchResult>>(
      '/search/movie',
      params,
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }

  public async searchTvShows(
    query: string,
    page: number = 1,
    includeAdult: boolean = false,
    firstAirDateYear?: number,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    this.logger.log(`Searching TMDB TV shows with query="${query}", page=${page}...`);

    const params: Record<string, string | number | boolean | undefined> = {
      query,
      page,
      include_adult: includeAdult,
    };

    if (firstAirDateYear !== undefined) {
      params.first_air_date_year = firstAirDateYear;
    }

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbTvSearchResult>>(
      '/search/tv',
      params,
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }

  public async getTrendingMovies(
    timeWindow: 'day' | 'week' = 'day',
    page: number = 1,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    this.logger.log(`Fetching TMDB trending movies (${timeWindow}), page=${page}...`);

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbMovieSearchResult>>(
      `/trending/movie/${timeWindow}`,
      { page },
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }

  public async getTrendingTvShows(
    timeWindow: 'day' | 'week' = 'day',
    page: number = 1,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    this.logger.log(`Fetching TMDB trending TV shows (${timeWindow}), page=${page}...`);

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbTvSearchResult>>(
      `/trending/tv/${timeWindow}`,
      { page },
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }

  public async getPopularMovies(
    page: number = 1,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    this.logger.log(`Fetching TMDB popular movies, page=${page}...`);

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbMovieSearchResult>>(
      '/movie/popular',
      { page },
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }

  public async getPopularTvShows(
    page: number = 1,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    this.logger.log(`Fetching TMDB popular TV shows, page=${page}...`);

    const raw = await this.httpClient.get<RawTmdbSearchResponse<TmdbTvSearchResult>>(
      '/tv/popular',
      { page },
    );

    return {
      page: raw.page ?? page,
      totalPages: raw.total_pages ?? 0,
      totalResults: raw.total_results ?? 0,
      results: raw.results ?? [],
    };
  }
}
