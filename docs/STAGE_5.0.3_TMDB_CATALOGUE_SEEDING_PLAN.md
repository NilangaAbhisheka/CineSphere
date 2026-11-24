# CineSphere — Stage 5.0.3-A: TMDB Catalogue Seeding Plan & Ingestion Safety Audit

**Document Status:** Final Architecture & Safety Plan (Planning Only — No Execution)  
**Date:** 2026-11-24  
**Author:** Antigravity AI (Senior ML Engineer, Data Engineer & Technical Auditor)  
**Target Milestone:** Stage 5.0.3-A  
**Baseline Git Commit:** `5b32a011db9663d0a118814e11ee57212bf1bc1f`  
**Repository:** `NilangaAbhisheka/CineSphere` (`main` branch)

---

## 1. Executive Summary

This document specifies the technical and operational plan for Stage 5.0.3: populating the CineSphere PostgreSQL catalogue with sufficient authentic TMDB media records to satisfy the Stage 5.0 evaluation benchmark fixture prerequisites.

In Stage 5.0.2, the benchmark fixture preparation pipeline (`prepare_catalogue_fixture.py`) and its integration test suite were hardened, verified, and committed. The extraction pipeline requires a verified catalogue containing at least:
- **1,400 eligible movies** (with non-empty overviews, excluding synthetic integration fixtures).
- **600 eligible TV shows** (with non-empty overviews, excluding synthetic integration fixtures).
- **All 50 mandatory evaluation probes** (38 movies, 12 TV shows) defined in `ml/benchmark/fixtures/probes_v1.json`.

A fresh read-only audit of the local PostgreSQL database confirms that the current catalogue consists primarily of synthetic test fixtures generated during Phase 3 and Phase 4 integration tests:
- Only **138 eligible movies** exist (net deficit: **1,262 movies**).
- Only **106 eligible TV shows** exist (net deficit: **494 TV shows**).
- **0 of the 50 mandatory probes** currently exist in the database (net deficit: **50 probes**).

Per Section 7 Stop Conditions of the Phase 5 Technical Design Proposal (V0.7.8), the fixture preparation script strictly forbids synthetic record fabrication or unvetted fallback substitutions; it fails closed until authentic TMDB catalogue data is synchronized.

This plan details how to seed the necessary catalogue records via CineSphere's existing NestJS TMDB ingestion architecture, defines a robust multi-source candidate selection strategy, establishes conservative rate-limiting and error-handling protocols, enforces strict database safety invariants protecting personal user library data, and defines the phased execution protocol for the forthcoming Stage 5.0.3-B implementation.

> [!IMPORTANT]
> **Planning & Audit Scope Only:** This document provides architectural analysis, live read-only verification, and execution design. It explicitly does **not** perform database writes, trigger batch ingestion, download models, or execute benchmark scoring.

---

## 2. Baseline Commit and Repository State

- **Starting HEAD Commit:** `5b32a011db9663d0a118814e11ee57212bf1bc1f` (`fix(ml): verify production fixture extraction path`)
- **Current Branch:** `main` (synchronized with `origin/main`)
- **Repository Cleanliness:** No unstaged or uncommitted changes in tracked files.
- **Dependencies & Services:**
  - PostgreSQL 16 (`cinesphere-postgres` container) running on port `5432`.
  - Database `cinesphere` operational with committed Phase 1–4 migrations.
  - NestJS API (`apps/api`) with operational TMDB client and repository.
  - Python 3.12 ML environment with verified `psycopg2`, `pytest`, and `ruff`.
  - Valid `TMDB_READ_ACCESS_TOKEN` present in root `.env` and confirmed functional.

---

## 3. Fresh Read-Only Catalogue Audit

A fresh audit was executed against the primary database (`cinesphere`) using an explicit PostgreSQL read-only transaction (`SET TRANSACTION READ ONLY`) and production regex filters.

### 3.1 Quantitative Summary

| Metric | Raw Table Count | Non-Empty Overview | Synthetic Filter Matches | Eligible for Benchmark | Required Quota | Deficit |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Movies** | 1,249 | 307 | 949 | **138** | 1,400 | **1,262** |
| **TV Shows** | 2,174 | 302 | 1,493 | **106** | 600 | **494** |
| **Mandatory Movie Probes** | 0 | 0 | 0 | **0** | 38 | **38** |
| **Mandatory TV Probes** | 0 | 0 | 0 | **0** | 12 | **12** |
| **Total Evaluation Dataset** | 3,423 | 609 | 2,442 | **244** | 2,000 | **1,756** |

### 3.2 Catalogue Auxiliary Tables (Read-Only Counts)

| Table | Record Count | Description |
| :--- | :---: | :--- |
| `genres` | 306 | Shared genre entities (movies and TV) |
| `keywords` | 197 | Shared keyword descriptors |
| `persons` | 734 | Shared actors and cast entities |
| `person_credits` | 661 | Polymorphic cast association records |
| `seasons` | 2,080 | TV show season records |
| `episodes` | 2,321 | TV show episode records |

