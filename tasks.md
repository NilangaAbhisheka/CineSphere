# CineSphere — Project Progress Tracker

> **Maintenance Rule:** Update this file whenever a task is completed, deferred, added, or blocked. Never claim progress that has not been verified and tested. Mark tasks complete only after implementation is confirmed working.

---

## Project Overview

| Field             | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Project           | CineSphere                                                                        |
| Type              | Personal movie and TV tracking, discovery, recommendation, and analytics platform |
| Architecture      | TypeScript monorepo (Next.js + NestJS) with separate Python ML package            |
| Phase             | **Phase 2 — Catalogue and TMDB Integration**                                      |
| Current Milestone | Phase 2B Complete — TMDB Ingestion & Reliability Audit Verified                    |
| Last Updated      | 2026-11-07                                                                        |

---

## Overall Progress

```
Phase 1  — Project Foundation                  ████████████████  95% (monorepo, docker, pgvector, prisma, tooling, CI workflow)
Phase 2  — Catalogue and TMDB Integration      ████████░░░░░░░░  50% (Phase 2A schema & Phase 2B ingestion/audit verified)
Phase 3  — Personal Library and Tracking       ░░░░░░░░░░░░░░░░  0%
Phase 4  — Statistics and Data Import/Export   ░░░░░░░░░░░░░░░░  0%
Phase 5  — Recommendation Engine Foundation    ░░░░░░░░░░░░░░░░  0%
Phase 6  — Recommendation Intelligence         ░░░░░░░░░░░░░░░░  0%
Phase 7  — Local LLM Integration               ░░░░░░░░░░░░░░░░  0%
Phase 8  — Movie Universe                      ░░░░░░░░░░░░░░░░  0%
Phase 9  — Testing, Security and QA            ░░░░░░░░░░░░░░░░  0%
Phase 10 — Deployment and Portfolio Prep       ░░░░░░░░░░░░░░░░  0%
```

---

## Blocked Tasks

> _None currently blocked._

---

## Pending Technical Decisions

| ID    | Decision                                | Context                                                                                                                                                    | Status       |
| ----- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| TD-01 | License selection                       | No license chosen yet. Decide before public release.                                                                                                       | **Open**     |
| TD-02 | Monorepo tooling                        | Choose between Turborepo and Nx. Resolved: Turborepo with pnpm workspaces (lightweight, zero unnecessary plugins).                                         | **Resolved** |
| TD-03 | NestJS module structure                 | Decide on module boundary strategy. Resolved: Feature/domain modular architecture with global database module.                                             | **Resolved** |
| TD-04 | Prisma + pgvector strategy              | Prisma lacks native vector operators. Resolved: Prisma for relational models + isolated parameterized `$queryRaw` in `VectorRepository`.                   | **Resolved** |
| TD-05 | Frontend state management               | Determine whether Zustand, Jotai, or React Context is sufficient for client state before significant UI work begins.                                       | **Open**     |
| TD-06 | Recommendation weight tuning strategy   | Initial scoring weights (S=0.35, P=0.25, M=0.20, Q=0.10, N=0.10) are unvalidated. Document evaluation methodology and when weights should be revised.      | **Open**     |
| TD-07 | TMDB data seeding scope                 | Decide which TMDB datasets to pre-fetch at startup versus on-demand. Avoids processing entire catalogue.                                                   | **Open**     |
| TD-08 | Embedding model selection               | Select the specific Sentence Transformers model (e.g., `all-MiniLM-L6-v2`, `all-mpnet-base-v2`). Consider embedding dimensionality and quality tradeoffs.  | **Open**     |
| TD-09 | Public portfolio anonymization strategy | Determine exactly which data to include/exclude in the hosted demo. Decide whether to ship a precomputed fixture dataset or redact from the live database. | **Open**     |
| TD-10 | Authentication approach                 | Single-user local app may use a simple password or no auth. Hosted demo needs at minimum a read-only public view with optional owner login.                | **Open**     |

---

## Phase 1 — Project Foundation

