# CineSphere — Database Design

**Status:** Phase 2A Catalogue Foundation Implemented & Aligned

**Last Updated:** 2026-11-06

**Version:** 1.1

> This document defines the CineSphere database architecture. Phase 1 foundation tables and Phase 2A catalogue tables have been implemented and verified with PostgreSQL/Prisma migrations. Higher-phase tables remain design specifications.

---

## 1. Design Principles

1. **Separate catalogue data from personal data.** The catalogue (movies, TV shows, seasons, episodes, genres, etc.) is shared reference data fetched from TMDB. Personal data (library entries, ratings, reviews, recommendation history) belongs exclusively to the user. This separation makes hosted demo anonymization straightforward.

2. **Never overwrite personal history.** Ratings, library entries, recommendation records, and feedback are append-friendly. Historical records must survive algorithm changes or re-imports.

3. **Vector columns are isolated.** pgvector `vector` columns are stored in a dedicated table (`MediaEmbedding`) rather than embedded in the main media table. This keeps the schema clean and allows Prisma to manage non-vector columns while raw SQL handles vector operations.

4. **Avoid premature normalization.** Tables exist to serve documented use cases. Do not create a table unless there is a clear reason for it.

5. **Indexing is planned at design time.** Performance-relevant columns are identified here and implemented when the schema is migrated.

---

## 2. Entity Overview

| Entity | Purpose |

| -------------------------- | -------------------------------------------------------------------- |

| `User` | Single application user. Single row for local mode. |

| `Media` | Polymorphic base for movies and TV shows. Shared catalogue metadata. |

| `Movie` | Movie-specific metadata (runtime, release date, etc.). |

| `TvShow` | TV-show-specific metadata (network, number of seasons, etc.). |

| `Season` | A season within a TV show. |

| `Episode` | A single episode within a season. |

| `Genre` | Reference table for TMDB genres. |

| `Keyword` | Reference table for TMDB keywords. |

| `Person` | Cast and crew members. |

| `MediaGenre` | Join: media ↔ genre. |

| `MediaKeyword` | Join: media ↔ keyword. |

| `MediaCast` | Join: media ↔ person with role/character. |

| `UserLibraryEntry` | A user's relationship with a media item (status, dates). |

| `WatchProgress` | TV episode tracking for a library entry. |

| `PersonalRating` | A user's numeric rating for a media item or season. |

| `Review` | Optional text review or notes for a library entry. |

| `RewatchRecord` | Tracks individual rewatch events for movies. |

| `MediaEmbedding` | Semantic embedding vector for a media item (pgvector). |

| `MediaSimilarity` | Precomputed cosine similarity neighbours. |

| `ClusterAssignment` | HDBSCAN cluster assignment and UMAP 2D coordinates. |

| `Cluster` | Cluster metadata (label, description, colour). |

| `RecommendationRecord` | A single recommendation shown to the user. |

| `RecommendationImpression` | Record that a recommendation was displayed. |

| `RecommendationFeedback` | User feedback on a recommendation. |

| `TasteProfile` | Current structured taste profile. |

| `TasteProfileSnapshot` | Historical snapshots of the taste profile. |

| `UserPreference` | Application and recommendation settings. |

---

## 3. Entity Specifications

### 3.1 User

**Purpose:** Represents the single application user. Exists primarily as a foreign key anchor for all personal data. In local mode, one row is created on first run.

| Field | Type | Notes |

| ------------- | -------------- | --------------------- |

| `id` | `UUID` PK | |

| `displayName` | `VARCHAR(100)` | Optional display name |

| `createdAt` | `TIMESTAMPTZ` | |

| `updatedAt` | `TIMESTAMPTZ` | |

**Notes:** Multi-user support is not planned. This table simplifies the data model for a possible future extension and keeps personal data clearly separated from catalogue data.

---

### 3.2 Catalogue Schema Overview (Phase 2A Implemented)

The catalogue database uses a direct, maintainable relational structure without unnecessary polymorphic abstractions:

- **`Movie`** and **`TvShow`** are first-class relational tables with internal UUIDs and unique TMDB IDs.

- **`Season`** and **`Episode`** model episodic television hierarchies with cascading deletes.

- **`Genre`** and **`Keyword`** are reusable reference tables shared between movies and TV shows via Prisma implicit many-to-many join tables (`_GenreToMovie`, `_GenreToTvShow`, `_KeywordToMovie`, `_KeywordToTvShow`).

