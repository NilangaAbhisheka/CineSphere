# CineSphere — AI Development Guide

**Status:** Active  
**Last Updated:** 2026-11-05  
**Version:** 1.0  
**Audience:** AI coding agents (Cursor, Claude, Gemini, Copilot, etc.) and human contributors

> This guide defines how AI coding agents must operate on the CineSphere codebase. These rules apply to every task, every file, and every change.

---

## 1. Before You Write a Single Line of Code

**Read the documentation first.**

For any non-trivial task:

1. Read `README.md` — understand the project purpose, stack, and operating modes.
2. Read `tasks.md` — understand current project phase, what is complete, and what is pending.
3. Read `docs/ARCHITECTURE.md` — understand component responsibilities and data flow.
4. Read `docs/DATABASE_DESIGN.md` if the task touches the data model.
5. Read `docs/PROJECT_PLAN.md` if the scope or requirements of a feature are unclear.

If a task involves a specific area (recommendation engine, ML, Movie Universe, import/export), locate and read the relevant documentation for that area before beginning.

**Do not guess at requirements.** If the documentation is unclear, say so and ask — do not invent requirements to fill the gap.

---

## 2. Inspect Before Modifying

Before changing any existing file:

1. Read the full file to understand its current implementation, structure, and intent.
2. Identify what other code depends on the file.
3. Understand why the current implementation exists the way it does.
4. Do not silently change behaviour that is working correctly.
5. Never overwrite or discard existing user code without explicit permission.

Before creating a new file:
1. Search the codebase for existing implementations of similar functionality.
2. Do not create a new service, utility, or module if the functionality already exists.

---

## 3. Architecture Rules — Non-Negotiable

### 3.1 Component Boundaries

| Layer | Owns | Does NOT own |
|---|---|---|
| Frontend (`apps/web/`) | UI rendering, client state, API consumption | Business logic, database access, ML operations |
| Backend (`apps/api/`) | REST API, business logic, TMDB integration, Prisma access | Frontend rendering, ML computation |
| Python ML (`ml/`) | Embedding generation, clustering, UMAP, scoring scripts | Frontend/backend request handling |
| Database | Data persistence, vector storage | Business logic, application state |

**Do not blur these boundaries.** If the frontend needs data from the ML layer, the ML layer writes results to the database, the backend reads them, and the frontend queries the backend. That is the data flow.

### 3.2 Database Access

- Use Prisma for all standard database operations in the backend.
- Use `$queryRaw` or `$executeRaw` only where Prisma cannot express the operation (pgvector). These uses must be parameterized — never string-interpolated.
- Encapsulate all raw SQL in a dedicated repository/service layer. Do not scatter raw SQL across multiple modules.
- Do not access the database from the frontend.
- Do not introduce a second ORM or database connection library without documenting the reason.

### 3.3 The Recommendation Engine Does Not Use the LLM

The recommendation scoring pipeline (`Score = 0.35·S + 0.25·P + 0.20·M + 0.10·Q + 0.10·N`) must function without Ollama. Do not add an LLM call to the scoring path. LLM is permitted only in clearly isolated, gracefully-degradable features (conversational discovery, taste profile narration, mood interpretation).

### 3.4 UMAP Coordinates Are Visualization-Only

Never use `ClusterAssignment.umapX` / `umapY` as input to similarity search, nearest-neighbour lookup, clustering, or recommendation scoring. If you find yourself writing code that queries these columns for a non-visualization purpose, stop and re-read `docs/ARCHITECTURE.md`.

### 3.5 Do Not Introduce Unapproved Infrastructure

The approved stack is defined in `README.md`. Do not introduce Redis, Kafka, Kubernetes, Spark, Celery, or other infrastructure components. If you believe one is genuinely needed, document the problem it solves and explain why a simpler solution is insufficient — then wait for review.

---

## 4. Code Quality Standards

### TypeScript

- Enable `strict: true` in all TypeScript projects. No exceptions.
- Use explicit return types on all exported functions and class methods.
- Avoid `any` and `unknown` without a typed narrowing path.
- Prefer `interface` for object shapes that may be extended; `type` for unions and computed types.
- Use meaningful, specific names. Avoid `data`, `item`, `result`, `obj` as sole identifiers.
- Group related logic in cohesive modules. A module that grows to 500+ lines is a signal it should be split.
- Do not duplicate business logic between the frontend and backend. Shared logic belongs in `packages/shared/`.

### Python

- Use type hints throughout. This is not optional.
- Follow PEP 8. Use Black for formatting and Ruff or Flake8 for linting.
- Use dataclasses or Pydantic models for structured data — do not pass raw dicts between functions.
- Document the purpose and expected input/output of every public function.
- Scripts in `ml/scripts/` should accept CLI arguments via `argparse` or `typer`, not hardcoded paths.
- Batch database writes — do not write one record at a time in a loop.

### General