**Objective:** Establish the monorepo structure, tooling, development environment, CI baseline, and documentation foundation.

**Dependencies:** None (starting phase).

**Completion Criteria:**

- Repository structure matches the documented target layout.
- All applications run locally via Docker Compose.
- Linting, formatting, and type-checking pass on an empty codebase.
- Core documentation files are in place and internally consistent.
- `.env.example` is defined with all required variables.

---

### 1.1 Documentation and Architecture

- [x] Create `tasks.md` — project progress tracker
- [x] Create `README.md` — project overview and local setup guide
- [x] Create `docs/PROJECT_PLAN.md` — vision, scope, requirements, phases
- [x] Create `docs/ARCHITECTURE.md` — system architecture and component design
- [x] Create `docs/DATABASE_DESIGN.md` — proposed database schema and ER diagram
- [x] Create `docs/AI_DEVELOPMENT_GUIDE.md` — AI coding agent standards and workflow
- [x] Create `.cursor/rules/cinesphere.mdc` — Cursor project-wide instructions
- [x] Create `AGENTS.md` — Antigravity engineering guidelines & project instructions
- [ ] Create `docs/api/` — API specification stubs (defer to Phase 2)
- [x] Cross-check all documentation for consistency

### 1.2 Repository Initialization

- [x] Initialize Git repository with a meaningful `.gitignore`
- [x] Establish root configuration files (`.editorconfig`, `.gitattributes`, `.dockerignore`, `.nvmrc`)
- [x] Set up TypeScript monorepo root (`package.json`, `tsconfig.json`, `pnpm-workspace.yaml`, `turbo.json`)
- [x] Choose and configure monorepo tool (Turborepo with pnpm workspaces) — see TD-02
- [x] Scaffold `apps/web/` — Next.js 14+ App Router + TypeScript + Tailwind CSS
- [x] Scaffold `apps/api/` — NestJS + TypeScript REST API + Swagger
- [x] Scaffold `packages/shared/` — shared TypeScript types, DTOs, and contracts
- [x] Scaffold `packages/config/` — shared ESLint and TypeScript configurations
- [x] Scaffold `ml/` — Python package with `pyproject.toml` and test suite
- [x] Add `docs/` directory structure

### 1.3 Developer Tooling

- [x] Configure ESLint for TypeScript (frontend and backend)
- [x] Configure Prettier project-wide
- [x] Configure TypeScript strict mode in all TypeScript packages
- [x] Configure Python linting and formatting (Ruff)
- [ ] Configure pre-commit hooks (Husky + lint-staged or pre-commit for Python)
- [x] Confirm all tooling passes across packages (`build`, `typecheck`, `lint`, `format:check`, `test`)

### 1.4 Docker Compose and Infrastructure

- [x] Create `docker-compose.yml` for local development
  - [x] PostgreSQL 16 with pgvector extension enabled (`pgvector/pgvector:pg16`)
  - [ ] Next.js dev server container (run outside Docker for development)
  - [ ] NestJS dev server container (run outside Docker for development)
  - [ ] Optional Ollama container (disabled by default)
- [x] Create `.env.example` with all required environment variables documented
- [x] Create local `.env` with development defaults (git-ignored)
- [x] Confirm `docker compose up` starts all core services without errors
- [x] Verify PostgreSQL is accessible with the configured credentials
- [x] Verify pgvector extension installs and operates correctly (`<vector 0.8.7>`)
- [x] Verify database volume persistence across container restarts

### 1.5 Database and ORM Baseline

- [x] Configure Prisma with PostgreSQL connection
- [x] Enable pgvector extension via initial migration (`20261105000000_init_pgvector`)
- [x] Document Prisma + pgvector interaction pattern (see TD-04)
- [x] Create initial Prisma schema skeleton (`User`, `SystemConfig`)
- [x] Confirm Prisma client generates successfully (`prisma generate`)
- [x] Verify VectorRepository parameterized vector queries and health status diagnostic endpoint

### 1.6 CI Baseline (Optional for Early Phase)