- **`Person`** models actors and actresses with a minimal profile (`id`, `tmdbId`, `name`).

- **`PersonCredit`** is a single combined table for both movie and TV show cast appearances, with an explicit database-level `CHECK` constraint ensuring each credit belongs to exactly one media item.

---

### 3.3 Movie

**Purpose:** Movie catalogue metadata and local cache.

| Field | Type | Notes |

| ------------------ | ------------------------ | --------------------------------------------- |

| `id` | `UUID` PK | Internal ID (UUID v4) |

| `tmdbId` | `INTEGER` UNIQUE | TMDB movie ID |

| `title` | `VARCHAR(500)` | Display title |

| `originalTitle` | `VARCHAR(500)` | Original title (nullable) |

| `overview` | `TEXT` | Synopsis (nullable) |

| `releaseDate` | `DATE` | Release date (nullable) |

| `runtime` | `INTEGER` | Runtime in minutes (nullable) |

| `originalLanguage` | `VARCHAR(10)` | Language code (nullable) |

| `popularity` | `DOUBLE PRECISION` | TMDB popularity metric (nullable) |

| `voteAverage` | `DOUBLE PRECISION` | TMDB rating (nullable) |

| `voteCount` | `INTEGER` | Vote count (nullable) |

| `posterPath` | `VARCHAR(255)` | TMDB poster asset path (nullable) |

| `backdropPath` | `VARCHAR(255)` | TMDB backdrop asset path (nullable) |

| `adult` | `BOOLEAN` | Adult content flag (default false) |

| `createdAt` | `TIMESTAMPTZ(6)` | Record creation timestamp |

| `updatedAt` | `TIMESTAMPTZ(6)` | Record update timestamp |

| `syncedAt` | `TIMESTAMPTZ(6)` | Last sync timestamp with TMDB API (nullable) |

**Indexes:**

- `movies_tmdbId_key` (UNIQUE)
- `movies_popularity_idx`

---

### 3.4 TvShow

**Purpose:** TV show catalogue metadata and local cache.

| Field | Type | Notes |

| ------------------ | ------------------------ | --------------------------------------------- |

| `id` | `UUID` PK | Internal ID (UUID v4) |

| `tmdbId` | `INTEGER` UNIQUE | TMDB TV show ID |

| `name` | `VARCHAR(500)` | Show name |

| `originalName` | `VARCHAR(500)` | Original show name (nullable) |

| `overview` | `TEXT` | Synopsis (nullable) |

| `firstAirDate` | `DATE` | First air date (nullable) |

| `lastAirDate` | `DATE` | Last air date (nullable) |

| `originalLanguage` | `VARCHAR(10)` | Language code (nullable) |

| `popularity` | `DOUBLE PRECISION` | TMDB popularity metric (nullable) |

| `voteAverage` | `DOUBLE PRECISION` | TMDB rating (nullable) |

| `voteCount` | `INTEGER` | Vote count (nullable) |

| `posterPath` | `VARCHAR(255)` | TMDB poster asset path (nullable) |

| `backdropPath` | `VARCHAR(255)` | TMDB backdrop asset path (nullable) |

| `status` | `VARCHAR(50)` | Release status (e.g. Returning, Ended) |

| `numberOfSeasons` | `INTEGER` | Season count (nullable) |

| `numberOfEpisodes` | `INTEGER` | Total episode count (nullable) |

| `createdAt` | `TIMESTAMPTZ(6)` | Record creation timestamp |

| `updatedAt` | `TIMESTAMPTZ(6)` | Record update timestamp |

| `syncedAt` | `TIMESTAMPTZ(6)` | Last sync timestamp with TMDB API (nullable) |

**Indexes:**

- `tv_shows_tmdbId_key` (UNIQUE)
- `tv_shows_popularity_idx`

---

### 3.5 Season

**Purpose:** A season within a TV show.

| Field | Type | Notes |

| -------------- | ----------------------- | --------------------------------------------- |

| `id` | `UUID` PK | Internal ID |

| `tmdbId` | `INTEGER` | TMDB season ID (nullable) |

| `seasonNumber` | `INTEGER` | Season 0 = Specials (supports zero/negatives) |

| `name` | `VARCHAR(255)` | Season name (nullable) |

| `overview` | `TEXT` | Synopsis (nullable) |

| `posterPath` | `VARCHAR(255)` | Poster image path (nullable) |

| `airDate` | `DATE` | First air date (nullable) |

