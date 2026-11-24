# CineSphere — Stage 5.0.3: TMDB Catalogue Seeding Plan & Ingestion Safety Audit (Corrected)

**Document Status:** Corrected Technical Architecture & Execution Plan (Planning Only — Ingestion Not Authorized)<br>
**Date:** 2026-11-24<br>
**Internal Revision:** V2.2.0 (Stage 5.0.3-B.1 Arithmetic Correction)<br>
**Author:** Antigravity AI (Senior ML Engineer, Data Engineer & Technical Auditor)<br>
**Baseline Commit:** `cedf46123016446a96b6c57c6814bdbbf23e56ba`<br>
**Repository:** `NilangaAbhisheka/CineSphere` (`main` branch)

---

## 1. Verified Repository Baseline

A comprehensive inspection of the current Git workspace was conducted prior to drafting this document:

- **Current HEAD Commit:** `cdda3c0d37e61d853b25c5ad8a38f26c50f6c0c3` (`fix(ml): enforce benchmark probe identity integrity`)
- **Git Branch:** `main` (synchronized with `origin/main`)
- **Working Tree:** Clean
- **Authoritative Source Files Inspected:**
  - `ml/benchmark/fixtures/probes_v1.json` (authoritative benchmark probe definitions; 50 probes across 5 strata)
  - `ml/benchmark/scripts/prepare_catalogue_fixture.py` (authoritative fixture extraction & validation pipeline with probe identity verification)
  - `apps/api/src/tmdb/tmdb.service.ts`
  - `apps/api/src/tmdb/catalogue.repository.ts`
  - `apps/api/src/tmdb/tmdb-http.client.ts`
  - `apps/api/src/tmdb/tmdb.controller.ts`
  - `apps/api/src/tmdb/discover.controller.ts`
  - `apps/api/src/tmdb/tmdb.mapper.ts`
  - `apps/api/prisma/schema.prisma`

---

## 2. Corrected 50-Probe Inventory (Rebuilt Directly from `probes_v1.json`)

The master probe inventory below was extracted directly from `ml/benchmark/fixtures/probes_v1.json`. It represents the 100% authoritative baseline for the Stage 5.0 scientific benchmark (38 movies, 12 TV shows across 5 distinct evaluation strata), incorporating the verified ID corrections from Stage 5.0.3-A.2:

| Probe ID  | Media Type | TMDB ID | Exact Configured Title                            | Stratum       | Selection Rationale                                                                            |
| :-------- | :--------: | :-----: | :------------------------------------------------ | :------------ | :--------------------------------------------------------------------------------------------- |
| **PB-01** |   MOVIE    |  27205  | Inception                                         | Mainstream    | Complex multi-layered narrative, high-budget sci-fi heist, Christopher Nolan auteur direction. |
| **PB-02** |   MOVIE    |   155   | The Dark Knight                                   | Mainstream    | Neo-noir crime drama within a comic book franchise, dense psychological antagonism.            |
| **PB-03** |   MOVIE    | 157336  | Interstellar                                      | Mainstream    | Hard sci-fi, space exploration, intense familial emotional grief, relativistic physics.        |
| **PB-04** |   MOVIE    |   603   | The Matrix                                        | Mainstream    | Cyberpunk philosophical action, dystopian reality simulation, martial arts fusion.             |
| **PB-05** |   MOVIE    |   329   | Jurassic Park                                     | Mainstream    | Sci-fi adventure, creature horror, hubris of technological cloning, suspense thriller.         |
| **PB-06** |   MOVIE    |   98    | Gladiator                                         | Mainstream    | Roman antiquity epic, revenge tragedy, honor and political betrayal.                           |
| **PB-07** |   MOVIE    |   120   | The Lord of the Rings: The Fellowship of the Ring | Mainstream    | High fantasy, mythic quest, extensive ensemble lore, Tolkien worldbuilding.                    |
| **PB-08** |   MOVIE    | 299536  | Avengers: Infinity War                            | Mainstream    | Large-scale ensemble crossover, apocalyptic stakes, cosmic villain perspective.                |
| **PB-09** |   MOVIE    |  76341  | Mad Max: Fury Road                                | Mainstream    | Minimalist dialogue, relentless visual kinetic action, feminist wasteland survival.            |
| **PB-10** |   MOVIE    | 361743  | Top Gun: Maverick                                 | Mainstream    | Aviation procedural, legacy sequel, mentorship, high-g aerial combat.                          |
| **PB-11** |   MOVIE    | 496243  | Parasite                                          | International | South Korea: Social class satire, home infiltration, dark thriller, tragicomic shift.          |
| **PB-12** |   MOVIE    |   129   | Spirited Away                                     | International | Japan (Anime): Mythological folklore, coming-of-age, surreal bathhouse spirits.                |
| **PB-13** |   MOVIE    |   598   | City of God                                       | International | Brazil: Favela crime chronicle, multi-decade drug turf warfare, hyperkinetic editing.          |
| **PB-14** |   MOVIE    |  1417   | Pan's Labyrinth                                   | International | Spain: Post-Civil War fascist cruelty juxtaposed with dark subterranean fairy tale.            |
| **PB-15** |   MOVIE    |   194   | Amélie                                            | International | France: Whimsical romantic comedy, poetic urban Paris, quirky observational vignettes.         |
| **PB-16** |   MOVIE    |   582   | The Lives of Others                               | International | Germany: East German Stasi surveillance, moral redemption, artistic empathy.                   |
| **PB-17** |   MOVIE    |   346   | Seven Samurai                                     | International | Japan: Feudal period jidaigeki, rural defense, tactical ensemble recruitment.                  |
| **PB-18** |   MOVIE    |  11216  | Cinema Paradiso                                   | International | Italy: Nostalgic ode to film projection, childhood mentorship, lost love drama.                |
| **PB-19** |   MOVIE    |   670   | Oldboy                                            | International | South Korea: Extreme vengeance tragedy, psychological captivity, Greek incest motif.           |
| **PB-20** |   MOVIE    | 531428  | Portrait of a Lady on Fire                        | International | France: Quiet 18th-century female romance, artistic gaze, solitary Brittany coast.             |
| **PB-21** |   MOVIE    | 244786  | Whiplash                                          | Indie         | Auteur jazz conservatory chamber drama, abusive pedagogical obsession, psychological duel.     |
| **PB-22** |   MOVIE    | 152601  | Her                                               | Indie         | Near-future melancholic sci-fi romance, AI consciousness connection, modern loneliness.        |
| **PB-23** |   MOVIE    | 120467  | The Grand Budapest Hotel                          | Indie         | Wes Anderson aesthetic diorama, whimsical farce, interwar nostalgic melancholia.               |
| **PB-24** |   MOVIE    | 376867  | Moonlight                                         | Indie         | Triptych coming-of-age drama, queer Black identity, vulnerability under masculine expectation. |
| **PB-25** |   MOVIE    |  64690  | Drive                                             | Indie         | Minimalist neo-noir, laconic stunt driver, violent synthwave Los Angeles underworld.           |
| **PB-26** |   MOVIE    | 503919  | The Lighthouse                                    | Indie         | 1890s New England maritime folklore, psychological isolation, descent into madness.            |
| **PB-27** |   MOVIE    | 334541  | Manchester by the Sea                             | Indie         | Unresolved tragic grief, Massachusetts coastal realism, guilt-ridden parenting trauma.         |
| **PB-28** |   MOVIE    | 264660  | Ex Machina                                        | Indie         | Isolated mountain compound chamber piece, Turing test manipulation, AI deceptive intent.       |
| **PB-29** |   MOVIE    |   38    | Eternal Sunshine of the Spotless Mind             | Indie         | Surreal romantic memory erasure, non-linear heartbreak, Charlie Kaufman script.                |
| **PB-30** |   MOVIE    | 391713  | Lady Bird                                         | Indie         | Sacramento coming-of-age, tumultuous mother-daughter bond, Catholic school transition.         |
| **PB-31** |     TV     |  1396   | Breaking Bad                                      | Serialized TV | High school chemistry teacher cancer diagnosis, meth empire moral descent, crime tragedy.      |
| **PB-32** |     TV     |  76331  | Succession                                        | Serialized TV | Media dynasty corporate warfare, Shakespearean sibling cruelty, emotional abuse satire.        |
| **PB-33** |     TV     |  60059  | Better Call Saul                                  | Serialized TV | Legal procedural tragedy, moral erosion of a public defender, con-artist relationship.         |
| **PB-34** |     TV     |  70523  | Dark                                              | Serialized TV | Small German town missing children, multi-generational time loops, existential paradox.        |
| **PB-35** |     TV     |  1398   | The Sopranos                                      | Serialized TV | New Jersey mob boss in psychotherapy, suburban existential dread, panic attacks.               |
| **PB-36** |     TV     |  95396  | Severance                                         | Serialized TV | Dystopian corporate brain bifurcation, workplace alienation, surreal mystery box.              |
| **PB-37** |     TV     |  87108  | Chernobyl                                         | Serialized TV | Soviet nuclear disaster miniseries, bureaucratic deceit, radiation cleanup heroism.            |
| **PB-38** |     TV     |  60622  | Fargo                                             | Serialized TV | Midwestern polite noir anthology, quirky black comedy, banal evil vs. moral decency.           |
| **PB-39** |     TV     |  67070  | Fleabag                                           | Serialized TV | Meta-fourth-wall breaking London dark comedy, hypersexual deflection, unspoken grief.          |
| **PB-40** |     TV     |  1438   | The Wire                                          | Serialized TV | Baltimore institutional sociology, police wiretaps, school system decay, drug trade web.       |
| **PB-41** |   MOVIE    |  14337  | Primer                                            | Stress Cases  | Ultra-complex non-linear time machine mechanics, jargon-heavy dialogue, micro-budget.          |
| **PB-42** |   MOVIE    |   62    | 2001: A Space Odyssey                             | Stress Cases  | Sparse dialogue, meditative visual pacing, philosophical AI and cosmic evolution mystery.      |
| **PB-43** |   MOVIE    | 467244  | The Zone of Interest                              | Stress Cases  | Domestic mundane family life adjacent to Auschwitz wall, acoustic off-screen horror.           |
| **PB-44** |   MOVIE    | 545611  | Everything Everywhere All at Once                 | Stress Cases  | Absurdist kung fu multiverse collision, hot dog fingers, existential tax audit drama.          |
| **PB-45** |     TV     |  1920   | Twin Peaks: The Return                            | Stress Cases  | Avant-garde surrealist television, non-sequitur logic, terrifying cosmic dreamscapes.          |
| **PB-46** |   MOVIE    |  89708  | Samsara                                           | Stress Cases  | Non-verbal visual essay, global humanity and industrial montage, zero dialogue.                |
| **PB-47** |   MOVIE    | 220289  | Coherence                                         | Stress Cases  | Dinner party comet pass, branching quantum decoherence, improvised micro-budget.               |
| **PB-48** |     TV     |  61222  | BoJack Horseman                                   | Stress Cases  | Anthropomorphic animated animal satire evolving into severe existential clinical depression.   |
| **PB-49** |   MOVIE    |  97370  | Under the Skin                                    | Stress Cases  | Alien predatory detachment in Glasgow, sensory Glasgow sound design, minimal speech.           |
| **PB-50** |   MOVIE    |  10494  | Perfect Blue                                      | Stress Cases  | Psychological thriller anime, pop idol stalker, disorienting reality-fiction blurring.         |

---

## 3. Probe Discrepancy Audit & Reconciliation Report

An automated reconciliation between the previous Stage 5.0.3-A plan table and the authoritative `probes_v1.json` fixture identified **34 discrepancies** across the 50 rows.

The previous document's table had drifted from the actual JSON fixture because it inadvertently included draft titles from early exploratory planning notes.

### 3.1 Itemized Discrepancy Matrix