- No magic numbers or magic strings. Use named constants.
- No dead code (commented-out code, unreachable branches). Remove it.
- No `TODO` comments that represent blocked technical debt without a corresponding `tasks.md` entry.
- Handle all error cases explicitly. Do not silently swallow exceptions.
- Do not log sensitive data (personal ratings, watch history, API keys, passwords).

---

## 5. Security Requirements

These are non-negotiable and apply to every task:

1. **Never hardcode secrets.** API keys, database credentials, tokens, and passwords must only appear in environment variables. Never in source code, comments, or test fixtures committed to git.
2. **Validate all external input.** API request bodies, query parameters, path parameters, and uploaded file contents must all be validated before use. Use NestJS validation pipes and class-validator.
3. **Use parameterized queries.** Prisma queries are parameterized by default. Raw SQL (`$queryRaw`) must always use parameterized form — never construct SQL strings from user input.
4. **Validate import file contents.** Uploaded JSON and CSV files must be validated against a known schema before any database writes occur. Never trust imported data.
5. **Do not expose internal errors to clients.** Catch and log full errors server-side. Return sanitized error messages to the API client.
6. **Do not log personal data.** Watch history, ratings, reviews, and profile data must not appear in application logs.
7. **Apply least-privilege principles.** The database user used by the application should not have superuser privileges. The hosted demo should run in a read-only mode.

---

## 6. Testing Expectations

Write tests for meaningful functionality. Do not treat a successful TypeScript compilation or a passing lint check as proof that functionality works.

| Test type | Scope | Tool |
|---|---|---|
| Unit | Business logic, scoring functions, validation, utilities | Jest (TS), Pytest (Python) |
| Integration | API endpoints with database interaction (mocked or test DB) | Jest + Supertest |
| End-to-end | Key user workflows through the full stack | Playwright |
| ML tests | Embedding output shapes, similarity computation, clustering | Pytest |

**What must have tests:**
- Recommendation scoring logic (all five components, edge cases).
- Import validation (valid input, invalid input, partial failures, duplicate detection).
- Library CRUD operations.
- Statistics aggregation functions.
- Embedding generation (shape, type, non-null output on valid input).
- UMAP and clustering scripts (output format, expected dimensionality).

**Write tests before or alongside the implementation** for complex business logic, especially the recommendation engine.

---

## 7. Error Handling

Handle errors explicitly at every system boundary:

- **API controllers:** Catch service-layer exceptions and map them to appropriate HTTP status codes. Do not let unhandled exceptions reach the client as 500s with internal stack traces.
- **TMDB API client:** Handle rate limit (429), not found (404), and network errors explicitly. Apply retry logic with exponential backoff for transient errors.
- **Ollama client:** If Ollama is unreachable, return a typed `LLM_UNAVAILABLE` result — do not throw. The calling service decides how to handle LLM unavailability.
- **Import service:** Collect all validation errors across all records. Never silently skip invalid records. Return a complete error report. Roll back the entire transaction on failure.
- **ML scripts:** Log errors with sufficient context to diagnose the failure. Exit with a non-zero code on failure. Do not write partial results to the database.
- **Prisma errors:** Catch `PrismaClientKnownRequestError` for constraint violations (duplicate entries, etc.) and convert to meaningful application errors, not 500s.

---

## 8. Documentation Rules

- **Update `tasks.md` after every verified task completion.** Mark a task `[x]` only when the implementation is complete and confirmed working. Never mark tasks complete speculatively.
- **Update `docs/ARCHITECTURE.md`** if an architectural decision changes.
- **Update `docs/DATABASE_DESIGN.md`** if the schema changes.
- **Add to the Architectural Decisions Log** in `docs/ARCHITECTURE.md` when a significant new design decision is made.
- **Preserve existing comments and docstrings** that are unrelated to your change.
- **Use present tense** in documentation to describe current state. Use "planned" or "proposed" to describe future state.

---

## 9. AI-Assisted Implementation Workflow

Follow this 10-step cycle for every non-trivial task:

### Step 1 — Understand the Task
- Read the task description and any linked `tasks.md` entry.
- Identify the phase, deliverables, and dependencies.
- Confirm the task is not already implemented.

### Step 2 — Inspect Relevant Documentation
- Read the relevant documentation files (architecture, database design, project plan).
- Identify explicit constraints, scoring formulas, or non-functional requirements.

### Step 3 — Review Existing Implementation
- Inspect the existing codebase and dependencies.
- Read files that will be touched or depended upon.
- Understand current patterns and avoid duplicating existing functionality.

### Step 4 — Explain the Proposed Implementation Plan
- Before writing any code, outline:
  - What you are going to build.
  - Which files you will create or modify.
  - Any design patterns or decisions you are making and why.
  - Any concerns, risks, or uncertainties.
- If the plan involves an architectural boundary change, flag it explicitly and obtain confirmation.

### Step 5 — Identify Affected Files and Dependencies
- List all files that will be created, modified, or moved.
- Confirm none of them contain work that would be overwritten without permission.