- [x] Set up GitHub Actions workflow (`.github/workflows/ci.yml`)
  - [x] Lint and type-check (Turborepo + pnpm)
  - [x] Run unit tests (Jest across packages)
  - [x] Build check (Next.js & NestJS compilation)
  - [x] Python ML checks (Ruff lint/format & Pytest)
- [ ] Confirm CI passes on main branch (pending initial remote push)

---

## Phase 2 — Catalogue and TMDB Integration

**Objective:** Integrate with the TMDB API to fetch, store, and search movie and TV metadata. Establish the catalogue as a local cache.

**Dependencies:** Phase 1 complete (database running, Prisma configured).

**Completion Criteria:**

- TMDB API integration fetches movie and TV details reliably.
- Catalogue records are stored in PostgreSQL.
- Search returns accurate results.
- Rate limiting and error handling are in place.
- TMDB attribution is correctly implemented.

---

### 2.1 TMDB API Client (Phase 2B Complete)

- [x] Implement a typed TMDB API client (`TmdbHttpClient`) with Bearer token authentication
- [x] Implement configurable base URL, timeout handling, and exponential backoff retries (respecting `Retry-After`)
- [x] Separate concerns cleanly: `TmdbHttpClient` (HTTP/retry), `TmdbMapper` (transform), `CatalogueRepository` (Prisma upsert/transactions), and `TmdbService` (orchestration)
- [x] Store and validate TMDB credentials securely via backend environment variables (`TMDB_READ_ACCESS_TOKEN` / `TMDB_API_KEY`)
- [x] Unit test client retry logic, rate limit handling, authentication headers, and response mappings without external API calls

### 2.2 Catalogue Data Model (Phase 2A Complete & Verified)

- [x] Finalize and migrate simplified `Movie`, `TvShow`, `Season`, `Episode` schema
- [x] Migrate `Genre`, `Keyword`, `Person`, and single combined `PersonCredit` models
- [x] Write Prisma migration (`20261106000000_catalogue_foundation`) with PostgreSQL CHECK constraint
- [x] Create `migration_lock.toml` for PostgreSQL connector tracking
- [x] Add nullable unique constraints on `Season.tmdbId` and `Episode.tmdbId` (`20261106232000_catalogue_constraints_alignment`)
- [x] Clean up redundant indexes (`movies_tmdbId_idx`, `tv_shows_tmdbId_idx`, `persons_tmdbId_idx`)
- [x] Confirm Prisma client reflects the schema correctly (`prisma generate`)
- [x] Add PostgreSQL integration tests for database constraints, relationships, unique indexes, and cascade behaviors (37/37 passing)

### 2.3 Catalogue Seeding and Ingestion (Phase 2B Complete)

- [x] Implement on-demand movie ingestion by TMDB ID (`POST /api/catalogue/ingest/movie/:tmdbId`)
  - [x] Ingest metadata, release date, runtime, poster/backdrop paths, adult flag
  - [x] Ingest and associate genres and keywords
  - [x] Ingest and link cast members via `PersonCredit`
- [x] Implement on-demand TV show ingestion by TMDB ID (`POST /api/catalogue/ingest/tv/:tmdbId`)
  - [x] Ingest TV metadata, first/last air dates, season/episode counts, genres, keywords, cast
  - [x] Ingest individual seasons and episodes (supporting specials / season 0) with bounded per-season transactions
- [x] Ensure 100% idempotent ingestion and relationship synchronization on repeated requests
- [x] Document endpoints in Swagger/OpenAPI
- [x] Automated PostgreSQL integration tests for movie and TV ingestion idempotency and concurrency (42/42 passing)
- [x] Conduct Phase 2B reliability and security audit (secret sanitization in error messages, Bearer-only auth, concurrent transaction timeouts)
- [ ] Implement background sync for trending and popular content (limited scope — see TD-07)
- [ ] Implement deduplication of catalogue records across discovery sweeps

### 2.4 Discover API Endpoints