| `tvShowId` | `UUID` FK → `tv_shows` | Cascade delete on parent TV show removal |

**Constraints & Indexes:**

- `seasons_tmdbId_key` (UNIQUE, nullable)
- `UNIQUE(tvShowId, seasonNumber)` — prevents duplicate season numbers in a TV show.
- `seasons_tvShowId_idx`

---

### 3.6 Episode

**Purpose:** An episode within a season.

| Field | Type | Notes |

| --------------- | ----------------------- | --------------------------------------------- |

| `id` | `UUID` PK | Internal ID |

| `tmdbId` | `INTEGER` | TMDB episode ID (nullable) |

| `episodeNumber` | `INTEGER` | Episode order within season |

| `name` | `VARCHAR(255)` | Episode title (nullable) |

| `overview` | `TEXT` | Synopsis (nullable) |

| `airDate` | `DATE` | Air date (nullable) |

| `runtime` | `INTEGER` | Runtime in minutes (nullable) |

| `seasonId` | `UUID` FK → `seasons` | Cascade delete on parent season removal |

**Constraints & Indexes:**

- `episodes_tmdbId_key` (UNIQUE, nullable)
- `UNIQUE(seasonId, episodeNumber)` — prevents duplicate episode numbers in a season.
- `episodes_seasonId_idx`

---

### 3.7 Genre and Keyword Reference Tables

**`genres`**

- `tmdbId` (`INTEGER` PK)

- `name` (`VARCHAR(100)`)

**`keywords`**

- `tmdbId` (`INTEGER` PK)

- `name` (`VARCHAR(255)`)

Both models share many-to-many relationships with movies and TV shows via Prisma implicit join tables:

- `_GenreToMovie` (`A` = genre tmdbId, `B` = movie UUID)

- `_GenreToTvShow` (`A` = genre tmdbId, `B` = tv_show UUID)

- `_KeywordToMovie` (`A` = keyword tmdbId, `B` = movie UUID)

- `_KeywordToTvShow` (`A` = keyword tmdbId, `B` = tv_show UUID)

---

### 3.8 Person

**Purpose:** Actors and actresses appearing in movies or TV shows. Intentionally simplified (no biographies, social links, or crew departments).

| Field | Type | Notes |

| ----------- | ------------------------ | ------------------------- |

| `id` | `UUID` PK | Internal ID |

| `tmdbId` | `INTEGER` UNIQUE | TMDB person ID |

| `name` | `VARCHAR(255)` | Full name |

| `createdAt` | `TIMESTAMPTZ(6)` | Record creation timestamp |

| `updatedAt` | `TIMESTAMPTZ(6)` | Record update timestamp |

**Indexes:**

- `persons_tmdbId_key` (UNIQUE)

---

### 3.9 Combined PersonCredit Architecture

**Purpose:** A single, unified junction table tracking person appearances across both movies and TV shows. Eliminates the complexity of separate `MovieCast` and `TvShowCast` models.

| Field | Type | Notes |

| ----------- | ------------------------ | --------------------------------------------- |

| `id` | `UUID` PK | Internal ID |

| `personId` | `UUID` FK → `persons` | Cascade delete on person deletion |

| `movieId` | `UUID` FK → `movies` | Cascade delete on movie deletion (nullable) |

| `tvShowId` | `UUID` FK → `tv_shows` | Cascade delete on show deletion (nullable) |

**Database Integrity CHECK Constraint:**

```sql

CONSTRAINT "person_credits_exactly_one_media" CHECK (

    ("movieId" IS NOT NULL AND "tvShowId" IS NULL) OR

    ("movieId" IS NULL AND "tvShowId" IS NOT NULL)

)

```

**Uniqueness & Partial Indexes:**

To prevent duplicate person-to-movie or person-to-TV-show credits without conflicting on `NULL` columns:

- `CREATE UNIQUE INDEX "person_credits_person_movie_uniq" ON "person_credits" ("personId", "movieId") WHERE ("movieId" IS NOT NULL);`

- `CREATE UNIQUE INDEX "person_credits_person_tvshow_uniq" ON "person_credits" ("personId", "tvShowId") WHERE ("tvShowId" IS NOT NULL);`

- `CREATE INDEX "person_credits_personId_idx" ON "person_credits" ("personId");`

**Supported Query Workflows:**

- Viewing a movie or TV show retrieves cast in a single query by `movieId` or `tvShowId`.

