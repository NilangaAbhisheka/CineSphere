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


class PublicationRollbackError(Exception):
    """Raised when an error occurs during artifact publication AND rollback encounters errors."""

    def __init__(self, original_error: Exception, rollback_errors: list[Exception]) -> None:
        self.original_error = original_error
        self.rollback_errors = rollback_errors
        super().__init__(
            f"Artifact publication failed ({original_error}) AND rollback encountered errors: "
            f"{[str(e) for e in rollback_errors]}"
        )


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

# ---------------------------------------------------------------------------
# Synthetic Integration-Test Exclusion Regex Patterns
# ---------------------------------------------------------------------------
# Prevents integration-test fixtures (from phase3/phase4 tests) from polluting
# the Stage 5.0 benchmark catalogue. Validated against actual database records.
# Designed to never exclude legitimate titles (e.g. 'The Lego Movie', 'The Daily Show').
SYNTHETIC_MOVIE_EXCLUSION_PATTERN = (
    r"^(Test|Integration|Detailed|Concurrent|Ingestion|On-Demand|Recent|Rollback|"
    r"Ownership|Stats|CSV|Notes|Invalid Date|Import|Viewing Event|Duplicate)\s+.*Movie\b|"
    r"^Test\s+Movie\b|"
    r"^E-[0-9]+[a-z]?\s+Movie\b|"
    r"^\[E2E\]|"
    r"^(Initial Title|Updated Title|Duplicate|Tagged Movie|Library Movie Excluded|"
    r"Inception (Alpha|Beta|Null Popularity)|Interstellar Gamma)$"
)

SYNTHETIC_TV_EXCLUSION_PATTERN = (
    r"^(Test|Integration|Detailed|Concurrent|Ingestion|On-Demand|Recent|Rollback|"
    r"Ownership|Stats|CSV|CW|Import|Specials|Viewing Event|Duplicate)\s+.*(Show|Series|TV)\b|"
    r"^Test\s+(Show|Series)\b|"
    r"^E-[0-9]+[a-z]?\s+(Show|Series|TV)\b|"
    r"^\[E2E\]|^TV Hierarchy|"
    r"^(Show Alpha|Show Beta|Show [A-Za-z0-9]+|TV Show [A-Za-z0-9]+|Completed Show|"
    r"Fully Watched Show|Null WatchedAt Show|Tagged Show|TV Show Missing (Season|Episode)|"
    r"Breaking Cosmos|Better Call Cosmos)$"
)


