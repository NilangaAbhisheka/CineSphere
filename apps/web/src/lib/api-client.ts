import {
  ContinueWatchingItem,
  CreateEpisodeProgressRequest,
  CreateLibraryEntryRequest,
  CreateSeasonRatingRequest,
  CreateViewingEventRequest,
  DashboardOverviewResponse,
  DashboardStats,
  EpisodeProgressResponse,
  LibraryEntryListItem,
  LibraryEntryResponse,
  ListLibraryQuery,
  MarkAllWatchedResponse,
  MediaGenre,
  MovieDetails,
  MovieListItem,
  PaginatedResult,
  QuickPickItem,
  RecentActivityItem,
  SeasonRatingResponse,
  TmdbMovieSearchResult,
  TmdbSearchResponse,
  TmdbTvSearchResult,
  TvShowDetails,
  TvShowListItem,
  UpdateLibraryEntryRequest,
  UpdateSeasonRatingRequest,
  ViewingEventResponse,
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

  private async mutate<T>(
    endpoint: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });

      if (!response.ok) {
        let errorMsg = `API mutation failed with status ${response.status}`;
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

      if (response.status === 204) {
        return undefined as T;
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

  // ── Personal Library Endpoints ─────────────────────────────────────────────

  public async listLibrary(
    params: ListLibraryQuery = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<LibraryEntryListItem>> {
    return this.request<PaginatedResult<LibraryEntryListItem>>(
      '/library',
      {
        status: params.status,
        mediaType: params.mediaType,
        page: params.page,
        limit: params.limit,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
      signal,
    );
  }

  public async getLibraryEntry(id: string, signal?: AbortSignal): Promise<LibraryEntryResponse> {
    return this.request<LibraryEntryResponse>(`/library/${id}`, undefined, signal);
  }

  public async createLibraryEntry(
    dto: CreateLibraryEntryRequest,
    signal?: AbortSignal,
  ): Promise<LibraryEntryResponse> {
    return this.mutate<LibraryEntryResponse>('/library', 'POST', dto, signal);
  }

  public async updateLibraryEntry(
    id: string,
    dto: UpdateLibraryEntryRequest,
    signal?: AbortSignal,
  ): Promise<LibraryEntryResponse> {
    return this.mutate<LibraryEntryResponse>(`/library/${id}`, 'PATCH', dto, signal);
  }

  public async deleteLibraryEntry(id: string, signal?: AbortSignal): Promise<void> {
    return this.mutate<void>(`/library/${id}`, 'DELETE', undefined, signal);
  }

  public async createViewingEvent(
    id: string,
    dto: CreateViewingEventRequest,
    signal?: AbortSignal,
  ): Promise<ViewingEventResponse> {
    return this.mutate<ViewingEventResponse>(`/library/${id}/viewing-events`, 'POST', dto, signal);
  }

  public async createEpisodeProgress(
    id: string,
    episodeId: string,
    signal?: AbortSignal,
  ): Promise<EpisodeProgressResponse> {
    return this.mutate<EpisodeProgressResponse>(
      `/library/${id}/episode-progress`,
      'POST',
      { episodeId },
      signal,
    );
  }

  public async deleteEpisodeProgress(
    id: string,
    episodeId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.mutate<void>(
      `/library/${id}/episode-progress/${episodeId}`,
      'DELETE',
      undefined,
      signal,
    );
  }

  public async markAllWatched(
    id: string,
    includeSpecials: boolean = false,
    signal?: AbortSignal,
  ): Promise<MarkAllWatchedResponse> {
    return this.mutate<MarkAllWatchedResponse>(
      `/library/${id}/mark-all-watched`,
      'POST',
      { includeSpecials },
      signal,
    );
  }

  public async createSeasonRating(
    id: string,
    seasonId: string,
    rating: number,
    signal?: AbortSignal,
  ): Promise<SeasonRatingResponse> {
    return this.mutate<SeasonRatingResponse>(
      `/library/${id}/season-ratings`,
      'POST',
      { seasonId, rating },
      signal,
    );
  }

  public async updateSeasonRating(
    id: string,
    seasonId: string,
    rating: number,
    signal?: AbortSignal,
  ): Promise<SeasonRatingResponse> {
    return this.mutate<SeasonRatingResponse>(
      `/library/${id}/season-ratings/${seasonId}`,
      'PATCH',
      { rating },
      signal,
    );
  }

  // ── Dashboard Endpoints ──────────────────────────────────────────────────────

  public async getDashboardOverview(signal?: AbortSignal): Promise<DashboardOverviewResponse> {
    return this.request<DashboardOverviewResponse>('/dashboard/overview', undefined, signal);
  }

  public async getDashboardStats(signal?: AbortSignal): Promise<DashboardStats> {
    return this.request<DashboardStats>('/dashboard/stats', undefined, signal);
  }

  public async getDashboardContinueWatching(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<ContinueWatchingItem[]> {
    return this.request<ContinueWatchingItem[]>(
      '/dashboard/continue-watching',
      limit !== undefined ? { limit } : undefined,
      signal,
    );
  }

  public async getDashboardRecentActivity(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<RecentActivityItem[]> {
    return this.request<RecentActivityItem[]>(
      '/dashboard/recent-activity',
      limit !== undefined ? { limit } : undefined,
      signal,
    );
  }

  public async getDashboardQuickPicks(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<QuickPickItem[]> {
    return this.request<QuickPickItem[]>(
      '/dashboard/quick-picks',
      limit !== undefined ? { limit } : undefined,
      signal,
    );
  }
}

export const apiClient = new ApiClient();