### 3.3 Personal Library Isolation Audit

To establish a strict baseline ensuring zero personal data pollution or modification during seeding, current personal tracking tables were verified:
- `user_library_entries`: 765 records
- `viewing_events`: 38 records
- `episode_progress`: 205 records
- `season_ratings`: 138 records

All personal tables reference catalogue items with `onDelete: Restrict` or foreign key constraints. Ingestion operations must never target, read, or alter these records.

---

## 4. Existing Ingestion Architecture Findings

An in-depth audit of `apps/api/src/tmdb/` reveals a mature, production-grade ingestion pipeline. The core components and their exact runtime behaviours are documented below.

### 4.1 Component Responsibility Matrix

| Component | File Path | Existing Implementation State | Readiness for Bulk Seeding |
| :--- | :--- | :--- | :--- |
| `TmdbController` | `apps/api/src/tmdb/tmdb.controller.ts` | Exposes REST endpoints `POST /catalogue/ingest/movie/:tmdbId` and `POST /catalogue/ingest/tv/:tmdbId`. | **Ready:** Can be called directly via HTTP or via CLI runner. |
| `TmdbService` | `apps/api/src/tmdb/tmdb.service.ts` | Implements `ingestMovie()`, `ingestTvShow()`, search, and discovery methods. | **Ready:** Encapsulates end-to-end orchestration, error trapping, and mapping. |
| `CatalogueRepository` | `apps/api/src/tmdb/catalogue.repository.ts` | Implements Prisma transactions for movies, TV headers, seasons, episodes, and credits. | **Ready:** Fully idempotent upserts on unique keys. |
| `TmdbHttpClient` | `apps/api/src/tmdb/tmdb-http.client.ts` | Handles TMDB HTTP requests, bearer authentication, exponential backoff, and 429 retries. | **Ready:** Standardized backoff and retry handling already built in. |
| `TmdbMapper` | `apps/api/src/tmdb/tmdb.mapper.ts` | Pure transformation functions mapping raw TMDB DTOs to CineSphere relational structures. | **Ready:** Deduplicates genres, keywords, cast; parses ISO dates. |
| `DiscoverController` | `apps/api/src/tmdb/discover.controller.ts` | Exposes trending, popular, and search endpoints for movies and TV shows. | **Ready:** Can supply candidate TMDB IDs for bulk seeding. |

### 4.2 Movie Ingestion Workflow
When `POST /api/catalogue/ingest/movie/:tmdbId` or `TmdbService.ingestMovie(tmdbId)` is invoked:
1. **TMDB Request:** Executes `GET /movie/{tmdbId}?append_to_response=credits,keywords`.
2. **DTO Mapping:** `TmdbMapper.mapMovie` extracts:
   - Scalar metadata: `title`, `originalTitle`, `overview`, `releaseDate`, `runtime`, `originalLanguage`, `popularity`, `voteAverage`, `voteCount`, `posterPath`, `backdropPath`, `adult`.
   - Relational entities: deduplicated `genres`, `keywords`, and `cast` (deduplicated by `tmdbId`).
3. **Database Transaction:** `CatalogueRepository.saveMovie` executes an atomic Prisma transaction (`timeout: 20000ms`, `maxWait: 10000ms`):
   - Upserts all genres into `genres` (`ON CONFLICT (tmdbId) DO UPDATE`).
   - Upserts all keywords into `keywords` (`ON CONFLICT (tmdbId) DO UPDATE`).
   - Upserts the movie into `movies` (`ON CONFLICT (tmdbId) DO UPDATE`), setting `syncedAt = now()`.
   - Links many-to-many associations in `_GenreToMovie` and `_KeywordToMovie`.
   - Upserts cast persons into `persons` (`ON CONFLICT (tmdbId) DO UPDATE`).
   - Synchronizes `person_credits` for the movie: creates new appearances, deletes orphaned appearances if cast changed.
4. **Idempotency Guarantee:** Re-ingesting an existing movie updates all fields in place, preserves the primary UUID key (`movies.id`), and leaves existing foreign key references (e.g., from `user_library_entries`) completely intact.
5. **API Cost:** Exactly **1 TMDB HTTP request per movie**.

### 4.3 TV Ingestion Workflow
When `POST /api/catalogue/ingest/tv/:tmdbId` or `TmdbService.ingestTvShow(tmdbId)` is invoked:
1. **Show Header Request:** Executes `GET /tv/{tmdbId}?append_to_response=aggregate_credits,credits,keywords`.
2. **Header Mapping:** `TmdbMapper.mapTvShow` extracts show details, cast (preferring `aggregate_credits`), genres, keywords, and the season list `[{ seasonNumber, tmdbId }]`.
3. **Header Transaction:** `CatalogueRepository.saveTvShowHeader` executes an atomic Prisma transaction:
   - Upserts genres, keywords, show record (`tv_shows`), and top-level cast `person_credits`.
