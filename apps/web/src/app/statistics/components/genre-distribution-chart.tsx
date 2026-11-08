'use client';

import React, { useMemo, useState } from 'react';
import { GenreStatItem } from '@cinesphere/shared';

interface GenreDistributionChartProps {
  genres?: GenreStatItem[] | null;
}

export function GenreDistributionChart({ genres }: GenreDistributionChartProps) {
  const [showAll, setShowAll] = useState(false);

  // Sort descending by completedTitleCount, tie-break alphabetically by name
  const sortedGenres = useMemo(() => {
    if (!genres || genres.length === 0) return [];
    return [...genres].sort((a, b) => {
      if (b.completedTitleCount !== a.completedTitleCount) {
        return b.completedTitleCount - a.completedTitleCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [genres]);

  const displayedGenres = showAll ? sortedGenres : sortedGenres.slice(0, 8);
  const hasMoreThanEight = sortedGenres.length > 8;

  if (!genres || genres.length === 0) {
    return (
      <div
        className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center space-y-2"
        role="region"
        aria-label="Genre Distribution"
      >
        <p className="text-sm font-semibold text-slate-300">Genre Breakdown</p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Statistics aggregation endpoints will be connected in Phase 4. As you complete movies and
          TV shows in your library, your top genres will appear here.
        </p>
        <div className="pt-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            Analytics not yet connected
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4"
      role="region"
      aria-label="Genre Distribution of Completed Titles"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-200">Genre Breakdown</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Distinct completed movie &amp; TV titles associated with each genre. Titles may have
            multiple genres.
          </p>
        </div>
        {hasMoreThanEight && (
          <button
            onClick={() => setShowAll((prev) => !prev)}
            className="text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 rounded px-1.5 py-0.5"
            aria-expanded={showAll}
          >
            {showAll ? 'Show top 8' : `View all (${sortedGenres.length})`}
          </button>
        )}
      </div>

      {/* Visual Horizontal Bars */}
      <div className="space-y-3 pt-1">
        {displayedGenres.map((item) => (
          <div key={item.genreId} className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-slate-300 truncate max-w-[200px] sm:max-w-xs">
                {item.name}
              </span>
              <span className="text-slate-400 tabular-nums">
                {item.completedTitleCount}{' '}
                <span className="text-slate-500">({item.percentage}%)</span>
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${Math.min(Math.max(item.percentage, 0), 100)}%` }}
                role="progressbar"
                aria-valuenow={item.percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.name}: ${item.completedTitleCount} titles (${item.percentage}%)`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Accessible Screen-Reader Data Table */}
      <table className="sr-only">
        <caption>Genre distribution of completed titles</caption>
        <thead>
          <tr>
            <th scope="col">Genre</th>
            <th scope="col">Completed Titles</th>
            <th scope="col">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {sortedGenres.map((item) => (
            <tr key={item.genreId}>
              <td>{item.name}</td>
              <td>{item.completedTitleCount}</td>
              <td>{item.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
