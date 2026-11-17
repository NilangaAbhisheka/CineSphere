'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatisticsPageData } from '@cinesphere/shared';
import { apiClient } from '@/lib/api-client';
import { ErrorState } from '@/components/states';
import { StatisticsView } from './components/statistics-view';
import { StatisticsSkeleton } from './components/statistics-skeleton';

export default function StatisticsPage() {
  const [data, setData] = useState<StatisticsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStats = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const [summary, genres, activity, ratings] = await Promise.all([
        apiClient.getStatsOverview(controller.signal),
        apiClient.getStatsGenres(controller.signal),
        apiClient.getStatsActivity(undefined, controller.signal),
        apiClient.getStatsRatings(controller.signal),
      ]);

      setData({
        summary,
        genres,
        activity,
        ratings,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errorObj = err as Error;
      setError(errorObj.message || 'Failed to load viewing statistics.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchStats]);

  return (
    <main className="min-h-[calc(100vh-4rem)] p-6 md:p-8 text-slate-100 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-200 to-indigo-300">
          Statistics
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Personal viewing analytics and tracking intelligence.
        </p>
      </div>

      {/* Content: Loading Skeleton -> Error State -> Live StatisticsView */}
      {loading ? (
        <StatisticsSkeleton />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            void fetchStats();
          }}
        />
      ) : (
        <StatisticsView data={data} />
      )}
    </main>
  );
}
