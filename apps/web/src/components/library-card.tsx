'use client';

import React, { useState } from 'react';
import { LibraryEntryListItem, LibraryStatus } from '@cinesphere/shared';
import { getPosterPlaceholderUrl, getTmdbImageUrl } from '@/lib/tmdb-image';

const STATUS_CONFIG: Record<
  LibraryStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  PLAN_TO_WATCH: {
    label: 'Plan to Watch',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-400',
  },
  WATCHING: {
    label: 'Watching',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dotClass: 'bg-sky-400',
  },
  COMPLETED: {
    label: 'Completed',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
  DROPPED: {
    label: 'Dropped',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dotClass: 'bg-rose-400',
  },
};

interface LibraryCardProps {
  entry: LibraryEntryListItem;
  onManage: (entry: LibraryEntryListItem) => void;
}

export function LibraryCard({ entry, onManage }: LibraryCardProps) {
  const [imgError, setImgError] = useState(false);

  const title =
    entry.mediaType === 'MOVIE'
      ? entry.movie?.title || 'Untitled Movie'
      : entry.tvShow?.name || 'Untitled TV Show';

  const posterPath =
    entry.mediaType === 'MOVIE' ? entry.movie?.posterPath : entry.tvShow?.posterPath;

  const releaseDate =
    entry.mediaType === 'MOVIE' ? entry.movie?.releaseDate : entry.tvShow?.firstAirDate;

  const year = releaseDate ? releaseDate.slice(0, 4) : null;

  const rawPosterUrl = getTmdbImageUrl(posterPath, 'w500');
  const posterUrl = !imgError && rawPosterUrl ? rawPosterUrl : getPosterPlaceholderUrl(title);

  const statusConfig = STATUS_CONFIG[entry.status] || STATUS_CONFIG.PLAN_TO_WATCH;

  // TV Progress metrics
  const totalEpisodes = entry.watchStats?.totalEpisodes ?? entry.tvShow?.numberOfEpisodes ?? 0;
  const episodesWatched = entry.watchStats?.episodesWatched ?? 0;
  const completionPercentage =
    totalEpisodes > 0
      ? Math.round((episodesWatched / totalEpisodes) * 100)
      : (entry.watchStats?.completionPercentage ?? 0);

  return (
    <article
      tabIndex={0}
      onClick={() => onManage(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onManage(entry);
        }
      }}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400 select-none"
      data-testid="library-card"
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={`Poster for ${title}`}
          onError={() => setImgError(true)}
          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />

        {/* Media Type & Status Badges */}
        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-10">
          <span
            className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-md shadow-md backdrop-blur-md ${
              entry.mediaType === 'MOVIE'
                ? 'bg-sky-500/85 text-white'
                : 'bg-indigo-500/85 text-white'
            }`}
          >
            {entry.mediaType === 'MOVIE' ? 'Movie' : 'TV'}
          </span>

          <span
            className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border shadow-md backdrop-blur-md flex items-center gap-1.5 ${statusConfig.badgeClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
            {statusConfig.label}
          </span>
        </div>

        {/* Personal Rating Badge */}
        {entry.personalRating !== null && entry.personalRating !== undefined && (
          <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 text-xs font-bold rounded-md bg-slate-950/90 text-amber-400 border border-amber-500/40 flex items-center gap-1 shadow-md backdrop-blur-md">
            <span>★</span>
            <span>{Number(entry.personalRating).toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Media Details */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-3">
        <div>
          <h4
            className="text-sm font-semibold text-slate-100 line-clamp-1 group-hover:text-sky-300 transition-colors"
            title={title}
          >
            {title}
          </h4>

          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
            {year && <span>{year}</span>}
            {entry.notes && (
              <>
                <span>&bull;</span>
                <span className="line-clamp-1 italic text-slate-400/90">
                  &ldquo;{entry.notes}&rdquo;
                </span>
              </>
            )}
          </div>
        </div>

        {/* Tracking info */}
        <div className="pt-2 border-t border-slate-800/80 text-xs">
          {entry.mediaType === 'MOVIE' ? (
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1">
                <svg
                  className="w-3.5 h-3.5 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                {entry.watchStats?.totalWatchCount > 0
                  ? `Watched ${entry.watchStats.totalWatchCount}x`
                  : 'Not watched yet'}
              </span>
              {entry.watchStats?.lastWatchedAt && (
                <span className="text-[11px] text-slate-400">
                  {new Date(entry.watchStats.lastWatchedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {episodesWatched} of {totalEpisodes} eps
                </span>
                <span className="font-semibold text-slate-300">{completionPercentage}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, completionPercentage)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Manage Action */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onManage(entry);
          }}
          className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <svg
            className="w-3.5 h-3.5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Manage Tracking
        </button>
      </div>
    </article>
  );
}
