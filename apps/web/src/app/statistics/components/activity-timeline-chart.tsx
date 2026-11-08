import React, { useId } from 'react';
import { ActivityTimelineData } from '@cinesphere/shared';

interface ActivityTimelineChartProps {
  activity?: ActivityTimelineData | null;
}

export function ActivityTimelineChart({ activity }: ActivityTimelineChartProps) {
  const chartId = useId();

  if (!activity || !activity.items || activity.items.length === 0) {
    return (
      <div
        className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center space-y-2"
        role="region"
        aria-label="Viewing Activity Timeline"
      >
        <p className="text-sm font-semibold text-slate-300">Viewing Activity Timeline</p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Monthly viewing trends will populate here once statistics aggregation endpoints are
          connected in Phase 4.
        </p>
        <div className="pt-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            Analytics not yet connected
          </span>
        </div>
      </div>
    );
  }

  const { items } = activity;
  const maxActivity = Math.max(...items.map((i) => i.totalActivity), 5);

  // SVG dimensions
  const svgWidth = 600;
  const svgHeight = 200;
  const paddingBottom = 30;
  const paddingTop = 20;
  const paddingLeft = 35;
  const paddingRight = 15;

  const chartAreaWidth = svgWidth - paddingLeft - paddingRight;
  const chartAreaHeight = svgHeight - paddingTop - paddingBottom;

  const columnWidth = chartAreaWidth / items.length;
  const barWidth = Math.min(Math.max(columnWidth * 0.55, 12), 36);

  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4"
      role="region"
      aria-labelledby={`title-${chartId}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 id={`title-${chartId}`} className="text-base font-semibold text-slate-200">
            Viewing Activity Timeline
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Monthly chronological viewing activity for movies and TV episodes.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-sky-400 inline-block" />
            <span>Movie Viewings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-violet-400 inline-block" />
            <span>Episodes Watched</span>
          </div>
        </div>
      </div>

      {/* SVG Stacked Bar Chart */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[420px]"
          aria-hidden="true"
        >
          {/* Y-Axis Guideline & Top Value */}
          <line
            x1={paddingLeft}
            y1={paddingTop}
            x2={svgWidth - paddingRight}
            y2={paddingTop}
            stroke="#334155"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          <text
            x={paddingLeft - 6}
            y={paddingTop + 4}
            fill="#64748b"
            fontSize="10"
            textAnchor="end"
          >
            {maxActivity}
          </text>

          {/* Baseline */}
          <line
            x1={paddingLeft}
            y1={svgHeight - paddingBottom}
            x2={svgWidth - paddingRight}
            y2={svgHeight - paddingBottom}
            stroke="#475569"
            strokeWidth="1"
          />
          <text
            x={paddingLeft - 6}
            y={svgHeight - paddingBottom + 3}
            fill="#64748b"
            fontSize="10"
            textAnchor="end"
          >
            0
          </text>

          {/* Bars */}
          {items.map((item, index) => {
            const xCenter = paddingLeft + index * columnWidth + columnWidth / 2;
            const x = xCenter - barWidth / 2;

            const movieHeight = (item.movieViewings / maxActivity) * chartAreaHeight;
            const episodeHeight = (item.episodesWatched / maxActivity) * chartAreaHeight;

            const yMovie = svgHeight - paddingBottom - movieHeight;
            const yEpisode = yMovie - episodeHeight;

            // Short month label e.g. "May", "Jun"
            const shortLabel = item.label.split(' ')[0] || item.period;

            return (
              <g key={item.period} className="group">
                {/* Episodes Stacked on top (Violet) */}
                {episodeHeight > 0 && (
                  <rect
                    x={x}
                    y={yEpisode}
                    width={barWidth}
                    height={episodeHeight}
                    fill="#a78bfa"
                    rx={movieHeight === 0 ? 2 : 0}
                  />
                )}

                {/* Movie Viewings at the base (Sky) */}
                {movieHeight > 0 && (
                  <rect
                    x={x}
                    y={yMovie}
                    width={barWidth}
                    height={movieHeight}
                    fill="#38bdf8"
                    rx={episodeHeight === 0 ? 2 : 0}
                  />
                )}

                {/* X-Axis Month Label */}
                <text
                  x={xCenter}
                  y={svgHeight - paddingBottom + 16}
                  fill="#94a3b8"
                  fontSize="11"
                  textAnchor="middle"
                >
                  {shortLabel}
                </text>

                {/* Value on Top of Bar when > 0 */}
                {item.totalActivity > 0 && (
                  <text
                    x={xCenter}
                    y={yEpisode - 4}
                    fill="#cbd5e1"
                    fontSize="9"
                    fontWeight="500"
                    textAnchor="middle"
                  >
                    {item.totalActivity}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Accessible Screen-Reader Data Table */}
      <table className="sr-only">
        <caption>Monthly viewing activity timeline</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Movie Viewings</th>
            <th scope="col">Episodes Watched</th>
            <th scope="col">Total Activity</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.period}>
              <td>{item.label}</td>
              <td>{item.movieViewings}</td>
              <td>{item.episodesWatched}</td>
              <td>{item.totalActivity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
