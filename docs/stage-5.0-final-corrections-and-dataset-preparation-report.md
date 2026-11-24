# CineSphere — Stage 5.0 Final Design Corrections & Evaluation Data Preparation Report

**Document Version:** 1.0.0  
**Date:** November 24, 2026  
**Auditor:** Senior ML Engineer, Data Engineer & Technical Auditor  
**Repository:** `NilangaAbhisheka/CineSphere`  
**Target Design Document:** `docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md` (Internal Version V0.7.8 Preserved)  
**Final Readiness Verdict:** **`DOCUMENTATION CORRECTIONS COMPLETE — DATASET BLOCKED`**

---

## A. Executive Summary

This audit report documents the completion of the final bounded documentation correction pass on the Phase 5 technical design proposal, the empirical data readiness audit of the CineSphere PostgreSQL media catalogue, and the preparation of evaluation tooling for Stage 5.0 (Offline Embedding Model Evaluation).

All eight required documentation corrections were successfully integrated into `docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md` while preserving internal document version **V0.7.8**. The document's structural integrity, LaTeX formatting, and markdown code fence balance (exactly 34 code fences) have been verified.

The 50 predefined benchmark probes spanning five strata (Mainstream, International, Indie, Serialized TV, and Stress Cases) were extracted into the standalone fixture file `ml/benchmark/fixtures/probes_v1.json`. The deterministic dataset preparation script `ml/benchmark/scripts/prepare_catalogue_fixture.py` was constructed, implementing strict read-only database connections, candidate selection, benchmark canonical text serialization with a strict null/empty omission policy, SHA-256 digest computation, and manifest generation.

However, an empirical audit of the PostgreSQL database (`cinesphere-postgres`) revealed that the database contains synthetic integration test data (`Test Movie...`, `Test Show...`) rather than a seeded TMDB media catalogue. Specifically:
- **Movies with non-empty overview:** 307 available vs. 1,400 required (deficit: 1,093).
- **TV shows with non-empty overview:** 302 available vs. 600 required (deficit: 298).
- **Mandatory benchmark probes present in DB:** 0 available vs. 50 required (deficit: 50).

In accordance with **Section 7 (Stop Conditions)** of the audit charter, the evaluation dataset generation was **failed closed**. No synthetic records were fabricated, and no unapproved data sources (e.g. TMDB daily export dumps) were silently substituted. The final evaluation dataset (`catalogue_snapshot_v1.jsonl`) remains blocked until the local database is seeded via authorized TMDB sync.

---

## B. Documentation Corrections (Audit of Proposal V0.7.8 Modifications)

The following eight technical corrections and specifications were integrated into `docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md`:

### 1. Section 8.5: Formal Designation of MRR@10 and Consensus Threshold
- Formally designated the mean reciprocal rank metric as **MRR@10** (evaluating the reciprocal rank of the first relevant candidate within the top 10 retrieved items, or 0 if none appear in the top 10).
- Clarified that the consensus relevance threshold $g(c) \ge 1.5$ represents the arithmetic mean of two rater grades, which is satisfied when $(g_1 + g_2) / 2 \ge 1.5$ (e.g., $(1 + 2)/2 = 1.5$). It does **not** require both raters to assign a grade of 2 or 3.

### 2. Section 8.7.1: Device-Specific Performance Reporting Boundaries
- Added Section 8.7.1 establishing strict boundaries for hardware performance reporting.
- Explicitly documented that CPU and GPU latency/throughput figures must be reported separately and cannot be compared apples-to-apples.
- Noted that while Model C (`Nemotron-3.5-Embed-1B`) requires GPU execution to achieve acceptable latency, Models A (`all-MiniLM-L6-v2`) and B (`all-mpnet-base-v2`) can be evaluated on both CPU and GPU, requiring per-device latency and throughput tables.

