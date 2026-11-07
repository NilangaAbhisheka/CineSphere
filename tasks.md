# CineSphere — Project Progress Tracker

> **Maintenance Rule:** Update this file whenever a task is completed, deferred, added, or blocked. Never claim progress that has not been verified and tested. Mark tasks complete only after implementation is confirmed working.

---

## Project Overview

| Field             | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Project           | CineSphere                                                                        |
| Type              | Personal movie and TV tracking, discovery, recommendation, and analytics platform |
| Architecture      | TypeScript monorepo (Next.js + NestJS) with separate Python ML package            |
| Phase             | **Phase 3 — Personal Library and Tracking**                                       |
| Current Milestone | Phase 3 Stage 3.5 Complete (Frontend Personal Library — My Library page, LibraryCard, AddLibraryModal, LibraryDetailModal, Discover integration, 63 frontend unit tests) |
| Last Updated      | 2026-11-08                                                                        |

---

## Overall Progress

```
Phase 1  — Project Foundation                  ████████████████  95% (monorepo, docker, pgvector, prisma, tooling, CI workflow)
Phase 2  — Catalogue and TMDB Integration      ████████████████  100% (Phase 2A schema, Phase 2B ingestion, Phase 2C discovery, Phase 2.5 Discover UI)
Phase 3  — Personal Library and Tracking       █████████████░░░  75% (Stages 3.0–3.5: DB foundation, bootstrap, integrity, Library REST API, and Frontend Personal Library complete)
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
- [x] API specification documentation — Superseded by live OpenAPI/Swagger documentation generated at `/api/docs`
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
- [ ] Configure pre-commit hooks (Husky + lint-staged or pre-commit for Python) — Optional / Deferred (enforced via Turbo & CI)
- [x] Confirm all tooling passes across packages (`build`, `typecheck`, `lint`, `format:check`, `test`)

### 1.4 Docker Compose and Infrastructure

- [x] Create `docker-compose.yml` for local development
  - [x] PostgreSQL 16 with pgvector extension enabled (`pgvector/pgvector:pg16`)
  - [ ] Next.js dev server container (Optional / Deferred — run outside Docker on host for fast HMR)
  - [ ] NestJS dev server container (Optional / Deferred — run outside Docker on host for fast HMR)
  - [ ] Optional Ollama container (Deferred to Phase 7)
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
- [x] Store and validate TMDB credentials securely via backend environment variable (`TMDB_READ_ACCESS_TOKEN` required; Bearer token auth; API-key query fallback removed during Phase 2B security audit)
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

### 2.4 Discover API Endpoints (Phase 2C Complete)

- [x] Remote TMDB search endpoints (`GET /api/discover/tmdb/movies`, `GET /api/discover/tmdb/tv`)
  - [x] Query validation, pagination (`page`, `totalPages`, `totalResults`, `results`)
  - [x] Adult filtering with default to `false`
  - [x] Query filters: `year`, `primaryReleaseYear`, `firstAirDateYear`
  - [x] Zero persistence to PostgreSQL during search queries
- [x] Local movie catalogue endpoint (`GET /api/catalogue/movies`)
  - [x] Database-side filtering by `query` (case-insensitive substring title matching)
  - [x] Filters: `genreId`, `year`, `minRating`, `maxRating`, `language`
  - [x] Stable secondary sorting by `id asc` and configurable primary sort (`popularity`, `rating`, `releaseDate`, `title`)
  - [x] Database-side pagination with enforced maximum page size (100)
- [x] Local TV show catalogue endpoint (`GET /api/catalogue/tv`)
  - [x] Database-side filtering by `query` (case-insensitive substring name matching)
  - [x] Filters: `genreId`, `firstAirDateYear`, `minRating`, `maxRating`, `language`, `status`
  - [x] Stable secondary sorting by `id asc` and configurable primary sort (`popularity`, `rating`, `firstAirDate`, `name`)
  - [x] Database-side pagination with enforced maximum page size (100)
- [x] Local movie details endpoint (`GET /api/catalogue/movies/:id`)
  - [x] Retrieve by internal UUID (v4) with `ParseUUIDPipe` validation
  - [x] Full metadata, genres, keywords, and associated cast members via `PersonCredit` -> `Person`
  - [x] 404 response on non-existent records
- [x] Local TV show details endpoint (`GET /api/catalogue/tv/:id`)
  - [x] Retrieve by internal UUID (v4) with `ParseUUIDPipe` validation
  - [x] Full metadata, genres, keywords, associated cast members, and hierarchical seasons and episodes
  - [x] Ordered seasons (`seasonNumber asc`, preserving season 0) and ordered episodes (`episodeNumber asc`)
  - [x] 404 response on non-existent records
- [x] Unit and PostgreSQL integration tests for TMDB search, local catalogue filtering, pagination, ordering, nullable field sorting, and details endpoints (53 unit tests, 58 integration tests passing)

### 2.5 Frontend Discover Page (Phase 2.5 Complete)

- [x] Implement search input with debounce (400ms debounce hook, abort controller request cancellation)
- [x] Implement trending and popular content sections (curated trending movies, trending TV, popular movies proxy endpoints)
- [x] Implement search results page with filter sidebar (unified discovery UI with remote TMDB search and local catalogue browsing)
- [x] Display movie/TV cards with poster, title, year, rating (`MediaCard` component with TMDB image generator and fallback SVG placeholder)
- [x] Implement and verify required TMDB attribution badge and disclaimer ("This product uses the TMDB API but is not endorsed or certified by TMDB")
- [x] Handle empty states and loading states correctly (`LoadingSkeletonGrid`, `EmptyState`, `ErrorState`)
- [x] Resolved Next.js production build file locking issue; verified Next.js App Router production build (`pnpm --filter @cinesphere/web build`) with exit code 0

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

### 3.0 Single-User Bootstrap (Stage 3.0 Complete ✅)

- [x] Implement `SingleUserBootstrap` provider — validates `CINESPHERE_SINGLE_USER_ID` UUID from env, upserts the single system user on application startup
- [x] Register in `DatabaseModule` (providers + exports)
- [x] Add `CINESPHERE_SINGLE_USER_ID` to `.env` and `.env.example`
- [x] Unit tests: 6/6 passed (`single-user-bootstrap.spec.ts`)

### 3.1 Library Data Model (Stage 3.1 Complete ✅)

- [x] Add `MediaType` enum (`MOVIE`, `TV`) and `LibraryStatus` enum (`PLAN_TO_WATCH`, `WATCHING`, `COMPLETED`, `DROPPED`) to Prisma schema
- [x] Migrate `UserLibraryEntry` model — UUID PK, userId, mediaType, nullable movieId, nullable tvShowId, status, nullable personalRating (DECIMAL 4,2), nullable notes, createdAt, updatedAt
- [x] Migrate `ViewingEvent` model — UUID PK, libraryEntryId, watchedAt, nullable rating (DECIMAL 4,2), nullable notes
- [x] Migrate `EpisodeProgress` model — composite PK (libraryEntryId, episodeId); existence denotes watched
- [x] Migrate `SeasonRating` model — UUID PK, unique (libraryEntryId, seasonId), rating (DECIMAL 4,2)
- [x] Add reverse relations to `User`, `Movie`, `TvShow`, `Season`, `Episode`
- [x] Foreign-key delete behaviour: `onDelete: Cascade` for User→ULE; `onDelete: Restrict` for Movie/TvShow→ULE; cascade for child models
- [x] Migration applied and verified: `20261107154129_phase3_models`
- [x] `prisma validate` ✅, `prisma generate` ✅

### 3.2 Database Integrity (Stage 3.2 Complete ✅)

- [x] XOR CHECK on `user_library_entries`: exactly one of `movie_id` / `tv_show_id` must be set, consistent with `media_type`
- [x] Rating half-step CHECK on `user_library_entries.personal_rating`, `viewing_events.rating`, `season_ratings.rating` (1.00–10.00, increments of 0.5)
- [x] Partial unique index: at most one `user_library_entries` row per `(user_id, movie_id)` and `(user_id, tv_show_id)`
- [x] `trg_validate_episode_progress` (VOLATILE): lock ULE (FOR SHARE) → lock Episode (FOR SHARE) → read seasonId → lock Season (FOR SHARE) → validate tvShowId matches; rejects invalid inserts/updates with SQLSTATE P0001
- [x] `trg_validate_season_rating` (VOLATILE): lock ULE (FOR SHARE) → lock Season (FOR SHARE) → validate tvShowId matches; rejects invalid inserts/updates with SQLSTATE P0001
- [x] `trg_protect_ule_tv_show_id` (VOLATILE): prevents updating `tv_show_id` on ULE when EpisodeProgress or SeasonRating records exist
- [x] `trg_protect_episode_season_id` (VOLATILE): prevents updating `season_id` on Episode when EpisodeProgress records exist for that episode
- [x] `trg_protect_season_tv_show_id` (VOLATILE): prevents updating `tv_show_id` on Season when SeasonRating or EpisodeProgress records exist
- [x] All trigger functions declared `VOLATILE` — `SELECT EXISTS` reads fresh READ COMMITTED snapshot after lock acquisition
- [x] READ COMMITTED documented as mandatory isolation level for all transactions creating/modifying library/episode/season relationships
- [x] Migration applied and verified: `20261107154249_phase3_integrity`

### 3.3 Database Foundation Verification (Stage 3.3 Complete ✅)

- [x] Fresh database reset verification: `prisma migrate reset --force` applied all 5 migrations from scratch ✅
- [x] Constraint & ownership integration tests — 41/41 passed (`phase3-constraints.integration.spec.ts`): all valid/invalid ratings, XOR media type, partial unique indexes, trigger validation (EP & SR), parent protection triggers (all 3 cases), cascade/restrict deletion rules
- [x] Concurrency integration tests — 6/6 passed (`phase3-concurrency.integration.spec.ts`): uses three independent `pg.Client` connections, `waitForBlocked()` polls `pg_blocking_pids()` to prove actual lock contention; tests all 5 parent-update race scenarios + duplicate EP insert + READ COMMITTED documentation
- [x] Prisma error experiments — 6/6 passed (`phase3-prisma-errors.integration.spec.ts`): empirically verified Prisma 6.19.3 error structures for unique violations (P2002), FK violations (P2003), CHECK violations (PrismaClientUnknownRequestError), trigger P0001 (PrismaClientUnknownRequestError via model, PrismaClientKnownRequestError/P2010 via $executeRaw), deadlocks (pg DatabaseError)
- [x] All prior unit tests: 69/69 passed
- [x] All prior integration tests: 112/112 passed (phase3 + catalogue + catalogue-discovery + tmdb-ingestion)
- [x] TypeScript strict mode: `tsc --noEmit` ✅ (0 errors)
- [x] NestJS build: `nest build` ✅
- [x] ESLint: 0 errors
- [x] AGENTS.md updated with Phase 3 section 3.5 (four-model design, ownership invariants, READ COMMITTED requirement, trigger lock order, empirically verified Prisma error characteristics, migration workflow, test commands)

### 3.4 Library API Implementation (Stage 3.4 Complete ✅)

- [x] Centralized error mapping via `DatabaseErrorMapper` (translates Prisma P2002, P2003, P2025, P2010/trigger P0001, CHECK 23514, and raw pg 40P01 deadlock to clean HTTP exceptions)
- [x] Custom half-step rating validator (`IsHalfStepRating` decorator and validation function for 1.0–10.0 in 0.5 increments)
- [x] `POST /api/library` — add movie or TV show to library (resolving tmdbId via on-demand ingestion outside transactions; user ID enforced from `SingleUserBootstrap`)
- [x] `GET /api/library` — paginated listing with status, mediaType, sortBy, sortOrder filtering and total count
- [x] `GET /api/library/:id` — get single library entry with viewing events, episode progress, season ratings, and computed watch statistics
- [x] `PATCH /api/library/:id` — update entry status, personalRating, notes under READ COMMITTED transaction isolation
- [x] `DELETE /api/library/:id` — remove library entry (204 No Content, cascades cleanly to child records)
- [x] `POST /api/library/:id/viewing-events` — append-only viewing event creation (derived watch statistics recalculate dynamically)
- [x] `POST /api/library/:id/episode-progress` — idempotent episode progress tracking (`alreadyWatched: true` flag returned when already tracked)
- [x] `DELETE /api/library/:id/episode-progress/:episodeId` — idempotent episode progress removal (204 No Content)
- [x] `POST /api/library/:id/mark-all-watched` — atomic batch episode progress insertion using `INSERT ... SELECT ... ON CONFLICT DO NOTHING` (supports `includeSpecials` flag)
- [x] `POST /api/library/:id/season-ratings` — create season rating (enforces TV entry type and valid season belonging to show)
- [x] `PATCH /api/library/:id/season-ratings/:seasonId` — update season rating (1.0–10.0 half-step validation)
- [x] Shared library contracts & DTOs in `@cinesphere/shared` (`LibraryMediaType`, `LibraryStatus`, response and request types)
- [x] Unit test suite: 108/108 passing across 12 suites (including DatabaseErrorMapper, LibraryController, LibraryService)
- [x] Integration test suite: 137/137 passing across 7 suites (including 25 new library integration tests covering CRUD, cascade delete, idempotency, TV restrictions, batch mark-all-watched, and trigger validation)
- [x] Strict TypeScript (`tsc --noEmit`), NestJS build, and ESLint 0 errors / 0 warnings across all workspaces

### 3.5 Frontend Personal Library (Stage 3.5 — Complete)

- [x] Extended `ApiClient` with all 11 library API methods (`listLibrary`, `getLibraryEntry`, `createLibraryEntry`, `updateLibraryEntry`, `deleteLibraryEntry`, `createViewingEvent`, `createEpisodeProgress`, `deleteEpisodeProgress`, `markAllWatched`, `createSeasonRating`, `updateSeasonRating`)
- [x] Added `getBackdropPlaceholderUrl()` to `tmdb-image.ts` utilities
- [x] Added `My Library` navigation link to Navbar (`/library`)
- [x] `MediaCard` extended with optional `onAddToLibrary` prop and inline "Add to Library" button
- [x] `AddLibraryModal` — dialog for adding titles to the library with status selection (4 options), optional personal rating (1.0–10.0 half-step dropdown), optional notes, 409 duplicate handling, loading/success/error states, ESC-to-close
- [x] `LibraryCard` — library entry card with poster, status badge (colour-coded), media type badge, personal rating badge, movie watch count / TV episode progress bar, Manage Tracking button, keyboard navigation (Enter/Space)
- [x] `LibraryDetailModal` — full library management modal with:
  - Backdrop hero + poster + title metadata
  - Inline status pill selector and personal rating dropdown
  - Personal notes textarea with Save button
  - **Movie**: watch count stats, Log Viewing Event form (date/rating/notes), Viewing History timeline
  - **TV**: overall progress bar, Mark All Watched with includeSpecials toggle, season-by-season accordion with episode toggle rows, season rating dropdown per season
  - Delete with confirmation dialog
- [x] `/library` page — My Library with status tabs (All / Watching / Plan to Watch / Completed / Dropped), media type toggle, sort dropdown (6 options), result count, loading skeleton, error state, empty state, paginated 5-column grid, LibraryDetailModal wired with onEntryUpdated/onEntryDeleted callbacks
- [x] Discover page — `AddLibraryModal` integrated into all 6 `MediaCard` sections (search results, trending movies, trending TV, popular movies, popular TV, catalogue results)
- [x] Home page CTAs updated to point to `/library` and `/discover`
- [x] Jest test suite for `@cinesphere/web` configured (`jest.config.js`, `src/test/setup.ts`, `jest-environment-jsdom`, `@testing-library/react`)
- [x] Frontend test suite: **63/63 tests passing across 4 suites** (`api-client.library.spec.ts`, `library-card.spec.tsx`, `add-library-modal.spec.tsx`, `library/page.spec.tsx`)
- [x] TypeScript `tsc --noEmit`: 0 errors
- [x] ESLint `next lint`: 0 warnings, 0 errors
- [x] Next.js production build `next build`: exit 0, all pages generated (`/library` 9.23 kB, `/discover` 8.2 kB)

### 3.6 Dashboard

- [ ] Recently watched titles
- [ ] Continue watching section
- [ ] Quick recommendation strip
- [ ] Basic viewing stats summary (counts, recent activity)

### 3.7 Statistics Frontend

- [ ] Statistics page with charts
- [ ] Genre distribution chart
- [ ] Activity timeline chart
- [ ] Rating distribution chart
- [ ] Summary cards (totals, averages)

### 3.8 Testing and Hardening

- [ ] Playwright E2E: library add → manage → delete flow
- [ ] Playwright E2E: TV episode progress marking flow
- [ ] Backend regression tests after any new API additions

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
| Phase 2 complete (Catalogue, TMDB Ingestion & Discover UI)        | 2026-11-07 | TMDB client, ingestion, discover API, frontend Discover page, 100+ tests passing.  |
| Phase 3 Stages 3.0–3.3 complete (Database Foundation)             | 2026-11-07 | SingleUserBootstrap, 4-model schema + integrity migration, 112 integration tests + 69 unit tests all passing. READ COMMITTED + VOLATILE trigger concurrency verified. |

---

## Deferred Items

| Item                                | Deferred To           | Reason                                                                                                |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/api/` API specification stubs | Resolved (Phase 2)    | Superseded by live OpenAPI/Swagger interactive documentation at `/api/docs` alongside implementation. |
| Redis / caching layer               | Deferred indefinitely | No demonstrated performance requirement yet. Revisit if needed.                                       |
| Microservice extraction             | Deferred indefinitely | Monolith is appropriate until specific scaling needs are proven.                                      |
| Multi-user support                  | Deferred indefinitely | Out of scope. Single-user personal app.                                                               |
| CI/CD pipeline                      | Phase 1 (optional)    | Useful but not blocking initial feature development.                                                  |