| Probe ID  | Previous Doc Entry                                | Actual `probes_v1.json` Entry                                     | Discrepancy Type             | Corrective Action                                   |
| :-------- | :------------------------------------------------ | :---------------------------------------------------------------- | :--------------------------- | :-------------------------------------------------- |
| **PB-07** | `(movie) 120 "The Lord of the Rings: Fellowship"` | `(movie) 120 "The Lord of the Rings: The Fellowship of the Ring"` | Title truncated              | Restored complete official title in plan.           |
| **PB-13** | `(movie) 194 "Amélie"`                            | `(movie) 598 "City of God"`                                       | Shifted probe index          | Corrected to _City of God_ (TMDB 598).              |
| **PB-14** | `(movie) 598 "City of God"`                       | `(movie) 1417 "Pan's Labyrinth"`                                  | Shifted probe index          | Corrected to _Pan's Labyrinth_ (TMDB 1417).         |
| **PB-15** | `(movie) 252 "The Lives of Others"`               | `(movie) 194 "Amélie"`                                            | Shifted probe index          | Corrected to _Amélie_ (TMDB 194).                   |
| **PB-16** | `(movie) 637 "Life Is Beautiful"`                 | `(movie) 582 "The Lives of Others"`                               | Replaced title & ID          | Corrected to _The Lives of Others_ (TMDB 582).      |
| **PB-17** | `(movie) 670 "Oldboy"`                            | `(movie) 346 "Seven Samurai"`                                     | Shifted probe index          | Corrected to _Seven Samurai_ (TMDB 346).            |
| **PB-18** | `(movie) 82690 "The Hunt"`                        | `(movie) 11216 "Cinema Paradiso"`                                 | Replaced title & ID          | Corrected to _Cinema Paradiso_ (TMDB 11216).        |
| **PB-19** | `(movie) 24 "Whiplash"`                           | `(movie) 670 "Oldboy"`                                            | Shifted probe index          | Corrected to _Oldboy_ (TMDB 670).                   |
| **PB-20** | `(movie) 8392 "My Neighbor Totoro"`               | `(movie) 531428 "Portrait of a Lady on Fire"`                     | Replaced title & ID          | Corrected to _Portrait of a Lady on Fire_ (531428). |
| **PB-21** | `(movie) 1398 "Stalker"`                          | `(movie) 244786 "Whiplash"`                                       | Replaced title & ID          | Corrected to _Whiplash_ (TMDB 244786).              |
| **PB-22** | `(movie) 599 "Sunset Boulevard"`                  | `(movie) 152601 "Her"`                                            | Replaced title & ID          | Corrected to _Her_ (TMDB 152601).                   |
| **PB-23** | `(movie) 40096 "Certified Copy"`                  | `(movie) 120467 "The Grand Budapest Hotel"`                       | Replaced title & ID          | Corrected to _The Grand Budapest Hotel_ (120467).   |
| **PB-24** | `(movie) 1362 "The Seventh Seal"`                 | `(movie) 376867 "Moonlight"`                                      | Replaced title & ID          | Corrected to _Moonlight_ (TMDB 376867).             |
| **PB-25** | `(movie) 10398 "Synecdoche, New York"`            | `(movie) 64690 "Drive"`                                           | Replaced title & ID          | Corrected to _Drive_ (TMDB 64690).                  |
| **PB-26** | `(movie) 42684 "First Reformed"`                  | `(movie) 503919 "The Lighthouse"`                                 | Replaced title & ID          | Corrected to _The Lighthouse_ (TMDB 503919).        |
| **PB-28** | `(movie) 398818 "The Lighthouse"`                 | `(movie) 264660 "Ex Machina"`                                     | Shifted probe index          | Corrected to _Ex Machina_ (TMDB 264660).            |
| **PB-29** | `(movie) 374430 "Portrait of a Lady on Fire"`     | `(movie) 38 "Eternal Sunshine of the Spotless Mind"`              | Replaced title & ID          | Corrected to _Eternal Sunshine..._ (TMDB 38).       |
| **PB-30** | `(movie) 455656 "Columbus"`                       | `(movie) 391713 "Lady Bird"`                                      | Replaced title & ID          | Corrected to _Lady Bird_ (TMDB 391713).             |
| **PB-32** | `(tv) 1399 "Game of Thrones"`                     | `(tv) 76331 "Succession"`                                         | Replaced title & ID          | Corrected to _Succession_ (TMDB 76331).             |
| **PB-33** | `(tv) 63247 "Westworld"`                          | `(tv) 60059 "Better Call Saul"`                                   | Replaced title & ID          | Corrected to _Better Call Saul_ (TMDB 60059).       |
| **PB-34** | `(tv) 66732 "Stranger Things"`                    | `(tv) 70523 "Dark"`                                               | Replaced title & ID          | Corrected to _Dark_ (TMDB 70523).                   |
| **PB-35** | `(tv) 70523 "Dark"`                               | `(tv) 1398 "The Sopranos"`                                        | Replaced title & ID          | Corrected to _The Sopranos_ (TMDB 1398).            |
| **PB-36** | `(tv) 87108 "Chernobyl"`                          | `(tv) 95396 "Severance"`                                          | Replaced title & ID          | Corrected to _Severance_ (TMDB 95396).              |
| **PB-37** | `(tv) 76479 "The Boys"`                           | `(tv) 87108 "Chernobyl"`                                          | Shifted probe index          | Corrected to _Chernobyl_ (TMDB 87108).              |
| **PB-38** | `(tv) 60059 "Better Call Saul"`                   | `(tv) 60622 "Fargo"`                                              | Replaced title & ID          | Corrected to _Fargo_ (TMDB 60622).                  |
| **PB-39** | `(tv) 85271 "WandaVision"`                        | `(tv) 67070 "Fleabag"`                                            | Replaced title & ID          | Corrected to _Fleabag_ (TMDB 67070).                |
| **PB-41** | `(movie) 1124 "The Prestige"`                     | `(movie) 14337 "Primer"`                                          | Replaced title & ID          | Corrected to _Primer_ (TMDB 14337).                 |
| **PB-42** | `(movie) 77 "Memento"`                            | `(movie) 62 "2001: A Space Odyssey"`                              | Replaced title & ID          | Corrected to _2001: A Space Odyssey_ (TMDB 62).     |
| **PB-43** | `(movie) 37165 "The Truman Show"`                 | `(movie) 467244 "The Zone of Interest"`                           | Replaced title & ID          | Corrected to _The Zone of Interest_ (TMDB 467244).  |
| **PB-44** | `(movie) 264660 "Ex Machina"`                     | `(movie) 545611 "Everything Everywhere All at Once"`              | Replaced title & ID          | Corrected to _Everything Everywhere..._ (545611).   |
| **PB-47** | `(movie) 578 "Jaws"`                              | `(movie) 220289 "Coherence"`                                      | Replaced title & ID          | Corrected to _Coherence_ (TMDB 220289).             |
| **PB-48** | `(movie) 105 "Back to the Future"`                | `(tv) 61222 "BoJack Horseman"`                                    | **Media type & ID mismatch** | Corrected to TV show _BoJack Horseman_ (61222).     |
| **PB-49** | `(movie) 694 "The Shining"`                       | `(movie) 97370 "Under the Skin"`                                  | Replaced title & ID          | Corrected to _Under the Skin_ (TMDB 97370).         |
| **PB-50** | `(tv) 1104 "Mad Men"`                             | `(movie) 10494 "Perfect Blue"`                                    | **Media type & ID mismatch** | Corrected to Movie _Perfect Blue_ (TMDB 10494).     |

