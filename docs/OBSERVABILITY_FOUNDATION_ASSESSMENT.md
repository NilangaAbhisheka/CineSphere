# CineSphere — Observability Foundation: Consolidated Assessment & Option C Decision

**Status:** Accepted (Option C) — Pre-Stage 5.1 Foundation (`OBS-1`–`OBS-4`) Implemented  
**Date:** 2026-11-27  
**Note on Provenance:** _The original feasibility assessment ("CineSphere — Observability Foundation: Feasibility Assessment & Implementation Proposal") was delivered in conversation prior to implementation and was not committed as a standalone repository file. This document is a consolidated record based strictly on the accepted Option C decisions and verified repository state._

---

## 1. Motivation & Objective

CineSphere is a personal, local-first movie and TV tracking, discovery, and recommendation platform built on Next.js, NestJS, PostgreSQL 16 (`pgvector`), Prisma, and an offline Python ML package. Extending CineSphere with lightweight **Data Engineering Observability** provides:

- Durable pipeline execution history (`pipeline_runs`)
- Foundations for data-quality auditing (`data_quality_results` in later stages)
- Catalogue freshness, completeness, and database storage monitoring (`database_metric_snapshots` proposed)
- Future read-only Power BI reporting across five operational dashboards (Pipeline Operations, Data Quality & Reliability, Ingestion & Catalogue Health, Database & Storage Performance, Data Lineage & Transformation Impact)

This capability is **operational analytics** and remains strictly separate from CineSphere's personal viewing statistics (`StatsModule`, `DashboardModule`).

---

## 2. Feasibility Findings & Architectural Constraints

1. **Zero New Infrastructure Required:** PostgreSQL 16, Prisma, NestJS, and Power BI Desktop (Import mode) are sufficient. Kafka, Airflow, Spark, Redis, Celery, Kubernetes, and separate data warehouses are explicitly excluded.
2. **Existing Reusable Foundations:**
   - `TmdbHttpClient` already enforces `>=100ms` pacing and `429 Retry-After` handling.
   - `CatalogueRepository` already records `syncedAt` on `movies` and `tv_shows`.
   - `ImportService` already returns structured counts (`total`, `imported`, `skipped`, `errors`).
   - Phase 2/3 database constraints and triggers already enforce structural integrity on catalogue and personal library tables.
3. **Interactive Single-Title Ingestion Excluded:** `POST /api/catalogue/ingest/movie/:tmdbId` and `tv/:tmdbId` are interactive UI cache-fill calls and are intentionally **not** logged as `pipeline_runs` to avoid write amplification.
4. **Supabase Free Compatibility:** Keeping operational telemetry at run/check-aggregate granularity (KB-scale) and isolating future reporting views in a non-`public` `reporting` schema preserves compatibility with Supabase Free's 500 MB storage cap and PostgREST exposure defaults.

---

## 3. Accepted Roadmap — Option C

The project owner selected **Option C (Minimal Foundation Now, Expand Alongside Stage 5.1+)**:

| Milestone                           | Scope                                                                                                                                                                                                                                         | Status                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Pre-Stage 5.1 (`OBS-1`–`OBS-4`)** | `pipeline_runs` table & integrity constraints, `ObservabilityModule` / `PipelineTrackingService`, `clock_timestamp()` single-clock mutations, stale-run reconciliation, `ImportService` (`importJson`/`importCsv`) instrumentation, docs sync | **Implemented**           |
| **Stage 5.1**                       | Production embedding infrastructure (`all-mpnet-base-v2`, 768d) integrated with `pipeline_runs` (`ml_embedding_generation`)                                                                                                                   | **Planned (Not Started)** |
| **Stage 5.2**                       | Daily TMDB new-release discovery & `CatalogueSyncService` (TD-07 Option D) integrated with `pipeline_runs`                                                                                                                                    | **Deferred to Stage 5.2** |
| **Stages 5.3–5.4**                  | Similarity precomputation tracking & domain-calibrated Data Quality checks (`data_quality_results`)                                                                                                                                           | **Planned**               |
| **Post-Stage 5.4**                  | Read-only `reporting` schema views (`vw_*`), `cinesphere_bi_ro` role, and incremental Power BI Desktop dashboards (Import mode: Dashboards 1–3 first; Dashboards 4–5 + `database_metric_snapshots` + static lineage in subsequent increments) | **Planned**               |

