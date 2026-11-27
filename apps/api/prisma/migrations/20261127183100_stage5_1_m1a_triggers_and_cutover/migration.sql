-- ============================================================================
-- Stage 5.1 M1-A: Coordination Triggers, Metadata Revision Triggers & Cutover SQL
-- ============================================================================

-- 0. Universal Statement-Level Coordination Trigger Function (Fail-Closed L2)
CREATE OR REPLACE FUNCTION trg_fn_acquire_coordination_share_lock()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM 1 FROM "embedding_coordination" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Protected write blocked.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_movie_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "movies"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_tv_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "tv_shows"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- 1. Scalar Metadata Revision Triggers (Canonical Fields + Provenance)
CREATE OR REPLACE FUNCTION trg_fn_bump_movie_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."title" IS DISTINCT FROM NEW."title" OR
       OLD."originalTitle" IS DISTINCT FROM NEW."originalTitle" OR
       OLD."overview" IS DISTINCT FROM NEW."overview" OR
       OLD."releaseDate" IS DISTINCT FROM NEW."releaseDate" OR
       OLD."runtime" IS DISTINCT FROM NEW."runtime" OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD."tagline" IS DISTINCT FROM NEW."tagline" OR
       OLD."status" IS DISTINCT FROM NEW."status" OR
       OLD."provenance" IS DISTINCT FROM NEW."provenance" THEN
        NEW."metadata_revision" := OLD."metadata_revision" + 1;
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_movie_scalar_revision
BEFORE UPDATE ON "movies"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_scalar_metadata_revision();

CREATE OR REPLACE FUNCTION trg_fn_bump_tv_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."name" IS DISTINCT FROM NEW."name" OR
       OLD."originalName" IS DISTINCT FROM NEW."originalName" OR
       OLD."overview" IS DISTINCT FROM NEW."overview" OR
       OLD."firstAirDate" IS DISTINCT FROM NEW."firstAirDate" OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD."tagline" IS DISTINCT FROM NEW."tagline" OR
       OLD."status" IS DISTINCT FROM NEW."status" OR
       OLD."numberOfSeasons" IS DISTINCT FROM NEW."numberOfSeasons" OR
       OLD."numberOfEpisodes" IS DISTINCT FROM NEW."numberOfEpisodes" OR
       OLD."provenance" IS DISTINCT FROM NEW."provenance" THEN
        NEW."metadata_revision" := OLD."metadata_revision" + 1;
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_tv_scalar_revision
BEFORE UPDATE ON "tv_shows"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_scalar_metadata_revision();

-- 1b. Mark Existing Embeddings Stale When Parent Metadata Revision Increments (L3 -> L4)
CREATE OR REPLACE FUNCTION trg_fn_mark_media_embeddings_stale()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'movies' THEN
        UPDATE "media_embeddings"
        SET "embedding_stale" = TRUE, "updated_at" = clock_timestamp()
        WHERE "movie_id" = NEW."id"
          AND "lifecycle_stage" IN ('ACTIVE', 'STAGED')
          AND "embedding_stale" = FALSE;
    ELSIF TG_TABLE_NAME = 'tv_shows' THEN
        UPDATE "media_embeddings"
        SET "embedding_stale" = TRUE, "updated_at" = clock_timestamp()
        WHERE "tv_show_id" = NEW."id"
          AND "lifecycle_stage" IN ('ACTIVE', 'STAGED')
          AND "embedding_stale" = FALSE;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_movie_mark_embeddings_stale
AFTER UPDATE ON "movies"
FOR EACH ROW
WHEN (OLD."metadata_revision" IS DISTINCT FROM NEW."metadata_revision")
EXECUTE FUNCTION trg_fn_mark_media_embeddings_stale();

CREATE TRIGGER trg_tv_mark_embeddings_stale
AFTER UPDATE ON "tv_shows"
FOR EACH ROW
WHEN (OLD."metadata_revision" IS DISTINCT FROM NEW."metadata_revision")
EXECUTE FUNCTION trg_fn_mark_media_embeddings_stale();

-- 2. Junction & Credit Triggers (Movie Parents)
CREATE OR REPLACE FUNCTION trg_fn_bump_movie_metadata_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_old_id UUID := NULL;
    v_new_id UUID := NULL;
