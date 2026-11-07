import React from 'react';

/**
 * TMDB Official Attribution & Branding Component
 *
 * Requirements per TMDB Terms of Use:
 * 1. Must use official TMDB logo.
 * 2. Must state: "This product uses the TMDB API but is not endorsed or certified by TMDB"
 */
export function TmdbAttribution({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 p-4 rounded-xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-sm text-center sm:text-left ${className}`}
      data-testid="tmdb-attribution"
    >
      <div className="flex-shrink-0 flex items-center justify-center">
        {/* Official TMDB Primary Logo Mark */}
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="The Movie Database (TMDB)"
          className="inline-block transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
        >
          <svg
            className="h-5 w-auto"
            viewBox="0 0 185 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="tmdb-logo-gradient"
                x1="0"
                y1="0"
                x2="185"
                y2="16"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#90CEA1" />
                <stop offset="0.5" stopColor="#01B4E4" />
                <stop offset="1" stopColor="#0D253F" />
              </linearGradient>
            </defs>
            {/* TMDB Letters */}
            <text
              x="0"
              y="14"
              fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              fontSize="16"
              fontWeight="900"
              letterSpacing="2"
              fill="url(#tmdb-logo-gradient)"
            >
              TMDB
            </text>
          </svg>
        </a>
      </div>

      <div className="text-xs text-slate-400 max-w-md leading-relaxed">
        This product uses the TMDB API but is not endorsed or certified by TMDB
      </div>
    </div>
  );
}
