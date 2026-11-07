import React from 'react';
import Link from 'next/link';

export default function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const hostedMode = process.env.NEXT_PUBLIC_HOSTED_MODE === 'true';

  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-slate-100">
      <div className="z-10 max-w-4xl w-full flex flex-col items-center text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-medium rounded-full bg-sky-950/70 border border-sky-800 text-sky-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Phase 2.5: Catalogue &amp; Discover Live
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-200 to-indigo-300">
          CineSphere
        </h1>

        <p className="max-w-2xl text-lg text-slate-400">
          Personal movie and television tracking, hybrid content-based recommendation engine, and
          interactive 2D Movie Universe powered by semantic embeddings.
        </p>

        {/* Call to Action */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Link
            href="/library"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm transition-all shadow-lg shadow-sky-600/25 hover:shadow-sky-500/35 hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            Open My Library
          </Link>
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            Explore Discover
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full pt-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              Next.js Frontend
            </h3>
            <p className="text-xs text-slate-400">
              App Router, Tailwind CSS, TypeScript strict mode, responsive discovery experience with
              TMDB search and local catalogue filtering.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              NestJS Backend
            </h3>
            <p className="text-xs text-slate-400">
              Modular REST API configured at <code className="text-sky-300">{apiUrl}</code> with DTO
              validation, TMDB proxy caching, and Swagger docs.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              PostgreSQL + pgvector
            </h3>
            <p className="text-xs text-slate-400">
              Prisma ORM with isolated raw SQL vector repository for high-dimensional cosine
              similarity and rich media metadata storage.
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-500 pt-6">
          Operating Mode:{' '}
          <span className="font-mono text-slate-300">
            {hostedMode ? 'Hosted Portfolio' : 'Local Full Mode'}
          </span>{' '}
          &bull; Monorepo: <span className="font-mono text-slate-300">Turborepo + pnpm</span>
        </div>
      </div>
    </main>
  );
}