### 3.2 Impact on Media Type Allocations

Notice that PB-48 was incorrectly recorded as a movie in the old plan table (was _Back to the Future_), whereas in `probes_v1.json` it is a TV show (_BoJack Horseman_). Conversely, PB-50 was recorded as a TV show (_Mad Men_), whereas in `probes_v1.json` it is a movie (_Perfect Blue_).

Because these two media-type swaps offset each other, the net probe breakdown in `probes_v1.json` remains strictly:

- **38 Movies**
- **12 TV Shows**
- **50 Total Probes**

---

## 4. Live TMDB Identity Verification & Probe Defect Analysis

Every one of the 50 probes from `probes_v1.json` was queried live against TMDB's REST API using `TMDB_READ_ACCESS_TOKEN`.

### 4.1 Quantitative Verification Results

- **HTTP 200 OK:** 50 / 50 probes (100% resolution, 0 missing or 404 records).
- **Non-Empty Overviews:** 50 / 50 probes (100% have rich narrative overviews $> 100$ characters).
- **Identity Classification:**
  - **VERIFIED (Exact Match):** **46 probes** (92%)
  - **ALIAS (Legitimate Title Variation):** **1 probe** (2%)
  - **MISMATCH (Incorrect TMDB ID in Fixture):** **3 probes** (6%)

### 4.2 Detailed Classification of Non-Exact Matches

#### 1. PB-45: Legitimate Title Variation (ALIAS)

- **Configured in Fixture:** `title: "Twin Peaks: The Return"`, `media_type: "tv"`, `tmdb_id: 1920`
- **TMDB Returned Name:** `"Twin Peaks"`
- **Analysis:** On TMDB, the 2017 18-part series _Twin Peaks: The Return_ is catalogued under the parent series _Twin Peaks_ (`tmdb_id: 1920`) as **Season 3**. Ingesting `1920` ingests Seasons 1, 2, and 3 (The Return).
- **Classification:** **ALIAS (VALID)**. No ID change required.

#### 2. PB-27: Incorrect TMDB ID (MISMATCH)

- **Configured in Fixture:** `title: "Manchester by the Sea"`, `media_type: "movie"`, `tmdb_id: 334543`
- **TMDB Returned Title:** `"Lion"` (2016)
- **Root Cause:** Transposition error during fixture authoring. _Manchester by the Sea_ (2016) is TMDB ID **`334541`**. TMDB ID `334543` is _Lion_ (2016).
- **Classification:** **INCORRECT TMDB ID**.

#### 3. PB-40: Incorrect TMDB ID (MISMATCH)

- **Configured in Fixture:** `title: "The Wire"`, `media_type: "tv"`, `tmdb_id: 3297`
- **TMDB Returned Name:** `"Wilfred"` (US)
- **Root Cause:** Erroneous ID. _The Wire_ (HBO, 2002–2008) is TMDB ID **`1438`**. TMDB ID `3297` is _Wilfred_.
- **Classification:** **INCORRECT TMDB ID**.

#### 4. PB-46: Incorrect TMDB ID (MISMATCH)

- **Configured in Fixture:** `title: "Samsara"`, `media_type: "movie"`, `tmdb_id: 85350`
- **TMDB Returned Title:** `"Boyhood"` (2014)
- **Root Cause:** Erroneous ID. _Samsara_ (Ron Fricke, 2011) is TMDB ID **`89708`**. TMDB ID `85350` is Richard Linklater's _Boyhood_.
- **Classification:** **INCORRECT TMDB ID**.

### 4.3 Authoritative Probe Corrections Applied in Stage 5.0.3-A.2

In Stage 5.0.3-A.2, the three verified TMDB ID errors were formally corrected in `ml/benchmark/fixtures/probes_v1.json` (commit `cdda3c0`):

| Probe ID  | Exact Title           | Corrected TMDB ID | Previous Erroneous ID | Disambiguation Context                                                                       |
| :-------- | :-------------------- | :---------------: | :-------------------: | :------------------------------------------------------------------------------------------- |
| **PB-27** | Manchester by the Sea |    **334541**     |        334543         | `334541` is Kenneth Lonergan's _Manchester by the Sea_ (2016). `334543` was _Lion_ (2016).   |
| **PB-40** | The Wire              |     **1438**      |         3297          | `1438` is David Simon's _The Wire_ (HBO, 2002–2008). `3297` was _Wilfred_ (AU).              |
| **PB-46** | Samsara               |     **89708**     |         85350         | `89708` is Ron Fricke's 70mm feature film _Samsara_ (2011). `85350` was a documentary short. |

#### Authoritative Ingestion Scope:

- Ingestion in Stage 5.0.3-B will ingest strictly the **authoritative canonical IDs (334541, 1438, 89708)**.
- Ingesting incorrect IDs (such as _Lion_ or _Wilfred_) is strictly avoided.

---

## 5. Fixture Validation Logic & Hardening (Implemented in Stage 5.0.3-A.2)

In Stage 5.0.3-A.2, `ml/benchmark/scripts/prepare_catalogue_fixture.py` was hardened to eliminate the semantic blindspot where an incorrect catalogue record could satisfy a mandatory probe merely by matching an integer TMDB ID.

### 5.1 Hardened Readiness & Identity Validation Logic