- [ ] `GET /api/catalogue/search?q=...` — full-text search
- [ ] `GET /api/catalogue/trending`
- [ ] `GET /api/catalogue/popular`
- [ ] `GET /api/catalogue/movie/:tmdbId`
- [ ] `GET /api/catalogue/tv/:tmdbId`
- [ ] `GET /api/catalogue/genres`
- [ ] Add filtering parameters (genre, year, type, rating, runtime)

### 2.5 Frontend Discover Page

- [ ] Implement search input with debounce
- [ ] Implement trending and popular content sections
- [ ] Implement search results page with filter sidebar
- [ ] Display movie/TV cards with poster, title, year, rating
- [ ] Handle empty states and loading states correctly

---

## Phase 3 — Personal Library and Tracking

**Objective:** Allow the user to track their watch history, status, ratings, and progress across movies and TV shows.

**Dependencies:** Phase 2 complete (catalogue established).

**Completion Criteria:**

- User can add, update, and remove library entries.
- Movie tracking supports all required fields.
- TV tracking supports episode and season progress.
- Dashboard shows meaningful personal data.
- All library data is persisted correctly.

---

### 3.1 Library Data Model

- [ ] Migrate `UserLibraryEntry`, `WatchProgress` schema
- [ ] Migrate `PersonalRating`, `Review` schema
- [ ] Support status values: Watching, Completed, Plan to Watch, Dropped
- [ ] Support rewatch tracking for movies

### 3.2 Library API Endpoints

- [ ] `GET /api/library` — list user library with filters (status, type)
- [ ] `POST /api/library` — add title to library
- [ ] `PATCH /api/library/:id` — update status, rating, progress
- [ ] `DELETE /api/library/:id` — remove from library
- [ ] `GET /api/library/:id` — get single library entry
- [ ] `POST /api/library/:id/progress` — update TV episode progress

### 3.3 Movie Tracking

- [ ] Track status, personal rating, watched date, rewatch count, notes
- [ ] Support multiple rewatch records (not just rewatch count)
- [ ] Validate rating values (e.g., 0.5–10.0 or 1–10 — decide scale)

### 3.4 TV Show Tracking

- [ ] Track overall status, current season, current episode
- [ ] Track per-season completion
- [ ] Track optional per-season ratings
- [ ] Calculate overall episode completion percentage
- [ ] Handle shows with ongoing seasons

### 3.5 Dashboard

- [ ] Recently watched titles
- [ ] Continue watching section
- [ ] Quick recommendation strip
- [ ] Basic viewing stats summary (counts, recent activity)

### 3.6 My Library Frontend

- [ ] Library list view with status filter tabs (All / Watching / Completed / Plan to Watch / Dropped)
- [ ] Library entry detail panel or modal
- [ ] Inline status and rating updates
- [ ] TV episode progress updater
- [ ] Search and sort within library

---

## Phase 4 — Watch Statistics and Data Import/Export

**Objective:** Provide personal viewing statistics and support data import/export for portability.

**Dependencies:** Phase 3 complete (library data exists).

**Completion Criteria:**

- Statistics page renders correct aggregated data.
- Import and export work reliably without data loss.
- Invalid import records are reported and never silently discarded.

---

### 4.1 Statistics Calculations

- [ ] Total movies watched
- [ ] Total completed TV shows, seasons, and episodes watched
- [ ] Genre distribution (by count and by time)
- [ ] Average personal rating overall and per genre
- [ ] Rating distribution histogram
- [ ] Monthly and yearly viewing activity
- [ ] Watching / Completed / Plan to Watch / Dropped distribution
- [ ] Highest-rated and most-watched genres

### 4.2 Statistics API

- [ ] `GET /api/stats/overview` — summary statistics
- [ ] `GET /api/stats/genres` — genre breakdown
- [ ] `GET /api/stats/activity` — activity over time
- [ ] `GET /api/stats/ratings` — rating distribution

### 4.3 Statistics Frontend

- [ ] Statistics page with charts
- [ ] Genre distribution chart
- [ ] Activity timeline chart
- [ ] Rating distribution chart
- [ ] Summary cards (totals, averages)

