# CineSphere — Project Plan

**Status:** Planning and Documentation  
**Last Updated:** 2026-11-05  
**Version:** 1.0

---

## 1. Project Vision

CineSphere is a personal movie and television tracking, discovery, recommendation, and analytics platform built for a single user.

Its purpose is to give that user a deep, structured, and personalized understanding of their own viewing history and to surface genuinely relevant content through a recommendation engine grounded in semantic similarity and personal preference signals — not in what everyone else is watching.

CineSphere is also a portfolio engineering project. It demonstrates full-stack software engineering, applied machine learning, and thoughtful system design across a realistically complex, production-quality codebase.

---

## 2. Objectives

1. Build a unified personal library that tracks movies and TV shows with meaningful detail — statuses, ratings, episode progress, notes, and history.
2. Build a hybrid recommendation engine that uses content-based semantic embeddings and personal preference signals. It must not depend on an LLM or on collaborative filtering.
3. Generate a structured, evolving model of the user's taste that can be compared over time.
4. Render an interactive 2D semantic map of the film landscape powered by real high-dimensional embeddings and PixiJS.
5. Provide personal analytics derived entirely from tracked data — no external analytics platform.
6. Support full data import and export for portability.
7. Operate completely locally without paid AI APIs or cloud services.
8. Deploy as a hosted portfolio demonstration at near-zero cost.

---

## 3. Scope

### In Scope

- Single-user personal movie and TV tracking application.
- Content-based recommendation engine using semantic embeddings and personal preference signals.
- Hybrid scoring model: semantic similarity, preference match, mood match, quality signal, novelty.
- Taste Profile: a structured description of the user's viewing preferences.
- Taste Evolution: snapshots of how preferences change over time.
- Movie Universe: interactive 2D semantic visualization of catalogue items using PixiJS.
- Personal statistics: viewing history, genre distribution, activity charts, rating analysis.
- Data import and export (JSON and CSV).
- Optional local LLM integration via Ollama for conversational discovery.
- Local development via Docker Compose.
- Hosted portfolio deployment with anonymized data and disabled LLM features.
- TMDB API integration for catalogue metadata.

### Out of Scope

The following are explicitly outside the scope of this project and should not be built:

- Multi-user accounts, registration, or access control for multiple users.
- Subscription or billing systems.
- Commercial SaaS infrastructure.
- Collaborative filtering (requires a user population).
- Syncing with streaming service accounts or screen time tracking.
- Mobile applications (may be a future consideration).
- Real-time streaming or WebSocket infrastructure.
- Redis, Kafka, Kubernetes, Spark, or other complex infrastructure not justified by an actual requirement.
- Paid AI API dependencies (OpenAI, Anthropic, etc.).
- A permanently running ML microservice (Python ML runs as offline/on-demand scripts).
- Processing the entire TMDB catalogue upfront.
- A separate analytics platform (statistics are derived from application data only).

---

## 4. Functional Requirements

### FR-01: Dashboard
- Display a personal activity overview on application load.
- Show a "Continue Watching" section for in-progress TV shows.
- Show recently watched titles.
- Show a quick recommendation strip (top 5–10 recommendations).
- Show summary statistics (total watched, current streak, etc.).

### FR-02: My Library
- Track movies and TV shows with a status: Watching, Completed, Plan to Watch, Dropped.
- For movies: watch status, personal rating, watched date, rewatch records, optional notes.
- For TV shows: overall status, current season, current episode, per-season completion flags, optional per-season ratings, optional notes.
- Support a view of all library entries, filterable by status and media type.
- Allow inline status and rating updates.

### FR-03: Discover
- Search movies and TV shows via TMDB.
- Browse trending and popular content.
- Mood-based discovery with predefined moods and optional LLM-enhanced interpretation.
- Advanced filters: genre, year range, rating range, runtime, media type (movie/TV).
- Discovery modes: Familiar (similar to known preferences) versus Adventurous (broader exploration).
- Hidden gems: lesser-known titles with high content quality signals.

### FR-04: Recommendation System ("For You")
- Generate personalized recommendations independent of LLM availability.
- Use a hybrid scoring model: `Score = 0.35·S + 0.25·P + 0.20·M + 0.10·Q + 0.10·N`
  - S: semantic similarity to user preference profile
  - P: personal preference match (genre, theme, style signals)
  - M: mood match
  - Q: quality/popularity signal
  - N: novelty (penalizes overly similar or repeated suggestions)
- Maintain positive and negative preference signals separately.
- Collect structured user feedback on each recommendation.
- Store recommendation impressions, scores, and reasons for evaluation.
- Support diversity modes: Safe / Balanced / Experimental.
- Support recommendation categories: Similar to Favourites, Hidden Gems, Unexpected Discoveries.
- Provide explainable recommendation reasons derived from scoring signals.

### FR-05: Taste Profile
- Generate a structured profile of user preferences: genres, themes, storytelling style, tone, character types, narrative preferences, positive and negative signals, confidence levels.
- Update the profile as library data changes.
- Optionally enhance the profile narrative with Ollama when available.