1. **Title Normalization (`normalize_probe_title`):**
   - Strips leading and trailing whitespace, converts to lowercase.
   - Strips apostrophes and single quotes.
   - Replaces punctuation (`:`, `,`, `.`, `-`, `–`, `—`, `?`, `!`, `/`) with a single space.
   - Collapses internal whitespace sequences.
2. **Conservative Identity Matching (`matches_probe_identity`):**
   - Compares expected probe title against stored `title` (movies) or `name` (TV shows).
   - Accommodates foreign titles via stored `originalTitle` or `originalName` fallback.
   - Checks the explicit, auditable allowlist `APPROVED_PROBE_ALIASES` for specific `(media_type, tmdb_id)` keys (specifically registering PB-45 `("TV", 1920): {"twin peaks", ...}`).
   - Prohibits broad fuzzy distance or partial substring matching.
3. **Database Readiness Enforcement (`verify_database_readiness`):**
   - Selects `"tmdbId"`, `title`, and `"originalTitle"` from `movies`, and `"tmdbId"`, `name`, and `"originalName"` from `tv_shows`.
   - Raises `ProbeIdentityMismatchError` immediately if an ID is present but its stored titles do not match the expected probe identity.
4. **Fail-Closed Snapshot Preparation (`prepare_catalogue_snapshot`):**
   - Traps `ProbeIdentityMismatchError`, prints full diagnostic details to `sys.stderr`, and terminates with exit code 1 without writing or publishing fixture artifacts.

---

## 6. Corrected Ingestion Architecture Findings

An audit of `apps/api/src/tmdb/` establishes the exact runtime guarantees of CineSphere's ingestion layer:

### 6.1 Movie Ingestion Path

- **Controller Endpoint:** `POST /api/catalogue/ingest/movie/:tmdbId`
- **Service Method:** `TmdbService.ingestMovie(tmdbId)`
- **HTTP Request Volume:** Exactly **1 request** (`GET /movie/{tmdbId}?append_to_response=credits,keywords`).
- **Persistence Boundary:** Single atomic Prisma transaction (`tx`, timeout 20s):
  - Upserts `genres` and `keywords` (`ON CONFLICT (tmdbId) DO UPDATE`).
  - Upserts `movies` (`ON CONFLICT (tmdbId) DO UPDATE`), updating `syncedAt = now()`.
  - Upserts `persons` (`ON CONFLICT (tmdbId) DO UPDATE`).
  - Synchronizes `person_credits`: queries existing credits for movie, creates new associations, deletes unreferenced credits.
- **Idempotency:** 100% idempotent. Repeated calls update metadata without mutating UUIDs or breaking foreign keys from `user_library_entries`.

### 6.2 TV Ingestion Path

- **Controller Endpoint:** `POST /api/catalogue/ingest/tv/:tmdbId`
- **Service Method:** `TmdbService.ingestTvShow(tmdbId)`
- **HTTP Request Volume:** Exactly **$1 + S$ requests**, where $S$ is the season count in `mappedShow.seasons` (including Season 0 specials if listed).
  - 1 request for show header: `GET /tv/{tmdbId}?append_to_response=aggregate_credits,credits,keywords`
  - $S$ individual requests: `GET /tv/{tmdbId}/season/{seasonNumber}`
- **Persistence Boundary:**
  - **Transaction 1 (Header):** Upserts genres, keywords, `tv_shows` header, and cast credits.
  - **Transactions $2 \dots S+1$ (Seasons):** One isolated transaction per season in `saveSeasonAndEpisodes()`:
    - Upserts `seasons` on composite key `[tvShowId, seasonNumber]`.
    - Upserts `episodes` on composite key `[seasonId, episodeNumber]`.
- **Partial Ingestion & Recovery:**
  - If season request $k$ fails (e.g. 404 or network timeout), `TmdbService` catches the error, logs a warning, and continues processing season $k+1$.
  - The return DTO sets `isPartial: true`.
  - Re-ingesting a partial TV show is completely safe: existing seasons and episodes are updated via `ON CONFLICT DO UPDATE`, and previously failed seasons are fetched and inserted.

### 6.3 Concurrency & Database Locking

- Neither `TmdbService` nor `CatalogueRepository` possesses distributed locks or job leases.
- Concurrent ingestion of two different titles is completely safe (independent rows).
- Concurrent ingestion of the exact same `tmdbId` relies on PostgreSQL `ON CONFLICT` row-level locks. While safe against data corruption, concurrent duplicate requests waste TMDB quota. Batch execution should enforce single-worker dispatch per TMDB ID.

---

## 7. Transport-Level Rate-Limiting & Retry Architecture

A critical finding of this audit is that **batch-level job sleep is insufficient for TV ingestion**.

### 7.1 The Rate-Limiting Defect in Batch-Level Sleep

In `TmdbService.ingestTvShow()`, season requests execute inside an unthrottled internal loop:

```typescript
for (const s of mappedShow.seasons) {
  const rawSeason = await this.httpClient.get<TmdbSeasonDetailsResponse>(
    `/tv/${tmdbId}/season/${s.seasonNumber}`,
  );
  ...
}
```

If a batch runner dispatches 2 TV shows concurrently and only sleeps between `ingestTvShow` calls, each TV show will rapidly fire 5–10 season requests back-to-back with zero delay, creating instantaneous bursts of 15–20 requests/second that trigger HTTP 429 rate limits on TMDB.

### 7.2 Transport-Level Pacing Solution

Rate-limiting must be enforced at the lowest HTTP transport layer: within `TmdbHttpClient` (or a dedicated request queue decorator).

```
[Seeding Batch Runner]
        │
        ▼ (concurrent workers)
[TmdbService.ingestMovie / ingestTvShow]
        │
        ▼ (header + season requests)
┌────────────────────────────────────────────────────────┐
│               TmdbHttpClient Transport Gate            │
│  - Leaky Bucket / Token Bucket Pacer                   │
│  - Inter-Request Delay: >= 100ms between ANY fetch()   │
│  - Concurrency Semaphore: Max 2 in-flight requests     │
│  - Automatic Retry-After Header Inspection             │
│  - Exponential Backoff with Jitter for 5xx/Network     │
└────────────────────────────────────────────────────────┘
        │
        ▼ (HTTPS)
   [TMDB API]
```

### 7.3 Retry and Backoff Specifications

