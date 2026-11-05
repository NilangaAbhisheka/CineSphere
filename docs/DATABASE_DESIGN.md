# CineSphere — Database Design

**Status:** Proposed / Pre-Implementation  
**Last Updated:** 2026-11-05  
**Version:** 1.0

> This is a proposed logical database design. No migrations have been created yet. The schema will be implemented incrementally, starting in Phase 1–2. Treat this document as the design specification, not an implementation record.

---

## 1. Design Principles

1. **Separate catalogue data from personal data.** The catalogue (movies, TV shows, seasons, episodes, genres, etc.) is shared reference data fetched from TMDB. Personal data (library entries, ratings, reviews, recommendation history) belongs exclusively to the user. This separation makes hosted demo anonymization straightforward.

2. **Never overwrite personal history.** Ratings, library entries, recommendation records, and feedback are append-friendly. Historical records must survive algorithm changes or re-imports.

3. **Vector columns are isolated.** pgvector `vector` columns are stored in a dedicated table (`MediaEmbedding`) rather than embedded in the main media table. This keeps the schema clean and allows Prisma to manage non-vector columns while raw SQL handles vector operations.

4. **Avoid premature normalization.** Tables exist to serve documented use cases. Do not create a table unless there is a clear reason for it.

5. **Indexing is planned at design time.** Performance-relevant columns are identified here and implemented when the schema is migrated.

---

## 2. Entity Overview

| Entity                     | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `User`                     | Single application user. Single row for local mode.                  |
| `Media`                    | Polymorphic base for movies and TV shows. Shared catalogue metadata. |
| `Movie`                    | Movie-specific metadata (runtime, release date, etc.).               |
| `TvShow`                   | TV-show-specific metadata (network, number of seasons, etc.).        |
| `Season`                   | A season within a TV show.                                           |
| `Episode`                  | A single episode within a season.                                    |
| `Genre`                    | Reference table for TMDB genres.                                     |
| `Keyword`                  | Reference table for TMDB keywords.                                   |
| `Person`                   | Cast and crew members.                                               |
| `MediaGenre`               | Join: media ↔ genre.                                                 |
| `MediaKeyword`             | Join: media ↔ keyword.                                               |
| `MediaCast`                | Join: media ↔ person with role/character.                            |
| `UserLibraryEntry`         | A user's relationship with a media item (status, dates).             |
| `WatchProgress`            | TV episode tracking for a library entry.                             |
| `PersonalRating`           | A user's numeric rating for a media item or season.                  |
| `Review`                   | Optional text review or notes for a library entry.                   |
| `RewatchRecord`            | Tracks individual rewatch events for movies.                         |
| `MediaEmbedding`           | Semantic embedding vector for a media item (pgvector).               |
| `MediaSimilarity`          | Precomputed cosine similarity neighbours.                            |
| `ClusterAssignment`        | HDBSCAN cluster assignment and UMAP 2D coordinates.                  |
| `Cluster`                  | Cluster metadata (label, description, colour).                       |
| `RecommendationRecord`     | A single recommendation shown to the user.                           |
| `RecommendationImpression` | Record that a recommendation was displayed.                          |
| `RecommendationFeedback`   | User feedback on a recommendation.                                   |
| `TasteProfile`             | Current structured taste profile.                                    |
| `TasteProfileSnapshot`     | Historical snapshots of the taste profile.                           |
| `UserPreference`           | Application and recommendation settings.                             |

---

## 3. Entity Specifications

### 3.1 User

**Purpose:** Represents the single application user. Exists primarily as a foreign key anchor for all personal data. In local mode, one row is created on first run.

| Field         | Type           | Notes                 |
| ------------- | -------------- | --------------------- |
| `id`          | `UUID` PK      |                       |
| `displayName` | `VARCHAR(100)` | Optional display name |
| `createdAt`   | `TIMESTAMPTZ`  |                       |
| `updatedAt`   | `TIMESTAMPTZ`  |                       |

**Notes:** Multi-user support is not planned. This table simplifies the data model for a possible future extension and keeps personal data clearly separated from catalogue data.

