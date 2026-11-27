-- ============================================================================
-- Stage 5.1 M1-A: Provenance, Embedding Coordination, Job Leases & Media Embeddings
-- ============================================================================

-- 1. Catalogue Provenance Enum & Catalogue Table Extensions
CREATE TYPE "CatalogueProvenance" AS ENUM ('TMDB', 'SYNTHETIC', 'UNKNOWN');

ALTER TABLE "movies"
    ADD COLUMN "provenance" "CatalogueProvenance" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "metadata_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tagline" TEXT,
    ADD COLUMN "status" VARCHAR(50);

ALTER TABLE "tv_shows"
    ADD COLUMN "provenance" "CatalogueProvenance" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "metadata_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tagline" TEXT;

CREATE INDEX "idx_movies_provenance" ON "movies"("provenance");
CREATE INDEX "idx_tv_shows_provenance" ON "tv_shows"("provenance");

-- 2. Embedding Coordination Singleton Table & TD-08 Seed
CREATE TABLE "embedding_coordination" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active_model_name" VARCHAR(100) NOT NULL,
    "active_model_version" VARCHAR(100) NOT NULL,
    "active_dimensions" INTEGER NOT NULL,
    "pending_model_name" VARCHAR(100),
    "pending_model_version" VARCHAR(100),
    "pending_dimensions" INTEGER,
    "cutover_in_progress" BOOLEAN NOT NULL DEFAULT FALSE,
    "cutover_started_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "embedding_coordination_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "embedding_coordination_singleton" CHECK ("id" = 1),
    CONSTRAINT "active_dimensions_positive" CHECK ("active_dimensions" > 0),
    CONSTRAINT "pending_dimensions_positive" CHECK ("pending_dimensions" IS NULL OR "pending_dimensions" > 0)
);

INSERT INTO "embedding_coordination" (
    "id", "active_model_name", "active_model_version", "active_dimensions"
) VALUES (
    1,
    'sentence-transformers/all-mpnet-base-v2',
    '9a3225965996d404b775526de6dbfe85d3368642',
    768
) ON CONFLICT ("id") DO NOTHING;

-- 3. Job Leases Table & Single-Owner Three-Row Seed (V0.7.9)
CREATE TABLE "job_leases" (
    "lease_name" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "owner_job_id" UUID,
    "heartbeat_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("lease_name"),
    CONSTRAINT "job_leases_status_check" CHECK ("status" IN ('AVAILABLE', 'ACQUIRED', 'MAINTENANCE')),
    CONSTRAINT "job_leases_fencing_token_non_negative" CHECK ("fencing_token" >= 0)
);

INSERT INTO "job_leases" (
    "lease_name", "status", "fencing_token", "heartbeat_at", "owner_job_id"
) VALUES
    ('model_cutover', 'AVAILABLE', 0, NULL, NULL),
    ('embedding_generation', 'AVAILABLE', 0, NULL, NULL),
    ('sync_catalogue', 'AVAILABLE', 0, NULL, NULL)
ON CONFLICT ("lease_name") DO NOTHING;

-- 4. Media Embeddings Table (768-dim pgvector, lifecycle & integrity constraints)
CREATE TABLE "media_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "movie_id" UUID,
    "tv_show_id" UUID,
    "embedding" vector(768),
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(100) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "metadata_revision" INTEGER NOT NULL DEFAULT 0,
    "lifecycle_stage" VARCHAR(20) NOT NULL DEFAULT 'STAGED',
    "embedding_stale" BOOLEAN NOT NULL DEFAULT FALSE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "generated_at" TIMESTAMPTZ(6),
    "promoted_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "media_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_embeddings_xor_media" CHECK (
        ("movie_id" IS NOT NULL AND "tv_show_id" IS NULL) OR
        ("movie_id" IS NULL AND "tv_show_id" IS NOT NULL)
    ),
    CONSTRAINT "media_embeddings_lifecycle_check" CHECK (
        "lifecycle_stage" IN ('STAGED', 'ACTIVE', 'HISTORICAL', 'STALE')
    ),
    CONSTRAINT "media_embeddings_status_check" CHECK (
        "status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    ),
    CONSTRAINT "media_embeddings_status_vector_invariant" CHECK (
        ("status" = 'COMPLETED' AND "embedding" IS NOT NULL AND "generated_at" IS NOT NULL) OR
        ("status" IN ('PENDING', 'PROCESSING', 'FAILED') AND "embedding" IS NULL)
    ),
    CONSTRAINT "media_embeddings_dim_invariant" CHECK (
        "dimensions" > 0 AND ("embedding" IS NULL OR vector_dims("embedding") = "dimensions")
    ),
    CONSTRAINT "media_embeddings_unit_norm_invariant" CHECK (
        "embedding" IS NULL OR -("embedding" <#> "embedding") BETWEEN 0.998001 AND 1.002001
    ),
    CONSTRAINT "media_embeddings_movie_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE,
    CONSTRAINT "media_embeddings_tv_fkey" FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE CASCADE
);

-- Active & Staged Uniqueness Indexes
CREATE UNIQUE INDEX "media_embeddings_movie_active_uniq"
    ON "media_embeddings" ("movie_id")
    WHERE "movie_id" IS NOT NULL AND "lifecycle_stage" = 'ACTIVE';

CREATE UNIQUE INDEX "media_embeddings_tv_active_uniq"
    ON "media_embeddings" ("tv_show_id")
    WHERE "tv_show_id" IS NOT NULL AND "lifecycle_stage" = 'ACTIVE';

CREATE UNIQUE INDEX "media_embeddings_movie_staged_uniq"
    ON "media_embeddings" ("movie_id", "model_name", "model_version", "metadata_revision")
    WHERE "movie_id" IS NOT NULL AND "lifecycle_stage" = 'STAGED';

CREATE UNIQUE INDEX "media_embeddings_tv_staged_uniq"
    ON "media_embeddings" ("tv_show_id", "model_name", "model_version", "metadata_revision")
    WHERE "tv_show_id" IS NOT NULL AND "lifecycle_stage" = 'STAGED';

-- Partial HNSW Cosine Index for Active Embeddings
CREATE INDEX "idx_media_embeddings_active_hnsw"
    ON "media_embeddings" USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE "lifecycle_stage" = 'ACTIVE';
