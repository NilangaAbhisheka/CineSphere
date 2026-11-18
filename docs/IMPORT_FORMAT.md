# CineSphere — Data Import & Export Format Reference

This document defines the supported data import and export formats, transactional semantics, schema contracts, and round-trip fidelity guarantees for CineSphere Stage 4.4 and Stage 4.5.

---

## Overview

CineSphere provides symmetric import and export capabilities across two formats:

| Format | Import Endpoint         | Export Endpoint        | Size Limit / Scope | Fidelity                          |
| ------ | ----------------------- | ---------------------- | ------------------ | --------------------------------- |
| JSON   | `POST /api/import/json` | `GET /api/export/json` | 5 MB Import / Full | Full (entries, history, progress) |
| CSV    | `POST /api/import/csv`  | `GET /api/export/csv`  | 2 MB Import / Flat | Flat (6 core library fields only) |

**Use JSON for complete backups.** CSV is a convenience format for simple library exports, external spreadsheet inspection, and basic library restoration.

---

## Import Behaviour

### Atomicity

Import execution proceeds in two distinct phases with different transactional guarantees:

**Phase 1 — Catalogue Ingestion (non-transactional, idempotent):**
If an imported entry references a movie or TV show not yet in the local CineSphere catalogue, that item is fetched from TMDB and inserted into the shared catalogue before the personal tracking transaction begins. These catalogue writes are:

- Performed outside the personal tracking transaction
- Idempotent — the same title can be fetched multiple times without side effects
- **Permanent** — catalogue additions remain even if the subsequent personal tracking transaction rolls back

If TMDB cannot resolve a referenced title (invalid ID or API error), the import is aborted before any personal data is written.

**Phase 2 — Personal Tracking Transaction (`READ COMMITTED`, atomic):**
All personal tracking records (library entries, viewing events, episode progress, season ratings) are written inside a single `READ COMMITTED` database transaction. If any write fails, **the entire transaction is rolled back** and your existing library data is left completely unchanged. No partial personal tracking data is ever persisted on failure.

> **Summary:** Catalogue metadata additions from Phase 1 are not rolled back when Phase 2 fails. Personal tracking data from Phase 2 is strictly all-or-nothing.

### Validation & Execution Lifecycle

Import processing executes in clearly delineated stages, distinguishing between in-memory structural validation, shared catalogue resolution, and user personal tracking persistence:

1. **Syntactic & Schema Validation (Pre-Database):**  
   The uploaded file structure is validated in memory before any database write. For JSON, document structure, media types, status enums, 1.0–10.0 half-step rating increments, strict ISO 8601 datetimes with explicit timezones, and intra-file duplicate entries (`mediaType` + `tmdbId`) are verified. For CSV, RFC 4180 compliance, header correctness, row delimiters, and field formats are validated. If any syntactic or schema check fails, the import fails immediately with accumulated error diagnostics, and **zero database writes** occur.

2. **Phase 1 — Catalogue Resolution & Ingestion (Outside Transaction, Idempotent):**  
   Before personal tracking records can be linked to specific catalogue entities, referenced movies and TV shows must exist in the CineSphere catalogue. If an imported entry references a title not yet present in the local database, it is fetched on-demand from TMDB and persisted into shared catalogue tables (`movies`, `tv_shows`, `seasons`, `episodes`). These writes occur outside the personal tracking transaction and are idempotent and permanent catalogue assets. If TMDB resolution fails (e.g. unknown TMDB ID or TMDB API failure), processing stops before any personal tracking records are written.

3. **Phase 1b — Catalogue-Dependent Reference Validation:**  
   Once catalogue resolution is complete, all nested references (`episodeProgress[].episodeTmdbId`, `seasonRatings[].seasonTmdbId`) are validated against the local catalogue to confirm that each referenced episode and season actually exists and belongs specifically to the imported TV show. If any reference is missing or belongs to a different show, the entire import is rejected with structured errors identifying the invalid entry and field. No personal tracking data is created.

4. **Phase 2 — Personal Tracking Transaction (`READ COMMITTED`, Atomic):**  
   Existing library entries for the user are identified; existing titles are **skipped** (not overwritten). All new personal tracking records (`UserLibraryEntry`, `ViewingEvent`, `EpisodeProgress`, `SeasonRating`) are then persisted within a single atomic Prisma interactive transaction (`READ COMMITTED`). If any write fails, **the entire personal tracking transaction is rolled back**, ensuring zero partial or corrupted tracking records.