BEGIN
    PERFORM 1 FROM "embedding_coordination" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Junction write blocked.';
    END IF;

    IF TG_TABLE_NAME IN ('_GenreToMovie', '_KeywordToMovie') THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."B"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."B"; END IF;
    ELSIF TG_TABLE_NAME = 'person_credits' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."movieId"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."movieId"; END IF;
    END IF;

    IF v_old_id IS NOT NULL AND v_new_id IS NOT NULL AND v_old_id = v_new_id THEN
        UPDATE "movies" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
        WHERE "id" = v_new_id;
    ELSE
        IF v_old_id IS NOT NULL THEN
            UPDATE "movies" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = v_old_id;
        END IF;
        IF v_new_id IS NOT NULL THEN
            UPDATE "movies" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = v_new_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_genre_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_person_credits_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_movie_genre_revision
AFTER INSERT OR UPDATE OR DELETE ON "_GenreToMovie"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

CREATE TRIGGER trg_movie_keyword_revision
AFTER INSERT OR UPDATE OR DELETE ON "_KeywordToMovie"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

CREATE TRIGGER trg_person_credits_movie_revision
AFTER INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

-- 3. Junction & Credit Triggers (TV Parents)
CREATE OR REPLACE FUNCTION trg_fn_bump_tv_metadata_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_old_id UUID := NULL;
    v_new_id UUID := NULL;
BEGIN
    PERFORM 1 FROM "embedding_coordination" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Junction write blocked.';
    END IF;

    IF TG_TABLE_NAME IN ('_GenreToTvShow', '_KeywordToTvShow') THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."B"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."B"; END IF;
    ELSIF TG_TABLE_NAME = 'person_credits' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."tvShowId"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."tvShowId"; END IF;
    END IF;

    IF v_old_id IS NOT NULL AND v_new_id IS NOT NULL AND v_old_id = v_new_id THEN
        UPDATE "tv_shows" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
        WHERE "id" = v_new_id;
    ELSE
        IF v_old_id IS NOT NULL THEN
            UPDATE "tv_shows" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = v_old_id;
        END IF;
        IF v_new_id IS NOT NULL THEN
            UPDATE "tv_shows" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = v_new_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_genre_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_tv_genre_revision
AFTER INSERT OR UPDATE OR DELETE ON "_GenreToTvShow"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

CREATE TRIGGER trg_tv_keyword_revision
AFTER INSERT OR UPDATE OR DELETE ON "_KeywordToTvShow"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

CREATE TRIGGER trg_person_credits_tv_revision
AFTER INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

-- 4. Multi-Parent Deterministic Trigger for Person Name Updates
CREATE TRIGGER trg_persons_acquire_coord_lock
BEFORE UPDATE OF "name" ON "persons"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE OR REPLACE FUNCTION trg_fn_bump_person_media_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_movie_ids UUID[];
    v_tv_ids    UUID[];
BEGIN
    IF OLD."name" IS DISTINCT FROM NEW."name" THEN
        PERFORM 1 FROM "embedding_coordination" WHERE "id" = 1 FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Person write blocked.';
        END IF;

        SELECT ARRAY(
            SELECT DISTINCT "movieId"
            FROM "person_credits"
            WHERE "personId" = NEW."id" AND "movieId" IS NOT NULL
            ORDER BY "movieId" ASC
        ) INTO v_movie_ids;

        SELECT ARRAY(
            SELECT DISTINCT "tvShowId"
            FROM "person_credits"
            WHERE "personId" = NEW."id" AND "tvShowId" IS NOT NULL
            ORDER BY "tvShowId" ASC
        ) INTO v_tv_ids;

        IF array_length(v_movie_ids, 1) > 0 THEN
            PERFORM "id" FROM "movies" WHERE "id" = ANY(v_movie_ids) ORDER BY "id" ASC FOR NO KEY UPDATE;
            UPDATE "movies" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = ANY(v_movie_ids);
        END IF;

        IF array_length(v_tv_ids, 1) > 0 THEN
            PERFORM "id" FROM "tv_shows" WHERE "id" = ANY(v_tv_ids) ORDER BY "id" ASC FOR NO KEY UPDATE;
            UPDATE "tv_shows" SET "metadata_revision" = "metadata_revision" + 1, "updatedAt" = clock_timestamp()
            WHERE "id" = ANY(v_tv_ids);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_person_name_revision
AFTER UPDATE OF "name" ON "persons"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_person_media_revision();

