'use client';

import React, { useState } from 'react';
import { getPosterPlaceholderUrl, getTmdbImageUrl } from '@/lib/tmdb-image';

export interface UnifiedMediaItem {
  id?: string; // Internal PostgreSQL UUID if in local catalogue
  tmdbId: number;
  title: string;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
  popularity?: number | null;
  mediaType: 'movie' | 'tv';
  genres?: { id: number; name: string }[];
}

export function MediaCard({
  item,
  onAddToLibrary,
}: {
  item: UnifiedMediaItem;
  onAddToLibrary?: (item: UnifiedMediaItem) => void;
}) {
  const [imgError, setImgError] = useState(false);

  const rawPosterUrl = getTmdbImageUrl(item.posterPath, 'w500');
  const posterUrl = !imgError && rawPosterUrl ? rawPosterUrl : getPosterPlaceholderUrl(item.title);

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const rating =
    item.voteAverage !== undefined && item.voteAverage !== null && item.voteAverage > 0
      ? item.voteAverage.toFixed(1)
      : null;

  return (
    <article
      tabIndex={0}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent select-none"
      data-testid="media-card"
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={`Poster for ${item.title}`}
          onError={() => setImgError(true)}
          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />

        {/* Media Type & Catalogue Status Badges */}
        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-10">
          <span
            className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-md shadow-md backdrop-blur-md ${
              item.mediaType === 'movie'
                ? 'bg-sky-500/85 text-white'
                : 'bg-indigo-500/85 text-white'
            }`}
          >
            {item.mediaType === 'movie' ? 'Movie' : 'TV'}
          </span>

          {item.id && (
            <span
              className="px-2 py-0.5 text-[11px] font-semibold rounded-md shadow-md backdrop-blur-md bg-emerald-600/90 text-white flex items-center gap-1"
              title="Already in CineSphere catalogue"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                  clipRule="evenodd"
                />
              </svg>
              In Library
            </span>
          )}
        </div>

        {/* Rating Badge */}
        {rating && (
          <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 text-xs font-bold rounded-md bg-slate-950/85 text-amber-400 border border-amber-500/30 flex items-center gap-1 shadow-md backdrop-blur-md">
            <span>★</span>
            <span>{rating}</span>
          </div>
        )}
      </div>

      {/* Media Details */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2">
        <div>
          <h4
            className="text-sm font-semibold text-slate-100 line-clamp-1 group-hover:text-sky-300 transition-colors"
            title={item.title}
          >
            {item.title}
          </h4>

          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
            {year && <span>{year}</span>}
            {item.genres && item.genres.length > 0 && (
              <>
                <span>&bull;</span>
                <span className="line-clamp-1 text-slate-400">{item.genres[0].name}</span>
              </>
            )}
          </div>
        </div>

        {item.overview && (
          <p className="text-xs text-slate-400/90 line-clamp-2 leading-relaxed">{item.overview}</p>
        )}

        {onAddToLibrary && (
          <div className="pt-2 mt-auto border-t border-slate-800/80">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToLibrary(item);
              }}
              className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 hover:text-sky-300 border border-sky-500/30 flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add to Library
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
