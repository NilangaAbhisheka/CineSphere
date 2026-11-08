'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ContinueWatchingItem,
  DashboardOverviewResponse,
  DashboardStats,
  LibraryEntryResponse,
  QuickPickItem,
  RecentActivityItem,
} from '@cinesphere/shared';
import { apiClient, ApiClientError } from '../lib/api-client';
import { getTmdbImageUrl } from '../lib/tmdb-image';
import { LibraryDetailModal } from '../components/library-detail-modal';

// ── Skeleton helper ──────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className ?? ''}`} />;
}

// ── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
}

function StatCard({ label, value, icon, accent = 'text-sky-400' }: StatCardProps) {
  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center gap-4">
      <div className={`text-2xl ${accent}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-2xl font-bold text-slate-100 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center gap-4">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  );
}

// ── Continue Watching Card ───────────────────────────────────────────────────

interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
  onManage: (entryId: string) => void;
}

function ContinueWatchingCard({ item, onManage }: ContinueWatchingCardProps) {
  const posterUrl = item.tvShow.posterPath ? getTmdbImageUrl(item.tvShow.posterPath, 'w185') : null;

  const nextLabel = item.nextEpisode
    ? `S${String(item.nextEpisode.seasonNumber).padStart(2, '0')}E${String(item.nextEpisode.episodeNumber).padStart(2, '0')}${item.nextEpisode.name ? ` · ${item.nextEpisode.name}` : ''}`
    : null;

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-slate-700 transition-colors">
      {/* Poster */}
      <div className="flex-shrink-0 w-14 rounded-lg overflow-hidden bg-slate-800 aspect-[2/3]">
        {posterUrl ? (
          <img src={posterUrl} alt={item.tvShow.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100 truncate">{item.tvShow.name}</p>
          {nextLabel && <p className="text-xs text-sky-400 truncate mt-0.5">Next: {nextLabel}</p>}
        </div>

        {/* Progress bar */}
        <div className="mt-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>
              {item.episodesWatched}/{item.totalEligibleEpisodes} episodes
            </span>
            <span>{item.progressPercentage}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500"
              style={{ width: `${item.progressPercentage}%` }}
            />
          </div>
        </div>

        <button
          onClick={() => onManage(item.libraryEntryId)}
          className="mt-2 self-start text-xs font-medium text-slate-400 hover:text-sky-400 transition-colors"
        >
          Manage →
        </button>
      </div>
    </div>
  );
}

function ContinueWatchingCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-slate-800">
      <Skeleton className="flex-shrink-0 w-14 rounded-lg aspect-[2/3]" />
      <div className="flex-1 space-y-2 pt-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-1.5 w-full mt-3" />
      </div>
    </div>
  );
}

// ── Recent Activity Row ──────────────────────────────────────────────────────

interface RecentActivityRowProps {
  item: RecentActivityItem;
}

function RecentActivityRow({ item }: RecentActivityRowProps) {
  const isMovie = item.activityType === 'MOVIE';
  const posterPath = isMovie ? item.movie?.posterPath : item.tvShow?.posterPath;
  const title = isMovie ? (item.movie?.title ?? 'Unknown') : (item.tvShow?.name ?? 'Unknown');
  const posterUrl = posterPath ? getTmdbImageUrl(posterPath, 'w92') : null;

  const subtitle = isMovie
    ? item.viewingEventRating != null
      ? `Rated ${item.viewingEventRating.toFixed(1)} · Movie`
      : 'Movie'
    : item.episodeNumber != null && item.seasonNumber != null
      ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}${item.episodeName ? ` · ${item.episodeName}` : ''}`
      : 'TV Episode';

  const relativeTime = (() => {
    const diff = Date.now() - new Date(item.watchedAt).getTime();
    const h = Math.floor(diff / 3_600_000);
    const d = Math.floor(diff / 86_400_000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(item.watchedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  })();

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-800/60 last:border-0">
      <div className="flex-shrink-0 w-9 h-14 rounded bg-slate-800 overflow-hidden">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-600 text-xs">
            {isMovie ? '🎬' : '📺'}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{title}</p>
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
      </div>
      <span className="text-xs text-slate-600 whitespace-nowrap">{relativeTime}</span>
    </div>
  );
}

function RecentActivityRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-800/60">
      <Skeleton className="flex-shrink-0 w-9 h-14 rounded" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  );
}