4. **Iterative Season Requests:** For each season in `mappedShow.seasons`:
   - Executes `GET /tv/{tmdbId}/season/{seasonNumber}`.
   - Maps season metadata and child episodes (`TmdbMapper.mapSeason`).
   - Calls `CatalogueRepository.saveSeasonAndEpisodes(showId, mappedSeason)` in an **isolated transaction per season**:
     - Upserts season record on composite key `[tvShowId, seasonNumber]`.
     - Upserts each episode on composite key `[seasonId, episodeNumber]`.
5. **Partial Failure Handling:** If an individual season request fails (e.g., 404, network timeout), the error is caught, logged as a warning, and subsequent seasons proceed. The result object sets `isPartial: true`.
6. **API Cost:** **$1 + S$ requests per TV show**, where $S$ is the total season count (including Season 0 specials if present).
   - A single-season miniseries (e.g., *Chernobyl*) requires 2 requests.
   - An average TV show (4 seasons) requires 5 requests.
   - A long-running series (e.g., *The Simpsons*, 36 seasons) requires 37 requests.

### 4.4 Ingestion Architecture Audit Conclusions
- **Strengths:** Fully typed, idempotent, transactional, handles schema relationships correctly, and already implements exponential backoff with 429 retry handling.
- **Missing Capabilities for Bulk Seeding:**
  - The API has no built-in bulk batch runner (only single-item endpoints).
  - No disk-based checkpointing mechanism exists to track long-running multi-hour batch progress across crashes.
  - No CLI discovery orchestrator exists to query TMDB discovery pages, filter candidates, and feed them into the ingestion pipeline.

---

## 5. Mandatory Probe Inventory & Pre-Ingestion Audit

The Stage 5.0 benchmark relies on 50 predetermined probes (`ml/benchmark/fixtures/probes_v1.json`). All 50 must be present in the final catalogue fixture.

A live pre-ingestion audit was conducted by querying TMDB's official API for all 50 entries using `TMDB_READ_ACCESS_TOKEN`.

### 5.1 Probe Verification Findings

1. **HTTP Resolution:** All 50 probes resolved with **HTTP 200 OK** on TMDB.
2. **Overview Availability:** All 50 records possess rich, non-empty overview text on TMDB.
3. **Database Presence:** **0 of 50 currently exist** in the local CineSphere database.
4. **Data Inconsistencies Discovered in `probes_v1.json`:**
   During TMDB live resolution, four probes were discovered to have title-to-ID mismatches in `probes_v1.json`:
   - **`PB-27`:** Configured as `"Manchester by the Sea"` with `tmdb_id: 334543`. TMDB ID `334543` resolves to *Lion* (2016). *Manchester by the Sea* is actually TMDB ID `334541` (transposition error).
   - **`PB-40`:** Configured as `"The Wire"` with `tmdb_id: 3297`. TMDB ID `3297` resolves to *Wilfred* (US). *The Wire* is actually TMDB ID `1438`.
   - **`PB-45`:** Configured as `"Twin Peaks: The Return"` with `tmdb_id: 1920`. TMDB ID `1920` resolves to the parent series *Twin Peaks* (1990–2017), where *The Return* is indexed as Season 3.
   - **`PB-46`:** Configured as `"Samsara"` with `tmdb_id: 85350`. TMDB ID `85350` resolves to *Boyhood* (2014). *Samsara* (2011) is actually TMDB ID `89708`.

> [!WARNING]
> **Defect Reporting per Section 4 Rules:**
> Per Stage 5.0.3 instructions, the agent must **not modify `probes_v1.json` in this stage**.
> For Stage 5.0.3-B ingestion:
> - Ingestion must seed the exact `tmdb_id` integers specified in `probes_v1.json` (e.g., 334543, 3297, 1920, 85350) so that `prepare_catalogue_fixture.py` can locate all 50 required probe IDs in the database.
> - Ingestion should also seed the intended canonical IDs (334541, 1438, 89708) as part of the candidate pool so that the catalogue contains both.
> - A formal addendum to `probes_v1.json` should be proposed in Stage 5.0.4 to align titles and IDs cleanly.

### 5.2 Complete 50-Probe Master Inventory

