-- ==============================================================================
-- Migration: 20261107154249_phase3_integrity
-- Purpose:
--   1. Declarative media_type XOR CHECK constraint on user_library_entries.
--   2. Rating range and half-step CHECK constraints on DECIMAL(4,2) columns.
--   3. Partial unique indexes on user_library_entries (user_id + movie_id / tv_show_id).
--   4. Row-level locking functions and cross-table integrity triggers.
--
-- CONCURRENCY & ISOLATION LEVEL INVARIANTS:
--   - All protection functions are explicitly declared VOLATILE.
--   - READ COMMITTED is mandatory for transactions modifying these relationships.
--     Under READ COMMITTED, each query in a PL/pgSQL function evaluates with a fresh
--     statement-level snapshot. When a parent UPDATE waits behind a concurrent child
--     insert holding a FOR SHARE lock, once unblocked, the protection trigger's
--     SELECT EXISTS queries run with a fresh snapshot that includes the child row
--     committed by the transaction it waited on.
--   - DO NOT USE REPEATABLE READ or SERIALIZABLE for parent-update operations, as
--     REPEATABLE READ retains the initial transaction snapshot from before the wait,
--     which would cause SELECT EXISTS to return false and bypass protection.
-- ==============================================================================

-- ── 1. Media Type Invariant CHECK ─────────────────────────────────────────────
-- Enforces strictly valid states for movies and TV shows (XOR constraint).
ALTER TABLE "user_library_entries"
  ADD CONSTRAINT "chk_user_library_entries_media_type_xor"
  CHECK (
    ("media_type" = 'MOVIE' AND "movie_id" IS NOT NULL AND "tv_show_id" IS NULL) OR
    ("media_type" = 'TV'    AND "tv_show_id" IS NOT NULL AND "movie_id" IS NULL)
  );

-- ── 2. Rating CHECK Constraints ───────────────────────────────────────────────
-- Rating rule:
--   - NULL allowed where field is optional.
--   - Minimum 1.00, Maximum 10.00.
--   - Half-step increments only: (rating * 2) must be an integer.
--   - DECIMAL(4,2) prevents silent truncation of values like 7.24 or 7.25.

ALTER TABLE "user_library_entries"
  ADD CONSTRAINT "chk_user_library_entries_personal_rating_half_step"
  CHECK (
    "personal_rating" IS NULL OR (
      "personal_rating" >= 1.00 AND
      "personal_rating" <= 10.00 AND
      ("personal_rating" * 2) = ROUND("personal_rating" * 2, 0)
    )
  );

ALTER TABLE "viewing_events"
  ADD CONSTRAINT "chk_viewing_events_rating_half_step"
  CHECK (
    "rating" IS NULL OR (
      "rating" >= 1.00 AND
      "rating" <= 10.00 AND
      ("rating" * 2) = ROUND("rating" * 2, 0)
    )
  );

ALTER TABLE "season_ratings"
  ADD CONSTRAINT "chk_season_ratings_rating_half_step"
  CHECK (
    "rating" >= 1.00 AND
    "rating" <= 10.00 AND
    ("rating" * 2) = ROUND("rating" * 2, 0)
  );

-- ── 3. Partial Unique Indexes ─────────────────────────────────────────────────
-- A user can have at most one library entry per movie and one per TV show.
CREATE UNIQUE INDEX "idx_user_library_entries_user_movie_unique"
  ON "user_library_entries" ("user_id", "movie_id")
  WHERE "movie_id" IS NOT NULL;

CREATE UNIQUE INDEX "idx_user_library_entries_user_tv_show_unique"
  ON "user_library_entries" ("user_id", "tv_show_id")
  WHERE "tv_show_id" IS NOT NULL;

-- ── 4. Cross-Table Lock Helper Functions ───────────────────────────────────────
-- Deterministic row-level lock helpers accepting UUID parameters.