---

### 3.2 Media

**Purpose:** The polymorphic base record for both movies and TV shows. Contains shared attributes sourced from TMDB.

| Field              | Type                  | Notes                                         |
| ------------------ | --------------------- | --------------------------------------------- |
| `id`               | `UUID` PK             | Internal ID                                   |
| `tmdbId`           | `INTEGER`             | TMDB ID. Unique per media type.               |
| `mediaType`        | `ENUM('movie', 'tv')` | Discriminator                                 |
| `title`            | `VARCHAR(500)`        | Display title                                 |
| `originalTitle`    | `VARCHAR(500)`        | Original-language title                       |
| `overview`         | `TEXT`                | Description / synopsis                        |
| `posterPath`       | `VARCHAR(500)`        | TMDB poster path                              |
| `backdropPath`     | `VARCHAR(500)`        | TMDB backdrop path                            |
| `language`         | `VARCHAR(10)`         | ISO 639-1 language code                       |
| `adult`            | `BOOLEAN`             | TMDB adult content flag                       |
| `popularity`       | `FLOAT`               | TMDB popularity score                         |
| `voteAverage`      | `FLOAT`               | TMDB average rating                           |
| `voteCount`        | `INTEGER`             | TMDB vote count                               |
| `tmdbLastSyncedAt` | `TIMESTAMPTZ`         | Last time this record was refreshed from TMDB |
| `createdAt`        | `TIMESTAMPTZ`         |                                               |
| `updatedAt`        | `TIMESTAMPTZ`         |                                               |

**Constraints:**

- `UNIQUE(tmdbId, mediaType)` — no duplicate TMDB entries per type.

**Indexes:**

- `(tmdbId, mediaType)` — primary lookup pattern.
- `title` — text search (consider `tsvector` column for full-text search).
- `mediaType` — filter by type.
- `popularity DESC` — sorting for trending/popular lists.

---

### 3.3 Movie

**Purpose:** Movie-specific metadata. One-to-one with a `Media` record of type `movie`.

| Field         | Type                        | Notes                                  |
| ------------- | --------------------------- | -------------------------------------- |
| `id`          | `UUID` PK = FK → `Media.id` |                                        |
| `releaseDate` | `DATE`                      |                                        |
| `runtime`     | `INTEGER`                   | Minutes                                |
| `budget`      | `BIGINT`                    | TMDB budget (may be 0 if unknown)      |
| `revenue`     | `BIGINT`                    | TMDB revenue (may be 0 if unknown)     |
| `status`      | `VARCHAR(50)`               | TMDB release status (e.g., "Released") |
| `tagline`     | `TEXT`                      |                                        |
| `imdbId`      | `VARCHAR(20)`               | IMDb ID if available                   |

**Relationships:** `Movie` ← `Media` (1:1, PK is shared)

---

### 3.4 TvShow

**Purpose:** TV-show-specific metadata. One-to-one with a `Media` record of type `tv`.

| Field              | Type                        | Notes                              |
| ------------------ | --------------------------- | ---------------------------------- |
| `id`               | `UUID` PK = FK → `Media.id` |                                    |
| `firstAirDate`     | `DATE`                      |                                    |
| `lastAirDate`      | `DATE`                      | Null if still airing               |
| `numberOfSeasons`  | `INTEGER`                   |                                    |
| `numberOfEpisodes` | `INTEGER`                   |                                    |
| `status`           | `VARCHAR(50)`               | e.g., "Ended", "Returning Series"  |
| `network`          | `VARCHAR(200)`              | Primary network/streaming service  |
| `episodeRuntime`   | `INTEGER`                   | Typical episode runtime in minutes |

---

### 3.5 Season

**Purpose:** A season within a TV show.

| Field          | Type                    | Notes               |
| -------------- | ----------------------- | ------------------- |
| `id`           | `UUID` PK               |                     |
| `tvShowId`     | `UUID` FK → `TvShow.id` |                     |
| `tmdbId`       | `INTEGER`               | TMDB season ID      |
| `seasonNumber` | `INTEGER`               | Season 0 = Specials |
| `name`         | `VARCHAR(200)`          |                     |
| `overview`     | `TEXT`                  |                     |
| `airDate`      | `DATE`                  |                     |
| `episodeCount` | `INTEGER`               |                     |
| `posterPath`   | `VARCHAR(500)`          |                     |