> **Summary:** Catalogue metadata additions from Phase 1 are permanent shared assets and are not rolled back when Phase 2 fails. Personal tracking data from Phase 2 is strictly atomic and all-or-nothing.

### Duplicate Handling

- Entries that already exist in your library (matched by `mediaType` + TMDB ID) are **skipped**,
  not overwritten. The import result reports how many were skipped.
- Duplicate entries within the same import file (same `mediaType` + `tmdbId` appearing more than
  once) are **rejected** as a validation error — the entire import fails.

### TMDB Catalogue Resolution

If an imported entry refers to a movie or TV show that is not yet in the local CineSphere
catalogue, it is ingested on-demand from TMDB before the personal tracking transaction begins.

If TMDB cannot resolve a referenced item (invalid ID, API error), the import fails with a clear
error message. No incomplete catalogue records are created.

### Single-User Ownership

Imports are always associated with the system's single user via `SingleUserBootstrap`. The API
never accepts a client-supplied user ID.

---

## JSON Format (v1.0)

JSON is the canonical format and supports full tracking data fidelity.

### Schema

```json
{
  "version": "1.0",
  "exportedAt": "2026-11-17T10:00:00.000Z",
  "entries": [
    {
      "tmdbId": 550,
      "mediaType": "MOVIE",
      "status": "COMPLETED",
      "personalRating": 8.5,
      "notes": "One of my favourites",
      "createdAt": "2023-01-15T10:00:00.000Z",
      "viewingEvents": [
        {
          "watchedAt": "2023-01-15T20:00:00.000Z",
          "rating": 8.5,
          "notes": "First viewing"
        }
      ]
    },
    {
      "tmdbId": 1399,
      "mediaType": "TV",
      "status": "COMPLETED",
      "personalRating": 9.0,
      "notes": "Brilliant series",
      "episodeProgress": [
        {
          "episodeTmdbId": 63056,
          "watchedAt": "2023-01-01T20:00:00.000Z"
        }
      ],
      "seasonRatings": [
        {
          "seasonTmdbId": 3624,
          "rating": 9.0
        }
      ]
    }
  ]
}
```

### Field Reference

#### Root Object

| Field        | Type   | Required | Description                                   |
| ------------ | ------ | -------- | --------------------------------------------- |
| `version`    | string | Yes      | Must be `"1.0"`                               |
| `exportedAt` | string | No       | ISO 8601 datetime (informational only)        |
| `entries`    | array  | Yes      | Array of library entry objects (may be empty) |

#### Entry Object