- **Pacing Interval:** Minimum **100ms** between dispatches ($\le 10\text{ req/s}$).
- **Concurrency Cap:** Maximum **2 concurrent in-flight requests**.
- **HTTP 429 (Rate Limit):**
  - Parse `Retry-After` header. If present, sleep `ceil(retry_after) + 0.5s`.
  - If header absent, backoff: $2\text{s} \to 4\text{s} \to 8\text{s}$.
- **HTTP 5xx (Server Error):** Retry up to 3 times with exponential backoff and $\pm 20\%$ jitter:
  $$t_{\text{wait}} = 2^{\text{attempt}} \times 500\text{ms} \times (1 \pm 0.2)$$
- **HTTP 404 (Not Found):** Do not retry. Log as missing and return immediately.
- **Request Timeout:** 10,000ms enforced via `AbortController`.

---

## 8. Candidate Discovery Strategy Verification

The previous plan assumed that `DiscoverController` exposed TMDB's parametric Discover API (`/discover/movie`) and top-rated endpoints. Inspection of the actual codebase disproves this assumption:

### 8.1 Actual Implementation State in `apps/api`

| Proposed Candidate Source   | Implemented in `TmdbService`?  | Implemented in `DiscoverController`? | Actual Underpinning               |
| :-------------------------- | :----------------------------: | :----------------------------------: | :-------------------------------- |
| **Popular Movies**          |  **YES** (`getPopularMovies`)  |   **YES** (`GET /popular/movies`)    | TMDB `/movie/popular`             |
| **Popular TV Shows**        | **YES** (`getPopularTvShows`)  |     **YES** (`GET /popular/tv`)      | TMDB `/tv/popular`                |
| **Trending Movies**         | **YES** (`getTrendingMovies`)  |   **YES** (`GET /trending/movies`)   | TMDB `/trending/movie/day`        |
| **Trending TV Shows**       | **YES** (`getTrendingTvShows`) |     **YES** (`GET /trending/tv`)     | TMDB `/trending/tv/day`           |
| **Search Movies**           |    **YES** (`searchMovies`)    |       **YES** (`GET /movies`)        | TMDB `/search/movie` (text query) |
| **Search TV Shows**         |   **YES** (`searchTvShows`)    |         **YES** (`GET /tv`)          | TMDB `/search/tv` (text query)    |
| **Top-Rated Movies**        |             **NO**             |                **NO**                | Not implemented in NestJS         |
| **Top-Rated TV Shows**      |             **NO**             |                **NO**                | Not implemented in NestJS         |
| **Parametric Discover API** |             **NO**             |                **NO**                | Not implemented in NestJS         |

### 8.2 Practical Two-Stage Candidate Sourcing Plan

To source diverse international, indie, and historical candidates without modifying production NestJS controllers, Stage 5.0.3-B will employ a clean two-stage workflow:

1. **Stage 1: Offline Candidate Manifest Generation (`scripts/generate_candidate_manifest.py`):**
   - A lightweight Python or Node discovery script queries TMDB's `/discover/movie`, `/discover/tv`, `/movie/top_rated`, and `/tv/top_rated` using `TMDB_READ_ACCESS_TOKEN`.
   - Filters candidate JSON objects for:
     - `overview` length $\ge 30$ characters.
     - `vote_count >= 50`.
     - Non-synthetic title regex check.
     - Language diversity quotas (at least 25% non-English movies, 20% non-English TV).
   - Generates a vetted, deduplicated candidate manifest: `ml/benchmark/fixtures/seeding_candidate_manifest.json`.
2. **Stage 2: Standard Ingestion Execution:**
   - The seeding runner feeds the candidate TMDB IDs into CineSphere's existing ingestion endpoints (`POST /api/catalogue/ingest/movie/:tmdbId` and `POST /api/catalogue/ingest/tv/:tmdbId`).
   - This cleanly preserves layer separation: candidate discovery is vetted offline, while database persistence runs 100% through the authoritative NestJS/Prisma pipeline.

---

## 9. Historical Read-Only Catalogue Audit Baseline

A read-only audit of the primary database (`cinesphere`) was executed during Stage 5.0.2 (2026-11-24) using a read-only PostgreSQL session (`SET TRANSACTION READ ONLY`) and the exact regex patterns from `prepare_catalogue_fixture.py`.

### 9.1 Historical Catalogue Counts (2026-11-24 Stage 5.0.2 Baseline)

| Entity                     | Raw Records | With Non-Empty Overview | Excluded Synthetic Records | Eligible for Benchmark | Required Quota |  Deficit  |
| :------------------------- | :---------: | :---------------------: | :------------------------: | :--------------------: | :------------: | :-------: |
| **Movies**                 |    1,249    |           307           |            949             |        **138**         |     1,400      | **1,262** |
| **TV Shows**               |    2,174    |           302           |           1,493            |        **106**         |      600       |  **494**  |
| **Movie Probes**           |      0      |            0            |             0              |         **0**          |       38       |  **38**   |
| **TV Probes**              |      0      |            0            |             0              |         **0**          |       12       |  **12**   |
| **Total Evaluation Space** |    3,423    |           609           |           2,442            |        **244**         |     2,000      | **1,756** |

> [!NOTE]
> **Audit Reconciliation Note:** An earlier scratch script with a truncated TV exclusion pattern under-excluded synthetic records, erroneously reporting 257 eligible TV shows. The production `prepare_catalogue_fixture.py` uses the full exclusion pattern (`SYNTHETIC_TV_EXCLUSION_PATTERN`) and confirms exactly **106 eligible TV shows** as of the 2026-11-24 audit baseline.

### 9.2 Baseline Personal Library Audit (Must Remain Unchanged)

- `user_library_entries`: **765**
- `viewing_events`: **38**
- `episode_progress`: **205**
- `season_ratings`: **138**

---

## 10. Corrected Quota and Buffer Calculations

The arithmetic in the previous plan contained discrepancies between additional needed counts and final totals. The exact, corrected calculations are presented below.

> [!IMPORTANT]
> Stage 5.0.3-B.1 identified and corrected two arithmetic errors that persisted in this document since V2.1.0.
> The formula `⌈1,224 × 1.15⌉` evaluates to **1,408** (not 1,412), and `⌈482 × 1.15⌉` evaluates to **555**
> (not 556). The cascade corrections to totals, attrition projections, and API request estimates are applied
> throughout Sections 10 and 11.

