-- ==============================================================================
-- Migration: 20261106000000_catalogue_foundation
-- Phase: 2A — Catalogue Database Foundation
-- Purpose: Create catalogue tables for Movie, TvShow, Season, Episode,
--          Genre, Keyword, Person, and PersonCredit.
--
-- NOTES:
--   - pgvector extension was enabled in migration 20261105000000_init_pgvector.
--     This migration does not touch it.
--   - Genre and Keyword records are shared between Movie and TvShow via
--     Prisma-generated implicit join tables (_MovieToGenre, _TvShowToGenre,
--     _MovieToKeyword, _TvShowToKeyword).
--   - PersonCredit enforces exactly-one-of movieId/tvShowId via CHECK constraint.
--     Prisma cannot express this natively; it is preserved here and documented
--     in schema.prisma comments.
--   - Duplicate person-to-movie and person-to-TV-show associations are prevented
--     by partial unique indexes (NULL-safe).
-- ==============================================================================

-- ── Genres ────────────────────────────────────────────────────────────────────

CREATE TABLE "genres" (
    "tmdbId" INTEGER NOT NULL,
    "name"   VARCHAR(100) NOT NULL,
    CONSTRAINT "genres_pkey" PRIMARY KEY ("tmdbId")
);

-- ── Keywords ──────────────────────────────────────────────────────────────────

CREATE TABLE "keywords" (
    "tmdbId" INTEGER NOT NULL,
    "name"   VARCHAR(255) NOT NULL,
    CONSTRAINT "keywords_pkey" PRIMARY KEY ("tmdbId")
);

-- ── Movies ────────────────────────────────────────────────────────────────────

CREATE TABLE "movies" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tmdbId"           INTEGER      NOT NULL,
    "title"            VARCHAR(500) NOT NULL,
    "originalTitle"    VARCHAR(500),
    "overview"         TEXT,
    "releaseDate"      DATE,
    "runtime"          INTEGER,
    "originalLanguage" VARCHAR(10),
    "popularity"       DOUBLE PRECISION,
    "voteAverage"      DOUBLE PRECISION,
    "voteCount"        INTEGER,
    "posterPath"       VARCHAR(255),
    "backdropPath"     VARCHAR(255),
    "adult"            BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt"         TIMESTAMPTZ(6),
    CONSTRAINT "movies_pkey"   PRIMARY KEY ("id"),
    CONSTRAINT "movies_tmdbId_key" UNIQUE ("tmdbId")
);

CREATE INDEX "movies_tmdbId_idx"    ON "movies" ("tmdbId");
CREATE INDEX "movies_popularity_idx" ON "movies" ("popularity");

-- ── TV Shows ──────────────────────────────────────────────────────────────────

CREATE TABLE "tv_shows" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tmdbId"           INTEGER      NOT NULL,
    "name"             VARCHAR(500) NOT NULL,
    "originalName"     VARCHAR(500),
    "overview"         TEXT,
    "firstAirDate"     DATE,
    "lastAirDate"      DATE,
    "originalLanguage" VARCHAR(10),
    "popularity"       DOUBLE PRECISION,
    "voteAverage"      DOUBLE PRECISION,
    "voteCount"        INTEGER,
    "posterPath"       VARCHAR(255),
    "backdropPath"     VARCHAR(255),
    "status"           VARCHAR(50),
    "numberOfSeasons"  INTEGER,
    "numberOfEpisodes" INTEGER,
    "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt"         TIMESTAMPTZ(6),
    CONSTRAINT "tv_shows_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "tv_shows_tmdbId_key" UNIQUE ("tmdbId")
);

CREATE INDEX "tv_shows_tmdbId_idx"    ON "tv_shows" ("tmdbId");
CREATE INDEX "tv_shows_popularity_idx" ON "tv_shows" ("popularity");

-- ── Seasons ───────────────────────────────────────────────────────────────────

CREATE TABLE "seasons" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tmdbId"       INTEGER,
    "seasonNumber" INTEGER      NOT NULL,
    "name"         VARCHAR(255),
    "overview"     TEXT,
    "posterPath"   VARCHAR(255),
    "airDate"      DATE,
    "tvShowId"     UUID         NOT NULL,
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id"),
    -- Season number must be unique within a TV show (supports season 0 / specials)
    CONSTRAINT "seasons_tvShowId_seasonNumber_key" UNIQUE ("tvShowId", "seasonNumber"),
    CONSTRAINT "seasons_tvShowId_fkey" FOREIGN KEY ("tvShowId")
        REFERENCES "tv_shows" ("id") ON DELETE CASCADE
);

CREATE INDEX "seasons_tvShowId_idx" ON "seasons" ("tvShowId");

-- ── Episodes ──────────────────────────────────────────────────────────────────

CREATE TABLE "episodes" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tmdbId"        INTEGER,
    "episodeNumber" INTEGER      NOT NULL,
    "name"          VARCHAR(255),
    "overview"      TEXT,
    "airDate"       DATE,
    "runtime"       INTEGER,
    "seasonId"      UUID         NOT NULL,
    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id"),
    -- Episode number must be unique within a season
    CONSTRAINT "episodes_seasonId_episodeNumber_key" UNIQUE ("seasonId", "episodeNumber"),
    CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId")
        REFERENCES "seasons" ("id") ON DELETE CASCADE
);

CREATE INDEX "episodes_seasonId_idx" ON "episodes" ("seasonId");

-- ── Persons ───────────────────────────────────────────────────────────────────

CREATE TABLE "persons" (
    "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tmdbId"    INTEGER      NOT NULL,
    "name"      VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "persons_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "persons_tmdbId_key" UNIQUE ("tmdbId")
);