- Viewing a person retrieves all movie and TV appearances together in one query by `personId`, powering a unified filmography.

---

### 3.10 Architectural Trade-offs & Decisions (Phase 2A)

1. **Direct `Movie` and `TvShow` tables vs. Polymorphic `Media` base table:**

   - _Trade-off:_ Avoids polymorphic table joins and complex multi-table inheritance queries in Prisma while retaining type-safe foreign keys. Media items are queried by their specific domain (`movies` vs `tv_shows`).

2. **Single Combined `PersonCredit` vs. Separate `MovieCast` / `TvShowCast`:**

   - _Trade-off:_ Allows retrieving an actor's entire filmography across movies and TV in a single query (`WHERE personId = $1`) without SQL `UNION` operations across disparate tables. Database integrity is preserved via PostgreSQL `CHECK` constraint ensuring mutually exclusive media associations.

3. **Implicit vs. Explicit Many-to-Many for Genres and Keywords:**

   - _Trade-off:_ Prisma implicit M2M tables (`_GenreToMovie`, etc.) reduce boilerplate and provide clean `connect` / `disconnect` syntax in API handlers without requiring separate join model files.

---

### 3.11 UserLibraryEntry

**Purpose:** The user's relationship with a specific media item. The core personal data record.

| Field | Type | Notes |

| ------------- | ----------------------------------------------------------- | -------------------------------------------- |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` | |

| `mediaId` | `UUID` FK → `Media.id` | |

| `status` | `ENUM('watching', 'completed', 'plan_to_watch', 'dropped')` | |

| `addedAt` | `TIMESTAMPTZ` | When the entry was added to the library |

| `startedAt` | `TIMESTAMPTZ` | When the user started watching (nullable) |

| `completedAt` | `TIMESTAMPTZ` | When the user marked as completed (nullable) |

| `updatedAt` | `TIMESTAMPTZ` | |

**Constraints:** `UNIQUE(userId, mediaId)` — one entry per user per media item.

**Indexes:**

- `(userId, status)` — library list filtering.

- `(userId, updatedAt DESC)` — recently updated items.

- `mediaId` — reverse lookup.

---

### 3.12 WatchProgress

**Purpose:** Tracks TV show episode progress for a library entry. Updated as the user advances through episodes.

| Field | Type | Notes |

| ---------------------- | --------------------------------- | ----- |

| `id` | `UUID` PK | |

| `libraryEntryId` | `UUID` FK → `UserLibraryEntry.id` | |

| `currentSeasonNumber` | `INTEGER` | |

| `currentEpisodeNumber` | `INTEGER` | |

| `lastWatchedAt` | `TIMESTAMPTZ` | |

| `updatedAt` | `TIMESTAMPTZ` | |

**Relationship:** One-to-one with `UserLibraryEntry` (only for TV shows).

---

### 3.13 PersonalRating

**Purpose:** The user's numeric rating for a media item or for a specific season.

| Field | Type | Notes |

| ----------- | ----------------------- | ------------------------------------------------------ |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` | |

| `mediaId` | `UUID` FK → `Media.id` | Nullable if rating is for a season |

| `seasonId` | `UUID` FK → `Season.id` | Nullable if rating is for the full media item |

| `rating` | `DECIMAL(3,1)` | Range: 1.0–10.0 (to be confirmed per TD-05 equivalent) |

| `ratedAt` | `TIMESTAMPTZ` | |

| `updatedAt` | `TIMESTAMPTZ` | |

**Constraints:** `UNIQUE(userId, mediaId)` for overall ratings; `UNIQUE(userId, seasonId)` for season ratings.

> **Open decision:** Rating scale (1–10 with 0.5 steps vs. 1–10 integer). Decide before implementing. Document in `tasks.md`.

---

### 3.14 Review

**Purpose:** Optional text review or private notes for a library entry.

| Field | Type | Notes |

| ------------------ | ---------------------------------------- | -------------------- |

| `id` | `UUID` PK | |

| `libraryEntryId` | `UUID` FK → `UserLibraryEntry.id` UNIQUE | One review per entry |

| `content` | `TEXT` | Freeform text |

| `containsSpoilers` | `BOOLEAN` | User-flagged |

| `createdAt` | `TIMESTAMPTZ` | |

| `updatedAt` | `TIMESTAMPTZ` | |

---

### 3.15 RewatchRecord

**Purpose:** Tracks individual rewatch events for a movie (not a rewatch counter).

| Field | Type | Notes |