### 3. Section 8.10: Re-Classification of Nemotron Feasibility
- Re-classified the feasibility assessment of `Nemotron-3.5-Embed-1B` into three distinct epistemic categories:
  1. **Verified Hardware Facts:** NVIDIA GeForce RTX 3050 Laptop GPU, Ampere architecture (Compute Capability 8.6), 6 GB dedicated GDDR6 VRAM, 2,048 CUDA cores, 16 GB host RAM, Windows 11.
  2. **Estimated Engineering Requirements:** FP16/BF16 weights require ~3.1 GB VRAM. At batch size $B=1$ with seq_len $\le 256$, total VRAM footprint is estimated at ~5.0 GB (~1.0 GB safety margin). The NVFP4 quantization variant requires Blackwell architecture (Compute Capability 10.0+) and is completely unsupported on Ampere.
  3. **Untested Assumptions:** Actual inference latency, memory stability at batch size $B \ge 4$, PyTorch allocator fragmentation under Windows WDDM, and sentence-transformers v3 compatibility remain untested.
- Mandated a strict standalone preflight script before any benchmark execution.

### 4. Section 8.11: Canonical Text Tripartite Taxonomy
- Established a formal three-way taxonomy to reconcile architectural documentation with code reality:
  1. **Existing Application Reality:** No canonical text serializer currently exists in `apps/api` or `ml/`. `tmdb.mapper.ts` only maps TMDB DTOs to Prisma models. Furthermore, the `person_credits` table does not store department, job, or billing order.
  2. **Benchmark Canonical Text Serialization:** Specifically defined for the Stage 5.0 benchmark, joining genres, keywords, and up to 5 cast members, while omitting director lines when unresolvable.
  3. **Future Production Canonical Text Serialization:** Production serialization in Stage 5.1 will require either schema enhancements (adding job/order to `person_credits`) or raw TMDB JSON payload storage.

### 5. Section 8.11: Deterministic Selection Algorithm
- Defined the exact algorithm for generating the 2,000-record benchmark snapshot:
  - Step 1: Reserve all 50 predefined benchmark probes first by `(media_type, tmdb_id)`.
  - Step 2: Select 1,362 additional movies and 588 additional TV shows having non-null and non-empty overviews, excluding the probe media.
  - Step 3: Sort candidates by `ORDER BY popularity DESC, voteCount DESC, releaseDate/firstAirDate DESC, tmdbId ASC`.
  - Step 4: Deduplicate on composite key `(media_type, tmdb_id)`.
  - Step 5: Final output ordering strictly by `ORDER BY media_type ASC, tmdb_id ASC`.

### 6. Section 8.11: Supporting Benchmark Artifact Specifications
- Specified the format and schemas for all Stage 5.0 benchmark fixtures:
  - `ml/benchmark/fixtures/probes_v1.json`: JSON array of 50 probes.
  - `ml/benchmark/fixtures/catalogue_snapshot_v1.jsonl`: Line-delimited JSON with metadata and canonical text.
  - `ml/benchmark/fixtures/catalogue_snapshot_v1.sha256`: Standard sha256sum formatted checksum.
  - `ml/benchmark/fixtures/catalogue_snapshot_v1.manifest.json`: Metadata manifest recording record counts, probe counts by stratum, parameters, and timestamps.

### 7. Section 9.1: Python Virtual Environment Reconciliation
- Reconciled the generic `.venv` reference in Section 9.1 to the multi-environment architecture established in Section 8.10:
  - `.venv-baseline`: Python 3.11 with PyTorch (CPU or CUDA 12.1) and sentence-transformers for Models A and B.
  - `.venv-nemotron`: Python 3.11 with PyTorch 2.5+, CUDA 12.4+, and Hugging Face Transformers for Model C.

### 8. Section 14.1.2: Benchmark File Path Standardization
- Standardized all benchmark fixture and script references from disparate paths to the canonical project directory: `ml/benchmark/fixtures/` and `ml/benchmark/scripts/`.

