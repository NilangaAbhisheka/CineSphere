import React, { useId } from 'react';
import { RatingStatsData } from '@cinesphere/shared';

interface RatingDistributionChartProps {
  ratings?: RatingStatsData | null;
  averagePersonalRating?: number | null;
}

export function RatingDistributionChart({
  ratings,
  averagePersonalRating,
}: RatingDistributionChartProps) {
  const chartId = useId();

  if (!ratings || !ratings.buckets || ratings.buckets.length === 0) {
    return (
      <div
        className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center space-y-2"
        role="region"
        aria-label="Rating Distribution"
      >
        <p className="text-sm font-semibold text-slate-300">Rating Distribution</p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Personal ratings breakdown across the 1.0–10.0 scale will populate here once statistics
          aggregation endpoints are connected in Phase 4.
        </p>
        <div className="pt-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            Analytics not yet connected
          </span>
        </div>
      </div>
    );
  }

  const { buckets, unratedLibraryEntries, totalRated } = ratings;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  // SVG dimensions
  const svgWidth = 600;
  const svgHeight = 180;
  const paddingBottom = 30;
  const paddingTop = 20;
  const paddingLeft = 30;
  const paddingRight = 20;

  const chartAreaWidth = svgWidth - paddingLeft - paddingRight;
  const chartAreaHeight = svgHeight - paddingTop - paddingBottom;

  const bucketCount = buckets.length; // 19 buckets
  const columnWidth = chartAreaWidth / bucketCount;
  const barWidth = Math.max(columnWidth * 0.72, 8);

  // Calculate average rating marker x-position along the 1.0 - 10.0 span
  const avgMarkerX =
    averagePersonalRating !== null && averagePersonalRating !== undefined
      ? paddingLeft +
        ((averagePersonalRating - 1.0) / (10.0 - 1.0)) * (chartAreaWidth - columnWidth) +
        columnWidth / 2
      : null;

  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4"
      role="region"
      aria-labelledby={`title-${chartId}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 id={`title-${chartId}`} className="text-base font-semibold text-slate-200">
            Personal Rating Distribution
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Frequency of ratings assigned to library entries (1.0 to 10.0 in 0.5 increments).
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>
            Total Rated: <strong className="text-slate-200">{totalRated}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            Unrated Entries: <strong className="text-slate-200">{unratedLibraryEntries}</strong>
          </span>
        </div>
      </div>

      {/* 19-Bucket Histogram SVG */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[500px]"
          aria-hidden="true"
        >
          {/* Baseline */}
          <line
            x1={paddingLeft}
            y1={svgHeight - paddingBottom}
            x2={svgWidth - paddingRight}
            y2={svgHeight - paddingBottom}
            stroke="#475569"
            strokeWidth="1"
          />

          {/* Histogram Bars */}
          {buckets.map((bucket, index) => {
            const xCenter = paddingLeft + index * columnWidth + columnWidth / 2;
            const x = xCenter - barWidth / 2;

            const barHeight = (bucket.count / maxCount) * chartAreaHeight;
            const y = svgHeight - paddingBottom - barHeight;

            // Display label on every integer rating (1, 2, 3...) to keep ticks readable
            const isInteger = Number.isInteger(bucket.rating);

            return (
              <g key={bucket.rating} className="group">
                {/* Bar */}
                {barHeight > 0 && (
                  <rect x={x} y={y} width={barWidth} height={barHeight} fill="#f59e0b" rx={2} />
                )}

                {/* Count above bar if count > 0 */}
                {bucket.count > 0 && (
                  <text
                    x={xCenter}
                    y={y - 3}
                    fill="#fde68a"
                    fontSize="9"
                    fontWeight="500"
                    textAnchor="middle"
                  >
                    {bucket.count}
                  </text>
                )}

                {/* X-Axis Rating Label */}
                <text
                  x={xCenter}
                  y={svgHeight - paddingBottom + 16}
                  fill={isInteger ? '#cbd5e1' : '#64748b'}
                  fontSize={isInteger ? '10' : '8'}
                  fontWeight={isInteger ? '600' : '400'}
                  textAnchor="middle"
                >
                  {isInteger ? bucket.rating.toFixed(0) : ''}
                </text>
              </g>
            );
          })}

          {/* Average Personal Rating Guideline */}
          {avgMarkerX !== null && (
            <g>
              <line
                x1={avgMarkerX}
                y1={paddingTop - 6}
                x2={avgMarkerX}
                y2={svgHeight - paddingBottom}
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <text
                x={avgMarkerX}
                y={paddingTop - 8}
                fill="#38bdf8"
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
              >
                Avg {averagePersonalRating?.toFixed(1)}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Accessible Screen-Reader Data Table */}
      <table className="sr-only">
        <caption>Personal rating distribution across 19 half-step buckets</caption>
        <thead>
          <tr>
            <th scope="col">Rating</th>
            <th scope="col">Library Entries Count</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.rating}>
              <td>{b.rating.toFixed(1)}</td>
              <td>{b.count}</td>
            </tr>
          ))}
          <tr>
            <td>Unrated</td>
            <td>{unratedLibraryEntries}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