### 4.4 Data Import

- [ ] JSON import endpoint with schema validation
- [ ] CSV import endpoint with schema validation
- [ ] Duplicate detection logic
- [ ] Import validation with detailed error reporting
- [ ] Atomic import transactions (all-or-nothing or rollback on failure)
- [ ] Never silently discard invalid records — report all errors

### 4.5 Data Export

- [ ] JSON export (full nested format with TV progress, ratings, history)
- [ ] CSV export (flat spreadsheet-friendly format)
- [ ] Export personal data endpoint
- [ ] Confirm exported data is re-importable

---

## Phase 5 — Recommendation Engine Foundation

**Objective:** Build the core recommendation pipeline — embeddings, similarity computation, candidate generation, and baseline scoring.

**Dependencies:** Phase 3 complete (library data provides preference signals). Phase 2 complete (catalogue data for candidates).

**Completion Criteria:**

- Semantic embeddings are generated for catalogue items.
- Cosine similarity nearest neighbours are precomputed.
- Preference signals are derived from library data.
- Baseline recommendation candidates are generated.
- Scoring model produces ranked candidates.
- Recommendation records are stored with reasons.

---

### 5.1 ML Environment Setup

- [ ] Set up Python virtual environment and `pyproject.toml`
- [ ] Install Sentence Transformers, scikit-learn, numpy, pandas
- [ ] Choose embedding model (see TD-08)
- [ ] Confirm embedding generation runs on a small test set

### 5.2 Embedding Generation

- [ ] Design content representation per media item (overview, genres, keywords, themes)
- [ ] Implement embedding generation script (`ml/embeddings/`)
- [ ] Store embeddings in PostgreSQL via pgvector
- [ ] Support incremental embedding generation (new items only)
- [ ] Validate embedding quality on a sample

### 5.3 Similarity Computation

- [ ] Implement cosine similarity computation using high-dimensional embeddings
- [ ] Precompute top-N nearest neighbours per item
- [ ] Store precomputed similarity relationships
- [ ] Implement similarity refresh script
- [ ] Confirm neighbours are semantically sensible

### 5.4 User Preference Signals

- [ ] Derive positive preference embedding from rated/watched titles (weighted by rating)
- [ ] Derive negative preference embedding from dropped/disliked feedback
- [ ] Do not collapse to a single average embedding — maintain positive and negative separately
- [ ] Update preference signals when library changes

### 5.5 Candidate Generation

- [ ] Generate candidate pool from similarity to positive preference profile
- [ ] Filter out already-watched and already-library titles appropriately
- [ ] Support configurable candidate pool size

### 5.6 Baseline Scoring Model

- [ ] Implement scoring: `Score = 0.35·S + 0.25·P + 0.20·M + 0.10·Q + 0.10·N`
- [ ] Make weights configurable (not hardcoded constants)
- [ ] Implement semantic similarity component (S)
- [ ] Implement preference match component (P)
- [ ] Implement mood match component (M) — baseline implementation
- [ ] Implement quality/popularity signal component (Q)
- [ ] Implement novelty component (N)
- [ ] Document each component's calculation clearly

### 5.7 Recommendation Storage and API

- [ ] `POST /api/recommendations/generate` — trigger generation
- [ ] `GET /api/recommendations` — retrieve current recommendations
- [ ] Store recommendation records with score breakdown and reason
- [ ] Store recommendation impressions (shown to user)
- [ ] Preserve historical recommendation records even when algorithm changes

---

## Phase 6 — Recommendation Intelligence and Diversity

**Objective:** Extend the recommendation engine with diversity, feedback collection, evaluation, Taste Profile, and Taste Evolution.

**Dependencies:** Phase 5 complete (baseline pipeline working).

**Completion Criteria:**

- Diversity modes (Familiar / Balanced / Experimental) work and differ meaningfully.
- Feedback is recorded correctly and influences subsequent recommendations.
- Recommendation quality metrics are calculated.
- Taste Profile is generated and viewable.
- Taste Evolution snapshots are stored and comparable.