### Structural Integrity Verification
- Verified markdown code fences across the document: exactly 34 true markdown code fences (` ``` `), perfectly balanced and matched.

### C. Model B Identity Verification

The authoritative Model B identifier is confirmed as `sentence-transformers/all-mpnet-base-v2`.

**Evidence:**
- 4 occurrences in `docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md` (Sections 8.1, 8.7, 8.7.1, 8.10).
- Consistent with `docs/DATABASE_DESIGN.md` and all prior proposal versions (V0.7.4, V0.7.6, V0.7.7).

**Correction Applied:** A prior draft of this audit report (Section B, item 2) incorrectly referenced Model B as `` `bge-base-en-v1.5` ``. This was an auditor transcription error. The proposal has never contained that identifier. The reference in this report has been corrected to `` `all-mpnet-base-v2` ``. No change to the Phase 5 proposal itself was required.

---

## C. Source Catalogue Assessment

An empirical read-only audit of the PostgreSQL database (`postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public`) was performed using `psycopg2` in `readonly=True` session mode.

### Database Audit Findings

| Metric | Target Quota | Database Count | Available for Benchmark | Deficit | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Total Movies** | N/A | 1,249 | 1,249 | N/A | Informational |
| **Movies with Non-Empty Overview** | 1,400 | 307 | 307 | **1,093** | **FAILED** |
| **Total TV Shows** | N/A | 2,174 | 2,174 | N/A | Informational |
| **TV Shows with Non-Empty Overview** | 600 | 302 | 302 | **298** | **FAILED** |
| **Predefined Probes Present in DB** | 50 | 0 | 0 | **50** | **FAILED** |
| **Total Usable Records** | 2,000 | 609 | 609 | **1,391** | **FAILED** |

### Qualitative Analysis of Database Contents
1. **Synthetic Integration Test Data:** Inspection of `title` and `name` columns revealed that the database contains artifacts generated by Phase 3 and Phase 4 automated integration tests:
   - Sample movie titles: `Test Movie 828800201`, `Integration Movie 104`, `Test Movie 503`.
   - Sample TV show titles: `E-1 Show`, `Test Show 401`, `Integration Series 22`.
   - 925 out of 1,249 movies match `Test Movie%`.
   - 1,467 out of 2,174 TV shows match `Test Show%` or `E-%`.
2. **Missing Benchmark Probes:** None of the 50 predefined benchmark probes (`Inception`, `The Dark Knight`, `Breaking Bad`, `Parasite`, `Spirited Away`, etc.) exist in the database.
3. **Missing Schema Attributes for Canonical Text:** The relational table `person_credits` contains only `(id, personId, movieId, tvShowId)` without `job`, `department`, or `order` columns. This confirms that directors cannot be distinguished from cast in the current database schema, reinforcing the importance of the Section 8.11 canonical text omission policy.

### Stop Condition Enforcement
Under Section 7 of the audit instructions:
- The agent is **strictly prohibited from fabricating synthetic probe data** or placeholder metadata.
- The agent is **strictly prohibited from silently bypassing the database** and querying external TMDB APIs or TMDB daily export files.
- The evaluation dataset generation was halted immediately upon detection of the data deficit, and the execution failed closed.

---

## D. Dataset Preparation & Tooling Status

### 1. `ml/benchmark/fixtures/probes_v1.json`
- **Location:** `ml/benchmark/fixtures/probes_v1.json`
- **Format:** JSON array containing 50 probe definitions.
- **Stratum Distribution:**
  - `Mainstream`: 10 probes (PB-01 to PB-10)
  - `International`: 10 probes (PB-11 to PB-20)
  - `Indie`: 10 probes (PB-21 to PB-30)
  - `Serialized TV`: 10 probes (PB-31 to PB-40)
  - `Stress Cases`: 10 probes (PB-41 to PB-50)
- **Media Type Distribution:** 38 Movies, 12 TV Shows.
- **Fields per Probe:** `probe_id`, `media_type`, `tmdb_id`, `title`, `stratum`, `selection_rationale`, `evaluation_notes`.

### 2. `ml/benchmark/scripts/prepare_catalogue_fixture.py`
- **Location:** `ml/benchmark/scripts/prepare_catalogue_fixture.py`
- **Features Implemented:**
  - Strict read-only database session (`conn.set_session(readonly=True, autocommit=True)`).
  - Clean DSN handling (stripping unsupported URI query parameters like `?schema=public`).
  - Column quoting to handle PostgreSQL case-folding on camelCase columns (`"tmdbId"`, `"releaseDate"`, etc.).
  - Automated readiness audit comparing database counts against quotas.
  - Fail-closed stop condition enforcement (`MissingMandatoryProbesError`, `InsufficientCatalogueError`).
  - Deterministic candidate selection (50 probes reserved first, 1,362 movies and 588 TV shows selected by popularity, vote count, date, and tmdbId).
  - Canonical text serialization implementing the strict null/empty line omission policy.
  - Deterministic sorting by `media_type ASC, tmdb_id ASC`.
  - SHA-256 digest computation and manifest generation.
- **Verification Execution:**
  - Executed in test mode and `--verify-only` mode.
  - Correctly identified missing probes (50/50 missing) and movie/TV overview deficits (1,093 movie deficit, 298 TV deficit).
  - Logged full diagnostic details and exited with code 1, refusing to generate invalid fixtures.

### 3. Evaluation Dataset Status
- `ml/benchmark/fixtures/catalogue_snapshot_v1.jsonl`: **BLOCKED** (database unseeded).
- `ml/benchmark/fixtures/catalogue_snapshot_v1.sha256`: **BLOCKED**.
- `ml/benchmark/fixtures/catalogue_snapshot_v1.manifest.json`: **BLOCKED**.

---

## E. Validation Results Summary Table

| Requirement / Check | Specification | Observed Status | Verdict |
| :--- | :--- | :--- | :--- |
| **Proposal Internal Version** | Preserved at V0.7.8 | `PHASE_5_..._V0.7.4_CORRECTION_ADDENDUM.md` preserved at V0.7.8 | **PASS** |
| **MRR@10 Metric Specification** | Designated MRR@10, consensus threshold $g(c) \ge 1.5$ | Fully documented in Section 8.5 | **PASS** |
| **Device Performance Boundaries** | Separate CPU vs GPU reporting; no cross-hardware conflation | Documented in Section 8.7.1 | **PASS** |
| **Nemotron Feasibility Clarity** | Split into verified facts, engineering estimates, and untested assumptions | Documented in Section 8.10 | **PASS** |
| **Canonical Text Serialization** | Tripartite taxonomy defined; null/empty line omission rule | Documented in Section 8.11 | **PASS** |
| **Selection Algorithm** | Deterministic: 50 probes reserved, 1,950 candidates by sort criteria | Documented in Section 8.11 | **PASS** |
| **Environment Alignment** | Reconciled `.venv-baseline` vs `.venv-nemotron` | Documented in Section 9.1 | **PASS** |
| **Benchmark Directory Alignment** | Standardized to `ml/benchmark/fixtures/` and `scripts/` | Documented in Section 14.1.2 | **PASS** |
| **Code Fence Parity** | Evenly paired markdown code blocks | Exactly 34 fences, fully balanced | **PASS** |
| **Probes Fixture File** | 50 probes across 5 strata in `probes_v1.json` | Generated at `ml/benchmark/fixtures/probes_v1.json` | **PASS** |
| **Preparation Script** | Deterministic extraction script with fail-closed checks | Created at `ml/benchmark/scripts/prepare_catalogue_fixture.py` | **PASS** |
| **Database Probe Sufficiency** | 50/50 predefined probes present in PostgreSQL | 0/50 found in database | **BLOCKED** |
| **Database Movie Quota** | $\ge 1,400$ movies with non-empty overviews | 307 found in database (deficit: 1,093) | **BLOCKED** |
| **Database TV Quota** | $\ge 600$ TV shows with non-empty overviews | 302 found in database (deficit: 298) | **BLOCKED** |
| **Stop Conditions Enforcement** | Fail closed on missing data; no synthetic generation | Triggered; exited with code 1; no partial files written | **PASS** |

---

## F. Nemotron Feasibility Assessment Status

| Category | Item | Technical Findings & Boundaries |
| :--- | :--- | :--- |
| **Verified Hardware Facts** | Host GPU Model | NVIDIA GeForce RTX 3050 Laptop GPU |
| | Architecture / Compute Capability | Ampere (CC 8.6) |
| | Dedicated VRAM | 6,144 MB GDDR6 |
| | Host Memory / OS | 16 GB DDR4/DDR5; Windows 11 64-bit |
| **Estimated Requirements** | Model Weight Footprint | FP16/BF16: ~3.1 GB (1.2 billion parameters) |
| | Activation Memory ($B=1$, $L \le 256$) | Estimated ~1.2 GB |
| | PyTorch / CUDA Overhead | Estimated ~0.7 GB |
| | Total Estimated Memory | Estimated ~5.0 GB (leaves ~1.1 GB safety margin in 6 GB VRAM) |
| | NVFP4 Feasibility | **IMPOSSIBLE on Ampere** (NVFP4 tensor cores require Blackwell CC 10.0+) |
| **Untested Assumptions** | Memory Stability at $B \ge 4$ | High risk of CUDA Out-Of-Memory (OOM) |
| | Context Length Scaling | Long contexts ($L > 512$) may breach the 6 GB VRAM limit |
| | WDDM Memory Reservation | Windows Display Driver Model reserves ~0.5–0.8 GB VRAM for desktop rendering |
| | Sentence-Transformers v3 | Compatibility with Nemotron architecture under Windows needs empirical verification |
| **Mandatory Preflight** | Standalone Script | A preflight script allocating synthetic tensors of model size must run prior to benchmark |

---

## G. Scope Compliance & Non-Goals Verification

1. **Zero Production Code Modifications:** No files in `apps/api/` or `apps/web/` were modified.
2. **Zero Database Migrations:** No Prisma schema files (`schema.prisma`) or migration scripts were created or modified.
3. **Zero Database Writes:** All database interactions were strictly read-only (`readonly=True`). The database state remains unchanged.
4. **Zero Model Inference:** No machine learning models were downloaded, loaded, or executed.
5. **Zero Git Mutations:** No git commits or push operations were performed.

---

## H. Final Readiness Verdict & Recommended Next Actions

### Final Verdict: **`DOCUMENTATION CORRECTIONS COMPLETE — DATASET BLOCKED`**

The documentation corrections are technically validated and complete. The benchmark preparation tooling is fully implemented and operating with fail-closed integrity. However, generating the final 2,000-record snapshot dataset is blocked due to the absence of real TMDB media records in the local PostgreSQL database.

### Authorized Next Actions to Unblock Evaluation
1. **Seed the Local Database via TMDB Sync:**
   - Execute the existing `apps/api` TMDB synchronization service to ingest popular movies and TV shows into PostgreSQL.
   - Specifically ensure that the 50 predefined probe TMDB IDs (`probes_v1.json`) are included in the synchronization batch.
   - Verify that the database contains at least 1,400 movies and 600 TV shows with non-empty overviews.
2. **Execute Dataset Extraction:**
   - Run `python ml/benchmark/scripts/prepare_catalogue_fixture.py`.
   - The script will extract the deterministic 2,000 records, serialize canonical texts, compute the SHA-256 checksum, and emit `catalogue_snapshot_v1.jsonl`, `catalogue_snapshot_v1.sha256`, and `catalogue_snapshot_v1.manifest.json`.
3. **Run Nemotron GPU Preflight:**
   - Execute a minimal GPU memory verification script in `.venv-nemotron` to confirm that 6 GB VRAM safely accommodates the model before downloading full weights.