---

## 4. Privacy & Reliability Boundaries

- **Zero PII in Telemetry:** `pipeline_runs` never stores `userId`, private filenames, personal ratings, notes, watch history, imported payloads, private library TMDB IDs, credentials, or raw SQL. Metadata uses a strict key/value allowlist (`<= 8,192` bytes) and error summaries use authored safe messages (`<= 1,000` chars).
- **Best-Effort Non-Blocking Telemetry:** Failures in `startRun`, `heartbeat`, `completeRun`, or `failRun` are logged safely and never break or alter user-facing import results or mask original exceptions.
- **Single-Clock Consistency:** All lifecycle timestamps (`started_at`, `heartbeat_at`, `completed_at`, `updated_at`) are assigned by PostgreSQL `clock_timestamp()`.
- **Long-Running Import Safety:** `ImportService` uses a 60-second throttled heartbeat during sequential TMDB resolution so large imports are not falsely expired by the 15-minute `reconcileStaleRuns` threshold.

---

## 5. Option C Acceptance & Implementation Addendum (2026-11-27)

- **Accepted Scope:** `OBS-1` (Prisma `PipelineRun` + `20261127055711_observability_pipeline_runs` + `20261127055800_observability_pipeline_runs_integrity`), `OBS-2` (`ObservabilityModule`, `PipelineTrackingService`, `HeartbeatThrottler`), `OBS-3` (`ImportService.importJson()` and `ImportService.importCsv()` instrumentation), and `OBS-4` (full verification + documentation synchronization + proposed V0.7.9 Stage 5.1 compatibility amendment).
- **Explicitly Deferred:** `reporting` SQL views, `cinesphere_bi_ro` role provisioning, `data_quality_results`, `database_metric_snapshots`, static lineage metadata, Power BI `.pbix` dashboards, `CatalogueSyncService`, and all Stage 5.1+ ML workflows.

---

## 6. Five-Dashboard Power BI Reporting Strategy (Planned)

Power BI Desktop connects in **Import mode** using the dedicated read-only PostgreSQL role `cinesphere_bi_ro` scoped exclusively to `reporting.vw_*`:

1. **Dashboard 1 — Pipeline Operations (Release 1):** Uses `vw_pipeline_run_summary` & `vw_pipeline_daily_metrics` (`pipeline_runs`) for success rates, duration trends, failure categories, and last successful run.
2. **Dashboard 2 — Data Quality & Reliability (Release 1):** Uses `vw_data_quality_summary` (`data_quality_results`), `vw_catalogue_health`, and `vw_embedding_coverage` for check pass rates and completeness/integrity trends.
3. **Dashboard 3 — Ingestion & Catalogue Health (Release 1):** Uses `vw_catalogue_health`, `vw_embedding_coverage`, and `pipeline_runs` for catalogue growth, missing overviews, stale embeddings, and ingestion failures.
4. **Dashboard 4 — Database & Storage Performance (Release 2):** Uses `vw_database_storage_summary` (`database_metric_snapshots`) for DB/table/index/pgvector growth, dead tuples, and index usage.
5. **Dashboard 5 — Data Lineage & Transformation Impact (Release 2):** Uses `vw_dataset_lineage` + `pipeline_runs` for dataset-level source → transformation → consumer impact tracing.

- **Local vs. Hosted Security:** Locally, Power BI Desktop connects to `localhost:5432` as `cinesphere_bi_ro` (read-only `reporting` schema; zero access to personal tables). In hosted deployments (e.g., Supabase/Neon), BI refresh requires SSL/TLS, IP allowlisting or SSH tunnel, and strictly non-PII `reporting` views; Power BI never runs in the application runtime path.