def serialize_canonical_text(
    media_type: str,
    title: str,
    original_title: str | None = None,
    year: int | None = None,
    genres: list[str] | None = None,
    directors: list[str] | None = None,
    creators: list[str] | None = None,
    cast: list[str] | None = None,
    keywords: list[str] | None = None,
    overview: str | None = None,
    tagline: str | None = None,
) -> str:
    """Serializes metadata into benchmark canonical text format per Section 8.11.1.

    Movie Format:
    "[TITLE] {title} [ORIGINAL_TITLE] {originalTitle} [YEAR] {year} [GENRES] {genres}
     [DIRECTOR] {directors} [CAST] {topCast} [KEYWORDS] {keywords}
     [OVERVIEW] {overview} [TAGLINE] {tagline}"

    TV Show Format:
    "[TITLE] {name} [ORIGINAL_TITLE] {originalName} [FIRST_AIR_YEAR] {year} [GENRES] {genres}
     [CREATOR] {creators} [CAST] {topCast} [KEYWORDS] {keywords}
     [OVERVIEW] {overview} [TAGLINE] {tagline}"

    Strict null/omission policy:
    - If any field is NULL, empty, or whitespace-only, its bracketed label and value
      are completely omitted from the output.
    - No literal 'null', 'None', 'undefined', or empty tokens like '[TAGLINE] ' are emitted.
    - Tokens are space-separated. Collection values are joined with ', '.

    Schema limitations:
    - person_credits does not store job/department, so directors and creators are empty.
    - movies and tv_shows do not have a tagline column in the current schema.
    - These unavailable fields naturally evaluate to omitted under the strict omission policy.
    """
    media_upper = (media_type or "").strip().upper()
    tokens: list[str] = []

    def _add_token(label: str, val: str | None) -> None:
        if val is not None:
            clean_val = val.strip()
            if clean_val:
                tokens.append(f"[{label}] {clean_val}")

    def _add_list_token(label: str, items: list[str] | None) -> None:
        if items:
            clean_items = [item.strip() for item in items if item and item.strip()]
            if clean_items:
                tokens.append(f"[{label}] {', '.join(clean_items)}")

    # 1. Title
    _add_token("TITLE", title)

    # 2. Original Title / Original Name
    _add_token("ORIGINAL_TITLE", original_title)

    # 3. Year
    if year is not None:
        if media_upper == "TV":
            tokens.append(f"[FIRST_AIR_YEAR] {year}")
        else:
            tokens.append(f"[YEAR] {year}")

    # 4. Genres
    _add_list_token("GENRES", genres)

    # 5. Director / Creator
    if media_upper == "TV":
        _add_list_token("CREATOR", creators)
    else:
        _add_list_token("DIRECTOR", directors)

    # 6. Cast
    _add_list_token("CAST", cast)

    # 7. Keywords
    _add_list_token("KEYWORDS", keywords)

    # 8. Overview
    _add_token("OVERVIEW", overview)

    # 9. Tagline
    _add_token("TAGLINE", tagline)

    return " ".join(tokens)


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
    """Performs data sufficiency and probe presence verification against PostgreSQL.

    Excludes synthetic integration-test fixtures from counts.
    Returns audit statistics dictionary or raises fail-closed exceptions.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # 1. Check movie count with non-empty overview excluding synthetic records
        cur.execute(
            """
            SELECT
                COUNT(*) as total_movies,
                COUNT(*) FILTER (
                    WHERE overview IS NOT NULL AND TRIM(overview) != ''
                      AND title !~* %s
                ) as movies_with_overview
            FROM movies;
            """,
            (SYNTHETIC_MOVIE_EXCLUSION_PATTERN,),
        )
        movie_stats = cur.fetchone()
        total_movies = movie_stats["total_movies"]
        movies_with_overview = movie_stats["movies_with_overview"]

        # 2. Check TV show count with non-empty overview excluding synthetic records
        cur.execute(
            """
            SELECT
                COUNT(*) as total_tv_shows,
                COUNT(*) FILTER (
                    WHERE overview IS NOT NULL AND TRIM(overview) != ''
                      AND name !~* %s
                ) as tv_shows_with_overview
            FROM tv_shows;
            """,
            (SYNTHETIC_TV_EXCLUSION_PATTERN,),
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


def get_cast_selection_sql(media_filter: str, table_alias: str = "pc") -> str:
    """Returns the deterministic SQL subquery expression for selecting top-5 cast members.

    Ordering:
    Subquery: ORDER BY p.name ASC, p."tmdbId" ASC LIMIT 5
    Outer: ORDER BY sub.name ASC, sub."tmdbId" ASC
    """
    return f"""COALESCE(
                        (SELECT array_agg(sub.name ORDER BY sub.name ASC, sub."tmdbId" ASC)
                         FROM (
                             SELECT p.name, p."tmdbId"
                             FROM person_credits {table_alias}
                             JOIN persons p ON {table_alias}."personId" = p.id
                             WHERE {media_filter}
                             ORDER BY p.name ASC, p."tmdbId" ASC
                             LIMIT 5
                         ) sub),
                        ARRAY[]::varchar[]
                    ) as cast"""


def fetch_full_metadata(
    conn: Any,
    movie_tmdb_ids: list[int],
    tv_tmdb_ids: list[int],
    probes_map: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fetches full metadata, genres, keywords, and credits for selected items.

    Deterministic cast selection:
    Selects up to 5 cast members ordered by (p.name ASC, p.tmdbId ASC) inside the
    subquery before applying LIMIT 5, and aggregates them preserving that order.
    Note: The current person_credits schema does not store TMDB billing order or
    job/department columns; directors and creators are unresolvable and omitted.
    """
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
                    m."originalTitle",
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
                    {get_cast_selection_sql('pc."movieId" = m.id')}
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
                directors: list[str] = []  # Schema limitation: person_credits lacks job info

                canonical_text = serialize_canonical_text(
                    media_type="MOVIE",
                    title=row["title"],
                    original_title=row.get("originalTitle"),
                    year=year,
                    genres=genres,
                    directors=directors,
                    creators=[],
                    cast=cast,
                    overview=row.get("overview"),
                    keywords=keywords,
                    tagline=None,
                )

                records.append(
                    {
                        "media_type": "MOVIE",
                        "tmdb_id": tmdb_id,
                        "title": row["title"],
                        "original_title": row.get("originalTitle"),
                        "year": year,
                        "genres": genres,
                        "directors": directors,
                        "cast": cast,
                        "overview": row.get("overview"),
                        "keywords": keywords,
                        "popularity": row.get("popularity"),
                        "vote_average": row.get("voteAverage"),
                        "vote_count": row.get("voteCount"),
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
                    t."originalName",
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
                    {get_cast_selection_sql('pc."tvShowId" = t.id')}
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
                creators: list[str] = []  # Schema limitation: person_credits lacks job info

                canonical_text = serialize_canonical_text(
                    media_type="TV",
                    title=row["title"],
                    original_title=row.get("originalName"),
                    year=year,
                    genres=genres,
                    directors=[],
                    creators=creators,
                    cast=cast,
                    overview=row.get("overview"),
                    keywords=keywords,
                    tagline=None,
                )

                records.append(
                    {
                        "media_type": "TV",
                        "tmdb_id": tmdb_id,
                        "title": row["title"],
                        "original_title": row.get("originalName"),
                        "year": year,
                        "genres": genres,
                        "creators": creators,
                        "cast": cast,
                        "overview": row.get("overview"),
                        "keywords": keywords,
                        "popularity": row.get("popularity"),
                        "vote_average": row.get("voteAverage"),
                        "vote_count": row.get("voteCount"),
                        "canonical_text": canonical_text,
                        "is_probe": probe_info is not None,
                        "probe_id": probe_info["probe_id"] if probe_info else None,
                        "stratum": probe_info["stratum"] if probe_info else None,
                    }
                )

    return records


def create_readonly_connection(db_url: str) -> Any:
    """Establishes a PostgreSQL connection with session-level read-only enforcement.

    Sets:
    - conn.set_session(readonly=True, autocommit=True)
    - SET default_transaction_read_only = on
    Guarantees that write attempts (INSERT, UPDATE, DELETE, DDL) fail immediately
    with ReadOnlySqlTransaction at the database engine level.
    """
    if psycopg2 is None:
        raise ImportError("psycopg2 is not installed. Please install psycopg2-binary.")
    clean_db_url = db_url.split("?schema=")[0] if "?schema=" in db_url else db_url
    conn = psycopg2.connect(clean_db_url)
    conn.set_session(readonly=True, autocommit=True)
    with conn.cursor() as cur:
        cur.execute("SET default_transaction_read_only = on;")
    return conn


def write_jsonl_snapshot(records: list[dict[str, Any]], target_path: Path) -> str:
    """Writes records line-by-line as UTF-8 JSON lines and returns SHA-256 digest."""
    sha256_hasher = hashlib.sha256()
    with open(target_path, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            line = json.dumps(rec, ensure_ascii=False) + "\n"
            f.write(line)
            sha256_hasher.update(line.encode("utf-8"))
    return sha256_hasher.hexdigest()


def build_manifest(
    records: list[dict[str, Any]],
    digest: str,
    probe_movie_count: int,
    additional_movies_quota: int,
    probe_tv_count: int,
    additional_tv_quota: int,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Constructs manifest dictionary conforming to Section 8.11.3 specification."""
    if generated_at is None:
        generated_at = datetime.now(UTC).isoformat()

    return {
        "fixture_filename": "catalogue_snapshot_v1.jsonl",
        "record_count": len(records),
        "movie_count": len([r for r in records if r["media_type"] == "MOVIE"]),
        "tv_count": len([r for r in records if r["media_type"] == "TV"]),
        "probe_count": len([r for r in records if r.get("is_probe")]),
        "sha256": digest,
        "source_identity": "CineSphere PostgreSQL (catalogue tables)",
        "selection_algorithm_version": "1.0.0-deterministic",
        "serialization_version": "1.0.0-bracketed-tokens",
        "generated_at": generated_at,
        "probes_by_stratum": {
            stratum: len([r for r in records if r.get("stratum") == stratum])
            for stratum in sorted(ALLOWED_STRATA)
        },
        "selection_parameters": {
            "movie_overview_required": True,
            "tv_overview_required": True,
            "movie_probe_quota": probe_movie_count,
            "movie_additional_quota": additional_movies_quota,
            "tv_probe_quota": probe_tv_count,
            "tv_additional_quota": additional_tv_quota,
            "candidate_sort_order": [
                "popularity DESC NULLS LAST",
                "voteCount DESC NULLS LAST",
                "date DESC NULLS LAST",
                "tmdbId ASC",
            ],
            "final_sort_order": ["media_type ASC", "tmdb_id ASC"],
            "synthetic_movie_exclusion_applied": True,
            "synthetic_tv_exclusion_applied": True,
        },
    }


def stage_fixture_artifacts(
    records: list[dict[str, Any]],
    output_dir: Path,
    probe_movie_count: int,
    additional_movies_quota: int,
    probe_tv_count: int,
    additional_tv_quota: int,
) -> tuple[list[tuple[Path, Path]], str, dict[str, Any]]:
    """Stages temporary fixture artifacts (.tmp) before publication.

    Returns:
    (artifacts, digest, manifest)
    where artifacts is a list of (tmp_path, final_path) tuples.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = output_dir / "catalogue_snapshot_v1.jsonl"
    sha256_path = output_dir / "catalogue_snapshot_v1.sha256"
    manifest_path = output_dir / "catalogue_snapshot_v1.manifest.json"

    tmp_jsonl = output_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_sha256 = output_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_manifest = output_dir / "catalogue_snapshot_v1.manifest.json.tmp"

    digest = write_jsonl_snapshot(records, tmp_jsonl)

    with open(tmp_sha256, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{digest}  catalogue_snapshot_v1.jsonl\n")

    manifest = build_manifest(
        records=records,
        digest=digest,
        probe_movie_count=probe_movie_count,
        additional_movies_quota=additional_movies_quota,
        probe_tv_count=probe_tv_count,
        additional_tv_quota=additional_tv_quota,
    )
    with open(tmp_manifest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    artifacts = [
        (tmp_jsonl, jsonl_path),
        (tmp_sha256, sha256_path),
        (tmp_manifest, manifest_path),
    ]
    return artifacts, digest, manifest


def publish_artifacts(artifacts: list[tuple[Path, Path]]) -> None:
    """Publishes temporary artifacts to final destinations with rollback support.

    For each (tmp_path, final_path) pair:
    1. Preflight check: verifies all tmp_paths exist before beginning publication.
    2. Records which destinations initially exist: initial_dest_exists[final_path].
    3. Moves existing final_paths to temporary backup files (.old).
    4. Moves tmp_paths to final_paths.
    5. If any failure occurs during backup or replacement:
       - Restores all backed-up files (.old -> final_path).
       - Deletes any final_paths that did NOT exist initially but were created during replacement.
       - Cleans up leftover .tmp and remaining .old files.
       - If rollback itself encounters errors, raises PublicationRollbackError.
       - If rollback succeeds cleanly, raises RuntimeError detailing the original error.
    6. On complete success: unlinks all backup files (.old).
    """
    initial_dest_exists: dict[Path, bool] = {}
    backups: dict[Path, Path] = {}
    replaced_finals: list[Path] = []
    rollback_errors: list[Exception] = []

    # Phase 1: Preflight check - verify all tmp files exist
    for tmp_path, _ in artifacts:
        if not tmp_path.exists():
            for t, _ in artifacts:
                try:
                    if t.exists():
                        t.unlink()
                except Exception:
                    pass
            raise RuntimeError(
                f"Artifact publication failed and was rolled back: "
                f"Temporary artifact {tmp_path} does not exist."
            )

    try:
        # Phase 2: Record initial existence and create backups of existing final files
        for _, final_path in artifacts:
            exists = final_path.exists()
            initial_dest_exists[final_path] = exists
            if exists:
                bak_path = final_path.with_name(final_path.name + ".old")
                if bak_path.exists():
                    bak_path.unlink()
                final_path.replace(bak_path)
                backups[final_path] = bak_path

        # Phase 3: Move tmp files to final destinations
        for tmp_path, final_path in artifacts:
            tmp_path.replace(final_path)
            replaced_finals.append(final_path)

        # Phase 4: Clean up backups on complete success
        for bak_path in backups.values():
            if bak_path.exists():
                bak_path.unlink()

    except Exception as e:
        # Rollback procedure:
        # 1. For destinations that existed initially: restore from backup
        for final_path, bak_path in backups.items():
            try:
                if bak_path.exists():
                    bak_path.replace(final_path)
            except Exception as rb_err:
                rollback_errors.append(rb_err)

        # 2. For destinations that did NOT exist initially but were replaced/created in Phase 3:
        # delete them so partial files are not left behind.
        for final_path in replaced_finals:
            if not initial_dest_exists.get(final_path, False):
                try:
                    if final_path.exists():
                        final_path.unlink()
                except Exception as rb_err:
                    rollback_errors.append(rb_err)

        # 3. Clean up any leftover temporary files (.tmp) and remaining backups (.old)
        for tmp_path, _ in artifacts:
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except Exception:
                pass
        for bak_path in backups.values():
            try:
                if bak_path.exists():
                    bak_path.unlink()
            except Exception:
                pass

        if rollback_errors:
            raise PublicationRollbackError(e, rollback_errors) from e
        raise RuntimeError(f"Artifact publication failed and was rolled back: {e}") from e


def prepare_catalogue_snapshot(
    db_url: str,
    probes_file: Path,
    output_dir: Path,
    verify_only: bool = False,
) -> int:
    """Main orchestration routine.

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
        conn = create_readonly_connection(db_url)
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
            # Additional Movies (excluding probes and synthetic test records)
            cur.execute(
                """
                SELECT "tmdbId"
                FROM movies
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND NOT ("tmdbId" = ANY(%s))
                  AND title !~* %s
                ORDER BY
                    popularity DESC NULLS LAST,
                    "voteCount" DESC NULLS LAST,
                    "releaseDate" DESC NULLS LAST,
                    "tmdbId" ASC
                LIMIT %s;
                """,
                (
                    probe_movie_ids,
                    SYNTHETIC_MOVIE_EXCLUSION_PATTERN,
                    additional_movies_needed,
                ),
            )
            selected_additional_movie_ids = [row["tmdbId"] for row in cur.fetchall()]

            # Additional TV Shows (excluding probes and synthetic test records)
            cur.execute(
                """
                SELECT "tmdbId"
                FROM tv_shows
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND NOT ("tmdbId" = ANY(%s))
                  AND name !~* %s
                ORDER BY
                    popularity DESC NULLS LAST,
                    "voteCount" DESC NULLS LAST,
                    "firstAirDate" DESC NULLS LAST,
                    "tmdbId" ASC
                LIMIT %s;
                """,
                (
                    probe_tv_ids,
                    SYNTHETIC_TV_EXCLUSION_PATTERN,
                    additional_tv_needed,
                ),
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

        # 7. Write Output Files via Staged Publication with Rollback Support
        artifacts, digest, manifest = stage_fixture_artifacts(
            records=records,
            output_dir=output_dir,
            probe_movie_count=len(probe_movie_ids),
            additional_movies_quota=additional_movies_needed,
            probe_tv_count=len(probe_tv_ids),
            additional_tv_quota=additional_tv_needed,
        )
        tmp_files = [tmp for tmp, _ in artifacts]

        try:
            print(f"\nStaged {len(records)} records. SHA-256: {digest}")
            publish_artifacts(artifacts)

            print(f"[OK] Published {artifacts[0][1]}")
            print(f"[OK] Published {artifacts[1][1]}")
            print(f"[OK] Published {artifacts[2][1]}")

            print("\n" + "=" * 80)
            print("STAGE 5.0 BENCHMARK DATASET PREPARATION COMPLETED SUCCESSFULLY")
            print("=" * 80)
            return 0

        finally:
            # Clean up any leftover temporary files on failure
            for tmp_file in tmp_files:
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
