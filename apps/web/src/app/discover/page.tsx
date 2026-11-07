'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MediaGenre,
  MovieListItem,
  TmdbMovieSearchResult,
  TmdbTvSearchResult,
  TvShowListItem,
} from '@cinesphere/shared';
import {
  apiClient,
  CatalogueMovieFilterParams,
  CatalogueTvFilterParams,
  TmdbMovieSearchParams,
  TmdbTvSearchParams,
} from '@/lib/api-client';
import { useDebounce } from '@/hooks/use-debounce';
import { MediaCard, UnifiedMediaItem } from '@/components/media-card';
import { AddLibraryModal } from '@/components/add-library-modal';
import { TmdbAttribution } from '@/components/tmdb-attribution';
import { EmptyState, ErrorState, LoadingSkeletonGrid } from '@/components/states';

type DiscoveryTab = 'remote' | 'catalogue';
type MediaTypeSelection = 'all' | 'movie' | 'tv';

export default function DiscoverPage() {
  // ── Add to Library Modal State ─────────────────────────────────────────────
  const [addModalItem, setAddModalItem] = useState<UnifiedMediaItem | null>(null);

  // ── Active Tab ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('remote');

  // ── Remote Search State ────────────────────────────────────────────────────
  const [remoteSearchQuery, setRemoteSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(remoteSearchQuery, 400);
  const [remoteMediaType, setRemoteMediaType] = useState<MediaTypeSelection>('all');
  const [remoteIncludeAdult, setRemoteIncludeAdult] = useState(false);
  const [remoteYear, setRemoteYear] = useState<string>('');
  const [remotePage, setRemotePage] = useState(1);
  const [remoteResults, setRemoteResults] = useState<UnifiedMediaItem[]>([]);
  const [remoteTotalPages, setRemoteTotalPages] = useState(1);
  const [remoteTotalResults, setRemoteTotalResults] = useState(0);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // ── Remote Trending & Popular Sections ─────────────────────────────────────
  const [trendingMovies, setTrendingMovies] = useState<UnifiedMediaItem[]>([]);
  const [trendingTvShows, setTrendingTvShows] = useState<UnifiedMediaItem[]>([]);
  const [popularMovies, setPopularMovies] = useState<UnifiedMediaItem[]>([]);
  const [popularTvShows, setPopularTvShows] = useState<UnifiedMediaItem[]>([]);
  const [curatedLoading, setCuratedLoading] = useState(false);
  const [curatedErrors, setCuratedErrors] = useState<{
    trendingMovies?: string;
    trendingTv?: string;
    popularMovies?: string;
    popularTv?: string;
  }>({});

  // ── Local Catalogue State ──────────────────────────────────────────────────
  const [catMediaType, setCatMediaType] = useState<'movie' | 'tv'>('movie');
  const [catQuery, setCatQuery] = useState('');
  const debouncedCatQuery = useDebounce(catQuery, 400);
  const [catGenreId, setCatGenreId] = useState<string>('');
  const [catYear, setCatYear] = useState<string>('');
  const [catMinRating, setCatMinRating] = useState<string>('');
  const [catMaxRating, setCatMaxRating] = useState<string>('');
  const [catLanguage, setCatLanguage] = useState<string>('');
  const [catStatus, setCatStatus] = useState<string>('');
  const [catSortBy, setCatSortBy] = useState<string>('popularity');
  const [catSortOrder, setCatSortOrder] = useState<'desc' | 'asc'>('desc');
  const [catPage, setCatPage] = useState(1);
  const [catResults, setCatResults] = useState<UnifiedMediaItem[]>([]);
  const [catTotalPages, setCatTotalPages] = useState(1);
  const [catTotalResults, setCatTotalResults] = useState(0);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [genres, setGenres] = useState<MediaGenre[]>([]);

  // Abort controller refs to cancel stale requests
  const searchAbortRef = useRef<AbortController | null>(null);
  const catAbortRef = useRef<AbortController | null>(null);

  // ── 1. Fetch Local Genres on mount ─────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    apiClient
      .listCatalogueGenres()
      .then((data) => {
        if (isMounted) setGenres(data);
      })
      .catch(() => {
        // Non-fatal if local catalogue genres cannot be loaded
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // ── 2. Fetch Curated Trending/Popular on mount ──────────────────────────────
  const loadCuratedContent = useCallback(async () => {
    setCuratedLoading(true);
    setCuratedErrors({});

    const mapTmdbMovie = (m: TmdbMovieSearchResult): UnifiedMediaItem => ({
      tmdbId: m.id,
      title: m.title,
      overview: m.overview,
      posterPath: m.poster_path,
      backdropPath: m.backdrop_path,
      releaseDate: m.release_date,
      voteAverage: m.vote_average,
      popularity: m.popularity,
      mediaType: 'movie',
    });

    const mapTmdbTv = (t: TmdbTvSearchResult): UnifiedMediaItem => ({
      tmdbId: t.id,
      title: t.name,
      overview: t.overview,
      posterPath: t.poster_path,
      backdropPath: t.backdrop_path,
      releaseDate: t.first_air_date,
      voteAverage: t.vote_average,
      popularity: t.popularity,
      mediaType: 'tv',
    });

    try {
      const [trendMResult, trendTvResult, popMResult, popTvResult] = await Promise.allSettled([
        apiClient.getTrendingMovies(1),
        apiClient.getTrendingTvShows(1),
        apiClient.getPopularMovies(1),
        apiClient.getPopularTvShows(1),
      ]);

      const newErrors: {
        trendingMovies?: string;
        trendingTv?: string;
        popularMovies?: string;
        popularTv?: string;
      } = {};

      if (trendMResult.status === 'fulfilled') {
        setTrendingMovies(trendMResult.value.results.slice(0, 10).map(mapTmdbMovie));
      } else {
        newErrors.trendingMovies =
          (trendMResult.reason as Error)?.message || 'Failed to load trending movies.';
      }

      if (trendTvResult.status === 'fulfilled') {
        setTrendingTvShows(trendTvResult.value.results.slice(0, 10).map(mapTmdbTv));
      } else {
        newErrors.trendingTv =
          (trendTvResult.reason as Error)?.message || 'Failed to load trending TV shows.';
      }

      if (popMResult.status === 'fulfilled') {
        setPopularMovies(popMResult.value.results.slice(0, 10).map(mapTmdbMovie));
      } else {
        newErrors.popularMovies =
          (popMResult.reason as Error)?.message || 'Failed to load popular movies.';
      }

      if (popTvResult.status === 'fulfilled') {
        setPopularTvShows(popTvResult.value.results.slice(0, 10).map(mapTmdbTv));
      } else {
        newErrors.popularTv =
          (popTvResult.reason as Error)?.message || 'Failed to load popular TV shows.';
      }

      setCuratedErrors(newErrors);
    } finally {
      setCuratedLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCuratedContent();
  }, [loadCuratedContent]);

  // ── 3. Remote TMDB Search Effect ───────────────────────────────────────────
  useEffect(() => {
    const trimmed = debouncedSearchQuery.trim();
    if (!trimmed) {
      setRemoteResults([]);
      setRemoteTotalPages(1);
      setRemoteTotalResults(0);
      setRemoteLoading(false);
      setRemoteError(null);
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setRemoteLoading(true);
    setRemoteError(null);

    const yearNum = remoteYear ? parseInt(remoteYear, 10) : undefined;

    const executeSearch = async () => {
      try {
        if (remoteMediaType === 'movie') {
          const params: TmdbMovieSearchParams = {
            query: trimmed,
            page: remotePage,
            includeAdult: remoteIncludeAdult,
            year: yearNum,
          };
          const res = await apiClient.searchTmdbMovies(params, controller.signal);
          setRemoteResults(
            res.results.map((m) => ({
              tmdbId: m.id,
              title: m.title,
              overview: m.overview,
              posterPath: m.poster_path,
              backdropPath: m.backdrop_path,
              releaseDate: m.release_date,
              voteAverage: m.vote_average,
              popularity: m.popularity,
              mediaType: 'movie',
            })),
          );
          setRemoteTotalPages(res.totalPages);
          setRemoteTotalResults(res.totalResults);
        } else if (remoteMediaType === 'tv') {
          const params: TmdbTvSearchParams = {
            query: trimmed,
            page: remotePage,
            includeAdult: remoteIncludeAdult,
            firstAirDateYear: yearNum,
          };
          const res = await apiClient.searchTmdbTvShows(params, controller.signal);
          setRemoteResults(
            res.results.map((t) => ({
              tmdbId: t.id,
              title: t.name,
              overview: t.overview,
              posterPath: t.poster_path,
              backdropPath: t.backdrop_path,
              releaseDate: t.first_air_date,
              voteAverage: t.vote_average,
              popularity: t.popularity,
              mediaType: 'tv',
            })),
          );
          setRemoteTotalPages(res.totalPages);
          setRemoteTotalResults(res.totalResults);
        } else {
          // 'all': fetch both and combine
          const [movieRes, tvRes] = await Promise.all([
            apiClient.searchTmdbMovies(
              {
                query: trimmed,
                page: remotePage,
                includeAdult: remoteIncludeAdult,
                year: yearNum,
              },
              controller.signal,
            ),
            apiClient.searchTmdbTvShows(
              {
                query: trimmed,
                page: remotePage,
                includeAdult: remoteIncludeAdult,
                firstAirDateYear: yearNum,
              },
              controller.signal,
            ),
          ]);

          const combined: UnifiedMediaItem[] = [
            ...movieRes.results.map((m): UnifiedMediaItem => ({
              tmdbId: m.id,
              title: m.title,
              overview: m.overview,
              posterPath: m.poster_path,
              backdropPath: m.backdrop_path,
              releaseDate: m.release_date,
              voteAverage: m.vote_average,
              popularity: m.popularity,
              mediaType: 'movie',
            })),
            ...tvRes.results.map((t): UnifiedMediaItem => ({
              tmdbId: t.id,
              title: t.name,
              overview: t.overview,
              posterPath: t.poster_path,
              backdropPath: t.backdrop_path,
              releaseDate: t.first_air_date,
              voteAverage: t.vote_average,
              popularity: t.popularity,
              mediaType: 'tv',
            })),
          ];

          combined.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
          setRemoteResults(combined);
          setRemoteTotalPages(Math.max(movieRes.totalPages, tvRes.totalPages));
          setRemoteTotalResults(movieRes.totalResults + tvRes.totalResults);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const error = err as Error;
        setRemoteError(error.message || 'TMDB search request failed.');
      } finally {
        setRemoteLoading(false);
      }
    };

    executeSearch();

    return () => {
      controller.abort();
    };
  }, [debouncedSearchQuery, remoteMediaType, remoteIncludeAdult, remoteYear, remotePage]);

  // Reset remote pagination on filter change
  const handleRemoteQueryChange = (val: string) => {
    setRemoteSearchQuery(val);
    setRemotePage(1);
  };
  const handleRemoteMediaTypeChange = (type: MediaTypeSelection) => {
    setRemoteMediaType(type);
    setRemotePage(1);
  };

  // ── 4. Local Catalogue Fetch Effect ────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'catalogue') return;

    if (catAbortRef.current) {
      catAbortRef.current.abort();
    }
    const controller = new AbortController();
    catAbortRef.current = controller;

    setCatLoading(true);
    setCatError(null);

    const yearNum = catYear ? parseInt(catYear, 10) : undefined;
    const genreNum = catGenreId ? parseInt(catGenreId, 10) : undefined;
    const minRatNum = catMinRating ? parseFloat(catMinRating) : undefined;
    const maxRatNum = catMaxRating ? parseFloat(catMaxRating) : undefined;

    const executeCatalogueFetch = async () => {
      try {
        if (catMediaType === 'movie') {
          const params: CatalogueMovieFilterParams = {
            query: debouncedCatQuery.trim() || undefined,
            page: catPage,
            limit: 20,
            genreId: genreNum,
            year: yearNum,
            minRating: minRatNum,
            maxRating: maxRatNum,
            language: catLanguage || undefined,
            sortBy: catSortBy as any,
            sortOrder: catSortOrder,
          };

          const res = await apiClient.listCatalogueMovies(params, controller.signal);
          setCatResults(
            res.items.map((m: MovieListItem): UnifiedMediaItem => ({
              id: m.id,
              tmdbId: m.tmdbId,
              title: m.title,
              overview: m.overview,
              posterPath: m.posterPath,
              backdropPath: m.backdropPath,
              releaseDate: m.releaseDate,
              voteAverage: m.voteAverage,
              popularity: m.popularity,
              mediaType: 'movie',
              genres: m.genres,
            })),
          );
          setCatTotalPages(res.totalPages);
          setCatTotalResults(res.totalResults);
        } else {
          const params: CatalogueTvFilterParams = {
            query: debouncedCatQuery.trim() || undefined,
            page: catPage,
            limit: 20,
            genreId: genreNum,
            firstAirDateYear: yearNum,
            minRating: minRatNum,
            maxRating: maxRatNum,
            language: catLanguage || undefined,
            status: catStatus || undefined,
            sortBy: (catSortBy === 'releaseDate' ? 'firstAirDate' : catSortBy) as any,
            sortOrder: catSortOrder,
          };

          const res = await apiClient.listCatalogueTvShows(params, controller.signal);
          setCatResults(
            res.items.map((t: TvShowListItem): UnifiedMediaItem => ({
              id: t.id,
              tmdbId: t.tmdbId,
              title: t.name,
              overview: t.overview,
              posterPath: t.posterPath,
              backdropPath: t.backdropPath,
              releaseDate: t.firstAirDate,
              voteAverage: t.voteAverage,
              popularity: t.popularity,
              mediaType: 'tv',
              genres: t.genres,
            })),
          );
          setCatTotalPages(res.totalPages);
          setCatTotalResults(res.totalResults);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const error = err as Error;
        setCatError(error.message || 'Failed to fetch catalogue records.');
      } finally {
        setCatLoading(false);
      }
    };

    executeCatalogueFetch();

    return () => {
      controller.abort();
    };
  }, [
    activeTab,
    catMediaType,
    debouncedCatQuery,
    catGenreId,
    catYear,
    catMinRating,
    catMaxRating,
    catLanguage,
    catStatus,
    catSortBy,
    catSortOrder,
    catPage,
  ]);

  const handleResetCatFilters = () => {
    setCatQuery('');
    setCatGenreId('');
    setCatYear('');
    setCatMinRating('');
    setCatMaxRating('');
    setCatLanguage('');
    setCatStatus('');
    setCatSortBy('popularity');
    setCatSortOrder('desc');
    setCatPage(1);
  };

  const hasSearchQuery = debouncedSearchQuery.trim().length > 0;

  return (
    <div className="min-h-screen flex flex-col justify-between max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <div className="space-y-8">
        {/* ── Page Header ────────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Discover <span className="text-sky-400">Entertainment</span>
            </h1>
            <p className="text-slate-400 text-sm sm:text-base mt-1">
              Explore global movies and TV shows via TMDB or browse your stored local collection.
            </p>
          </div>

          {/* Primary View Switcher */}
          <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-800 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('remote')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'remote'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TMDB Search & Trends
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('catalogue')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'catalogue'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Local Library
            </button>
          </div>
        </div>

        {/* ── TAB 1: REMOTE TMDB SEARCH & DISCOVERY ───────────────────────────── */}
        {activeTab === 'remote' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Search Input & Controls */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm space-y-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                    />
                  </svg>
                </div>

                <input
                  type="text"
                  value={remoteSearchQuery}
                  onChange={(e) => handleRemoteQueryChange(e.target.value)}
                  placeholder="Search TMDB for movies or TV shows (e.g. Inception, Breaking Bad)..."
                  className="w-full pl-11 pr-10 py-3 rounded-xl border border-slate-700 bg-slate-950 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-all"
                  data-testid="remote-search-input"
                />

                {remoteSearchQuery && (
                  <button
                    type="button"
                    onClick={() => handleRemoteQueryChange('')}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white"
                    aria-label="Clear search"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Filters Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                {/* Media Type Selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Type:</span>
                  {(['all', 'movie', 'tv'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleRemoteMediaTypeChange(t)}
                      className={`px-3 py-1.5 rounded-lg font-medium capitalize transition-colors ${
                        remoteMediaType === t
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                      }`}
                    >
                      {t === 'all' ? 'All Types' : t === 'movie' ? 'Movies' : 'TV Shows'}
                    </button>
                  ))}
                </div>

                {/* Additional Optional Filters */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium">Year:</span>
                    <input
                      type="number"
                      min={1888}
                      max={2100}
                      value={remoteYear}
                      onChange={(e) => {
                        setRemoteYear(e.target.value);
                        setRemotePage(1);
                      }}
                      placeholder="e.g. 2024"
                      className="w-20 px-2 py-1 rounded-md border border-slate-700 bg-slate-950 text-slate-200 text-xs focus:ring-1 focus:ring-sky-400 focus:outline-none"
                    />
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-400 hover:text-slate-300">
                    <input
                      type="checkbox"
                      checked={remoteIncludeAdult}
                      onChange={(e) => {
                        setRemoteIncludeAdult(e.target.checked);
                        setRemotePage(1);
                      }}
                      className="rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-400"
                    />
                    <span>Include 18+</span>
                  </label>
                </div>
              </div>
            </div>

            {/* ── Search Results State ── */}
            {hasSearchQuery && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    Search Results for{' '}
                    <span className="text-sky-400">&ldquo;{debouncedSearchQuery}&rdquo;</span>
                    {remoteTotalResults > 0 && (
                      <span className="text-xs font-normal text-slate-400">
                        ({remoteTotalResults} found)
                      </span>
                    )}
                  </h2>

                  {remoteLoading && (
                    <div className="flex items-center gap-2 text-xs text-sky-400">
                      <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
                      Searching TMDB...
                    </div>
                  )}
                </div>

                {remoteError ? (
                  <ErrorState
                    message={remoteError}
                    onRetry={() => {
                      setRemotePage((p) => p);
                    }}
                  />
                ) : remoteLoading ? (
                  <LoadingSkeletonGrid count={10} />
                ) : remoteResults.length === 0 ? (
                  <EmptyState
                    title="No Titles Found on TMDB"
                    description={`We couldn't find any titles matching "${debouncedSearchQuery}". Try checking the spelling or adjusting filters.`}
                    onReset={() => {
                      setRemoteSearchQuery('');
                      setRemoteYear('');
                      setRemoteIncludeAdult(false);
                    }}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                      {remoteResults.map((item) => (
                        <MediaCard
                          key={`${item.mediaType}-${item.tmdbId}`}
                          item={item}
                          onAddToLibrary={(media) => setAddModalItem(media)}
                        />
                      ))}
                    </div>

                    {/* Pagination */}
                    {remoteTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-3 pt-6 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setRemotePage((p) => Math.max(1, p - 1))}
                          disabled={remotePage <= 1 || remoteLoading}
                          className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                        >
                          &larr; Previous
                        </button>
                        <span className="text-xs text-slate-400 font-mono">
                          Page {remotePage} of {remoteTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRemotePage((p) => Math.min(remoteTotalPages, p + 1))}
                          disabled={remotePage >= remoteTotalPages || remoteLoading}
                          className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                        >
                          Next &rarr;
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Default Curated View: Trending & Popular (when search is empty) ── */}
            {!hasSearchQuery && (
              <div className="space-y-12">
                {/* Trending Movies Today */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                      <span className="text-amber-400">🔥</span> Trending Movies Today
                    </h2>
                    <span className="text-xs text-slate-500 font-mono">Top TMDB Picks</span>
                  </div>

                  {curatedLoading ? (
                    <LoadingSkeletonGrid count={5} />
                  ) : curatedErrors.trendingMovies ? (
                    <ErrorState
                      message={curatedErrors.trendingMovies}
                      onRetry={loadCuratedContent}
                    />
                  ) : trendingMovies.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                      {trendingMovies.map((movie) => (
                        <MediaCard
                          key={`trend-m-${movie.tmdbId}`}
                          item={movie}
                          onAddToLibrary={(media) => setAddModalItem(media)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>

                {/* Trending TV Shows Today */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                      <span className="text-indigo-400">📺</span> Trending TV Shows Today
                    </h2>
                    <span className="text-xs text-slate-500 font-mono">Top TMDB Picks</span>
                  </div>

                  {curatedLoading ? (
                    <LoadingSkeletonGrid count={5} />
                  ) : curatedErrors.trendingTv ? (
                    <ErrorState message={curatedErrors.trendingTv} onRetry={loadCuratedContent} />
                  ) : trendingTvShows.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                      {trendingTvShows.map((tv) => (
                        <MediaCard
                          key={`trend-tv-${tv.tmdbId}`}
                          item={tv}
                          onAddToLibrary={(media) => setAddModalItem(media)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>

                {/* Most Popular Movies */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                      <span className="text-sky-400">⭐</span> Most Popular Movies
                    </h2>
                    <span className="text-xs text-slate-500 font-mono">Audience Favorites</span>
                  </div>

                  {curatedLoading ? (
                    <LoadingSkeletonGrid count={5} />
                  ) : curatedErrors.popularMovies ? (
                    <ErrorState
                      message={curatedErrors.popularMovies}
                      onRetry={loadCuratedContent}
                    />
                  ) : popularMovies.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                      {popularMovies.map((movie) => (
                        <MediaCard
                          key={`pop-m-${movie.tmdbId}`}
                          item={movie}
                          onAddToLibrary={(media) => setAddModalItem(media)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>

                {/* Most Popular TV Shows */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                      <span className="text-emerald-400">📺</span> Most Popular TV Shows
                    </h2>
                    <span className="text-xs text-slate-500 font-mono">Audience Favorites</span>
                  </div>

                  {curatedLoading ? (
                    <LoadingSkeletonGrid count={5} />
                  ) : curatedErrors.popularTv ? (
                    <ErrorState message={curatedErrors.popularTv} onRetry={loadCuratedContent} />
                  ) : popularTvShows.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                      {popularTvShows.map((tv) => (
                        <MediaCard
                          key={`pop-tv-${tv.tmdbId}`}
                          item={tv}
                          onAddToLibrary={(media) => setAddModalItem(media)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: LOCAL CATALOGUE LIBRARY ──────────────────────────────────── */}
        {activeTab === 'catalogue' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Filter & Search Bar */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Search title/name */}
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={catQuery}
                    onChange={(e) => {
                      setCatQuery(e.target.value);
                      setCatPage(1);
                    }}
                    placeholder={`Filter local ${catMediaType === 'movie' ? 'movies' : 'TV shows'} by title...`}
                    className="w-full pl-10 pr-8 py-2 rounded-xl border border-slate-700 bg-slate-950 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                    data-testid="catalogue-search-input"
                  />
                  {catQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setCatQuery('');
                        setCatPage(1);
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                    >
                      &times;
                    </button>
                  )}
                </div>

                {/* Media Type Filter */}
                <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => {
                      setCatMediaType('movie');
                      setCatPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      catMediaType === 'movie'
                        ? 'bg-sky-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Movies
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCatMediaType('tv');
                      setCatPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      catMediaType === 'tv'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    TV Shows
                  </button>
                </div>
              </div>

              {/* Filter Controls Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 text-xs pt-1 border-t border-slate-800">
                {/* Genre Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Genre</label>
                  <select
                    value={catGenreId}
                    onChange={(e) => {
                      setCatGenreId(e.target.value);
                      setCatPage(1);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    <option value="">All Genres</option>
                    {genres.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Year Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Year</label>
                  <input
                    type="number"
                    min={1888}
                    max={2100}
                    value={catYear}
                    onChange={(e) => {
                      setCatYear(e.target.value);
                      setCatPage(1);
                    }}
                    placeholder="e.g. 2023"
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                </div>

                {/* Language Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Language</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={catLanguage}
                    onChange={(e) => {
                      setCatLanguage(e.target.value);
                      setCatPage(1);
                    }}
                    placeholder="e.g. en, fr"
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                </div>

                {/* TV Status Filter (active when TV is selected) */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Status</label>
                  <select
                    value={catStatus}
                    disabled={catMediaType !== 'tv'}
                    onChange={(e) => {
                      setCatStatus(e.target.value);
                      setCatPage(1);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    <option value="">All Statuses</option>
                    <option value="Returning Series">Returning</option>
                    <option value="Ended">Ended</option>
                    <option value="Canceled">Canceled</option>
                    <option value="In Production">In Production</option>
                    <option value="Planned">Planned</option>
                  </select>
                </div>

                {/* Min Rating */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Min Rating</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={10}
                    value={catMinRating}
                    onChange={(e) => {
                      setCatMinRating(e.target.value);
                      setCatPage(1);
                    }}
                    placeholder="0.0 - 10"
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                </div>

                {/* Max Rating */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Max Rating</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={10}
                    value={catMaxRating}
                    onChange={(e) => {
                      setCatMaxRating(e.target.value);
                      setCatPage(1);
                    }}
                    placeholder="0.0 - 10"
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                </div>

                {/* Sort By */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Sort By</label>
                  <select
                    value={catSortBy}
                    onChange={(e) => {
                      setCatSortBy(e.target.value);
                      setCatPage(1);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    <option value="popularity">Popularity</option>
                    <option value="rating">Rating</option>
                    <option value="releaseDate">Release Date</option>
                    <option value="title">{catMediaType === 'movie' ? 'Title' : 'Name'}</option>
                  </select>
                </div>

                {/* Sort Order */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Order</label>
                  <select
                    value={catSortOrder}
                    onChange={(e) => {
                      setCatSortOrder(e.target.value as 'asc' | 'desc');
                      setCatPage(1);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Results Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Stored {catMediaType === 'movie' ? 'Movies' : 'TV Shows'}
                {catTotalResults > 0 && (
                  <span className="text-xs font-normal text-slate-400">
                    ({catTotalResults} in catalogue)
                  </span>
                )}
              </h2>

              <button
                type="button"
                onClick={handleResetCatFilters}
                className="text-xs text-slate-400 hover:text-sky-300 underline underline-offset-4"
              >
                Reset Filters
              </button>
            </div>

            {/* ── Results Content ── */}
            {catError ? (
              <ErrorState
                message={catError}
                onRetry={() => {
                  setCatPage((p) => p);
                }}
              />
            ) : catLoading ? (
              <LoadingSkeletonGrid count={10} />
            ) : catResults.length === 0 ? (
              <EmptyState
                title="No Catalogue Titles Found"
                description="Your local database currently has no records matching these filter criteria. Ingest titles or broaden your filter settings."
                onReset={handleResetCatFilters}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                  {catResults.map((item) => (
                    <MediaCard
                      key={`cat-${item.mediaType}-${item.id || item.tmdbId}`}
                      item={item}
                      onAddToLibrary={(media) => setAddModalItem(media)}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {catTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-6 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCatPage((p) => Math.max(1, p - 1))}
                      disabled={catPage <= 1 || catLoading}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                    >
                      &larr; Previous
                    </button>
                    <span className="text-xs text-slate-400 font-mono">
                      Page {catPage} of {catTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCatPage((p) => Math.min(catTotalPages, p + 1))}
                      disabled={catPage >= catTotalPages || catLoading}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── TMDB Attribution Section ────────────────────────────────────────── */}
      <footer className="pt-10 border-t border-slate-800/80">
        <TmdbAttribution />
      </footer>

      {/* ── Add to Library Modal ─────────────────────────────────────────────── */}
      <AddLibraryModal
        item={addModalItem}
        isOpen={Boolean(addModalItem)}
        onClose={() => setAddModalItem(null)}
      />
    </div>
  );
}
