'use client';

import React, { useEffect, useState } from 'react';
import { LibraryEntryResponse, LibraryMediaType, LibraryStatus } from '@cinesphere/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getPosterPlaceholderUrl, getTmdbImageUrl } from '@/lib/tmdb-image';
import { UnifiedMediaItem } from '@/components/media-card';

const RATING_OPTIONS: { label: string; value: string }[] = [
  { label: 'No rating yet', value: '' },
  ...Array.from({ length: 19 }, (_, i) => {
    const val = (1.0 + i * 0.5).toFixed(1);
    return { label: `★ ${val} / 10`, value: val };
  }),
];

interface AddLibraryModalProps {
  item: UnifiedMediaItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (entry: LibraryEntryResponse) => void;
}

export function AddLibraryModal({ item, isOpen, onClose, onSuccess }: AddLibraryModalProps) {
  const [status, setStatus] = useState<LibraryStatus>('PLAN_TO_WATCH');
  const [rating, setRating] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Reset form when item changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('PLAN_TO_WATCH');
      setRating('');
      setNotes('');
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, item]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !item) return null;

  const posterUrl = item.posterPath
    ? getTmdbImageUrl(item.posterPath, 'w300') || getPosterPlaceholderUrl(item.title)
    : getPosterPlaceholderUrl(item.title);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || loading) return;

    setLoading(true);
    setError(null);

    const mediaType: LibraryMediaType = item.mediaType === 'movie' ? 'MOVIE' : 'TV';
    const personalRating = rating ? parseFloat(rating) : undefined;

    try {
      const entry = await apiClient.createLibraryEntry({
        mediaType,
        tmdbId: item.tmdbId,
        mediaId: item.id,
        status,
        personalRating: personalRating ?? null,
        notes: notes.trim() || null,
      });

      setSuccessMessage(`Added "${item.title}" to your library!`);
      if (onSuccess) {
        onSuccess(entry);
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setError('This title is already in your library.');
        } else {
          setError(err.message || 'Failed to add title to library.');
        }
      } else {
        const errorObj = err as Error;
        setError(errorObj.message || 'An unexpected error occurred.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-modal-title"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl}
              alt={item.title}
              className="w-12 h-18 object-cover rounded-md border border-slate-700 bg-slate-950 shrink-0"
            />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${
                    item.mediaType === 'movie'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {item.mediaType === 'movie' ? 'Movie' : 'TV'}
                </span>
                {item.releaseDate && (
                  <span className="text-xs text-slate-400 font-mono">
                    {item.releaseDate.slice(0, 4)}
                  </span>
                )}
              </div>
              <h3 id="add-modal-title" className="text-base font-semibold text-slate-100 line-clamp-1 mt-0.5">
                {item.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-sm rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 text-sm rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Initial Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Tracking Status
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Plan to Watch', value: 'PLAN_TO_WATCH' as LibraryStatus },
                { label: 'Watching', value: 'WATCHING' as LibraryStatus },
                { label: 'Completed', value: 'COMPLETED' as LibraryStatus },
                { label: 'Dropped', value: 'DROPPED' as LibraryStatus },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  disabled={loading}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all border text-center ${
                    status === opt.value
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500 shadow-sm shadow-sky-500/20'
                      : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Personal Rating */}
          <div>
            <label htmlFor="library-rating-select" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Personal Rating <span className="text-slate-500 font-normal lowercase">(optional)</span>
            </label>
            <select
              id="library-rating-select"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {RATING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Optional Notes */}
          <div>
            <label htmlFor="library-notes-input" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Personal Notes <span className="text-slate-500 font-normal lowercase">(optional)</span>
            </label>
            <textarea
              id="library-notes-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
              placeholder="Your personal review, tags, or tracking notes..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || Boolean(successMessage)}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-md shadow-sky-600/30 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Adding to Library...
                </>
              ) : (
                'Add to Library'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
