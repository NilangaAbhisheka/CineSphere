import {
  MediaGenre,
  MovieDetails,
  MovieListItem,
  PaginatedResult,
  TmdbMovieSearchResult,
  TmdbSearchResponse,
  TmdbTvSearchResult,
  TvShowDetails,
  TvShowListItem,
} from '@cinesphere/shared';

export interface TmdbMovieSearchParams {
  query: string;
  page?: number;
  includeAdult?: boolean;
  year?: number;
  primaryReleaseYear?: number;
}

export interface TmdbTvSearchParams {
  query: string;
  page?: number;
  includeAdult?: boolean;
  firstAirDateYear?: number;
}

export interface CatalogueMovieFilterParams {
  query?: string;
  page?: number;
  limit?: number;
  genreId?: number;
  year?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  sortBy?: 'popularity' | 'rating' | 'releaseDate' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface CatalogueTvFilterParams {
  query?: string;
  page?: number;
  limit?: number;
  genreId?: number;
  firstAirDateYear?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  status?: string;
  sortBy?: 'popularity' | 'rating' | 'firstAirDate' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly responseBody?: unknown;

  constructor(status: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class ApiClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(
      /\/$/,
      '',
    );
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined | null>,
    signal?: AbortSignal,
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${this.baseUrl}${cleanEndpoint}`);

    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null && val !== '') {
          url.searchParams.set(key, String(val));
        }
      }
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        let errorMsg = `API request failed with status ${response.status}`;
        let responseBody: unknown;
        try {
          responseBody = await response.json();
          if (responseBody && typeof responseBody === 'object' && 'message' in responseBody) {
            const bodyMsg = (responseBody as { message: unknown }).message;
            errorMsg = Array.isArray(bodyMsg) ? bodyMsg.join(', ') : String(bodyMsg);
          }
        } catch {
          // Non-JSON response
        }
        throw new ApiClientError(response.status, errorMsg, responseBody);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      const error = err as Error;
      throw new ApiClientError(0, error.message || 'Network connection failed');
    }
  }

  // ── TMDB Remote Discovery Endpoints ─────────────────────────────────────────

  public async searchTmdbMovies(
    params: TmdbMovieSearchParams,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbMovieSearchResult>>(
      '/discover/tmdb/movies',
      {
        query: params.query,
        page: params.page,
        includeAdult: params.includeAdult,
        year: params.year,
        primaryReleaseYear: params.primaryReleaseYear,
      },
      signal,
    );
  }

  public async searchTmdbTvShows(
    params: TmdbTvSearchParams,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbTvSearchResult>>(
      '/discover/tmdb/tv',
      {
        query: params.query,
        page: params.page,
        includeAdult: params.includeAdult,
        firstAirDateYear: params.firstAirDateYear,
      },
      signal,
    );
  }

  public async getTrendingMovies(
    page: number = 1,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbMovieSearchResult>>(
      '/discover/tmdb/trending/movies',
      { page },
      signal,
    );
  }

  public async getTrendingTvShows(
    page: number = 1,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbTvSearchResult>>(
      '/discover/tmdb/trending/tv',
      { page },
      signal,
    );
  }

  public async getPopularMovies(
    page: number = 1,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbMovieSearchResult>>(
      '/discover/tmdb/popular/movies',
      { page },
      signal,
    );
  }

  public async getPopularTvShows(
    page: number = 1,
    signal?: AbortSignal,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.request<TmdbSearchResponse<TmdbTvSearchResult>>(
      '/discover/tmdb/popular/tv',
      { page },
      signal,
    );
  }

  // ── Local Catalogue Endpoints ───────────────────────────────────────────────

  public async listCatalogueMovies(
    params: CatalogueMovieFilterParams = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<MovieListItem>> {
    return this.request<PaginatedResult<MovieListItem>>(
      '/catalogue/movies',
      {
        query: params.query,
        page: params.page,
        limit: params.limit,
        genreId: params.genreId,
        year: params.year,
        minRating: params.minRating,
        maxRating: params.maxRating,
        language: params.language,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
      signal,
    );
  }

  public async listCatalogueTvShows(
    params: CatalogueTvFilterParams = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<TvShowListItem>> {
    return this.request<PaginatedResult<TvShowListItem>>(
      '/catalogue/tv',
      {
        query: params.query,
        page: params.page,
        limit: params.limit,
        genreId: params.genreId,
        firstAirDateYear: params.firstAirDateYear,
        minRating: params.minRating,
        maxRating: params.maxRating,
        language: params.language,
        status: params.status,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
      signal,
    );
  }

  public async listCatalogueGenres(signal?: AbortSignal): Promise<MediaGenre[]> {
    return this.request<MediaGenre[]>('/catalogue/genres', undefined, signal);
  }

  public async getCatalogueMovieById(id: string, signal?: AbortSignal): Promise<MovieDetails> {
    return this.request<MovieDetails>(`/catalogue/movies/${id}`, undefined, signal);
  }

  public async getCatalogueTvShowById(id: string, signal?: AbortSignal): Promise<TvShowDetails> {
    return this.request<TvShowDetails>(`/catalogue/tv/${id}`, undefined, signal);
  }
}

export const apiClient = new ApiClient();
