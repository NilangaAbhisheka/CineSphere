"""
ml/benchmark/scripts/prepare_catalogue_fixture.py

Deterministic extraction and preparation script for the CineSphere Stage 5.0
evaluation benchmark dataset (catalogue_snapshot_v1.jsonl).

Authoritative References:
- docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md (Section 8.11)
- docs/stage-5.0-final-corrections-and-dataset-preparation-report.md

Requirements & Invariants:
1. Connects to PostgreSQL using strictly READ-ONLY session mode (no INSERT/UPDATE/DELETE/DDL).
2. Never queries personal library tables (user_library_entries, viewing_events, etc.).
3. Loads and validates probes from ml/benchmark/fixtures/probes_v1.json (50 probes, 5 strata).
   Validates unique probe IDs, unique composite (media_type, tmdb_id), and allowed strata.
4. Dynamically calculates additional quotas:
   additional_movies = target_movies (1,400) - reserved_movie_probes (38) = 1,362
   additional_tv = target_tv (600) - reserved_tv_probes (12) = 588
   Total = 50 probes + 1,950 candidates = 2,000 records.
5. Verifies database contains all 50 probes and sufficient non-empty overviews.
   Fails closed with MissingMandatoryProbesError or InsufficientCatalogueError.
6. Deterministically selects candidates using explicit NULL-handling:
   ORDER BY popularity DESC NULLS LAST, voteCount DESC NULLS LAST, date DESC NULLS LAST, tmdbId ASC.
7. Serializes canonical text with strict null/empty omission policy (Section 8.11).
8. Sorts final 2,000-record dataset strictly by ORDER BY media_type ASC, tmdb_id ASC.
9. Computes SHA-256 over exact output bytes and generates machine-readable manifest.
10. Atomic output generation via temporary files to prevent stale or partial artifacts on failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None


class MissingMandatoryProbesError(Exception):
    """Raised when one or more predefined benchmark probes are missing from the database."""

    pass


class InsufficientCatalogueError(Exception):
    """Raised when the database contains fewer records than required for the benchmark quotas."""

    pass


class InvalidProbeDefinitionError(Exception):
    """Raised when probe definitions violate structural, uniqueness, or quota invariants."""

    pass


DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public",
)

SCRIPT_DIR = Path(__file__).resolve().parent
BENCHMARK_DIR = SCRIPT_DIR.parent
DEFAULT_PROBES_FILE = BENCHMARK_DIR / "fixtures" / "probes_v1.json"
DEFAULT_OUTPUT_DIR = BENCHMARK_DIR / "fixtures"

REQUIRED_MOVIES_TOTAL = 1400
REQUIRED_TV_SHOWS_TOTAL = 600
REQUIRED_PROBES_TOTAL = 50

ALLOWED_MEDIA_TYPES = {"MOVIE", "TV"}
ALLOWED_STRATA = {
    "Mainstream",
    "International",
    "Indie",
    "Serialized TV",
    "Stress Cases",
}

FORBIDDEN_TABLES = {
    "user_library_entries",
    "viewing_events",
    "episode_progress",
    "season_ratings",
    "users",
}


def serialize_canonical_text(
    title: str,
    year: int | None,
    genres: list[str],
    directors: list[str],
    cast: list[str],
    overview: str | None,
    keywords: list[str],
) -> str:
    """
    Serializes metadata into benchmark canonical text format per Section 8.11.

    Format:
    Title: {title}
    Year: {year}
    Genres: {genre1, genre2}
    Directors: {name1, name2}
    Cast: {name1, name2, ...}
    Overview: {overview}
    Keywords: {kw1, kw2}

    Strict null/empty omission policy:
    If a field is null, empty string, or empty list, its entire line is omitted.
    No placeholders like 'None' or 'N/A' are emitted.
    """
    lines: list[str] = []

    clean_title = (title or "").strip()
    if clean_title:
        lines.append(f"Title: {clean_title}")

    if year is not None:
        lines.append(f"Year: {year}")

    clean_genres = [g.strip() for g in genres if g and g.strip()]
    if clean_genres:
        lines.append(f"Genres: {', '.join(clean_genres)}")

    clean_directors = [d.strip() for d in directors if d and d.strip()]
    if clean_directors:
        lines.append(f"Directors: {', '.join(clean_directors)}")

    clean_cast = [c.strip() for c in cast if c and c.strip()]
    if clean_cast:
        lines.append(f"Cast: {', '.join(clean_cast)}")

    clean_overview = (overview or "").strip()
    if clean_overview:
        lines.append(f"Overview: {clean_overview}")

    clean_keywords = [k.strip() for k in keywords if k and k.strip()]
    if clean_keywords:
        lines.append(f"Keywords: {', '.join(clean_keywords)}")

    return "\n".join(lines)


def validate_probes(probes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    """
    Validates structural integrity, uniqueness, strata, and quotas of probe definitions.
    Returns: (validated_probes, reserved_movie_count, reserved_tv_count).
    Raises: InvalidProbeDefinitionError if any invariant is violated.
    """
    if len(probes) != REQUIRED_PROBES_TOTAL:
        raise InvalidProbeDefinitionError(
            f"Expected exactly {REQUIRED_PROBES_TOTAL} probes, but received {len(probes)}."
        )

    seen_probe_ids: set[str] = set()
    seen_composite_keys: set[tuple[str, int]] = set()
    strata_counts: dict[str, int] = {s: 0 for s in ALLOWED_STRATA}
    movie_count = 0
    tv_count = 0

    for idx, p in enumerate(probes):
        probe_id = p.get("probe_id")
        if not probe_id or not isinstance(probe_id, str):
            raise InvalidProbeDefinitionError(f"Probe at index {idx} missing valid 'probe_id'.")
        if probe_id in seen_probe_ids:
            raise InvalidProbeDefinitionError(f"Duplicate probe_id detected: '{probe_id}'.")
        seen_probe_ids.add(probe_id)

        raw_media_type = p.get("media_type")
        if not raw_media_type or not isinstance(raw_media_type, str):
            raise InvalidProbeDefinitionError(f"Probe '{probe_id}' missing valid 'media_type'.")
        media_type = raw_media_type.upper()
        if media_type not in ALLOWED_MEDIA_TYPES:
            raise InvalidProbeDefinitionError(
                f"Probe '{probe_id}' has invalid media_type '{raw_media_type}'. "
                f"Allowed: {ALLOWED_MEDIA_TYPES}."
            )

        tmdb_id = p.get("tmdb_id")
        if not isinstance(tmdb_id, int) or tmdb_id <= 0:
            raise InvalidProbeDefinitionError(
                f"Probe '{probe_id}' has invalid tmdb_id '{tmdb_id}'."
            )

        composite_key = (media_type, tmdb_id)
        if composite_key in seen_composite_keys:
            raise InvalidProbeDefinitionError(
                f"Duplicate composite probe identity detected: {composite_key} "
                f"for probe '{probe_id}'."
            )
        seen_composite_keys.add(composite_key)

        stratum = p.get("stratum")
        if stratum not in ALLOWED_STRATA:
            raise InvalidProbeDefinitionError(
                f"Probe '{probe_id}' has invalid stratum '{stratum}'. Allowed: {ALLOWED_STRATA}."
            )
        strata_counts[stratum] += 1

        if media_type == "MOVIE":
            movie_count += 1
        else:
            tv_count += 1

    # Validate each stratum has at least 1 probe (ideally 10 per stratum for 50 probes)
    for stratum, count in strata_counts.items():
        if count == 0:
            raise InvalidProbeDefinitionError(f"Stratum '{stratum}' has 0 probes.")

    # Validate probe quotas do not exceed target quotas
    if movie_count > REQUIRED_MOVIES_TOTAL:
        raise InvalidProbeDefinitionError(
            f"Movie probes count ({movie_count}) exceeds target movie quota "
            f"({REQUIRED_MOVIES_TOTAL})."
        )
    if tv_count > REQUIRED_TV_SHOWS_TOTAL:
        raise InvalidProbeDefinitionError(
            f"TV probes count ({tv_count}) exceeds target TV quota ({REQUIRED_TV_SHOWS_TOTAL})."
        )

    return probes, movie_count, tv_count


def calculate_additional_quotas(
    reserved_movie_probes: int,
    reserved_tv_probes: int,
    target_movies: int = REQUIRED_MOVIES_TOTAL,
    target_tv: int = REQUIRED_TV_SHOWS_TOTAL,
) -> tuple[int, int]:
    """
    Calculates additional candidate quotas dynamically from targets and reserved probes.
    additional_quota = target_quota - reserved_probe_count

    Validates:
    - Reserved probe count <= target quota
    - Additional quotas >= 0
    - Exact sum equals target total (1400 movies, 600 TV shows, 2000 total)
    """
    if reserved_movie_probes > target_movies:
        raise ValueError(
            f"Reserved movie probes ({reserved_movie_probes}) exceeds target ({target_movies})."
        )
    if reserved_tv_probes > target_tv:
        raise ValueError(f"Reserved TV probes ({reserved_tv_probes}) exceeds target ({target_tv}).")

    additional_movies = target_movies - reserved_movie_probes
    additional_tv = target_tv - reserved_tv_probes

    if additional_movies < 0 or additional_tv < 0:
        raise ValueError("Calculated negative candidate quota.")

    if (reserved_movie_probes + additional_movies) != target_movies:
        raise ValueError("Movie quota arithmetic inconsistency.")

    if (reserved_tv_probes + additional_tv) != target_tv:
        raise ValueError("TV show quota arithmetic inconsistency.")

    if (target_movies + target_tv) != 2000:
        raise ValueError("Total target records must equal exactly 2000.")

    return additional_movies, additional_tv


def load_probes(probes_path: Path) -> list[dict[str, Any]]:
    """Loads and validates the 50 predefined benchmark probes from JSON."""
    if not probes_path.exists():
        raise FileNotFoundError(f"Probes file not found: {probes_path}")

    with open(probes_path, encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        probes = data
    elif isinstance(data, dict):
        probes = data.get("probes", [])
    else:
        raise InvalidProbeDefinitionError(
            f"Unexpected JSON root type in {probes_path}: {type(data)}"
        )

    validated_probes, _, _ = validate_probes(probes)
    return validated_probes


def verify_database_readiness(
    conn: Any,
    probes: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Performs data sufficiency and probe presence verification against PostgreSQL.
    Returns audit statistics dictionary or raises fail-closed exceptions.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # 1. Check movie count with non-empty overview
        cur.execute(
            """
            SELECT
                COUNT(*) as total_movies,
                COUNT(*) FILTER (
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
            ) as movies_with_overview
            FROM movies;
            """
        )
        movie_stats = cur.fetchone()
        total_movies = movie_stats["total_movies"]
        movies_with_overview = movie_stats["movies_with_overview"]

        # 2. Check TV show count with non-empty overview
        cur.execute(
            """
            SELECT
                COUNT(*) as total_tv_shows,
                COUNT(*) FILTER (
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
            ) as tv_shows_with_overview
            FROM tv_shows;
            """
        )
        tv_stats = cur.fetchone()
        total_tv_shows = tv_stats["total_tv_shows"]
        tv_shows_with_overview = tv_stats["tv_shows_with_overview"]

        # 3. Check presence of each probe
        probe_movie_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "MOVIE"]
        probe_tv_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "TV"]

        cur.execute(
            'SELECT "tmdbId" FROM movies WHERE "tmdbId" = ANY(%s);',
            (probe_movie_ids,),
        )
        found_movie_tmdb_ids = {row["tmdbId"] for row in cur.fetchall()}

        cur.execute(
            'SELECT "tmdbId" FROM tv_shows WHERE "tmdbId" = ANY(%s);',
            (probe_tv_ids,),
        )
        found_tv_tmdb_ids = {row["tmdbId"] for row in cur.fetchall()}

        missing_probes = []
        for p in probes:
            media_type = p["media_type"].upper()
            tmdb_id = p["tmdb_id"]
            if media_type == "MOVIE" and tmdb_id not in found_movie_tmdb_ids:
                missing_probes.append(p)
            elif media_type == "TV" and tmdb_id not in found_tv_tmdb_ids:
                missing_probes.append(p)

    return {
        "total_movies": total_movies,
        "movies_with_overview": movies_with_overview,
        "total_tv_shows": total_tv_shows,
        "tv_shows_with_overview": tv_shows_with_overview,
        "probe_movie_ids_count": len(probe_movie_ids),
        "found_probe_movies_count": len(found_movie_tmdb_ids),
        "probe_tv_ids_count": len(probe_tv_ids),
        "found_probe_tv_count": len(found_tv_tmdb_ids),
        "missing_probes": missing_probes,
    }


def _extract_year(val: Any) -> int | None:
    """Helper to safely extract 4-digit year from date, datetime, or ISO string."""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.year
    if isinstance(val, str) and len(val) >= 4 and val[:4].isdigit():
        return int(val[:4])
    return None


def fetch_full_metadata(
    conn: Any,
    movie_tmdb_ids: list[int],
    tv_tmdb_ids: list[int],
    probes_map: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fetches full metadata, genres, keywords, and credits for selected items."""
    records: list[dict[str, Any]] = []

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Fetch Movies
        if movie_tmdb_ids:
            cur.execute(
                """
                SELECT
                    m.id,
                    m."tmdbId",
                    m.title,
                    m.overview,
                    m."releaseDate",
                    m.popularity,
                    m."voteAverage",
                    m."voteCount",
                    COALESCE(
                        (SELECT array_agg(g.name ORDER BY g.name)
                         FROM "_GenreToMovie" gm
                         JOIN genres g ON gm."A" = g."tmdbId"
                         WHERE gm."B" = m.id),
                        ARRAY[]::varchar[]
                    ) as genres,
                    COALESCE(
                        (SELECT array_agg(k.name ORDER BY k.name)
                         FROM "_KeywordToMovie" km
                         JOIN keywords k ON km."A" = k."tmdbId"
                         WHERE km."B" = m.id),
                        ARRAY[]::varchar[]
                    ) as keywords,
                    COALESCE(
                        (SELECT array_agg(p.name ORDER BY p.name)
                         FROM (
                             SELECT DISTINCT p.name
                             FROM person_credits pc
                             JOIN persons p ON pc."personId" = p.id
                             WHERE pc."movieId" = m.id
                             LIMIT 5
                         ) p),
                        ARRAY[]::varchar[]
                    ) as cast
                FROM movies m
                WHERE m."tmdbId" = ANY(%s);
                """,
                (movie_tmdb_ids,),
            )
            for row in cur.fetchall():
                tmdb_id = row["tmdbId"]
                probe_info = probes_map.get(("MOVIE", tmdb_id))
                year = _extract_year(row.get("releaseDate"))
                genres = list(row["genres"]) if row.get("genres") else []
                keywords = list(row["keywords"]) if row.get("keywords") else []
                cast = list(row["cast"]) if row.get("cast") else []
                directors: list[str] = []  # person_credits does not store job/department

                canonical_text = serialize_canonical_text(
                    title=row["title"],
                    year=year,
                    genres=genres,
                    directors=directors,
                    cast=cast,
                    overview=row["overview"],
                    keywords=keywords,
                )

                records.append(
                    {
                        "media_type": "MOVIE",
                        "tmdb_id": tmdb_id,
                        "title": row["title"],
                        "year": year,
                        "genres": genres,
                        "directors": directors,
                        "cast": cast,
                        "overview": row["overview"],
                        "keywords": keywords,
                        "popularity": row["popularity"],
                        "vote_average": row["voteAverage"],
                        "vote_count": row["voteCount"],
                        "canonical_text": canonical_text,
                        "is_probe": probe_info is not None,
                        "probe_id": probe_info["probe_id"] if probe_info else None,
                        "stratum": probe_info["stratum"] if probe_info else None,
                    }
                )

        # Fetch TV Shows
        if tv_tmdb_ids:
            cur.execute(
                """
                SELECT
                    t.id,
                    t."tmdbId",
                    t.name as title,
                    t.overview,
                    t."firstAirDate",
                    t.popularity,
                    t."voteAverage",
                    t."voteCount",
                    COALESCE(
                        (SELECT array_agg(g.name ORDER BY g.name)
                         FROM "_GenreToTvShow" gt
                         JOIN genres g ON gt."A" = g."tmdbId"
                         WHERE gt."B" = t.id),
                        ARRAY[]::varchar[]
                    ) as genres,
                    COALESCE(
                        (SELECT array_agg(k.name ORDER BY k.name)
                         FROM "_KeywordToTvShow" kt
                         JOIN keywords k ON kt."A" = k."tmdbId"
                         WHERE kt."B" = t.id),
                        ARRAY[]::varchar[]
                    ) as keywords,
                    COALESCE(
                        (SELECT array_agg(p.name ORDER BY p.name)
                         FROM (
                             SELECT DISTINCT p.name
                             FROM person_credits pc
                             JOIN persons p ON pc."personId" = p.id
                             WHERE pc."tvShowId" = t.id
                             LIMIT 5
                         ) p),
                        ARRAY[]::varchar[]
                    ) as cast
                FROM tv_shows t
                WHERE t."tmdbId" = ANY(%s);
                """,
                (tv_tmdb_ids,),
            )
            for row in cur.fetchall():
                tmdb_id = row["tmdbId"]
                probe_info = probes_map.get(("TV", tmdb_id))
                year = _extract_year(row.get("firstAirDate"))
                genres = list(row["genres"]) if row.get("genres") else []
                keywords = list(row["keywords"]) if row.get("keywords") else []
                cast = list(row["cast"]) if row.get("cast") else []
                directors: list[str] = []

                canonical_text = serialize_canonical_text(
                    title=row["title"],
                    year=year,
                    genres=genres,
                    directors=directors,
                    cast=cast,
                    overview=row["overview"],
                    keywords=keywords,
                )

                records.append(
                    {
                        "media_type": "TV",
                        "tmdb_id": tmdb_id,
                        "title": row["title"],
                        "year": year,
                        "genres": genres,
                        "directors": directors,
                        "cast": cast,
                        "overview": row["overview"],
                        "keywords": keywords,
                        "popularity": row["popularity"],
                        "vote_average": row["voteAverage"],
                        "vote_count": row["voteCount"],
                        "canonical_text": canonical_text,
                        "is_probe": probe_info is not None,
                        "probe_id": probe_info["probe_id"] if probe_info else None,
                        "stratum": probe_info["stratum"] if probe_info else None,
                    }
                )

    return records


