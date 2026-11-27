-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "PipelineTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM', 'CLI');

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pipeline_name" VARCHAR(80) NOT NULL,
    "trigger_type" "PipelineTriggerType" NOT NULL,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_inserted" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "records_rejected" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(80),
    "error_summary" TEXT,
    "metadata" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pipeline_runs_name_started" ON "pipeline_runs"("pipeline_name", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_pipeline_runs_status_started" ON "pipeline_runs"("status", "started_at" DESC);