// ── Quick Pick Card ──────────────────────────────────────────────────────────

interface QuickPickCardProps {
  item: QuickPickItem;
  onAdd: (item: QuickPickItem) => void;
}

function QuickPickCard({ item, onAdd }: QuickPickCardProps) {
  const posterUrl = item.posterPath ? getTmdbImageUrl(item.posterPath, 'w185') : null;

  return (
    <div className="flex-shrink-0 w-28 rounded-xl overflow-hidden border border-slate-800 bg-slate-900/50 hover:border-slate-600 transition-colors group">
      <div className="relative aspect-[2/3] bg-slate-800">
        {posterUrl ? (
          <img src={posterUrl} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-600 text-2xl">
            {item.mediaType === 'MOVIE' ? '🎬' : '📺'}
          </div>
        )}
        {item.voteAverage != null && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-xs font-bold text-amber-400">
            ★ {item.voteAverage.toFixed(1)}
          </div>
        )}
        <button
          onClick={() => onAdd(item)}
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition-colors opacity-0 group-hover:opacity-100"
          aria-label={`Add ${item.title} to library`}
        >
          <span className="text-white text-xs font-semibold bg-sky-600 px-2.5 py-1 rounded-lg shadow">
            + Add
          </span>
        </button>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-tight">
          {item.title}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {item.releaseYear ?? '—'} · {item.mediaType === 'MOVIE' ? 'Film' : 'Series'}
        </p>
      </div>
    </div>
  );
}