| Probe ID | Media Type | TMDB ID | Configured Title | TMDB Live Title | Stratum | Selection Rationale | Ingestion Status |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| **PB-01** | MOVIE | 27205 | Inception | Inception | Mainstream | Complex multi-layered narrative, high-budget sci-fi heist. | Missing |
| **PB-02** | MOVIE | 155 | The Dark Knight | The Dark Knight | Mainstream | Neo-noir crime drama within a comic book franchise. | Missing |
| **PB-03** | MOVIE | 157336 | Interstellar | Interstellar | Mainstream | Hard sci-fi, space exploration, relativistic physics. | Missing |
| **PB-04** | MOVIE | 603 | The Matrix | The Matrix | Mainstream | Cyberpunk philosophical action, dystopian simulation. | Missing |
| **PB-05** | MOVIE | 329 | Jurassic Park | Jurassic Park | Mainstream | Sci-fi adventure, creature horror, cloning hubris. | Missing |
| **PB-06** | MOVIE | 98 | Gladiator | Gladiator | Mainstream | Roman antiquity epic, revenge tragedy, honor. | Missing |
| **PB-07** | MOVIE | 120 | The Lord of the Rings: Fellowship | The Lord of the Rings: Fellowship | Mainstream | High fantasy, mythic quest, Tolkien worldbuilding. | Missing |
| **PB-08** | MOVIE | 299536 | Avengers: Infinity War | Avengers: Infinity War | Mainstream | Large-scale ensemble crossover, cosmic stakes. | Missing |
| **PB-09** | MOVIE | 76341 | Mad Max: Fury Road | Mad Max: Fury Road | Mainstream | Minimalist dialogue, visual kinetic wasteland action. | Missing |
| **PB-10** | MOVIE | 361743 | Top Gun: Maverick | Top Gun: Maverick | Mainstream | Aviation procedural, legacy sequel, high-g combat. | Missing |
| **PB-11** | MOVIE | 496243 | Parasite | Parasite | International | South Korea: Social class satire, home infiltration. | Missing |
| **PB-12** | MOVIE | 129 | Spirited Away | Spirited Away | International | Japan: Studio Ghibli folkloric fantasy coming-of-age. | Missing |
| **PB-13** | MOVIE | 194 | Amélie | The Fabulous Destiny of Amélie Poulain | International | France: Whimsical romantic comedy, Paris magical realism. | Missing |
| **PB-14** | MOVIE | 598 | City of God | City of God | International | Brazil: Non-linear favela crime saga, kinetic realism. | Missing |
| **PB-15** | MOVIE | 252 | The Lives of Others | The Lives of Others | International | Germany: Stasi surveillance, moral awakening in East Berlin. | Missing |
| **PB-16** | MOVIE | 637 | Life Is Beautiful | Life Is Beautiful | International | Italy: Holocaust tragicomedy, paternal sacrifice. | Missing |
| **PB-17** | MOVIE | 670 | Oldboy | Oldboy | International | South Korea: Extreme revenge thriller, tragic melodrama. | Missing |
| **PB-18** | MOVIE | 82690 | The Hunt | The Hunt | International | Denmark: Collective hysteria, wrongful accusation drama. | Missing |
| **PB-19** | MOVIE | 24 | Whiplash | Whiplash | International | Auteur perfectionism, psychological abuse, jazz tempo. | Missing |
| **PB-20** | MOVIE | 8392 | My Neighbor Totoro | My Neighbor Totoro | International | Japan: Pastoral childhood innocence, animist folklore. | Missing |
| **PB-21** | MOVIE | 1398 | Stalker | Stalker | Indie | USSR: Meditative philosophical sci-fi, poetic pacing. | Missing |
| **PB-22** | MOVIE | 599 | Sunset Boulevard | Sunset Boulevard | Indie | Classic Hollywood noir melodrama, faded celebrity decay. | Missing |
| **PB-23** | MOVIE | 40096 | Certified Copy | Certified Copy | Indie | Philosophical romance, meta-identity dialectic in Tuscany. | Missing |
| **PB-24** | MOVIE | 1362 | The Seventh Seal | The Seventh Seal | Indie | Medieval allegory, existential dread, chess with Death. | Missing |
| **PB-25** | MOVIE | 10398 | Synecdoche, New York | Synecdoche, New York | Indie | Postmodern existentialism, mortality, recursive theater. | Missing |
| **PB-26** | MOVIE | 42684 | First Reformed | First Reformed | Indie | Climate despair, spiritual crisis, radicalization drama. | Missing |
| **PB-27** | MOVIE | 334543 | Manchester by the Sea | Lion *(Mismatch)* | Indie | Emotional trauma & grief *(TMDB 334543 resolves to Lion)*. | Missing |
| **PB-28** | MOVIE | 398818 | The Lighthouse | The Lighthouse | Indie | Psychological descent into madness, isolation folklore. | Missing |
| **PB-29** | MOVIE | 374430 | Portrait of a Lady on Fire | Portrait of a Lady on Fire | Indie | Period queer romance, artistic gaze, memory. | Missing |
| **PB-30** | MOVIE | 455656 | Columbus | Columbus | Indie | Architectural contemplation, understated human connection. | Missing |
| **PB-31** | TV | 1396 | Breaking Bad | Breaking Bad | Serialized TV | Moral degeneration, methamphetamine crime empire. | Missing |
| **PB-32** | TV | 1399 | Game of Thrones | Game of Thrones | Serialized TV | Medieval dark fantasy, dynastic warfare, political intrigue. | Missing |
| **PB-33** | TV | 63247 | Westworld | Westworld | Serialized TV | Android consciousness, simulated loops, corporate hubris. | Missing |
| **PB-34** | TV | 66732 | Stranger Things | Stranger Things | Serialized TV | 1980s nostalgia, supernatural mystery, government lab. | Missing |
| **PB-35** | TV | 70523 | Dark | Dark | Serialized TV | German time-travel paradox, generational mystery. | Missing |
| **PB-36** | TV | 87108 | Chernobyl | Chernobyl | Serialized TV | Nuclear disaster procedural, Soviet bureaucratic secrecy. | Missing |
| **PB-37** | TV | 76479 | The Boys | The Boys | Serialized TV | Corporate superhero satire, hyper-violent subversion. | Missing |
| **PB-38** | TV | 60059 | Better Call Saul | Better Call Saul | Serialized TV | Legal procedural tragedy, identity transformation. | Missing |
| **PB-39** | TV | 85271 | WandaVision | WandaVision | Serialized TV | Sitcom meta-reality, grief manifestation, comic mystery. | Missing |
| **PB-40** | TV | 3297 | The Wire | Wilfred *(Mismatch)* | Serialized TV | Institutional sociology *(TMDB 3297 resolves to Wilfred)*. | Missing |
| **PB-41** | MOVIE | 1124 | The Prestige | The Prestige | Stress Cases | Narrative misdirection, competitive obsession, duality. | Missing |
| **PB-42** | MOVIE | 77 | Memento | Memento | Stress Cases | Reverse-chronological structure, anterograde amnesia. | Missing |
| **PB-43** | MOVIE | 37165 | The Truman Show | The Truman Show | Stress Cases | Simulated existence, omnipresent reality-TV panopticon. | Missing |
| **PB-44** | MOVIE | 264660 | Ex Machina | Ex Machina | Stress Cases | Turing test psychological thriller, AI deception. | Missing |
| **PB-45** | TV | 1920 | Twin Peaks: The Return | Twin Peaks *(Parent Show)* | Stress Cases | Avant-garde surrealist television, non-sequitur logic. | Missing |
| **PB-46** | MOVIE | 85350 | Samsara | Boyhood *(Mismatch)* | Stress Cases | Visual essay, global humanity montage *(Resolves Boyhood)*. | Missing |
| **PB-47** | MOVIE | 578 | Jaws | Jaws | Stress Cases | Aquatic creature horror, municipal political negligence. | Missing |
| **PB-48** | MOVIE | 105 | Back to the Future | Back to the Future | Stress Cases | Causality loops, high-concept 1980s family adventure. | Missing |
| **PB-49** | MOVIE | 694 | The Shining | The Shining | Stress Cases | Supernatural isolation horror, familial unraveling. | Missing |
| **PB-50** | TV | 1104 | Mad Men | Mad Men | Stress Cases | 1960s advertising industry, mid-century masculine identity. | Missing |