def prepare_catalogue_snapshot(
    db_url: str,
    probes_file: Path,
    output_dir: Path,
    verify_only: bool = False,
) -> int:
    """
    Main orchestration routine.
    Returns 0 on success, 1 on fail-closed stop conditions or errors.
    """
    if psycopg2 is None:
        print("[ERROR] psycopg2 is not installed. Please install psycopg2-binary.", file=sys.stderr)
        return 1

    print("=" * 80)
    print("CineSphere Stage 5.0 — Catalogue Snapshot Fixture Preparation")
    print("=" * 80)
    print(f"Database URL: {db_url.split('@')[-1] if '@' in db_url else db_url}")
    print(f"Probes File:  {probes_file}")
    print(f"Output Dir:   {output_dir}")
    print(f"Verify Only:  {verify_only}")
    print("-" * 80)

    # 1. Load and Validate Probes
    try:
        probes = load_probes(probes_file)
        _, reserved_movie_count, reserved_tv_count = validate_probes(probes)
        additional_movies_needed, additional_tv_needed = calculate_additional_quotas(
            reserved_movie_probes=reserved_movie_count,
            reserved_tv_probes=reserved_tv_count,
            target_movies=REQUIRED_MOVIES_TOTAL,
            target_tv=REQUIRED_TV_SHOWS_TOTAL,
        )
        print(f"[OK] Loaded and validated {len(probes)} probes from {probes_file.name}")
        print(
            f"     Probe Allocation:  {reserved_movie_count} Movies, {reserved_tv_count} TV Shows"
        )
        print(
            f"     Additional Quotas: {additional_movies_needed} Movies, "
            f"{additional_tv_needed} TV Shows"
        )
        print(
            f"     Target Totals:     {REQUIRED_MOVIES_TOTAL} Movies + "
            f"{REQUIRED_TV_SHOWS_TOTAL} TV Shows = 2,000 Records"
        )
    except Exception as e:
        print(f"[FAIL] Could not load or validate probes: {e}", file=sys.stderr)
        return 1

    probes_map = {(p["media_type"].upper(), p["tmdb_id"]): p for p in probes}
    probe_movie_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "MOVIE"]
    probe_tv_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "TV"]

    # 2. Connect to Database (Read-Only)
    conn = None
    try:
        clean_db_url = db_url.split("?schema=")[0] if "?schema=" in db_url else db_url
        conn = psycopg2.connect(clean_db_url)
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY;")
        print("[OK] Connected to PostgreSQL in strict READ-ONLY mode.")
    except Exception as e:
        print(f"[FAIL] Database connection failed: {e}", file=sys.stderr)
        return 1

    try:
        # 3. Verify Database Sufficiency and Probe Presence
        stats = verify_database_readiness(conn, probes)
        print("\n--- Database Catalogue Readiness Audit ---")
        print(f"Total Movies in DB:               {stats['total_movies']:,}")
        print(
            f"Movies with Non-Empty Overview:   {stats['movies_with_overview']:,} "
            f"(Required: {REQUIRED_MOVIES_TOTAL:,})"
        )
        print(f"Total TV Shows in DB:             {stats['total_tv_shows']:,}")
        print(
            f"TV Shows with Non-Empty Overview: {stats['tv_shows_with_overview']:,} "
            f"(Required: {REQUIRED_TV_SHOWS_TOTAL:,})"
        )
        print(
            f"Found Probe Movies:               "
            f"{stats['found_probe_movies_count']} / {stats['probe_movie_ids_count']}"
        )
        print(
            f"Found Probe TV Shows:             "
            f"{stats['found_probe_tv_count']} / {stats['probe_tv_ids_count']}"
        )
        print(
            f"Missing Mandatory Probes:         {len(stats['missing_probes'])} / {REQUIRED_PROBES_TOTAL}"  # noqa: E501
        )

        # Check Fail-Closed Stop Conditions (Section 7)
        stop_reasons = []

        if stats["missing_probes"]:
            stop_reasons.append(
                f"Missing {len(stats['missing_probes'])} of {REQUIRED_PROBES_TOTAL} "
                f"mandatory benchmark probes in database."
            )

        if stats["movies_with_overview"] < REQUIRED_MOVIES_TOTAL:
            deficit = REQUIRED_MOVIES_TOTAL - stats["movies_with_overview"]
            stop_reasons.append(
                f"Insufficient movies with overview: {stats['movies_with_overview']:,} "
                f"available < {REQUIRED_MOVIES_TOTAL:,} required (deficit: {deficit:,})."
            )

        if stats["tv_shows_with_overview"] < REQUIRED_TV_SHOWS_TOTAL:
            deficit = REQUIRED_TV_SHOWS_TOTAL - stats["tv_shows_with_overview"]
            stop_reasons.append(
                f"Insufficient TV shows with overview: {stats['tv_shows_with_overview']:,} "
                f"available < {REQUIRED_TV_SHOWS_TOTAL:,} required (deficit: {deficit:,})."
            )

        if stop_reasons:
            print("\n" + "!" * 80)
            print("[STOP CONDITION TRIGGERED — SECTION 7 COMPLIANCE]")
            for r in stop_reasons:
                print(f"  * {r}")
            print("\nUnder Section 7 Stop Conditions:")
            print("  - We MUST NOT fabricate synthetic records.")
            print("  - We MUST NOT silently substitute TMDB daily export files.")
            print(
                "  - Data extraction MUST fail closed until database is seeded via authorized TMDB sync."  # noqa: E501
            )
            print("!" * 80)

            if stats["missing_probes"]:
                print("\nSample missing probes (first 10):")
                for p in stats["missing_probes"][:10]:
                    probe_title = p.get("title") or p.get("canonical_title") or "Unknown"
                    print(
                        f"  - [{p['probe_id']}] {probe_title} ({p['media_type']} tmdbId={p['tmdb_id']}, {p['stratum']})"  # noqa: E501
                    )

            # In accordance with fail-closed rules, do not write partial fixtures.
            return 1

        if verify_only:
            print(
                "\n[OK] Verification passed! All 50 probes and required quotas are present in database."  # noqa: E501
            )
            return 0

        # 4. Deterministic Candidate Selection
        print("\n--- Executing Deterministic Candidate Selection ---")

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Additional Movies
            cur.execute(
                """
                SELECT "tmdbId"
                FROM movies
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND NOT ("tmdbId" = ANY(%s))
                ORDER BY
                    popularity DESC NULLS LAST,
                    "voteCount" DESC NULLS LAST,
                    "releaseDate" DESC NULLS LAST,
                    "tmdbId" ASC
                LIMIT %s;
                """,
                (probe_movie_ids, additional_movies_needed),
            )
            selected_additional_movie_ids = [row["tmdbId"] for row in cur.fetchall()]

            # Additional TV Shows
            cur.execute(
                """
                SELECT "tmdbId"
                FROM tv_shows
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND NOT ("tmdbId" = ANY(%s))
                ORDER BY
                    popularity DESC NULLS LAST,
                    "voteCount" DESC NULLS LAST,
                    "firstAirDate" DESC NULLS LAST,
                    "tmdbId" ASC
                LIMIT %s;
                """,
                (probe_tv_ids, additional_tv_needed),
            )
            selected_additional_tv_ids = [row["tmdbId"] for row in cur.fetchall()]

        # Validate candidate counts
        if len(selected_additional_movie_ids) != additional_movies_needed:
            print(
                f"[FAIL] Expected {additional_movies_needed} additional movies, "
                f"but selected {len(selected_additional_movie_ids)}.",
                file=sys.stderr,
            )
            return 1

        if len(selected_additional_tv_ids) != additional_tv_needed:
            print(
                f"[FAIL] Expected {additional_tv_needed} additional TV shows, "
                f"but selected {len(selected_additional_tv_ids)}.",
                file=sys.stderr,
            )
            return 1

        all_movie_ids = probe_movie_ids + selected_additional_movie_ids
        all_tv_ids = probe_tv_ids + selected_additional_tv_ids

        # Deduplication check
        if len(set(all_movie_ids)) != REQUIRED_MOVIES_TOTAL:
            print(
                f"[FAIL] Duplicate movie IDs detected in selection: expected {REQUIRED_MOVIES_TOTAL}, unique {len(set(all_movie_ids))}.",  # noqa: E501
                file=sys.stderr,
            )
            return 1

        if len(set(all_tv_ids)) != REQUIRED_TV_SHOWS_TOTAL:
            print(
                f"[FAIL] Duplicate TV IDs detected in selection: expected {REQUIRED_TV_SHOWS_TOTAL}, unique {len(set(all_tv_ids))}.",  # noqa: E501
                file=sys.stderr,
            )
            return 1

        print(
            f"Selected Movies:   {len(probe_movie_ids)} probes + "
            f"{len(selected_additional_movie_ids)} candidates = {len(all_movie_ids)}"
        )
        print(
            f"Selected TV Shows: {len(probe_tv_ids)} probes + "
            f"{len(selected_additional_tv_ids)} candidates = {len(all_tv_ids)}"
        )
        print(f"Total Selected:    {len(all_movie_ids) + len(all_tv_ids)} records")

        # 5. Fetch Metadata and Serialize Canonical Text
        print("\n--- Fetching Detailed Metadata & Constructing Canonical Texts ---")
        records = fetch_full_metadata(conn, all_movie_ids, all_tv_ids, probes_map)

        if len(records) != 2000:
            print(
                f"[FAIL] Expected 2,000 fetched records, but retrieved {len(records)}.",
                file=sys.stderr,
            )
            return 1

        # 6. Final Deterministic Sort: ORDER BY media_type ASC, tmdb_id ASC
        records.sort(key=lambda r: (r["media_type"], r["tmdb_id"]))

        # 7. Write Output Files Atomically (via .tmp files to avoid leaving partial artifacts)
        output_dir.mkdir(parents=True, exist_ok=True)
        jsonl_path = output_dir / "catalogue_snapshot_v1.jsonl"
        sha256_path = output_dir / "catalogue_snapshot_v1.sha256"
        manifest_path = output_dir / "catalogue_snapshot_v1.manifest.json"

        tmp_jsonl = output_dir / "catalogue_snapshot_v1.jsonl.tmp"
        tmp_sha256 = output_dir / "catalogue_snapshot_v1.sha256.tmp"
        tmp_manifest = output_dir / "catalogue_snapshot_v1.manifest.json.tmp"

        print(f"\nWriting {len(records)} records to {tmp_jsonl}...")
        sha256_hasher = hashlib.sha256()

        try:
            with open(tmp_jsonl, "w", encoding="utf-8", newline="\n") as f:
                for rec in records:
                    line = json.dumps(rec, ensure_ascii=False) + "\n"
                    f.write(line)
                    sha256_hasher.update(line.encode("utf-8"))

            digest = sha256_hasher.hexdigest()
            print(f"[OK] Wrote temporary JSONL snapshot. SHA-256: {digest}")

            with open(tmp_sha256, "w", encoding="utf-8", newline="\n") as f:
                f.write(f"{digest}  catalogue_snapshot_v1.jsonl\n")

            manifest = {
                "dataset_version": "v1.0.0",
                "snapshot_filename": "catalogue_snapshot_v1.jsonl",
                "sha256": digest,
                "total_records": len(records),
                "movie_records": len([r for r in records if r["media_type"] == "MOVIE"]),
                "tv_show_records": len([r for r in records if r["media_type"] == "TV"]),
                "probe_count": len([r for r in records if r["is_probe"]]),
                "probes_by_stratum": {
                    stratum: len([r for r in records if r.get("stratum") == stratum])
                    for stratum in sorted(ALLOWED_STRATA)
                },
                "selection_parameters": {
                    "movie_overview_required": True,
                    "tv_overview_required": True,
                    "movie_probe_quota": len(probe_movie_ids),
                    "movie_additional_quota": additional_movies_needed,
                    "tv_probe_quota": len(probe_tv_ids),
                    "tv_additional_quota": additional_tv_needed,
                    "candidate_sort_order": [
                        "popularity DESC NULLS LAST",
                        "voteCount DESC NULLS LAST",
                        "date DESC NULLS LAST",
                        "tmdbId ASC",
                    ],
                    "final_sort_order": ["media_type ASC", "tmdb_id ASC"],
                },
                "created_at": datetime.now(UTC).isoformat(),
                "generated_by": "ml/benchmark/scripts/prepare_catalogue_fixture.py",
            }

            with open(tmp_manifest, "w", encoding="utf-8", newline="\n") as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)

            # Atomic replace
            tmp_jsonl.replace(jsonl_path)
            tmp_sha256.replace(sha256_path)
            tmp_manifest.replace(manifest_path)

            print(f"[OK] Atomically published {jsonl_path}")
            print(f"[OK] Atomically published {sha256_path}")
            print(f"[OK] Atomically published {manifest_path}")

            print("\n" + "=" * 80)
            print("STAGE 5.0 BENCHMARK DATASET PREPARATION COMPLETED SUCCESSFULLY")
            print("=" * 80)
            return 0

        finally:
            # Clean up any leftover temporary files on failure
            for tmp_file in [tmp_jsonl, tmp_sha256, tmp_manifest]:
                if tmp_file.exists():
                    try:
                        tmp_file.unlink()
                    except OSError:
                        pass

    finally:
        if conn:
            conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Extract and prepare deterministic Stage 5.0 benchmark "
            "catalogue snapshot from PostgreSQL."
        )
    )
    parser.add_argument(
        "--db-url",
        default=DEFAULT_DB_URL,
        help="PostgreSQL connection string (defaults to DATABASE_URL or dev default)",
    )
    parser.add_argument(
        "--probes-file",
        type=Path,
        default=DEFAULT_PROBES_FILE,
        help="Path to probes_v1.json fixture",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for catalogue_snapshot_v1.* fixtures",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help=(
            "Perform readiness audit and stop-condition verification only, without writing fixtures"
        ),
    )

    args = parser.parse_args()
    exit_code = prepare_catalogue_snapshot(
        db_url=args.db_url,
        probes_file=args.probes_file,
        output_dir=args.output_dir,
        verify_only=args.verify_only,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
