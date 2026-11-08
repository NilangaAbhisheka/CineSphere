import React from 'react';
import { StatisticsView } from './components/statistics-view';

export default function StatisticsPage() {
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

      {/* Main View (Stage 3.7: Renders authentic foundation state; Phase 4 will supply live data) */}
      <StatisticsView data={null} />
    </main>
  );
}