---

### 6.1 Recommendation Diversity

- [ ] Implement Safe (Familiar) diversity mode
- [ ] Implement Balanced diversity mode
- [ ] Implement Experimental diversity mode
- [ ] Apply intra-list diversity within a recommendation batch
- [ ] Support "Similar to Favourites", "Hidden Gems", "Unexpected Discoveries" categories
- [ ] Expose diversity mode as a user setting

### 6.2 Recommendation Feedback

- [ ] Implement feedback options: Interested / Not Interested / Already Watched / Not My Type / Watched and Loved / Watched and Disappointed
- [ ] Do not treat "Already Watched" as a negative signal
- [ ] Store feedback against recommendation records
- [ ] Apply feedback as signals in subsequent recommendation passes

### 6.3 Recommendation Evaluation

- [ ] Implement Precision@10 calculation
- [ ] Implement NDCG@10 calculation
- [ ] Track recommendation acceptance rate
- [ ] Track watchlist conversion rate
- [ ] Track eventual personal rating for recommended titles
- [ ] Support versioned algorithm comparisons
- [ ] Generate evaluation reports

### 6.4 Recommendation Explanation

- [ ] Generate human-readable explanations from scoring signals (not LLM-generated)
- [ ] Explain which factors contributed most to the score
- [ ] Show explanation in recommendation card UI

### 6.5 Taste Profile

- [ ] Generate structured taste profile from library data and feedback
- [ ] Include: preferred genres, themes, storytelling styles, tone, character types, narrative preferences, positive/negative preferences, confidence signals
- [ ] `GET /api/profile/taste` — retrieve taste profile
- [ ] Display taste profile in frontend
- [ ] Optionally enhance profile description with local LLM (graceful degradation if unavailable)

### 6.6 Taste Evolution

- [ ] Generate periodic taste profile snapshots
- [ ] Store snapshots with timestamps
- [ ] Compare snapshots across time
- [ ] Visualize changing genre, theme, and storytelling preferences
- [ ] Distinguish real preference changes from insufficient data effects

### 6.7 Recommendation History

- [ ] `GET /api/recommendations/history` — retrieve full recommendation history
- [ ] Display recommendation history with outcomes
- [ ] Show whether each recommendation was added, watched, and rated

---

## Phase 7 — Local LLM Integration

**Objective:** Integrate optional local LLM via Ollama for conversational discovery and enhanced taste descriptions. Must degrade gracefully when unavailable.

**Dependencies:** Phase 6 complete (recommendation system and taste profile exist).

**Completion Criteria:**

- LLM features work when Ollama is running locally.
- Application operates fully without Ollama (all non-LLM features unaffected).
- No LLM calls are made in hosted portfolio mode.
- No paid AI APIs are required.

---

### 7.1 Ollama Integration

- [ ] Implement Ollama client service (NestJS)
- [ ] Health check: detect whether Ollama is available at startup
- [ ] Configure Ollama endpoint and model via environment variables
- [ ] Graceful degradation: LLM-dependent endpoints return appropriate fallback responses when Ollama is unavailable

### 7.2 Conversational Discovery

- [ ] Natural-language search/discovery endpoint (requires Ollama)
- [ ] Parse user intent from natural language and map to catalogue filters
- [ ] `POST /api/discover/chat` — conversational discovery endpoint
- [ ] Frontend chat/prompt UI for discovery

### 7.3 Enhanced Taste Profile (LLM-Assisted)

- [ ] Generate narrative taste profile description using LLM when available
- [ ] Fall back to structured preference summary when LLM unavailable
- [ ] Clearly mark LLM-generated content in the UI

### 7.4 Mood-Based Discovery (LLM-Enhanced)

- [ ] Accept natural language mood description
- [ ] Map mood to genre/theme/tone signals using LLM
- [ ] Feed mapped signals into recommendation scoring (M component)
- [ ] Work without LLM using predefined mood categories as fallback

---