---

## 6. Catalogue Sourcing Strategy

To construct an evaluation catalogue that accurately benchmarks embedding models across diverse cinematic genres, cultural origins, eras, and narrative styles, candidate selection must avoid naive popularity bias.

### 6.1 Multi-Tier Sourcing Design

The target catalogue comprises **1,400 movies** and **600 TV shows**.

```
Target Catalogue (2,000 Items)
│
├── Movies: 1,400 Required (Target Ingestion: 1,450)
│   ├── Probes: 38 Mandatory Movie Probes
│   ├── Tier 1: TMDB Top-Rated Prestige (Pages 1–15, ~300 items)
│   ├── Tier 2: TMDB Popular & Mainstream (Pages 1–25, ~500 items)
│   ├── Tier 3: Curated International Cinema (Discover API, ~350 items)
│   └── Tier 4: Diverse Decades & Genre Verticals (Discover API, ~262 items)
│
└── TV Shows: 600 Required (Target Ingestion: 580)
    ├── Probes: 12 Mandatory TV Probes
    ├── Tier 1: TMDB Top-Rated Television (Pages 1–10, ~200 items)
    ├── Tier 2: TMDB Popular Television (Pages 1–15, ~250 items)
    └── Tier 3: Curated International & Miniseries (Discover API, ~118 items)
```

