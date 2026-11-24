"""
ml/benchmark/scripts/prepare_catalogue_fixture.py

Deterministic extraction and preparation script for the CineSphere Stage 5.0
evaluation benchmark dataset (catalogue_snapshot_v1.jsonl).

Authoritative Reference:
docs/PHASE_5_TECHNICAL_DESIGN_PROPOSAL_V0.7.4_CORRECTION_ADDENDUM.md (Section 8.11)

Requirements & Invariants:
1. Connects to PostgreSQL using strictly READ-ONLY session mode.
2. Loads probes from ml/benchmark/fixtures/probes_v1.json (50 probes, 5 strata).
3. Verifies all 50 probes exist in the database. Fails closed with MissingMandatoryProbesError
   if any probe is missing.
4. Verifies database contains at least 1,400 movies and 600 TV shows with non-empty overviews.
   Fails closed with InsufficientCatalogueError if counts are insufficient.
5. Deterministically selects:
   - 50 probes (reserved first)
   - 1,360 additional movies (sorted by popularity DESC, voteCount DESC, releaseDate DESC, tmdbId ASC)
   - 590 additional TV shows (sorted by popularity DESC, voteCount DESC, firstAirDate DESC, tmdbId ASC)
6. Serializes canonical text with strict null/empty omission policy (Section 8.11).
7. Sorts final 2,000-record dataset strictly by ORDER BY media_type ASC, tmdb_id ASC.
8. Computes SHA-256 and writes catalogue_snapshot_v1.jsonl, catalogue_snapshot_v1.sha256,
   and catalogue_snapshot_v1.manifest.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

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


def serialize_canonical_text(
    title: str,
    year: Optional[int],
    genres: List[str],
    directors: List[str],
    cast: List[str],
    overview: Optional[str],
    keywords: List[str],
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
    lines: List[str] = []

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


def load_probes(probes_path: Path) -> List[Dict[str, Any]]:
    """Loads and validates the 50 predefined benchmark probes from JSON."""
    if not probes_path.exists():
        raise FileNotFoundError(f"Probes file not found: {probes_path}")

    with open(probes_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        probes = data
    else:
        probes = data.get("probes", [])
    if len(probes) != REQUIRED_PROBES_TOTAL:
        raise ValueError(
            f"Expected exactly {REQUIRED_PROBES_TOTAL} probes in {probes_path}, found {len(probes)}"
        )
    return probes


def verify_database_readiness(
    conn: Any,
    probes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Performs data sufficiency and probe presence verification against PostgreSQL.
    Returns audit statistics dictionary or raises fail-closed exceptions.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # 1. Check movie count with overview
        cur.execute(
            """
            SELECT 
                COUNT(*) as total_movies,
                COUNT(*) FILTER (WHERE overview IS NOT NULL AND TRIM(overview) != '') as movies_with_overview
            FROM movies;
            """
        )
        movie_stats = cur.fetchone()
        total_movies = movie_stats["total_movies"]
        movies_with_overview = movie_stats["movies_with_overview"]

        # 2. Check TV show count with overview
        cur.execute(
            """
            SELECT 
                COUNT(*) as total_tv_shows,
                COUNT(*) FILTER (WHERE overview IS NOT NULL AND TRIM(overview) != '') as tv_shows_with_overview
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