-- 5. Model Cutover SQL Function (V0.7.8 17-Point Contract + V0.7.9 Option A Eligibility)
CREATE OR REPLACE FUNCTION execute_model_cutover(
    p_owner_job_id UUID,
    p_fencing_token BIGINT
) RETURNS JSONB AS $$
DECLARE
    v_token               BIGINT;
    v_pending_name        VARCHAR(100);
    v_pending_ver         VARCHAR(100);
    v_pending_dims        INTEGER;
    v_total_elig          INTEGER;
    v_cand_cnt            INTEGER;
    v_promoted_cnt        INTEGER;
    v_active_cnt          INTEGER;
    v_dup_cnt             INTEGER;
    v_invalid_cnt         INTEGER;
    v_stale_cnt           INTEGER;
    v_orphan_cnt          INTEGER;
    v_coord_rows          INTEGER := 0;
    v_coord_name_rb       TEXT;
    v_coord_ver_rb        TEXT;
    v_coord_dims_rb       INTEGER;
    v_coord_pname_rb      TEXT;
    v_coord_pver_rb       TEXT;
    v_coord_pdims_rb      INTEGER;
    v_coord_inprogress_rb BOOLEAN;
BEGIN
    -- Level 1: Lock-Acquisition Lease Fencing Verification (Option A)
    SELECT "fencing_token" INTO v_token
    FROM "job_leases"
    WHERE "lease_name" = 'model_cutover'
      AND "owner_job_id" = p_owner_job_id
      AND "fencing_token" = p_fencing_token
      AND "status" = 'ACQUIRED'
      AND "expires_at" >= clock_timestamp()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LEASE_NOT_HELD: Worker does not hold valid model_cutover lease (Job: %, Token: %)',
            p_owner_job_id, p_fencing_token;
    END IF;

    -- Level 2: Singleton Coordination Lock & Pending Model Verification
    PERFORM 1 FROM "embedding_coordination" WHERE "id" = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_ROW_MISSING: Singleton row id=1 missing from embedding_coordination.';
    END IF;

    SELECT "pending_model_name", "pending_model_version", "pending_dimensions"
    INTO v_pending_name, v_pending_ver, v_pending_dims
    FROM "embedding_coordination" WHERE "id" = 1;

    IF v_pending_name IS NULL THEN RAISE EXCEPTION 'NO_PENDING_MODEL'; END IF;
    IF v_pending_dims <= 0 OR v_pending_ver IS NULL THEN RAISE EXCEPTION 'MODEL_CONFIGURATION_MISMATCH'; END IF;

    -- Pre-Inspection: Vector Integrity (Finiteness, Dimensions, Unit Norm, XOR)
    SELECT count(*) INTO v_invalid_cnt
    FROM "media_embeddings" me
    WHERE me."model_name" = v_pending_name AND me."model_version" = v_pending_ver
      AND me."lifecycle_stage" = 'STAGED' AND me."status" = 'COMPLETED'
      AND (
          me."dimensions" != v_pending_dims OR
          me."embedding" IS NULL OR
          vector_dims(me."embedding"::vector) != v_pending_dims OR
          -(me."embedding"::vector <#> me."embedding"::vector) NOT BETWEEN 0.998001 AND 1.002001 OR
          ((me."movie_id" IS NOT NULL)::int + (me."tv_show_id" IS NOT NULL)::int) != 1
      );

    IF v_invalid_cnt > 0 THEN
        RAISE EXCEPTION 'INVALID_CANDIDATE_VECTORS: % completed staged embeddings have corrupted dimensions, non-unit norms, or XOR violations.', v_invalid_cnt;
    END IF;

    -- Pre-Inspection: Stale Candidates & NULL-Safe Parent Matching
    SELECT count(*) INTO v_stale_cnt
    FROM "media_embeddings" me
    LEFT JOIN "movies" m ON m."id" = me."movie_id"
    LEFT JOIN "tv_shows" t ON t."id" = me."tv_show_id"
    WHERE me."model_name" = v_pending_name AND me."model_version" = v_pending_ver
      AND me."lifecycle_stage" = 'STAGED' AND me."status" = 'COMPLETED'
      AND (
          me."embedding_stale" = TRUE OR
          (me."movie_id" IS NOT NULL AND m."id" IS NULL) OR
          (me."tv_show_id" IS NOT NULL AND t."id" IS NULL) OR
          me."metadata_revision" IS DISTINCT FROM COALESCE(m."metadata_revision", t."metadata_revision")
      );

    IF v_stale_cnt > 0 THEN
        RAISE EXCEPTION 'STALE_METADATA_DETECTED: % completed staged embeddings are stale or reference non-existent parents.', v_stale_cnt;
    END IF;

    -- Eligible Media Count (Option A Provenance + Title/Name AND Overview)
    SELECT
        (SELECT count(*) FROM "movies"
         WHERE "provenance" = 'TMDB'
           AND "title" IS NOT NULL AND trim("title") != ''
           AND "overview" IS NOT NULL AND trim("overview") != '') +
        (SELECT count(*) FROM "tv_shows"
         WHERE "provenance" = 'TMDB'
           AND "name" IS NOT NULL AND trim("name") != ''
           AND "overview" IS NOT NULL AND trim("overview") != '')
    INTO v_total_elig;

    -- Constrained Temporary Candidate Table with Composite Uniqueness
    CREATE TEMPORARY TABLE _cutover_candidates (
        embedding_id UUID PRIMARY KEY,
        media_type   VARCHAR(10) NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
        media_id     UUID NOT NULL,
        CONSTRAINT unique_candidate_per_media UNIQUE (media_type, media_id)
    ) ON COMMIT DROP;

    WITH ranked_movies AS (
        SELECT me."id" AS embedding_id, 'MOVIE'::varchar(10) AS media_type, me."movie_id" AS media_id,
               ROW_NUMBER() OVER (PARTITION BY me."movie_id" ORDER BY me."metadata_revision" DESC, me."generated_at" DESC, me."id" ASC) AS rn
        FROM "media_embeddings" me
        JOIN "movies" m ON m."id" = me."movie_id"
        WHERE m."provenance" = 'TMDB'
          AND m."title" IS NOT NULL AND trim(m."title") != ''
          AND m."overview" IS NOT NULL AND trim(m."overview") != ''
          AND me."model_name" = v_pending_name AND me."model_version" = v_pending_ver
          AND me."dimensions" = v_pending_dims AND vector_dims(me."embedding"::vector) = v_pending_dims
          AND -(me."embedding"::vector <#> me."embedding"::vector) BETWEEN 0.998001 AND 1.002001
          AND me."lifecycle_stage" = 'STAGED' AND me."status" = 'COMPLETED' AND me."embedding_stale" = FALSE
          AND me."metadata_revision" IS NOT DISTINCT FROM m."metadata_revision"
    ),
    ranked_tv AS (
        SELECT me."id" AS embedding_id, 'TV'::varchar(10) AS media_type, me."tv_show_id" AS media_id,
               ROW_NUMBER() OVER (PARTITION BY me."tv_show_id" ORDER BY me."metadata_revision" DESC, me."generated_at" DESC, me."id" ASC) AS rn
        FROM "media_embeddings" me
        JOIN "tv_shows" t ON t."id" = me."tv_show_id"
        WHERE t."provenance" = 'TMDB'
          AND t."name" IS NOT NULL AND trim(t."name") != ''
          AND t."overview" IS NOT NULL AND trim(t."overview") != ''
          AND me."model_name" = v_pending_name AND me."model_version" = v_pending_ver
          AND me."dimensions" = v_pending_dims AND vector_dims(me."embedding"::vector) = v_pending_dims
          AND -(me."embedding"::vector <#> me."embedding"::vector) BETWEEN 0.998001 AND 1.002001
          AND me."lifecycle_stage" = 'STAGED' AND me."status" = 'COMPLETED' AND me."embedding_stale" = FALSE
          AND me."metadata_revision" IS NOT DISTINCT FROM t."metadata_revision"
    )
    INSERT INTO _cutover_candidates (embedding_id, media_type, media_id)
    SELECT embedding_id, media_type, media_id FROM ranked_movies WHERE rn = 1
    UNION ALL
    SELECT embedding_id, media_type, media_id FROM ranked_tv WHERE rn = 1;

    SELECT count(*) INTO v_cand_cnt FROM _cutover_candidates;

    IF v_cand_cnt != v_total_elig THEN
        RAISE EXCEPTION 'INSUFFICIENT_COVERAGE: Candidate count (%) does not equal eligible titles (%).', v_cand_cnt, v_total_elig;
    END IF;

    -- Level 4 Mutations: Archive Existing Active & Promote Validated Candidates
    UPDATE "media_embeddings"
    SET "lifecycle_stage" = 'HISTORICAL', "archived_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    WHERE "lifecycle_stage" = 'ACTIVE';

    UPDATE "media_embeddings" me
    SET "lifecycle_stage" = 'ACTIVE',
        "embedding_stale" = FALSE,
        "promoted_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    FROM _cutover_candidates cc
    WHERE me."id" = cc."embedding_id";
    GET DIAGNOSTICS v_promoted_cnt = ROW_COUNT;

    -- 10 Post-Promotion Assertions
    IF v_promoted_cnt != v_cand_cnt THEN
        RAISE EXCEPTION 'PROMOTION_COUNT_MISMATCH: Promoted % rows, expected %.', v_promoted_cnt, v_cand_cnt;
    END IF;

    SELECT count(*) INTO v_active_cnt FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE';
    IF v_active_cnt != v_total_elig THEN
        RAISE EXCEPTION 'ACTIVE_COUNT_MISMATCH: Active count % does not equal eligible %.', v_active_cnt, v_total_elig;
    END IF;

    SELECT count(*) INTO v_dup_cnt
    FROM (
        SELECT 'MOVIE' AS media_type, "movie_id" AS media_id FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE' AND "movie_id" IS NOT NULL GROUP BY "movie_id" HAVING count(*) > 1
        UNION ALL
        SELECT 'TV' AS media_type, "tv_show_id" AS media_id FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE' AND "tv_show_id" IS NOT NULL GROUP BY "tv_show_id" HAVING count(*) > 1
    ) dups;
    IF v_dup_cnt > 0 THEN RAISE EXCEPTION 'DUPLICATE_ACTIVE_EMBEDDINGS: % duplicate active rows.', v_dup_cnt; END IF;

    IF EXISTS (SELECT 1 FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE' AND "model_name" != v_pending_name) THEN
        RAISE EXCEPTION 'ACTIVE_MODEL_NAME_MISMATCH: Active embeddings exist with model_name != %.', v_pending_name;
    END IF;

    IF EXISTS (SELECT 1 FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE' AND "model_version" != v_pending_ver) THEN
        RAISE EXCEPTION 'ACTIVE_MODEL_VERSION_MISMATCH: Active embeddings exist with model_version != %.', v_pending_ver;
    END IF;

    IF EXISTS (SELECT 1 FROM "media_embeddings" WHERE "lifecycle_stage" = 'ACTIVE' AND ("dimensions" != v_pending_dims OR vector_dims("embedding"::vector) != v_pending_dims)) THEN
        RAISE EXCEPTION 'ACTIVE_DIMENSION_MISMATCH: Active embeddings have invalid dimensions.';
    END IF;

    SELECT count(*) INTO v_orphan_cnt
    FROM "media_embeddings" me
    LEFT JOIN "movies" m ON m."id" = me."movie_id"
    LEFT JOIN "tv_shows" t ON t."id" = me."tv_show_id"
    WHERE me."lifecycle_stage" = 'ACTIVE'
      AND ((me."movie_id" IS NOT NULL AND m."id" IS NULL) OR (me."tv_show_id" IS NOT NULL AND t."id" IS NULL));
    IF v_orphan_cnt > 0 THEN RAISE EXCEPTION 'ORPHAN_ACTIVE_EMBEDDINGS: % active embeddings have no parent.', v_orphan_cnt; END IF;

    UPDATE "embedding_coordination"
    SET "active_model_name" = v_pending_name,
        "active_model_version" = v_pending_ver,
        "active_dimensions" = v_pending_dims,
        "pending_model_name" = NULL,
        "pending_model_version" = NULL,
        "pending_dimensions" = NULL,
        "cutover_in_progress" = FALSE,
        "updated_at" = clock_timestamp()
    WHERE "id" = 1;

    GET DIAGNOSTICS v_coord_rows = ROW_COUNT;
    IF v_coord_rows != 1 THEN
        RAISE EXCEPTION 'COORDINATION_UPDATE_FAILED: Expected 1 affected coordination row, got %.', v_coord_rows;
    END IF;

    SELECT "active_model_name", "active_model_version", "active_dimensions",
           "pending_model_name", "pending_model_version", "pending_dimensions",
           "cutover_in_progress"
    INTO v_coord_name_rb, v_coord_ver_rb, v_coord_dims_rb,
         v_coord_pname_rb, v_coord_pver_rb, v_coord_pdims_rb,
         v_coord_inprogress_rb
    FROM "embedding_coordination" WHERE "id" = 1;

    IF v_coord_name_rb IS DISTINCT FROM v_pending_name OR
       v_coord_ver_rb IS DISTINCT FROM v_pending_ver OR
       v_coord_dims_rb IS DISTINCT FROM v_pending_dims THEN
        RAISE EXCEPTION 'COORDINATION_ACTIVE_STATE_INVALID: Persisted active coordination state does not match expected targets.';
    END IF;

    IF v_coord_pname_rb IS NOT NULL OR
       v_coord_pver_rb IS NOT NULL OR
       v_coord_pdims_rb IS NOT NULL OR
       v_coord_inprogress_rb != FALSE THEN
        RAISE EXCEPTION 'COORDINATION_PENDING_STATE_INVALID: Persisted pending coordination state not cleared or cutover_in_progress is not false.';
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'model_name', v_pending_name,
        'model_version', v_pending_ver,
        'promoted_count', v_promoted_cnt,
        'active_count', v_active_cnt
    );
END;
$$ LANGUAGE plpgsql VOLATILE;