### 6.2 Sourcing Filters & Quality Gates
Every discovered candidate must satisfy the following criteria prior to database persistence:
1. **Overview Length:** Must contain an `overview` string with length $\ge 20$ characters (not null, whitespace-only, or boilerplate).
2. **Synthetic Exclusion Check:** Must not match `SYNTHETIC_MOVIE_EXCLUSION_PATTERN` or `SYNTHETIC_TV_EXCLUSION_PATTERN`.
3. **Vote Threshold:** Must have a TMDB `vote_count >= 50` (prevents obscure home videos or unreleased stubs from entering the evaluation space).
4. **Deduplication:** TMDB ID must not already exist in the target ingestion queue or database.
5. **Language Diversity Allocation:**
   - At least 25% of movie candidates must originate from non-English language codes (`ko`, `ja`, `fr`, `es`, `de`, `it`, `hi`, `zh`, `pt`, `da`, `sv`).
   - At least 20% of TV candidates must originate from non-English productions.
6. **Temporal Spread:** Candidates must span distinct release decades (1950s through 2020s) to test historical vocabulary adaptability.

---

## 7. Quota and Buffer Calculations

### 7.1 Exact Production Quotas
- **Target Eligible Movies:** $\ge 1,400$
- **Target Eligible TV Shows:** $\ge 600$
- **Mandatory Probes Required:** Exactly 50 (38 movies, 12 TV)
- **Total Canonical Fixture Size:** Exactly 2,000 records

### 7.2 Current Baseline & Deficits

```text
Movies:
  Existing Eligible:        138
  Target Quota:           1,400
  Raw Deficit:            1,262
  Probes to Ingest:          38
  Additional Needed:      1,224

TV Shows:
  Existing Eligible:        106
  Target Quota:             600
  Raw Deficit:              494
  Probes to Ingest:          12
  Additional Needed:        482
```

### 7.3 Conservative Safety Buffers
In network-driven batch ingestion, candidates may be rejected due to empty overviews, deleted TMDB entries (HTTP 404), or rare synthetic regex matches. To guarantee that `prepare_catalogue_fixture.py` succeeds on the first attempt without falling short by a handful of records:
- **Movie Buffer:** $+15\%$ over additional need ($1,224 \times 1.15 \approx 1,408$ additional candidates).
  - Planned Movie Ingestion: **38 probes + 1,412 candidates = 1,450 new movies**.
  - Anticipated Post-Ingestion Eligible Movies: $\approx 1,550$ (comfortably exceeding the 1,400 threshold).
- **TV Buffer:** $+15\%$ over additional need ($482 \times 1.15 \approx 554$ additional candidates).
  - Planned TV Ingestion: **12 probes + 556 candidates = 568 new TV shows**.
  - Anticipated Post-Ingestion Eligible TV Shows: $\approx 660$ (comfortably exceeding the 600 threshold).

---

## 8. TMDB API Usage and Rate-Limit Plan

### 8.1 API Request Volume Estimation

| Operation / Entity | Target Ingestion Count | Requests Per Entity | Total HTTP Requests |
| :--- | :---: | :---: | :---: |
| **Movie Probes** | 38 | 1 | 38 |
| **Additional Movies** | 1,412 | 1 | 1,412 |
| **Movie Discovery Pages** | 75 pages | 1 | 75 |
| **TV Probes (Headers)** | 12 | 1 | 12 |
| **TV Probes (Seasons)** | 12 shows $\times$ 4.5 seasons avg | 1 | 54 |
| **Additional TV (Headers)** | 556 | 1 | 556 |
| **Additional TV (Seasons)** | 556 shows $\times$ 3.5 seasons avg | 1 | 1,946 |
| **TV Discovery Pages** | 35 pages | 1 | 35 |
| **Estimated Retries / Transients** | ~2% error rate | 1 | 80 |
| **Grand Total TMDB HTTP Requests** | — | — | **~4,208 requests** |

### 8.2 Rate Limiting and Concurrency Specifications
Although TMDB's API v3 no longer enforces the legacy 40 requests / 10s ceiling on Bearer auth tokens, maintaining polite, conservative traffic is mandatory to prevent IP blocks and client connection exhaustion.

- **Concurrency Ceiling:** Maximum **2 concurrent worker connections**.
- **Request Pacing Delay:** Configurable interval of **100ms** between dispatches per worker ($\approx 10\text{--}15\text{ req/s}$ aggregate).
- **Runtime Duration:** At $10\text{ req/s}$, 4,200 requests complete in $\approx 420\text{ seconds}$ ($\approx 7.0\text{ minutes}$).
- **HTTP 429 Handling:**
  - Read `Retry-After` response header. If present, sleep for the requested duration.
  - Fall back to exponential backoff: $1\text{s} \to 2\text{s} \to 4\text{s} \to 8\text{s}$.
- **HTTP 5xx Handling:**
  - Retry up to 3 times with exponential backoff ($500\text{ms} \to 1000\text{ms} \to 2000\text{ms}$).
- **HTTP 404 / 400 Handling:**
  - Log warning, record in checkpoint file as skipped, and proceed immediately to the next candidate without terminating the batch.