| Field             | Type    | Required | Description                                                                                                |
| ----------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `tmdbId`          | integer | Yes      | TMDB ID of the movie or TV show (must be a positive integer)                                               |
| `mediaType`       | string  | Yes      | `"MOVIE"` or `"TV"` (case-insensitive)                                                                     |
| `status`          | string  | Yes      | See [Status Values](#status-values)                                                                        |
| `personalRating`  | number  | No       | 1.0–10.0 in 0.5 increments (e.g. `7.5`, `8.0`, `9.5`)                                                      |
| `notes`           | string  | No       | Personal notes (max 10,000 characters)                                                                     |
| `createdAt`       | string  | No       | ISO 8601 datetime with explicit timezone (e.g. `2023-01-15T10:00:00Z`) for the library entry creation date |
| `viewingEvents`   | array   | No       | Movie only — array of individual viewing occurrences (see below)                                           |
| `episodeProgress` | array   | No       | TV only — array of watched episode records (see below)                                                     |
| `seasonRatings`   | array   | No       | TV only — array of per-season rating records (see below)                                                   |

#### ViewingEvent Object (Movie only)

| Field       | Type   | Required | Description                                                                                                                                                                     |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watchedAt` | string | **Yes**  | ISO 8601 datetime with explicit timezone — `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss±HH:mm`. Date-only strings and strings without a timezone designator are **rejected**. |
| `rating`    | number | No       | 1.0–10.0 in 0.5 increments                                                                                                                                                      |
| `notes`     | string | No       | Notes for this specific viewing                                                                                                                                                 |

#### EpisodeProgress Object (TV only)

| Field           | Type    | Required | Description                                                                                                                                                                                                                                                                                 |
| --------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `episodeTmdbId` | integer | Yes      | TMDB ID of the watched episode                                                                                                                                                                                                                                                              |
| `watchedAt`     | string  | No       | ISO 8601 datetime with explicit timezone — `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss±HH:mm`. If omitted, the episode is marked as watched but no watch timestamp is stored (stored as `null`). Do not omit if you want the watch date to appear in activity statistics and dashboards. |

#### SeasonRating Object (TV only)

| Field          | Type    | Required | Description                 |
| -------------- | ------- | -------- | --------------------------- |
| `seasonTmdbId` | integer | Yes      | TMDB ID of the rated season |
| `rating`       | number  | Yes      | 1.0–10.0 in 0.5 increments  |

---

## CSV Format

CSV supports flat library entries only. Nested data (viewing history, episode progress, season
ratings) are **not supported** — use JSON for those.

### Columns

| Column            | Required | Description                                                                                                                                    |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb_id`         | Yes      | TMDB ID of the movie or TV show (positive integer)                                                                                             |
| `media_type`      | Yes      | `movie` or `tv` (case-insensitive)                                                                                                             |
| `status`          | Yes      | See [Status Values](#status-values) (case-insensitive)                                                                                         |
| `personal_rating` | No       | 1.0–10.0 in 0.5 increments (leave blank if unrated)                                                                                            |
| `notes`           | No       | Personal notes (quote with `"..."` if the notes contain commas or newlines)                                                                    |
| `created_at`      | No       | ISO 8601 datetime with explicit timezone (e.g. `2023-01-15T10:00:00Z` or `2023-01-15T10:00:00+05:30`). Date-only strings are **not** accepted. |

### Example

```csv
tmdb_id,media_type,status,personal_rating,notes,created_at
550,movie,COMPLETED,8.5,Great film,2023-01-15T10:00:00Z
1399,tv,WATCHING,,Still watching,2023-06-01T00:00:00+05:30
680,movie,PLAN_TO_WATCH,,,
```

### Notes

- The header row must be present and must include at minimum `tmdb_id`, `media_type`, `status`.
- Extra columns (beyond the six defined above) are rejected as a validation error.
- Blank values for optional fields are accepted.
- Standard RFC 4180 CSV quoting applies: use `"..."` to enclose values containing commas, double quotes, or embedded newlines; double an internal quote (`""`) to escape it.
- Validation error messages include the **physical CSV line number** where the offending record starts, so multiline quoted fields are accounted for correctly.

---

## Status Values

| Value           | Description               |
| --------------- | ------------------------- |
| `PLAN_TO_WATCH` | Added to watch later list |
| `WATCHING`      | Currently watching        |
| `COMPLETED`     | Finished                  |
| `DROPPED`       | Stopped watching          |

Status values are case-insensitive in both JSON and CSV imports.

---

## API Response

Both endpoints return an `ImportResponse` object:

```json
{
  "success": true,
  "total": 3,
  "imported": 2,
  "skipped": 1,
  "summary": "Imported 2 entries, skipped 1 already in your library.",
  "errors": []
}
```

On validation failure (`success: false`):

```json
{
  "success": false,
  "total": 1,
  "imported": 0,
  "skipped": 0,
  "summary": "Import failed with 1 validation error. No personal tracking data was written.",
  "errors": [
    {
      "index": 0,
      "field": "status",
      "message": "\"status\" must be one of: PLAN_TO_WATCH, WATCHING, COMPLETED, DROPPED."
    }
  ]
}
```

Both endpoints return HTTP `200 OK` with an `ImportResponse` body. Inspect `success` to determine the outcome:

- When `success: true`, `imported` and `skipped` indicate the record counts.
- When `success: false`, `errors` contains the structured list of validation errors.

If the uploaded file is malformed (e.g. invalid JSON syntax), HTTP `400 Bad Request` is returned. If the file exceeds the size limit, HTTP `413 Payload Too Large` is returned.

---

## Data Export (Stage 4.5)

CineSphere provides user-initiated data export endpoints to download personal tracking data for archival, portability, and migration.

### Export Endpoints & Response Headers

- **JSON Export:** `GET /api/export/json`
  - `Content-Type: application/json; charset=utf-8`
  - `Content-Disposition: attachment; filename="cinesphere-export.json"`
  - `Cache-Control: no-store, no-cache, must-revalidate, private`
  - `Pragma: no-cache`
- **CSV Export:** `GET /api/export/csv`
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="cinesphere-export.csv"`
  - `Cache-Control: no-store, no-cache, must-revalidate, private`
  - `Pragma: no-cache`

### Transaction Isolation & Consistent Snapshot

Prisma loads relational models using multiple sequential SQL queries under the hood. Under PostgreSQL's default `READ COMMITTED` level, each sequential query would execute against a different point-in-time snapshot, risking phantom records or inconsistent relational states if concurrent writes occur.

To guarantee that export documents represent a **single, consistent point-in-time snapshot**, `ExportService` executes all read queries inside an interactive transaction with `REPEATABLE READ` isolation:

```typescript
await this.prisma.$transaction(
  async (tx) => {
    return tx.userLibraryEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        movie: true,
        tvShow: true,
        viewingEvents: { orderBy: [{ watchedAt: 'asc' }, { id: 'asc' }] },
        episodeProgress: {
          include: { episode: true },
          orderBy: [
            { episode: { seasonNumber: 'asc' } },
            { episode: { episodeNumber: 'asc' } },
            { episodeId: 'asc' },
          ],
        },
        seasonRatings: {
          include: { season: true },
          orderBy: [{ season: { seasonNumber: 'asc' } }, { seasonId: 'asc' }],
        },
      },
    });
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
);
```

### Zero Silent Data Loss Policy

A data export must never silently discard or truncate personal tracking records.
Because the CineSphere schema permits nullable `tmdbId` on certain catalogue entities, the export pipeline enforces strict integrity checks:

- If any tracked movie, TV show, episode progress record, or season rating refers to an entity where `tmdbId` is missing or the relationship is broken, `ExportService` **immediately aborts the export** by throwing an `InternalServerErrorException` with diagnostic details identifying the corrupted record.
- No partial or incomplete export is ever returned to the user.

### JSON Export Format & Round-Trip Fidelity

The JSON export format matches the `ExportDocument` shared contract and is 100% symmetric with the v1.0 importer:

- Document metadata: `version: "1.0"`, `exportedAt` (ISO 8601 UTC).
- Deterministic ordering: entries ordered by `createdAt ASC, id ASC`; viewing events by `watchedAt ASC, id ASC`; episode progress by `seasonNumber ASC, episodeNumber ASC, episodeId ASC`; season ratings by `seasonNumber ASC, seasonId ASC`.
- Data conversion: Decimal values (`personalRating`) converted to standard JavaScript numbers; null values preserved; nullable timestamps formatted to strict ISO 8601.
- **Round-Trip Fidelity:** Importing a JSON export back into a clean database restores every library entry, viewing event (with rewatch counts and notes), episode progress record, and season rating with exact fidelity.

### CSV Export Format & Explicit Limitations

The CSV export is a flat representation conforming to RFC 4180:

- **Columns (strictly 6):** `tmdb_id,media_type,status,personal_rating,notes,created_at`
- **Line Endings:** RFC 4180 CRLF (`\r\n`).
- **Escaping:** Fields containing commas, double quotes, or newlines are quoted in `""`, with internal double quotes doubled (`""`).
- **Explicit Round-Trip Limitation:** CSV exports contain **only** the 6 core library entry fields. When a CSV export is imported, it restores only the library entries and their personal ratings/notes. It **does not restore** movie viewing events, TV episode progress, or season ratings. The UI and documentation explicitly communicate this limitation so users do not mistake CSV for a full backup.

---

## File Size Limits

| Format | Maximum Size |
| ------ | ------------ |
| JSON   | 5 MB         |
| CSV    | 2 MB         |

Files exceeding these limits are rejected with `413 Payload Too Large`.

---

## Security

- File extensions and MIME types are validated server-side.
- Imported IDs are never used as database primary keys.
- All imported data is associated with the system's single user; client-supplied user IDs are
  ignored.
- Large or malformed files are handled safely (no unsafe parsing or execution).
- Sensitive data is never logged.