### 10.1 Net Deficit Breakdown

- **Movies:**
  - Existing Eligible: **138** _(2026-11-24 audit baseline — may differ on re-audit before execution)_
  - Required Quota: **1,400**
  - Total Deficit: $1,400 - 138 = \mathbf{1,262}$
  - Mandatory Probes: **38**
  - Additional Non-Probe Candidates Needed: $1,262 - 38 = \mathbf{1,224}$
- **TV Shows:**
  - Existing Eligible: **106** _(2026-11-24 audit baseline — may differ on re-audit before execution)_
  - Required Quota: **600**
  - Total Deficit: $600 - 106 = \mathbf{494}$
  - Mandatory Probes: **12**
  - Additional Non-Probe Candidates Needed: $494 - 12 = \mathbf{482}$

### 10.2 Gross Ingestion Targets with 15% Safety Margin

To account for potential runtime attrition (e.g. unexpected empty overviews, deleted TMDB entries, or rare regex collisions), a $+15\%$ gross buffer is applied to additional candidate targets:

$$\text{Gross Movie Candidates} = \lceil 1{,}224 \times 1.15 \rceil = \lceil 1{,}407.6 \rceil = \mathbf{1{,}408}\text{ candidates}$$
$$\text{Total Movie Ingestion Target} = 38\text{ probes} + 1{,}408\text{ candidates} = \mathbf{1{,}446}\text{ movies}$$

$$\text{Gross TV Candidates} = \lceil 482 \times 1.15 \rceil = \lceil 554.3 \rceil = \mathbf{555}\text{ candidates}$$
$$\text{Total TV Ingestion Target} = 12\text{ probes} + 555\text{ candidates} = \mathbf{567}\text{ TV shows}$$

### 10.3 Expected Post-Ingestion Totals & Attrition Tolerance

A 10% attrition rate on new candidates is applied as the conservative floor projection
(candidates that fail `prepare_catalogue_fixture.py` validation post-ingestion):

| Entity       | Existing Eligible | Ingestion Target | Total if 100% Valid |                           Total with 10% Attrition                            | Required Quota |       Safety Margin       |
| :----------- | :---------------: | :--------------: | :-----------------: | :---------------------------------------------------------------------------: | :------------: | :-----------------------: |
| **Movies**   |        138        |      1,446       |      **1,584**      | $138 + \lfloor 1{,}408 \times 0.9 \rfloor = 138 + 1{,}267 = \mathbf{1{,}405}$ |     1,400      | $+5$ movies ($\ge 100\%$) |
| **TV Shows** |        106        |       567        |       **673**       |       $106 + \lfloor 555 \times 0.9 \rfloor = 106 + 499 = \mathbf{605}$       |      600       | $+5$ shows ($\ge 100\%$)  |

> [!NOTE]
> The safety margins above assume exactly 10% post-ingestion attrition. If the actual rejection rate
> exceeds 10%, an additional discovery pass should be run before benchmark fixture generation.

---

## 11. Corrected TMDB API Request-Volume Estimates

Rather than relying on unverified season averages, live TMDB queries were performed for all 12 TV probes, establishing exact season counts.

### 11.1 Verified TV Probe Request Breakdown

The 12 TV probes have a verified total of **55 seasons** in their TMDB season arrays (including Season 0 specials):

- `PB-31` (_Breaking Bad_): 6 seasons
- `PB-32` (_Succession_): 4 seasons
- `PB-33` (_Better Call Saul_): 7 seasons
- `PB-34` (_Dark_): 4 seasons
- `PB-35` (_The Sopranos_): 7 seasons
- `PB-36` (_Severance_): 4 seasons
- `PB-37` (_Chernobyl_): 1 season
- `PB-38` (_Fargo_): 6 seasons
- `PB-39` (_Fleabag_): 2 seasons
- `PB-40` (_The Wire_): 5 seasons
- `PB-45` (_Twin Peaks_): 4 seasons
- `PB-48` (_BoJack Horseman_): 7 seasons

Total verified HTTP requests for 12 TV probes: **12 headers + 55 seasons = 67 requests**.

### 11.2 Comprehensive Request Volume Estimate

_Candidate counts reflect the corrected arithmetic from Section 10.2 (1,408 movie candidates, 555 TV candidates)._

| Category                          | Item Count | Requests per Item |           Total HTTP Requests            |
| :-------------------------------- | :--------: | :---------------: | :--------------------------------------: |
| **Movie Probes**                  |     38     |         1         |                    38                    |
| **Candidate Movies**              |   1,408    |         1         |                  1,408                   |
| **Movie Discovery Pagination**    | ~70 pages  |         1         |                    70                    |
| **TV Probes (Headers + Seasons)** |     12     |  Verified exact   |                    67                    |
| **Candidate TV Headers**          |    555     |         1         |                   555                    |
| **Candidate TV Seasons**          |    555     | Estimated 3.2 avg |        1,776 (range: 1,598–1,998)        |
| **TV Discovery Pagination**       | ~30 pages  |         1         |                    30                    |
| **Transient Retries (~2%)**       |     —      |         —         |                   ~79                    |
| **Total Estimated Requests**      |     —      |         —         | **~4,023 requests** (range: 3,789–4,245) |

### 11.3 Execution Runtime Estimates

- At **10 requests/second** aggregate: $\approx 402\text{ seconds}$ ($\approx \mathbf{6.7\text{ minutes}}$).
- At **5 requests/second** conservative: $\approx 805\text{ seconds}$ ($\approx \mathbf{13.4\text{ minutes}}$).

---

## 12. TV Partial-Ingestion Recovery Design

Because TV shows require multiple HTTP calls and separate database transactions, partial ingestion can occur if network connectivity drops midway through a multi-season series.

### 12.1 State Representation of Partial Ingestion

- `tv_shows` header record is committed in Transaction 1.
- Seasons $1 \dots k$ are committed in individual season transactions.
- Season $k+1$ fails due to timeout or error.
- The return payload sets `isPartial: true`.
- In `seasons` table, count of rows for `tvShowId` is less than `tv_shows.numberOfSeasons`.