| ---------------- | --------------------------------- | ------------------------------- |

| `id` | `UUID` PK | |

| `libraryEntryId` | `UUID` FK → `UserLibraryEntry.id` | |

| `watchedAt` | `DATE` | Date of the rewatch |

| `notes` | `TEXT` | Optional notes for this rewatch |

---

### 3.16 MediaEmbedding

**Purpose:** Stores the semantic embedding vector for a media item. Separated from the main `Media` table to isolate pgvector column handling and keep Prisma schema clean.

| Field | Type | Notes |

| ------------- | ----------------------------- | -------------------------------------------------------------- |

| `id` | `UUID` PK | |

| `mediaId` | `UUID` FK → `Media.id` UNIQUE | |

| `embedding` | `vector(N)` | pgvector type. Dimension N = model-dependent (see TD-08) |

| `modelId` | `VARCHAR(100)` | Identifier for the embedding model used |

| `contentHash` | `VARCHAR(64)` | Hash of the input content. Detect when re-embedding is needed. |

| `generatedAt` | `TIMESTAMPTZ` | |

**pgvector index:** `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` — enable if cosine search latency becomes a concern at scale.

> **Important:** This table is not managed by Prisma migrations in the standard way due to the `vector` type. The pgvector column and index are created via raw SQL in a migration script. Prisma maps to this table with a typed raw SQL accessor. See TD-04.

---

### 3.17 MediaSimilarity

**Purpose:** Precomputed top-N cosine similarity neighbours for each media item. Avoids full table scans for similarity lookups.

| Field | Type | Notes |

| ------------------ | ---------------------- | --------------------------------- |

| `id` | `UUID` PK | |

| `sourceMediaId` | `UUID` FK → `Media.id` | |

| `targetMediaId` | `UUID` FK → `Media.id` | |

| `cosineSimilarity` | `FLOAT` | Cosine similarity score (0–1) |

| `rank` | `INTEGER` | Neighbour rank (1 = most similar) |

| `computedAt` | `TIMESTAMPTZ` | |

**Constraints:** `UNIQUE(sourceMediaId, targetMediaId)`

**Indexes:**

- `(sourceMediaId, rank)` — primary query pattern (fetch top-N neighbours for an item).

---

### 3.18 ClusterAssignment

**Purpose:** HDBSCAN cluster assignment and UMAP 2D coordinates for visualization.

| Field | Type | Notes |

| ------------ | ----------------------------- | --------------------------------------- |

| `id` | `UUID` PK | |

| `mediaId` | `UUID` FK → `Media.id` UNIQUE | |

| `clusterId` | `UUID` FK → `Cluster.id` | Nullable if HDBSCAN marks as noise (-1) |

| `umapX` | `FLOAT` | 2D visualization coordinate only |

| `umapY` | `FLOAT` | 2D visualization coordinate only |

| `computedAt` | `TIMESTAMPTZ` | |

> **Critical constraint:** `umapX` and `umapY` are visualization coordinates only. They must never be used for similarity search, nearest-neighbour computation, or clustering. The original embedding in `MediaEmbedding` is the semantic source of truth.

---

### 3.19 Cluster

**Purpose:** Metadata for a HDBSCAN-identified cluster of media items.

| Field | Type | Notes |

| ------------- | -------------- | ----------------------------------------------------- |

| `id` | `UUID` PK | |

| `label` | `VARCHAR(200)` | Human-readable cluster label |

| `description` | `TEXT` | Cluster description (keyword-derived or LLM-assisted) |

| `colour` | `VARCHAR(7)` | Hex colour for visualization |

| `itemCount` | `INTEGER` | Cached count of items in cluster |

| `computedAt` | `TIMESTAMPTZ` | When this cluster was generated |

---

### 3.20 RecommendationRecord

**Purpose:** A single recommendation generated for the user. Records are immutable after creation — historical records are preserved even when the algorithm changes.

| Field | Type | Notes |