**Constraints:** `UNIQUE(tvShowId, seasonNumber)`

---

### 3.6 Episode

**Purpose:** A single episode. Stored when needed (on-demand from TMDB), not pre-populated for all shows.

| Field           | Type                    | Notes   |
| --------------- | ----------------------- | ------- |
| `id`            | `UUID` PK               |         |
| `seasonId`      | `UUID` FK → `Season.id` |         |
| `tmdbId`        | `INTEGER`               |         |
| `episodeNumber` | `INTEGER`               |         |
| `name`          | `VARCHAR(300)`          |         |
| `overview`      | `TEXT`                  |         |
| `airDate`       | `DATE`                  |         |
| `runtime`       | `INTEGER`               | Minutes |
| `stillPath`     | `VARCHAR(500)`          |         |

**Constraints:** `UNIQUE(seasonId, episodeNumber)`

---

### 3.7 Genre

**Purpose:** Reference table for TMDB genre definitions. Shared by movies and TV shows.

| Field       | Type                          | Notes                         |
| ----------- | ----------------------------- | ----------------------------- |
| `id`        | `INTEGER` PK                  | TMDB genre ID                 |
| `name`      | `VARCHAR(100)`                |                               |
| `mediaType` | `ENUM('movie', 'tv', 'both')` | TMDB genres are type-specific |

---

### 3.8 Keyword

**Purpose:** Reference table for TMDB keyword tags associated with media items.

| Field  | Type           | Notes           |
| ------ | -------------- | --------------- |
| `id`   | `INTEGER` PK   | TMDB keyword ID |
| `name` | `VARCHAR(200)` |                 |

---

### 3.9 Person

**Purpose:** Cast and crew members referenced across catalogue items.

| Field                | Type             | Notes                       |
| -------------------- | ---------------- | --------------------------- |
| `id`                 | `UUID` PK        |                             |
| `tmdbId`             | `INTEGER` UNIQUE |                             |
| `name`               | `VARCHAR(200)`   |                             |
| `profilePath`        | `VARCHAR(500)`   |                             |
| `knownForDepartment` | `VARCHAR(100)`   | e.g., "Acting", "Directing" |

---

### 3.10 Join Tables: MediaGenre, MediaKeyword, MediaCast

**MediaGenre**

| Field     | Type                      | Notes |
| --------- | ------------------------- | ----- |
| `mediaId` | `UUID` FK → `Media.id`    |       |
| `genreId` | `INTEGER` FK → `Genre.id` |       |

PK: `(mediaId, genreId)`

**MediaKeyword**

| Field       | Type                        | Notes |
| ----------- | --------------------------- | ----- |
| `mediaId`   | `UUID` FK → `Media.id`      |       |
| `keywordId` | `INTEGER` FK → `Keyword.id` |       |

PK: `(mediaId, keywordId)`

**MediaCast**

| Field        | Type                    | Notes                       |
| ------------ | ----------------------- | --------------------------- |
| `mediaId`    | `UUID` FK → `Media.id`  |                             |
| `personId`   | `UUID` FK → `Person.id` |                             |
| `character`  | `VARCHAR(300)`          | Character name              |
| `department` | `VARCHAR(100)`          | "Acting", "Directing", etc. |
| `job`        | `VARCHAR(100)`          | Specific job title          |
| `order`      | `INTEGER`               | Credit order for sorting    |

PK: `(mediaId, personId, department, job)`

---

### 3.11 UserLibraryEntry

**Purpose:** The user's relationship with a specific media item. The core personal data record.

