// ==============================================================================
// CineSphere — Import/Export Shared Types
// Phase 4.4: Data Import
// ==============================================================================

// ── JSON Import Format ────────────────────────────────────────────────────────

/**
 * Top-level JSON import document. Version field enables future migration.
 */
export interface ImportDocument {
  /** Schema version — currently "1.0" */
  version: '1.0';
  exportedAt?: string;
  entries: ImportEntry[];
}

/**
 * A single library entry in the JSON import format.
 */
export interface ImportEntry {
  /** TMDB numeric ID — used to resolve/ingest the catalogue item */
  tmdbId: number;
  /** MOVIE or TV */
  mediaType: 'MOVIE' | 'TV';
  status: 'PLAN_TO_WATCH' | 'WATCHING' | 'COMPLETED' | 'DROPPED';
  personalRating?: number | null;
  notes?: string | null;
  createdAt?: string | null;

  /** Movie-only: individual viewing occurrences */
  viewingEvents?: ImportViewingEvent[];

  /** TV-only: watched episode TMDB IDs */
  episodeProgress?: ImportEpisodeProgress[];

  /** TV-only: season ratings keyed by TMDB season ID */
  seasonRatings?: ImportSeasonRating[];
}

export interface ImportViewingEvent {
  watchedAt?: string | null;
  rating?: number | null;
  notes?: string | null;
}

export interface ImportEpisodeProgress {
  /** TMDB episode ID */
  episodeTmdbId: number;
  watchedAt?: string | null;
}

export interface ImportSeasonRating {
  /** TMDB season ID */
  seasonTmdbId: number;
  rating: number;
}

// ── CSV Import Format ─────────────────────────────────────────────────────────

/**
 * CSV represents one library entry per row (flat format).
 * Nested records (viewing events, episode progress, season ratings) are
 * NOT supported by CSV. Use JSON for full-fidelity imports.
 */
export interface CsvImportRow {
  tmdb_id: string;
  media_type: string;
  status: string;
  personal_rating?: string;
  notes?: string;
  created_at?: string;
}

// ── Import API Contracts ──────────────────────────────────────────────────────

export interface ImportValidationError {
  /** Entry index (0-based for JSON) or CSV row number (1-based, excluding header) */
  index: number;
  field?: string;
  message: string;
}

export interface ImportResult {
  /** Total entries found in the file */
  total: number;
  /** Entries successfully imported */
  imported: number;
  /** Entries that already existed (skipped) */
  skipped: number;
  /** Validation errors (non-empty only when format = "dry_run" or failure) */
  errors: ImportValidationError[];
  /** Human-readable summary */
  summary: string;
}

export interface ImportResponse extends ImportResult {
  success: boolean;
}
