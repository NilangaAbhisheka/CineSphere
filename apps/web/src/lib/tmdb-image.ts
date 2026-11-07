/**
 * TMDB Image Configuration & Utilities
 *
 * TMDB images are served from image.tmdb.org with configurable size prefixes.
 * This centralized utility provides predictable image URLs and clean fallback
 * placeholders for missing poster/backdrop artwork.
 */

export type TmdbPosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original';
export type TmdbBackdropSize = 'w300' | 'w780' | 'w1280' | 'original';

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

/**
 * Returns a complete URL for a TMDB image path, or null if the path is missing.
 */
export function getTmdbImageUrl(
  path: string | null | undefined,
  size: TmdbPosterSize | TmdbBackdropSize = 'w500',
): string | null {
  if (!path || typeof path !== 'string' || path.trim() === '') {
    return null;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE_URL}/${size}${cleanPath}`;
}

/**
 * Returns an inline SVG data URI representing a placeholder poster artwork
 * when a title has no poster image on TMDB.
 */
export function getPosterPlaceholderUrl(title: string = 'No Image Available'): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 40);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750" fill="none">
    <rect width="500" height="750" fill="#0f172a"/>
    <rect x="20" y="20" width="460" height="710" rx="12" stroke="#334155" stroke-width="2" stroke-dasharray="6 6"/>
    <g transform="translate(190, 280)">
      <rect x="0" y="0" width="120" height="90" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
      <path d="M20 30 L40 10 L60 30 L80 10 L100 30" stroke="#0284c7" stroke-width="3" stroke-linecap="round"/>
      <circle cx="60" cy="55" r="16" fill="#38bdf8"/>
    </g>
    <text x="250" y="420" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#94a3b8" text-anchor="middle">
      ${safeTitle}
    </text>
    <text x="250" y="450" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">
      No Poster Available
    </text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Returns an inline SVG data URI representing a placeholder backdrop artwork
 * when a title has no backdrop image on TMDB.
 */
export function getBackdropPlaceholderUrl(title: string = 'No Backdrop Available'): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 40);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" fill="none">
    <rect width="1280" height="720" fill="#0b1120"/>
    <rect x="20" y="20" width="1240" height="680" rx="16" stroke="#1e293b" stroke-width="2"/>
    <text x="640" y="360" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="600" fill="#475569" text-anchor="middle">
      ${safeTitle}
    </text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
