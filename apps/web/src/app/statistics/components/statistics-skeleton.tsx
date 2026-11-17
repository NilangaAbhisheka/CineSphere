import React from 'react';

function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className ?? ''}`} style={style} />;
}

export function StatisticsSkeleton() {
  return (
    <div
      className="space-y-8"
      role="status"
      aria-label="Loading viewing statistics"
      data-testid="statistics-skeleton"
    >
      <span className="sr-only">Loading viewing statistics...</span>

      {/* 4 Summary Cards Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center gap-4"
          >
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </div>
          </div>
        ))}
      </div>

      {/* Genre Breakdown Skeleton */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="space-y-3 pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between items-center">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Viewing Activity Timeline Skeleton */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4">
        <div className="flex justify-between items-center">
          <div className="space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="h-44 w-full flex items-end justify-between gap-2 pt-4 px-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <Skeleton
                className="w-full rounded"
                style={{ height: `${20 + ((i * 17) % 80)}px` }}
              />
              <Skeleton className="h-2.5 w-6" />
            </div>
          ))}
        </div>
      </div>

      {/* Rating Distribution Skeleton */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm space-y-4">
        <div className="flex justify-between items-center">
          <div className="space-y-1">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-60" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="h-36 w-full flex items-end justify-between gap-1 pt-4 px-2">
          {Array.from({ length: 19 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <Skeleton
                className="w-full rounded"
                style={{ height: `${10 + ((i * 23) % 70)}px` }}
              />
              <Skeleton className="h-2 w-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
