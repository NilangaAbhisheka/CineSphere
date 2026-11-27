# CineSphere — Phase 5 Technical Design Proposal

## Version 0.7.9: Stage 5.1 Compatibility & Observability Alignment Amendment

**Document Version:** 0.7.9 (Scoped Compatibility Amendment to V0.7.8)  
**Status:** **PROPOSED / DOCUMENTATION ONLY — Stage 5.1 NOT IMPLEMENTED**  
**Date:** 2026-11-27  
**Reference Specification:** [PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md) (V0.7.8 — Preserved Unchanged)

> [!IMPORTANT]
> **Implementation Authorization Status: NOT GRANTED.**  
> This document is a **proposed documentation amendment only**. Stage 5.1 functionality has **not** been implemented. V0.7.8 remains preserved unchanged as historical specification; this amendment defines the exact corrections required before Stage 5.1 implementation is authorized.

---

## 1. Purpose

Following completion of Stage 5.0.4 (TD-08 acceptance) and the pre-Stage 5.1 Observability Foundation (`OBS-1`–`OBS-4`), this amendment resolves four compatibility conflicts between V0.7.8 and the accepted Option C implementation roadmap:

1. Aligning `embedding_coordination` and `.env.example` with the accepted **768-dimensional** TD-08 production model.
2. Deferring Stage 5.2 catalogue synchronization artifacts out of Stage 5.1.
3. Standardizing `job_leases` initialization and idle status (`AVAILABLE`) against V0.7.8's maintenance barrier.
4. Defining the unified NestJS database-ownership boundary and stateless Python JSONL inference contract.

---

## 2. TD-08 Production Model Configuration (Resolves 384 vs. 768 Conflict)

- **Accepted Production Model (TD-08, 2026-11-26):**
  - **Model Name:** `sentence-transformers/all-mpnet-base-v2`
  - **Pinned Revision:** `9a3225965996d404b775526de6dbfe85d3368642`
  - **Dimensions:** `768`
  - **Max Sequence Length:** `384` (right-side truncation)
  - **Normalization:** L2-normalized unit vectors (`-(embedding <#> embedding) BETWEEN 0.998001 AND 1.002001`)

- **Required Correction to V0.7.8 Section 10.1:**
  - Replace the provisional `384`-dimensional seed row `(1, 'provisional-unassigned', '0.0.0', 384)` with the accepted TD-08 baseline:
    ```sql
    INSERT INTO "embedding_coordination" (
        "id", "active_model_name", "active_model_version", "active_dimensions"
    ) VALUES (
        1,
        'sentence-transformers/all-mpnet-base-v2',
        '9a3225965996d404b775526de6dbfe85d3368642',
        768
    ) ON CONFLICT ("id") DO NOTHING;
    ```
  - `media_embeddings` must enforce `vector(768)` (or `vector` with `CHECK ("embedding" IS NULL OR vector_dims("embedding") = 768)`), and all staged/active `model_name`, `model_version`, and `dimensions` values must match `embedding_coordination` so V0.7.8 post-cutover assertions #4–#6 pass cleanly.
  - **Deferred `.env.example` Update:** When Stage 5.1 implementation begins, update `EMBEDDING_MODEL_ID` in `.env.example` from `all-MiniLM-L6-v2` to `sentence-transformers/all-mpnet-base-v2`.

---

## 3. Stage 5.2 Scope Deferral

The following V0.7.8 components belong exclusively to **Stage 5.2 (Daily TMDB Discovery & Catalogue Synchronization under TD-07 Option D)** and **must not** be implemented in Stage 5.1:

- `persist_sync_checkpoint(...)` SQL function (V0.7.8 Section 10.4)
- `sync_watermark_movie` and `sync_watermark_tv` migration (V0.7.8 Section 10.5)
- `@nestjs/schedule` cron registration for catalogue discovery
- `CatalogueSyncService` and daily TMDB new-release discovery

---

## 4. `job_leases` Initialization and Status Alignment

- **Authoritative Status Constraint (V0.7.8):**
  ```sql
  CHECK ("status" IN ('AVAILABLE', 'ACQUIRED', 'MAINTENANCE'))
  ```
  The legacy draft status `'RELEASED'` (from V0.7.1) is **prohibited** unless a future amendment explicitly alters the constraint.
- **Single-Owner Stage 5.1 Seed Rule:**
  - The Stage 5.1 `job_leases` migration will create the table and seed **all three** idle rows exactly once:
    ```sql
    INSERT INTO "job_leases" ("lease_name", "status", "fencing_token", "heartbeat_at", "owner_job_id")
    VALUES
        ('model_cutover', 'AVAILABLE', 0, NULL, NULL),
        ('embedding_generation', 'AVAILABLE', 0, NULL, NULL),
        ('sync_catalogue', 'AVAILABLE', 0, NULL, NULL)
    ON CONFLICT ("lease_name") DO NOTHING;
    ```
  - Seeding all three rows in Stage 5.1 preserves V0.7.8 Section 7.3.4's `GET DIAGNOSTICS ... = ROW_COUNT` (`<> 3`) fail-closed maintenance barrier without introducing any Stage 5.2 sync behavior (`sync_catalogue` remains idle `'AVAILABLE'` until Stage 5.2).
  - Subsequent Stage 5.2 migrations must **not** duplicate these seed inserts.

---

## 5. NestJS / Python Responsibility Boundary (Amends V0.7.8 Section 14.1.1)

For Stage 5.1 production embedding generation, runtime database access is consolidated strictly in NestJS to preserve single-connection/single-transaction `job_leases` fencing:

- **NestJS (`EmbeddingBatchService`, `VectorRepository`, `PipelineTrackingService`) Owns:**
  - `pipeline_runs` lifecycle (`pipeline_name = 'ml_embedding_generation'`, `trigger_type`, counters, allowlisted `metadata`).
  - `job_leases` acquisition, heartbeat renewal, fencing verification, and release.
  - Retrieving eligible/stale media metadata and generating `.tmp/embeddings_in_<runId>.jsonl`.
  - Orchestrating the Python CLI via `child_process.spawn`.
  - Validating `.tmp/embeddings_out_<runId>.jsonl`, staging/promoting vectors in `VectorRepository` inside a single-connection transaction holding the Level 1 lease lock, and executing `execute_model_cutover`.
  - Guaranteed cleanup of `.tmp/` JSONL files in `finally`.
- **Python (`ml/scripts/generate_embeddings.py`) Owns (Stateless Inference Only):**
  - Reading input JSONL sequentially.
  - Canonical text serialization and SHA-256 `contentHash` calculation.
  - Batched Sentence Transformers inference (`all-mpnet-base-v2`, rev `9a3225965996d404b775526de6dbfe85d3368642`).
  - L2 normalization and finite-value verification.
  - Writing output JSONL (`mediaId`, `mediaType`, `status`, `modelName`, `modelVersion`, `dimension`, `metadataRevision`, `contentHash`, `generatedAt`, `embedding`, `error`).
  - **Zero** runtime PostgreSQL lease acquisition or vector persistence from Python.

### Error, Cancellation, and Partial Output Semantics

- **Non-zero Python exit code or `SIGTERM`/`SIGINT` cancellation:** NestJS aborts promotion/cutover, releases `job_leases`, marks the `pipeline_runs` row `FAILED` (or `PARTIAL_SUCCESS` only if validated completed chunks were intentionally persisted), and removes `.tmp/` files in `finally`.
- **Per-item inference errors in output JSONL:** Failed records are counted in `recordsRejected` and remain `PENDING`/`FAILED` without overwriting existing `ACTIVE` embeddings.