| ------------------ | ------------------------------------------ | ------------------------------------------------------------ |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` | |

| `mediaId` | `UUID` FK → `Media.id` | The recommended item |

| `generatedAt` | `TIMESTAMPTZ` | |

| `algorithmVersion` | `VARCHAR(50)` | Version tag for the scoring algorithm used |

| `totalScore` | `FLOAT` | Final composite score |

| `scoreS` | `FLOAT` | Semantic similarity component |

| `scoreP` | `FLOAT` | Preference match component |

| `scoreM` | `FLOAT` | Mood match component |

| `scoreQ` | `FLOAT` | Quality signal component |

| `scoreN` | `FLOAT` | Novelty component |

| `reason` | `TEXT` | Human-readable explanation of the recommendation |

| `diversityMode` | `ENUM('safe', 'balanced', 'experimental')` | Diversity mode active when generated |

| `source` | `VARCHAR(100)` | Recommendation source (e.g., "content_based", "hidden_gems") |

| `addedToLibrary` | `BOOLEAN` | Whether the user added this to their library |

| `addedToLibraryAt` | `TIMESTAMPTZ` | |

| `watched` | `BOOLEAN` | Whether the user eventually watched this |

| `watchedAt` | `TIMESTAMPTZ` | |

| `personalRating` | `DECIMAL(3,1)` | The user's eventual rating, if any |

**Indexes:**

- `(userId, generatedAt DESC)` — recommendation history queries.

- `(userId, mediaId)` — check if item has been previously recommended.

---

### 3.21 RecommendationImpression

**Purpose:** Records that a recommendation was actually displayed to the user (impression tracking for evaluation). A recommendation may be generated but not shown immediately.

| Field | Type | Notes |

| ------------------ | ------------------------------------- | ----------------------------------------------- |

| `id` | `UUID` PK | |

| `recommendationId` | `UUID` FK → `RecommendationRecord.id` | |

| `shownAt` | `TIMESTAMPTZ` | When the recommendation was shown |

| `position` | `INTEGER` | Position in the recommendation list (1-indexed) |

---

### 3.22 RecommendationFeedback

**Purpose:** User's structured feedback on a recommendation.

| Field | Type | Notes |

| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----- |

| `id` | `UUID` PK | |

| `recommendationId` | `UUID` FK → `RecommendationRecord.id` | |

| `userId` | `UUID` FK → `User.id` | |

| `feedbackType` | `ENUM('interested', 'not_interested', 'already_watched', 'not_my_type', 'watched_and_loved', 'watched_and_disappointed')` | |

| `submittedAt` | `TIMESTAMPTZ` | |

**Important:** `already_watched` is not a negative signal. The recommendation engine must handle this feedback type correctly — it means the item should be removed from future recommendation candidates, but no negative preference adjustment should occur.

---

### 3.23 TasteProfile

**Purpose:** The current structured taste profile for the user. A single live record, updated when the profile is regenerated.

| Field | Type | Notes |

| -------------------------- | ---------------------------- | ----------------------------------------------------------------------- |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` UNIQUE | One profile per user |

| `preferredGenres` | `JSONB` | `[{genre: string, weight: float}]` |

| `avoidedGenres` | `JSONB` | `[{genre: string, weight: float}]` |

| `preferredThemes` | `JSONB` | `[{theme: string, weight: float}]` |

| `preferredTones` | `JSONB` | `[{tone: string, weight: float}]` |

| `preferredNarrativeStyles` | `JSONB` | `[{style: string, weight: float}]` |

| `preferredCharacterTypes` | `JSONB` | `[{type: string, weight: float}]` |

| `positiveSignals` | `JSONB` | Structured positive preference signals |

| `negativeSignals` | `JSONB` | Structured negative preference signals |

| `confidenceScore` | `FLOAT` | 0–1: how confident the system is in this profile (based on data volume) |

| `narrativeDescription` | `TEXT` | Optional LLM-generated prose description |

| `generatedAt` | `TIMESTAMPTZ` | |

| `algorithmVersion` | `VARCHAR(50)` | |

---

### 3.24 TasteProfileSnapshot

**Purpose:** Historical snapshots of the taste profile for Taste Evolution tracking.

| Field | Type | Notes |

| ---------------- | --------------------- | ------------------------------------------------------------ |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` | |

| `profileData` | `JSONB` | Full snapshot of `TasteProfile` fields at this point in time |

| `snapshotReason` | `VARCHAR(100)` | e.g., "periodic", "significant_change", "manual" |

| `libraryCount` | `INTEGER` | Library size at snapshot time (for data-sufficiency context) |

| `createdAt` | `TIMESTAMPTZ` | |

---

### 3.25 UserPreference

**Purpose:** Application and recommendation settings for the user.

| Field | Type | Notes |

| ----------------------------- | ------------------------------------------ | -------------------------------------- |

| `id` | `UUID` PK | |

| `userId` | `UUID` FK → `User.id` UNIQUE | |

| `recommendationDiversityMode` | `ENUM('safe', 'balanced', 'experimental')` | Default: `balanced` |

| `defaultMediaType` | `ENUM('movie', 'tv', 'both')` | Filter preference |

| `ollamaEnabled` | `BOOLEAN` | Whether the user has enabled local LLM |

| `ollamaModel` | `VARCHAR(100)` | Selected Ollama model |

| `ollamaBaseUrl` | `VARCHAR(300)` | Ollama API URL |

| `theme` | `ENUM('light', 'dark', 'system')` | UI theme |

| `updatedAt` | `TIMESTAMPTZ` | |

---

## 4. Entity-Relationship Diagram

```mermaid

