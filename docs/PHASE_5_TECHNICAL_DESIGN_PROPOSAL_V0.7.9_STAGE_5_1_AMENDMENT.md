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

Following completion of Stage 5.0.4 (TD-08 acceptance), the pre-Stage 5.1 Observability Foundation (`OBS-1`–`OBS-4`), and the owner’s Option A synthetic-catalogue eligibility decision, this amendment resolves the compatibility conflicts between V0.7.8 and the accepted implementation roadmap and defines the provenance prerequisite for Stage 5.1:

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
  - **Completed baseline correction:** `.env.example` already pins `EMBEDDING_MODEL_ID=sentence-transformers/all-mpnet-base-v2` as part of baseline stabilisation. Stage 5.1 must verify configuration consistency, not repeat this edit.

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

---

## 6. Catalogue Provenance & Embedding Eligibility (Owner Decision: Option A)

**Decision:** Every movie and TV show must carry explicit catalogue provenance. Stage 5.1 embedding eligibility is limited to records positively identified as genuine TMDB catalogue records. Synthetic fixtures and records whose origin cannot be established are excluded.

### 6.1 Provenance contract

Add a non-null provenance field independently to `movies` and `tv_shows`:

- `catalogue_origin`: PostgreSQL enum (or equivalent constrained text) with exactly these initial values:
  - `TMDB` — record obtained from the TMDB catalogue through an approved ingestion/sync path.
  - `SYNTHETIC` — deterministic fixture, test, benchmark, or otherwise intentionally fabricated catalogue record.
  - `UNKNOWN` — legacy or imported record whose origin has not been established by authoritative evidence.
- Existing rows must initially be treated as `UNKNOWN` by the migration. Do not infer provenance from a TMDB ID threshold, title pattern, popularity, overview presence, or other heuristic alone.
- The database default for new rows is `UNKNOWN`; production TMDB ingestion paths must explicitly write `TMDB`, and fixture/test/benchmark creation paths must explicitly write `SYNTHETIC`. No writer may silently inherit a TMDB classification from a default.
- Provenance is operational metadata, not a user-editable field. Normal TMDB metadata refreshes must not overwrite an existing `SYNTHETIC` or `UNKNOWN` classification. Corrections require an explicit, auditable classification operation backed by evidence.
- Apply the same semantics to movies and TV shows. Seasons and episodes inherit their parent TV show's eligibility; they do not receive independent provenance fields in this stage.

### 6.2 Existing-catalogue audit and backfill

M1 must include a read-only audit and a separately reviewed, deterministic backfill plan before any classification UPDATE is executed:

1. Inventory movie and TV rows by current provenance, counts, TMDB ID ranges, creation/sync timestamps, and any available ingestion or fixture evidence. ID ranges are diagnostic only, never classification authority.
2. Reconcile candidate records against authoritative local artifacts and traceable ingestion evidence, including benchmark/probe fixtures, catalogue seeding manifests/checkpoints, and known test-fixture sources. Use exact media type + TMDB ID identity; do not classify by title similarity alone.
3. Produce explicit per-record classification sets and counts: confirmed `TMDB`, confirmed `SYNTHETIC`, and unresolved `UNKNOWN`. Record the evidence source and deterministic rule used for each set in the audit output; do not store private data in operational telemetry.
4. Review the proposed counts and exceptions before applying the backfill. The migration/backfill must be repeatable and safe to rerun; it must not delete catalogue rows or alter personal-library records.
5. Re-audit after backfill. Any row without sufficient evidence remains `UNKNOWN` and is excluded from embedding generation until separately resolved.

The previously observed counts of high-ID records are not proof that all such rows are synthetic. No blanket `tmdbId >= 9000000` rule is permitted.

### 6.3 Stage 5.1 embedding eligibility

A movie or TV show is eligible only when all of the following hold:

- `catalogue_origin = 'TMDB'`;
- the record satisfies the existing canonical-text/content eligibility requirements;
- the record is not a probe excluded by the benchmark/production policy, where that exclusion applies;
- no other existing integrity or processing rule marks the record ineligible.

`SYNTHETIC` and `UNKNOWN` records must never be selected for initial embedding, stale re-embedding, retry, coverage denominators, or cutover completeness assertions. Their exclusion must be enforced in the authoritative NestJS catalogue-selection query and reinforced by database-level constraints/validation where applicable. Personal-library tables must remain outside all catalogue eligibility queries.

### 6.4 M1 scope and acceptance criteria

M1 is not complete when columns merely exist. It must deliver:

- provenance enum/type and non-null `catalogue_origin` fields on `movies` and `tv_shows`, with safe `UNKNOWN` migration defaults;
- updates to every existing catalogue writer so TMDB ingestion explicitly assigns `TMDB` and fixture/benchmark/test writers explicitly assign `SYNTHETIC`; unclassified writes remain `UNKNOWN`;
- read-only pre-backfill audit output, evidence-backed classification manifest, reviewed idempotent backfill, and post-backfill reconciliation;
- tests proving that high TMDB IDs can be either TMDB or synthetic according to evidence, unresolved records remain UNKNOWN, and TMDB refreshes cannot silently relabel provenance;
- a single documented eligibility predicate used by the Stage 5.1 batch selection and reporting coverage logic;
- zero changes to personal-library data and no Stage 5.1 implementation beyond the explicitly authorized M1 work once separately approved.

The owner has approved the **design choice** (Option A), not implementation. M1 implementation remains unauthorized until separately approved.
