import React from 'react';

export default function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const hostedMode = process.env.NEXT_PUBLIC_HOSTED_MODE === 'true';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-slate-100">
      <div className="z-10 max-w-4xl w-full flex flex-col items-center text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-medium rounded-full bg-sky-950/70 border border-sky-800 text-sky-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Phase 1: Foundation Baseline Established
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-200 to-indigo-300">
          CineSphere
        </h1>

        <p className="max-w-2xl text-lg text-slate-400">
          Personal movie and television tracking, hybrid content-based recommendation engine, and
          interactive 2D Movie Universe powered by semantic embeddings.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full pt-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              Next.js Frontend
            </h3>
            <p className="text-xs text-slate-400">
              App Router, Tailwind CSS, TypeScript strict mode, PixiJS WebGL canvas layout ready.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              NestJS Backend
            </h3>
            <p className="text-xs text-slate-400">
              Modular REST API configured at <code className="text-sky-300">{apiUrl}</code> with DTO
              validation and Swagger docs.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm text-left">
            <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-2">
              PostgreSQL + pgvector
            </h3>
            <p className="text-xs text-slate-400">
              Prisma ORM with isolated raw SQL vector repository for high-dimensional cosine
              similarity.
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
