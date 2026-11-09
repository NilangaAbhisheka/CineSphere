# CineSphere

> A personal movie and television tracking, discovery, recommendation, and analytics platform.

---

## Overview

CineSphere is a personal entertainment intelligence platform built for one purpose: to give a single person deep, meaningful insight into their own viewing history and help them discover content that genuinely matches their taste.

It goes beyond a simple watchlist. CineSphere combines semantic embeddings, content-based machine learning, and an interactive visual map of the film landscape to surface recommendations that are explainable, personalized, and not dependent on what everyone else is watching.

This project is built as a serious Computer Science portfolio piece, demonstrating full-stack engineering, applied machine learning, and thoughtful system design across a production-quality codebase.

---

## Problem Statement

Existing streaming platforms and tracking tools share the same fundamental limitations:

- Recommendations are driven by aggregate popularity, not personal taste.
- Watch history is fragmented across multiple services with no unified view.
- No platform provides a semantic understanding of _why_ a viewer likes what they like.
- Personal analytics and taste evolution are unavailable or superficial.
- Data portability is limited or absent.

CineSphere addresses these problems for a single user who wants to own their entertainment data and receive genuinely personalized recommendations.

---

## Project Goals

1. Provide a unified personal library for tracking movies and TV shows across any source.
2. Build a recommendation engine grounded in semantic similarity and personal preference signals — not collaborative filtering or popularity alone.
3. Generate an evolving, structured model of the user's taste.
4. Render an interactive visual map of the semantic film landscape.
5. Keep all core functionality available locally without paid AI APIs.
6. Demonstrate production-quality engineering practices for portfolio purposes.

---

## Core Features

| Feature              | Description                                                            | Status                          |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| **Dashboard**        | Activity overview, continue watching, recent activity, and quick picks | Implemented (Phase 3.6)         |
| **My Library**       | Track movies and TV shows with status, ratings, progress, and notes    | Implemented (Phase 3.5)         |
| **Discover**         | Search, browse trending content, apply mood and genre filters          | Implemented (Phase 2)           |
| **For You**          | Hybrid recommendation engine with diversity controls and explanations  | Planned (Phase 5–6)             |
| **AI Taste Profile** | Structured model of personal viewing preferences                       | Planned (Phase 6)               |
| **Taste Evolution**  | Snapshots of preference changes over time                              | Planned (Phase 6)               |
| **Movie Universe**   | Interactive 2D semantic map of movies powered by embeddings and PixiJS | Planned (Phase 8)               |
| **Statistics**       | Personal viewing analytics, summary cards, and SVG charts              | Frontend Foundation (Phase 3.7) |
| **Import / Export**  | JSON and CSV data portability                                          | Planned (Phase 4)               |
| **Local LLM**        | Optional conversational discovery via Ollama (local only)              | Planned (Phase 7)               |

---

## Technology Stack

| Area                      | Technology                              |
| ------------------------- | --------------------------------------- |
| Frontend                  | Next.js 14+ with TypeScript             |
| Styling                   | Tailwind CSS                            |
| Backend                   | NestJS with TypeScript                  |
| API                       | REST                                    |
| Database                  | PostgreSQL 16+                          |
| Vector search             | pgvector                                |
| ORM                       | Prisma                                  |
| Machine Learning          | Python 3.11+                            |
| Embeddings                | Sentence Transformers                   |
| ML utilities              | scikit-learn                            |
| Clustering                | HDBSCAN                                 |
| Dimensionality reduction  | UMAP                                    |
| Interactive visualization | PixiJS                                  |
| Movie metadata            | TMDB API                                |
| Local LLM                 | Ollama (optional)                       |
| Frontend testing          | Playwright, Jest, React Testing Library |
| Backend testing           | Jest                                    |
| Python testing            | Pytest                                  |
| Local infrastructure      | Docker Compose                          |
| Version control           | Git + GitHub                            |

---

## Architecture Overview

CineSphere uses a TypeScript monorepo with a separate Python ML package. Responsibilities are cleanly separated:

- **`apps/web/`** — Next.js frontend. All user interface, state management, and API consumption.
- **`apps/api/`** — NestJS backend. Business logic, TMDB integration, library management, recommendation coordination, and data access.
- **`packages/`** — Shared TypeScript types, utilities, and configuration shared between frontend and backend.
- **`ml/`** — Python package for embedding generation, clustering, similarity computation, and recommendation scoring. Runs as offline/on-demand scripts, not a persistent service.
- **`infrastructure/`** — Docker Compose configuration, database setup, and deployment resources.

The backend communicates with PostgreSQL via Prisma. Vector operations use pgvector. The Python ML layer reads from and writes to the same PostgreSQL database via its own connection. The frontend communicates exclusively with the NestJS API.

> See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture specification.

---

## Planned Repository Structure

```
cinesphere/
├── .cursor/
│   └── rules/
│       └── cinesphere.mdc # Cursor IDE project rules
├── apps/
│   ├── web/               # Next.js + TypeScript frontend
│   └── api/               # NestJS + TypeScript backend
├── packages/
│   ├── shared/            # Shared TypeScript types and utilities
│   └── config/            # Shared ESLint, Prettier, TypeScript config
├── ml/
│   ├── embeddings/        # Embedding generation scripts
│   ├── clustering/        # HDBSCAN clustering
│   ├── similarity/        # Cosine similarity and nearest-neighbour computation
│   ├── recommendations/  # Scoring and candidate generation
│   ├── taste-profiling/  # Taste profile generation
│   ├── movie-map/         # UMAP coordinate generation
│   └── scripts/           # One-off and maintenance scripts
├── infrastructure/
│   ├── docker/            # Dockerfile definitions
│   ├── database/          # Database initialization scripts
│   └── deployment/        # Hosting and deployment configuration
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATABASE_DESIGN.md
│   ├── PROJECT_PLAN.md
│   └── AI_DEVELOPMENT_GUIDE.md
├── tasks.md               # Central project progress tracker
├── AGENTS.md              # Google Antigravity project instructions
├── docker-compose.yml     # Local multi-service infrastructure
├── .env.example           # Tracked environment variable template
├── .env                   # Local environment file (untracked / git-ignored)
├── .editorconfig          # Consistent editor formatting rules
├── .gitattributes         # Line-ending normalization (LF)
├── .gitignore             # Comprehensive exclusion rules
├── .dockerignore          # Docker build exclusion rules
├── .nvmrc                 # Node.js runtime version
└── README.md
```

> Directories are introduced when needed, not created empty upfront.

---

## AI Agent Guidelines

CineSphere enforces production-quality engineering standards and architectural boundaries across all AI coding assistants:

- **Google Antigravity:** Guided by [`AGENTS.md`](AGENTS.md) at the repository root. This is the primary, persistent instruction file detailing architectural rules, non-goals, coding conventions, and the 10-step implementation workflow.
- **Cursor:** Supported via [`.cursor/rules/cinesphere.mdc`](.cursor/rules/cinesphere.mdc), providing tool-compatible instructions that mirror `AGENTS.md`.
- **General Reference:** See [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) for full technology guidelines and testing expectations.

---

## Git & Version Control Standards