| Field         | Type                                                        | Notes                                        |
| ------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `id`          | `UUID` PK                                                   |                                              |
| `userId`      | `UUID` FK → `User.id`                                       |                                              |
| `mediaId`     | `UUID` FK → `Media.id`                                      |                                              |
| `status`      | `ENUM('watching', 'completed', 'plan_to_watch', 'dropped')` |                                              |
| `addedAt`     | `TIMESTAMPTZ`                                               | When the entry was added to the library      |
| `startedAt`   | `TIMESTAMPTZ`                                               | When the user started watching (nullable)    |
| `completedAt` | `TIMESTAMPTZ`                                               | When the user marked as completed (nullable) |
| `updatedAt`   | `TIMESTAMPTZ`                                               |                                              |

**Constraints:** `UNIQUE(userId, mediaId)` — one entry per user per media item.

**Indexes:**

- `(userId, status)` — library list filtering.
- `(userId, updatedAt DESC)` — recently updated items.
- `mediaId` — reverse lookup.

---

### 3.12 WatchProgress

**Purpose:** Tracks TV show episode progress for a library entry. Updated as the user advances through episodes.

| Field                  | Type                              | Notes |
| ---------------------- | --------------------------------- | ----- |
| `id`                   | `UUID` PK                         |       |
| `libraryEntryId`       | `UUID` FK → `UserLibraryEntry.id` |       |
| `currentSeasonNumber`  | `INTEGER`                         |       |
| `currentEpisodeNumber` | `INTEGER`                         |       |
| `lastWatchedAt`        | `TIMESTAMPTZ`                     |       |
| `updatedAt`            | `TIMESTAMPTZ`                     |       |

**Relationship:** One-to-one with `UserLibraryEntry` (only for TV shows).

---

### 3.13 PersonalRating

**Purpose:** The user's numeric rating for a media item or for a specific season.

| Field       | Type                    | Notes                                                  |
| ----------- | ----------------------- | ------------------------------------------------------ |
| `id`        | `UUID` PK               |                                                        |
| `userId`    | `UUID` FK → `User.id`   |                                                        |
| `mediaId`   | `UUID` FK → `Media.id`  | Nullable if rating is for a season                     |
| `seasonId`  | `UUID` FK → `Season.id` | Nullable if rating is for the full media item          |
| `rating`    | `DECIMAL(3,1)`          | Range: 1.0–10.0 (to be confirmed per TD-05 equivalent) |
| `ratedAt`   | `TIMESTAMPTZ`           |                                                        |
| `updatedAt` | `TIMESTAMPTZ`           |                                                        |

**Constraints:** `UNIQUE(userId, mediaId)` for overall ratings; `UNIQUE(userId, seasonId)` for season ratings.

> **Open decision:** Rating scale (1–10 with 0.5 steps vs. 1–10 integer). Decide before implementing. Document in `tasks.md`.

---

### 3.14 Review

**Purpose:** Optional text review or private notes for a library entry.

| Field              | Type                                     | Notes                |
| ------------------ | ---------------------------------------- | -------------------- |
| `id`               | `UUID` PK                                |                      |
| `libraryEntryId`   | `UUID` FK → `UserLibraryEntry.id` UNIQUE | One review per entry |
| `content`          | `TEXT`                                   | Freeform text        |
| `containsSpoilers` | `BOOLEAN`                                | User-flagged         |
| `createdAt`        | `TIMESTAMPTZ`                            |                      |
| `updatedAt`        | `TIMESTAMPTZ`                            |                      |

---

### 3.15 RewatchRecord

**Purpose:** Tracks individual rewatch events for a movie (not a rewatch counter).

| Field            | Type                              | Notes                           |
| ---------------- | --------------------------------- | ------------------------------- |
| `id`             | `UUID` PK                         |                                 |
| `libraryEntryId` | `UUID` FK → `UserLibraryEntry.id` |                                 |
| `watchedAt`      | `DATE`                            | Date of the rewatch             |
| `notes`          | `TEXT`                            | Optional notes for this rewatch |

---

### 3.16 MediaEmbedding

**Purpose:** Stores the semantic embedding vector for a media item. Separated from the main `Media` table to isolate pgvector column handling and keep Prisma schema clean.