### Step 6 — Implement in Manageable Logical Units
- Implement the change in focused, logical increments.
- Keep each change coherent — do not mix unrelated changes in a single step.
- Follow the TypeScript and Python standards above.
- Do not leave the codebase in a broken state between steps.

### Step 7 — Run Relevant Tests and Validation
- Run the TypeScript type-checker (`tsc --noEmit`).
- Run the linter (`eslint`).
- Run existing tests to confirm nothing is broken.
- Run any new tests written for this task (`jest`, `playwright`, `pytest`).
- For Python, run Ruff/Flake8 and Pytest.

### Step 8 — Review the Resulting Changes
- Read through every file you modified.
- Confirm the implementation matches the stated plan.
- Confirm no security vulnerabilities (secrets, unvalidated input, parameterization).
- Confirm tests and checks pass cleanly.

### Step 9 — Update Documentation and tasks.md
- Update `tasks.md` to mark completed tasks with `[x]` (verified only).
- Update relevant documentation if behaviour or architecture changed.
- Add decisions made to the Architectural Decisions Log in `docs/ARCHITECTURE.md` if appropriate.

### Step 10 — Summarize Changes, Verification Results, and Next Steps
- State clearly what was implemented.
- Provide verification and test execution results.
- State what was deliberately left out or deferred.
- Highlight any pending technical decisions or remaining issues.

---

## 10. What AI Agents Must NOT Do

- Do not mark tasks complete in `tasks.md` without verified implementation.
- Do not invent requirements that are not documented.
- Do not silently change architectural decisions — flag them and explain.
- Do not introduce new infrastructure (Redis, queues, microservices) without explicit justification and documentation.
- Do not make Ollama mandatory for any core feature.
- Do not use UMAP coordinates for similarity computation.
- Do not add an LLM call to the recommendation scoring pipeline.
- Do not overwrite existing user code without explicit permission.
- Do not create duplicate implementations of existing functionality.
- Do not prematurely optimize code that does not have a measured performance problem.
- Do not add `any` types to work around TypeScript errors — fix the types.
- Do not treat "it compiles" as "it works."
- Do not commit secrets, API keys, or credentials in any form.
- Do not generate placeholder application code and claim the feature is implemented.

---

## 11. Flagging Uncertainty

When you are uncertain about a requirement, design decision, or implementation approach:

1. **Say so explicitly.** Do not guess silently and implement something incorrect.
2. **Reference the relevant documentation.** Quote the relevant section and explain what is unclear.
3. **Propose options.** If appropriate, offer two or three approaches with tradeoffs.
4. **Ask for guidance.** Do not proceed on a significant uncertain decision without input.

Uncertainty is not a failure. Silently guessing wrong and creating technical debt is.

---

## 12. Technology-Specific Rules

### NestJS (Backend)

- Use NestJS modules, services, controllers, and dependency injection as intended.
- Use `ValidationPipe` globally with `whitelist: true` and `forbidNonWhitelisted: true`.
- Use DTOs with class-validator decorators for all API request bodies.
- Use exception filters for consistent error responses.
- Use guards for authentication/authorization.
- Do not put business logic in controllers — controllers delegate to services.

### Next.js (Frontend)

- Use the App Router (Next.js 13+). Do not revert to Pages Router.
- Use Server Components where appropriate; mark Client Components explicitly with `'use client'`.
- Do not fetch data directly from the database in Next.js Server Components — go through the NestJS API.
- Use environment variables via `NEXT_PUBLIC_` prefix only for values that must be client-accessible. Keep secrets server-side.

### Prisma

- Run `prisma migrate dev` for development migrations.
- Run `prisma migrate deploy` for production.
- Never modify the database schema directly — always go through migrations.
- Use `prisma generate` after any schema change to regenerate the client.
- Do not share the Prisma client instance across requests in an unsafe way — use NestJS DI.

### Python ML Scripts

- Accept database connection parameters from environment variables, not hardcoded values.
- Use connection pooling appropriately (psycopg2 or asyncpg).
- Batch embedding generation and database writes to avoid memory issues.
- Log progress for long-running operations (embedding generation, clustering).
- Accept `--dry-run` or similar flags for safe testing of scripts without writing to the database.

---

## 13. Quick Reference Checklist

Before submitting any change, confirm:

- [ ] Read relevant documentation before starting.
- [ ] Inspected all existing files that were modified.
- [ ] Implementation plan was stated before coding.
- [ ] No secrets or API keys in code.
- [ ] All external inputs are validated.
- [ ] TypeScript strict mode — no `any` escapes.
- [ ] Python type hints are present.
- [ ] Tests written for new business logic.
- [ ] All existing tests still pass.
- [ ] Linter passes.
- [ ] No dead code introduced.
- [ ] Documentation updated if behaviour changed.
- [ ] `tasks.md` updated for completed tasks (verified, not speculative).
- [ ] No overengineering — no new infrastructure without justification.
- [ ] No silent architectural changes.