CREATE INDEX "persons_tmdbId_idx" ON "persons" ("tmdbId");

-- ── PersonCredits ─────────────────────────────────────────────────────────────
--
-- Exactly one of movie_id or tv_show_id must be non-null per row.
-- This is enforced by the CHECK constraint below.
-- Prisma models this as optional foreign keys; the constraint lives here only.
--
-- Duplicate person-to-movie and person-to-TV-show associations are prevented
-- by partial unique indexes (standard SQL UNIQUE cannot exclude NULLs from the
-- constraint on the other column).

CREATE TABLE "person_credits" (
    "id"       UUID NOT NULL DEFAULT gen_random_uuid(),
    "personId" UUID NOT NULL,
    "movieId"  UUID,
    "tvShowId" UUID,
    CONSTRAINT "person_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "person_credits_exactly_one_media"
        CHECK (
            ("movieId" IS NOT NULL AND "tvShowId" IS NULL) OR
            ("movieId" IS NULL AND "tvShowId" IS NOT NULL)
        ),
    CONSTRAINT "person_credits_personId_fkey" FOREIGN KEY ("personId")
        REFERENCES "persons" ("id") ON DELETE CASCADE,
    CONSTRAINT "person_credits_movieId_fkey" FOREIGN KEY ("movieId")
        REFERENCES "movies" ("id") ON DELETE CASCADE,
    CONSTRAINT "person_credits_tvShowId_fkey" FOREIGN KEY ("tvShowId")
        REFERENCES "tv_shows" ("id") ON DELETE CASCADE
);

-- Index for "all credits belonging to a person"
CREATE INDEX "person_credits_personId_idx" ON "person_credits" ("personId");

-- Partial unique indexes to prevent duplicate person-movie and person-tvshow credits
CREATE UNIQUE INDEX "person_credits_person_movie_uniq"
    ON "person_credits" ("personId", "movieId")
    WHERE "movieId" IS NOT NULL;

CREATE UNIQUE INDEX "person_credits_person_tvshow_uniq"
    ON "person_credits" ("personId", "tvShowId")
    WHERE "tvShowId" IS NOT NULL;

-- ── Implicit M2M Join Tables (Prisma-managed) ─────────────────────────────────
--
-- Prisma generates these table names for implicit many-to-many relations.
-- Convention: alphabetical order of the two model names.
--   Genre   < Movie    → _GenreToMovie
--   Genre   < TvShow   → _GenreToTvShow
--   Keyword < Movie    → _KeywordToMovie
--   Keyword < TvShow   → _KeywordToTvShow

-- Genre <-> Movie
CREATE TABLE "_GenreToMovie" (
    "A" INTEGER NOT NULL,
    "B" UUID    NOT NULL,
    CONSTRAINT "_GenreToMovie_AB_pkey" PRIMARY KEY ("A", "B"),
    CONSTRAINT "_GenreToMovie_A_fkey" FOREIGN KEY ("A")
        REFERENCES "genres" ("tmdbId") ON DELETE CASCADE,
    CONSTRAINT "_GenreToMovie_B_fkey" FOREIGN KEY ("B")
        REFERENCES "movies" ("id") ON DELETE CASCADE
);
CREATE INDEX "_GenreToMovie_B_index" ON "_GenreToMovie" ("B");

-- Genre <-> TvShow
CREATE TABLE "_GenreToTvShow" (
    "A" INTEGER NOT NULL,
    "B" UUID    NOT NULL,
    CONSTRAINT "_GenreToTvShow_AB_pkey" PRIMARY KEY ("A", "B"),
    CONSTRAINT "_GenreToTvShow_A_fkey" FOREIGN KEY ("A")
        REFERENCES "genres" ("tmdbId") ON DELETE CASCADE,
    CONSTRAINT "_GenreToTvShow_B_fkey" FOREIGN KEY ("B")
        REFERENCES "tv_shows" ("id") ON DELETE CASCADE
);
CREATE INDEX "_GenreToTvShow_B_index" ON "_GenreToTvShow" ("B");

-- Keyword <-> Movie
CREATE TABLE "_KeywordToMovie" (
    "A" INTEGER NOT NULL,
    "B" UUID    NOT NULL,
    CONSTRAINT "_KeywordToMovie_AB_pkey" PRIMARY KEY ("A", "B"),
    CONSTRAINT "_KeywordToMovie_A_fkey" FOREIGN KEY ("A")
        REFERENCES "keywords" ("tmdbId") ON DELETE CASCADE,
    CONSTRAINT "_KeywordToMovie_B_fkey" FOREIGN KEY ("B")
        REFERENCES "movies" ("id") ON DELETE CASCADE
);
CREATE INDEX "_KeywordToMovie_B_index" ON "_KeywordToMovie" ("B");

-- Keyword <-> TvShow
CREATE TABLE "_KeywordToTvShow" (
    "A" INTEGER NOT NULL,
    "B" UUID    NOT NULL,
    CONSTRAINT "_KeywordToTvShow_AB_pkey" PRIMARY KEY ("A", "B"),
    CONSTRAINT "_KeywordToTvShow_A_fkey" FOREIGN KEY ("A")
        REFERENCES "keywords" ("tmdbId") ON DELETE CASCADE,
    CONSTRAINT "_KeywordToTvShow_B_fkey" FOREIGN KEY ("B")
        REFERENCES "tv_shows" ("id") ON DELETE CASCADE
);
CREATE INDEX "_KeywordToTvShow_B_index" ON "_KeywordToTvShow" ("B");