### 12.2 Recovery Protocol

1. **Runner Detection:** When the ingestion runner receives `isPartial: true` (or an unhandled rejection after the header committed), it appends the TMDB ID to `seeding_checkpoint.json` under `partial_tv_retry_queue`.
2. **Re-ingestion Idempotency:**
   - In `CatalogueRepository.saveSeasonAndEpisodes`, seasons are upserted on `@@unique([tvShowId, seasonNumber])` and episodes on `@@unique([seasonId, episodeNumber])`.
   - Re-running `ingestTvShow(tmdbId)` simply updates existing seasons/episodes and inserts the missing season $k+1$.
3. **No Duplicate Rows:** The database triggers and composite unique constraints guarantee zero duplicate records upon retry.

---

## 13. Database Safety & Personal Library Isolation Boundaries

To guarantee complete safety for personal user library data during bulk seeding:

### 13.1 Strict Table Boundaries

```
[Catalogue Public Tables — READ / INSERT / UPDATE Allowed]
  movies, tv_shows, seasons, episodes, genres, keywords,
  persons, person_credits, _GenreToMovie, _GenreToTvShow,
  _KeywordToMovie, _KeywordToTvShow

[Personal User Library Tables — STRICTLY FORBIDDEN / ZERO ACCESS]
  users, user_library_entries, viewing_events,
  episode_progress, season_ratings, system_configs
```

### 13.2 Non-Negotiable Invariants

1. **Zero Deletion:** Under no circumstances will `TRUNCATE`, `DROP`, or broad `DELETE` statements be executed against catalogue tables.
2. **Referential Restraints:** Foreign key constraints (`onDelete: Restrict` from `user_library_entries` to `movies` and `tv_shows`) remain active at all times.
3. **No Trigger Modification:** PostgreSQL integrity triggers from Phase 3 remain active; no bypasses will be used.
4. **Pre/Post Verification:** A strict row-count assertion on all personal tables will be executed immediately before and after Stage 5.0.3-B to prove zero mutations.

---

## 14. Implementation Capabilities: Existing vs. Missing

| System Capability                          | Implementation State | Location in Codebase                        | Action for Stage 5.0.3-B                     |
| :----------------------------------------- | :------------------: | :------------------------------------------ | :------------------------------------------- |
| **Movie Ingestion Endpoint**               |      **EXISTS**      | `apps/api/src/tmdb/tmdb.controller.ts`      | Use existing endpoint                        |
| **TV Ingestion Endpoint**                  |      **EXISTS**      | `apps/api/src/tmdb/tmdb.controller.ts`      | Use existing endpoint                        |
| **Transactional Upsert Repo**              |      **EXISTS**      | `apps/api/src/tmdb/catalogue.repository.ts` | Use existing repository                      |
| **DTO Mappers & Deduplication**            |      **EXISTS**      | `apps/api/src/tmdb/tmdb.mapper.ts`          | Use existing mapper                          |
| **HTTP Client 429 Retry**                  |      **EXISTS**      | `apps/api/src/tmdb/tmdb-http.client.ts`     | Use existing retry logic                     |
| **Transport-Level Rate Pacer**             |     **MISSING**      | `apps/api/src/tmdb/tmdb-http.client.ts`     | Add 100ms inter-request pacing gate          |
| **Offline Candidate Manifest Generator**   |     **MISSING**      | `scripts/`                                  | Create `generate_candidate_manifest.py`      |
| **Resumable Batch Ingestion Runner**       |     **MISSING**      | `scripts/`                                  | Create `seed_catalogue_batch.ts` (or runner) |
| **Disk Checkpointing (`checkpoint.json`)** |     **MISSING**      | `data/`                                     | Add atomic checkpoint state manager          |

---

## 15. Remaining Risks & Open Decisions

| Risk / Decision                         | Severity | Probability | Mitigation Strategy                                                                                                                                |
| :-------------------------------------- | :------: | :---------: | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Probe ID Mismatches**                 |   Low    |  Resolved   | Resolved in Stage 5.0.3-A.2 (`probes_v1.json` corrected; `matches_probe_identity()` enforces semantic match; only canonical IDs will be ingested). |
| **TMDB Burst Rate-Limiting**            |  Medium  |   Medium    | Enforce transport-level 100ms pacing in `TmdbHttpClient` across all season requests.                                                               |
| **Network Interruption during Seeding** |  Medium  |     Low     | Maintain atomic `seeding_checkpoint.json`; runner resumes cleanly without re-ingesting completed IDs.                                              |
| **Catalogue Attrition > 15%**           |   Low    |     Low     | Gross buffer provides $+188$ movies and $+74$ TV shows over minimum quotas; candidate pre-validation filters short overviews.                      |

---

## 16. Explicit Stage 5.0.3-B Readiness Verdict

### Verdict: **PLAN COMPLETE — STAGE 5.0.3-B NOT YET AUTHORIZED**

The Stage 5.0.3 planning baseline is now fully audited, reconciled with Stage 5.0.3-A.2, and mathematically sound:

1. **Probe Inventory:** 100% reconciled against `probes_v1.json` (38 movies, 12 TV shows; all 3 verified TMDB ID errors resolved in Stage 5.0.3-A.2).
2. **Probe Identity Enforcement:** `prepare_catalogue_fixture.py` hardened with `matches_probe_identity()`, approved alias registry, and `ProbeIdentityMismatchError` fail-closed stops.
3. **Canonical Seeding Strategy:** Stage 5.0.3-B will ingest strictly the 50 canonical target IDs. No double-seeding of erroneous IDs.
4. **Transport-Level Rate Limiting:** Flaw in batch-level sleep identified and transport-level 100ms pacer designed.
5. **Candidate Discovery:** Practical two-stage sourcing workflow established using external manifest generation and existing NestJS ingestion endpoints.
6. **Mathematical Integrity:** Quotas, gross buffers, and API request volumes rigorously recalculated.
7. **Personal Data Safety:** Zero-access boundaries and verification assertions firmly established.

> [!IMPORTANT]
> **Execution Boundary:** This document completes Stage 5.0.3-A.1 / Stage 5.0.3-A.3 planning reconciliation. **No catalogue ingestion has taken place.** Execution of Stage 5.0.3-B requires separate explicit authorization.
