import React from 'react';

export function LoadingSkeletonCard() {
  return (
    <div className="flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40 animate-pulse">
      <div className="aspect-[2/3] w-full bg-slate-800/60" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-slate-800/80 rounded w-3/4" />
        <div className="flex items-center justify-between">
          <div className="h-3 bg-slate-800/60 rounded w-1/4" />
          <div className="h-3 bg-slate-800/60 rounded w-1/4" />
        </div>
        <div className="space-y-1.5 pt-1">
          <div className="h-2.5 bg-slate-800/50 rounded w-full" />
          <div className="h-2.5 bg-slate-800/50 rounded w-5/6" />
        </div>
      </div>
    </div>
  );
}

export function LoadingSkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6"
      data-testid="loading-skeleton-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <LoadingSkeletonCard key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  title = 'No Results Found',
  description = 'Try searching with a different title, year, or filter criteria.',
  onReset,
}: {
  title?: string;
  description?: string;
  onReset?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30"
      data-testid="empty-state"
    >
      <div className="h-14 w-14 rounded-full bg-slate-800/70 flex items-center justify-center text-slate-400 mb-4">
        <svg
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m15.75 15.75-2.489-2.489m0 0a3.375 3.375 0 1 0-4.773-4.773 3.375 3.375 0 0 0 4.774 4.774ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-slate-200 mb-1">{title}</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-6">{description}</p>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  message = 'An unexpected error occurred while communicating with the server.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center p-10 text-center border border-rose-900/40 rounded-2xl bg-rose-950/20"
      data-testid="error-state"
    >
      <div className="h-12 w-12 rounded-full bg-rose-900/40 flex items-center justify-center text-rose-400 mb-3">
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-rose-300 mb-1">Unable to Load Data</h3>
      <p className="text-sm text-rose-200/80 max-w-md mb-5">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