- **Request Timeout:** 10,000ms per request (enforced via `AbortController`).

---

## 9. Recommended Execution Architecture

We evaluated three potential execution architectures for Stage 5.0.3-B:

### 9.1 Architectural Evaluation

| Criteria | Option 1: External Script Calling HTTP API Endpoints | Option 2: Dedicated NestJS Standalone Runner Script | Option 3: Separate Python Ingestion Pipeline |
| :--- | :--- | :--- | :--- |
| **Mechanism** | Script executes `POST /api/catalogue/ingest/{movie,tv}/:id` on running NestJS server. | Node/Nest script bootstraps `INestApplicationContext` and directly calls `TmdbService`. | Python script queries TMDB and writes directly to PostgreSQL via SQL/Prisma. |
| **Pros** | • Zero new backend code required.<br>• Exercises exact production validation pipes.<br>• Resumable from external worker. | • No need to keep HTTP server process running.<br>• High throughput, zero HTTP overhead.<br>• Direct TypeScript injection. | • Easy integration with Python ML scripts. |
| **Cons** | • Requires running NestJS server in background.<br>• Minor HTTP loopback overhead. | • Requires compiling and executing via Nest CLI / `ts-node`. | • **Prohibited duplication** of `TmdbMapper`, `CatalogueRepository`, and Prisma transactions. |
| **Verdict** | **Recommended (Primary)** | **Recommended (Alternative)** | **REJECTED (Violates Monorepo Boundary)** |

### 9.2 Recommended Approach: Option 1 (API-Driven Ingestion Runner)
The recommended architecture for Stage 5.0.3-B is a controlled, resumable **Seeding Runner Script** (`apps/api/src/scripts/seed-catalogue-batch.ts` or a targeted Node/Python runner) that interacts directly with the CineSphere API.

**Key Design Elements:**
1. **Candidate Gathering Phase:** Queries `/discover/tmdb/{movies,tv}` or uses curated lists to assemble candidate IDs into `data/seeding_manifest.json`.
2. **Validation & Filtering Phase:** Pre-checks candidate overviews and deduplicates against the database.
3. **Execution Phase:** Dispatches single-item ingestion requests (`POST /catalogue/ingest/movie/:tmdbId` and `POST /catalogue/ingest/tv/:tmdbId`) with controlled concurrency ($N=2$) and rate limiting.
4. **State Persistence:** Writes progress to `data/seeding_checkpoint.json` after every record.

---

## 10. Resumability, Idempotency, and Failure Recovery

Bulk network synchronization over several thousand records must survive interruptions (network drops, manual cancellations, rate limits).

### 10.1 Checkpoint Architecture
The runner will maintain an atomic checkpoint file:

```json
{
  "session_id": "seed-20261124-v1",
  "started_at": "2026-11-24T12:00:00Z",
  "last_updated": "2026-11-24T12:05:30Z",
  "movies": {
    "target": 1450,
    "completed": 850,
    "failed": 2,
    "skipped": 5,
    "processed_ids": [27205, 155, 157336, "..."]
  },
  "tv": {
    "target": 568,
    "completed": 210,
    "failed": 1,
    "skipped": 2,
    "processed_ids": [1396, 1399, "..."]
  }
}
```

- When restarted, the runner loads `seeding_checkpoint.json` and skips any TMDB ID listed in `processed_ids`.
- The checkpoint file is written atomically (`write to temp -> rename`) to prevent partial write corruption.

### 10.2 Partial TV Ingestion Recovery
If a TV show ingestion fails halfway through season retrieval (e.g., seasons 1–3 saved, season 4 timed out):
1. The show header and seasons 1–3 remain committed in PostgreSQL.
2. In the return DTO, `isPartial` is `true`.
3. The runner records the ID in a `retry_queue`.
4. When re-ingesting a partial TV show, `CatalogueRepository.saveSeasonAndEpisodes` uses `ON CONFLICT (tvShowId, seasonNumber) DO UPDATE`, safely skipping or updating already-saved seasons and inserting the missing ones without creating duplicates.

---

## 11. Database Safety and Isolation Boundaries

To ensure that personal library data and database integrity are protected during bulk catalogue seeding, the following strict boundaries are established:

### 11.1 Table Access Rules

