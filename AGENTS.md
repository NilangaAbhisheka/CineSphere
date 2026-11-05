# CineSphere — Antigravity Engineering Guidelines & Project Instructions

This document defines the mandatory engineering standards, architectural boundaries, operating principles, and workflow instructions for AI coding agents (specifically **Google Antigravity**) working on **CineSphere**.

---

## 1. Project Context & Vision

### 1.1 Purpose

CineSphere is a **personal movie and television tracking, discovery, recommendation, and analytics platform** built for a single user. It provides a sophisticated entertainment intelligence experience combining personal watch history tracking, a hybrid content-based recommendation engine, semantic taste profiling, and an interactive 2D Movie Universe semantic map.

### 1.2 Scope & Non-Goals

- **Single-User Scope:** CineSphere is built for a single user and will eventually be deployed as a public portfolio demonstration.
- **Strict Non-Goals:** Do NOT design multi-tenant SaaS architecture, subscription or billing systems, commercial authentication flows, open user registration, or social networks. Avoid premature complexity.

### 1.3 Two Operating Modes

1. **Local Mode:**
   - Full application functionality.
   - Optional local LLM integration via **Ollama** (e.g., `llama3.2`).
   - Local on-demand embedding generation and ML processing.
   - Conversational discovery and natural-language taste summaries.
   - Zero mandatory paid AI APIs or cloud subscriptions.
2. **Hosted Portfolio Mode (`HOSTED_MODE=true`):**
   - Publicly accessible demonstration operating at near-zero hosting cost.
   - Operates **without** Ollama or paid LLM APIs (LLM features degrade gracefully or are disabled).
   - Core recommendation and Movie Universe features run from **precomputed fixtures** (embeddings, similarity graphs, clusters, UMAP coordinates).
   - Personal watch history and private notes are **never** exposed; a curated, anonymized dataset is presented.
   - Read-only protection for public visitors.

---

## 2. Approved Technology Stack

Every component must adhere to the approved technology stack. Do not introduce new frameworks, runtimes, or databases without explicit justification.

| Area                         | Approved Technology                    | Notes                                                                                       |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Frontend**                 | Next.js 14+ (App Router) + TypeScript  | Modern React Server Components; client components only when required (`'use client'`).      |
| **Styling**                  | Tailwind CSS                           | Utility-first styling.                                                                      |
| **Backend**                  | NestJS + TypeScript                    | Structured modular REST API with dependency injection.                                      |
| **API Protocol**             | REST (JSON)                            | Clean, typed REST endpoints with DTO validation.                                            |
| **Database**                 | PostgreSQL 16+ with `pgvector`         | Single primary relational store and vector similarity engine.                               |
| **ORM**                      | Prisma                                 | Type-safe database client. Raw SQL (`$queryRaw`) strictly isolated for pgvector operations. |
| **Machine Learning**         | Python 3.11+                           | Offline / on-demand scripts in `ml/`. Not a persistent microservice.                        |
| **Embeddings**               | Sentence Transformers                  | Local semantic vector generation.                                                           |
| **ML Utilities**             | scikit-learn, numpy, pandas            | Mathematical utilities and preprocessing.                                                   |
| **Clustering**               | HDBSCAN                                | Density-based clustering in high-dimensional embedding space.                               |
| **Dimensionality Reduction** | UMAP (`umap-learn`)                    | Generates 2D coordinates for visual rendering **only**.                                     |
| **Visualization**            | PixiJS                                 | High-performance 2D WebGL canvas rendering for Movie Universe.                              |
| **Metadata Provider**        | TMDB API (v3/v4)                       | On-demand external movie/TV metadata cache. TMDB attribution required.                      |
| **Local LLM**                | Ollama                                 | Optional local model runner. System must never hard-depend on it.                           |
| **Testing**                  | Jest, Playwright (TS), Pytest (Python) | Unit, integration, E2E, and ML pipeline validation.                                         |
| **Infrastructure**           | Docker Compose                         | Local development containerization.                                                         |
| **Version Control**          | Git + GitHub                           | Conventional Commits, clean history.                                                        |

### Prohibited Infrastructure

Do **not** introduce Redis, Kafka, RabbitMQ, Celery, Spark, Kubernetes, Elasticsearch, GraphQL, or alternative databases unless a documented and verified performance bottleneck necessitates it.

---

## 3. System Architecture & Boundaries