- **Primary Branch:** `main`.
- **Commit Style:** [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` new user-facing or backend functionality
  - `fix:` bug resolution
  - `docs:` documentation updates
  - `refactor:` code restructuring without behaviour changes
  - `test:` test additions or fixes
  - `chore:` maintenance and configuration
  - `build:` Docker, monorepo, or CI/CD configuration
- **Exclusions (`.gitignore`):** Excludes local secrets (`.env`), build outputs (`dist/`, `.next/`, `build/`), dependencies (`node_modules/`, Python virtual environments `.venv/`), test caches, machine learning model weights (`ml/models/`), embedding caches (`ml/embeddings/cache/`), database storage volumes, and OS artifacts. See [`.gitignore`](.gitignore) for the complete list.

---

## Local Development Setup

### Prerequisites

- Node.js 20+ (managed via `.nvmrc`)
- pnpm 10+ (`npm install -g pnpm`)
- Python 3.11+
- Docker and Docker Compose
- Git

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/cinesphere.git
cd cinesphere
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and supply your TMDB_READ_ACCESS_TOKEN for catalogue access
```

Key environment variables:

- `DATABASE_URL`: PostgreSQL connection string (defaults to `postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public`)
- `CINESPHERE_SINGLE_USER_ID`: Fixed UUID for deterministic single-user bootstrap (`a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
- `TMDB_READ_ACCESS_TOKEN`: TMDB v4 Read Access API Token (Bearer token authentication)

### 3. Start the database infrastructure

```bash
docker compose up -d
# Verifies pgvector/pgvector:pg16 container on localhost:5432
```

### 4. Install dependencies and generate Prisma client

```bash
# Install TypeScript monorepo dependencies
pnpm install

# Generate Prisma Client types
pnpm prisma:generate

# Set up Python ML virtual environment
cd ml
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ..
```

### 5. Run database migrations

```bash
# Apply all tracked database migrations to PostgreSQL
pnpm --filter @cinesphere/api prisma:deploy
```

### 6. Start development servers

```bash
# Concurrently run Next.js frontend (port 3000) and NestJS API (port 4000)
pnpm dev
```

- Frontend starter: `http://localhost:3000`
- My Library: `http://localhost:3000/library`
- Discover: `http://localhost:3000/discover`
- API health check: `http://localhost:4000/api/health`
- Swagger OpenAPI: `http://localhost:4000/api/docs`

---

## Environment Variables

CineSphere uses environment variables to configure application parameters, external API keys, database connections, and optional AI services.

### Configuration Template & Local Setup

- **Template (`.env.example`):** The tracked template file defining all configuration keys with safe example defaults or empty placeholders.
- **Local File (`.env`):** Created by copying `.env.example` (`cp .env.example .env`). This file contains your machine's local configuration and API keys. It is strictly excluded from version control via `.gitignore`.

### Server-Side vs. Client-Side Variables

- **Public Variables (`NEXT_PUBLIC_*`):** Next.js exposes variables prefixed with `NEXT_PUBLIC_` directly to browser-side JavaScript bundles (e.g., `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_HOSTED_MODE`). Only non-sensitive URLs and feature flags may use this prefix.
- **Server-Only Secrets:** All database credentials (`DATABASE_URL`, `POSTGRES_PASSWORD`), TMDB API tokens (`TMDB_READ_ACCESS_TOKEN`), and session secrets (`SESSION_SECRET`) omit the `NEXT_PUBLIC_` prefix and are strictly confined to server-side runtimes (NestJS and Next.js server components). Never expose secrets to the client.

Key variables:

| Variable                    | Scope           | Description                                             |
| --------------------------- | --------------- | ------------------------------------------------------- |
| `DATABASE_URL`              | Server          | PostgreSQL + pgvector connection string                 |
| `CINESPHERE_SINGLE_USER_ID` | Server          | Deterministic single-user UUID anchor                   |
| `TMDB_READ_ACCESS_TOKEN`    | Server          | TMDB API v4 read access token (Bearer authentication)   |
| `OLLAMA_BASE_URL`           | Server          | Ollama API base URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL`              | Server          | Ollama model tag (e.g., `llama3.2`)                     |
| `OLLAMA_ENABLED`            | Server          | Set to `true` to enable local AI features               |
| `NEXT_PUBLIC_API_URL`       | Client & Server | Public backend API URL consumed by the web browser      |
| `HOSTED_MODE`               | Server          | Set to `true` in hosted portfolio deployment            |
| `NEXT_PUBLIC_HOSTED_MODE`   | Client & Server | Hosted mode flag consumed by frontend UI components     |

---

## Testing

CineSphere maintains a comprehensive multi-layered automated test suite across all monorepo packages.

```bash
# TypeScript unit tests across all workspaces (NestJS API + Next.js Web)
pnpm test

# Backend PostgreSQL integration tests (152 tests across 8 suites)
pnpm test:integration

# Playwright End-to-End workflow tests (requires CINESPHERE_E2E_DATABASE_URL targeting a dedicated test database)
# The test database name must contain "test" or "e2e" as a distinct token (e.g., cinesphere_test)
# 1. Create test DB & deploy migrations (one-time setup):
#    docker exec -it cinesphere-postgres psql -U cinesphere_user -c "CREATE DATABASE cinesphere_test;"
#    DATABASE_URL="postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test?schema=public" pnpm --filter @cinesphere/api exec prisma migrate deploy
# 2. Run E2E tests:
export CINESPHERE_E2E_DATABASE_URL="postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test?schema=public"
pnpm test:e2e

# Frontend component tests specifically
pnpm --filter @cinesphere/web test

# Python ML package tests (Pytest)
cd ml && pytest
```

---

## Local LLM (Ollama)

CineSphere optionally integrates with [Ollama](https://ollama.com/) to power conversational discovery and enhanced taste profile descriptions.

**Ollama is entirely optional.** All core features — including the recommendation engine, library tracking, statistics, and Movie Universe — work without it.

To enable Ollama:

1. Install Ollama locally: https://ollama.com/download
2. Pull a model: `ollama pull llama3.2`
3. Set `OLLAMA_ENABLED=true` and `OLLAMA_MODEL=llama3.2` in your `.env`

LLM-dependent features degrade gracefully when Ollama is unavailable — they either show a fallback or indicate that local AI is not configured.

---

## Operating Modes

### Local Mode

Full functionality including optional LLM features. Requires Docker Compose and a TMDB API key. No paid services required.

### Hosted Portfolio Mode

CineSphere can be deployed publicly to demonstrate the project. In this mode:

- Ollama is not available — LLM-dependent features are disabled.
- The public demo uses a curated, anonymized dataset — no personal watch history is exposed.
- Embeddings, clusters, and UMAP coordinates are precomputed and deployed with the demo data.
- Core recommendation and Movie Universe functionality remains available.
- Hosting costs are minimized.

---

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

Movie and TV metadata is sourced from [The Movie Database (TMDB)](https://www.themoviedb.org/). A TMDB API key is required for local development. TMDB attribution must be displayed wherever TMDB data is shown, per their [API terms of use](https://www.themoviedb.org/documentation/api/terms-of-use).

---

## Project Status

**Current phase:** Phase 3 — Personal Library and Tracking (Stage 3.8 Complete — Phase 3 100% Finished)

**What exists & is verified:**

- TypeScript monorepo with Turborepo 2.x and pnpm 10 workspaces
- Next.js 14+ App Router frontend ([`apps/web`](apps/web)):
  - Personal Dashboard (`/`) with 5 aggregated sections: Viewing Summary stat cards, Continue Watching cards with next-episode calculations and progress bars, Recent Activity timeline, and Quick Picks catalogue recommendations
  - Discover experience with TMDB search, curated popular/trending sections, debounce, pagination, and `MediaCard` components
  - My Library experience (`/library`) with 5 status tabs, media type toggle, sorting, pagination, and `LibraryCard` components
  - Statistics Foundation (`/statistics`) with 4 primary summary cards (Movies Completed, Episodes Watched, Shows Completed, Average Personal Rating), secondary metrics bar, top 8 genres breakdown with "View all" toggle, monthly stacked viewing activity timeline, 19-bucket personal rating histogram, accessible data tables, and authentic foundation state
  - `AddLibraryModal` with status selection, 1.0–10.0 half-step ratings, notes, and duplicate prevention
  - `LibraryDetailModal` with movie viewing event logging, viewing history, TV episode toggle progress, batch "Mark All Watched" (with specials inclusion toggle), per-season ratings, notes editor, and deletion with confirmation
  - 135 frontend component unit tests passing across 12 suites
- NestJS REST API backend ([`apps/api`](apps/api)):
  - Consolidated Dashboard API (`DashboardModule` with `GET /api/dashboard/overview`, `/stats`, `/continue-watching`, `/recent-activity`, `/quick-picks`)
  - TMDB proxy, client retry logic with exponential backoff, Bearer authentication, and catalogue ingestion layer (`TmdbModule`)
  - Local catalogue browsing, search, and details endpoints (`CatalogueModule`)
  - Personal library REST API (`POST/GET/PATCH/DELETE /api/library`, `/viewing-events`, `/episode-progress`, `/mark-all-watched`, `/season-ratings`) (`LibraryModule`)
  - Deterministic single-user bootstrapping (`SingleUserBootstrap`)
  - Centralized database error mapping (`DatabaseErrorMapper`)
  - 143 backend unit tests passing across 13 suites
  - 152 PostgreSQL integration tests passing across 8 suites with real transactions and triggers
  - Total monorepo unit tests: 297 passing unit tests (143 backend + 154 frontend)
- End-to-End Testing & Hardening ([`apps/web/e2e`](apps/web/e2e)):
  - Playwright E2E infrastructure with dedicated test database isolation (`CINESPHERE_E2E_DATABASE_URL`), fail-closed validation, and server isolation
  - 30 comprehensive workflow tests passing across 6 suites:
    - Workflow A: Movie lifecycle (discovery $\to$ library $\to$ detail modal rating & notes $\to$ reload persistence $\to$ removal)
    - Workflow B: Viewing history logging (append-only events, independent ratings, reload persistence, library entry decoupling)
    - Workflow C: TV episode progress tracking (season/episode listing, individual toggle, multi-episode state, reload persistence, unmark)
    - Workflow D: Library detail modal integration (movie & TV coexistence, state freshness across reopen, per-season ratings, notes editor)
    - Workflow E: Dashboard consistency (renders without error, stat cards with accurate metrics, continue watching progression)
    - Workflow F: Navigation & page integration (navbar links, direct routing, statistics foundation indicators, console error hygiene)
- Shared TypeScript contracts and DTOs ([`packages/shared`](packages/shared)) including statistics models (`StatsOverviewSummary`, `GenreStatItem`, `ActivityTimelineData`, `RatingStatsData`, `StatisticsPageData`)
- Shared linting, Prettier, and TypeScript configs ([`packages/config`](packages/config))
- Dockerized PostgreSQL 16 database with `pgvector` extension enabled (`0.8.7`)
- Prisma 6 ORM integration with dedicated SQL migrations:
  - Phase 1: pgvector extension & initial vector repository foundation
  - Phase 2: Catalogue tables (`Movie`, `TvShow`, `Season`, `Episode`, `Genre`, `Keyword`, `Person`, `PersonCredit`)
  - Phase 3: Personal library foundation (`UserLibraryEntry`, `ViewingEvent`, `EpisodeProgress`, `SeasonRating`), XOR media check constraint, rating check constraints, partial unique indexes, locking helper functions, and `VOLATILE` triggers
- Python ML package structure with Ruff linter and Pytest test suite ([`ml/`](ml))
- Continuous Integration (`.github/workflows/ci.yml`):
  - GitHub Actions runs `pgvector/pgvector:pg16` service container
  - Enforces `prisma generate`, `typecheck`, `lint`, `format:check`, unit tests (`pnpm test`), migration deployment (`prisma migrate deploy`), backend integration tests (`test:integration`), production builds (`pnpm build`), and Playwright E2E tests (`pnpm test:e2e`)
  - Python ML checks (Ruff lint/format & Pytest)

**What does not exist yet (Upcoming Phases):**

- Viewing statistics with charts and data import/export pipelines (Phase 4)
- Sentence Transformers embedding generation and candidate scoring (Phase 5)
- Recommendation intelligence, diversity modes, and Taste Profile (Phase 6)
- Optional local LLM integration via Ollama (Phase 7)
- Movie Universe PixiJS canvas visualization (Phase 8)

> See [`tasks.md`](tasks.md) for the full project roadmap and current task status.

---

## Roadmap

| Phase  | Description                                                       |
| ------ | ----------------------------------------------------------------- |
| **1**  | Project foundation — monorepo, tooling, Docker, database baseline |
| **2**  | TMDB integration and catalogue management                         |
| **3**  | Personal library and tracking                                     |
| **4**  | Statistics and data import/export                                 |
| **5**  | Recommendation engine foundation                                  |
| **6**  | Recommendation intelligence, diversity, and taste profiling       |
| **7**  | Local LLM integration                                             |
| **8**  | Movie Universe interactive map                                    |
| **9**  | Testing, security, and QA                                         |
| **10** | Deployment and portfolio preparation                              |

---

## License

License: **Undecided**

A license has not yet been selected for this project. This will be resolved before public release. See [`tasks.md`](tasks.md) TD-01.

---

## Acknowledgements

- Movie and TV metadata: [The Movie Database (TMDB)](https://www.themoviedb.org/)
- Embedding models: [Sentence Transformers](https://www.sbert.net/)
- Vector search: [pgvector](https://github.com/pgvector/pgvector)
- Visualization: [PixiJS](https://pixijs.com/)
