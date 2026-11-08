'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  EpisodeProgressResponse,
  LibraryEntryResponse,
  LibraryStatus,
  SeasonRatingResponse,
  TvShowDetails,
  ViewingEventResponse,
} from '@cinesphere/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  getBackdropPlaceholderUrl,
  getPosterPlaceholderUrl,
  getTmdbImageUrl,
} from '@/lib/tmdb-image';

const RATING_OPTIONS: { label: string; value: string }[] = [
  { label: 'Unrated', value: '' },
  ...Array.from({ length: 19 }, (_, i) => {
    const val = (1.0 + i * 0.5).toFixed(1);
    return { label: `★ ${val}`, value: val };
  }),
];

interface LibraryDetailModalProps {
  entryId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onEntryUpdated?: (updated: LibraryEntryResponse) => void;
  onEntryDeleted?: (deletedId: string) => void;
}

export function LibraryDetailModal({
  entryId,
  isOpen,
  onClose,
  onEntryUpdated,
  onEntryDeleted,
}: LibraryDetailModalProps) {
  // ── Main Entry & TV Show Metadata ──────────────────────────────────────────
  const [entry, setEntry] = useState<LibraryEntryResponse | null>(null);
  const [tvDetails, setTvDetails] = useState<TvShowDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Quick Edit States ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<LibraryStatus>('PLAN_TO_WATCH');
  const [personalRating, setPersonalRating] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesFeedback, setNotesFeedback] = useState<string | null>(null);

  // ── Viewing Event (Movie Log) Form ─────────────────────────────────────────
  const [logDate, setLogDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [logRating, setLogRating] = useState<string>('');
  const [logNotes, setLogNotes] = useState<string>('');
  const [loggingView, setLoggingView] = useState(false);
  const [logFeedback, setLogFeedback] = useState<string | null>(null);

  // ── TV Episode Operations ──────────────────────────────────────────────────
  const [includeSpecials, setIncludeSpecials] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [episodeActionId, setEpisodeActionId] = useState<string | null>(null);
  const [seasonRatingActionId, setSeasonRatingActionId] = useState<string | null>(null);
  const [tvFeedback, setTvFeedback] = useState<string | null>(null);

  // ── Delete Confirmation ────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch Entry Details ────────────────────────────────────────────────────
  const fetchDetails = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.getLibraryEntry(entryId);
      setEntry(data);
      setStatus(data.status);
      setPersonalRating(data.personalRating !== null ? String(data.personalRating) : '');
      setNotes(data.notes || '');

      // If TV, also fetch catalogue details to get all seasons and episodes
      if (data.mediaType === 'TV' && data.tvShowId) {
        try {
          const tvCat = await apiClient.getCatalogueTvShowById(data.tvShowId);
          setTvDetails(tvCat);
        } catch {
          // Non-fatal if catalogue TV lookup fails
        }
      }
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to load library entry.');
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    if (isOpen && entryId) {
      fetchDetails();
      setShowDeleteConfirm(false);
      setNotesFeedback(null);
      setLogFeedback(null);
      setTvFeedback(null);
    }
  }, [isOpen, entryId, fetchDetails]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else if (!deleting && !markingAll && !loggingView) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showDeleteConfirm, deleting, markingAll, loggingView, onClose]);

  if (!isOpen || !entryId) return null;

  // ── Quick Update Status ────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus: LibraryStatus) => {
    if (!entry || newStatus === status) return;
    setStatus(newStatus);

    try {
      const updated = await apiClient.updateLibraryEntry(entry.id, { status: newStatus });
      setEntry(updated);
      if (onEntryUpdated) onEntryUpdated(updated);
    } catch (err: unknown) {
      setStatus(entry.status); // revert
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to update status.');
    }
  };

  // ── Quick Update Rating ────────────────────────────────────────────────────
  const handleRatingChange = async (newRatingStr: string) => {
    if (!entry) return;
    setPersonalRating(newRatingStr);
    const newRatingVal = newRatingStr ? parseFloat(newRatingStr) : null;

    try {
      const updated = await apiClient.updateLibraryEntry(entry.id, {
        personalRating: newRatingVal,
      });
      setEntry(updated);
      if (onEntryUpdated) onEntryUpdated(updated);
    } catch (err: unknown) {
      setPersonalRating(entry.personalRating !== null ? String(entry.personalRating) : '');
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to update rating.');
    }
  };

  // ── Save Notes ─────────────────────────────────────────────────────────────
  const handleSaveNotes = async () => {
    if (!entry || savingNotes) return;
    setSavingNotes(true);
    setNotesFeedback(null);

    try {
      const updated = await apiClient.updateLibraryEntry(entry.id, {
        notes: notes.trim() || null,
      });
      setEntry(updated);
      setNotesFeedback('Notes saved successfully!');
      if (onEntryUpdated) onEntryUpdated(updated);
      setTimeout(() => setNotesFeedback(null), 2500);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to save notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  // ── Log Viewing Event (Movie) ──────────────────────────────────────────────
  const handleLogView = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry || loggingView) return;

    setLoggingView(true);
    setLogFeedback(null);

    try {
      const watchedAt = logDate ? new Date(logDate).toISOString() : new Date().toISOString();
      const rating = logRating ? parseFloat(logRating) : undefined;
      const res = await apiClient.createViewingEvent(entry.id, {
        watchedAt,
        rating: rating ?? null,
        notes: logNotes.trim() || null,
      });

      // Update local entry viewing events and watch stats
      const newViewingEvents: ViewingEventResponse[] = [res, ...(entry.viewingEvents || [])];
      const newWatchCount = (entry.watchStats?.totalWatchCount || 0) + 1;
      const updatedEntry: LibraryEntryResponse = {
        ...entry,
        viewingEvents: newViewingEvents,
        watchStats: {
          ...entry.watchStats,
          totalWatchCount: newWatchCount,
          lastWatchedAt: res.watchedAt,
          firstWatchedAt: entry.watchStats?.firstWatchedAt || res.watchedAt,
        },
      };

      setEntry(updatedEntry);
      setLogNotes('');
      setLogRating('');
      setLogFeedback('Watch logged successfully!');
      if (onEntryUpdated) onEntryUpdated(updatedEntry);
      setTimeout(() => setLogFeedback(null), 2500);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setLogFeedback(`Failed to log watch: ${errorObj.message}`);
    } finally {
      setLoggingView(false);
    }
  };

  // ── Toggle Episode Watched ─────────────────────────────────────────────────
  const handleToggleEpisode = async (episodeId: string, isWatched: boolean) => {
    if (!entry || episodeActionId) return;
    setEpisodeActionId(episodeId);

    try {
      if (isWatched) {
        // Unwatch
        await apiClient.deleteEpisodeProgress(entry.id, episodeId);
        const filtered = (entry.episodeProgresses || []).filter((ep) => ep.episodeId !== episodeId);
        const total = entry.watchStats?.totalEpisodes ?? entry.tvShow?.numberOfEpisodes ?? 0;
        const newWatched = Math.max(0, (entry.watchStats?.episodesWatched || 0) - 1);
        const updatedEntry: LibraryEntryResponse = {
          ...entry,
          episodeProgresses: filtered,
          watchStats: {
            ...entry.watchStats,
            episodesWatched: newWatched,
            completionPercentage: total > 0 ? Math.round((newWatched / total) * 100) : 0,
          },
        };
        setEntry(updatedEntry);
        if (onEntryUpdated) onEntryUpdated(updatedEntry);
      } else {
        // Mark watched
        const res = await apiClient.createEpisodeProgress(entry.id, episodeId);
        const existing = (entry.episodeProgresses || []).filter((ep) => ep.episodeId !== episodeId);
        const updatedProgresses: EpisodeProgressResponse[] = [res, ...existing];
        const total = entry.watchStats?.totalEpisodes ?? entry.tvShow?.numberOfEpisodes ?? 0;
        const newWatched = (entry.watchStats?.episodesWatched || 0) + 1;
        const updatedEntry: LibraryEntryResponse = {
          ...entry,
          episodeProgresses: updatedProgresses,
          watchStats: {
            ...entry.watchStats,
            episodesWatched: newWatched,
            completionPercentage: total > 0 ? Math.round((newWatched / total) * 100) : 0,
          },
        };
        setEntry(updatedEntry);
        if (onEntryUpdated) onEntryUpdated(updatedEntry);
      }
    } catch (err: unknown) {
      const errorObj = err as Error;
      setTvFeedback(`Episode update failed: ${errorObj.message}`);
      setTimeout(() => setTvFeedback(null), 3000);
    } finally {
      setEpisodeActionId(null);
    }
  };

  // ── Mark All Watched ───────────────────────────────────────────────────────
  const handleMarkAllWatched = async () => {
    if (!entry || markingAll) return;
    setMarkingAll(true);
    setTvFeedback(null);

    try {
      const res = await apiClient.markAllWatched(entry.id, includeSpecials);
      setTvFeedback(
        `Marked ${res.addedCount} new episode${res.addedCount === 1 ? '' : 's'} as watched!`,
      );

      // Refresh entry to obtain the updated episode progress list & stats
      const fresh = await apiClient.getLibraryEntry(entry.id);
      setEntry(fresh);
      if (onEntryUpdated) onEntryUpdated(fresh);
      setTimeout(() => setTvFeedback(null), 3500);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setTvFeedback(`Failed to mark all watched: ${errorObj.message}`);
    } finally {
      setMarkingAll(false);
    }
  };

  // ── Set/Update Season Rating ───────────────────────────────────────────────
  const handleSeasonRating = async (seasonId: string, ratingValueStr: string) => {
    if (!entry || seasonRatingActionId) return;
    if (!ratingValueStr) return; // Must provide half-step rating

    const ratingNum = parseFloat(ratingValueStr);
    setSeasonRatingActionId(seasonId);

    const existing = (entry.seasonRatings || []).find((sr) => sr.seasonId === seasonId);

    try {
      let saved: SeasonRatingResponse;
      if (existing) {
        saved = await apiClient.updateSeasonRating(entry.id, seasonId, ratingNum);
      } else {
        saved = await apiClient.createSeasonRating(entry.id, seasonId, ratingNum);
      }

      const others = (entry.seasonRatings || []).filter((sr) => sr.seasonId !== seasonId);
      const updatedEntry: LibraryEntryResponse = {
        ...entry,
        seasonRatings: [...others, saved].sort(
          (a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0),
        ),
      };
      setEntry(updatedEntry);
      if (onEntryUpdated) onEntryUpdated(updatedEntry);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setTvFeedback(`Failed to rate season: ${errorObj.message}`);
      setTimeout(() => setTvFeedback(null), 3000);
    } finally {
      setSeasonRatingActionId(null);
    }
  };

  // ── Delete Entry ───────────────────────────────────────────────────────────
  const handleDeleteEntry = async () => {
    if (!entry || deleting) return;
    setDeleting(true);

    try {
      await apiClient.deleteLibraryEntry(entry.id);
      if (onEntryDeleted) onEntryDeleted(entry.id);
      onClose();
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(`Delete failed: ${errorObj.message}`);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Computed display titles and imagery
  const title =
    entry?.mediaType === 'MOVIE'
      ? entry.movie?.title || 'Untitled Movie'
      : entry?.tvShow?.name || 'Untitled TV Show';

  const posterPath =
    entry?.mediaType === 'MOVIE' ? entry.movie?.posterPath : entry?.tvShow?.posterPath;
  const backdropPath =
    entry?.mediaType === 'MOVIE' ? entry.movie?.backdropPath : entry?.tvShow?.backdropPath;

  const posterUrl = posterPath
    ? getTmdbImageUrl(posterPath, 'w300') || getPosterPlaceholderUrl(title)
    : getPosterPlaceholderUrl(title);

  const backdropUrl = backdropPath
    ? getTmdbImageUrl(backdropPath, 'w780') || getBackdropPlaceholderUrl(title)
    : getBackdropPlaceholderUrl(title);

  const releaseDate =
    entry?.mediaType === 'MOVIE' ? entry.movie?.releaseDate : entry?.tvShow?.firstAirDate;

  // Episode progress set for fast lookup
  const watchedEpisodeIds = new Set((entry?.episodeProgresses || []).map((ep) => ep.episodeId));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] my-auto rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Hero / Backdrop */}
        <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-slate-950 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backdropUrl} alt={title} className="w-full h-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-20 p-2 rounded-full bg-slate-950/70 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {/* Title & Poster Overlay */}
          <div className="absolute bottom-4 left-5 right-5 flex items-end gap-4 z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl}
              alt={title}
              className="w-20 sm:w-24 aspect-[2/3] object-cover rounded-xl border-2 border-slate-700 bg-slate-950 shadow-xl shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                    entry?.mediaType === 'MOVIE'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {entry?.mediaType === 'MOVIE' ? 'Movie' : 'TV Show'}
                </span>
                {releaseDate && (
                  <span className="text-xs text-slate-400 font-mono">
                    {releaseDate.slice(0, 4)}
                  </span>
                )}
                {entry?.movie?.voteAverage && (
                  <span className="text-xs text-amber-400 font-semibold flex items-center gap-0.5">
                    ★ {entry.movie.voteAverage.toFixed(1)}
                  </span>
                )}
                {entry?.tvShow?.voteAverage && (
                  <span className="text-xs text-amber-400 font-semibold flex items-center gap-0.5">
                    ★ {entry.tvShow.voteAverage.toFixed(1)}
                  </span>
                )}
              </div>
              <h2
                id="detail-modal-title"
                className="text-xl sm:text-2xl font-bold text-white truncate"
              >
                {title}
              </h2>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">Loading library details...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800 text-rose-300 text-sm">
              {error}
            </div>
          ) : entry ? (
            <>
              {/* ── Section 1: Quick Status, Rating & Notes ───────────────────── */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Status Pills */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Status
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Plan to Watch', value: 'PLAN_TO_WATCH' as LibraryStatus },
                        { label: 'Watching', value: 'WATCHING' as LibraryStatus },
                        { label: 'Completed', value: 'COMPLETED' as LibraryStatus },
                        { label: 'Dropped', value: 'DROPPED' as LibraryStatus },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleStatusChange(opt.value)}
                          className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all border ${
                            status === opt.value
                              ? 'bg-sky-500/20 text-sky-300 border-sky-500 shadow-sm'
                              : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Personal Rating Dropdown */}
                  <div className="w-full sm:w-48">
                    <label
                      htmlFor="detail-rating-select"
                      className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5"
                    >
                      Personal Rating
                    </label>
                    <select
                      id="detail-rating-select"
                      value={personalRating}
                      onChange={(e) => handleRatingChange(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      {RATING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Personal Notes */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="detail-notes-input"
                      className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
                    >
                      Personal Notes
                    </label>
                    {notesFeedback && (
                      <span className="text-xs text-emerald-400 animate-fadeIn">
                        {notesFeedback}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      id="detail-notes-input"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add personal reflections, favourite quotes, or tags..."
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                      className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors self-end"
                    >
                      {savingNotes ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Section 2: MOVIE TRACKING ─────────────────────────────────── */}
              {entry.mediaType === 'MOVIE' && (
                <div className="space-y-6">
                  {/* Movie Watch Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/40 text-center">
                      <span className="block text-xs text-slate-400 mb-1">Total Watch Count</span>
                      <span className="text-xl font-bold text-sky-400">
                        {entry.watchStats?.totalWatchCount || 0} times
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/40 text-center">
                      <span className="block text-xs text-slate-400 mb-1">First Watched</span>
                      <span className="text-sm font-semibold text-slate-200">
                        {entry.watchStats?.firstWatchedAt
                          ? new Date(entry.watchStats.firstWatchedAt).toLocaleDateString()
                          : 'Not recorded'}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/40 text-center">
                      <span className="block text-xs text-slate-400 mb-1">Last Watched</span>
                      <span className="text-sm font-semibold text-slate-200">
                        {entry.watchStats?.lastWatchedAt
                          ? new Date(entry.watchStats.lastWatchedAt).toLocaleDateString()
                          : 'Not recorded'}
                      </span>
                    </div>
                  </div>

                  {/* Log View / Rewatch Form */}
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <span>🎬</span> Record a Viewing Event (Watch / Rewatch)
                    </h3>

                    {logFeedback && (
                      <p
                        className={`text-xs font-semibold ${
                          logFeedback.startsWith('Failed') ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {logFeedback}
                      </p>
                    )}

                    <form
                      onSubmit={handleLogView}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                    >
                      <div>
                        <label
                          htmlFor="log-watched-date"
                          className="block text-[11px] text-slate-400 mb-1"
                        >
                          Watched Date
                        </label>
                        <input
                          id="log-watched-date"
                          type="date"
                          value={logDate}
                          onChange={(e) => setLogDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="log-session-rating"
                          className="block text-[11px] text-slate-400 mb-1"
                        >
                          Session Rating (optional)
                        </label>
                        <select
                          id="log-session-rating"
                          value={logRating}
                          onChange={(e) => setLogRating(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          {RATING_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="log-session-notes"
                          className="block text-[11px] text-slate-400 mb-1"
                        >
                          Notes (optional)
                        </label>
                        <input
                          id="log-session-notes"
                          type="text"
                          value={logNotes}
                          onChange={(e) => setLogNotes(e.target.value)}
                          placeholder="Cinema, IMAX, with friends..."
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                      </div>

                      <div className="sm:col-span-3 flex justify-end">
                        <button
                          type="submit"
                          disabled={loggingView}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
                        >
                          {loggingView ? 'Logging...' : '+ Log Viewing Event'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Viewing History Timeline */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Viewing History ({entry.viewingEvents?.length || 0})
                    </h3>
                    {entry.viewingEvents && entry.viewingEvents.length > 0 ? (
                      <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/30 overflow-hidden">
                        {entry.viewingEvents.map((evt) => (
                          <div
                            key={evt.id}
                            data-testid="viewing-history-item"
                            className="p-3 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-slate-400 font-mono">
                                {new Date(evt.watchedAt).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                              {evt.notes && (
                                <span className="text-slate-300">&ldquo;{evt.notes}&rdquo;</span>
                              )}
                            </div>
                            {evt.rating && (
                              <span className="font-semibold text-amber-400">
                                ★ {Number(evt.rating).toFixed(1)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic p-3 border border-dashed border-slate-800 rounded-xl text-center">
                        No viewing events recorded yet. Log your first watch above.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Section 3: TV SHOW TRACKING ──────────────────────────────── */}
              {entry.mediaType === 'TV' && (
                <div className="space-y-6">
                  {/* Overall Episode Progress Banner */}
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Series Progress
                        </span>
                        <div className="text-lg font-bold text-white flex items-center gap-2">
                          <span>
                            {entry.watchStats?.episodesWatched || 0} of{' '}
                            {entry.watchStats?.totalEpisodes ?? entry.tvShow?.numberOfEpisodes ?? 0}{' '}
                            Episodes
                          </span>
                          <span className="text-sky-400 text-sm font-semibold">
                            ({entry.watchStats?.completionPercentage || 0}%)
                          </span>
                        </div>
                      </div>

                      {/* Mark All Watched Controls */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={includeSpecials}
                            onChange={(e) => setIncludeSpecials(e.target.checked)}
                            className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-400"
                          />
                          <span>Include Specials (Season 0)</span>
                        </label>

                        <button
                          type="button"
                          onClick={handleMarkAllWatched}
                          disabled={markingAll}
                          className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                        >
                          {markingAll ? 'Updating...' : '✓ Mark All Watched'}
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, entry.watchStats?.completionPercentage || 0)}%`,
                        }}
                      />
                    </div>

                    {tvFeedback && (
                      <p className="text-xs font-semibold text-emerald-400 animate-fadeIn">
                        {tvFeedback}
                      </p>
                    )}
                  </div>

                  {/* Season by Season Breakdown */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Seasons &amp; Episode Progress
                    </h3>

                    {tvDetails?.seasons && tvDetails.seasons.length > 0 ? (
                      <div className="space-y-4">
                        {tvDetails.seasons.map((season) => {
                          const existingSeasonRating = (entry.seasonRatings || []).find(
                            (sr) => sr.seasonId === season.id,
                          );

                          return (
                            <div
                              key={season.id}
                              className="rounded-xl border border-slate-800 bg-slate-950/30 overflow-hidden"
                            >
                              {/* Season Header */}
                              <div className="p-3.5 bg-slate-900/60 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-sm text-slate-100">
                                    {season.seasonNumber === 0
                                      ? 'Specials'
                                      : `Season ${season.seasonNumber}`}
                                  </span>
                                  {season.name &&
                                    season.name !== `Season ${season.seasonNumber}` && (
                                      <span className="text-xs text-slate-400">
                                        &bull; {season.name}
                                      </span>
                                    )}
                                  <span className="text-xs text-slate-500">
                                    ({season.episodes?.length || 0} episodes)
                                  </span>
                                </div>

                                {/* Season Rating Widget */}
                                <div className="flex items-center gap-2">
                                  <label className="text-[11px] text-slate-400">
                                    Season Rating:
                                  </label>
                                  <select
                                    value={
                                      existingSeasonRating
                                        ? Number(existingSeasonRating.rating).toFixed(1)
                                        : ''
                                    }
                                    onChange={(e) => handleSeasonRating(season.id, e.target.value)}
                                    disabled={seasonRatingActionId === season.id}
                                    className="px-2 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
                                  >
                                    <option value="">Unrated</option>
                                    {RATING_OPTIONS.filter((o) => o.value !== '').map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {/* Episode List */}
                              <div className="divide-y divide-slate-800/60">
                                {season.episodes && season.episodes.length > 0 ? (
                                  season.episodes.map((ep) => {
                                    const isWatched = watchedEpisodeIds.has(ep.id);
                                    const isBusy = episodeActionId === ep.id;

                                    return (
                                      <div
                                        key={ep.id}
                                        data-testid={`episode-row-${ep.id}`}
                                        className={`p-3 flex items-center justify-between gap-3 text-xs transition-colors ${
                                          isWatched
                                            ? 'bg-emerald-950/10 hover:bg-emerald-950/20'
                                            : 'hover:bg-slate-900/40'
                                        }`}
                                      >
                                        <div className="flex items-center gap-3 min-w-0">
                                          <span className="font-mono text-slate-500 w-6 shrink-0">
                                            E{ep.episodeNumber}
                                          </span>
                                          <div className="truncate">
                                            <span
                                              className={`font-medium ${
                                                isWatched
                                                  ? 'text-slate-200 line-through text-slate-400'
                                                  : 'text-slate-100'
                                              }`}
                                            >
                                              {ep.name || `Episode ${ep.episodeNumber}`}
                                            </span>
                                            {ep.runtime && (
                                              <span className="text-[11px] text-slate-500 ml-2">
                                                {ep.runtime}m
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Toggle Action */}
                                        <button
                                          type="button"
                                          onClick={() => handleToggleEpisode(ep.id, isWatched)}
                                          disabled={isBusy}
                                          className={`py-1 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                                            isWatched
                                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30'
                                              : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-sky-600 hover:text-white'
                                          }`}
                                        >
                                          {isBusy ? (
                                            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                          ) : isWatched ? (
                                            <>
                                              <span>✓</span> Watched
                                            </>
                                          ) : (
                                            '+ Mark Watched'
                                          )}
                                        </button>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="p-3 text-xs text-slate-500 italic">
                                    No episodes found for this season.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic p-3 border border-dashed border-slate-800 rounded-xl text-center">
                        Episode information is not yet ingested in catalogue.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Section 4: Destructive Action (Remove Entry) ──────────────── */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                {showDeleteConfirm ? (
                  <div className="w-full p-4 rounded-xl border border-rose-900/60 bg-rose-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
                    <div className="text-xs text-rose-300 text-center sm:text-left">
                      <strong>Are you sure?</strong> This will permanently remove this title and all
                      associated watch history, episode progress, and season ratings.
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={deleting}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteEntry}
                        disabled={deleting}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-600/30"
                      >
                        {deleting ? 'Removing...' : 'Confirm Remove'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-xs font-medium text-rose-400 hover:text-rose-300 flex items-center gap-1.5 hover:underline focus:outline-none"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Remove from Library
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
