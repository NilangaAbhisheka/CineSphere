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
- No platform provides a semantic understanding of *why* a viewer likes what they like.
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

| Feature | Description | Status |
|---|---|---|
| **My Library** | Track movies and TV shows with status, ratings, progress, and notes | Planned |
| **Discover** | Search, browse trending content, apply mood and genre filters | Planned |
| **For You** | Hybrid recommendation engine with diversity controls and explanations | Planned |
| **AI Taste Profile** | Structured model of personal viewing preferences | Planned |
| **Taste Evolution** | Snapshots of preference changes over time | Planned |
| **Movie Universe** | Interactive 2D semantic map of movies powered by embeddings and PixiJS | Planned |
| **Statistics** | Personal viewing analytics and history | Planned |
| **Import / Export** | JSON and CSV data portability | Planned |
| **Local LLM** | Optional conversational discovery via Ollama (local only) | Planned |

---

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | Next.js 14+ with TypeScript |
| Styling | Tailwind CSS |
| Backend | NestJS with TypeScript |
| API | REST |
| Database | PostgreSQL 16+ |
| Vector search | pgvector |
| ORM | Prisma |
| Machine Learning | Python 3.11+ |
| Embeddings | Sentence Transformers |
| ML utilities | scikit-learn |
| Clustering | HDBSCAN |
| Dimensionality reduction | UMAP |
| Interactive visualization | PixiJS |
| Movie metadata | TMDB API |
| Local LLM | Ollama (optional) |
| Frontend testing | Playwright, Jest, React Testing Library |
| Backend testing | Jest |
| Python testing | Pytest |
| Local infrastructure | Docker Compose |
| Version control | Git + GitHub |

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

> ⚠️ **The following commands will only be usable once the project scaffolding has been implemented (Phase 1). The project is currently in its documentation initialization phase.**

### Prerequisites

- Node.js 20+
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
# Edit .env and fill in required values (see Environment Variables below)
```

### 3. Start the infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL with pgvector. Optionally starts Ollama if enabled in your `.env`.

### 4. Install dependencies

```bash
# TypeScript monorepo
npm install

# Python ML package
cd ml
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

### 5. Set up the database

```bash
# Run Prisma migrations
npx prisma migrate dev
```

### 6. Start the development servers

```bash
# Start both web and API in development mode
npm run dev
```

Access the application at `http://localhost:3000`.

---

## Environment Variables

CineSphere uses environment variables to configure application parameters, external API keys, database connections, and optional AI services.

### Configuration Template & Local Setup
- **Template (`.env.example`):** The tracked template file defining all identified configuration keys with safe example defaults or empty placeholders.
- **Local File (`.env`):** Created by copying `.env.example` (`cp .env.example .env`). This file contains your machine's local configuration and API keys. It is strictly excluded from version control via `.gitignore`.

### Server-Side vs. Client-Side Variables
- **Public Variables (`NEXT_PUBLIC_*`):** Next.js exposes variables prefixed with `NEXT_PUBLIC_` directly to browser-side JavaScript bundles (e.g., `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_HOSTED_MODE`). Only non-sensitive URLs and feature flags may use this prefix.
- **Server-Only Secrets:** All database credentials (`DATABASE_URL`, `POSTGRES_PASSWORD`), TMDB API keys (`TMDB_API_KEY`), and session secrets (`SESSION_SECRET`) omit the `NEXT_PUBLIC_` prefix and are strictly confined to server-side runtimes (NestJS and Next.js server components). Never expose secrets to the client.

Key variables:

| Variable | Scope | Description |
|---|---|---|
| `DATABASE_URL` | Server | PostgreSQL + pgvector connection string |
| `TMDB_API_KEY` | Server | TMDB API v3 key (required for catalogue lookups) |
| `TMDB_READ_ACCESS_TOKEN` | Server | TMDB API v4 read access token (optional alternative) |
| `OLLAMA_BASE_URL` | Server | Ollama API base URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Server | Ollama model tag (e.g., `llama3.2`) |
| `OLLAMA_ENABLED` | Server | Set to `true` to enable local AI features |
| `NEXT_PUBLIC_API_URL` | Client & Server | Public backend API URL consumed by the web browser |
| `HOSTED_MODE` | Server | Set to `true` in hosted portfolio deployment |
| `NEXT_PUBLIC_HOSTED_MODE` | Client & Server | Hosted mode flag consumed by frontend UI components |

---

## Testing

> ⚠️ **Tests will be runnable once implementation begins (Phase 1+).**

```bash
# TypeScript unit and integration tests (Jest)
npm run test

# End-to-end tests (Playwright)
npm run test:e2e

# Python ML tests (Pytest)
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

**Current phase:** Phase 1 — Project Foundation (Environment & Tooling Initialization)

**What exists:**
- Project documentation, project plan, and architecture design (`docs/`)
- Antigravity AI engineering instructions ([`AGENTS.md`](AGENTS.md)) & Cursor rules ([`.cursor/rules/cinesphere.mdc`](.cursor/rules/cinesphere.mdc))
- Database schema specification and ER diagrams ([`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md))
- Project progress tracker with phased milestones ([`tasks.md`](tasks.md))
- Git repository initialization on `main` branch with comprehensive [`.gitignore`](.gitignore)
- Root configuration files ([`.editorconfig`](.editorconfig), [`.gitattributes`](.gitattributes), [`.dockerignore`](.dockerignore), [`.nvmrc`](.nvmrc))
- Environment variable templates ([`.env.example`](.env.example)) and local development environment ([`.env`](.env))

**What does not exist yet:**
- Monorepo package structure and scaffolding (Next.js & NestJS)
- Application source code and dependencies
- Database migrations and Prisma client generation
- Docker Compose multi-service definitions
- API endpoints and frontend views
- Python ML scripts

> See [`tasks.md`](tasks.md) for the full project roadmap and current task status.

---

## Roadmap

| Phase | Description |
|---|---|
| **1** | Project foundation — monorepo, tooling, Docker, database baseline |
| **2** | TMDB integration and catalogue management |
| **3** | Personal library and tracking |
| **4** | Statistics and data import/export |
| **5** | Recommendation engine foundation |
| **6** | Recommendation intelligence, diversity, and taste profiling |
| **7** | Local LLM integration |
| **8** | Movie Universe interactive map |
| **9** | Testing, security, and QA |
| **10** | Deployment and portfolio preparation |

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