| Database Table | Allowed Operation | Strict Invariants |
| :--- | :---: | :--- |
| `movies` | `INSERT`, `UPDATE` (`upsert`) | Only public metadata; never deleted. |
| `tv_shows` | `INSERT`, `UPDATE` (`upsert`) | Only public metadata; never deleted. |
| `seasons` | `INSERT`, `UPDATE` (`upsert`) | Cascade-linked to parent `tv_shows`. |
| `episodes` | `INSERT`, `UPDATE` (`upsert`) | Cascade-linked to parent `seasons`. |
| `genres` | `INSERT`, `UPDATE` (`upsert`) | Shared across movies and TV. |
| `keywords` | `INSERT`, `UPDATE` (`upsert`) | Shared across movies and TV. |
| `persons` | `INSERT`, `UPDATE` (`upsert`) | Shared cast entities. |
| `person_credits` | `INSERT`, `DELETE` (sync only) | Credit synchronization strictly isolated to the target movie/show. |
| `_GenreToMovie` / `_GenreToTvShow` | `INSERT`, `DELETE` | Managed automatically by Prisma relation sync. |
| `_KeywordToMovie` / `_KeywordToTvShow` | `INSERT`, `DELETE` | Managed automatically by Prisma relation sync. |
| **`users`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |
| **`user_library_entries`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |
| **`viewing_events`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |
| **`episode_progress`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |
| **`season_ratings`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |
| **`system_configs`** | **FORBIDDEN (NO ACCESS)** | **Must NEVER be read, inserted, updated, or deleted.** |

### 11.2 Safety Rules
- **No Truncation or Deletion:** Under no circumstances will `TRUNCATE` or broad `DELETE` statements be issued against `movies` or `tv_shows`.
- **Existing Library Protection:** All foreign key constraints referencing movies/shows (`onDelete: Restrict` on `user_library_entries`) remain fully active.
- **Trigger Integrity:** All Phase 3 PostgreSQL integrity triggers remain active. Ingestion operations adhere strictly to the established relational invariants.

---

## 12. Verification and Acceptance Criteria

Before Stage 5.0.3 can be declared complete, the following criteria must be satisfied:

1. **Probe Verification:**
   - All 50 mandatory probe TMDB IDs must be queried and confirmed present in PostgreSQL.
   - All 50 probes must have valid non-empty overviews.
   - All 50 probes must pass the synthetic-title filter (`title !~* ...`).
2. **Quota Verification:**
   - Eligible movies count $\ge 1,400$.
   - Eligible TV shows count $\ge 600$.
   - Total eligible catalogue $\ge 2,000$.
3. **Execution of `prepare_catalogue_fixture.py`:**
   - Running `python ml/benchmark/scripts/prepare_catalogue_fixture.py --verify-only` must exit with **code 0 (PASS)**, reporting zero stop conditions.
4. **Zero Personal Library Mutation:**
   - Audit queries must confirm that record counts for `users`, `user_library_entries`, `viewing_events`, `episode_progress`, and `season_ratings` remain identical before and after seeding.

---

## 13. Risk Management & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
| :--- | :---: | :---: | :--- |
| **TMDB Rate Limit (HTTP 429)** | Ingestion halts | Medium | Client throttled to 10 req/s with 2 concurrent workers; automatic `Retry-After` sleep and exponential backoff. |
| **Network Interruptions** | Partial batch | Medium | Resumable checkpointing tracks completed IDs on disk; batch can resume without duplicate work. |
| **Empty Overview Candidates** | Ineligible records | Low | Client-side validation filters out candidates with overview $< 20$ chars before attempting ingestion; $+15\%$ safety buffer absorbs fallout. |
| **Database Lock Contention** | Transaction timeouts | Low | Ingestion transactions are isolated per movie and per season; single-show concurrency is avoided. |
| **Probe ID Mismatches** | Ingestion of wrong titles | Low | Seed exact IDs from `probes_v1.json` plus canonical IDs; document all 4 mismatches explicitly for Phase 5 tracking. |

---

## 14. Proposed Stage 5.0.3-B Execution Sequence

Upon receiving explicit user authorization for Stage 5.0.3-B:

1. **Step 1: Ingest 50 Mandatory Probes**
   - Execute targeted ingestion for the 50 probe IDs via `TmdbService.ingestMovie` and `TmdbService.ingestTvShow`.
   - Verify all 50 are persisted and eligible.
2. **Step 2: Assemble Candidate Pool**
   - Query TMDB Discover and Top-Rated endpoints to assemble 1,412 movie candidates and 556 TV show candidates across specified strata.
   - Save candidate manifest to disk.
3. **Step 3: Execute Batch Seeding**
   - Run the throttled, checkpointed ingestion runner.
   - Monitor progress, handle retries, and log any skipped items.
4. **Step 4: Execute Post-Seeding Verification Audit**
   - Run `prepare_catalogue_fixture.py --verify-only`.
   - Confirm quotas: $\ge 1,400$ movies, $\ge 600$ TV shows, 50/50 probes.
5. **Step 5: Execute Fixture Generation**
   - Run `python ml/benchmark/scripts/prepare_catalogue_fixture.py` to generate and publish the canonical `catalogue_snapshot_v1.jsonl` (2,000 items) and `catalogue_snapshot_v1.manifest.json`.
6. **Step 6: Final Verification & Commit**
   - Verify SHA-256 digest, run test suites, update `tasks.md`, and report completion.
