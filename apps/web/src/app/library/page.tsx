'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LibraryEntryListItem,
  LibraryEntryResponse,
  LibraryMediaType,
  LibraryStatus,
  ListLibraryQuery,
} from '@cinesphere/shared';
import { apiClient } from '@/lib/api-client';
import { LibraryCard } from '@/components/library-card';
import { LibraryDetailModal } from '@/components/library-detail-modal';
import { EmptyState, ErrorState, LoadingSkeletonGrid } from '@/components/states';

type StatusFilter = 'ALL' | LibraryStatus;
type MediaFilter = 'ALL' | LibraryMediaType;

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All Titles', value: 'ALL' },
  { label: 'Watching', value: 'WATCHING' },
  { label: 'Plan to Watch', value: 'PLAN_TO_WATCH' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Dropped', value: 'DROPPED' },
];

const SORT_OPTIONS: {
  label: string;
  sortBy: ListLibraryQuery['sortBy'];
  sortOrder: ListLibraryQuery['sortOrder'];
}[] = [
  { label: 'Recently Updated', sortBy: 'updatedAt', sortOrder: 'desc' },
  { label: 'Recently Added', sortBy: 'createdAt', sortOrder: 'desc' },
  { label: 'Highest Rating', sortBy: 'personalRating', sortOrder: 'desc' },
  { label: 'Lowest Rating', sortBy: 'personalRating', sortOrder: 'asc' },
  { label: 'Title (A-Z)', sortBy: 'title', sortOrder: 'asc' },
  { label: 'Title (Z-A)', sortBy: 'title', sortOrder: 'desc' },
];

export default function LibraryPage() {
  // ── Filters & Query State ──────────────────────────────────────────────────
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('ALL');
  const [selectedMediaType, setSelectedMediaType] = useState<MediaFilter>('ALL');
  const [selectedSortIndex, setSelectedSortIndex] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  // ── Data & Request State ───────────────────────────────────────────────────
  const [items, setItems] = useState<LibraryEntryListItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Detail Modal State ─────────────────────────────────────────────────────
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Fetch Library Entries ──────────────────────────────────────────────────
  const fetchLibrary = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    const sortConfig = SORT_OPTIONS[selectedSortIndex] || SORT_OPTIONS[0];

    try {
      const res = await apiClient.listLibrary(
        {
          status: selectedStatus === 'ALL' ? undefined : selectedStatus,
          mediaType: selectedMediaType === 'ALL' ? undefined : selectedMediaType,
          page,
          limit,
          sortBy: sortConfig.sortBy,
          sortOrder: sortConfig.sortOrder,
        },
        controller.signal,
      );

      setItems(res.items);
      setTotalResults(res.totalResults);
      setTotalPages(res.totalPages || 1);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to load personal library.');
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, selectedMediaType, selectedSortIndex, page]);

  useEffect(() => {
    fetchLibrary();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchLibrary]);

  // Handle entry updates from the detail modal
  const handleEntryUpdated = (updated: LibraryEntryResponse) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  };

  // Handle entry deletion
  const handleEntryDeleted = (deletedId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== deletedId));
    setTotalResults((prev) => Math.max(0, prev - 1));
  };

  // Open manage modal
  const handleManage = (entry: LibraryEntryListItem) => {
    setSelectedEntryId(entry.id);
    setIsDetailOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-slate-900/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-sky-950/70 border border-sky-800 text-sky-400 mb-2">
                Personal Media Tracking
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                My Library
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Track watch status, personal ratings, movie rewatches, and TV episode progress.
              </p>
            </div>

            {/* Discover CTA */}
            <Link
              href="/discover"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/20 hover:shadow-sky-500/30 transition-all self-start sm:self-center"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Discover &amp; Add Titles
            </Link>
          </div>

          {/* ── Filter & Navigation Bar ────────────────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Status Tabs */}
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {STATUS_TABS.map((tab) => {
                const isActive = selectedStatus === tab.value;
                return (
                  <button
                    key={tab.value}
                    role="tab"
                    aria-selected={isActive}
                    type="button"
                    onClick={() => {
                      setSelectedStatus(tab.value);
                      setPage(1);
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Secondary Filters: Media Type & Sorting */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Media Type Toggle */}
              <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-1">
                {(['ALL', 'MOVIE', 'TV'] as MediaFilter[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setSelectedMediaType(m);
                      setPage(1);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                      selectedMediaType === m
                        ? 'bg-slate-800 text-sky-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m === 'ALL' ? 'All Types' : m === 'MOVIE' ? 'Movies' : 'TV Shows'}
                  </button>
                ))}
              </div>

              {/* Sort By Dropdown */}
              <div className="relative">
                <select
                  value={selectedSortIndex}
                  onChange={(e) => {
                    setSelectedSortIndex(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-xs rounded-xl border border-slate-800 bg-slate-900 text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
                >
                  {SORT_OPTIONS.map((opt, idx) => (
                    <option key={opt.label} value={idx}>
                      Sort: {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Library Content ──────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Active Filter Summary */}
        <div className="flex items-center justify-between mb-6 text-xs text-slate-400">
          <span>
            Showing <strong className="text-slate-200">{items.length}</strong> of{' '}
            <strong className="text-slate-200">{totalResults}</strong> titles
          </span>

          {(selectedStatus !== 'ALL' || selectedMediaType !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSelectedStatus('ALL');
                setSelectedMediaType('ALL');
                setPage(1);
              }}
              className="text-sky-400 hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Content States */}
        {loading ? (
          <LoadingSkeletonGrid count={8} />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchLibrary} />
        ) : items.length === 0 ? (
          <EmptyState
            title={selectedStatus === 'ALL' ? 'Your library is empty' : 'No titles found in this view'}
            description={
              selectedStatus === 'ALL'
                ? 'Start building your personal collection by discovering movies and TV shows from TMDB or the local catalogue.'
                : 'Try changing the status tab, media type filter, or search for more titles.'
            }
            onReset={
              selectedStatus !== 'ALL' || selectedMediaType !== 'ALL'
                ? () => {
                    setSelectedStatus('ALL');
                    setSelectedMediaType('ALL');
                    setPage(1);
                  }
                : undefined
            }
          />
        ) : (
          <div className="space-y-8">
            {/* Library Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
              {items.map((entry) => (
                <LibraryCard key={entry.id} entry={entry} onManage={handleManage} />
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-8 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                >
                  &larr; Previous
                </button>
                <span className="text-xs text-slate-400 font-mono">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Library Detail & Management Modal ─────────────────────────────────── */}
      <LibraryDetailModal
        entryId={selectedEntryId}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedEntryId(null);
        }}
        onEntryUpdated={handleEntryUpdated}
        onEntryDeleted={handleEntryDeleted}
      />
    </div>
  );
}
