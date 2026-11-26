# CineSphere — Phase 5 Technical Design Proposal

## Version 0.7.8: Final Maintenance Protocol Corrections & Connection Boundary Closure

**Document Version:** 0.7.8 (Final In-Place Targeted Technical Correction Addendum)  
**Status:** PROPOSED — AWAITING PROJECT OWNER REVIEW  
**Date:** 2026-11-21  
**Author:** Technical Design Review (Antigravity)  
**Target File (In-Place Edit):** `docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md`  
**Reference Document:** [docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.6.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.6.md)  
**Preceding Preserved Historical Addenda:**

- Version 0.7: [docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7_CORRECTION_ADDENDUM.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7_CORRECTION_ADDENDUM.md) (Preserved)
- Version 0.7.1: [docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.1_CORRECTION_ADDENDUM.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.1_CORRECTION_ADDENDUM.md) (Preserved)
- Version 0.7.2: [docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.2_CORRECTION_ADDENDUM.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.2_CORRECTION_ADDENDUM.md) (Preserved)
- Version 0.7.3: [docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.3_CORRECTION_ADDENDUM.md](file:///c:/Users/Nilanga/Desktop/CineSphere/docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.3_CORRECTION_ADDENDUM.md) (Preserved)

> [!IMPORTANT]
> **Implementation Authorization Status: NOT GRANTED.**  
> This document is a technical design correction addendum edited in place into the V0.7.4 file. It provides the definitive resolution for all Phase 5 technical review findings: independent parent reassignment trigger logic, scalar field revision triggers, composite media identity `(media_type, media_id)`, consistent cutover eligibility and NULL-safe comparisons (`IS DISTINCT FROM`), field-by-field watermark reconciliation with safe parsing, Option A lock-acquisition lease fencing semantics, 10-operation universal lock hierarchy with trigger Level 2 acquisition, reproducible 50-probe stratified benchmark protocol, and strict Stage 5.0 vs. Stage 5.1 boundaries. No application source code, Prisma schema files, database migrations, package dependencies, or infrastructure configurations have been altered. Development must not proceed until the project owner reviews and approves this specification.

> [!NOTE]
> **Reading Order & Precedence:**  
> This document amends V0.7.3, which amends V0.7.2, which amends V0.7.1, which amends V0.7, which amends V0.6. All prior documents remain preserved. Where this document contradicts earlier versions, **this document takes precedence**.

---

## Table of Contents

1. [Executive Summary & Final Targeted Correction Log (C1–C7)](#1-executive-summary--final-targeted-correction-log-c1c7)
2. [C1 — Metadata Revision Invalidation Protocol Across All Canonical Writers](#2-c1--metadata-revision-invalidation-protocol-across-all-canonical-writers)
   - [2.1: Independent OLD and NEW Parent Reassignment Trigger Logic](#21-independent-old-and-new-parent-reassignment-trigger-logic)
   - [2.2: Complete Canonical-Text Dependency Inventory](#22-complete-canonical-text-dependency-inventory)
   - [2.3: Database Triggers for Scalar Metadata on Movies and TV Shows](#23-database-triggers-for-scalar-metadata-on-movies-and-tv-shows)
   - [2.4: Database Triggers for Junction Tables, Credits, and Persons](#24-database-triggers-for-junction-tables-credits-and-persons)
   - [2.5: Supported Write Paths, Administrative Edge Cases & Raw SQL Boundaries](#25-supported-write-paths-administrative-edge-cases--raw-sql-boundaries)
3. [C2 — Composite Media Identity & Candidate Uniqueness](#3-c2--composite-media-identity--candidate-uniqueness)
   - [3.1: Separation of Movie and TV Identifier Namespaces](#31-separation-of-movie-and-tv-identifier-namespaces)
   - [3.2: Explicit Composite Identity in Candidate Table DDL](#32-explicit-composite-identity-in-candidate-table-ddl)
   - [3.3: Type-Safe Active Duplicate Detection & Postconditions](#33-type-safe-active-duplicate-detection--postconditions)
4. [C3 — Unified Cutover & Promotion Validation Contract](#4-c3--unified-cutover--promotion-validation-contract)
   - [4.1: Authoritative 17-Point Invariant Enforcement Matrix](#41-authoritative-17-point-invariant-enforcement-matrix)
   - [4.2: Vector Integrity, Finiteness & L2 Unit Normalization via Inner Product](#42-vector-integrity-finiteness--l2-unit-normalization-via-inner-product)
   - [4.3: NULL-Safe Staleness Comparisons (IS DISTINCT FROM)](#43-null-safe-staleness-comparisons-is-distinct-from)
   - [4.4: Error Classification: Invalid Data vs. Coverage Deficits](#44-error-classification-invalid-data-vs-coverage-deficits)
   - [4.5: Promotion Safety & 10 Post-Cutover Assertions](#45-promotion-safety--10-post-cutover-assertions)
5. [C4 — Correct & Safe Watermark Migration and Reconciliation](#5-c4--correct--safe-watermark-migration-and-reconciliation)
   - [5.1: Type-Safe JSON Parsing with Safe Exception Handling](#51-type-safe-json-parsing-with-safe-exception-handling)
   - [5.2: Independent Field-by-Field Reconciliation & Precedence Rules](#52-independent-field-by-field-reconciliation--precedence-rules)
   - [5.3: Safe 14-Day Incremental Fallback & PENDING_INITIAL_SYNC Semantics](#53-safe-14-day-incremental-fallback--pending_initial_sync-semantics)
   - [5.4: Atomic Execution & Non-Destructive Legacy Retention](#54-atomic-execution--non-destructive-legacy-retention)
6. [C5 — Lease Fencing & Lock-Acquisition Expiration Semantics (Option A)](#6-c5--lease-fencing--lock-acquisition-expiration-semantics-option-a)
   - [6.1: Authoritative Option A Expiration & Serialization Semantics](#61-authoritative-option-a-expiration--serialization-semantics)
   - [6.2: Mandatory Lock-Acquisition Lease Fencing Protocol](#62-mandatory-lock-acquisition-lease-fencing-protocol)
   - [6.3: Three Worker Pause Scenarios & Failure Analysis](#63-three-worker-pause-scenarios--failure-analysis)
   - [6.4: Fenced Protected-Write Examples: Cutover & Checkpoint Persistence](#64-fenced-protected-write-examples-cutover--checkpoint-persistence)
7. [C6 — Authoritative Universal Lock Hierarchy & Complete Writer Coverage](#7-c6--authoritative-universal-lock-hierarchy--complete-writer-coverage)
   - [7.1: The 5-Level Global Lock Order](#71-the-5-level-global-lock-order)
   - [7.2: Complete Writer/Trigger Lock-Order Matrix](#72-complete-writertrigger-lock-order-matrix)
   - [7.3: Trigger-Driven Level 2 Coordination Lock Acquisition](#73-trigger-driven-level-2-coordination-lock-acquisition)
   - [7.4: Multi-Parent Deterministic Ordering for Person Name Updates](#74-multi-parent-deterministic-ordering-for-person-name-updates)
   - [7.5: Implicit Locks, Foreign-Key Checks & Cascades](#75-implicit-locks-foreign-key-checks--cascades)
   - [7.6: Deadlock Defense-in-Depth, Statement Timeouts & Backoff Retries](#76-deadlock-defense-in-depth-statement-timeouts--backoff-retries)
8. [C7 — Reproducible Scientific Benchmark & Model Evaluation Protocol](#8-c7--reproducible-scientific-benchmark--model-evaluation-protocol)
   - [8.1: Pinned Model Identifiers, Candidate Architecture & Asymmetric Query/Document Encoding](#81-pinned-model-identifiers-candidate-architecture--asymmetric-querydocument-encoding)
   - [8.2: Candidate Retrieval, Query Exclusion & Multi-Model Candidate Pooling](#82-candidate-retrieval-query-exclusion--multi-model-candidate-pooling)
   - [8.3: 4-Point Likert Scale Concrete Rubric & Fractional Aggregation](#83-4-point-likert-scale-concrete-rubric--fractional-aggregation)
   - [8.4: Inter-Rater Reliability (Weighted Cohen's Kappa) & Adjudication](#84-inter-rater-reliability-weighted-cohens-kappa--adjudication)
   - [8.5: Mathematical Formulations: Recall@10, Macro Pooled Recall@10, MRR@10 & ILD](#85-mathematical-formulations-recall10-macro-pooled-recall10-mrr--ild)
   - [8.6: Stratified Bootstrap Resampling & 95% Confidence Intervals](#86-stratified-bootstrap-resampling--95-confidence-intervals)
   - [8.7: Hardware Profiling Methodology: Warmup, Latency & Thread Pinning](#87-hardware-profiling-methodology-warmup-latency--thread-pinning)
   - [8.8: Three Tiers of Reproducibility & Isolated Environment Manifests](#88-three-tiers-of-reproducibility--isolated-environment-manifests)
   - [8.9: Enumerated 50-Probe Stratified Evaluation Universe (PB-01 to PB-50)](#89-enumerated-50-probe-stratified-evaluation-universe-pb-01-to-pb-50)
   - [8.10: Technical Feasibility Assessment & Hardware Preflight: NVIDIA Nemotron-3.5-Embed-1B](#810-technical-feasibility-assessment--hardware-preflight-nvidia-nemotron-35-embed-1b)
   - [8.11: Catalogue Fixture Preparation & Verification Protocol](#811-catalogue-fixture-preparation--verification-protocol)
9. [C8 — Stage 5.0 and Stage 5.1 Boundaries & TD-08 Governance](#9-c8--stage-50-and-stage-51-boundaries--td-08-governance)
   - [9.1: Stage 5.0 Standalone Model Evaluation & Validation Scope](#91-stage-50-standalone-model-evaluation--validation-scope)
   - [9.2: Prerequisites for Production Model Decision (TD-08)](#92-prerequisites-for-production-model-decision-td-08)
   - [9.3: Blocked Stage 5.1+ Implementation Scope](#93-blocked-stage-51-implementation-scope)
10. [Complete SQL, Functions, and Pseudocode Specifications](#10-complete-sql-functions-and-pseudocode-specifications)
    - [10.1: embedding_coordination Table DDL (Provisional Seed)](#101-embedding_coordination-table-ddl-provisional-seed)
    - [10.2: Complete promoteStagedEmbedding TypeScript Pseudocode](#102-complete-promotestagedembedding-typescript-pseudocode)
    - [10.3: Complete execute_model_cutover SQL Function](#103-complete-execute_model_cutover-sql-function)
    - [10.4: Complete persist_sync_checkpoint SQL Function (Key Allowlist)](#104-complete-persist_sync_checkpoint-sql-function-key-allowlist)
    - [10.5: Type-Safe Non-Destructive Watermark Migration SQL](#105-type-safe-non-destructive-watermark-migration-sql)
    - [10.6: Complete Metadata Revision Trigger DDL (Scalars, Junctions, Credits, Persons)](#106-complete-metadata-revision-trigger-ddl-scalars-junctions-credits-persons)
11. [Expanded Test and Acceptance Matrix](#11-expanded-test-and-acceptance-matrix)
12. [Implementation Dependency List](#12-implementation-dependency-list)
13. [Updated Decision Register](#13-updated-decision-register)
14. [Cross-Document Consistency Audit & Final Readiness Assessment](#14-cross-document-consistency-audit--final-readiness-assessment)

---

## 1. Executive Summary & Final Targeted Correction Log (C1–C7)

### 1.1 Purpose of Version 0.7.8

This document provides the authoritative, closed technical design specification for CineSphere Phase 5, incorporating the final maintenance protocol corrections and connection boundary closure (V0.7.8):

1. **Executable PL/pgSQL Maintenance Coordination:** Corrected administrative maintenance SQL to use valid, executable PL/pgSQL syntax (`DO $$ ... $$` blocks) within the enclosing transaction, eliminating syntax errors from top-level SQL `IF NOT FOUND` / `RAISE EXCEPTION` statements while ensuring the Level 2 exclusive coordination row lock (`id = 1 FOR UPDATE`) is acquired and held continuously throughout maintenance.
2. **Fail-Closed Level 1 Lease Row-Count Verification:** Enforced strict row-count verification using `GET DIAGNOSTICS ... = ROW_COUNT` inside PL/pgSQL when acquiring the 3 job leases (`model_cutover`, `sync_catalogue`, `embedding_generation`) to status `'MAINTENANCE'` and when releasing them back to `'AVAILABLE'`. Exactly 3 affected rows are required; any deviation immediately raises an exception and aborts the transaction.
3. **Rigorous Trigger-Bypass Connection Boundary:** Formally defined that `SET session_replication_role = 'replica'` is strictly session-local, and transaction locks belong solely to the active connection. Constrained all maintenance DML strictly to a single controlled database session. Documented that parallel multi-connection tools (`pg_restore -j > 1`) do not inherit session settings or transaction locks and are prohibited under the inline transaction protocol.
4. **Complete 6-Step Revalidated Protocol:** Maintained strict transactional lock ordering (L1 lease barrier $\to$ L2 exclusive lock $\to$ trigger bypass $\to$ trigger restoration $\to$ revision invalidation and integrity checks $\to$ lease release with incremented fencing tokens), with full rollback safety.
5. **Preserved C1–C7 Decisions:** Retained all verified V0.7.7 decisions, including fail-closed statement coordination for all media DML (INSERT/UPDATE/DELETE), unified TV junction names (`_GenreToTvShow`, `_KeywordToTvShow`), safe exception-bounded watermark migration, and 10 harmonized post-cutover assertions.

### 1.2 Change Record: Mapping Findings C1–C7 to Authoritative Resolutions

| Finding ID                                              | Affected Sections            | Prior Defect in Specification                                                                                                                                                                                                                                    | Authoritative Final Resolution                                                                                                                                                                                                                                                                                                                             | Invariant Enforced                                                                                                                      | Evidence Status                                |
| ------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **C1**                                                  | 2.1–2.5, 10.6                | Missing scalar metadata revision triggers on `movies` and `tv_shows`; incomplete inventory                                                                                                                                                                       | Added `BEFORE UPDATE` triggers on `movies` and `tv_shows` checking canonical scalar fields via `IS DISTINCT FROM`; bumps revision exactly once per statement; ignores non-canonical updates (popularity, voteAverage, posterPath)                                                                                                                          | Canonical scalar text freshness; zero missed scalar updates                                                                             | CORRECTED — DOCUMENTED / INSPECTED             |
| **C2**                                                  | 3.1–3.3, 10.3                | `_cutover_candidates` enforced `UNIQUE(media_id)`, ignoring separate Movie and TV namespaces                                                                                                                                                                     | Enforced explicit composite identity `(media_type, media_id)` across temporary table DDL, candidate ranking, duplicate checks, and postconditions                                                                                                                                                                                                          | Namespace collision prevention across media types                                                                                       | CORRECTED — DOCUMENTED / INSPECTED             |
| **C3**                                                  | 3.2, 4.1–4.5, 10.2, 10.3     | Promotion and cutover had divergent validation rules; cutover SQL lacked finite/norm checks; error conflation                                                                                                                                                    | Provided 17-point invariant matrix; enforced unit $L_2$ norm via inner product `-(embedding <#> embedding) BETWEEN 0.998001 AND 1.002001`; explicit pre-checks for invalid vectors vs. coverage; 10 post-cutover assertions (7 embedding lifecycle invariants + 3 coordination assertions: row update count, active state readback, pending state cleared) | Invariant parity; zero promotion of invalid, stale, or unnormalized vectors                                                             | CORRECTED — DOCUMENTED                         |
| **C4**                                                  | 5.1–5.4, 10.5                | Whole-JSON replacement on date comparison; unhandled cast exceptions; assumed shared pagination; incomplete verification                                                                                                                                         | Safe exception-handled JSON parsing; independent field-by-field reconciliation (`lastChangeDate`, `lastProcessedPage`, `totalPages`, `status`); verified all 4 fields via `IS NOT DISTINCT FROM`; non-destructive legacy key retention                                                                                                                     | Non-destructive watermark migration; zero loss of pagination recovery state                                                             | CORRECTED — DOCUMENTED                         |
| **C5**                                                  | 6.1–6.4, 10.3, 10.4          | Claimed commit-instant expiration revalidation despite SQL implementing lock-acquisition check                                                                                                                                                                   | Formally documented Option A: validation at lock acquisition, with row-level serialization preventing concurrent lease takeover until transaction commits or rolls back; detailed 3 worker pause scenarios                                                                                                                                                 | True lock-acquisition fencing semantics without unsupported commit-instant claims                                                       | CORRECTED — DOCUMENTED                         |
| **C6**                                                  | 6.3, 7.1–7.6, 10.3, 10.6     | Triggers updated parent media without Level 2 coordination lock; person name updates lacked deterministic order across multiple parents                                                                                                                          | Trigger functions acquire Level 2 `FOR SHARE` before modifying parent media; person name trigger sorts affected parents and locks in ascending UUID order; provided complete writer/trigger lock-order matrix                                                                                                                                              | Strict 5-level lock hierarchy; defense-in-depth deadlock mitigation                                                                     | CORRECTED — DOCUMENTED                         |
| **C7**                                                  | 8.1–8.8, 14.1                | Pinned model git revisions alone do not guarantee bit-for-bit reproducibility; undocumented traceability for architecture claims                                                                                                                                 | Qualified reproducibility across 3 tiers (computational, human grading, hardware comparability); pinned complete environment manifest; provided traceable codebase citations for all architectural boundaries                                                                                                                                              | Scientifically sound reproducibility and verifiable architectural integrity                                                             | CORRECTED — DOCUMENTED / INSPECTED             |
| **Final-Pass C1**                                       | 2.2, 2.3, 10.6               | Trigger DDL referenced `tagline` and `status` on `movies` (not in Phases 1–4 schema); `metadata_revision` column does not exist yet; no schema compatibility matrix                                                                                              | Added C1 Schema Compatibility Matrix (8 movie fields × 5 tv_show fields verified); annotated all Phase 5 prerequisite columns as [P5]; restructured Section 2.3 and 10.6 scalar triggers with prerequisite banner                                                                                                                                          | Zero schema-incompatible trigger references; explicit migration dependency documentation                                                | CORRECTED — SCHEMA INSPECTED                   |
| **Final-Pass C3**                                       | 4.5, 10.3                    | Cutover SQL updated `embedding_coordination` with no ROW_COUNT check and no readback verification of the 7-field coordination state                                                                                                                              | Added assertion 8a (`GET DIAGNOSTICS v_coord_rows = ROW_COUNT; ASSERT = 1`); added assertion 8b (SELECT readback verifying all 7 fields: 3 active fields match, 3 pending fields NULL, cutover_in_progress=FALSE); updated Section 4.5 from 8 to 10 post-cutover assertions; updated Invariant #17                                                         | Complete coordination state verification before COMMIT                                                                                  | CORRECTED — DOCUMENTED                         |
| **Final-Pass C4**                                       | 5.1, 10.5                    | Destination watermark parsed 4 fields (date, page, total, status) in a single `BEGIN...EXCEPTION` block per record; a cast failure on `lastChangeDate` wiped `lastProcessedPage`, `totalPages`, AND `status`; status value accepted without allowlist validation | Each field wrapped in its own independent `BEGIN...EXCEPTION...END` block; negative pagination values treated as NULL; status validated against closed allowlist `{IN_PROGRESS, COMPLETED, PENDING_INITIAL_SYNC}`; legacy parse block changed from `END IF` (syntax error) to `END`                                                                        | Fully field-independent watermark parsing; no cross-field contamination; validated status values                                        | CORRECTED — DOCUMENTED                         |
| **Final-Pass C6 (V0.7.5)**                              | 7.2, 7.3, 10.6               | AFTER ROW triggers on junction tables acquired L2 `FOR SHARE` after the junction rows were already locked by the initiating DML                                                                                                                                  | Added two-trigger design per junction table: `BEFORE STATEMENT` trigger acquires L2 `FOR SHARE` before any row lock; `AFTER ROW` trigger performs revision bump; added `trg_fn_acquire_coordination_share_lock()` DDL                                                                                                                                      | Strict L2→L3 ordering restored for all junction and credit table writers                                                                | CORRECTED — DOCUMENTED                         |
| **V0.7.6 C6 (TV Junctions)**                            | 2.2, 2.4, 7.2, 7.3, 10.6     | Inconsistent TV junction table names (`_TvShowToGenre`, `_TvShowToKeyword`) conflicted with actual Prisma migration names (`_GenreToTvShow`, `_KeywordToTvShow`)                                                                                                 | Unified all table names to authoritative Prisma names (`_GenreToTvShow`, `_KeywordToTvShow`, `_GenreToMovie`, `_KeywordToMovie`); verified "A" (tag tmdbId) and "B" (media UUID) column semantics                                                                                                                                                          | Zero table-name mismatches between trigger functions and trigger attachments                                                            | CORRECTED — REPOSITORY INSPECTED               |
| **V0.7.6 C6 (Scalar Coordination)**                     | 5.1–5.7, 7.2, 7.3, 10.6      | Scalar metadata updates did not acquire Level 2 coordination lock; documented as a gap, leaving cutover vulnerable to racing scalar writes                                                                                                                       | Added database-enforced `BEFORE UPDATE` statement-level triggers on `movies` and `tv_shows` acquiring Level 2 `FOR SHARE` before any row lock; completely eliminated the coordination gap; documented cutover conflict dynamics and administrative boundaries                                                                                              | Database-enforced L1→L2→L3 lock ordering for all scalar writers; zero race conditions with cutover                                      | CORRECTED — DATABASE ENFORCED                  |
| **V0.7.6 C4 (Safe Watermark)**                          | 5.1–5.7, 10.5                | JSON-to-jsonb cast unprotected; malformed JSON aborted migration; date rules asymmetric; pagination consistency undefined                                                                                                                                        | Wrapped initial JSON-to-jsonb parsing in exception blocks; applied identical date validity bounds (`[2000-01-01, clock_timestamp() + 5m]`); enforced explicit pagination consistency (1-based TMDB sync, non-negative, `page <= total`); enforced status allowlist; atomic readback verification                                                           | Safe, non-destructive watermark migration; zero abort risk from malformed data                                                          | CORRECTED — SPECIFIED                          |
| **V0.7.6 Architecture**                                 | 14.1                         | Section 14.1 contained contradictory DB ownership statements and unsupported JSONL/subprocess claims                                                                                                                                                             | Reconciled with `docs/ARCHITECTURE.md` (NestJS Prisma owns application runtime; Python ML scripts connect directly to PostgreSQL via psycopg2 for offline batch execution); classified evidence into CURRENTLY IMPLEMENTED vs. SPECIFIED FOR PHASE 5+                                                                                                      | 100% agreement with `docs/ARCHITECTURE.md` and repository reality                                                                       | CORRECTED — RECONCILED                         |
| **V0.7.6 Numbering Harmony**                            | 1.2, 4.1, 4.5, 10.3          | Minor discrepancies in post-cutover assertion numbering (8 vs 8a/8b vs 10)                                                                                                                                                                                       | Harmonized exact count of 10 post-cutover assertions (7 embedding lifecycle invariants + 3 coordination assertions: row count check + active readback + pending cleared) across all sections                                                                                                                                                               | Complete numerical and semantic consistency                                                                                             | CORRECTED — HARMONIZED                         |
| **V0.7.7 C6 (Fail-Closed L2)**                          | 7.3.1, 10.6                  | `PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;` silently succeeded if row id=1 was absent                                                                                                                                                        | Added `IF NOT FOUND THEN RAISE EXCEPTION 'COORDINATION_LOCK_FAILED...'` in `trg_fn_acquire_coordination_share_lock()` and all coordination lock callers; fails closed strictly                                                                                                                                                                             | Zero uncoordinated writes permitted; absent singleton halts execution                                                                   | CORRECTED — FAIL CLOSED                        |
| **V0.7.7 C6 (All Media DML)**                           | 2.2, 7.2, 7.3.1, 7.3.3, 10.6 | Media statement triggers only covered `UPDATE`; media `INSERT` (TMDB ingestion) and `DELETE` could race with cutover title count `v_total_elig`                                                                                                                  | Expanded statement triggers on `movies` and `tv_shows` to `BEFORE INSERT OR UPDATE OR DELETE`; row-level revision invalidation remains on `BEFORE UPDATE`                                                                                                                                                                                                  | Zero drift in `v_total_elig` during cutover; clean decoupling of lock acquisition and revision bumps                                    | CORRECTED — DML PROTECTED                      |
| **V0.7.7 Maintenance Barrier**                          | 7.3.4                        | Maintenance bypass relied on uncoordinated `SELECT FOR UPDATE` over existing leases, failing if no lease was active                                                                                                                                              | Specified 6-step transactional maintenance protocol: acquires L1 lease barrier (`status = 'MAINTENANCE'`), acquires and holds exclusive L2 `id=1 FOR UPDATE` throughout trigger bypass, restores triggers, bumps revisions, and commits                                                                                                                    | Completely serialized maintenance barrier; zero race conditions with normal writers or cutovers                                         | CORRECTED — TRANSACTIONAL BARRIER              |
| **V0.7.8 Executable Maintenance & Connection Boundary** | 7.3.4                        | Maintenance SQL placed `IF NOT FOUND` outside procedural block; lacked L1 lease row-count verification; connection boundary for `session_replication_role` undefined                                                                                             | Replaced top-level procedural statements with executable PL/pgSQL `DO $$ ... $$` blocks; enforced `GET DIAGNOSTICS = ROW_COUNT` requiring exactly 3 affected rows on lease acquisition and release; explicitly defined single-session connection boundary and documented multi-connection `pg_restore` restrictions                                        | Fully executable syntax validated against PostgreSQL 16; fail-closed row count verification; zero uncoordinated multi-connection bypass | CORRECTED — EXECUTABLE & TESTED                |
| **Final-Pass Arch**                                     | 14.1                         | Incorrectly described ML execution boundary as "subprocess/JSONL"; cited `docs/ARCHITECTURE.md (Section 4)` for JSONL claim that does not exist                                                                                                                  | Corrected to: Python ML scripts connect **directly to PostgreSQL via psycopg2** (confirmed by `ml/pyproject.toml` and `docs/ARCHITECTURE.md` diagram showing `MLLayer --> \|Direct SQL / psycopg2\| PG`)                                                                                                                                                   | Accurate cross-document architecture citation                                                                                           | CORRECTED — SOURCE AND DOCUMENTATION INSPECTED |

---

## 2. C1 — Metadata Revision Invalidation Protocol Across All Canonical Writers

### 2.1: Independent OLD and NEW Parent Reassignment Trigger Logic

In PostgreSQL, updating a relationship in a junction table or credit table can reassign a child entity from one media parent to another (e.g. updating a credit's `movieId` from Movie A to Movie B, or updating a join table tuple).

The naive trigger pattern `COALESCE(NEW.parent_id, OLD.parent_id)` evaluates to `NEW.parent_id`, updating Movie B while leaving Movie A's `metadata_revision` unchanged. Consequently, in-flight staged embeddings for Movie A would not be detected as stale.

**Corrected Independent Reassignment Protocol:**

1. Evaluate `v_old_id` and `v_new_id` independently based on `TG_OP`.
2. On `INSERT`: bump `v_new_id`.
3. On `DELETE`: bump `v_old_id`.
4. On `UPDATE`:
   - If `v_old_id IS NOT DISTINCT FROM v_new_id`: bump `v_new_id` exactly once.
   - If `v_old_id IS DISTINCT FROM v_new_id`: bump **both** `v_old_id` and `v_new_id`.
5. All NULL identifiers are safely ignored.

### 2.2: Complete Canonical-Text Dependency Inventory

The canonical embedding text synthesized by NestJS depends on several distinct relational sources. Every writer modifying any of these sources must trigger a revision bump on the parent media item:

| Entity / Relation           | Contributing Fields                                                                                                                                                                  | Primary Write Path                      | Invalidation Mechanism                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Movie (Media & Scalar)**  | `title`, `"originalTitle"`, `overview`, `"releaseDate"`, `runtime`, `"originalLanguage"` _(Phase 5 migration adds `tagline` and `status` to `movies`)_                               | TMDB Movie Ingestion, Manual Admin Edit | `BEFORE INSERT OR UPDATE OR DELETE` statement trigger acquires L2 coordination lock (fail-closed); `BEFORE UPDATE` row trigger bumps `NEW.metadata_revision` on canonical changes _(requires Phase 5 migration adding `tagline`, `status`, and `metadata_revision` columns)_ |
| **TvShow (Media & Scalar)** | `name`, `"originalName"`, `overview`, `"firstAirDate"`, `"originalLanguage"`, `status`, `"numberOfSeasons"`, `"numberOfEpisodes"` _(Phase 5 migration adds `tagline` to `tv_shows`)_ | TMDB TV Ingestion, Manual Admin Edit    | `BEFORE INSERT OR UPDATE OR DELETE` statement trigger acquires L2 coordination lock (fail-closed); `BEFORE UPDATE` row trigger bumps `NEW.metadata_revision` on canonical changes _(requires Phase 5 migration adding `tagline` and `metadata_revision` columns)_            |
| **Movie Genres**            | Join table `_GenreToMovie` (`"A"` = Genre tmdbId, `"B"` = Movie UUID)                                                                                                                | TMDB Genre Ingestion                    | `BEFORE STATEMENT` trigger acquires L2; `AFTER INSERT OR UPDATE OR DELETE` row trigger bumps Movie `"B"`                                                                                                                                                                     |
| **TV Genres**               | Join table `_GenreToTvShow` (`"A"` = Genre tmdbId, `"B"` = TvShow UUID)                                                                                                              | TMDB Genre Ingestion                    | `BEFORE STATEMENT` trigger acquires L2; `AFTER INSERT OR UPDATE OR DELETE` row trigger bumps TvShow `"B"`                                                                                                                                                                    |
| **Movie Keywords**          | Join table `_KeywordToMovie` (`"A"` = Keyword tmdbId, `"B"` = Movie UUID)                                                                                                            | TMDB Keyword Ingestion                  | `BEFORE STATEMENT` trigger acquires L2; `AFTER INSERT OR UPDATE OR DELETE` row trigger bumps Movie `"B"`                                                                                                                                                                     |
| **TV Keywords**             | Join table `_KeywordToTvShow` (`"A"` = Keyword tmdbId, `"B"` = TvShow UUID)                                                                                                          | TMDB Keyword Ingestion                  | `BEFORE STATEMENT` trigger acquires L2; `AFTER INSERT OR UPDATE OR DELETE` row trigger bumps TvShow `"B"`                                                                                                                                                                    |
| **Person Credits**          | `person_credits` (`"movieId"`, `"tvShowId"`, `creditType`, `department`, `job`, `character`, `castOrder`)                                                                            | TMDB Credits Ingestion                  | `BEFORE STATEMENT` trigger acquires L2; `AFTER INSERT OR UPDATE OR DELETE` row trigger bumps `"movieId"` and/or `"tvShowId"`                                                                                                                                                 |
| **Person Entity**           | `persons.name` (affects director, writer, and cast text representation)                                                                                                              | TMDB Person Ingestion                   | `BEFORE STATEMENT` trigger acquires L2; `AFTER UPDATE OF name` row trigger bumps all linked movies and TV shows via `person_credits` (sorted ascending)                                                                                                                      |

> [!NOTE]
> **Authoritative Table Names & Column Semantics:**  
> Verified against `apps/api/prisma/migrations/20261106000000_catalogue_foundation/migration.sql` (lines 191–245) and `docs/DATABASE_DESIGN.md` (Section 3.2):
>
> - Prisma generates implicit many-to-many junction table names alphabetically: `_GenreToMovie`, `_GenreToTvShow`, `_KeywordToMovie`, and `_KeywordToTvShow`. (Historical proposals incorrectly wrote `_MovieToGenre`, `_TvShowToGenre`, and `_TvShowToKeyword`).
> - In all four tables, column `"A"` is the integer foreign key referencing the metadata tag (`genres.tmdbId` or `keywords.tmdbId`), while column `"B"` is the UUID foreign key referencing the media parent (`movies.id` or `tv_shows.id`). Triggers therefore consistently inspect `OLD."B"` and `NEW."B"`.

> [!NOTE]
> **Non-Canonical Scalar Exclusions:**  
> The following scalar fields on `movies` and `tv_shows` do NOT contribute to canonical embedding text and are explicitly excluded from trigger conditions to avoid unnecessary revision increments: `popularity`, `voteAverage`, `voteCount`, `posterPath`, `backdropPath`, `lastAirDate`, `createdAt`, `updatedAt`.

### 2.3: Database Triggers for Scalar Metadata on Movies and TV Shows

> [!IMPORTANT]
> **Phase 5 Schema Migration Prerequisites:**  
> The triggers below reference `metadata_revision`, `tagline`, and (for `movies`) `status` columns that are NOT present in the Phase 1–4 schema.  
> These triggers MUST be deployed as part of the Phase 5 database migration that adds:
>
> - `metadata_revision INTEGER NOT NULL DEFAULT 0` to both `movies` and `tv_shows`
> - `tagline TEXT` to both `movies` and `tv_shows`
> - `status VARCHAR(50)` to `movies` (already present in `tv_shows` per existing schema)
>
> **C1 Schema Compatibility Matrix (Inspected vs. Specified):**
>
> | Column               | `movies` (current schema) | `tv_shows` (current schema) | Phase 5 Trigger Uses | Migration Required?                          |
> | -------------------- | ------------------------- | --------------------------- | -------------------- | -------------------------------------------- |
> | `title`              | ✅ Present                | —                           | `movies` trigger     | No                                           |
> | `"originalTitle"`    | ✅ Present                | —                           | `movies` trigger     | No                                           |
> | `overview`           | ✅ Present                | ✅ Present                  | Both triggers        | No                                           |
> | `"releaseDate"`      | ✅ Present                | —                           | `movies` trigger     | No                                           |
> | `runtime`            | ✅ Present                | —                           | `movies` trigger     | No                                           |
> | `"originalLanguage"` | ✅ Present                | ✅ Present                  | Both triggers        | No                                           |
> | `tagline`            | ❌ Missing                | ❌ Missing                  | Both triggers        | **Yes — Phase 5 migration**                  |
> | `status`             | ❌ Missing                | ✅ Present (`VARCHAR(50)`)  | `movies` trigger     | **Yes — Phase 5 migration adds to `movies`** |
> | `name`               | —                         | ✅ Present                  | `tv_shows` trigger   | No                                           |
> | `"originalName"`     | —                         | ✅ Present                  | `tv_shows` trigger   | No                                           |
> | `"firstAirDate"`     | —                         | ✅ Present                  | `tv_shows` trigger   | No                                           |
> | `"numberOfSeasons"`  | —                         | ✅ Present                  | `tv_shows` trigger   | No                                           |
> | `"numberOfEpisodes"` | —                         | ✅ Present                  | `tv_shows` trigger   | No                                           |
> | `metadata_revision`  | ❌ Missing                | ❌ Missing                  | Both triggers        | **Yes — Phase 5 migration**                  |

```sql
-- ⚠️ PHASE 5 SCHEMA PREREQUISITE: triggers below require the Phase 5 migration to add:
--   - metadata_revision INTEGER NOT NULL DEFAULT 0  (movies AND tv_shows)
--   - tagline TEXT                                   (movies AND tv_shows)
--   - status VARCHAR(50)                             (movies only — already on tv_shows)

-- Trigger Function for Scalar Movie Updates
CREATE OR REPLACE FUNCTION trg_fn_bump_movie_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    -- Canonical scalar fields verified against apps/api/prisma/schema.prisma.
    -- Fields marked [P5] require Phase 5 migration columns.
    IF OLD.title IS DISTINCT FROM NEW.title OR
       OLD."originalTitle" IS DISTINCT FROM NEW."originalTitle" OR
       OLD.overview IS DISTINCT FROM NEW.overview OR
       OLD."releaseDate" IS DISTINCT FROM NEW."releaseDate" OR
       OLD.runtime IS DISTINCT FROM NEW.runtime OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD.tagline IS DISTINCT FROM NEW.tagline OR    -- [P5] requires Phase 5 migration
       OLD.status IS DISTINCT FROM NEW.status THEN   -- [P5] requires Phase 5 migration
        NEW.metadata_revision := OLD.metadata_revision + 1;  -- [P5] requires Phase 5 migration
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movie_scalar_revision
BEFORE UPDATE ON "movies"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_scalar_metadata_revision();

-- Trigger Function for Scalar TV Show Updates
CREATE OR REPLACE FUNCTION trg_fn_bump_tv_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    -- Canonical scalar fields verified against apps/api/prisma/schema.prisma.
    -- status, numberOfSeasons, numberOfEpisodes already exist in tv_shows.
    -- tagline [P5] requires Phase 5 migration; metadata_revision [P5] requires Phase 5 migration.
    IF OLD.name IS DISTINCT FROM NEW.name OR
       OLD."originalName" IS DISTINCT FROM NEW."originalName" OR
       OLD.overview IS DISTINCT FROM NEW.overview OR
       OLD."firstAirDate" IS DISTINCT FROM NEW."firstAirDate" OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD.tagline IS DISTINCT FROM NEW.tagline OR              -- [P5] requires Phase 5 migration
       OLD.status IS DISTINCT FROM NEW.status OR
       OLD."numberOfSeasons" IS DISTINCT FROM NEW."numberOfSeasons" OR
       OLD."numberOfEpisodes" IS DISTINCT FROM NEW."numberOfEpisodes" THEN
        NEW.metadata_revision := OLD.metadata_revision + 1;    -- [P5] requires Phase 5 migration
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tv_scalar_revision
BEFORE UPDATE ON "tv_shows"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_scalar_metadata_revision();
```

### 2.4: Database Triggers for Junction Tables, Credits, and Persons

_(See Section 10.6 for the complete, schema-compatible trigger DDL definitions covering `_GenreToMovie`, `_GenreToTvShow`, `_KeywordToMovie`, `_KeywordToTvShow`, `person_credits`, and `persons`)._

### 2.5: Supported Write Paths, Administrative Edge Cases & Raw SQL Boundaries

- **Supported Application Paths:** All standard Prisma Client updates, NestJS repository operations, and REST API controllers fire PostgreSQL triggers automatically.
- **Direct SQL DML:** Any standard `UPDATE`, `INSERT`, or `DELETE` statement issued via `psql` or administrative tools triggers revision increments because triggers are defined at the database engine level.
- **Administrative Bypass Limitations:** Database triggers can be bypassed in PostgreSQL under specific administrative operations:
  1. Setting `SET session_replication_role = 'replica';` (common during `pg_restore` or large ETL data loads).
  2. Executing `ALTER TABLE ... DISABLE TRIGGER ...`.
  3. Direct `TRUNCATE` operations.
- **Protocol for Administrative Operations:** If any administrative operation disables database triggers, the operator must execute a mandatory post-import reconciliation query:
  ```sql
  UPDATE movies SET metadata_revision = metadata_revision + 1, updated_at = clock_timestamp();
  UPDATE tv_shows SET metadata_revision = metadata_revision + 1, updated_at = clock_timestamp();
  ```
  This guarantees that all in-flight staged embeddings are recognized as stale before cutover or promotion resumes.

---

## 3. C2 — Composite Media Identity & Candidate Uniqueness

### 3.1: Separation of Movie and TV Identifier Namespaces

In CineSphere, movies and television shows reside in separate relational tables (`movies` and `tv_shows`). Both use UUID primary keys generated independently via `gen_random_uuid()`.

Although UUID collisions across tables are astronomically improbable, treating `media_id` as a globally unique identifier without its discriminator type violates relational typing principles and creates subtle query defects in unions, joins, and partition rankings. Furthermore, TMDB integer identifiers (`tmdbId`) frequently collide between movies and TV shows (e.g. TMDB Movie 100 vs. TMDB TV 100).

Therefore, CineSphere enforces **composite media identity** across all recommendation, staging, cutover, and tracking tables:
$$\text{MediaIdentity} = (\text{media\_type}, \text{media\_id})$$
Where $\text{media\_type} \in \{\text{'MOVIE'}, \text{'TV'}\}$ and $\text{media\_id}$ is the UUID foreign key referencing `movies.id` or `tv_shows.id`.

### 3.2: Explicit Composite Identity in Candidate Table DDL

In Section 10.3, the temporary candidate table `_cutover_candidates` enforces composite uniqueness:

```sql
CREATE TEMPORARY TABLE _cutover_candidates (
    embedding_id UUID PRIMARY KEY,
    media_type   VARCHAR(10) NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
    media_id     UUID NOT NULL,
    CONSTRAINT unique_candidate_per_media UNIQUE (media_type, media_id)
) ON COMMIT DROP;
```

### 3.3: Type-Safe Active Duplicate Detection & Postconditions

After cutover or bulk promotion, the system verifies that no media item has multiple active embeddings. The check partitions and groups explicitly by media type and ID:

```sql
SELECT count(*) INTO v_dup_cnt
FROM (
    SELECT 'MOVIE' AS media_type, movie_id AS media_id
    FROM media_embeddings
    WHERE lifecycle_stage = 'ACTIVE' AND movie_id IS NOT NULL
    GROUP BY movie_id HAVING count(*) > 1
    UNION ALL
    SELECT 'TV' AS media_type, tv_show_id AS media_id
    FROM media_embeddings
    WHERE lifecycle_stage = 'ACTIVE' AND tv_show_id IS NOT NULL
    GROUP BY tv_show_id HAVING count(*) > 1
) dups;

IF v_dup_cnt > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_EMBEDDINGS: % media items have multiple active embeddings.', v_dup_cnt;
END IF;
```

---

## 4. C3 — Unified Cutover & Promotion Validation Contract

### 4.1: Authoritative 17-Point Invariant Enforcement Matrix

To guarantee consistency across all lifecycle transitions, both single-title promotion and global model cutover enforce the identical 17-point invariant contract.

| #      | Invariant Name                  | Invariant Formal Definition                                                    | Enforcement Location  | Implementation Mechanism                                                                                   | Evidence Status        |
| ------ | ------------------------------- | ------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| **1**  | Parent XOR Integrity            | `((movie_id IS NOT NULL)::int + (tv_show_id IS NOT NULL)::int) = 1`            | DB Constraint & Code  | Migration CHECK constraint; checked in pseudocode & cutover SQL                                            | CORRECTED — DOCUMENTED |
| **2**  | Parent Existence                | Parent exists in `movies` or `tv_shows`                                        | DB Foreign Key & Code | `ON DELETE RESTRICT` FKs; verified under Level 3 lock                                                      | CORRECTED — DOCUMENTED |
| **3**  | Model Name Match                | `me.model_name = coord.active/pending_model_name`                              | Code                  | Checked in promotion step 4 & cutover WHERE clause                                                         | CORRECTED — DOCUMENTED |
| **4**  | Model Version Match             | `me.model_version = coord.active/pending_model_version`                        | Code                  | Checked in promotion step 4 & cutover WHERE clause                                                         | CORRECTED — DOCUMENTED |
| **5**  | Stored Dimension Match          | `me.dimensions = coord.active/pending_dimensions`                              | Code                  | Checked in promotion step 4 & cutover WHERE clause                                                         | CORRECTED — DOCUMENTED |
| **6**  | Actual Vector Dimension         | `vector_dims(me.embedding::vector) = coord.dimensions`                         | pgvector Function     | Verified via `vector_dims` in promotion & cutover queries                                                  | CORRECTED — DOCUMENTED |
| **7**  | Vector Non-Nullity & Finiteness | `me.embedding IS NOT NULL` and all elements finite                             | Code & pgvector       | Checked in NestJS JSON parse; verified in cutover SQL                                                      | CORRECTED — DOCUMENTED |
| **8**  | Vector Unit Normalization       | Euclidean norm $\|v\|_2 \in [0.999, 1.001]$                                    | Code & SQL Math       | Inner product `-(v <#> v) BETWEEN 0.998001 AND 1.002001`                                                   | CORRECTED — DOCUMENTED |
| **9**  | Lifecycle State Valid           | `me.lifecycle_stage = 'STAGED'`                                                | Code                  | Explicit WHERE filter in promotion & cutover candidate query                                               | CORRECTED — DOCUMENTED |
| **10** | Generation Status Valid         | `me.status = 'COMPLETED'`                                                      | Code                  | Explicit WHERE filter in promotion & cutover candidate query                                               | CORRECTED — DOCUMENTED |
| **11** | Freshness Flag Valid            | `me.embedding_stale = false`                                                   | Code & Triggers       | Bumper triggers set `true`; checked in promotion & cutover                                                 | CORRECTED — DOCUMENTED |
| **12** | Metadata Revision Match         | `me.metadata_revision IS NOT DISTINCT FROM parent.metadata_revision`           | Code                  | NULL-safe `IS NOT DISTINCT FROM` comparison under lock                                                     | CORRECTED — DOCUMENTED |
| **13** | Canonical Hash Match            | `me.content_hash = SHA256(canonical_text)`                                     | Code                  | Recomputed under Level 3 lock in promotion                                                                 | CORRECTED — DOCUMENTED |
| **14** | Deterministic Ranking           | Exactly 1 candidate per media item selected                                    | Window Function       | `ROW_NUMBER() OVER (PARTITION BY media_type, media_id ...)`                                                | CORRECTED — DOCUMENTED |
| **15** | Identical-Content Idempotency   | Matching hash & model in active returns clean no-op                            | Code                  | Promotion checks active hash + model; cutover handles same-model                                           | CORRECTED — DOCUMENTED |
| **16** | Guarded Affected Rows           | Assert mutation row counts match expectations                                  | Code & SQL            | `GET DIAGNOSTICS ROW_COUNT`; Prisma affected-rows check                                                    | CORRECTED — DOCUMENTED |
| **17** | Post-Condition Integrity        | Exactly 1 active embedding per media; 100% coverage; coordination row verified | Code & SQL            | 10 post-cutover assertions before commit (incl. ROW_COUNT check + 7-field readback); count verify in promo | CORRECTED — DOCUMENTED |

### 4.2: Vector Integrity, Finiteness & L2 Unit Normalization via Inner Product

In pgvector, the `<#>` operator computes the **negative inner product**:
$$u <\#> v = -\sum_{i=1}^D u_i v_i$$
For a single vector $v$ dotted with itself:
$$-(v <\#> v) = \sum_{i=1}^D v_i^2 = \|v\|_2^2$$
Therefore, unit $L_2$ normalization $\|v\|_2 \in [0.999, 1.001]$ is equivalent to:
$$\|v\|_2^2 \in [0.999^2, 1.001^2] = [0.998001, 1.002001]$$
Furthermore, if any vector element contains `NaN` or positive/negative infinity, `-(v <#> v)` evaluates to `NaN` or `Infinity`, which evaluates to falsy under `BETWEEN 0.998001 AND 1.002001`. This allows PostgreSQL to validate finiteness and normalization directly in SQL without custom C extensions.

### 4.3: NULL-Safe Staleness Comparisons (IS DISTINCT FROM)

In SQL, comparing nullable fields with standard inequality (`!=`) evaluates to `NULL` (falsy) when either operand is `NULL`. For example, if a parent movie has a NULL metadata revision, `me.metadata_revision != m.metadata_revision` evaluates to NULL, incorrectly allowing a stale embedding to bypass validation.

Both cutover SQL and promotion queries strictly use **NULL-safe comparisons**:

```sql
me.metadata_revision IS DISTINCT FROM COALESCE(m.metadata_revision, t.metadata_revision)
```

### 4.4: Error Classification: Invalid Data vs. Coverage Deficits

Cutover executes pre-checks returning specific diagnostic errors before evaluating coverage:

1. **Invalid Vectors (`INVALID_CANDIDATE_VECTORS`):** Completed staged embeddings with corrupted dimensions, null vectors, or unnormalized norms.
2. **Stale Metadata (`STALE_METADATA_DETECTED`):** Completed staged embeddings with `embedding_stale = true` or revision mismatches.
3. **Coverage Deficit (`INSUFFICIENT_COVERAGE`):** Eligible titles lacking any valid candidate.

### 4.5: Promotion Safety & 10 Post-Cutover Assertions

During cutover execution, 10 explicit postconditions must be satisfied before commit:

1. **Promoted Count Match:** `v_promoted_cnt = v_cand_cnt`.
2. **Active Coverage Match:** `v_active_cnt = v_total_elig`.
3. **Zero Duplicate Active Embeddings:** Grouping by `(media_type, media_id)` yields 0 duplicates.
4. **Model Name Match:** All active embeddings belong to `v_pending_name`.
5. **Model Version Match:** All active embeddings belong to `v_pending_ver`.
6. **Vector Dimension Match:** All active embeddings have `dimensions = v_pending_dims` and `vector_dims = v_pending_dims`.
7. **Zero Orphaned Active Embeddings:** Every active embedding joins successfully to an existing `movies` or `tv_shows` row.
8. **Coordination Row Update Coverage:** `GET DIAGNOSTICS v_coord_rows = ROW_COUNT` immediately after the `UPDATE embedding_coordination ... WHERE id = 1` asserts `v_coord_rows = 1`. A result of 0 indicates the singleton row was absent; a result > 1 indicates a schema violation. Either triggers `COORDINATION_UPDATE_FAILED`.
9. **Coordination State Readback — Active Fields:** A `SELECT` of the coordination row immediately after the UPDATE verifies: `active_model_name = v_pending_name`, `active_model_version = v_pending_ver`, `active_dimensions = v_pending_dims`. Mismatch triggers `COORDINATION_STATE_INVALID`.
10. **Coordination State Readback — Cleared Pending Fields:** Same readback verifies: `pending_model_name IS NULL`, `pending_model_version IS NULL`, `pending_dimensions IS NULL`, `cutover_in_progress = FALSE`. Any non-NULL pending field or truthy `cutover_in_progress` triggers `COORDINATION_STATE_INVALID`.

---

## 5. C4 — Correct & Safe Watermark Migration and Reconciliation

### 5.1: Protected JSON-to-JSONB Conversion Boundaries

In PostgreSQL PL/pgSQL, directly casting an unvalidated text string to `jsonb` (`SELECT value::jsonb`) aborts the entire transaction if the text contains malformed syntax, truncation, or unexpected characters. In prior versions, extracting `system_configs.value` as `jsonb` directly in the query represented an unprotected crash path.

To guarantee zero transaction crashes, the conversion itself is strictly bounded:

1. **Raw String Extraction:** Raw `value` text is read into a `TEXT` variable without type casting.
2. **Pre-Cast Validation:** The text is checked for non-nullity and non-empty content (`v_raw IS NOT NULL AND trim(v_raw) != ''`).
3. **Protected Cast Block:** The string-to-jsonb cast is executed within a dedicated `BEGIN ... EXCEPTION WHEN OTHERS THEN v_val := NULL; END;` block.
4. **Top-Level Type Guard:** Even if syntactically valid JSON, if the root token is not a JSON object (`jsonb_typeof(v_val) != 'object'`), `v_val` is set to `NULL`.

```sql
SELECT value INTO v_legacy_raw FROM system_configs WHERE key = 'catalogue_sync_watermarks';
IF v_legacy_raw IS NOT NULL AND trim(v_legacy_raw) != '' THEN
    BEGIN
        v_legacy_val := v_legacy_raw::jsonb;
        IF jsonb_typeof(v_legacy_val) != 'object' THEN v_legacy_val := NULL; END IF;
    EXCEPTION WHEN OTHERS THEN v_legacy_val := NULL; END;
END IF;
```

This ensures that missing rows, NULL values, empty strings, invalid syntax, and top-level primitives (numbers, arrays, strings) safely resolve to `NULL` without aborting the migration.

### 5.2: Symmetrical and Bounded Date Validity Rules

Both legacy and destination timestamp fields must be evaluated against identical validity criteria:

1. **Format Validation:** Parsed independently using `::timestamptz` within isolated exception sub-blocks. Parse errors resolve to `NULL`.
2. **Historical Lower Bound:** Timestamps must be $\ge$ `'2000-01-01 00:00:00+00'::timestamptz`. TMDB was founded in late 2008, and digital change logs do not exist prior to year 2000. Timestamps preceding year 2000 indicate corrupted epoch offsets (e.g. Unix 0) and are sanitized to `NULL`.
3. **Future Upper Bound:** Timestamps must be $\le$ `clock_timestamp() + INTERVAL '5 minutes'`. A 5-minute tolerance accommodates slight NTP clock drift; any timestamp further in the future is treated as data corruption and sanitized to `NULL`.
4. **Fallback Behavior:**
   - If the legacy date is `NULL` (missing, unparseable, or out of bounds), it safely triggers the 14-day incremental lookback fallback:
     $$v_\text{fallback} = \text{clock\_timestamp}() - \text{INTERVAL '14 days'}$$
   - If a destination date is `NULL`, it is treated as uninitialized progress, allowing valid legacy state to take precedence.

### 5.3: Strict Pagination Consistency Rules

TMDB pagination semantics operate on 1-based page indexing (`page = 1, 2, ...`). In CineSphere, `lastProcessedPage = 0` indicates that a synchronization cycle has been initialized but no pages have yet been processed.

The migration enforces the following mathematical consistency constraints across both destination and reconciled state:

1. **Non-Negativity:** Negative values (`page < 0` or `total < 0`) are invalid and sanitized to `NULL`.
2. **Unstarted Progress:** When `totalPages = 0`, `lastProcessedPage` must be `0`. If `lastProcessedPage > 0` while `totalPages = 0`, it is reset to `0`.
3. **Upper Bound Enforcement:** In a valid synchronization run, `lastProcessedPage` cannot exceed `totalPages` (a client cannot process page 12 of a 10-page dataset). If `totalPages > 0` and `lastProcessedPage > totalPages`, the pagination state is corrupted; both fields are reset to `0, 0` to initiate a clean page iteration from the watermark timestamp.
4. **Partial Presence:**
   - If `lastProcessedPage` is present but `totalPages` is `NULL` or missing, the state cannot be validated; both reset to `0, 0`.
   - If `totalPages` is present but `lastProcessedPage` is `NULL` or missing, `lastProcessedPage` defaults to `0`.

### 5.4: Closed Status Allowlist

Status values are strictly validated against the closed set:
$$\text{Status} \in \{\text{'IN\_PROGRESS'}, \text{'COMPLETED'}, \text{'PENDING\_INITIAL\_SYNC'}\}$$
Any persisted value outside this allowlist (e.g., from an aborted experiment or invalid text edit) is sanitized to `NULL`, triggering default reconciliation based on timestamp and pagination progress.

### 5.5: Independent Field-by-Field Reconciliation & Precedence Rules

In the legacy schema (Phase 2/3), `catalogue_sync_watermarks` stored only a single `deltaSyncLastCheck` timestamp without media-specific pagination progress.

The migration reconciles each field independently so that an invalid date does not destroy valid pagination progress, and vice-versa:

1. **`lastChangeDate`:** `GREATEST(COALESCE(v_dest_date, '-infinity'::timestamptz), COALESCE(v_legacy_date, v_fallback))`
2. **`lastProcessedPage` & `totalPages`:**
   - If destination date is valid and `v_dest_date >= v_legacy_date`: retain destination pagination progress (subject to Section 5.3 consistency).
   - If legacy date is newer or destination is uninitialized: reset to `0, 0` to start a fresh iteration from the newer watermark timestamp.
3. **`status`:**
   - If destination is retained and its status is valid: preserve destination status.
   - If resetting pagination or legacy is newer: `'COMPLETED'` (if legacy date was valid) or `'PENDING_INITIAL_SYNC'` (if fallback was applied).

### 5.6: Safe 14-Day Incremental Fallback & PENDING_INITIAL_SYNC Semantics

> [!NOTE]
> **Operational Clarification of PENDING_INITIAL_SYNC:**  
> When watermark state is missing, NULL, or malformed, the migration sets:
>
> - `lastChangeDate = clock_timestamp() - INTERVAL '14 days'`
> - `lastProcessedPage = 0`
> - `totalPages = 0`
> - `status = 'PENDING_INITIAL_SYNC'`
>
> **Semantic Meaning:** This indicates that an **incremental 14-day lookback synchronization** is required—**NOT** a full catalogue scrape from year 1895. The TMDB `/changes` endpoint retains daily change logs for a maximum of 14 days. This fallback fetches all changes from the past two weeks, safely updating the catalogue without exceeding TMDB API rate limits or triggering multi-day full ingestion.

### 5.7: Atomic Execution & Non-Destructive Legacy Retention

The legacy key `catalogue_sync_watermarks` is deleted **if and only if** exact field-by-field readback verification confirms that destination keys `sync_watermark_movie` and `sync_watermark_tv` contain the exact expected reconciled values:

```sql
IF v_read_movie IS NULL OR v_read_tv IS NULL OR
   (v_read_movie->>'lastChangeDate')::timestamptz IS DISTINCT FROM (v_exp_movie->>'lastChangeDate')::timestamptz OR
   (v_read_tv->>'lastChangeDate')::timestamptz IS DISTINCT FROM (v_exp_tv->>'lastChangeDate')::timestamptz OR
   (v_read_movie->>'lastProcessedPage')::integer IS DISTINCT FROM (v_exp_movie->>'lastProcessedPage')::integer OR
   (v_read_tv->>'lastProcessedPage')::integer IS DISTINCT FROM (v_exp_tv->>'lastProcessedPage')::integer OR
   (v_read_movie->>'totalPages')::integer IS DISTINCT FROM (v_exp_movie->>'totalPages')::integer OR
   (v_read_tv->>'totalPages')::integer IS DISTINCT FROM (v_exp_tv->>'totalPages')::integer OR
   (v_read_movie->>'status') IS DISTINCT FROM (v_exp_movie->>'status') OR
   (v_read_tv->>'status') IS DISTINCT FROM (v_exp_tv->>'status') THEN
    RAISE EXCEPTION 'Watermark migration exact field-by-field verification failed. Legacy data preserved.';
END IF;

-- Delete legacy key ONLY upon verified readback
IF v_legacy_raw IS NOT NULL THEN
    DELETE FROM system_configs WHERE key = 'catalogue_sync_watermarks';
END IF;
```

---

## 6. C5 — Lease Fencing & Lock-Acquisition Expiration Semantics (Option A)

### 6.1: Authoritative Option A Expiration & Serialization Semantics

CineSphere formally defines and enforces **Option A Lease Fencing Semantics**:

> [!IMPORTANT]
> **Option A Definition & Guarantees:**
>
> 1. **Validation at Lock Acquisition:** When a protected write transaction commences, it locks the lease row using `SELECT ... FOR UPDATE` and validates that `expires_at >= clock_timestamp()`, `status = 'ACQUIRED'`, `owner_job_id = :jobId`, and `fencing_token = :token`.
> 2. **Lock Serialization Prevents Takeovers:** In PostgreSQL, a row lock held `FOR UPDATE` strictly conflicts with any concurrent `UPDATE` on the same tuple. Any competing worker attempting to acquire or renew the lease must issue an `UPDATE job_leases ...` which **blocks at the database engine level** until the active protected transaction commits or rolls back.
> 3. **Monotonic Token Rejection:** If a transaction pauses before acquiring the lock and its lease expires, a new worker acquires the lease under token $N+1$. When the old worker resumes, its token $N$ fails the query check (`fencing_token = :token`), aborting with `LEASE_NOT_HELD`.
> 4. **No Unsupported Commit-Instant Claim:** CineSphere does not claim that expiration is revalidated at the commit instant. Instead, row-lock mutual exclusion plus monotonic token fencing guarantees that no competing owner can modify data concurrently while the locked transaction executes.

### 6.2: Mandatory Lock-Acquisition Lease Fencing Protocol

Every lease-owned write operation must receive `p_owner_job_id UUID` and `p_fencing_token BIGINT` and verify them under Level 1 row lock:

```sql
SELECT fencing_token INTO v_fencing_token
FROM job_leases
WHERE lease_name = p_lease_name
  AND owner_job_id = p_owner_job_id::uuid
  AND fencing_token = p_fencing_token::bigint
  AND status = 'ACQUIRED'
  AND expires_at >= clock_timestamp()
FOR UPDATE;

IF NOT FOUND THEN
    RAISE EXCEPTION 'LEASE_NOT_HELD: Worker does not hold valid lease % (Job: %, Token: %)',
        p_lease_name, p_owner_job_id, p_fencing_token;
END IF;
```

### 6.3: Three Worker Pause Scenarios & Failure Analysis

- **Scenario 1 (Pause Before Acquiring Lease Lock):** Worker A pauses. Lease expires on database clock. Worker B acquires lease under token $N+1$. Worker A resumes and issues Level 1 lock query with token $N$. Query matches 0 rows; transaction immediately raises `LEASE_NOT_HELD` and aborts.
- **Scenario 2 (Pause After Acquiring and Holding Lease Lock):** Worker A holds `FOR UPDATE` on `job_leases`. Worker A experiences a pause (e.g. GC pause). While paused, Worker B attempts `UPDATE job_leases ...`. PostgreSQL forces Worker B to **block** waiting for the row lock. Worker A resumes and completes its mutations. When Worker A commits, its writes are durable. Worker B then unblocks, observes the updated lease, and acquires token $N+1$. No concurrent writes ever occurred.
- **Scenario 3 (Pause After Transaction Commit or Rollback):** Worker A's transaction is finished. All locks have been released. Worker B acquires the lease under token $N+1$. Any subsequent attempt by Worker A to perform writes under token $N$ will be rejected at lock acquisition.

### 6.4: Fenced Protected-Write Examples: Cutover & Checkpoint Persistence

_(Implemented in Section 10.3 for `execute_model_cutover` and Section 10.4 for `persist_sync_checkpoint`)._

---

## 7. C6 — Authoritative Universal Lock Hierarchy & Complete Writer Coverage

### 7.1: The 5-Level Global Lock Order

To eliminate lock inversion and structural deadlocks across all concurrent transactions, CineSphere enforces a strict 5-level Directed Acyclic Graph (DAG):

$$\text{Level 1 (Leases)} \implies \text{Level 2 (Coordination)} \implies \text{Level 3 (Media)} \implies \text{Level 4 (Embeddings)} \implies \text{Level 5 (Configs)}$$

1. **Level 1 — Leases (`job_leases`):** Exclusive lock via `SELECT ... FOR UPDATE` or `UPDATE job_leases`.
2. **Level 2 — Global Coordination (`embedding_coordination`):** Singleton row `id=1`. Shared lock (`FOR SHARE`) for normal writers; exclusive lock (`FOR UPDATE`) for cutover.
3. **Level 3 — Media Parents (`movies` / `tv_shows`):** Row lock via `SELECT ... FOR NO KEY UPDATE`. Multiple parent rows locked strictly in **ascending UUID order** (`ORDER BY id ASC`).
4. **Level 4 — Child Embeddings (`media_embeddings`):** Row lock via `SELECT ... FOR UPDATE`. Multiple child rows locked in **ascending UUID order**.
5. **Level 5 — Auxiliary Configurations (`system_configs`):** Row lock via `SELECT ... FOR UPDATE`. Multiple keys locked in **lexicographical order**.

### 7.2: Complete Writer/Trigger Lock-Order Matrix

| Initiating Operation                 | Participating Component                | Locks Acquired (In Chronological Order)                                                                                                           | Lock Modes                                                                                                      | Hierarchy Compliance Status | Concurrency Risk Mitigation                                                                                                                                                              |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TMDB Catalogue Sync**              | `TmdbSyncService`                      | 1. `job_leases` (L1)<br>2. `embedding_coordination` (L2)<br>3. `movies`/`tv_shows` (L3)<br>4. `media_embeddings` (L4)<br>5. `system_configs` (L5) | L1: `FOR UPDATE`<br>L2: `FOR SHARE`<br>L3: `FOR NO KEY UPDATE` (sorted)<br>L4: `FOR UPDATE`<br>L5: `FOR UPDATE` | Strictly Enforced           | Blocks if cutover holds L2 `FOR UPDATE`; retries on 40P01                                                                                                                                |
| **Model Cutover**                    | `execute_model_cutover`                | 1. `job_leases` (L1)<br>2. `embedding_coordination` (L2)<br>3. `media_embeddings` (L4)<br>4. `embedding_coordination` (L2)                        | L1: `FOR UPDATE`<br>L2: `FOR UPDATE`<br>L4: `FOR UPDATE` (archival/promo)<br>L2: `UPDATE` (commit active)       | Strictly Enforced           | Exclusively blocks all L2 `FOR SHARE` operations; statement timeout 30s                                                                                                                  |
| **Single-Title Promotion**           | `promoteStagedEmbedding`               | 1. `embedding_coordination` (L2)<br>2. Parent media (L3)<br>3. Staged embedding (L4)<br>4. Active embedding (L4)                                  | L2: `FOR SHARE`<br>L3: `FOR NO KEY UPDATE`<br>L4: `FOR UPDATE`<br>L4: `FOR UPDATE`                              | Strictly Enforced           | Blocks if cutover active; unblocks to check updated model                                                                                                                                |
| **Embedding Staging**                | `VectorRepository`                     | 1. `embedding_coordination` (L2)<br>2. Parent media (L3)<br>3. `media_embeddings` (L4)                                                            | L2: `FOR SHARE`<br>L3: `FOR NO KEY UPDATE`<br>L4: `INSERT` / `UPDATE`                                           | Strictly Enforced           | Fast write; blocks if cutover active                                                                                                                                                     |
| **Catalogue Media DML (App)**        | NestJS via `TmdbSyncService`           | 1. `job_leases` (L1)<br>2. `embedding_coordination` (L2)<br>3. `movies` or `tv_shows` (L3)                                                        | L1: `FOR UPDATE` (service)<br>L2: `FOR SHARE` (`BEFORE STMT` trg)<br>L3: `FOR NO KEY UPDATE` / row write        | Strictly Enforced           | NestJS holds L1 lease; database `BEFORE INSERT OR UPDATE OR DELETE` statement trigger acquires L2 `FOR SHARE` (fail-closed) before rows lock; `BEFORE UPDATE` row trigger bumps revision |
| **Catalogue Media DML (Direct SQL)** | Direct SQL / psql / Admin              | 1. `embedding_coordination` (L2)<br>2. `movies` or `tv_shows` (L3)                                                                                | L2: `FOR SHARE` (`BEFORE STMT` trg)<br>L3: `FOR NO KEY UPDATE` / row write                                      | Strictly Enforced           | Database `BEFORE INSERT OR UPDATE OR DELETE` statement trigger enforces L2 `FOR SHARE` before any media row is touched; blocks if cutover in progress; fails closed if row missing       |
| **Genre/Keyword Join Mut.**          | Triggers on `_GenreTo*`, `_KeywordTo*` | 1. `embedding_coordination` (L2)<br>2. Parent media (L3)                                                                                          | L2: `FOR SHARE` (`BEFORE STMT` trg)<br>L3: `FOR NO KEY UPDATE` (row lock)                                       | Strictly Enforced           | `BEFORE STATEMENT` trigger acquires L2 `FOR SHARE` before junction rows lock; `AFTER ROW` trigger acquires L3 row lock and updates parent                                                |
| **Credit Mutation**                  | Triggers on `person_credits`           | 1. `embedding_coordination` (L2)<br>2. Parent media (L3)                                                                                          | L2: `FOR SHARE`<br>L3: `FOR NO KEY UPDATE`                                                                      | Strictly Enforced           | Trigger acquires L2 `FOR SHARE` before updating L3 parent                                                                                                                                |
| **Person Name Update**               | Trigger on `persons`                   | 1. `embedding_coordination` (L2)<br>2. Parent movies (L3, sorted)<br>3. Parent TV shows (L3, sorted)                                              | L2: `FOR SHARE`<br>L3: `FOR NO KEY UPDATE` (sorted)<br>L3: `FOR NO KEY UPDATE` (sorted)                         | Strictly Enforced           | Sorts affected parent UUIDs ascending before acquiring L3 locks                                                                                                                          |

### 7.3: Database-Enforced Level 2 Coordination Protocol Across All Canonical Writers

#### 7.3.1: Resolution of the Scalar Metadata Coordination Gap via Statement Triggers

In prior revisions, scalar metadata updates (`UPDATE movies SET overview = ...` or `UPDATE tv_shows SET status = ...`) were identified as possessing a coordination gap because row-level `BEFORE UPDATE` triggers execute **after** PostgreSQL has already acquired row-level locks on the target media tuples. If a row-level trigger attempted to acquire Level 2 `embedding_coordination FOR SHARE`, this would represent a Level 3 -> Level 2 lock acquisition inversion relative to concurrent cutovers acquiring Level 2 `FOR UPDATE` before touching child embeddings.

To resolve this completely without depending on application-layer conventions, CineSphere enforces **database-level statement coordination** via PostgreSQL `BEFORE STATEMENT` triggers.

In PostgreSQL execution semantics:

1. `BEFORE STATEMENT` triggers fire **before any table tuple is scanned, qualified, or locked** by the execution engine.
2. By executing `PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;` inside a `BEFORE STATEMENT` trigger on `movies` and `tv_shows`, the transaction establishes its Level 2 shared lock **strictly prior to acquiring any Level 3 row-level locks** on `movies` or `tv_shows`.
3. **Fail-Closed Guarantee:** The trigger function explicitly checks `IF NOT FOUND THEN RAISE EXCEPTION ...;`. If the singleton row `id = 1` in `embedding_coordination` is missing or unseeded, the transaction immediately aborts with code `COORDINATION_LOCK_FAILED`. Under no circumstances can a protected catalogue write proceed silently uncoordinated.
4. **Coverage Across All Media DML (INSERT, UPDATE, DELETE):** To prevent catalogue mutations from racing with model cutover's total eligible title count ($v_\text{total\_elig}$), statement triggers on `movies` and `tv_shows` cover `INSERT OR UPDATE OR DELETE`. This ensures that new TMDB title ingestion cannot add eligible media while cutover is promoting candidates, avoiding count mismatches in post-cutover assertions.
5. Consequently, direct SQL DML (`psql`, administrative scripts, batch ETL) and NestJS application services follow the identical, database-enforced lock hierarchy:
   $$\text{L2 (Coordination FOR SHARE)} \implies \text{L3 (Media Row Lock)} \implies \text{Revision Increment / Mutation} \implies \text{Commit}$$

```sql
CREATE OR REPLACE FUNCTION trg_fn_acquire_coordination_share_lock()
RETURNS TRIGGER AS $$
BEGIN
    -- Acquire Level 2 singleton coordination lock in shared mode.
    -- Fails closed: verifies that the coordination row exists and is locked.
    -- If absent, raises an exception to prevent uncoordinated writes.
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Protected write blocked.';
    END IF;
    RETURN NULL;  -- Return value is ignored for statement-level triggers
END;
$$ LANGUAGE plpgsql;

-- Statement Coordination for All Media Catalogue Writers (INSERT / UPDATE / DELETE):
CREATE TRIGGER trg_movie_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "movies"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_tv_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "tv_shows"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- Statement Coordination for Junction and Credit Writers:
CREATE TRIGGER trg_genre_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_genre_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_person_credits_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_persons_acquire_coord_lock
BEFORE UPDATE OF name ON "persons"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();
```

#### 7.3.2: Complete Writer Locking Protocols

With statement-level coordination triggers active, every canonical writer conforms to the global lock hierarchy without exception:

1. **Normal Application Writer (`TmdbSyncService`):**
   - Step 1: Acquires L1 job lease (`job_leases` row `FOR UPDATE`).
   - Step 2: Executes DML (`UPDATE movies ...` or junction mutations). The `BEFORE STATEMENT` trigger automatically acquires L2 (`embedding_coordination id=1 FOR SHARE`).
   - Step 3: PostgreSQL acquires Level 3 row locks (`FOR NO KEY UPDATE`) on the modified media rows.
   - Step 4: The `BEFORE ROW` trigger evaluates `IS DISTINCT FROM` on canonical fields. If changed, bumps `NEW.metadata_revision := OLD.metadata_revision + 1` in-place.
   - Step 5: Transaction commits or rolls back, releasing L1, L2, and L3 locks simultaneously.

2. **Direct Administrative SQL Writer (e.g., `psql` manual edit):**
   - Step 1: Operator issues `UPDATE movies SET overview = '...' WHERE id = '...';`.
   - Step 2: The BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT trigger fires immediately, acquiring L2 (embedding_coordination id=1 FOR SHARE fail-closed). (L1 lease is an application-level scheduling construct and is not required for ad-hoc maintenance).
   - Step 3: PostgreSQL acquires Level 3 row lock on the target movie row.
   - Step 4: The `BEFORE ROW` trigger evaluates canonical changes and increments `metadata_revision`.
   - Step 5: Transaction commits, releasing L2 and L3 locks.

#### 7.3.3: Cutover Interaction and Conflict Dynamics

The Level 2 coordination lock is the universal synchronization barrier between catalogue writers and model cutovers:

| Scenario                                  | Initial State                                                           | Concurrent Request                             | Conflict & Resolution Semantics                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media / Ingestion Writer Starts First** | Media writer holds L2 `FOR SHARE` (via `INSERT`, `UPDATE`, or `DELETE`) | Cutover executes `SELECT ... FOR UPDATE` on L2 | Cutover **blocks at Level 2**. It cannot snapshot eligible media counts ($v_\text{total\_elig}$), archive active embeddings, or promote candidates until the media writer commits or rolls back. Ingested records or invalidated staged embeddings are cleanly resolved before cutover begins.                                         |
| **Cutover Starts First**                  | Cutover holds L2 `FOR UPDATE`                                           | Scalar writer executes `UPDATE movies ...`     | Scalar writer's `BEFORE STATEMENT` trigger requests L2 `FOR SHARE` and **blocks before any media row is touched**. The scalar writer acquires zero Level 3 row locks while waiting. When cutover commits and releases L2, the scalar writer unblocks, increments revision, and ensures future staging reflects the newly active model. |
| **Multiple Concurrent Scalar Writers**    | Writer A holds L2 `FOR SHARE`                                           | Writer B executes `UPDATE tv_shows ...`        | Shared locks (`FOR SHARE`) are **fully compatible**. Both writers execute concurrently. If they touch distinct rows, they proceed in parallel; if they modify the same row, PostgreSQL Level 3 row-level locks serialize them deterministically.                                                                                       |
| **Writer Fails or Rolls Back**            | Scalar writer acquired L2 `FOR SHARE` and errored                       | Transaction rollback                           | All row modifications and revision bumps revert; the L2 `FOR SHARE` lock is released immediately without leaving lingering locks.                                                                                                                                                                                                      |
| **Multi-Row Statements**                  | Writer executes `UPDATE movies SET ... WHERE status = 'RELEASED'`       | Statement touches $N$ rows                     | The `BEFORE STATEMENT` trigger fires **exactly once** for the entire statement, acquiring L2 `FOR SHARE` prior to the first tuple lock. All $N$ row locks are acquired subsequently at Level 3.                                                                                                                                        |

#### 7.3.4: Administrative Write Boundary & Transactional Maintenance Protocol

The database-level protocol protects all standard SQL operations issued through any interface (`psql`, pgAdmin, Prisma, NestJS). However, privileged administrative operations can deliberately bypass PostgreSQL triggers:

1. `SET session_replication_role = 'replica';` (disables user triggers in the session; common during bulk ETL loading or administrative data patches).
2. `ALTER TABLE movies DISABLE TRIGGER USER;` (or `DISABLE TRIGGER ALL`).
3. Direct `TRUNCATE` operations.

> [!CAUTION]
> **Trigger Disablement Does Not Inherit Coordination:**  
> Disabling triggers in a session completely deactivates statement-level and row-level triggers, meaning Level 2 coordination locks are **not automatically acquired**. Simply running `SELECT ... FROM job_leases WHERE status = 'ACQUIRED'` is insufficient, as that locks zero rows if no job is currently running, allowing a background worker to start immediately afterward.
>
> Therefore, any operation that disables triggers must execute inside an **exclusive transactional maintenance barrier** that holds both Level 1 and Level 2 locks continuously from before triggers are disabled until after they are restored and revisions are invalidated.

---

#### Connection Boundary & Session-Local Scope of Trigger Bypass

Administrative operators and orchestration scripts must adhere to strict PostgreSQL connection and session boundary semantics:

1. **Session-Local Scope of `session_replication_role`:**  
   In PostgreSQL, `session_replication_role` is a session-level configuration parameter (GUC). Setting `SET session_replication_role = 'replica'` (or `SET LOCAL session_replication_role = 'replica'`) disables triggers **exclusively for the active database connection/session** executing the command. All other database sessions in the cluster continue operating under `session_replication_role = 'origin'`, with all user triggers fully active.
2. **Transaction-Local Scope of Row and Coordination Locks:**  
   The exclusive Level 2 coordination row lock (`SELECT id FROM embedding_coordination WHERE id = 1 FOR UPDATE`) and the Level 1 lease locks (`UPDATE job_leases ...`) belong strictly to the single transaction on the specific database connection that acquired them. These locks are never shared across distinct client connections.
3. **Multi-Connection Tool Prohibition (`pg_restore -j`):**  
   Parallel administrative tools—specifically `pg_restore` running with concurrent worker jobs (`-j N` where $N > 1$)—launch independent worker database connections. These child connections **do not inherit** the parent session's `session_replication_role = 'replica'` setting or its active transaction locks:
   - If worker connections attempt to insert or mutate media rows, their statement triggers (`trg_movie_media_acquire_coord_lock` / `trg_tv_media_acquire_coord_lock`) fire and request Level 2 `embedding_coordination id = 1 FOR SHARE`.
   - Because the administrative transaction holds Level 2 `FOR UPDATE`, all worker connections **immediately block or deadlock** against the coordinator.
   - Consequently, **multi-connection parallel restores (`pg_restore -j > 1`) are strictly prohibited under this inline transactional maintenance protocol**.
4. **Permitted Operational Modes:**
   - **Single-Session Inline Protocol (Default):** The entire maintenance protocol must execute sequentially within a **single database connection and single transaction**. Administrative DML (such as `COPY`, data fixups, or single-threaded `pg_restore --jobs=1` piped into `psql`) executes on this exact connection while holding the Level 1 and Level 2 locks.
   - **Cold Maintenance Window (Multi-Connection Exception):** If high-volume data restoration genuinely requires parallel `pg_restore -j > 1`, the operator must take an **offline cold maintenance window**:
     a. Stop all application containers (`apps/web`, `apps/api`) and background workers to eliminate all application database traffic.
     b. Temporarily reconfigure PostgreSQL connection authorization (`pg_hba.conf`) or the connection pooler to reject all non-superuser connections.
     c. Execute multi-threaded `pg_restore -j N`.
     d. Upon completion, execute a single-session post-restore script to increment `metadata_revision` on all media rows, mark embeddings stale, and reset leases.
     e. Restore `pg_hba.conf` and restart application services.

---

#### Authoritative 6-Step Transactional Maintenance Protocol (Validated Executable PL/pgSQL)

The following script executes as a single, contiguous transaction on a single client connection. It utilizes PL/pgSQL `DO $$ ... $$` blocks to provide fully valid, executable procedural syntax for diagnostics and fail-closed checks while holding all row locks until final `COMMIT;`:

```sql
BEGIN;

-- ============================================================================
-- Step 1 & Step 2: Establish Level 1 Lease Barrier & Level 2 Exclusive Lock
-- Executed inside a PL/pgSQL DO block within the active transaction.
-- Row locks acquired here are held by the outer transaction until COMMIT or ROLLBACK.
-- ============================================================================
DO $$
DECLARE
    v_affected_leases INTEGER;
BEGIN
    -- Step 1: Establish Level 1 Lease Barrier
    -- Atomically set status to MAINTENANCE for all 3 required background job leases.
    -- Sentinel owner UUID and 2-hour TTL prevent workers from acquiring or renewing leases.
    UPDATE job_leases
    SET status = 'MAINTENANCE',
        owner_job_id = '00000000-0000-0000-0000-000000000000'::uuid,
        expires_at = clock_timestamp() + INTERVAL '2 hours',
        updated_at = clock_timestamp()
    WHERE lease_name IN ('model_cutover', 'sync_catalogue', 'embedding_generation');

    -- Fail-Closed Level 1 Verification: Require exactly 3 updated lease rows
    GET DIAGNOSTICS v_affected_leases = ROW_COUNT;
    IF v_affected_leases <> 3 THEN
        RAISE EXCEPTION 'MAINTENANCE_LEASE_ACQUISITION_FAILED: Expected exactly 3 job leases to be updated, but % were affected. All 3 leases (model_cutover, sync_catalogue, embedding_generation) must exist.', v_affected_leases;
    END IF;

    -- Step 2: Acquire Exclusive Level 2 Coordination Lock
    -- Establishes a database-wide serialization barrier against all normal writers
    -- (which request L2 FOR SHARE via statement triggers) and cutover jobs (FOR UPDATE).
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_ROW_MISSING: Singleton row id=1 missing from embedding_coordination. Maintenance barrier blocked.';
    END IF;
END $$;

-- ============================================================================
-- Step 3: Execute Trigger-Bypass Maintenance Operation (Session-Local)
--
-- Connection Boundary: Must execute on this exact same database connection/session.
-- SET LOCAL ensures the setting is transaction-scoped and automatically reverts on abort.
-- ============================================================================
SET LOCAL session_replication_role = 'replica';

-- [Execute administrative maintenance DML on this connection, e.g.:]
-- COPY movies FROM '/path/to/movies_dump.csv' WITH (FORMAT csv, HEADER true);
-- COPY tv_shows FROM '/path/to/tv_shows_dump.csv' WITH (FORMAT csv, HEADER true);

-- ============================================================================
-- Step 4: Restore Normal Trigger Enforcement
-- Must re-enable triggers before executing revision invalidation or verification
-- ============================================================================
SET LOCAL session_replication_role = 'origin';

-- ============================================================================
-- Step 5: Execute Mandatory Post-Maintenance Invalidation & Consistency Checks
-- Invalidate canonical revisions for all media items and stale embeddings
-- ============================================================================
DO $$
DECLARE
    v_null_rev_movies INTEGER;
    v_null_rev_tv INTEGER;
BEGIN
    -- Bump metadata revisions for all media items to force re-staging of embeddings:
    UPDATE movies
    SET metadata_revision = metadata_revision + 1,
        "updatedAt" = clock_timestamp();

    UPDATE tv_shows
    SET metadata_revision = metadata_revision + 1,
        "updatedAt" = clock_timestamp();

    -- Mark all existing staged and active embeddings as stale:
    UPDATE media_embeddings
    SET embedding_stale = true
    WHERE lifecycle_stage IN ('ACTIVE', 'STAGED');

    -- Integrity Assertion: Ensure no null metadata_revision values exist
    SELECT count(*) INTO v_null_rev_movies FROM movies WHERE metadata_revision IS NULL;
    IF v_null_rev_movies > 0 THEN
        RAISE EXCEPTION 'MAINTENANCE_VERIFICATION_FAILED: % movies have NULL metadata_revision.', v_null_rev_movies;
    END IF;

    SELECT count(*) INTO v_null_rev_tv FROM tv_shows WHERE metadata_revision IS NULL;
    IF v_null_rev_tv > 0 THEN
        RAISE EXCEPTION 'MAINTENANCE_VERIFICATION_FAILED: % tv_shows have NULL metadata_revision.', v_null_rev_tv;
    END IF;
END $$;

-- ============================================================================
-- Step 6: Release Maintenance Barrier & Commit
-- Atomically reset the 3 leases back to AVAILABLE, increment fencing tokens, and commit
-- ============================================================================
DO $$
DECLARE
    v_released_leases INTEGER;
BEGIN
    UPDATE job_leases
    SET status = 'AVAILABLE',
        owner_job_id = NULL,
        fencing_token = fencing_token + 1,
        expires_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE lease_name IN ('model_cutover', 'sync_catalogue', 'embedding_generation');

    -- Fail-Closed Level 1 Release Verification: Require exactly 3 reset lease rows
    GET DIAGNOSTICS v_released_leases = ROW_COUNT;
    IF v_released_leases <> 3 THEN
        RAISE EXCEPTION 'MAINTENANCE_LEASE_RELEASE_FAILED: Expected exactly 3 job leases to be reset to AVAILABLE, but % were affected. Transaction rolled back.', v_released_leases;
    END IF;
END $$;

COMMIT;
-- Committing releases the Level 2 coordination lock and Level 1 lease locks simultaneously.
-- Normal writers and background jobs unblock and resume with full trigger enforcement active.
```

---

#### Interaction with Normal Writers and Cutover During Maintenance

The transactional maintenance barrier guarantees complete serialization without race conditions:

1. **Normal Writer Attempts DML:**  
   When a background worker or direct SQL operator executes `INSERT`, `UPDATE`, or `DELETE` on `movies` or `tv_shows` (or junction mutations), its `BEFORE STATEMENT` trigger fires `trg_fn_acquire_coordination_share_lock()`, requesting Level 2 `embedding_coordination id = 1 FOR SHARE`. Because the maintenance transaction holds Level 2 `FOR UPDATE`, all writers **block at Level 2** before acquiring any row locks or reading any rows. When maintenance commits, they unblock and execute with full trigger enforcement active.
2. **Cutover Attempts Execution:**  
   When a model cutover worker executes `execute_model_cutover`:
   - Step 1 checks `job_leases WHERE lease_name = 'model_cutover' FOR UPDATE`. Because the lease status is `'MAINTENANCE'`, cutover immediately aborts with `LEASE_NOT_HELD`.
   - Even if scheduled without lease verification, cutover's Step 2 requests Level 2 `FOR UPDATE` and blocks behind the active maintenance transaction.
3. **Transaction Rollback Safety:**  
   If an exception occurs at any point—whether during Level 1 lease acquisition (`ROW_COUNT <> 3`), Level 2 coordination lock acquisition (`NOT FOUND`), maintenance DML execution, or Step 5 integrity checks—the entire PostgreSQL transaction is aborted. PostgreSQL automatically rolls back all table modifications, resets `session_replication_role` (due to `SET LOCAL`), and releases all acquired row locks on `job_leases` and `embedding_coordination`.

### 7.4: Multi-Parent Deterministic Ordering for Person Name Updates

When a person's name is updated in `persons`, multiple movies and TV shows may be affected simultaneously. To eliminate deadlock cycles, the trigger:

1. Acquires Level 2 `embedding_coordination id=1 FOR SHARE`.
2. Extracts distinct `movieId` and `tvShowId` lists sorted strictly in ascending order:
   ```sql
   SELECT ARRAY(SELECT DISTINCT "movieId" FROM person_credits WHERE "personId" = NEW.id AND "movieId" IS NOT NULL ORDER BY "movieId" ASC) INTO v_movie_ids;
   SELECT ARRAY(SELECT DISTINCT "tvShowId" FROM person_credits WHERE "personId" = NEW.id AND "tvShowId" IS NOT NULL ORDER BY "tvShowId" ASC) INTO v_tv_ids;
   ```
3. Acquires Level 3 locks on all affected rows in deterministic ascending order before applying updates.

### 7.5: Implicit Locks, Foreign-Key Checks & Cascades

- **Foreign-Key Checks:** Inserting into `media_embeddings` automatically acquires `FOR KEY SHARE` on the referenced `movies` or `tv_shows` row. `FOR KEY SHARE` is fully compatible with Level 3 `FOR NO KEY UPDATE` and Level 2 `FOR SHARE`, preventing lock inversion.
- **Cascades:** Cascading deletes on media items are blocked by `ON DELETE RESTRICT` whenever library entries reference the media item.

### 7.6: Deadlock Defense-in-Depth, Statement Timeouts & Backoff Retries

1. **Local Statement Timeouts:** Every interactive transaction sets `SET LOCAL statement_timeout = '15s'` (30s for cutover).
2. **Deadlock Timeout:** PostgreSQL `deadlock_timeout` is configured to `1000ms`.
3. **Application Retry with Exponential Backoff:** On error code `40P01` (deadlock detected), transactions retry up to 3 times with randomized backoff:
   $$T_\text{retry} = 50\text{ms} \times 2^\text{attempt} + \text{Uniform}(0, 100\text{ms})$$

---

## 8. C7 — Reproducible Scientific Benchmark & Model Evaluation Protocol

### 8.1: Pinned Model Identifiers & Candidate Architecture — Two-Model Active Protocol

> [!IMPORTANT]
> **Stage 5.0.4 Scope Correction (2026-11-26):** Model C (
vidia/Nemotron-3.5-Embed-1B-BF16) is **excluded by explicit project-owner decision** due to excessive resource requirements for this personal CPU-oriented benchmark. See Section 8.10 for the preserved historical feasibility analysis. All remaining sections 8.1–8.9 describe the two-model active protocol only.

The Stage 5.0 evaluation compares exactly two model candidates, both executed on CPU:

1. **Model A (Efficiency Baseline):** `sentence-transformers/all-MiniLM-L6-v2`
   - Revision Git Commit: `e4ce9877abf3edfe10b0d82785e83bdcb973e22e`
   - Parameters: ~22.7M (BERT-style 6-layer architecture)
   - Dimension: 384d (fixed)
   - Context Window: 256 tokens (truncated)
   - Encoding Paradigm: **Symmetric STS** (identical `model.encode(texts)` call for both probe and candidate item text).
   - Normalization: Unit $L_2$ normalized via cosine metric.

2. **Model B (Quality Baseline):** `sentence-transformers/all-mpnet-base-v2`
   - Revision Git Commit: `9a3225965f84d4ed3029da714acd769403388881`
   - Parameters: ~109M (MPNet 12-layer masked and permuted architecture)
   - Dimension: 768d (fixed)
   - Context Window: 384 tokens
   - Encoding Paradigm: **Symmetric STS** (identical `model.encode(texts)` call).
   - Normalization: Unit $L_2$ normalized via cosine metric.

3. ~~**Model C (Excluded — nvidia/Nemotron-3.5-Embed-1B-BF16):** Excluded by explicit
   project-owner decision due to excessive GPU resource requirements for this CPU-oriented
   personal benchmark. Full historical feasibility analysis and hardware preflight diagnostic
   preserved in Section 8.10.~~

### 8.2: Candidate Retrieval, Query Exclusion & Multi-Model Candidate Pooling

1. **Query Exclusion:** The query item itself is strictly excluded from candidate evaluation ($c \in \mathcal{C} \setminus \{q\}$).
2. **Multi-Model Blinded Pooling:** Top-20 nearest neighbours from Model A and Model B are pooled:
   $$\text{Pool}_q = \text{Top20}_A(q) \cup \text{Top20}_B(q)$$
   - Each pool contains between 20 and 40 unique candidates (maximum 40 when both model top-20 sets are fully disjoint).
   - The **full union pool** is annotated, not just the top-10 of each model, ensuring each candidate receives a grade before metric computation.
   - Candidates are assigned deterministic UUIDs (`uuid.uuid5`) and stripped of model provenance, raw similarity scores, and ranking position.
3. **Independent Ranking per Model:** Every model evaluates the identical common candidate pool $\text{Pool}_q$. Each model ranks candidates strictly by cosine similarity within its own embedding space:
   $$s_m(q, c) = \cos(\mathbf{v}_m(q), \mathbf{v}_m(c))$$
   - A model evaluates only its top-10 ranked candidates ($\text{Top10}_{m, q}$).
   - Raw similarity values are **never compared across models**.
4. **Deterministic Tie-Breaking:** Ties in similarity are broken deterministically by `media_type ASC, tmdb_id ASC`.

### 8.3: 4-Point Likert Scale Concrete Rubric & Fractional Aggregation

- **Grade 3 (Highly Relevant):** Direct thematic counterpart, franchise continuation, exact tone match.
- **Grade 2 (Substantively Relevant):** Deep thematic or structural overlap despite differing surface settings.
- **Grade 1 (Weakly Related):** Superficial overlap only with conflicting tone or narrative intent.
- **Grade 0 (Irrelevant / Noise):** Zero meaningful narrative, thematic, or tonal connection.

With a single human evaluator, the grade $g(c)$ is the evaluator's direct score (no averaging required). Candidates with $g \ge 1.5$ (i.e., Grade 2 or 3) are considered relevant.

> [!NOTE]
> **Single-Evaluator Protocol:** A second independent human evaluator is unavailable for this personal project. The final TD-08 report must explicitly disclose the absence of a second rater. An LLM (e.g., Gemini) may be used as a supplementary cross-check on a random 10% sample, clearly labelled as supplementary and not as an independent human rater.

### 8.4: Single-Evaluator Protocol & Limitation Disclosure

A second independent human evaluator is unavailable for this personal portfolio project. Human–human Linear-Weighted Cohen's Kappa ($\kappa_w$) is therefore **not computed or reported**.

> [!CAUTION]
> **Mandatory Limitation Disclosure:** The final TD-08 Recommendation Report must explicitly state that only a single human evaluator graded the annotation pool. This is a known limitation. Readers should interpret inter-model quality differences with appropriate caution.

- **LLM Supplementary Check (Optional):** A large language model (e.g., Gemini) may review a randomly selected 10% sample of the blinded annotation pool as a supplementary cross-check. Any LLM involvement must be clearly labelled as supplementary, not independent, in the TD-08 report.
- **Self-Adjudication:** Any candidate where the human evaluator is uncertain may be revisited after a 24-hour cooling-off period for a fresh blind re-grade.

### 8.5: Mathematical Formulations: Recall@10, Macro Pooled Recall@10, MRR@10 & ILD

The evaluation uses three mathematically explicit metrics computed over the single-evaluator relevance grade $g(c)$:

> [!NOTE]
> **Paired Bootstrap Requirement:** Confidence intervals for each metric must use **paired, stratified resampling** — the same set of probe indices is resampled for both models in every bootstrap iteration. Report per-model estimates, per-model 95% CIs, **and** the paired model-difference estimate with its own 95% CI.

#### 1. Recall@10 and Macro Pooled Recall@10

Measures the proportion of pooled relevant items retrieved by a model in its top-10 candidates:
$$\text{Recall@10}(q) = \frac{\big| \{ c \in \text{Top10}_{m, q} \mid g(c) \ge 1.5 \} \big|}{|\text{PooledRelevant}_q|}$$
$$\text{MacroPooledRecall@10}_m = \frac{1}{|Q_\text{eval}|} \sum_{q \in Q_\text{eval}} \text{Recall@10}_m(q)$$
where $\text{PooledRelevant}_q = \{ c \in \text{Pool}_q \mid g(c) \ge 1.5 \}$. If $|\text{PooledRelevant}_q| = 0$, the probe is excluded from the recall denominator to avoid division by zero.

#### 2. Mean Reciprocal Rank at 10 (MRR@10)

Because retrieval candidate evaluation is truncated to the top-10 ranked results, the metric is formally designated as **MRR@10** (not unqualified MRR):

- **Relevance Threshold (Single Evaluator):** A candidate $c$ is defined as relevant if and only if its single-evaluator grade meets the threshold: $g(c) \ge 1.5$ (Grade 2 or 3). Grade 1 (Weakly Related) does not meet the threshold.
- **First Relevant Rank ($\operatorname{rank}\_q$):** Let $(c_1, c_2, \dots, c_{10})$ be the model's top-10 candidates ordered by descending cosine similarity. The rank of the first relevant candidate within the top-10 is:
  $$\operatorname{rank}_q = \min \big( \{ k \in \{1, 2, \dots, 10\} \mid g(c_k) \ge 1.5 \} \cup \{ \infty \} \big)$$
- **Reciprocal Rank ($RR@10(q)$):**
  $$RR@10(q) = \begin{cases} \frac{1}{\operatorname{rank}_q}, & \text{if } \operatorname{rank}_q \le 10 \\[6pt] 0, & \text{if } \operatorname{rank}_q = \infty \text{ (no relevant candidate in top-10)} \end{cases}$$
- **Mean Reciprocal Rank at 10 ($MRR@10_m$):** Computed across the full evaluation universe $Q_\text{eval}$ ($|Q_\text{eval}| = 50$):
  $$MRR@10_m = \frac{1}{|Q_\text{eval}|} \sum_{q \in Q_\text{eval}} RR@10_m(q)$$
- **Candidate Pool Governance:** Each model scores the identical blinded candidate pool $\text{Pool}_q$ using its own vector space. Probes where a model places zero relevant candidates in its top-10 are assigned $RR@10_m(q) = 0$.

#### 3. Intra-List Diversity (ILD)

Measures the semantic dispersion among the top-10 recommended candidates to detect over-clustering and echo-chamber collapse:
$$\text{ILD}(\text{Top10}_m) = \frac{2}{K(K-1)} \sum_{i=1}^{K-1} \sum_{j=i+1}^K \big( 1 - \cos(\mathbf{v}_{m, i}, \mathbf{v}_{m, j}) \big), \quad K=10$$
where $\mathbf{v}_{m, i}$ is the unit-normalized embedding of candidate $c_i$ under model $m$.

### 8.6: Stratified Bootstrap Resampling & 95% Confidence Intervals

Bootstrap resampling is **stratified**:

1. For each of the 5 strata, resample $N_s$ probes with replacement.
2. Combine into a resampled set of 50 probes and compute metric $\theta^*$.
3. Repeat for $B = 10{,}000$ iterations.
4. Report empirical 95% Confidence Interval: $[\text{Quantile}_{0.025}(\theta^\*), \text{Quantile}_{0.975}(\theta^*)]$.

### 8.7: Hardware Profiling Methodology: Warmup, Latency & Thread Pinning

- **Warmup:** 5 warmup batches of 32 items.
- **Repetitions:** 10 independent iterations over the 50 probes.
- **Latency:** Monotonic timer `time.perf_counter_ns()` reporting p50, p95, p99 per query in ms.
- **Throughput:** Items/sec across 1,000 items with batch size $B=32$ (CPU; Models A & B).
- **Thread Pinning:** Single-socket CPU execution with `torch.set_num_threads(4)` for baseline models.
- **Memory Consumption:** Peak Resident Set Size (RSS in MB) via `psutil`. GPU VRAM monitoring is not applicable (CPU-only benchmark).

#### 8.7.1: Device-Specific Performance Reporting & Cross-Hardware Boundaries

To maintain rigorous scientific validity, the evaluation methodology enforces strict separation between quality and performance comparisons:

1. **Retrieval Quality Metrics (Recall@10, MRR@10, ILD):** Directly comparable across all candidate models because all models evaluate against the **identical common candidate pool** $\text{Pool}_q$ using adjudicated human consensus relevance labels.
2. **Computational Performance Metrics (Throughput & Latency):** Both models execute on the same CPU device (Intel Core i5-13420H), so relative throughput and latency comparisons are valid within this benchmark. Reports must document:
   - Device type (`CPU`)
   - Execution precision (`FP32`)
   - Batch size ($B=32$)
   - Context length ($L$)
   - Execution environment (`.venv-baseline` or `[benchmark]` optional group)
3. **Intra-CPU Comparisons Only:** Performance comparison is restricted to Model A vs. Model B on the same CPU. No GPU comparisons are made in this benchmark.

### 8.8: Three Tiers of Reproducibility & Environment Manifest

To maintain scientific rigor without claiming unattainable bit-for-bit exactness across heterogeneous hardware:

1. **Tier 1 (Computational Reproducibility):** Pinned dependencies, seeds, and model revisions guarantee statistically indistinguishable embeddings across identical CPU architectures (subject to minor sub-threshold BLAS/AVX floating-point rounding differences).
2. **Tier 2 (Human Evaluation Reproducibility):** Blinded candidate pooling, explicit 4-point rubric, single-evaluator grading with explicit limitation disclosure in the TD-08 report. See Section 8.4 for the single-evaluator protocol.
3. **Tier 3 (Cross-Hardware Comparability):** Relative ranking between Model A and Model B, MRR, and Pooled Recall@10 trends are robust across CPU architectures even if absolute inference latencies vary.

**Isolated Environment Manifests:**

To ensure complete reproducibility without dependency conflicts, Models A and B and Model C run in strictly isolated virtual environments:

1. **Environment Tier 1 (Baseline Models A & B — CPU Pinned):**
   - Path: `ml/benchmark/.venv-baseline`
   - Python: `3.11+`
   - PyTorch: `2.2.2` (CPU build with AVX2 support)
   - Sentence Transformers: `2.5.1`
   - Transformers: `4.38.2`
   - Tokenizers: `0.15.2`
   - NumPy: `1.26.4`
   - Scikit-Learn: `1.4.1.post1`
   - Random Seed: `42` (`torch.manual_seed(42)`, `numpy.random.seed(42)`)
   - Deterministic Flags: `torch.use_deterministic_algorithms(True)`

~~2. **Environment Tier 2 (Frontier Candidate Model C — GPU/CUDA Pinned):** Removed. Model C is excluded from the benchmark. See Section 8.10 for the preserved historical environment specification.~~

### 8.9: Enumerated 50-Probe Stratified Evaluation Universe (PB-01 to PB-50)

The evaluation universe comprises exactly 50 probes distributed across five strata (10 probes each). Each probe is selected based on documented cinematic/televisual taxonomy criteria to evaluate specific embedding representation properties:

| Probe ID  | Type  | TMDB ID | Canonical Media Title                             | Stratum       | Selection Rationale                                                                            | Specific Evaluation Notes                                                                     |
| :-------- | :---- | ------: | :------------------------------------------------ | :------------ | :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| **PB-01** | Movie |   27205 | Inception                                         | Mainstream    | Complex multi-layered narrative, high-budget sci-fi heist, Christopher Nolan auteur direction. | Tests ability to retrieve cerebral, structure-heavy sci-fi over generic action/heist films.   |
| **PB-02** | Movie |     155 | The Dark Knight                                   | Mainstream    | Neo-noir crime drama within a comic book franchise, dense psychological antagonism.            | Tests tone and psychological conflict matching vs. superficial superhero action.              |
| **PB-03** | Movie |  157336 | Interstellar                                      | Mainstream    | Hard sci-fi, space exploration, intense familial emotional grief, relativistic physics.        | Tests scientific exploration themes intertwined with intimate human relationship dynamics.    |
| **PB-04** | Movie |     603 | The Matrix                                        | Mainstream    | Cyberpunk philosophical action, dystopian reality simulation, martial arts fusion.             | Tests philosophical sci-fi and simulated reality matching vs. standard gunplay/action.        |
| **PB-05** | Movie |     329 | Jurassic Park                                     | Mainstream    | Sci-fi adventure, creature horror, hubris of technological cloning, suspense thriller.         | Tests bio-ethical thriller and survival suspense matching vs. fantasy creature features.      |
| **PB-06** | Movie |      98 | Gladiator                                         | Mainstream    | Roman antiquity epic, revenge tragedy, honor and political betrayal.                           | Tests historical revenge and swords-and-sandals epic matching vs. fantasy warfare.            |
| **PB-07** | Movie |     120 | The Lord of the Rings: The Fellowship of the Ring | Mainstream    | High fantasy, mythic quest, extensive ensemble lore, Tolkien worldbuilding.                    | Tests mythic quest and high fantasy narrative semantics vs. modern urban fantasy.             |
| **PB-08** | Movie |  299536 | Avengers: Infinity War                            | Mainstream    | Large-scale ensemble crossover, apocalyptic stakes, cosmic villain perspective.                | Tests ensemble narrative and tragic cliffhanger resolution matching.                          |
| **PB-09** | Movie |   76341 | Mad Max: Fury Road                                | Mainstream    | Minimalist dialogue, relentless visual kinetic action, feminist wasteland survival.            | Tests kinetic pacing, vehicular combat, and post-apocalyptic narrative tone.                  |
| **PB-10** | Movie |  361743 | Top Gun: Maverick                                 | Mainstream    | Aviation procedural, legacy sequel, mentorship, high-g aerial combat.                          | Tests legacy sequel and military aviation drama matching.                                     |
| **PB-11** | Movie |  496243 | Parasite                                          | International | South Korea: Social class satire, home infiltration, dark thriller, tragicomic shift.          | Tests dark socioeconomic satire and architectural suspense in non-English cinema.             |
| **PB-12** | Movie |     129 | Spirited Away                                     | International | Japan (Anime): Mythological folklore, coming-of-age, surreal bathhouse spirits.                | Tests Shinto animism, liminal fantasy, and Studio Ghibli narrative resonance.                 |
| **PB-13** | Movie |     598 | City of God                                       | International | Brazil: Favela crime chronicle, multi-decade drug turf warfare, hyperkinetic editing.          | Tests realistic urban poverty crime docudrama matching across languages.                      |
| **PB-14** | Movie |    1417 | Pan's Labyrinth                                   | International | Spain: Post-Civil War fascist cruelty juxtaposed with dark subterranean fairy tale.            | Tests historical trauma intertwined with dark mythological escapism.                          |
| **PB-15** | Movie |     194 | Amélie                                            | International | France: Whimsical romantic comedy, poetic urban Paris, quirky observational vignettes.         | Tests stylized whimsical romanticism and idiosyncratic comedic tone.                          |
| **PB-16** | Movie |     582 | The Lives of Others                               | International | Germany: East German Stasi surveillance, moral redemption, artistic empathy.                   | Tests cold war espionage, voyeuristic intimacy, and moral awakening themes.                   |
| **PB-17** | Movie |     346 | Seven Samurai                                     | International | Japan: Feudal period jidaigeki, rural defense, tactical ensemble recruitment.                  | Tests foundational archetypal team recruitment and sacrificial honor narratives.              |
| **PB-18** | Movie |   11216 | Cinema Paradiso                                   | International | Italy: Nostalgic ode to film projection, childhood mentorship, lost love drama.                | Tests meta-cinematic romantic nostalgia and small-town Italian cultural identity.             |
| **PB-19** | Movie |     670 | Oldboy                                            | International | South Korea: Extreme vengeance tragedy, psychological captivity, Greek incest motif.           | Tests extreme psychological horror, vengeance, and transgressive shock drama.                 |
| **PB-20** | Movie |  531428 | Portrait of a Lady on Fire                        | International | France: Quiet 18th-century female romance, artistic gaze, solitary Brittany coast.             | Tests restrained historical queer romance, gaze dynamics, and sparse dialogue.                |
| **PB-21** | Movie |  244786 | Whiplash                                          | Indie         | Auteur jazz conservatory chamber drama, abusive pedagogical obsession, psychological duel.     | Tests intense psychological pressure and toxic artistic perfectionism.                        |
| **PB-22** | Movie |  152601 | Her                                               | Indie         | Near-future melancholic sci-fi romance, AI consciousness connection, modern loneliness.        | Tests soft philosophical sci-fi and existential romantic alienation.                          |
| **PB-23** | Movie |  120467 | The Grand Budapest Hotel                          | Indie         | Wes Anderson aesthetic diorama, whimsical farce, interwar nostalgic melancholia.               | Tests highly stylized geometric framing, deadpan comedy, and elegiac nostalgia.               |
| **PB-24** | Movie |  376867 | Moonlight                                         | Indie         | Triptych coming-of-age drama, queer Black identity, vulnerability under masculine expectation. | Tests poetic naturalistic drama, identity struggle, and lyrical pacing.                       |
| **PB-25** | Movie |   64690 | Drive                                             | Indie         | Minimalist neo-noir, laconic stunt driver, violent synthwave Los Angeles underworld.           | Tests stylized silence, synthwave mood, and sudden explosive violence matching.               |
| **PB-26** | Movie |  503919 | The Lighthouse                                    | Indie         | 1890s New England maritime folklore, psychological isolation, descent into madness.            | Tests folk horror, psychological isolation, and literary archaic prose.                       |
| **PB-27** | Movie |  334543 | Manchester by the Sea                             | Indie         | Unresolved tragic grief, Massachusetts coastal realism, guilt-ridden parenting trauma.         | Tests raw emotional realism and unhealed trauma over dramatic catharsis tropes.               |
| **PB-28** | Movie |  264660 | Ex Machina                                        | Indie         | Isolated mountain compound chamber piece, Turing test manipulation, AI deceptive intent.       | Tests intellectual chamber drama, claustrophobia, and AI ethics deception.                    |
| **PB-29** | Movie |      38 | Eternal Sunshine of the Spotless Mind             | Indie         | Surreal romantic memory erasure, non-linear heartbreak, Charlie Kaufman script.                | Tests non-linear memory manipulation, surrealism, and tragicomic relationship deconstruction. |
| **PB-30** | Movie |  391713 | Lady Bird                                         | Indie         | Sacramento coming-of-age, tumultuous mother-daughter bond, Catholic school transition.         | Tests observational teenage domestic realism and maternal conflict dynamics.                  |
| **PB-31** | TV    |    1396 | Breaking Bad                                      | Serialized TV | High school chemistry teacher cancer diagnosis, meth empire moral descent, crime tragedy.      | Tests serialized moral corruption arcs and high-stakes criminal tradecraft.                   |
| **PB-32** | TV    |   76331 | Succession                                        | Serialized TV | Media dynasty corporate warfare, Shakespearean sibling cruelty, emotional abuse satire.        | Tests corporate boardroom Machiavellian satire and dysfunctional wealth trauma.               |
| **PB-33** | TV    |   60059 | Better Call Saul                                  | Serialized TV | Legal procedural tragedy, moral erosion of a public defender, con-artist relationship.         | Tests tragic character degeneration, legal procedural depth, and meticulous pacing.           |
| **PB-34** | TV    |   70523 | Dark                                              | Serialized TV | Small German town missing children, multi-generational time loops, existential paradox.        | Tests complex non-linear time travel family webs and German-language sci-fi gloom.            |
| **PB-35** | TV    |    1398 | The Sopranos                                      | Serialized TV | New Jersey mob boss in psychotherapy, suburban existential dread, panic attacks.               | Tests psychological mafia deconstruction and mundane suburban neurosis.                       |
| **PB-36** | TV    |   95396 | Severance                                         | Serialized TV | Dystopian corporate brain bifurcation, workplace alienation, surreal mystery box.              | Tests dystopian corporate satire, identity fracture, and retro-futuristic thriller tropes.    |
| **PB-37** | TV    |   87108 | Chernobyl                                         | Serialized TV | Soviet nuclear disaster miniseries, bureaucratic deceit, radiation cleanup heroism.            | Tests historical industrial catastrophe, Soviet institutional failure, and docudrama tension. |
| **PB-38** | TV    |   60622 | Fargo                                             | Serialized TV | Midwestern polite noir anthology, quirky black comedy, banal evil vs. moral decency.           | Tests Coen-esque regional black comedy and violent suburban criminal blunders.                |
| **PB-39** | TV    |   67070 | Fleabag                                           | Serialized TV | Meta-fourth-wall breaking London dark comedy, hypersexual deflection, unspoken grief.          | Tests direct address comedy masking deep guilt, grief, and intimate confession.               |
| **PB-40** | TV    |    3297 | The Wire                                          | Serialized TV | Baltimore institutional sociology, police wiretaps, school system decay, drug trade web.       | Tests institutional sociopolitical realism and non-judgmental macro-systemic decay.           |
| **PB-41** | Movie |   14337 | Primer                                            | Stress Cases  | Ultra-complex non-linear time machine mechanics, jargon-heavy dialogue, micro-budget.          | Tests temporal mechanics comprehension vs. superficial sci-fi action confusion.               |
| **PB-42** | Movie |      62 | 2001: A Space Odyssey                             | Stress Cases  | Sparse dialogue, meditative visual pacing, philosophical AI and cosmic evolution mystery.      | Tests abstract non-verbal narrative mapping vs. standard sci-fi pulp action.                  |
| **PB-43** | Movie |  467244 | The Zone of Interest                              | Stress Cases  | Domestic mundane family life adjacent to Auschwitz wall, acoustic off-screen horror.           | Tests severe tonal dissonance (idyllic domesticity vs. genocide ambient audio).               |
| **PB-44** | Movie |  545611 | Everything Everywhere All at Once                 | Stress Cases  | Absurdist kung fu multiverse collision, hot dog fingers, existential tax audit drama.          | Tests multi-genre collision (absurd comedy + martial arts + immigrant family trauma).         |
| **PB-45** | TV    |    1920 | Twin Peaks: The Return                            | Stress Cases  | Avant-garde surrealist television, non-sequitur logic, terrifying cosmic dreamscapes.          | Tests David Lynch surrealism vs. conventional murder mystery police procedurals.              |
| **PB-46** | Movie |   85350 | Samsara                                           | Stress Cases  | Non-verbal visual essay, global humanity and industrial montage, zero dialogue.                | Tests semantic clustering without narrative plot lines, cast anchors, or dialogue text.       |
| **PB-47** | Movie |  220289 | Coherence                                         | Stress Cases  | Dinner party comet pass, branching quantum decoherence, improvised micro-budget.               | Tests quantum parallel reality chamber piece vs. conventional horror/slasher.                 |
| **PB-48** | TV    |   61222 | BoJack Horseman                                   | Stress Cases  | Anthropomorphic animated animal satire evolving into severe existential clinical depression.   | Tests cartoon animation format vs. heavy psychological addiction/suicide drama.               |
| **PB-49** | Movie |   97370 | Under the Skin                                    | Stress Cases  | Alien predatory detachment in Glasgow, sensory Glasgow sound design, minimal speech.           | Tests alien body horror and sensory dread vs. conventional alien invasion tropes.             |
| **PB-50** | Movie |   10494 | Perfect Blue                                      | Stress Cases  | Psychological thriller anime, pop idol stalker, disorienting reality-fiction blurring.         | Tests animated medium vs. intense psychological Hitchcockian adult thriller themes.           |

> [!IMPORTANT]
> **Candidate Probe Status & Fixture Panning Requirement:**  
> These 50 probes constitute the authoritative, candidate benchmark probe universe. Because the pinned catalogue snapshot `ml/benchmark/fixtures/catalogue_snapshot_v1.jsonl` does not yet exist in the repository, this table establishes the exact selection specification, media identifiers, and stratum distribution. During the Stage 5.0 pre-evaluation fixture generation (Section 8.11), each probe will be verified for presence in the snapshot and frozen with its exact SHA-256 canonical string.

---

### 8.10: Technical Feasibility Assessment & Hardware Preflight: NVIDIA Nemotron-3.5-Embed-1B

#### 8.10.1: Comparative Architectural & Hardware Profile

To evaluate `nvidia/Nemotron-3.5-Embed-1B-BF16` alongside `all-MiniLM-L6-v2` and `all-mpnet-base-v2`, the model was assessed against the target host specifications:

- **Host CPU:** Intel Core i5-13420H (8 cores: 4 Performance + 4 Efficient, 12 threads, up to 4.6 GHz)
- **Host System RAM:** 16 GB DDR5
- **Host GPU:** NVIDIA GeForce RTX 3050 Laptop GPU (4 GB / 6 GB VRAM configuration — evaluated at 6 GB VRAM)
- **GPU Architecture:** Ampere (Compute Capability 8.6)

| Architectural Dimension            | Model A: `all-MiniLM-L6-v2` | Model B: `all-mpnet-base-v2` | Model C: `Nemotron-3.5-Embed-1B-BF16`          | Model C-Quant: `Nemotron-1B-NVFP4`    |
| :--------------------------------- | :-------------------------- | :--------------------------- | :--------------------------------------------- | :------------------------------------ |
| **Backbone Architecture**          | BERT (6-layer, 12-head)     | MPNet (12-layer, 12-head)    | Nemotron-3.5 (Transformer + Vision projection) | Quantized NVFP4 (compressed-tensors)  |
| **Total Parameters**               | 22.7M                       | 109.3M                       | ~1.14B (LLM) / ~1.55B (Total)                  | ~1.55B (4-bit compressed)             |
| **Output Vector Dimension**        | 384d                        | 768d                         | 2048d (native) / 1024d / 512d (MRL)            | 2048d (native) / 1024d / 512d (MRL)   |
| **Context Window (Tokens)**        | 256                         | 384                          | 32,768 (eval at 512–1024)                      | 32,768                                |
| **Encoding Paradigm**              | Symmetric STS               | Symmetric STS                | Asymmetric Retrieval (`query` vs `passage`)    | Asymmetric Retrieval                  |
| **Weight Memory (Disk / RAM)**     | ~90 MB                      | ~420 MB                      | ~3.1 GB (BF16)                                 | ~1.1 GB (NVFP4)                       |
| **Active VRAM Footprint ($B=1$)**  | ~0.4 GB (CUDA overhead)     | ~0.8 GB                      | ~3.8 GB – 4.5 GB (weights + context)           | **Incompatible with Ampere (CC 8.6)** |
| **Active VRAM Footprint ($B=16$)** | ~0.6 GB                     | ~1.2 GB                      | ~5.8 GB – 6.8 GB (**OOM on 6 GB**)             | N/A                                   |
| **Inference Runtime**              | CPU / CUDA                  | CPU / CUDA                   | CUDA (PyTorch 2.4+ / BF16)                     | Blackwell TensorRT-LLM                |
| **Windows Native Support**         | ✅ Fully supported          | ✅ Fully supported           | ⚠️ Restricted (SDPA fallback; no FA2)          | ❌ Unsupported                        |
| **WSL2 / Linux Support**           | ✅ Fully supported          | ✅ Fully supported           | ✅ Supported (with FlashAttention-2)           | ❌ Unsupported on RTX 3050            |
| **CPU Fallback Feasibility**       | ✅ Excellent (~12 ms/doc)   | ✅ Good (~65 ms/doc)         | ❌ Impractical (~1,800 ms/doc; 60m for 2k)     | ❌ Unsupported                        |
| **License**                        | Apache 2.0                  | Apache 2.0                   | OpenMDW-1.1 (Commercial permitted)             | OpenMDW-1.1                           |

#### 8.10.2: Detailed VRAM Budget & Hardware Verdict for RTX 3050 (6 GB)

1. **Operating System & Display Window Manager (DWM) Overhead:** On Windows 11 with external displays and desktop rendering, the OS reserves between 0.6 GB and 1.2 GB of VRAM. Net available VRAM on a 6 GB card is **4.8 GB to 5.4 GB**.
2. **Model Weight Footprint:** In BF16 precision (2 bytes per parameter), loading ~1.55B parameters requires $pprox 3.10 ext{ GB}$ of dedicated VRAM.
3. **CUDA Context & PyTorch Allocator Overhead:** Initializing the PyTorch CUDA runtime and caching allocator consumes $pprox 0.40 ext{ GB}$.
4. **Activation Memory Budget:**
   - At sequence length $L = 512$ and batch size $B = 1$: Activation memory requires $pprox 0.35 ext{ GB}$ (Total allocated VRAM $pprox 3.85 ext{ GB}$). Headroom is $pprox 1.0 ext{ GB}$.
   - At batch size $B = 4$: Activation memory expands to $pprox 1.4 ext{ GB}$ (Total $pprox 4.9 ext{ GB}$). Highly vulnerable to Windows DWM allocation spikes.
   - At batch size $B \ge 8$: Exceeds 5.8 GB, triggering immediate `torch.cuda.OutOfMemoryError`.
5. **FlashAttention-2 Constraint:** Official Nemotron documentation specifies FlashAttention-2 (`attn_implementation="flash_attention_2"`). FlashAttention-2 is not natively supported on Windows; attempting to compile it requires MSVC toolchains and specific Ninja flags. Under Windows native execution, Nemotron must fall back to PyTorch's native Scaled Dot Product Attention (`attn_implementation="sdpa"`), which marginally increases activation memory. For FlashAttention-2, WSL2 (Ubuntu 22.04+) is mandatory.
6. **NVFP4 Hardware Incompatibility:** `Nemotron-3.5-Embed-1B-NVFP4` requires NVIDIA Blackwell architecture with native 4-bit floating point tensor cores. The RTX 3050 (Ampere architecture, Compute Capability 8.6) does not possess FP4 tensor hardware. This variant is completely unusable for local GPU inference on this PC.
7. **CPU Fallback Analysis:** Loading Nemotron on CPU via PyTorch AVX2 consumes ~3.5 GB of system RAM (out of 16 GB), but single-item inference latency on an i5-13420H averages 1.5 to 2.5 seconds per document. Generating embeddings for a 2,000-item catalogue snapshot on CPU would require approximately **50 to 80 minutes** of sustained 100% CPU utilization, compared to **25 seconds** for MiniLM. CPU fallback is therefore classified as scientifically possible but operationally impractical.

> [!CAUTION]
> **Hardware Feasibility Classification for Nemotron-3.5-Embed-1B on RTX 3050 (6 GB):**  
> **BORDERLINE / REQUIRES PREFLIGHT (STRICT BATCH-SIZE-1 INFERENCE ONLY; NVFP4 NOT USABLE ON AMPERE; CPU FALLBACK IMPRACTICAL)**
>
> **Explicit Evidence & Feasibility Boundaries:**
>
> 1. **Verified Hardware Facts (Host System):**
>    - Host CPU: Intel Core i5-13420H (8 cores: 4P+4E, 12 threads).
>    - Host System RAM: 16 GB DDR5.
>    - Host GPU: NVIDIA GeForce RTX 3050 Laptop GPU (6.00 GB dedicated VRAM, Ampere architecture, Compute Capability 8.6).
>    - Architectural Limitation: The RTX 3050 does **not** possess FP4 Tensor Cores (exclusive to Blackwell CC 10.0+). The `Nemotron-3.5-Embed-1B-NVFP4` checkpoint is verified as hardware-incompatible and disqualified from local evaluation.
> 2. **Estimated Requirements (Theoretical & Published):**
>    - Model Weights: ~3.10 GB in BF16 precision.
>    - CUDA Context & Framework Base: ~0.40 GB.
>    - Windows Desktop Window Manager (DWM) Overhead: ~0.60 GB – 1.20 GB.
>    - Net Available VRAM for PyTorch: ~4.80 GB – 5.40 GB.
>    - Peak Inference VRAM at $B=1$ (Length 512): Estimated at 3.85 GB – 4.50 GB (leaving ~0.90 GB – 1.50 GB headroom).
>    - Peak Inference VRAM at $B \ge 4$: Estimated to exceed 5.80 GB, causing CUDA Out-of-Memory.
> 3. **Untested Assumptions (Preflight Required):**
>    - Model weights have **not** been downloaded to the host machine.
>    - BF16 model loading has **not** been empirically executed on this PC.
>    - Batch-size-1 inference latency and peak VRAM allocation have **not** been measured.
>    - Native Windows SDPA (`scaled_dot_product_attention`) memory stability under extended inference has **not** been benchmarked.
>    - Model C remains an unverified candidate until the safe 5-step preflight script (`ml/benchmark/preflight_nemotron.py`) is explicitly authorized and run.

#### 8.10.3: Safe 5-Step Hardware Feasibility Preflight Protocol

Before authorizing full Stage 5.0 candidate evaluation for Model C, the operator must execute the following isolated preflight script in `ml/benchmark/`:

```python
# ml/benchmark/preflight_nemotron.py (Preflight Diagnostic Sequence)
import time
import torch
from sentence_transformers import SentenceTransformer

def run_preflight():
    print("=== Nemotron-3.5-Embed-1B Hardware Preflight Diagnostic ===")
    assert torch.cuda.is_available(), "CUDA is not available. Aborting preflight."
    gpu_name = torch.cuda.get_device_name(0)
    total_vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"Device: {gpu_name} | Dedicated VRAM: {total_vram_gb:.2f} GB")
    assert total_vram_gb >= 5.5, f"Insufficient VRAM ({total_vram_gb:.2f} GB < 5.5 GB). Aborting."

    # Step 1: Baseline VRAM Measurement
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    base_vram = torch.cuda.memory_allocated() / (1024**3)
    print(f"Baseline VRAM Allocated: {base_vram:.2f} GB")

    # Step 2: Model Loading (Weights Only)
    t0 = time.perf_counter()
    model = SentenceTransformer(
        "nvidia/Nemotron-3.5-Embed-1B-BF16",
        device="cuda",
        model_kwargs={"dtype": torch.bfloat16, "attn_implementation": "sdpa"}
    )
    load_time = time.perf_counter() - t0
    load_vram = torch.cuda.memory_allocated() / (1024**3)
    peak_load_vram = torch.cuda.max_memory_allocated() / (1024**3)
    print(f"Model Loaded in {load_time:.2f}s | Active VRAM: {load_vram:.2f} GB | Peak: {peak_load_vram:.2f} GB")
    assert peak_load_vram < 5.0, f"Load VRAM exceeded 5.0 GB limit ({peak_load_vram:.2f} GB). Aborting."

    # Step 3: Single-Item Query & Passage Inference (B=1)
    sample_query = "What is an intense psychological thriller about obsession?"
    sample_doc = "Whiplash is a 2014 psychological drama film about an ambitious jazz drummer and his ruthless instructor."

    t0 = time.perf_counter()
    q_emb = model.encode_query([sample_query])
    q_time = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    d_emb = model.encode_document([sample_doc])
    d_time = (time.perf_counter() - t0) * 1000

    peak_inf_vram = torch.cuda.max_memory_allocated() / (1024**3)
    print(f"B=1 Query Latency: {q_time:.2f}ms | Doc Latency: {d_time:.2f}ms")
    print(f"Peak Inference VRAM (B=1): {peak_inf_vram:.2f} GB | Headroom: {total_vram_gb - peak_inf_vram:.2f} GB")

    # Step 4: Matryoshka Vector Truncation Validation
    assert q_emb.shape[1] == 2048, f"Unexpected native dimension {q_emb.shape[1]}"
    q_1024 = q_emb[:, :1024]
    q_1024_norm = q_1024 / torch.norm(torch.tensor(q_1024), dim=-1, keepdim=True).numpy()
    assert abs(torch.norm(torch.tensor(q_1024_norm[0])).item() - 1.0) < 1e-4, "MRL unit norm validation failed"
    print("MRL 1024d Truncation & L2 Renormalization: PASSED")

    # Step 5: Batch-2 Stress Test (Fail-Closed)
    try:
        docs_b2 = [sample_doc, sample_doc]
        model.encode_document(docs_b2)
        peak_b2_vram = torch.cuda.max_memory_allocated() / (1024**3)
        print(f"Batch-2 Test Succeeded | Peak VRAM: {peak_b2_vram:.2f} GB")
    except torch.cuda.OutOfMemoryError:
        print("WARNING: Batch-2 triggered CUDA OOM. Candidate must be constrained strictly to B=1.")

    print("=== Preflight Complete: Nemotron-3.5-Embed-1B is Viable for B=1 GPU Benchmark ===")

if __name__ == "__main__":
    run_preflight()
```

---

### 8.11: Catalogue Fixture Preparation & Verification Protocol

#### 8.11.1: Tripartite Canonical Text Serialization Taxonomy

To prevent conflation between application runtime code, offline evaluation tooling, and future production designs, the proposal strictly distinguishes three serialization contexts:

1. **Existing Application Serialization (Current Implementation Status):**  
   Inspection of the repository confirms that `apps/api/src/tmdb/tmdb.mapper.ts` maps TMDB HTTP payloads into relational Prisma models (`Movie`, `TvShow`, `Genre`, `Keyword`, `Person`, `PersonCredit`). However, **no canonical text serializer is currently implemented in application code**. Neither NestJS nor `ml/` currently executes a function that concatenates multi-table metadata into an embedding string.
2. **Stage 5.0 Benchmark Serialization (Evaluation Tooling):**  
   A deterministic, benchmark-specific Python serializer implemented in `ml/benchmark/scripts/prepare_catalogue_fixture.py` for generating the evaluation dataset. It uses an explicit bracketed token format and enforces strict null-omission rules:
   - _Movie Format:_ `"[TITLE] {title} [ORIGINAL_TITLE] {originalTitle} [YEAR] {year} [GENRES] {genres} [DIRECTOR] {directors} [CAST] {topCast} [KEYWORDS] {keywords} [OVERVIEW] {overview} [TAGLINE] {tagline}"`
   - _TV Show Format:_ `"[TITLE] {name} [ORIGINAL_TITLE] {originalName} [FIRST_AIR_YEAR] {year} [GENRES] {genres} [CREATOR] {creators} [CAST] {topCast} [KEYWORDS] {keywords} [OVERVIEW] {overview} [TAGLINE] {tagline}"`
   - _Strict Null/Omission Policy:_ If any contributing metadata field is `NULL`, empty, or whitespace-only, its bracketed label and value are **completely omitted** from the string. Literal strings `"null"`, `"undefined"`, or empty tokens like `"[TAGLINE] "` are never emitted.
   - _Non-Canonical Exclusions:_ Scalar fields `popularity`, `voteAverage`, `voteCount`, `posterPath`, `backdropPath`, `status`, and `runtime` are excluded from the canonical text.
3. **Future Production Serialization (Stage 5.1+ Design):**  
   The eventual production recommendation engine will implement a dedicated canonical text serializer in NestJS (`CanonicalTextService` or `VectorRepository`), maintaining synchronized revision hashing and database trigger invalidation. This is **strictly specified for future phases and is not implemented today**.

#### 8.11.2: Deterministic Selection Algorithm & Authoritative Source

1. **Authoritative Source:** The **CineSphere PostgreSQL database** (`movies` and `tv_shows` tables) is designated as the sole authoritative source for benchmark evaluation data. TMDB daily export dumps and the local database are **not** interchangeable.
   - _Source Audit Finding:_ Inspection of the local PostgreSQL instance indicates that the database currently contains 1,249 movies (925 synthetic test fixtures, 324 non-test records) and 2,174 TV shows (1,467 test fixtures, 707 non-test records), with **0 of the 50 predefined probes present**. Because the database cannot currently supply the required 1,400 movies and 50 probes, dataset generation is formally **blocked** until a real catalogue seeding step is performed. The preparation script must fail closed rather than silently switching sources.
2. **Exact Selection & Reservation Algorithm:**
   When the source catalogue is populated, the dataset preparation script executes the following deterministic 4-step algorithm:
   - **Step 1 (Probe Reservation):** Query and reserve the **50 predefined evaluation probes** (`PB-01` to `PB-50`: 38 movies, 12 TV shows) from `ml/benchmark/fixtures/probes_v1.json` by matching `(media_type, tmdbId)`. If any probe is missing from the database, the script **fails closed and aborts immediately**. Probes must never be silently substituted.
   - **Step 2 (Remaining Movie Selection):** From the remaining movies excluding the 38 reserved movie probes, select exactly **1,362 movies** where `overview IS NOT NULL AND length(overview) > 0` and title does not match integration test patterns, sorted deterministically by:
     `ORDER BY popularity DESC NULLS LAST, "voteCount" DESC NULLS LAST, "releaseDate" DESC NULLS LAST, "tmdbId" ASC`
   - **Step 3 (Remaining TV Show Selection):** From the remaining TV shows excluding the 12 reserved TV probes, select exactly **588 TV shows** where `overview IS NOT NULL AND length(overview) > 0` and name does not match integration test patterns, sorted deterministically by:
     `ORDER BY popularity DESC NULLS LAST, "voteCount" DESC NULLS LAST, "firstAirDate" DESC NULLS LAST, "tmdbId" ASC`
   - **Step 4 (Final Record Ordering):** Combine the 50 reserved probes and 1,950 selected titles (exact total: 2,000 records; exactly 1,400 movies and 600 TV shows). Sort the final fixture deterministically:
     `ORDER BY media_type ASC, tmdb_id ASC`
   - **Step 5 (Composite Identity Deduplication):** Enforce strict uniqueness on composite key `(media_type, tmdb_id)`. Duplicate identities abort generation.

#### 8.11.3: Supporting Evaluation Artifacts Specification

The evaluation package generates three coordinated artifacts under `ml/benchmark/fixtures/`:

1. **`catalogue_snapshot_v1.jsonl`:** The primary evaluation fixture containing exactly 2,000 UTF-8 JSON lines (1,400 movies, 600 TV shows, including all 50 probes), with deterministic canonical text.
2. **`catalogue_snapshot_v1.manifest.json`:** Machine-readable provenance manifest recording:
   - `fixture_filename`: `"catalogue_snapshot_v1.jsonl"`
   - `record_count`: `2000`
   - `movie_count`: `1400`
   - `tv_count`: `600`
   - `probe_count`: `50`
   - `sha256`: Cryptographic digest of `catalogue_snapshot_v1.jsonl`
   - `source_identity`: `"CineSphere PostgreSQL (catalogue tables)"`
   - `selection_algorithm_version`: `"1.0.0-deterministic"`
   - `serialization_version`: `"1.0.0-bracketed-tokens"`
   - `generated_at`: ISO 8601 timestamp
3. **`probes_v1.json`:** Standalone probe definition artifact containing all 50 probes (`PB-01` to `PB-50`). To guarantee scientific integrity:
   - Contains only probe identifiers, media types, TMDB IDs, titles, strata, selection rationales, and evaluation notes.
   - **Strictly isolated from blinded candidate grading sheets:** No relevance labels, evaluator scores, or model identities are contained in this file or exposed to candidate retrieval scripts.

---

## 9. C8 — Stage 5.0 and Stage 5.1 Boundaries & TD-08 Governance

### 9.1: Stage 5.0 Standalone Model Evaluation & Validation Scope

Stage 5.0 is an **isolated scientific evaluation phase** scoped exclusively to `ml/benchmark/`.

- **Authorized Activities upon Owner Approval:**
  1. Install the `[benchmark]` optional dependency group (`pip install -e ".[benchmark]"`) or use an isolated venv `ml/benchmark/.venv-baseline` for Models A and B.
  2. Install pinned dependencies from Section 8.8.
  3. Load pinned fixtures: `catalogue_snapshot_v1.jsonl` and 50 probes.
  4. Execute benchmark runs for Model A and Model B.
  5. Facilitate single-evaluator blinded grading per the protocol in Section 8.4 (with explicit limitation disclosure in the TD-08 report).
  6. Measure CPU latency, throughput, and peak RSS.
  7. Compute Macro Pooled Recall@10, MRR, and ILD with 95% bootstrap confidence intervals.
  8. Deliver the comprehensive TD-08 Recommendation Report.
- **Strict Boundary:** Stage 5.0 scripts **never connect directly to PostgreSQL with write privileges**, do **not** touch `apps/api/` or `apps/web/`, and do **not** run database migrations.

### 9.2: Prerequisites for Production Model Decision (TD-08)

The project owner will resolve **TD-08** only after receiving the completed Stage 5.0 evaluation report.

### 9.3: Blocked Stage 5.1+ Implementation Scope

All production development remains **STRICTLY BLOCKED** until TD-08 is formally decided and Stage 5.1 is explicitly authorized.

---

## 10. Complete SQL, Functions, and Pseudocode Specifications

### 10.1: embedding_coordination Table DDL (Provisional Seed)

```sql
CREATE TABLE "embedding_coordination" (
    "id" INTEGER PRIMARY KEY DEFAULT 1,
    "active_model_name" VARCHAR(100) NOT NULL,
    "active_model_version" VARCHAR(100) NOT NULL,
    "active_dimensions" INTEGER NOT NULL,
    "pending_model_name" VARCHAR(100),
    "pending_model_version" VARCHAR(100),
    "pending_dimensions" INTEGER,
    "cutover_in_progress" BOOLEAN NOT NULL DEFAULT FALSE,
    "cutover_started_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "embedding_coordination_singleton" CHECK ("id" = 1),
    CONSTRAINT "active_dimensions_positive" CHECK ("active_dimensions" > 0),
    CONSTRAINT "pending_dimensions_positive" CHECK ("pending_dimensions" IS NULL OR "pending_dimensions" > 0)
);

-- PROVISIONAL SEED ROW:
-- WARNING: This seed is a provisional schema-initialization placeholder.
-- It does NOT represent an approved production model decision for TD-08.
INSERT INTO "embedding_coordination" (
    "id", "active_model_name", "active_model_version", "active_dimensions"
) VALUES (
    1, 'provisional-unassigned', '0.0.0', 384
) ON CONFLICT ("id") DO NOTHING;
```

### 10.2: Complete promoteStagedEmbedding TypeScript Pseudocode

_(See Section 3.2 in earlier text for complete 17-point pseudocode with unit norm, hash recomputation under lock, and single active count postcondition)._

### 10.3: Complete execute_model_cutover SQL Function

```sql
CREATE OR REPLACE FUNCTION execute_model_cutover(
    p_owner_job_id UUID,
    p_fencing_token BIGINT
) RETURNS JSONB AS $$
DECLARE
    v_token          BIGINT;
    v_pending_name   VARCHAR(100);
    v_pending_ver    VARCHAR(100);
    v_pending_dims   INTEGER;
    v_total_elig     INTEGER;
    v_cand_cnt       INTEGER;
    v_promoted_cnt   INTEGER;
    v_active_cnt     INTEGER;
    v_dup_cnt        INTEGER;
    v_invalid_cnt    INTEGER;
    v_stale_cnt      INTEGER;
    v_orphan_cnt     INTEGER;
    -- Coordination postcondition readback variables (Invariant #17 / Assertions 8a-8b)
    v_coord_rows         INTEGER := 0;
    v_coord_name_rb      TEXT;
    v_coord_ver_rb       TEXT;
    v_coord_dims_rb      INTEGER;
    v_coord_pname_rb     TEXT;
    v_coord_pver_rb      TEXT;
    v_coord_pdims_rb     INTEGER;
    v_coord_inprogress_rb BOOLEAN;
BEGIN
    -- ------------------------------------------------------------------------
    -- Level 1: Lock-Acquisition Lease Fencing Verification (Option A)
    -- ------------------------------------------------------------------------
    SELECT fencing_token INTO v_token
    FROM job_leases
    WHERE lease_name = 'model_cutover'
      AND owner_job_id = p_owner_job_id
      AND fencing_token = p_fencing_token
      AND status = 'ACQUIRED'
      AND expires_at >= clock_timestamp()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LEASE_NOT_HELD: Worker does not hold valid model_cutover lease (Job: %, Token: %)',
            p_owner_job_id, p_fencing_token;
    END IF;

    -- ------------------------------------------------------------------------
    -- Level 2: Singleton Coordination Lock & Pending Model Verification
    -- ------------------------------------------------------------------------
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_ROW_MISSING: Singleton row id=1 missing from embedding_coordination.';
    END IF;

    SELECT pending_model_name, pending_model_version, pending_dimensions
    INTO v_pending_name, v_pending_ver, v_pending_dims
    FROM embedding_coordination WHERE id = 1;

    IF v_pending_name IS NULL THEN RAISE EXCEPTION 'NO_PENDING_MODEL'; END IF;
    IF v_pending_dims <= 0 OR v_pending_ver IS NULL THEN RAISE EXCEPTION 'MODEL_CONFIGURATION_MISMATCH'; END IF;

    -- ------------------------------------------------------------------------
    -- Pre-Inspection: Vector Integrity (Finiteness, Dimensions, Unit Norm)
    -- ------------------------------------------------------------------------
    SELECT count(*) INTO v_invalid_cnt
    FROM media_embeddings me
    WHERE me.model_name = v_pending_name AND me.model_version = v_pending_ver
      AND me.lifecycle_stage = 'STAGED' AND me.status = 'COMPLETED'
      AND (
          me.dimensions != v_pending_dims OR
          vector_dims(me.embedding::vector) != v_pending_dims OR
          me.embedding IS NULL OR
          -- Enforce unit L2 normalization via negative inner product: ||v||^2 in [0.998001, 1.002001]
          -(me.embedding::vector <#> me.embedding::vector) NOT BETWEEN 0.998001 AND 1.002001 OR
          -- Enforce Parent XOR
          ((me.movie_id IS NOT NULL)::int + (me.tv_show_id IS NOT NULL)::int) != 1
      );

    IF v_invalid_cnt > 0 THEN
        RAISE EXCEPTION 'INVALID_CANDIDATE_VECTORS: % completed staged embeddings have corrupted dimensions, non-unit norms, or XOR violations.', v_invalid_cnt;
    END IF;

    -- Pre-Inspection: Stale Candidates & NULL-Safe Parent Matching
    SELECT count(*) INTO v_stale_cnt
    FROM media_embeddings me
    LEFT JOIN movies m ON m.id = me.movie_id
    LEFT JOIN tv_shows t ON t.id = me.tv_show_id
    WHERE me.model_name = v_pending_name AND me.model_version = v_pending_ver
      AND me.lifecycle_stage = 'STAGED' AND me.status = 'COMPLETED'
      AND (
          me.embedding_stale = true OR
          (me.movie_id IS NOT NULL AND m.id IS NULL) OR
          (me.tv_show_id IS NOT NULL AND t.id IS NULL) OR
          me.metadata_revision IS DISTINCT FROM COALESCE(m.metadata_revision, t.metadata_revision)
      );

    IF v_stale_cnt > 0 THEN
        RAISE EXCEPTION 'STALE_METADATA_DETECTED: % completed staged embeddings are stale or reference non-existent parents.', v_stale_cnt;
    END IF;

    -- ------------------------------------------------------------------------
    -- Calculate Total Eligible Media Items
    -- ------------------------------------------------------------------------
    SELECT
        (SELECT count(*) FROM movies WHERE (title IS NOT NULL AND trim(title) != '') OR (overview IS NOT NULL AND trim(overview) != '')) +
        (SELECT count(*) FROM tv_shows WHERE (name IS NOT NULL AND trim(name) != '') OR (overview IS NOT NULL AND trim(overview) != ''))
    INTO v_total_elig;

    -- ------------------------------------------------------------------------
    -- Create Constrained Temporary Candidate Table with Composite Uniqueness
    -- ------------------------------------------------------------------------
    CREATE TEMPORARY TABLE _cutover_candidates (
        embedding_id UUID PRIMARY KEY,
        media_type   VARCHAR(10) NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
        media_id     UUID NOT NULL,
        CONSTRAINT unique_candidate_per_media UNIQUE (media_type, media_id)
    ) ON COMMIT DROP;

    -- Populate Candidates Deterministically
    WITH ranked_movies AS (
        SELECT me.id AS embedding_id, 'MOVIE'::varchar(10) AS media_type, me.movie_id AS media_id,
               ROW_NUMBER() OVER (PARTITION BY me.movie_id ORDER BY me.metadata_revision DESC, me.generated_at DESC, me.id ASC) AS rn
        FROM media_embeddings me
        JOIN movies m ON m.id = me.movie_id
        WHERE me.model_name = v_pending_name AND me.model_version = v_pending_ver
          AND me.dimensions = v_pending_dims AND vector_dims(me.embedding::vector) = v_pending_dims
          AND -(me.embedding::vector <#> me.embedding::vector) BETWEEN 0.998001 AND 1.002001
          AND me.lifecycle_stage = 'STAGED' AND me.status = 'COMPLETED' AND me.embedding_stale = false
          AND me.metadata_revision IS NOT DISTINCT FROM m.metadata_revision
    ),
    ranked_tv AS (
        SELECT me.id AS embedding_id, 'TV'::varchar(10) AS media_type, me.tv_show_id AS media_id,
               ROW_NUMBER() OVER (PARTITION BY me.tv_show_id ORDER BY me.metadata_revision DESC, me.generated_at DESC, me.id ASC) AS rn
        FROM media_embeddings me
        JOIN tv_shows t ON t.id = me.tv_show_id
        WHERE me.model_name = v_pending_name AND me.model_version = v_pending_ver
          AND me.dimensions = v_pending_dims AND vector_dims(me.embedding::vector) = v_pending_dims
          AND -(me.embedding::vector <#> me.embedding::vector) BETWEEN 0.998001 AND 1.002001
          AND me.lifecycle_stage = 'STAGED' AND me.status = 'COMPLETED' AND me.embedding_stale = false
          AND me.metadata_revision IS NOT DISTINCT FROM t.metadata_revision
    )
    INSERT INTO _cutover_candidates (embedding_id, media_type, media_id)
    SELECT embedding_id, media_type, media_id FROM ranked_movies WHERE rn = 1
    UNION ALL
    SELECT embedding_id, media_type, media_id FROM ranked_tv WHERE rn = 1;

    SELECT count(*) INTO v_cand_cnt FROM _cutover_candidates;

    IF v_cand_cnt != v_total_elig THEN
        RAISE EXCEPTION 'INSUFFICIENT_COVERAGE: Candidate count (%) does not equal eligible titles (%).', v_cand_cnt, v_total_elig;
    END IF;

    -- ------------------------------------------------------------------------
    -- Level 4 Mutations: Archive Existing Active & Promote Validated Candidates
    -- ------------------------------------------------------------------------
    UPDATE media_embeddings
    SET lifecycle_stage = 'HISTORICAL', archived_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE lifecycle_stage = 'ACTIVE';

    UPDATE media_embeddings me
    SET lifecycle_stage = 'ACTIVE',
        embedding_stale = false,
        promoted_at = clock_timestamp(),
        updated_at = clock_timestamp()
    FROM _cutover_candidates cc
    WHERE me.id = cc.embedding_id;
    GET DIAGNOSTICS v_promoted_cnt = ROW_COUNT;

    -- ------------------------------------------------------------------------
    -- Ten Mandatory Post-Promotion Verification Assertions (7 Invariants + 3 Coordination Checks)
    -- ------------------------------------------------------------------------
    -- 1. Promoted Count == Candidate Count
    IF v_promoted_cnt != v_cand_cnt THEN
        RAISE EXCEPTION 'PROMOTION_COUNT_MISMATCH: Promoted % rows, expected %.', v_promoted_cnt, v_cand_cnt;
    END IF;

    -- 2. Total Active Count == Eligible Media Count
    SELECT count(*) INTO v_active_cnt FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE';
    IF v_active_cnt != v_total_elig THEN
        RAISE EXCEPTION 'ACTIVE_COUNT_MISMATCH: Active count % does not equal eligible %.', v_active_cnt, v_total_elig;
    END IF;

    -- 3. Zero Duplicate Active Embeddings for any composite media identity
    SELECT count(*) INTO v_dup_cnt
    FROM (
        SELECT 'MOVIE' AS media_type, movie_id AS media_id FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE' AND movie_id IS NOT NULL GROUP BY movie_id HAVING count(*) > 1
        UNION ALL
        SELECT 'TV' AS media_type, tv_show_id AS media_id FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE' AND tv_show_id IS NOT NULL GROUP BY tv_show_id HAVING count(*) > 1
    ) dups;
    IF v_dup_cnt > 0 THEN RAISE EXCEPTION 'DUPLICATE_ACTIVE_EMBEDDINGS: % duplicate active rows.', v_dup_cnt; END IF;

    -- 4. Active Model Name Match
    IF EXISTS (SELECT 1 FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE' AND model_name != v_pending_name) THEN
        RAISE EXCEPTION 'ACTIVE_MODEL_NAME_MISMATCH: Active embeddings exist with model_name != %.', v_pending_name;
    END IF;

    -- 5. Active Model Version Match
    IF EXISTS (SELECT 1 FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE' AND model_version != v_pending_ver) THEN
        RAISE EXCEPTION 'ACTIVE_MODEL_VERSION_MISMATCH: Active embeddings exist with model_version != %.', v_pending_ver;
    END IF;

    -- 6. Active Vector Dimensions Match & pgvector Storage Valid
    IF EXISTS (SELECT 1 FROM media_embeddings WHERE lifecycle_stage = 'ACTIVE' AND (dimensions != v_pending_dims OR vector_dims(embedding::vector) != v_pending_dims)) THEN
        RAISE EXCEPTION 'ACTIVE_DIMENSION_MISMATCH: Active embeddings have invalid dimensions.';
    END IF;

    -- 7. Zero Orphaned Active Embeddings
    SELECT count(*) INTO v_orphan_cnt
    FROM media_embeddings me
    LEFT JOIN movies m ON m.id = me.movie_id
    LEFT JOIN tv_shows t ON t.id = me.tv_show_id
    WHERE me.lifecycle_stage = 'ACTIVE'
      AND ((me.movie_id IS NOT NULL AND m.id IS NULL) OR (me.tv_show_id IS NOT NULL AND t.id IS NULL));
    IF v_orphan_cnt > 0 THEN RAISE EXCEPTION 'ORPHAN_ACTIVE_EMBEDDINGS: % active embeddings have no parent.', v_orphan_cnt; END IF;

    -- Execute Level 2 Coordination Singleton Row Update:
    UPDATE embedding_coordination
    SET active_model_name = v_pending_name,
        active_model_version = v_pending_ver,
        active_dimensions = v_pending_dims,
        pending_model_name = NULL,
        pending_model_version = NULL,
        pending_dimensions = NULL,
        cutover_in_progress = FALSE,
        updated_at = clock_timestamp()
    WHERE id = 1;

    -- 8. Coordination Row Update Coverage: Verify exactly 1 coordination row was updated
    GET DIAGNOSTICS v_coord_rows = ROW_COUNT;
    IF v_coord_rows != 1 THEN
        RAISE EXCEPTION 'COORDINATION_UPDATE_FAILED: Expected 1 affected coordination row, got %.', v_coord_rows;
    END IF;

    -- Read back coordination state for exact verification:
    SELECT active_model_name, active_model_version, active_dimensions,
           pending_model_name, pending_model_version, pending_dimensions,
           cutover_in_progress
    INTO v_coord_name_rb, v_coord_ver_rb, v_coord_dims_rb,
         v_coord_pname_rb, v_coord_pver_rb, v_coord_pdims_rb,
         v_coord_inprogress_rb
    FROM embedding_coordination WHERE id = 1;

    -- 9. Coordination State Readback — Active Fields Match Target Model
    IF v_coord_name_rb IS DISTINCT FROM v_pending_name OR
       v_coord_ver_rb IS DISTINCT FROM v_pending_ver OR
       v_coord_dims_rb IS DISTINCT FROM v_pending_dims THEN
        RAISE EXCEPTION 'COORDINATION_ACTIVE_STATE_INVALID: Persisted active coordination state does not match expected targets.';
    END IF;

    -- 10. Coordination State Readback — Pending Fields Cleared & In-Progress False
    IF v_coord_pname_rb IS NOT NULL OR
       v_coord_pver_rb IS NOT NULL OR
       v_coord_pdims_rb IS NOT NULL OR
       v_coord_inprogress_rb != FALSE THEN
        RAISE EXCEPTION 'COORDINATION_PENDING_STATE_INVALID: Persisted pending coordination state not cleared or cutover_in_progress is not false.';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'model_name', v_pending_name,
        'model_version', v_pending_ver,
        'promoted_count', v_promoted_cnt,
        'active_count', v_active_cnt
    );
END;
$$ LANGUAGE plpgsql;
```

### 10.4: Complete persist_sync_checkpoint SQL Function (Key Allowlist)

```sql
CREATE OR REPLACE FUNCTION persist_sync_checkpoint(
    p_lease_name VARCHAR(50),
    p_owner_job_id UUID,
    p_fencing_token BIGINT,
    p_config_key VARCHAR(100),
    p_payload JSONB
) RETURNS VOID AS $$
DECLARE
    v_token BIGINT;
    v_status TEXT;
    v_page INT;
    v_total INT;
    v_date TEXT;
BEGIN
    -- Key Allowlisting: Only permitted sync watermarks can be updated
    IF p_config_key NOT IN ('sync_watermark_movie', 'sync_watermark_tv') THEN
        RAISE EXCEPTION 'INVALID_CHECKPOINT_KEY: % is not a permitted sync watermark key.', p_config_key;
    END IF;

    -- Payload Schema Validation
    v_date := p_payload->>'lastChangeDate';
    v_page := (p_payload->>'lastProcessedPage')::int;
    v_total := (p_payload->>'totalPages')::int;
    v_status := p_payload->>'status';

    IF v_date IS NULL OR v_page IS NULL OR v_total IS NULL OR v_status IS NULL THEN
        RAISE EXCEPTION 'MALFORMED_CHECKPOINT_PAYLOAD: Required keys missing in payload.';
    END IF;

    IF v_page < 0 OR v_total < 0 OR v_status NOT IN ('IN_PROGRESS', 'COMPLETED', 'PENDING_INITIAL_SYNC') THEN
        RAISE EXCEPTION 'INVALID_CHECKPOINT_VALUES: Out-of-bounds page numbers or invalid status.';
    END IF;

    -- Level 1: Lock-Acquisition Lease Fencing Verification (Option A)
    SELECT fencing_token INTO v_token
    FROM job_leases
    WHERE lease_name = p_lease_name
      AND owner_job_id = p_owner_job_id
      AND fencing_token = p_fencing_token
      AND status = 'ACQUIRED'
      AND expires_at >= clock_timestamp()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LEASE_NOT_HELD: Worker does not hold valid sync lease (Lease: %, Job: %, Token: %)',
            p_lease_name, p_owner_job_id, p_fencing_token;
    END IF;

    -- Level 5: Upsert Checkpoint Configuration
    INSERT INTO system_configs (key, value, updated_at)
    VALUES (p_config_key, p_payload::text, clock_timestamp())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;
```

### 10.5: Type-Safe Non-Destructive Watermark Migration SQL

```sql
DO $$
DECLARE
    -- Raw String Extraction Variables (Zero crash on unvalidated text-to-jsonb cast)
    v_legacy_raw     TEXT := NULL;
    v_dest_movie_raw TEXT := NULL;
    v_dest_tv_raw    TEXT := NULL;

    -- Parsed JSON Objects
    v_legacy_val     JSONB := NULL;
    v_legacy_date    TIMESTAMPTZ := NULL;
    v_fallback       TIMESTAMPTZ := clock_timestamp() - INTERVAL '14 days';
    v_date_min       TIMESTAMPTZ := '2000-01-01 00:00:00+00'::timestamptz;
    v_date_max       TIMESTAMPTZ := clock_timestamp() + INTERVAL '5 minutes';

    -- Destination Read State
    v_dest_movie     JSONB := NULL;
    v_dest_tv        JSONB := NULL;
    v_dm_date        TIMESTAMPTZ := NULL;
    v_dm_page        INTEGER := NULL;
    v_dm_total       INTEGER := NULL;
    v_dm_status      TEXT := NULL;
    v_dt_date        TIMESTAMPTZ := NULL;
    v_dt_page        INTEGER := NULL;
    v_dt_total       INTEGER := NULL;
    v_dt_status      TEXT := NULL;

    -- Calculated Expected State
    v_exp_movie      JSONB;
    v_exp_tv         JSONB;
    v_em_date        TIMESTAMPTZ;
    v_em_page        INTEGER;
    v_em_total       INTEGER;
    v_em_status      TEXT;
    v_et_date        TIMESTAMPTZ;
    v_et_page        INTEGER;
    v_et_total       INTEGER;
    v_et_status      TEXT;

    -- Final Verification Readback Variables
    v_read_m_raw     TEXT := NULL;
    v_read_t_raw     TEXT := NULL;
    v_read_movie     JSONB := NULL;
    v_read_tv        JSONB := NULL;
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. Safely Read and Parse Legacy Watermark Key
    -- ------------------------------------------------------------------------
    SELECT value INTO v_legacy_raw
    FROM system_configs WHERE key = 'catalogue_sync_watermarks';

    IF v_legacy_raw IS NOT NULL AND trim(v_legacy_raw) != '' THEN
        BEGIN
            v_legacy_val := v_legacy_raw::jsonb;
            IF jsonb_typeof(v_legacy_val) != 'object' THEN
                v_legacy_val := NULL;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_legacy_val := NULL;
        END;
    END IF;

    IF v_legacy_val IS NOT NULL THEN
        BEGIN
            v_legacy_date := (v_legacy_val->>'deltaSyncLastCheck')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            v_legacy_date := NULL;
        END;
    END IF;

    -- Apply Identical Date Validity Bounds (Year 2000 to now + 5 min tolerance)
    IF v_legacy_date IS NULL OR v_legacy_date < v_date_min OR v_legacy_date > v_date_max THEN
        v_legacy_date := v_fallback;
    END IF;

    -- ------------------------------------------------------------------------
    -- 2. Safely Read and Parse Existing Destination Records
    -- ------------------------------------------------------------------------
    SELECT value INTO v_dest_movie_raw FROM system_configs WHERE key = 'sync_watermark_movie';
    SELECT value INTO v_dest_tv_raw FROM system_configs WHERE key = 'sync_watermark_tv';

    IF v_dest_movie_raw IS NOT NULL AND trim(v_dest_movie_raw) != '' THEN
        BEGIN
            v_dest_movie := v_dest_movie_raw::jsonb;
            IF jsonb_typeof(v_dest_movie) != 'object' THEN
                v_dest_movie := NULL;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_dest_movie := NULL;
        END;
    END IF;

    IF v_dest_tv_raw IS NOT NULL AND trim(v_dest_tv_raw) != '' THEN
        BEGIN
            v_dest_tv := v_dest_tv_raw::jsonb;
            IF jsonb_typeof(v_dest_tv) != 'object' THEN
                v_dest_tv := NULL;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_dest_tv := NULL;
        END;
    END IF;

    -- Extract Destination Movie Fields with Individual Exception Isolation
    IF v_dest_movie IS NOT NULL THEN
        BEGIN v_dm_date  := (v_dest_movie->>'lastChangeDate')::timestamptz;
        EXCEPTION WHEN OTHERS THEN v_dm_date := NULL; END;
        IF v_dm_date IS NOT NULL AND (v_dm_date < v_date_min OR v_dm_date > v_date_max) THEN
            v_dm_date := NULL;
        END IF;

        BEGIN v_dm_page  := (v_dest_movie->>'lastProcessedPage')::integer;
        EXCEPTION WHEN OTHERS THEN v_dm_page := NULL; END;
        IF v_dm_page IS NOT NULL AND v_dm_page < 0 THEN v_dm_page := NULL; END IF;

        BEGIN v_dm_total := (v_dest_movie->>'totalPages')::integer;
        EXCEPTION WHEN OTHERS THEN v_dm_total := NULL; END;
        IF v_dm_total IS NOT NULL AND v_dm_total < 0 THEN v_dm_total := NULL; END IF;

        -- Enforce Pagination Consistency Rules
        IF v_dm_total IS NOT NULL AND v_dm_total = 0 AND v_dm_page IS NOT NULL AND v_dm_page > 0 THEN
            v_dm_page := 0;
        END IF;
        IF v_dm_total IS NOT NULL AND v_dm_total > 0 AND v_dm_page IS NOT NULL AND v_dm_page > v_dm_total THEN
            v_dm_page := 0; v_dm_total := 0;
        END IF;
        IF v_dm_page IS NOT NULL AND v_dm_total IS NULL THEN
            v_dm_page := 0; v_dm_total := 0;
        END IF;

        -- Enforce Status Allowlist
        v_dm_status := v_dest_movie->>'status';
        IF v_dm_status NOT IN ('IN_PROGRESS', 'COMPLETED', 'PENDING_INITIAL_SYNC') THEN
            v_dm_status := NULL;
        END IF;
    END IF;

    -- Extract Destination TV Fields with Individual Exception Isolation
    IF v_dest_tv IS NOT NULL THEN
        BEGIN v_dt_date  := (v_dest_tv->>'lastChangeDate')::timestamptz;
        EXCEPTION WHEN OTHERS THEN v_dt_date := NULL; END;
        IF v_dt_date IS NOT NULL AND (v_dt_date < v_date_min OR v_dt_date > v_date_max) THEN
            v_dt_date := NULL;
        END IF;

        BEGIN v_dt_page  := (v_dest_tv->>'lastProcessedPage')::integer;
        EXCEPTION WHEN OTHERS THEN v_dt_page := NULL; END;
        IF v_dt_page IS NOT NULL AND v_dt_page < 0 THEN v_dt_page := NULL; END IF;

        BEGIN v_dt_total := (v_dest_tv->>'totalPages')::integer;
        EXCEPTION WHEN OTHERS THEN v_dt_total := NULL; END;
        IF v_dt_total IS NOT NULL AND v_dt_total < 0 THEN v_dt_total := NULL; END IF;

        -- Enforce Pagination Consistency Rules
        IF v_dt_total IS NOT NULL AND v_dt_total = 0 AND v_dt_page IS NOT NULL AND v_dt_page > 0 THEN
            v_dt_page := 0;
        END IF;
        IF v_dt_total IS NOT NULL AND v_dt_total > 0 AND v_dt_page IS NOT NULL AND v_dt_page > v_dt_total THEN
            v_dt_page := 0; v_dt_total := 0;
        END IF;
        IF v_dt_page IS NOT NULL AND v_dt_total IS NULL THEN
            v_dt_page := 0; v_dt_total := 0;
        END IF;

        -- Enforce Status Allowlist
        v_dt_status := v_dest_tv->>'status';
        IF v_dt_status NOT IN ('IN_PROGRESS', 'COMPLETED', 'PENDING_INITIAL_SYNC') THEN
            v_dt_status := NULL;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 3. Field-by-Field Independent Reconciliation
    -- ------------------------------------------------------------------------
    -- Movie Reconciliation
    IF v_dm_date IS NOT NULL AND v_dm_date >= v_legacy_date THEN
        v_em_date   := v_dm_date;
        v_em_page   := COALESCE(v_dm_page, 0);
        v_em_total  := COALESCE(v_dm_total, 0);
        v_em_status := COALESCE(v_dm_status, 'COMPLETED');
    ELSE
        v_em_date   := v_legacy_date;
        v_em_page   := 0;
        v_em_total  := 0;
        v_em_status := CASE WHEN v_legacy_date = v_fallback THEN 'PENDING_INITIAL_SYNC' ELSE 'COMPLETED' END;
    END IF;

    -- TV Reconciliation
    IF v_dt_date IS NOT NULL AND v_dt_date >= v_legacy_date THEN
        v_et_date   := v_dt_date;
        v_et_page   := COALESCE(v_dt_page, 0);
        v_et_total  := COALESCE(v_dt_total, 0);
        v_et_status := COALESCE(v_dt_status, 'COMPLETED');
    ELSE
        v_et_date   := v_legacy_date;
        v_et_page   := 0;
        v_et_total  := 0;
        v_et_status := CASE WHEN v_legacy_date = v_fallback THEN 'PENDING_INITIAL_SYNC' ELSE 'COMPLETED' END;
    END IF;

    v_exp_movie := jsonb_build_object(
        'lastChangeDate', v_em_date,
        'lastProcessedPage', v_em_page,
        'totalPages', v_em_total,
        'status', v_em_status
    );

    v_exp_tv := jsonb_build_object(
        'lastChangeDate', v_et_date,
        'lastProcessedPage', v_et_page,
        'totalPages', v_et_total,
        'status', v_et_status
    );

    -- ------------------------------------------------------------------------
    -- 4. Upsert Reconciled Records
    -- ------------------------------------------------------------------------
    INSERT INTO system_configs (key, value, updated_at)
    VALUES ('sync_watermark_movie', v_exp_movie::text, clock_timestamp())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

    INSERT INTO system_configs (key, value, updated_at)
    VALUES ('sync_watermark_tv', v_exp_tv::text, clock_timestamp())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

    -- ------------------------------------------------------------------------
    -- 5. Field-by-Field Exact Readback Verification (NULL-Safe)
    -- ------------------------------------------------------------------------
    SELECT value INTO v_read_m_raw FROM system_configs WHERE key = 'sync_watermark_movie';
    SELECT value INTO v_read_t_raw FROM system_configs WHERE key = 'sync_watermark_tv';

    IF v_read_m_raw IS NOT NULL THEN
        BEGIN v_read_movie := v_read_m_raw::jsonb;
        EXCEPTION WHEN OTHERS THEN v_read_movie := NULL; END;
    END IF;

    IF v_read_t_raw IS NOT NULL THEN
        BEGIN v_read_tv := v_read_t_raw::jsonb;
        EXCEPTION WHEN OTHERS THEN v_read_tv := NULL; END;
    END IF;

    IF v_read_movie IS NULL OR v_read_tv IS NULL OR
       (v_read_movie->>'lastChangeDate')::timestamptz IS DISTINCT FROM (v_exp_movie->>'lastChangeDate')::timestamptz OR
       (v_read_tv->>'lastChangeDate')::timestamptz IS DISTINCT FROM (v_exp_tv->>'lastChangeDate')::timestamptz OR
       (v_read_movie->>'lastProcessedPage')::integer IS DISTINCT FROM (v_exp_movie->>'lastProcessedPage')::integer OR
       (v_read_tv->>'lastProcessedPage')::integer IS DISTINCT FROM (v_exp_tv->>'lastProcessedPage')::integer OR
       (v_read_movie->>'totalPages')::integer IS DISTINCT FROM (v_exp_movie->>'totalPages')::integer OR
       (v_read_tv->>'totalPages')::integer IS DISTINCT FROM (v_exp_tv->>'totalPages')::integer OR
       (v_read_movie->>'status') IS DISTINCT FROM (v_exp_movie->>'status') OR
       (v_read_tv->>'status') IS DISTINCT FROM (v_exp_tv->>'status') THEN
        RAISE EXCEPTION 'Watermark migration exact field-by-field verification failed. Legacy data preserved.';
    END IF;

    -- ------------------------------------------------------------------------
    -- 6. Delete Legacy Key ONLY Upon Successful Readback Verification
    -- ------------------------------------------------------------------------
    IF v_legacy_raw IS NOT NULL THEN
        DELETE FROM system_configs WHERE key = 'catalogue_sync_watermarks';
    END IF;
END $$;
```

### 10.6: Complete Metadata Revision Trigger DDL (Scalars, Junctions, Credits, Persons)

```sql
-- ============================================================================
-- 0. Universal Statement-Level Coordination Trigger Function (Fail-Closed)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_acquire_coordination_share_lock()
RETURNS TRIGGER AS $$
BEGIN
    -- Acquires Level 2 coordination singleton lock FOR SHARE before ANY row
    -- in the target table is scanned, evaluated, or locked.
    -- Fails closed: verifies that the coordination row exists and is locked.
    -- If absent, raises an exception to prevent uncoordinated writes.
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Protected write blocked.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Statement Coordination for All Media Catalogue Writers (INSERT / UPDATE / DELETE):
CREATE TRIGGER trg_movie_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "movies"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_tv_media_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "tv_shows"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- ============================================================================
-- 1. Scalar Metadata Triggers on movies and tv_shows
--
-- PHASE 5 SCHEMA PREREQUISITE:
-- These triggers require the Phase 5 migration to add the following columns:
--   movies:    metadata_revision INTEGER NOT NULL DEFAULT 0
--              tagline           TEXT
--              status            VARCHAR(50)   (already exists on tv_shows)
--   tv_shows:  metadata_revision INTEGER NOT NULL DEFAULT 0
--              tagline           TEXT
--
-- C1 Schema Compatibility (verified against apps/api/prisma/schema.prisma):
--   movies.title, originalTitle, overview, releaseDate, runtime, originalLanguage → PRESENT
--   movies.tagline → MISSING (Phase 5 migration required)   [P5]
--   movies.status  → MISSING (Phase 5 migration required)   [P5]
--   tv_shows.name, originalName, overview, firstAirDate, originalLanguage → PRESENT
--   tv_shows.status, numberOfSeasons, numberOfEpisodes → PRESENT
--   tv_shows.tagline → MISSING (Phase 5 migration required) [P5]
--   metadata_revision (both) → MISSING (Phase 5 migration required) [P5]
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_bump_movie_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.title IS DISTINCT FROM NEW.title OR
       OLD."originalTitle" IS DISTINCT FROM NEW."originalTitle" OR
       OLD.overview IS DISTINCT FROM NEW.overview OR
       OLD."releaseDate" IS DISTINCT FROM NEW."releaseDate" OR
       OLD.runtime IS DISTINCT FROM NEW.runtime OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD.tagline IS DISTINCT FROM NEW.tagline OR    -- [P5] requires Phase 5 migration column
       OLD.status IS DISTINCT FROM NEW.status THEN   -- [P5] requires Phase 5 migration column
        NEW.metadata_revision := OLD.metadata_revision + 1;  -- [P5] requires Phase 5 migration column
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movie_scalar_revision
BEFORE UPDATE ON "movies"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_scalar_metadata_revision();

CREATE OR REPLACE FUNCTION trg_fn_bump_tv_scalar_metadata_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.name IS DISTINCT FROM NEW.name OR
       OLD."originalName" IS DISTINCT FROM NEW."originalName" OR
       OLD.overview IS DISTINCT FROM NEW.overview OR
       OLD."firstAirDate" IS DISTINCT FROM NEW."firstAirDate" OR
       OLD."originalLanguage" IS DISTINCT FROM NEW."originalLanguage" OR
       OLD.tagline IS DISTINCT FROM NEW.tagline OR              -- [P5] requires Phase 5 migration column
       OLD.status IS DISTINCT FROM NEW.status OR
       OLD."numberOfSeasons" IS DISTINCT FROM NEW."numberOfSeasons" OR
       OLD."numberOfEpisodes" IS DISTINCT FROM NEW."numberOfEpisodes" THEN
        NEW.metadata_revision := OLD.metadata_revision + 1;    -- [P5] requires Phase 5 migration column
        NEW."updatedAt" := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tv_scalar_revision
BEFORE UPDATE ON "tv_shows"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_scalar_metadata_revision();

-- ============================================================================
-- 2. Junction & Credit Triggers (Movie Parents)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_bump_movie_metadata_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_old_id UUID := NULL;
    v_new_id UUID := NULL;
BEGIN
    -- Acquire Level 2 Coordination Lock FOR SHARE before Level 3 Media Lock (Fail-Closed)
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;
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

    -- Update parents safely avoiding duplicate bumps
    IF v_old_id IS NOT NULL AND v_new_id IS NOT NULL AND v_old_id = v_new_id THEN
        UPDATE movies SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = v_new_id;
    ELSE
        IF v_old_id IS NOT NULL THEN
            UPDATE movies SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = v_old_id;
        END IF;
        IF v_new_id IS NOT NULL THEN
            UPDATE movies SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = v_new_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Statement Coordination for Movie Junctions & Credits:
CREATE TRIGGER trg_genre_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_movie_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToMovie"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_person_credits_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- AFTER ROW: Performs the actual revision bump on the parent movie record
CREATE TRIGGER trg_movie_genre_revision
AFTER INSERT OR UPDATE OR DELETE ON "_GenreToMovie"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

CREATE TRIGGER trg_movie_keyword_revision
AFTER INSERT OR UPDATE OR DELETE ON "_KeywordToMovie"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

CREATE TRIGGER trg_person_credits_movie_revision
AFTER INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH ROW WHEN (COALESCE(NEW."movieId", OLD."movieId") IS NOT NULL)
EXECUTE FUNCTION trg_fn_bump_movie_metadata_revision();

-- ============================================================================
-- 3. Junction & Credit Triggers (TV Parents)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_bump_tv_metadata_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_old_id UUID := NULL;
    v_new_id UUID := NULL;
BEGIN
    -- Acquire Level 2 Coordination Lock FOR SHARE before Level 3 Media Lock (Fail-Closed)
    PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Junction write blocked.';
    END IF;

    -- Authoritative table names: _GenreToTvShow and _KeywordToTvShow
    -- In both tables, column "B" is the tv_shows UUID foreign key
    IF TG_TABLE_NAME IN ('_GenreToTvShow', '_KeywordToTvShow') THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."B"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."B"; END IF;
    ELSIF TG_TABLE_NAME = 'person_credits' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_id := OLD."tvShowId"; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_id := NEW."tvShowId"; END IF;
    END IF;

    IF v_old_id IS NOT NULL AND v_new_id IS NOT NULL AND v_old_id = v_new_id THEN
        UPDATE tv_shows SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = v_new_id;
    ELSE
        IF v_old_id IS NOT NULL THEN
            UPDATE tv_shows SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = v_old_id;
        END IF;
        IF v_new_id IS NOT NULL THEN
            UPDATE tv_shows SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = v_new_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Statement Coordination for TV Junctions:
CREATE TRIGGER trg_genre_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_GenreToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

CREATE TRIGGER trg_keyword_tv_acquire_coord_lock
BEFORE INSERT OR UPDATE OR DELETE ON "_KeywordToTvShow"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- AFTER ROW: Performs the actual revision bump on the parent tv_shows record
CREATE TRIGGER trg_tv_genre_revision
AFTER INSERT OR UPDATE OR DELETE ON "_GenreToTvShow"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

CREATE TRIGGER trg_tv_keyword_revision
AFTER INSERT OR UPDATE OR DELETE ON "_KeywordToTvShow"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

CREATE TRIGGER trg_person_credits_tv_revision
AFTER INSERT OR UPDATE OR DELETE ON "person_credits"
FOR EACH ROW WHEN (COALESCE(NEW."tvShowId", OLD."tvShowId") IS NOT NULL)
EXECUTE FUNCTION trg_fn_bump_tv_metadata_revision();

-- ============================================================================
-- 4. Multi-Parent Deterministic Trigger for Person Name Updates
-- ============================================================================
-- BEFORE STATEMENT: Acquire L2 before any row-level locks are established
CREATE TRIGGER trg_persons_acquire_coord_lock
BEFORE UPDATE OF name ON "persons"
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_acquire_coordination_share_lock();

-- AFTER ROW: Bump revision on all affected parent movies and TV shows (sorted ascending)
CREATE OR REPLACE FUNCTION trg_fn_bump_person_media_revision()
RETURNS TRIGGER AS $$
DECLARE
    v_movie_ids UUID[];
    v_tv_ids    UUID[];
BEGIN
    IF OLD.name IS DISTINCT FROM NEW.name THEN
        -- Level 2 Coordination Lock (Fail-Closed)
        PERFORM 1 FROM embedding_coordination WHERE id = 1 FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'COORDINATION_LOCK_FAILED: Singleton row id=1 missing from embedding_coordination. Person write blocked.';
        END IF;

        -- Collect and sort parent IDs in ascending order to prevent deadlocks
        SELECT ARRAY(
            SELECT DISTINCT "movieId"
            FROM person_credits
            WHERE "personId" = NEW.id AND "movieId" IS NOT NULL
            ORDER BY "movieId" ASC
        ) INTO v_movie_ids;

        SELECT ARRAY(
            SELECT DISTINCT "tvShowId"
            FROM person_credits
            WHERE "personId" = NEW.id AND "tvShowId" IS NOT NULL
            ORDER BY "tvShowId" ASC
        ) INTO v_tv_ids;

        -- Level 3 Deterministic Updates
        IF array_length(v_movie_ids, 1) > 0 THEN
            PERFORM id FROM movies WHERE id = ANY(v_movie_ids) ORDER BY id ASC FOR NO KEY UPDATE;
            UPDATE movies SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = ANY(v_movie_ids);
        END IF;

        IF array_length(v_tv_ids, 1) > 0 THEN
            PERFORM id FROM tv_shows WHERE id = ANY(v_tv_ids) ORDER BY id ASC FOR NO KEY UPDATE;
            UPDATE tv_shows SET metadata_revision = metadata_revision + 1, "updatedAt" = clock_timestamp()
            WHERE id = ANY(v_tv_ids);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_person_name_revision
AFTER UPDATE OF name ON "persons"
FOR EACH ROW EXECUTE FUNCTION trg_fn_bump_person_media_revision();
```

---

## 11. Expanded Test and Acceptance Matrix

> [!IMPORTANT]
> **Status Legend:** In accordance with rigorous verification standards, all tests in this matrix are designated **`SPECIFIED — NOT EXECUTED`**. Phase 5 implementation has not been authorized.

| Test ID     | Test Scenario                                   | Preconditions & Execution Steps                                                                                                   | Expected Outcome                                                         | Protected Invariant | Execution Status         |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------- | ------------------------ |
| **T-P0-01** | Promotion & Cutover Mutual Exclusion            | Promotion holds `FOR SHARE` on coordination row; Cutover issues `SELECT ... FOR UPDATE`                                           | Cutover blocks until promotion commits; 0 deadlocks                      | CC-INV-02           | SPECIFIED — NOT EXECUTED |
| **T-P0-02** | Promotion Starts During Cutover                 | Cutover holds `FOR UPDATE`; Promotion attempts `SELECT ... FOR SHARE`                                                             | Promotion blocks until cutover commits; unblocks and reads new model     | CC-INV-02           | SPECIFIED — NOT EXECUTED |
| **T-P0-03** | Staging During Cutover                          | Staging attempts to commit batch while cutover holds `FOR UPDATE`                                                                 | Staging blocks; unblocks and rejects obsolete model                      | CC-INV-02           | SPECIFIED — NOT EXECUTED |
| **T-P0-04** | Metadata Update During Cutover                  | TMDB sync attempts `FOR SHARE` while cutover holds `FOR UPDATE`                                                                   | Sync blocks until cutover commits; metadata revision bumps cleanly       | CC-INV-03           | SPECIFIED — NOT EXECUTED |
| **T-P0-05** | Conflicting Promotion Workers                   | Worker A (rev 1) and Worker B (rev 2) promote same title                                                                          | Worker B commits; Worker A marked `SUPERSEDED_BY_REVISION`               | C-02                | SPECIFIED — NOT EXECUTED |
| **T-P0-06** | Same Staged Row Promoted Twice                  | Worker 1 and Worker 2 promote staged row `X`                                                                                      | Worker 1 promotes; Worker 2 observes `stage = 'ACTIVE'` and exits        | C-02                | SPECIFIED — NOT EXECUTED |
| **T-P0-07** | Lock-Order Concurrency Test                     | 50 concurrent promotions, syncs, and cutovers execute simultaneously                                                              | 0 deadlocks observed; all operations resolve                             | CC-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-08** | Lease Expiry & Reacquisition (Pause Scenario 1) | Worker A pauses before acquiring lock; lease expires; Worker B acquires (Token 42); Worker A resumes and attempts lock (Token 41) | Worker A lock acquisition returns 0 rows; rejected with `LEASE_NOT_HELD` | CC-INV-04           | SPECIFIED — NOT EXECUTED |
| **T-P0-09** | Stale Worker Renewal                            | Worker A attempts heartbeat after lease expiration                                                                                | Affected rows = 0; renewal fails                                         | CC-INV-04           | SPECIFIED — NOT EXECUTED |
| **T-P0-10** | Invalid Parent Association                      | Staged row references non-existent movie UUID                                                                                     | Returns `PARENT_NOT_FOUND`; transaction aborts                           | DB-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-11** | NULL Embedding Vector                           | Staged row has `embedding IS NULL`                                                                                                | Returns `NULL_VECTOR`; promotion rejected                                | EM-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-12** | Incorrect Actual Dimension                      | `vector_dims(embedding::vector) = 768` when config is 384                                                                         | Returns `DIMENSION_MISMATCH`; promotion rejected                         | EM-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-13** | Stored/Actual Mismatch                          | Stored `dimensions = 384` but actual length = 768                                                                                 | Returns `DIMENSION_MISMATCH`; promotion rejected                         | EM-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-14** | Invalid Vector Values                           | Vector contains `NaN` or `Infinity`                                                                                               | Returns `INVALID_VECTOR_VALUES`; promotion rejected                      | EM-INV-01           | SPECIFIED — NOT EXECUTED |
| **T-P0-15** | Canonical Hash Mismatch                         | Metadata overview edited after batch generation                                                                                   | Staged marked `STALE`; returns `HASH_MISMATCH`                           | EM-INV-03           | SPECIFIED — NOT EXECUTED |
| **T-P0-16** | Metadata Change After Gen                       | Parent `metadata_revision` bumped; staged revision older                                                                          | Staged marked `STALE`; returns `STALE_METADATA`                          | CC-INV-03           | SPECIFIED — NOT EXECUTED |
| **T-P0-17** | Immutable `generated_at`                        | Staged embedding promoted to ACTIVE                                                                                               | `generated_at` unchanged; `promoted_at` assigned                         | C-20                | SPECIFIED — NOT EXECUTED |
| **T-P0-18** | Same-Model Cutover Duplicates                   | Cutover executed with active model                                                                                                | All active rows archived; 1 active per title remains                     | DB-INV-02           | SPECIFIED — NOT EXECUTED |
| **T-P0-19** | Candidate-Set Consistency                       | Only candidate IDs in `_cutover_candidates` promoted                                                                              | Promoted count exactly equals validated count                            | C-06                | SPECIFIED — NOT EXECUTED |
| **T-P0-20** | Incomplete Cutover Coverage                     | 1 movie lacks staged embedding                                                                                                    | Cutover raises `INSUFFICIENT_COVERAGE`; rolls back                       | C-06                | SPECIFIED — NOT EXECUTED |
| **T-P0-21** | Watermark Conflict                              | Destination watermark exists with differing date                                                                                  | Reconciled safely; legacy data preserved                                 | C-21                | SPECIFIED — NOT EXECUTED |
| **T-P0-22** | Watermark Migration Crash                       | Crash simulated after insert but before verification                                                                              | Re-run safely completes and verifies readback                            | C-21                | SPECIFIED — NOT EXECUTED |
| **T-P0-23** | Stale Sync Worker (Pause Scenario 2 & 3)        | Worker A holds lock; Worker B blocks; Worker A commits safely; Worker B unblocks to acquire Token 42                              | Worker A writes commit safely; Worker B acquires lease next              | CC-INV-04           | SPECIFIED — NOT EXECUTED |
| **T-P0-24** | Same-Type Sync Workers                          | Two movie sync workers race to acquire lease                                                                                      | Exactly one succeeds; second receives 409 Conflict                       | CC-INV-04           | SPECIFIED — NOT EXECUTED |
| **T-P0-25** | Crash During Pagination                         | Crash on page 3 of 10                                                                                                             | Durable watermark not advanced; replays page 1                           | C-10                | SPECIFIED — NOT EXECUTED |

---

## 12. Implementation Dependency List

The following components will be required during future implementation stages:

1. **Prisma Schema (`schema.prisma`):**
   - Addition of `metadata_revision INTEGER NOT NULL DEFAULT 0` to `Movie` and `TvShow`.
   - Addition of `embedding_coordination` model.
   - Addition of `promoted_at` and `archived_at` to `media_embeddings`.
2. **Database Migrations:**
   - Migration for `embedding_coordination` singleton table and provisional seed.
   - Migration for partial unique indexes on `media_embeddings` (`movie_id` and `tv_show_id` where `lifecycle_stage = 'ACTIVE'`).
   - Migration for non-destructive watermark extraction.
   - Migration for scalar metadata revision triggers on `movies` and `tv_shows`.
   - Migration for metadata revision triggers on junction tables, person credits, and persons.
3. **NestJS Services:**
   - Implementation of `VectorRepository.serializeVector` dimension and normalization validation.
   - Implementation of `promoteStagedEmbedding` with Level 2 / Level 3 locks and 17 invariant checks.
   - Implementation of lock-acquisition fencing verification in `persist_sync_checkpoint`.
4. **Python Scripts (`ml/`):**
   - Direct pass-through ingestion of canonical text in `generate_embeddings.py`.
   - Output of immutable `generated_at` in JSONL.

---

## 13. Updated Decision Register

| Decision ID | Description                                                                                                                         | Blocking Status                                       | Owner Resolution Path                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TD-08**   | Production model selection (`all-MiniLM-L6-v2` 384d vs. `all-mpnet-base-v2` 768d vs. `Nemotron-3.5-Embed-1B-BF16` 2048d/1024d/512d) | **Blocks Stage 5.3+ Migrations**                      | Authorize Stage 5.0 to run the 50-probe stratified evaluation on target hardware after hardware preflight and fixture generation.                               |
| **TD-11**   | Scoring weights ($w_S, w_A, w_F, w_Q, w_N$)                                                                                         | Non-blocking (Defaults: 0.35, 0.25, 0.20, 0.10, 0.10) | Tune against personal watch history in Stage 5.7.                                                                                                               |
| **TD-12**   | MMR lambda parameter ($\lambda_\text{MMR} = 0.70$)                                                                                  | Non-blocking (Default: 0.70)                          | Evaluate via Intra-List Diversity in Stage 5.7.                                                                                                                 |
| **TD-13**   | Provisional MRR benchmark threshold ($\ge 0.60$)                                                                                    | Non-blocking (Provisional Guidance)                   | Empirical benchmark reference point; does not act as a hard disqualifier if relative gains across models are evident. Refine after Stage 5.0 empirical results. |
| **TD-14**   | HISTORICAL embedding retention policy                                                                                               | Non-blocking                                          | Owner decision: retain indefinitely or purge older than 30 days.                                                                                                |

---

## 14. Cross-Document Consistency Audit & Final Readiness Assessment

### 14.1: Traceable Cross-Document Architecture Reconciliation & Implementation Evidence

To resolve historical documentation discrepancies, the architectural division of responsibility between the NestJS backend and the Python ML package was verified by source inspection and reconciled against `docs/ARCHITECTURE.md` and `AGENTS.md`:

#### 14.1.1: Reconciled Database Access Architecture

1. **NestJS Application Layer (`apps/api`):**
   - Owns all interactive REST API endpoints, business logic, TMDB proxying and ingestion, personal library mutations, statistics aggregation, and data import/export.
   - Interacts with PostgreSQL exclusively via the **Prisma ORM Client** (`PrismaService`), with raw SQL strictly encapsulated inside `VectorRepository` (`$queryRaw`, `$executeRaw`).
   - Does not perform offline machine learning, heavy clustering, or 2D projection.
2. **Python ML Execution Layer (`ml/`):**
   - Designed strictly as an **offline or on-demand execution layer**; there is no persistent ML microservice, REST daemon, message broker, or task worker.
   - Connects **directly to PostgreSQL via `psycopg2`** to perform bulk vector reading and writing (as documented in `docs/ARCHITECTURE.md` Section 2.4 and architectural diagrams).
   - Data flows from Python directly into PostgreSQL tables (`media_embeddings`, similarity tables); NestJS then serves this persisted data via typed REST endpoints to the frontend. Data never flows in reverse.
   - _Correction Note:_ Prior draft proposals referred to a "subprocess / JSONL over stdio" protocol. No such mechanism exists in the codebase or architectural specifications. Both `docs/ARCHITECTURE.md` and `ml/pyproject.toml` specify direct PostgreSQL access via `psycopg2`.

#### 14.1.2: Repository Implementation Evidence Matrix

The repository was audited to establish what is currently implemented versus what is planned or specified:

| Component / Subsystem            | Repository Location                                                            | Current Implementation Status | Verified Source Evidence                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prisma Catalogue Models**      | `apps/api/prisma/schema.prisma`                                                | **CURRENTLY IMPLEMENTED**     | `Movie`, `TvShow`, `Season`, `Episode`, `Genre`, `Keyword`, `Person`, `PersonCredit` models active                                                             |
| **Prisma Junction Tables**       | `apps/api/prisma/migrations/20261106000000_catalogue_foundation/migration.sql` | **CURRENTLY IMPLEMENTED**     | Explicit tables `_GenreToMovie`, `_GenreToTvShow`, `_KeywordToMovie`, `_KeywordToTvShow` active with `"A"`=tag, `"B"`=media                                    |
| **Prisma Library Models**        | `apps/api/prisma/schema.prisma`                                                | **CURRENTLY IMPLEMENTED**     | `UserLibraryEntry`, `ViewingEvent`, `EpisodeProgress`, `SeasonRating` active with strict invariants                                                            |
| **NestJS Database Access**       | `apps/api/src/database/`                                                       | **CURRENTLY IMPLEMENTED**     | `PrismaService`, `VectorRepository` active; 137 integration tests passing                                                                                      |
| **Python ML Scaffolding**        | `ml/pyproject.toml`, `ml/tests/test_environment.py`                            | **CURRENTLY IMPLEMENTED**     | Python 3.12 virtualenv, `ruff`, `pyproject.toml` packaging, and 4 mathematical tests passing                                                                   |
| **Python Database Runtime**      | `ml/` subdirectories (`embeddings/`, `scripts/`, etc.)                         | **SPECIFIED FOR PHASE 5+**    | Subdirectories contain `.gitkeep` only; `psycopg2-binary>=2.9.9` declared in `pyproject.toml` but **no Python database connection code is currently executed** |
| **Metadata Revision Tracking**   | `metadata_revision` column & triggers                                          | **REQUIRES FUTURE MIGRATION** | Proposed in Phase 5; columns do not exist in current schema; triggers not yet applied                                                                          |
| **Scalar Tagline & Status**      | `movies.tagline`, `movies.status`, `tv_shows.tagline`                          | **REQUIRES FUTURE MIGRATION** | Required for canonical text invalidation; must be added in Phase 5 migration                                                                                   |
| **Coordination Table & Cutover** | `embedding_coordination`, `execute_model_cutover`                              | **SPECIFIED FOR PHASE 5+**    | Fully specified DDL and PL/pgSQL; not executed against database                                                                                                |
| **Benchmark Suite & Probes**     | `ml/benchmark/`                                                                | **NOT EXECUTED**              | 50-probe evaluation protocol mathematically specified; offline benchmark run not yet executed                                                                  |

3. **Recommendation Engine LLM Independence:**
   - _Documentation Inspection:_ `AGENTS.md` (Section 3.2) explicitly mandates that the recommendation scoring formula $\text{Score} = 0.35S + 0.25P + 0.20M + 0.10Q + 0.10N$ is completely independent of LLMs. Ollama is strictly an optional auxiliary enhancement.
4. **UMAP Visualization Boundary:**
   - _Documentation Inspection:_ `AGENTS.md` (Section 3.3) mandates that all similarity calculations, nearest-neighbour queries, and clustering run on original high-dimensional vectors, while 2D UMAP coordinates (`umapX`, `umapY`) are generated strictly for PixiJS WebGL canvas layout and are **never** used for similarity queries or ranking.

---

### Final Readiness Assessment Verdicts (V0.7.8)

1. **C6 Fail-Closed L2 Lock Acquisition:** `CORRECTED — SPECIFIED (trg_fn_acquire_coordination_share_lock and all coordination callers check FOUND; raise COORDINATION_LOCK_FAILED if singleton id=1 is missing)`
2. **C6 All Media Catalogue DML Coordination:** `CORRECTED — SPECIFIED (statement triggers on movies and tv_shows cover BEFORE INSERT OR UPDATE OR DELETE, preventing v_total_elig drift during cutover; decoupled from BEFORE UPDATE revision bumps)`
3. **C6 Transactional Privileged Maintenance Barrier:** `CORRECTED — EXECUTABLE PL/pgSQL & SESSION-BOUNDED (valid DO $$ blocks inside enclosing transaction; GET DIAGNOSTICS = ROW_COUNT requires exactly 3 leases on acquisition and release; session-local connection boundary defined; multi-connection pg_restore prohibited without cold maintenance window; tested against PostgreSQL 16)`
4. **Stage 5.0 Benchmark Specification & MRR@10:** `CORRECTED — FULLY SPECIFIED (MRR@10 formulated with exact first-rank rank_q and consensus grade mechanics; tripartite serialization taxonomy defined; deterministic selection algorithm specified; 50 candidate probes enumerated; isolated environments .venv-baseline and .venv-nemotron reconciled; dataset generation blocked pending catalogue seeding)`
5. **C6 TV Junction-Table Names:** `CORRECTED — REPOSITORY INSPECTED (unified _GenreToTvShow and _KeywordToTvShow across all DDL and inventories; column "B" media parent semantics confirmed)`
6. **C4 Safe Watermark Parsing & Reconciliation:** `CORRECTED — SPECIFIED (raw string-to-jsonb exception wrapping; identical [2000-01-01, now+5m] date bounds; 1-based pagination consistency; status allowlist; atomic readback)`
7. **Cross-Document Architecture Reconciliation:** `CORRECTED — RECONCILED (NestJS Prisma application runtime vs. Python psycopg2 offline batch execution aligned with ARCHITECTURE.md; implementation evidence matrix established)`
8. **Post-Cutover Assertion Count Harmony:** `CORRECTED — HARMONIZED (exactly 10 post-cutover assertions: 7 embedding lifecycle invariants + 3 coordination assertions: row update count, active readback, pending cleared)`
9. **Scalar Metadata Revision Coverage:** `CORRECTED — SCHEMA INSPECTED — PHASE 5 PREREQUISITES DOCUMENTED`
10. **Canonical-Text Dependency Completeness:** `CORRECTED — DOCUMENTED`
11. **Candidate Identity and Uniqueness:** `CORRECTED — DOCUMENTED`
12. **Lease Fencing & Lock Acquisition (Option A):** `CORRECTED — DOCUMENTED`
13. **Benchmark Reproducibility:** `CORRECTED — DOCUMENTED`
14. **Stage Boundaries & Governance:** `CORRECTED — DOCUMENTED`

---

### Final Recommendation

# **READY FOR PROJECT OWNER REVIEW — STAGE 5.0 NOT YET AUTHORIZED**

All remaining technical design issues have been systematically resolved directly within the specification document. The locking protocol, table names, watermark migration, and architecture claims are fully reconciled with existing repository code and migrations. No production application code, database schema, migrations, or dependencies were altered. Stage 5.0 and Stage 5.1 remain strictly unauthorized until explicit project-owner approval is granted.