```
cinesphere/
├── apps/
│   ├── web/          # Next.js frontend (UI & client state only)
│   └── api/          # NestJS backend (REST API, business logic, Prisma)
├── packages/
│   ├── shared/       # Shared TypeScript types, interfaces, DTOs
│   └── config/       # Shared ESLint, Prettier, TypeScript configurations
├── ml/               # Python ML package (on-demand scripts)
│   ├── embeddings/   # Sentence Transformers embedding generation
│   ├── clustering/   # HDBSCAN clustering
│   ├── similarity/   # High-dimensional cosine similarity computation
│   ├── recommendations/ # Offline scoring and candidate preparation
│   ├── taste-profiling/ # Structured preference modeling
│   ├── movie-map/    # UMAP 2D projection
│   └── scripts/      # Execution CLI entry points
├── infrastructure/
│   ├── docker/       # Dockerfiles
│   ├── database/     # DB initialization scripts
│   └── deployment/   # Hosting configuration
├── docs/             # Technical specifications & design docs
├── tasks.md          # Central project progress tracker
├── AGENTS.md         # Antigravity project instructions (this file)
└── README.md         # Project root guide
```

### 3.1 Strict Layer Separation

- **`apps/web` (Frontend):** Consumes the NestJS REST API. Contains no direct database access, no TMDB API keys, and no ML code.
- **`apps/api` (Backend):** Implements all business logic, TMDB proxy/caching, user tracking, and database interactions via Prisma. Exposes typed REST endpoints.
- **`ml/` (Python ML):** Executes on-demand or batch scripts directly against the database (or via CLI). Generates embeddings, computes similarity matrices, runs clustering, and outputs 2D UMAP coordinates.
- **Data Flow:** ML scripts write results to PostgreSQL $\to$ NestJS API serves data $\to$ Next.js UI displays data. Data never flows in reverse.

### 3.2 Recommendation Engine Rules

- **LLM Independence:** The recommendation engine is a **hybrid content-based mathematical scoring model** completely independent of LLMs.
- **Scoring Formula:**
  $$\text{Score} = 0.35S + 0.25P + 0.20M + 0.10Q + 0.10N$$
  - $S$: Semantic similarity (high-dimensional cosine similarity from pgvector).
  - $P$: Personal preference match (genre, keyword, tone alignment).
  - $M$: Mood match (predefined categories or optional LLM mapping).
  - $Q$: Quality/popularity signal (TMDB normalized rating and popularity).
  - $N$: Novelty penalty (penalizes recently seen or overly familiar titles).
- Weights are experimental and configurable — never hardcoded constants.
- **Dual Preference Signals:** Maintain separate positive and negative preference vectors. Never collapse user taste into a single arithmetic average.
- **Feedback Distinctions:** Distinguish `interested`, `not_interested`, `already_watched`, `not_my_type`, `watched_and_loved`, and `watched_and_disappointed`. Note that `already_watched` is **never** a negative signal.
- **Immutability:** Historical recommendation records (`RecommendationRecord`) must never be recalculated or overwritten when scoring formulas evolve.

### 3.3 Movie Universe Rules

- **High-Dimensional Ground Truth:** All similarity calculations, nearest-neighbour queries, and HDBSCAN clustering must run on the original high-dimensional embeddings (e.g., 384 or 768 dimensions).
- **UMAP is Visualization-Only:** 2D UMAP coordinates (`umapX`, `umapY`) are generated strictly for PixiJS canvas layout. **Never** use 2D coordinates for similarity queries or ranking.
- **Progressive Catalogue Growth:** Do not attempt to embed the entire TMDB catalogue. Fetch and embed titles incrementally as discovered or tracked.

### 3.4 Optional Local LLM (Ollama)

- Ollama is an auxiliary enhancement for conversational discovery and narrative taste descriptions.
- The system must perform a health check on startup. If Ollama is unavailable or `OLLAMA_ENABLED=false`, the API must return a structured fallback (`LLM_UNAVAILABLE`), and the UI must gracefully disable the conversational prompt without error.

---

## 4. Engineering Standards & Best Practices

### 4.1 TypeScript Standards

- **Strict Mode:** `strict: true` is mandatory across all `tsconfig.json` files.
- **Explicit Return Types:** All exported functions, service methods, and controller actions must specify explicit return types.
- **No `any`:** Avoid `any` escapes. Use proper generic types, discriminated unions, or `unknown` with type narrowing.
- **Shared Contracts:** DTOs and API interfaces must live in `packages/shared` to ensure frontend-backend synchrony.

### 4.2 Python Standards

- **Python 3.11+:** Use type hints throughout (`typing` / built-in generics).
- **Tooling:** Format with Black, lint with Ruff or Flake8.
- **Data Validation:** Use Pydantic models or dataclasses for structured schemas instead of untyped dictionaries.
- **Batch Processing:** Always batch vector database insertions and heavy computations.

### 4.3 Database & Prisma Standards

- **Schema Responsibility:** Prisma manages the relational schema. pgvector columns and HNSW indexes are maintained via explicit SQL migration scripts.
- **Repository Encapsulation:** Wrap raw SQL vector operations in a dedicated `VectorRepository` or service. Never inline `$queryRaw` across disparate modules.
- **Atomic Transactions:** All multi-step mutations (especially data imports and batch status updates) must execute within interactive Prisma transactions (`$transaction`).
- **Never Silently Drop Data:** In import pipelines (JSON/CSV), validate every record and return detailed error diagnostics for invalid entries. Never discard bad records silently.