| Field         | Type                          | Notes                                                          |
| ------------- | ----------------------------- | -------------------------------------------------------------- |
| `id`          | `UUID` PK                     |                                                                |
| `mediaId`     | `UUID` FK → `Media.id` UNIQUE |                                                                |
| `embedding`   | `vector(N)`                   | pgvector type. Dimension N = model-dependent (see TD-08)       |
| `modelId`     | `VARCHAR(100)`                | Identifier for the embedding model used                        |
| `contentHash` | `VARCHAR(64)`                 | Hash of the input content. Detect when re-embedding is needed. |
| `generatedAt` | `TIMESTAMPTZ`                 |                                                                |

**pgvector index:** `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` — enable if cosine search latency becomes a concern at scale.

> **Important:** This table is not managed by Prisma migrations in the standard way due to the `vector` type. The pgvector column and index are created via raw SQL in a migration script. Prisma maps to this table with a typed raw SQL accessor. See TD-04.

---

### 3.17 MediaSimilarity

**Purpose:** Precomputed top-N cosine similarity neighbours for each media item. Avoids full table scans for similarity lookups.

| Field              | Type                   | Notes                             |
| ------------------ | ---------------------- | --------------------------------- |
| `id`               | `UUID` PK              |                                   |
| `sourceMediaId`    | `UUID` FK → `Media.id` |                                   |
| `targetMediaId`    | `UUID` FK → `Media.id` |                                   |
| `cosineSimilarity` | `FLOAT`                | Cosine similarity score (0–1)     |
| `rank`             | `INTEGER`              | Neighbour rank (1 = most similar) |
| `computedAt`       | `TIMESTAMPTZ`          |                                   |

**Constraints:** `UNIQUE(sourceMediaId, targetMediaId)`

**Indexes:**

- `(sourceMediaId, rank)` — primary query pattern (fetch top-N neighbours for an item).

---

### 3.18 ClusterAssignment

**Purpose:** HDBSCAN cluster assignment and UMAP 2D coordinates for visualization.

| Field        | Type                          | Notes                                   |
| ------------ | ----------------------------- | --------------------------------------- |
| `id`         | `UUID` PK                     |                                         |
| `mediaId`    | `UUID` FK → `Media.id` UNIQUE |                                         |
| `clusterId`  | `UUID` FK → `Cluster.id`      | Nullable if HDBSCAN marks as noise (-1) |
| `umapX`      | `FLOAT`                       | 2D visualization coordinate only        |
| `umapY`      | `FLOAT`                       | 2D visualization coordinate only        |
| `computedAt` | `TIMESTAMPTZ`                 |                                         |

> **Critical constraint:** `umapX` and `umapY` are visualization coordinates only. They must never be used for similarity search, nearest-neighbour computation, or clustering. The original embedding in `MediaEmbedding` is the semantic source of truth.

---

### 3.19 Cluster

**Purpose:** Metadata for a HDBSCAN-identified cluster of media items.

| Field         | Type           | Notes                                                 |
| ------------- | -------------- | ----------------------------------------------------- |
| `id`          | `UUID` PK      |                                                       |
| `label`       | `VARCHAR(200)` | Human-readable cluster label                          |
| `description` | `TEXT`         | Cluster description (keyword-derived or LLM-assisted) |
| `colour`      | `VARCHAR(7)`   | Hex colour for visualization                          |
| `itemCount`   | `INTEGER`      | Cached count of items in cluster                      |
| `computedAt`  | `TIMESTAMPTZ`  | When this cluster was generated                       |

---

### 3.20 RecommendationRecord

**Purpose:** A single recommendation generated for the user. Records are immutable after creation — historical records are preserved even when the algorithm changes.