## Phase 8 — Movie Universe

**Objective:** Build the interactive semantic map of movies and TV shows using embeddings, HDBSCAN clustering, UMAP dimensionality reduction, and PixiJS visualization.

**Dependencies:** Phase 5 complete (embeddings and similarity precomputed). Requires sufficient catalogue data to form meaningful clusters.

**Completion Criteria:**

- Clusters are semantically coherent.
- 2D UMAP coordinates are generated for visualization only (not used for similarity).
- PixiJS renders the map with acceptable performance.
- Library overlay, search, hover preview, and detail panel work correctly.

---

### 8.1 Clustering Pipeline

- [ ] Implement HDBSCAN clustering on high-dimensional embeddings (`ml/clustering/`)
- [ ] Tune HDBSCAN parameters (`min_cluster_size`, `min_samples`) on real data
- [ ] Store cluster assignments in the database
- [ ] Generate cluster labels (keyword-based or LLM-assisted where available)
- [ ] Generate cluster descriptions

### 8.2 UMAP Dimensionality Reduction

- [ ] Run UMAP on high-dimensional embeddings to produce 2D coordinates
- [ ] Store 2D coordinates for visualization only — never use for similarity search
- [ ] Support incremental coordinate updates as catalogue grows
- [ ] Validate that UMAP layout is visually coherent

### 8.3 Movie Universe API

- [ ] `GET /api/universe/items` — paginated item list with 2D coordinates and cluster
- [ ] `GET /api/universe/clusters` — cluster list with labels and colour assignments
- [ ] `GET /api/universe/item/:id/neighbours` — nearest neighbours for detail panel
- [ ] Support bounding-box queries for viewport-based loading

### 8.4 PixiJS Visualization Frontend

- [ ] Implement PixiJS canvas renderer for the universe map
- [ ] Render items as points coloured by cluster
- [ ] Pan and zoom navigation
- [ ] Hover preview (title, poster thumbnail, cluster)
- [ ] Click to open detail panel
- [ ] Show library status as overlay (watched, planning, etc.)
- [ ] Search and highlight matching items
- [ ] Filter by genre, cluster, or media type
- [ ] Performance target: handle 10,000+ points without frame drops

---

## Phase 9 — Testing, Security and Quality Assurance

**Objective:** Establish comprehensive test coverage, security hardening, and production-readiness checks across the full stack.

**Dependencies:** Phases 1–8 feature implementation substantially complete.

**Completion Criteria:**

- All critical business logic has unit test coverage.
- Key user flows have integration and end-to-end test coverage.
- Python ML pipelines have pytest coverage.
- Security audit passes (no hardcoded secrets, validated inputs, secure auth).
- Performance targets verified.

---

### 9.1 Backend Testing (Jest + NestJS)

- [ ] Unit tests for recommendation scoring logic
- [ ] Unit tests for import validation and duplicate detection
- [ ] Unit tests for statistics aggregation
- [ ] Integration tests for TMDB API client (mocked)
- [ ] Integration tests for library CRUD operations
- [ ] Integration tests for recommendation generation

### 9.2 Frontend Testing (Jest + React Testing Library)

- [ ] Unit tests for utility functions and hooks
- [ ] Component tests for library status updates
- [ ] Component tests for recommendation card and feedback
- [ ] Component tests for search and filter interactions

### 9.3 End-to-End Testing (Playwright)

- [ ] E2E: Add a movie to library and update status
- [ ] E2E: Search for a TV show and view details
- [ ] E2E: Generate and view recommendations
- [ ] E2E: Import a JSON data file and verify library
- [ ] E2E: Export library and confirm download

### 9.4 Python ML Testing (Pytest)

- [ ] Tests for embedding generation output shape and type
- [ ] Tests for cosine similarity computation correctness
- [ ] Tests for HDBSCAN clustering (non-trivial output on test data)
- [ ] Tests for UMAP coordinate generation (2D output, correct count)
- [ ] Tests for scoring formula with known inputs

### 9.5 Security Audit

