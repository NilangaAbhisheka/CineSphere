-- ==============================================================================
-- Migration: 20261106232000_catalogue_constraints_alignment
-- Purpose:
--   1. Add nullable UNIQUE constraints on seasons.tmdbId and episodes.tmdbId.
--   2. Drop redundant indexes covered by existing UNIQUE constraints:
--      - movies_tmdbId_idx (covered by movies_tmdbId_key)
--      - tv_shows_tmdbId_idx (covered by tv_shows_tmdbId_key)
--      - persons_tmdbId_idx (covered by persons_tmdbId_key)
-- ==============================================================================

-- ── Drop Redundant Indexes ────────────────────────────────────────────────────
DROP INDEX IF EXISTS "movies_tmdbId_idx";
DROP INDEX IF EXISTS "tv_shows_tmdbId_idx";
DROP INDEX IF EXISTS "persons_tmdbId_idx";

-- ── Unique Constraints for Season and Episode TMDB IDs ────────────────────────
-- In PostgreSQL, UNIQUE constraints allow multiple NULL entries while rejecting
-- duplicate non-NULL values.
CREATE UNIQUE INDEX "seasons_tmdbId_key" ON "seasons"("tmdbId");
CREATE UNIQUE INDEX "episodes_tmdbId_key" ON "episodes"("tmdbId");
