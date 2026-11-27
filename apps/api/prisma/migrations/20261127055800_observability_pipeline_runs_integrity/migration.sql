-- ==============================================================================
-- Migration: 20261127055800_observability_pipeline_runs_integrity
-- Purpose:
--   1. Non-negative record counter CHECK constraint on pipeline_runs.
--   2. Temporal ordering CHECK constraint (completed_at IS NULL OR >= started_at).
--   3. Lifecycle consistency CHECK constraint (RUNNING <=> completed_at IS NULL).
--   4. Partial index on active RUNNING runs for stale-run reconciliation.
-- ==============================================================================

ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "chk_pipeline_runs_counters_non_negative"
  CHECK (
    "records_read" >= 0 AND
    "records_inserted" >= 0 AND
    "records_updated" >= 0 AND
    "records_skipped" >= 0 AND
    "records_rejected" >= 0
  );

ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "chk_pipeline_runs_completed_after_started"
  CHECK (
    "completed_at" IS NULL OR "completed_at" >= "started_at"
  );

ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "chk_pipeline_runs_lifecycle_consistency"
  CHECK (
    ("status" = 'RUNNING' AND "completed_at" IS NULL) OR
    ("status" <> 'RUNNING' AND "completed_at" IS NOT NULL)
  );

CREATE INDEX "idx_pipeline_runs_active_heartbeat"
  ON "pipeline_runs" ("heartbeat_at", "started_at")
  WHERE "status" = 'RUNNING';