def fetch_full_metadata(
    conn: Any,
    movie_tmdb_ids: List[int],
    tv_tmdb_ids: List[int],
    probes_map: Dict[Tuple[str, int], Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Fetches full metadata, genres, keywords, and credits for selected items."""
    records: List[Dict[str, Any]] = []

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
                year = row["releaseDate"].year if row["releaseDate"] else None
                genres = list(row["genres"]) if row["genres"] else []
                keywords = list(row["keywords"]) if row["keywords"] else []
                cast = list(row["cast"]) if row["cast"] else []
                directors: List[str] = []  # person_credits does not store job/department

                canonical_text = serialize_canonical_text(
                    title=row["title"],
                    year=year,
                    genres=genres,
                    directors=directors,
                    cast=cast,
                    overview=row["overview"],
                    keywords=keywords,
                )

                records.append({
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
                })

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
                year = row["firstAirDate"].year if row["firstAirDate"] else None
                genres = list(row["genres"]) if row["genres"] else []
                keywords = list(row["keywords"]) if row["keywords"] else []
                cast = list(row["cast"]) if row["cast"] else []
                directors: List[str] = []

                canonical_text = serialize_canonical_text(
                    title=row["title"],
                    year=year,
                    genres=genres,
                    directors=directors,
                    cast=cast,
                    overview=row["overview"],
                    keywords=keywords,
                )

                records.append({
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
                })
                directors: List[str] = []

                canonical_text = serialize_canonical_text(
                    title=row["title"],
                    year=year,
                    genres=genres,
                    directors=directors,
                    cast=cast,
                    overview=row["overview"],
                    keywords=keywords,
                )

                records.append({
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
                    "vote_average": row["voteaverage"],
                    "vote_count": row["votecount"],
                    "canonical_text": canonical_text,
                    "is_probe": probe_info is not None,
                    "probe_id": probe_info["probe_id"] if probe_info else None,
                    "stratum": probe_info["stratum"] if probe_info else None,
                })

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

    # 1. Load Probes
    try:
        probes = load_probes(probes_file)
        print(f"[OK] Loaded {len(probes)} probes from {probes_file.name}")
    except Exception as e:
        print(f"[FAIL] Could not load probes file: {e}", file=sys.stderr)
        return 1

    probes_map = {(p["media_type"].upper(), p["tmdb_id"]): p for p in probes}
    probe_movie_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "MOVIE"]
    probe_tv_ids = [p["tmdb_id"] for p in probes if p["media_type"].upper() == "TV"]

    print(f"     Probe Breakdown: {len(probe_movie_ids)} Movies, {len(probe_tv_ids)} TV Shows")

    # 2. Connect to Database (Read-Only)
    try:
        clean_db_url = db_url.split("?schema=")[0] if "?schema=" in db_url else db_url
        conn = psycopg2.connect(clean_db_url)
        conn.set_session(readonly=True, autocommit=True)
        print("[OK] Connected to PostgreSQL in READ-ONLY mode.")
    except Exception as e:
        print(f"[FAIL] Database connection failed: {e}", file=sys.stderr)
        return 1

    try:
        # 3. Verify Database Sufficiency and Probe Presence
        stats = verify_database_readiness(conn, probes)
        print("\n--- Database Catalogue Readiness Audit ---")
        print(f"Total Movies in DB:               {stats['total_movies']:,}")
        print(f"Movies with Non-Empty Overview:   {stats['movies_with_overview']:,} (Required: {REQUIRED_MOVIES_TOTAL:,})")
        print(f"Total TV Shows in DB:             {stats['total_tv_shows']:,}")
        print(f"TV Shows with Non-Empty Overview: {stats['tv_shows_with_overview']:,} (Required: {REQUIRED_TV_SHOWS_TOTAL:,})")
        print(f"Found Probe Movies:               {stats['found_probe_movies_count']} / {stats['probe_movie_ids_count']}")
        print(f"Found Probe TV Shows:             {stats['found_probe_tv_count']} / {stats['probe_tv_ids_count']}")
        print(f"Missing Mandatory Probes:         {len(stats['missing_probes'])} / {REQUIRED_PROBES_TOTAL}")

        # Check Fail-Closed Stop Conditions (Section 7)
        stop_reasons = []

        if stats["missing_probes"]:
            stop_reasons.append(
                f"Missing {len(stats['missing_probes'])} of {REQUIRED_PROBES_TOTAL} mandatory benchmark probes in database."
            )

        if stats["movies_with_overview"] < REQUIRED_MOVIES_TOTAL:
            deficit = REQUIRED_MOVIES_TOTAL - stats["movies_with_overview"]
            stop_reasons.append(
                f"Insufficient movies with overview: {stats['movies_with_overview']:,} available < {REQUIRED_MOVIES_TOTAL:,} required (deficit: {deficit:,})."
            )

        if stats["tv_shows_with_overview"] < REQUIRED_TV_SHOWS_TOTAL:
            deficit = REQUIRED_TV_SHOWS_TOTAL - stats["tv_shows_with_overview"]
            stop_reasons.append(
                f"Insufficient TV shows with overview: {stats['tv_shows_with_overview']:,} available < {REQUIRED_TV_SHOWS_TOTAL:,} required (deficit: {deficit:,})."
            )

        if stop_reasons:
            print("\n" + "!" * 80)
            print("[STOP CONDITION TRIGGERED — SECTION 7 COMPLIANCE]")
            for r in stop_reasons:
                print(f"  * {r}")
            print("\nUnder Section 7 Stop Conditions:")
            print("  - We MUST NOT fabricate synthetic records.")
            print("  - We MUST NOT silently substitute TMDB daily export files.")
            print("  - Data extraction MUST fail closed until database is seeded via authorized TMDB sync.")
            print("!" * 80)

            if stats["missing_probes"]:
                print("\nSample missing probes (first 10):")
                for p in stats["missing_probes"][:10]:
                    probe_title = p.get("title") or p.get("canonical_title") or "Unknown"
                    print(f"  - [{p['probe_id']}] {probe_title} ({p['media_type']} tmdbId={p['tmdb_id']}, {p['stratum']})")

            # In accordance with fail-closed rules, do not write partial fixtures.
            return 1

        if verify_only:
            print("\n[OK] Verification passed! All 50 probes and required quotas are present in database.")
            return 0

        # 4. Deterministic Selection
        print("\n--- Executing Deterministic Candidate Selection ---")
        additional_movies_needed = REQUIRED_MOVIES_TOTAL - len(probe_movie_ids)
        additional_tv_needed = REQUIRED_TV_SHOWS_TOTAL - len(probe_tv_ids)

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Additional Movies
            cur.execute(
                """
                SELECT "tmdbId"
                FROM movies
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND "tmdbId" NOT IN %s
                ORDER BY popularity DESC, "voteCount" DESC, "releaseDate" DESC NULLS LAST, "tmdbId" ASC
                LIMIT %s;
                """,
                (tuple(probe_movie_ids), additional_movies_needed),
            )
            selected_additional_movie_ids = [row["tmdbId"] for row in cur.fetchall()]

            # Additional TV Shows
            cur.execute(
                """
                SELECT "tmdbId"
                FROM tv_shows
                WHERE overview IS NOT NULL AND TRIM(overview) != ''
                  AND "tmdbId" NOT IN %s
                ORDER BY popularity DESC, "voteCount" DESC, "firstAirDate" DESC NULLS LAST, "tmdbId" ASC
                LIMIT %s;
                """,
                (tuple(probe_tv_ids), additional_tv_needed),
            )
            selected_additional_tv_ids = [row["tmdbId"] for row in cur.fetchall()]

        all_movie_ids = probe_movie_ids + selected_additional_movie_ids
        all_tv_ids = probe_tv_ids + selected_additional_tv_ids

        print(f"Selected Movies:   {len(probe_movie_ids)} probes + {len(selected_additional_movie_ids)} candidates = {len(all_movie_ids)}")
        print(f"Selected TV Shows: {len(probe_tv_ids)} probes + {len(selected_additional_tv_ids)} candidates = {len(all_tv_ids)}")
        print(f"Total Selected:    {len(all_movie_ids) + len(all_tv_ids)} records")

        # 5. Fetch Metadata and Serialize Canonical Text
        print("\n--- Fetching Detailed Metadata & Constructing Canonical Texts ---")
        records = fetch_full_metadata(conn, all_movie_ids, all_tv_ids, probes_map)

        # 6. Final Deterministic Sort: ORDER BY media_type ASC, tmdb_id ASC
        records.sort(key=lambda r: (r["media_type"], r["tmdb_id"]))

        # 7. Write Output Files
        output_dir.mkdir(parents=True, exist_ok=True)
        jsonl_path = output_dir / "catalogue_snapshot_v1.jsonl"
        sha256_path = output_dir / "catalogue_snapshot_v1.sha256"
        manifest_path = output_dir / "catalogue_snapshot_v1.manifest.json"

        print(f"\nWriting {len(records)} records to {jsonl_path}...")
        sha256_hasher = hashlib.sha256()

        with open(jsonl_path, "w", encoding="utf-8") as f:
            for rec in records:
                line = json.dumps(rec, ensure_ascii=False) + "\n"
                f.write(line)
                sha256_hasher.update(line.encode("utf-8"))

        digest = sha256_hasher.hexdigest()
        print(f"[OK] Wrote JSONL snapshot. SHA-256: {digest}")

        with open(sha256_path, "w", encoding="utf-8") as f:
            f.write(f"{digest}  catalogue_snapshot_v1.jsonl\n")
        print(f"[OK] Wrote checksum to {sha256_path}")

        # Write Manifest
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
                for stratum in ["Mainstream", "International", "Indie", "Serialized TV", "Stress Cases"]
            },
            "selection_parameters": {
                "movie_overview_required": True,
                "tv_overview_required": True,
                "movie_probe_quota": len(probe_movie_ids),
                "movie_additional_quota": additional_movies_needed,
                "tv_probe_quota": len(probe_tv_ids),
                "tv_additional_quota": additional_tv_needed,
                "candidate_sort_order": ["popularity DESC", "voteCount DESC", "date DESC", "tmdbId ASC"],
                "final_sort_order": ["media_type ASC", "tmdb_id ASC"],
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "generated_by": "ml/benchmark/scripts/prepare_catalogue_fixture.py",
        }

        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f"[OK] Wrote manifest to {manifest_path}")

        print("\n" + "=" * 80)
        print("STAGE 5.0 BENCHMARK DATASET PREPARATION COMPLETED SUCCESSFULLY")
        print("=" * 80)
        return 0

    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract and prepare deterministic Stage 5.0 benchmark catalogue snapshot from PostgreSQL."
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
        help="Perform readiness audit and stop-condition verification only, without writing fixtures",
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