### FR-06: Taste Evolution
- Take periodic snapshots of the taste profile.
- Store snapshots with timestamps.
- Display preference changes over time.
- Distinguish genuine preference changes from early-data noise.

### FR-07: Recommendation History
- Store every recommendation shown with: title, score breakdown, reason, timestamp, source.
- Track whether the recommendation was clicked, added to library, eventually watched, and rated.
- Display full recommendation history to the user.
- Never overwrite historical records when the recommendation algorithm changes.

### FR-08: Movie Universe
- Render an interactive 2D semantic map of movies and TV shows using PixiJS.
- Use genuine high-dimensional embeddings for similarity and clustering.
- Use UMAP exclusively for 2D visualization coordinates.
- Use HDBSCAN for clustering.
- Support cluster colour representation, labels, and descriptions.
- Support search, filters, hover previews, and detail panels.
- Overlay personal library status on the shared catalogue map.
- Handle at minimum 10,000 catalogue items without unacceptable frame drops.

### FR-09: Statistics
- Total movies watched, completed TV shows, seasons watched, episodes watched.
- Genre distribution by count.
- Average personal rating overall and by genre.
- Rating distribution histogram.
- Monthly and yearly viewing activity.
- Library status distribution (Watching / Completed / Planned / Dropped).
- Highest-rated genres.
- All statistics derived from library data — no external platform.

### FR-10: Data Import and Export
- JSON import/export: full nested format including TV progress, ratings, and watch history.
- CSV import/export: flat spreadsheet-friendly format.
- Import validation with detailed error reporting.
- Duplicate detection during import.
- Atomic import transactions — no partial imports that leave data corrupt.
- Never silently discard invalid import records.
- Export all personal data on demand.

### FR-11: Settings
- Personal preferences.
- Recommendation diversity mode setting.
- Data import and export controls.
- Application configuration (display preferences, etc.).
- Local AI configuration (Ollama endpoint and model) where applicable.

---

## 5. Non-Functional Requirements

### NFR-01: Correctness
- Recommendation scores must be derived from documented, verifiable calculations.
- Statistics must accurately reflect library data.
- Import transactions must be atomic — a failed import must not corrupt existing data.
- Historical recommendation records must never be overwritten by algorithm changes.

### NFR-02: Performance
- Library page with 500+ entries: load within 2 seconds.
- Recommendation generation: complete within 10 seconds for a typical library.
- Movie Universe PixiJS map: render 10,000+ items without sustained frame drops below 30 fps.
- TMDB API calls: handled with appropriate rate limiting and caching.

### NFR-03: Reliability
- Application must handle TMDB API failures gracefully (cached data, error messages).
- Ollama unavailability must not affect non-LLM features.
- Failed imports must roll back cleanly.
- Embedding generation failures must be reported without corrupting existing data.

### NFR-04: Security
- No secrets, API keys, or credentials in source code or git history.
- All external inputs validated and sanitized.
- Parameterized database queries via Prisma (no raw string interpolation in queries).
- Import file contents validated before processing.
- Sensitive data not exposed in logs.

### NFR-05: Maintainability
- TypeScript strict mode in all TypeScript code.
- Python type hints used throughout ML code.
- Clear separation of concerns between frontend, backend, and ML.
- Consistent code formatting enforced by tooling.
- Documentation updated when behaviour changes.

### NFR-06: Portability and Data Sovereignty
- All data stored locally by default.
- Full import and export of personal data.
- No dependency on cloud-only services for core functionality.

### NFR-07: Hosting Cost
- Hosted portfolio mode must operate at near-zero cost.
- No persistent paid services that charge per hour (prefer serverless or free tiers).

---

## 6. User Workflows

### Workflow 1: Adding a Title to the Library
1. User searches for a movie or TV show in Discover.
2. User views the detail page.
3. User clicks "Add to Library" and selects a status.
4. For TV shows, user optionally sets the current episode.
5. The entry appears in My Library.

### Workflow 2: Updating Progress
1. User opens My Library and finds an in-progress TV show.
2. User updates the current episode or marks a season complete.
3. The dashboard "Continue Watching" section reflects the update.

### Workflow 3: Getting Recommendations
1. User opens the For You page.
2. User optionally selects a diversity mode (Safe / Balanced / Experimental).
3. Recommendations are displayed with explanations.
4. User clicks a recommendation to view details.
5. User provides feedback (Interested / Not Interested / Already Watched / etc.).
6. Feedback is recorded and influences future recommendations.

### Workflow 4: Exploring the Movie Universe
1. User opens the Movie Universe page.
2. The PixiJS map renders catalogue items as coloured points grouped by semantic cluster.
3. User pans and zooms to explore.
4. User hovers over a point to see a preview.
5. User clicks to open a detail panel.
6. User can toggle their library overlay to see which items they have watched.