| Field              | Type                                       | Notes                                                        |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| `id`               | `UUID` PK                                  |                                                              |
| `userId`           | `UUID` FK → `User.id`                      |                                                              |
| `mediaId`          | `UUID` FK → `Media.id`                     | The recommended item                                         |
| `generatedAt`      | `TIMESTAMPTZ`                              |                                                              |
| `algorithmVersion` | `VARCHAR(50)`                              | Version tag for the scoring algorithm used                   |
| `totalScore`       | `FLOAT`                                    | Final composite score                                        |
| `scoreS`           | `FLOAT`                                    | Semantic similarity component                                |
| `scoreP`           | `FLOAT`                                    | Preference match component                                   |
| `scoreM`           | `FLOAT`                                    | Mood match component                                         |
| `scoreQ`           | `FLOAT`                                    | Quality signal component                                     |
| `scoreN`           | `FLOAT`                                    | Novelty component                                            |
| `reason`           | `TEXT`                                     | Human-readable explanation of the recommendation             |
| `diversityMode`    | `ENUM('safe', 'balanced', 'experimental')` | Diversity mode active when generated                         |
| `source`           | `VARCHAR(100)`                             | Recommendation source (e.g., "content_based", "hidden_gems") |
| `addedToLibrary`   | `BOOLEAN`                                  | Whether the user added this to their library                 |
| `addedToLibraryAt` | `TIMESTAMPTZ`                              |                                                              |
| `watched`          | `BOOLEAN`                                  | Whether the user eventually watched this                     |
| `watchedAt`        | `TIMESTAMPTZ`                              |                                                              |
| `personalRating`   | `DECIMAL(3,1)`                             | The user's eventual rating, if any                           |

**Indexes:**

- `(userId, generatedAt DESC)` — recommendation history queries.
- `(userId, mediaId)` — check if item has been previously recommended.

---

### 3.21 RecommendationImpression

**Purpose:** Records that a recommendation was actually displayed to the user (impression tracking for evaluation). A recommendation may be generated but not shown immediately.

| Field              | Type                                  | Notes                                           |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| `id`               | `UUID` PK                             |                                                 |
| `recommendationId` | `UUID` FK → `RecommendationRecord.id` |                                                 |
| `shownAt`          | `TIMESTAMPTZ`                         | When the recommendation was shown               |
| `position`         | `INTEGER`                             | Position in the recommendation list (1-indexed) |

---

### 3.22 RecommendationFeedback

**Purpose:** User's structured feedback on a recommendation.

| Field              | Type                                                                                                                      | Notes |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| `id`               | `UUID` PK                                                                                                                 |       |
| `recommendationId` | `UUID` FK → `RecommendationRecord.id`                                                                                     |       |
| `userId`           | `UUID` FK → `User.id`                                                                                                     |       |
| `feedbackType`     | `ENUM('interested', 'not_interested', 'already_watched', 'not_my_type', 'watched_and_loved', 'watched_and_disappointed')` |       |
| `submittedAt`      | `TIMESTAMPTZ`                                                                                                             |       |

**Important:** `already_watched` is not a negative signal. The recommendation engine must handle this feedback type correctly — it means the item should be removed from future recommendation candidates, but no negative preference adjustment should occur.

---

### 3.23 TasteProfile

**Purpose:** The current structured taste profile for the user. A single live record, updated when the profile is regenerated.

| Field                      | Type                         | Notes                                                                   |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `id`                       | `UUID` PK                    |                                                                         |
| `userId`                   | `UUID` FK → `User.id` UNIQUE | One profile per user                                                    |
| `preferredGenres`          | `JSONB`                      | `[{genre: string, weight: float}]`                                      |
| `avoidedGenres`            | `JSONB`                      | `[{genre: string, weight: float}]`                                      |
| `preferredThemes`          | `JSONB`                      | `[{theme: string, weight: float}]`                                      |
| `preferredTones`           | `JSONB`                      | `[{tone: string, weight: float}]`                                       |
| `preferredNarrativeStyles` | `JSONB`                      | `[{style: string, weight: float}]`                                      |
| `preferredCharacterTypes`  | `JSONB`                      | `[{type: string, weight: float}]`                                       |
| `positiveSignals`          | `JSONB`                      | Structured positive preference signals                                  |
| `negativeSignals`          | `JSONB`                      | Structured negative preference signals                                  |
| `confidenceScore`          | `FLOAT`                      | 0–1: how confident the system is in this profile (based on data volume) |
| `narrativeDescription`     | `TEXT`                       | Optional LLM-generated prose description                                |
| `generatedAt`              | `TIMESTAMPTZ`                |                                                                         |
| `algorithmVersion`         | `VARCHAR(50)`                |                                                                         |