- [ ] Confirm no secrets in source code or git history
- [ ] Confirm all external API inputs are validated and sanitized
- [ ] Confirm Prisma query patterns prevent SQL injection
- [ ] Review authentication implementation
- [ ] Confirm import file validation rejects malformed data
- [ ] Review API rate limiting
- [ ] Confirm sensitive data is not logged

### 9.6 Performance and Load

- [ ] Movie Universe PixiJS renders 10,000 points at acceptable frame rate
- [ ] Recommendation generation completes within acceptable time
- [ ] Library page loads with 500+ entries without noticeable delay
- [ ] Import of 1,000 items completes without timeout

---

## Phase 10 — Deployment and Portfolio Preparation

**Objective:** Deploy CineSphere as a hosted portfolio demonstration. Anonymize personal data. Enable graceful LLM degradation. Optimize for near-zero hosting cost.

**Dependencies:** Phases 1–9 complete or feature-complete with known deficiencies documented.

**Completion Criteria:**

- Application is publicly accessible.
- Personal watch history is not exposed in the public demo.
- LLM features degrade gracefully (Ollama not available in hosted environment).
- Hosting costs are minimal.
- README describes the hosted demo clearly.

---

### 10.1 Portfolio Data Preparation

- [ ] Define anonymization strategy (see TD-09)
- [ ] Create a curated public fixture dataset or redaction pipeline
- [ ] Confirm no personal data is exposed in the hosted demo
- [ ] Precompute embeddings, similarity data, clusters, and UMAP coordinates for the demo dataset
- [ ] Export precomputed data as deployable fixtures

### 10.2 Hosted Configuration

- [ ] Add `NEXT_PUBLIC_HOSTED_MODE` environment flag
- [ ] Disable LLM-dependent features in hosted mode
- [ ] Disable write operations (or add read-only mode) for public demo
- [ ] Confirm recommendation engine works from precomputed data without Ollama

### 10.3 Deployment Infrastructure

- [ ] Choose hosting platform (see TD-09 — cost constraint)
- [ ] Configure production PostgreSQL (managed or serverless — cost-aware)
- [ ] Configure deployment pipeline (GitHub Actions or manual)
- [ ] Set up environment variables in hosted environment
- [ ] Configure HTTPS

### 10.4 Portfolio Documentation

- [ ] Update README with live demo URL
- [ ] Add technical writeup or case study for portfolio
- [ ] Add architecture diagram suitable for portfolio
- [ ] Record a demo video or screenshots for portfolio context
- [ ] Add TMDB attribution to the deployed application

### 10.5 Final QA

- [ ] Full E2E test run against production environment
- [ ] Confirm no console errors in production
- [ ] Confirm no exposed secrets or sensitive data
- [ ] Confirm performance targets in production
- [ ] Review and finalize license selection (see TD-01)

---

## Completed Milestones

| Milestone                                                         | Completed  | Notes                                                                             |
| ----------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Documentation and architecture initialization                     | 2026-11-05 | All foundation docs created. No implementation yet.                               |
| Antigravity setup, Git initialization & environment configuration | 2026-11-05 | AGENTS.md, Git init (main), .gitignore, .env.example, .env, root configs created. |
| Monorepo initialization & PostgreSQL + pgvector foundation        | 2026-11-06 | TD-02/TD-04 resolved. Turborepo+pnpm, Next.js, NestJS, Prisma, pgvector verified. |

---

## Deferred Items

| Item                                | Deferred To           | Reason                                                           |
| ----------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `docs/api/` API specification stubs | Phase 2               | No API endpoints exist yet. Document alongside implementation.   |
| Redis / caching layer               | Deferred indefinitely | No demonstrated performance requirement yet. Revisit if needed.  |
| Microservice extraction             | Deferred indefinitely | Monolith is appropriate until specific scaling needs are proven. |
| Multi-user support                  | Deferred indefinitely | Out of scope. Single-user personal app.                          |
| CI/CD pipeline                      | Phase 1 (optional)    | Useful but not blocking initial feature development.             |