erDiagram

    User {

        uuid id PK

        string displayName

        timestamp createdAt

    }



    Media {

        uuid id PK

        int tmdbId

        enum mediaType

        string title

        string overview

        float popularity

        float voteAverage

    }



    Movie {

        uuid id PK_FK

        date releaseDate

        int runtime

    }



    TvShow {

        uuid id PK_FK

        date firstAirDate

        int numberOfSeasons

        string status

    }



    Season {

        uuid id PK

        uuid tvShowId FK

        int seasonNumber

        int episodeCount

    }



    Episode {

        uuid id PK

        uuid seasonId FK

        int episodeNumber

        string name

    }



    Genre {

        int id PK

        string name

    }



    Keyword {

        int id PK

        string name

    }



    Person {

        uuid id PK

        int tmdbId

        string name

    }



    MediaGenre {

        uuid mediaId FK

        int genreId FK

    }



    MediaKeyword {

        uuid mediaId FK

        int keywordId FK

    }



    MediaCast {

        uuid mediaId FK

        uuid personId FK

        string character

        int order

    }



    UserLibraryEntry {

        uuid id PK

        uuid userId FK

        uuid mediaId FK

        enum status

        timestamp addedAt

        timestamp completedAt

    }



    WatchProgress {

        uuid id PK

        uuid libraryEntryId FK

        int currentSeasonNumber

        int currentEpisodeNumber

    }



    PersonalRating {

        uuid id PK

        uuid userId FK

        uuid mediaId FK

        decimal rating

        timestamp ratedAt

    }



    Review {

        uuid id PK

        uuid libraryEntryId FK

        text content

    }



    RewatchRecord {

        uuid id PK

        uuid libraryEntryId FK

        date watchedAt

    }



    MediaEmbedding {

        uuid id PK

        uuid mediaId FK

        vector embedding

        string modelId

        timestamp generatedAt

    }



    MediaSimilarity {

        uuid id PK

        uuid sourceMediaId FK

        uuid targetMediaId FK

        float cosineSimilarity

        int rank

    }



    ClusterAssignment {

        uuid id PK

        uuid mediaId FK

        uuid clusterId FK

        float umapX

        float umapY

    }



    Cluster {

        uuid id PK

        string label

        string colour

        int itemCount

    }



    RecommendationRecord {

        uuid id PK

        uuid userId FK

        uuid mediaId FK

        float totalScore

        string reason

        timestamp generatedAt

        bool watched

    }



    RecommendationFeedback {

        uuid id PK

        uuid recommendationId FK

        enum feedbackType

        timestamp submittedAt

    }



    RecommendationImpression {

        uuid id PK

        uuid recommendationId FK

        timestamp shownAt

        int position

    }



    TasteProfile {

        uuid id PK

        uuid userId FK

        jsonb preferredGenres

        jsonb negativeSignals

        float confidenceScore

        timestamp generatedAt

    }



    TasteProfileSnapshot {

        uuid id PK

        uuid userId FK

        jsonb profileData

        timestamp createdAt

    }



    UserPreference {

        uuid id PK

        uuid userId FK

        enum recommendationDiversityMode

        bool ollamaEnabled

    }



    User ||--o{ UserLibraryEntry : "has"

    User ||--o| UserPreference : "configures"

    User ||--o| TasteProfile : "has"

    User ||--o{ TasteProfileSnapshot : "generates"

    User ||--o{ RecommendationRecord : "receives"

    User ||--o{ PersonalRating : "gives"



    Media ||--o| Movie : "is a"

    Media ||--o| TvShow : "is a"

    Media ||--o{ MediaGenre : "tagged with"

    Media ||--o{ MediaKeyword : "tagged with"

    Media ||--o{ MediaCast : "features"

    Media ||--o| MediaEmbedding : "has"

    Media ||--o{ MediaSimilarity : "source of"

    Media ||--o| ClusterAssignment : "placed in"



    TvShow ||--o{ Season : "has"

    Season ||--o{ Episode : "contains"



    Genre ||--o{ MediaGenre : "applied to"

    Keyword ||--o{ MediaKeyword : "applied to"

    Person ||--o{ MediaCast : "appears in"



    UserLibraryEntry ||--o| WatchProgress : "tracks TV"

    UserLibraryEntry ||--o{ RewatchRecord : "records rewatches"

    UserLibraryEntry ||--o| Review : "has"



    RecommendationRecord ||--o{ RecommendationImpression : "shown as"

    RecommendationRecord ||--o| RecommendationFeedback : "receives"



    ClusterAssignment }o--|| Cluster : "belongs to"

    MediaSimilarity }o--|| Media : "target"

```

---

## 5. pgvector Considerations

### 5.1 Prisma + pgvector Integration (TD-04 Resolved)

Prisma does not natively support the `vector` type. The adopted and verified architecture:

1. **Extension Lifecycle:** The `vector` extension is installed via initial Prisma SQL migration (`CREATE EXTENSION IF NOT EXISTS vector;`).

2. **Encapsulated Vector Repository:** A dedicated `VectorRepository` (`apps/api/src/database/vector.repository.ts`) encapsulates all vector distance and similarity operations using parameterized `$queryRaw` statements. Raw SQL is strictly banned from controllers and business services.

3. **Model Management:** Standard relational tables are managed via Prisma models. In Phase 5, `MediaEmbedding` will map the vector column via `Unsupported("vector(N)")` once TD-08 resolves dimension `N`.

4. **Injection Safety:** All vector inputs and thresholds are passed as parameterized arguments to `$queryRaw`.

### 5.2 Embedding Dimension (TD-08 Open)

The embedding dimension `N` depends on the chosen Sentence Transformers model (TD-08):

| Model | Dimension | Notes |

| ------------------- | --------- | ------------------------------------------ |

| `all-MiniLM-L6-v2` | 384 | Fast, smaller model. Good for prototyping. |

| `all-mpnet-base-v2` | 768 | Higher quality. Slower to generate. |

| `all-MiniLM-L12-v2` | 384 | Balance between MiniLM-L6 and mpnet. |

The dimension must be fixed before generating the first embedding. Changing it later requires re-generating all embeddings and recreating the vector column.

### 5.3 Vector Index

```sql

-- Enable approximate nearest neighbour search (optional, add if needed for performance)

CREATE INDEX media_embedding_hnsw_idx

ON "MediaEmbedding"

USING hnsw (embedding vector_cosine_ops)

WITH (m = 16, ef_construction = 64);

```

For typical catalogue sizes (< 50,000 items), exact nearest neighbour search via pgvector is likely sufficient. Add the HNSW index only after measuring query latency.

---

## 6. Open Database Decisions

| ID | Decision | Status | Impact |

| ---------------------------- | ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------ |

| TD-04 | Prisma + pgvector interaction pattern | **Resolved** | Resolved via `VectorRepository` and parameterized `$queryRaw`. |

| TD-08 | Sentence Transformers model (embedding dimension) | **Open** | Must be decided before Phase 5 migrations. Changes later require re-embedding. |

| Rating scale | 1–10 integer vs. 1–10 with 0.5 increments | **Open** | Affects `PersonalRating.rating` type and UI |

| Episode tracking granularity | Whether to track per-episode watch timestamps or only current position | **Open** | Affects `WatchProgress` schema |

| Season ratings | Optional. Decide before implementing library tracking. | **Open** | May add complexity to `PersonalRating` |

---

## 7. Data Integrity Rules

1. **Catalogue data is append-safe.** Existing catalogue records may be updated when re-synced from TMDB, but internal `id` values never change.

2. **Personal records are never deleted without explicit user action.** Library entries, ratings, and reviews must survive re-imports and algorithm changes.

3. **Recommendation records are immutable.** A `RecommendationRecord` once created is never modified. Outcomes (`watched`, `personalRating`) are updated, but the original scores and reasons are preserved.

4. **Import transactions are atomic.** An import that fails partway through must be fully rolled back. No partial state is permitted.

5. **Referential integrity is enforced at the database level.** Foreign key constraints are enabled. Cascade deletes are used only where semantically appropriate (e.g., deleting a library entry cascades to its watch progress and review).