CREATE OR REPLACE FUNCTION lock_user_library_entry_shared(p_entry_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM 1 FROM "user_library_entries" WHERE "id" = p_entry_id FOR SHARE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_season_shared(p_season_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM 1 FROM "seasons" WHERE "id" = p_season_id FOR SHARE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_episode_shared(p_episode_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM 1 FROM "episodes" WHERE "id" = p_episode_id FOR SHARE;
END;
$$ LANGUAGE plpgsql;

-- ── 5. Child Validation Triggers (INSERT / UPDATE) ─────────────────────────────
-- Lock hierarchy for EpisodeProgress: UserLibraryEntry -> Episode -> Season
-- Locks are acquired BEFORE reading ownership fields to prevent stale-read races.

CREATE OR REPLACE FUNCTION trg_validate_episode_progress_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_media_type text;
  v_entry_tv_show_id UUID;
  v_episode_season_id UUID;
  v_season_tv_show_id UUID;
BEGIN
  -- 1. Lock UserLibraryEntry FOR SHARE
  PERFORM lock_user_library_entry_shared(NEW."library_entry_id");

  -- 2. Read ULE fields AFTER acquiring lock
  SELECT "media_type"::text, "tv_show_id"
    INTO v_entry_media_type, v_entry_tv_show_id
    FROM "user_library_entries"
   WHERE "id" = NEW."library_entry_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UserLibraryEntry % does not exist', NEW."library_entry_id"
      USING ERRCODE = '23503';
  END IF;

  IF v_entry_media_type <> 'TV' OR v_entry_tv_show_id IS NULL THEN
    RAISE EXCEPTION 'EpisodeProgress can only be recorded for TV library entries (entry % has media_type %)',
      NEW."library_entry_id", v_entry_media_type
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock Episode FOR SHARE BEFORE reading seasonId (prevents stale-read race)
  PERFORM lock_episode_shared(NEW."episode_id");

  -- 4. Read Episode.seasonId AFTER acquiring lock
  SELECT "seasonId" INTO v_episode_season_id
    FROM "episodes"
   WHERE "id" = NEW."episode_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Episode % does not exist', NEW."episode_id"
      USING ERRCODE = '23503';
  END IF;

  -- 5. Lock Season FOR SHARE BEFORE reading tvShowId
  PERFORM lock_season_shared(v_episode_season_id);

  -- 6. Read Season.tvShowId AFTER acquiring lock
  SELECT "tvShowId" INTO v_season_tv_show_id
    FROM "seasons"
   WHERE "id" = v_episode_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season % for Episode % does not exist', v_episode_season_id, NEW."episode_id"
      USING ERRCODE = '23503';
  END IF;

  -- 7. Cross-table invariant verification
  IF v_season_tv_show_id IS DISTINCT FROM v_entry_tv_show_id THEN
    RAISE EXCEPTION 'Episode % (Season %) belongs to tvShow %, but libraryEntry % tracks tvShow %',
      NEW."episode_id", v_episode_season_id, v_season_tv_show_id, NEW."library_entry_id", v_entry_tv_show_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER "trg_validate_episode_progress"
BEFORE INSERT OR UPDATE ON "episode_progress"
FOR EACH ROW EXECUTE FUNCTION trg_validate_episode_progress_fn();


-- Lock hierarchy for SeasonRating: UserLibraryEntry -> Season
-- Locks are acquired BEFORE reading ownership fields.

CREATE OR REPLACE FUNCTION trg_validate_season_rating_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_media_type text;
  v_entry_tv_show_id UUID;
  v_season_tv_show_id UUID;
BEGIN
  -- 1. Lock UserLibraryEntry FOR SHARE
  PERFORM lock_user_library_entry_shared(NEW."library_entry_id");

  -- 2. Read ULE fields AFTER acquiring lock
  SELECT "media_type"::text, "tv_show_id"
    INTO v_entry_media_type, v_entry_tv_show_id
    FROM "user_library_entries"
   WHERE "id" = NEW."library_entry_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UserLibraryEntry % does not exist', NEW."library_entry_id"
      USING ERRCODE = '23503';
  END IF;

  IF v_entry_media_type <> 'TV' OR v_entry_tv_show_id IS NULL THEN
    RAISE EXCEPTION 'SeasonRating can only be recorded for TV library entries (entry % has media_type %)',
      NEW."library_entry_id", v_entry_media_type
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock Season FOR SHARE BEFORE reading tvShowId
  PERFORM lock_season_shared(NEW."season_id");

  -- 4. Read Season.tvShowId AFTER acquiring lock
  SELECT "tvShowId" INTO v_season_tv_show_id
    FROM "seasons"
   WHERE "id" = NEW."season_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season % does not exist', NEW."season_id"
      USING ERRCODE = '23503';
  END IF;

  -- 5. Cross-table invariant verification
  IF v_season_tv_show_id IS DISTINCT FROM v_entry_tv_show_id THEN
    RAISE EXCEPTION 'Season % belongs to tvShow %, but libraryEntry % tracks tvShow %',
      NEW."season_id", v_season_tv_show_id, NEW."library_entry_id", v_entry_tv_show_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER "trg_validate_season_rating"
BEFORE INSERT OR UPDATE ON "season_ratings"
FOR EACH ROW EXECUTE FUNCTION trg_validate_season_rating_fn();

-- ── 6. Parent-Update Protection Triggers ───────────────────────────────────────
-- Each trigger function is declared VOLATILE. Under READ COMMITTED, its internal
-- SELECT EXISTS queries see newly committed child records when unblocked after
-- waiting for the target row's lock.

CREATE OR REPLACE FUNCTION trg_protect_user_library_tv_show_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD."media_type" = 'TV' AND OLD."tv_show_id" IS DISTINCT FROM NEW."tv_show_id") THEN
    IF EXISTS (SELECT 1 FROM "episode_progress" WHERE "library_entry_id" = OLD."id" LIMIT 1) THEN
      RAISE EXCEPTION 'Cannot modify tv_show_id on UserLibraryEntry % while EpisodeProgress records exist', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM "season_ratings" WHERE "library_entry_id" = OLD."id" LIMIT 1) THEN
      RAISE EXCEPTION 'Cannot modify tv_show_id on UserLibraryEntry % while SeasonRating records exist', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER "trg_protect_user_library_tv_show_update"
BEFORE UPDATE OF "tv_show_id", "media_type" ON "user_library_entries"
FOR EACH ROW EXECUTE FUNCTION trg_protect_user_library_tv_show_update_fn();


CREATE OR REPLACE FUNCTION trg_protect_episode_season_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."seasonId" IS DISTINCT FROM NEW."seasonId" THEN
    IF EXISTS (SELECT 1 FROM "episode_progress" WHERE "episode_id" = OLD."id" LIMIT 1) THEN
      RAISE EXCEPTION 'Cannot reassign seasonId on Episode % while EpisodeProgress records reference it', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER "trg_protect_episode_season_update"
BEFORE UPDATE OF "seasonId" ON "episodes"
FOR EACH ROW EXECUTE FUNCTION trg_protect_episode_season_update_fn();


CREATE OR REPLACE FUNCTION trg_protect_season_tv_show_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."tvShowId" IS DISTINCT FROM NEW."tvShowId" THEN
    IF EXISTS (SELECT 1 FROM "season_ratings" WHERE "season_id" = OLD."id" LIMIT 1) THEN
      RAISE EXCEPTION 'Cannot reassign tvShowId on Season % while SeasonRating records reference it', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM "episode_progress" ep
        JOIN "episodes" e ON e."id" = ep."episode_id"
       WHERE e."seasonId" = OLD."id"
       LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Cannot reassign tvShowId on Season % while EpisodeProgress records reference its episodes', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER "trg_protect_season_tv_show_update"
BEFORE UPDATE OF "tvShowId" ON "seasons"
FOR EACH ROW EXECUTE FUNCTION trg_protect_season_tv_show_update_fn();
