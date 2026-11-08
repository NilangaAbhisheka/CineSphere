import React from 'react';
import { StatisticsPageData } from '@cinesphere/shared';
import { StatsSummaryCards } from './stats-summary-cards';
import { GenreDistributionChart } from './genre-distribution-chart';
import { ActivityTimelineChart } from './activity-timeline-chart';
import { RatingDistributionChart } from './rating-distribution-chart';

interface StatisticsViewProps {
  data?: StatisticsPageData | null;
}

export function StatisticsView({ data }: StatisticsViewProps) {
  const isAvailable = data !== undefined && data !== null;

  return (
    <div className="space-y-8">
      {/* Foundation State Notice (when analytics are not yet connected) */}
      {!isAvailable && (
        <div className="rounded-xl border border-sky-900/60 bg-sky-950/30 p-4 sm:p-5 flex items-start gap-3.5">
          <div className="text-xl text-sky-400 select-none">ℹ️</div>
          <div className="text-xs sm:text-sm text-slate-300 space-y-1">
            <p className="font-semibold text-sky-300">Statistics Foundation (Phase 3.7)</p>
            <p className="text-slate-400 leading-relaxed">
              Statistics aggregation endpoints will be connected in Phase 4. As you track movies,
              log viewing events, and check off TV episodes in your Library, your personal analytics
              will appear here automatically.
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <section aria-label="Viewing Summary">
        <StatsSummaryCards summary={data?.summary} />
      </section>

      {/* Genre Distribution */}
      <section aria-label="Genre Breakdown">
        <GenreDistributionChart genres={data?.genres} />
      </section>

      {/* Viewing Activity Timeline */}
      <section aria-label="Activity Timeline">
        <ActivityTimelineChart activity={data?.activity} />
      </section>

      {/* Rating Distribution */}
      <section aria-label="Rating Breakdown">
        <RatingDistributionChart
          ratings={data?.ratings}
          averagePersonalRating={data?.summary?.averagePersonalRating}
        />
      </section>
    </div>
  );
}