function QuickPickCardSkeleton() {
  return (
    <div className="flex-shrink-0 w-28 rounded-xl overflow-hidden border border-slate-800">
      <Skeleton className="aspect-[2/3] w-full" />
      <div className="p-2 space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

// ── Section Wrapper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

function Section({ title, children, action }: SectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-200">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

// ── Quick Add Modal ──────────────────────────────────────────────────────────

interface QuickAddModalProps {
  item: QuickPickItem;
  onClose: () => void;
  onSuccess: () => void;
}

function QuickAddModal({ item, onClose, onSuccess }: QuickAddModalProps) {
  const [status, setStatus] = useState<string>('PLAN_TO_WATCH');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleAdd = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiClient.createLibraryEntry({
        mediaType: item.mediaType === 'MOVIE' ? 'MOVIE' : 'TV',
        tmdbId: item.tmdbId,
        status: status as 'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED',
      });
      onSuccess();
      onClose();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new Error('Failed to add to library');
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100 mb-1">Add to Library</h3>
        <p className="text-sm text-slate-400 mb-4 truncate">{item.title}</p>

        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="PLAN_TO_WATCH">Plan to Watch</option>
            <option value="WATCHING">Watching</option>
            <option value="COMPLETED">Completed</option>
            <option value="DROPPED">Dropped</option>
          </select>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 text-sm font-medium py-2 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={loading}
            className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            {loading ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Library detail modal state
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Quick add modal
  const [quickAddTarget, setQuickAddTarget] = useState<QuickPickItem | null>(null);

  const fetchOverview = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiClient
      .getDashboardOverview(controller.signal)
      .then((data) => {
        setOverview(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const e = err instanceof ApiClientError ? err : new Error('Failed to load dashboard');
        setError(e.message);
        setLoading(false);
      });

    return controller;
  }, []);

  useEffect(() => {
    const controller = fetchOverview();
    return () => controller.abort();
  }, [fetchOverview]);

  const handleEntryUpdated = useCallback(
    (_updated?: LibraryEntryResponse) => {
      fetchOverview();
    },
    [fetchOverview],
  );

  const handleEntryDeleted = useCallback(
    (_deletedId?: string) => {
      setModalOpen(false);
      setSelectedEntryId(null);
      fetchOverview();
    },
    [fetchOverview],
  );

  const handleManage = (entryId: string) => {
    setSelectedEntryId(entryId);
    setModalOpen(true);
  };

  const stats: DashboardStats = overview?.stats ?? {
    totalMovies: 0,
    completedMovies: 0,
    watchingTvShows: 0,
    completedTvShows: 0,
    totalEpisodesWatched: 0,
    totalViewingEvents: 0,
    recentActivityCount: 0,
  };

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-slate-100">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-slate-400 text-sm">{error}</p>
          <button
            onClick={() => fetchOverview()}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-6 md:p-8 text-slate-100 max-w-5xl mx-auto">
      {/* ── Welcome Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-200 to-indigo-300">
            Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">Your personal movie and TV universe</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/library"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
          >
            My Library
          </Link>
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
          >
            Discover
          </Link>
        </div>
      </div>

      <div className="space-y-8">
        {/* ── Viewing Summary ─────────────────────────────────────────── */}
        <Section title="Viewing Summary">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard
                  label="Movies Tracked"
                  value={stats.totalMovies}
                  icon={<span>🎬</span>}
                  accent="text-sky-400"
                />
                <StatCard
                  label="Movies Completed"
                  value={stats.completedMovies}
                  icon={<span>✅</span>}
                  accent="text-emerald-400"
                />
                <StatCard
                  label="Shows Watching"
                  value={stats.watchingTvShows}
                  icon={<span>📺</span>}
                  accent="text-violet-400"
                />
                <StatCard
                  label="Episodes Watched"
                  value={stats.totalEpisodesWatched}
                  icon={<span>▶️</span>}
                  accent="text-amber-400"
                />
              </>
            )}
          </div>
          {!loading && (
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span>
                Shows completed:{' '}
                <span className="text-slate-300 font-medium">{stats.completedTvShows}</span>
              </span>
              <span>
                Total viewings:{' '}
                <span className="text-slate-300 font-medium">{stats.totalViewingEvents}</span>
              </span>
              <span>
                Activity (30 days):{' '}
                <span className="text-slate-300 font-medium">{stats.recentActivityCount}</span>
              </span>
            </div>
          )}
        </Section>

        {/* ── Continue Watching + Recent Activity (side-by-side on larger screens) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Continue Watching ──────────────────────────────────────── */}
          <Section
            title="Continue Watching"
            action={
              <Link
                href="/library?status=WATCHING"
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                View all
              </Link>
            }
          >
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <ContinueWatchingCardSkeleton key={i} />
                ))}
              </div>
            ) : overview?.continueWatching.length === 0 ? (
              <EmptyState message="No shows in progress. Start watching a TV series from your library." />
            ) : (
              <div className="space-y-3">
                {overview?.continueWatching.map((item) => (
                  <ContinueWatchingCard
                    key={item.libraryEntryId}
                    item={item}
                    onManage={handleManage}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* ── Recent Activity ────────────────────────────────────────── */}
          <Section
            title="Recent Activity"
            action={
              <Link
                href="/library"
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                View library
              </Link>
            }
          >
            {loading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <RecentActivityRowSkeleton key={i} />
                ))}
              </div>
            ) : overview?.recentActivity.length === 0 ? (
              <EmptyState message="No recent activity. Log some movies or episodes to see them here." />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-1">
                {overview?.recentActivity.map((item, i) => (
                  <RecentActivityRow
                    key={`${item.activityType}-${item.watchedAt}-${i}`}
                    item={item}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ── Quick Picks ─────────────────────────────────────────────── */}
        <Section
          title="Quick Picks"
          action={
            <Link
              href="/discover"
              className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
            >
              Browse all
            </Link>
          }
        >
          {loading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <QuickPickCardSkeleton key={i} />
              ))}
            </div>
          ) : overview?.quickPicks.length === 0 ? (
            <EmptyState message="No catalogue items yet. Use Discover to ingest movies and TV shows." />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {overview?.quickPicks.map((item) => (
                <QuickPickCard
                  key={`${item.mediaType}-${item.id}`}
                  item={item}
                  onAdd={setQuickAddTarget}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Library Detail Modal ─────────────────────────────────────── */}
      <LibraryDetailModal
        entryId={selectedEntryId}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedEntryId(null);
        }}
        onEntryUpdated={handleEntryUpdated}
        onEntryDeleted={handleEntryDeleted}
      />

      {/* ── Quick Add Modal ──────────────────────────────────────────── */}
      {quickAddTarget && (
        <QuickAddModal
          item={quickAddTarget}
          onClose={() => setQuickAddTarget(null)}
          onSuccess={fetchOverview}
        />
      )}
    </main>
  );
}