### Workflow 5: Importing Watch History
1. User prepares a JSON or CSV file of watch history.
2. User navigates to Settings → Import.
3. User uploads the file.
4. The application validates the file and reports errors (if any).
5. User confirms the import.
6. Valid records are imported atomically.

---

## 7. Implementation Phases

| Phase | Title | Key Deliverables |
|---|---|---|
| 1 | Project Foundation | Monorepo, tooling, Docker, database baseline, documentation |
| 2 | Catalogue and TMDB Integration | TMDB client, catalogue schema, search and discover API and UI |
| 3 | Personal Library and Tracking | Library schema, CRUD API, dashboard, library UI |
| 4 | Statistics and Import/Export | Statistics API and UI, JSON/CSV import/export |
| 5 | Recommendation Engine Foundation | Embeddings, similarity, preference signals, baseline scoring, recommendation storage |
| 6 | Recommendation Intelligence | Diversity modes, feedback, evaluation, Taste Profile, Taste Evolution |
| 7 | Local LLM Integration | Ollama client, conversational discovery, LLM-enhanced taste profile |
| 8 | Movie Universe | HDBSCAN clustering, UMAP coordinates, PixiJS visualization |
| 9 | Testing, Security and QA | Full test coverage, security audit, performance validation |
| 10 | Deployment and Portfolio Prep | Anonymization, hosted deployment, portfolio documentation |

> See [`tasks.md`](../tasks.md) for detailed per-phase task lists with completion status.

---

## 8. Dependencies Between Phases

```
Phase 1 (Foundation)
  └── Phase 2 (Catalogue)
        └── Phase 3 (Library)
              ├── Phase 4 (Statistics / Import)
              ├── Phase 5 (Recommendation Foundation)
              │     └── Phase 6 (Recommendation Intelligence)
              │           └── Phase 7 (LLM Integration)
              └── Phase 8 (Movie Universe) ← also depends on Phase 5
Phase 9 (QA) ← depends on Phases 1–8 being substantially complete
Phase 10 (Deployment) ← depends on Phase 9
```

---

## 9. Milestones and Deliverables

| Milestone | Description | Phase |
|---|---|---|
| M1 | Documentation initialization complete | 1 |
| M2 | Local development environment running end-to-end | 1 |
| M3 | TMDB search and catalogue browsing working | 2 |
| M4 | Library tracking working for movies and TV | 3 |
| M5 | First recommendation results generated | 5 |
| M6 | Movie Universe renders with real embedding data | 8 |
| M7 | Full test suite passing | 9 |
| M8 | Hosted portfolio deployment live | 10 |

---

## 10. Acceptance Criteria

| Feature | Criteria |
|---|---|
| Library tracking | Movie and TV entries persist correctly with all fields. TV episode progress is tracked accurately. |
| Recommendations | Recommendations differ meaningfully by diversity mode. Scores are explainable from documented components. Feedback is stored and influences future results. |
| Movie Universe | Clusters are semantically coherent. UMAP layout is visually meaningful. Library overlay is correct. Performance target met. |
| Statistics | All statistics match raw library data. No external service required. |
| Import/Export | Re-imported exports match the original data. Invalid records are reported, not silently dropped. |
| LLM degradation | All non-LLM features work correctly when Ollama is unavailable or disabled. |
| Hosted mode | No personal data exposed. LLM features disabled. Core functionality available from precomputed data. |

---

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Embedding quality insufficient for meaningful clusters | Medium | High | Evaluate on real data early. Try multiple Sentence Transformers models. See TD-08. |
| UMAP layout not visually meaningful with small dataset | Medium | Medium | Tune UMAP parameters. Minimum viable dataset of ~1,000 items before Movie Universe is useful. |
| Prisma + pgvector friction | Medium | Medium | Document and implement the raw SQL pattern early. Encapsulate in a reusable utility. See TD-04. |
| TMDB rate limiting causing poor UX | Low | Medium | Implement retry logic, cache aggressively, fetch on-demand rather than upfront. |
| Recommendation quality poor initially | High | Medium | Expected. Treat as a baseline and iterate. Document evaluation metrics. See Phase 6. |
| Hosting costs exceed near-zero target | Low | Medium | Evaluate providers before deployment. Prefer serverless PostgreSQL (Neon, Supabase free tier). |
| Monorepo tooling overhead | Low | Low | Start simple. Turborepo adds minimal overhead. See TD-02. |

---

## 12. Future Improvements (Out of Current Scope)

The following are not in scope but are worth documenting as plausible extensions:

- **Mobile application** — a companion iOS or Android app for quick library updates.
- **Multi-service integration** — Trakt, Letterboxd, or Plex import support.
- **Social features** — sharing recommendations or taste profiles (would require multi-user support).
- **Watch party planning** — finding common recommendations for a group.
- **Extended media types** — anime, documentaries, short films as distinct types.
- **Automatic episode tracking** — integration with streaming APIs where available.
- **Poster image caching** — local caching of TMDB poster images for offline use.

None of these should be built or designed around during the current implementation.
