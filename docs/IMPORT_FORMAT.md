# CineSphere — Data Import Format Reference

This document defines the supported import formats for CineSphere Stage 4.4 data import.

---

## Overview

CineSphere supports two import formats:

| Format | Endpoint                | Size Limit | Fidelity                          |
| ------ | ----------------------- | ---------- | --------------------------------- |
| JSON   | `POST /api/import/json` | 5 MB       | Full (entries, history, progress) |
| CSV    | `POST /api/import/csv`  | 2 MB       | Flat (library entries only)       |

**Use JSON for complete backups.** CSV is a convenience format for simple library imports.

---

## Import Behaviour

### Atomicity

Personal tracking records (library entries, viewing events, episode progress, season ratings) are **all-or-nothing**. If any record fails validation or any personal-data database write fails, the entire personal tracking transaction is rolled back and your existing library data is left completely unchanged.

> **Note on TMDB Catalogue Ingestion:** If an import references movies or TV shows not yet present in the local CineSphere catalogue, those catalogue items are fetched from TMDB and ingested into the shared catalogue prior to the personal tracking transaction. These catalogue additions are non-destructive and remain in the shared movie/TV database even if the subsequent personal tracking transaction fails or is rolled back. No partial personal tracking data is ever written on failure.

### Validation

All records are validated before any database write. The API accumulates as many errors as
possible in a single validation pass and returns them all in the response.

### Duplicate Handling

- Entries that already exist in your library (matched by `mediaType` + TMDB ID) are **skipped**,
  not overwritten. The import result reports how many were skipped.
- Duplicate entries within the same import file (same `mediaType` + `tmdbId` appearing more than
  once) are **rejected** as a validation error — the entire import fails.

### TMDB Catalogue Resolution

If an imported entry refers to a movie or TV show that is not yet in the local CineSphere
catalogue, it is ingested on-demand from TMDB before the import transaction begins.

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

| Field             | Type    | Required | Description                                                      |
| ----------------- | ------- | -------- | ---------------------------------------------------------------- |
| `tmdbId`          | integer | Yes      | TMDB ID of the movie or TV show (must be a positive integer)     |
| `mediaType`       | string  | Yes      | `"MOVIE"` or `"TV"` (case-insensitive)                           |
| `status`          | string  | Yes      | See [Status Values](#status-values)                              |
| `personalRating`  | number  | No       | 1.0–10.0 in 0.5 increments (e.g. `7.5`, `8.0`, `9.5`)            |
| `notes`           | string  | No       | Personal notes (max 10,000 characters)                           |
| `createdAt`       | string  | No       | ISO 8601 datetime for the library entry creation date            |
| `viewingEvents`   | array   | No       | Movie only — array of individual viewing occurrences (see below) |
| `episodeProgress` | array   | No       | TV only — array of watched episode records (see below)           |
| `seasonRatings`   | array   | No       | TV only — array of per-season rating records (see below)         |

#### ViewingEvent Object (Movie only)

| Field       | Type   | Required | Description                      |
| ----------- | ------ | -------- | -------------------------------- |
| `watchedAt` | string | Yes      | ISO 8601 datetime of the viewing |
| `rating`    | number | No       | 1.0–10.0 in 0.5 increments       |
| `notes`     | string | No       | Notes for this specific viewing  |

#### EpisodeProgress Object (TV only)

| Field           | Type    | Required | Description                                    |
| --------------- | ------- | -------- | ---------------------------------------------- |
| `episodeTmdbId` | integer | Yes      | TMDB ID of the watched episode                 |
| `watchedAt`     | string  | No       | ISO 8601 datetime when the episode was watched |

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

| Column            | Required | Description                                                             |
| ----------------- | -------- | ----------------------------------------------------------------------- |
| `tmdb_id`         | Yes      | TMDB ID of the movie or TV show (positive integer)                      |
| `media_type`      | Yes      | `movie` or `tv` (case-insensitive)                                      |
| `status`          | Yes      | See [Status Values](#status-values) (case-insensitive)                  |
| `personal_rating` | No       | 1.0–10.0 in 0.5 increments (leave blank if unrated)                     |
| `notes`           | No       | Personal notes (quote with `"..."` if the notes contain commas)         |
| `created_at`      | No       | ISO 8601 date or datetime (e.g. `2023-01-15` or `2023-01-15T10:00:00Z`) |

### Example

```csv
tmdb_id,media_type,status,personal_rating,notes,created_at
550,movie,COMPLETED,8.5,Great film,2023-01-15T10:00:00Z
1399,tv,WATCHING,,Still watching,2023-06-01
680,movie,PLAN_TO_WATCH,,,
```

### Notes

- The header row must be present and must include at minimum `tmdb_id`, `media_type`, `status`.
- Extra columns (beyond the six defined above) are rejected as a validation error.
- Blank values for optional fields are accepted.
- Standard CSV quoting applies: use `"..."` to enclose values containing commas or quotes; double
  an internal quote (`""`) to escape it.

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
