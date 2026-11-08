import React from 'react';
import { StatsOverviewSummary } from '@cinesphere/shared';

interface StatsSummaryCardsProps {
  summary?: StatsOverviewSummary | null;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}

function StatCard({ label, value, icon, accent }: StatCardProps) {
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

export function StatsSummaryCards({ summary }: StatsSummaryCardsProps) {
  const isAvailable = summary !== undefined && summary !== null;

  const moviesCompletedDisplay = isAvailable ? summary.moviesCompleted : '—';
  const episodesWatchedDisplay = isAvailable ? summary.episodesWatched : '—';
  const tvShowsCompletedDisplay = isAvailable ? summary.tvShowsCompleted : '—';
  const averageRatingDisplay =
    isAvailable && summary.averagePersonalRating !== null
      ? `★ ${summary.averagePersonalRating.toFixed(1)}`
      : '—';
  const movieViewingsDisplay = isAvailable ? summary.movieViewingEvents : '—';

  return (
    <div className="space-y-3">
      {/* 4 Primary Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Movies Completed"
          value={moviesCompletedDisplay}
          icon={<span>🎬</span>}
          accent="text-sky-400"
        />
        <StatCard
          label="Episodes Watched"
          value={episodesWatchedDisplay}
          icon={<span>▶️</span>}
          accent="text-amber-400"
        />
        <StatCard
          label="Shows Completed"
          value={tvShowsCompletedDisplay}
          icon={<span>📺</span>}
          accent="text-violet-400"
        />
        <StatCard
          label="Average Rating"
          value={averageRatingDisplay}
          icon={<span>★</span>}
          accent="text-emerald-400"
        />
      </div>

      {/* Secondary Metrics Bar */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 px-1">
        <span>
          Movie Viewings:{' '}
          <span className="text-slate-300 font-medium tabular-nums">{movieViewingsDisplay}</span>
        </span>
        {!isAvailable && (
          <span className="text-slate-600 italic">(Analytics will connect in Phase 4)</span>
        )}
      </div>
    </div>
  );
}