---

### 3.24 TasteProfileSnapshot

**Purpose:** Historical snapshots of the taste profile for Taste Evolution tracking.

| Field            | Type                  | Notes                                                        |
| ---------------- | --------------------- | ------------------------------------------------------------ |
| `id`             | `UUID` PK             |                                                              |
| `userId`         | `UUID` FK → `User.id` |                                                              |
| `profileData`    | `JSONB`               | Full snapshot of `TasteProfile` fields at this point in time |
| `snapshotReason` | `VARCHAR(100)`        | e.g., "periodic", "significant_change", "manual"             |
| `libraryCount`   | `INTEGER`             | Library size at snapshot time (for data-sufficiency context) |
| `createdAt`      | `TIMESTAMPTZ`         |                                                              |

---

### 3.25 UserPreference

**Purpose:** Application and recommendation settings for the user.

| Field                         | Type                                       | Notes                                  |
| ----------------------------- | ------------------------------------------ | -------------------------------------- |
| `id`                          | `UUID` PK                                  |                                        |
| `userId`                      | `UUID` FK → `User.id` UNIQUE               |                                        |
| `recommendationDiversityMode` | `ENUM('safe', 'balanced', 'experimental')` | Default: `balanced`                    |
| `defaultMediaType`            | `ENUM('movie', 'tv', 'both')`              | Filter preference                      |
| `ollamaEnabled`               | `BOOLEAN`                                  | Whether the user has enabled local LLM |
| `ollamaModel`                 | `VARCHAR(100)`                             | Selected Ollama model                  |
| `ollamaBaseUrl`               | `VARCHAR(300)`                             | Ollama API URL                         |
| `theme`                       | `ENUM('light', 'dark', 'system')`          | UI theme                               |
| `updatedAt`                   | `TIMESTAMPTZ`                              |                                        |

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

| Model               | Dimension | Notes                                      |
| ------------------- | --------- | ------------------------------------------ |
| `all-MiniLM-L6-v2`  | 384       | Fast, smaller model. Good for prototyping. |
| `all-mpnet-base-v2` | 768       | Higher quality. Slower to generate.        |
| `all-MiniLM-L12-v2` | 384       | Balance between MiniLM-L6 and mpnet.       |

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

| ID                           | Decision                                                               | Status       | Impact                                                                         |
| ---------------------------- | ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| TD-04                        | Prisma + pgvector interaction pattern                                  | **Resolved** | Resolved via `VectorRepository` and parameterized `$queryRaw`.                 |
| TD-08                        | Sentence Transformers model (embedding dimension)                      | **Open**     | Must be decided before Phase 5 migrations. Changes later require re-embedding. |
| Rating scale                 | 1–10 integer vs. 1–10 with 0.5 increments                              | **Open**     | Affects `PersonalRating.rating` type and UI                                    |
| Episode tracking granularity | Whether to track per-episode watch timestamps or only current position | **Open**     | Affects `WatchProgress` schema                                                 |
| Season ratings               | Optional. Decide before implementing library tracking.                 | **Open**     | May add complexity to `PersonalRating`                                         |

---

## 7. Data Integrity Rules

1. **Catalogue data is append-safe.** Existing catalogue records may be updated when re-synced from TMDB, but internal `id` values never change.
2. **Personal records are never deleted without explicit user action.** Library entries, ratings, and reviews must survive re-imports and algorithm changes.
3. **Recommendation records are immutable.** A `RecommendationRecord` once created is never modified. Outcomes (`watched`, `personalRating`) are updated, but the original scores and reasons are preserved.
4. **Import transactions are atomic.** An import that fails partway through must be fully rolled back. No partial state is permitted.
5. **Referential integrity is enforced at the database level.** Foreign key constraints are enabled. Cascade deletes are used only where semantically appropriate (e.g., deleting a library entry cascades to its watch progress and review).