### 4.4 Security & Secrets

- **Zero Secrets in Code:** Never commit passwords, TMDB API keys, session secrets, or tokens.
- **Environment Isolation:** Use `.env` (ignored by Git) and `.env.example` (tracked template).
- **Input Sanitization:** All incoming requests must be validated using NestJS `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`.
- **Query Parameterization:** Never concatenate raw user strings into SQL queries.
- **Log Hygiene:** Never log passwords, tokens, or personal watch history.

### 4.5 Testing Expectations

- **Unit Testing:** Mandatory for recommendation scoring formulas, candidate filtering, statistics calculations, and import parsing.
- **Integration Testing:** Required for API endpoints and database repository interactions.
- **End-to-End Testing:** Validate key user workflows with Playwright.
- **ML Testing:** Verify embedding dimensions, cosine similarity boundaries, and clustering non-emptiness using Pytest.
- **Rule:** A passing compilation is not proof of functionality. Write and run automated tests.

### 4.6 Git & Commit Conventions

- Use **Conventional Commits**:
  - `feat:` new user-facing or backend functionality
  - `fix:` bug resolution
  - `docs:` documentation updates
  - `refactor:` code restructuring without behaviour changes
  - `test:` adding or updating tests
  - `chore:` tooling, configuration, dependencies
  - `build:` Docker, monorepo, or CI/CD configuration
- Keep commits focused and atomic. Never commit generated files, temporary artifacts, or local virtual environments.

---

## 5. Antigravity Agent Workflow

For every non-trivial implementation task, Antigravity must execute the following structured 10-step workflow:

1. **Understand the Task:** Analyze the user prompt, verify the phase and requirements against `tasks.md` and `docs/PROJECT_PLAN.md`.
2. **Inspect Relevant Documentation:** Review `README.md`, `tasks.md`, `docs/ARCHITECTURE.md`, and `docs/DATABASE_DESIGN.md`.
3. **Review Existing Implementation:** Inspect relevant existing code files and dependencies. Never assume the current directory state.
4. **Explain the Implementation Plan:** Outline the technical strategy, intended design patterns, and affected components before writing extensive code.
5. **Identify Affected Files & Dependencies:** Clearly list the files to be created, modified, or moved.
6. **Implement in Manageable Logical Units:** Write clean, modular, strongly-typed code adhering to the architecture and standards.
7. **Run Relevant Tests & Validation:** Execute linters, type checks (`tsc --noEmit`), and automated tests (`pytest`, `jest`).
8. **Review Changes:** Conduct a self-review of modified files for edge cases, security risks, and unused imports.
9. **Update Documentation & `tasks.md`:** Synchronize technical documentation if designs evolved. Mark tasks `[x]` in `tasks.md` **only** after verification is complete.
10. **Summarize Changes & Next Steps:** Deliver a concise summary of implemented items, verification results, open technical decisions, and recommended next milestones.

### Autonomy vs. Approval

- **Full Autonomy:** Code creation, refactoring, adding tests, standard bug fixes, and documentation synchronization within the established architecture.
- **Explicit Consultation Required:**
  - Introducing new infrastructure or external dependencies.
  - Modifying architectural boundaries or scoring formulas.
  - Destructive file/database operations.
  - Resolving open technical decisions (TD-01 through TD-10).

---

## 6. Project Tracking & `tasks.md` Maintenance

`tasks.md` is the **single source of truth for implementation progress**.

- **Verification Rule:** Never mark a checkbox `[x]` unless the code exists, compiles, and passes automated or manual verification.
- **Pending Technical Decisions:** Do not invent resolutions for open decisions. Track them in `tasks.md` under **Pending Technical Decisions**:
  - `TD-01`: License selection
  - `TD-02`: Monorepo tooling (Turborepo vs. Nx)
  - `TD-03`: NestJS module structure
  - `TD-04`: Prisma + pgvector integration pattern
  - `TD-05`: Frontend state management library
  - `TD-06`: Recommendation weight tuning strategy
  - `TD-07`: TMDB data seeding scope
  - `TD-08`: Sentence Transformers embedding model (determines vector dimension)
  - `TD-09`: Public portfolio anonymization strategy
  - `TD-10`: Authentication approach for local vs. hosted modes

---

## 7. Cursor & Tool Compatibility

- `.cursor/rules/cinesphere.mdc` is maintained in `.cursor/rules/` for backward compatibility with Cursor.
- `AGENTS.md` (this file) is the **primary instruction file** for Google Antigravity.
- Both files express identical architectural and engineering principles. When modifying core rules, keep both configurations in harmony.
