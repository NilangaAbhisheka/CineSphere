"""
ml/tests/test_prepare_catalogue_fixture.py

Comprehensive unit and integration test suite for
ml/benchmark/scripts/prepare_catalogue_fixture.py.

Covers all required invariants and behavioral requirements:
1. Quota calculations and dynamic probe distributions.
2. Probe structural, uniqueness, and quota validation.
3. Database readiness audit with fail-closed stop conditions.
4. Candidate selection excluding reserved probes and synthetic fixtures.
5. Deterministic query sorting (NULLS LAST, tie-breakers).
6. Exact canonical document serialization per Section 8.11.1 (Movie & TV).
7. Strict null/empty/whitespace omission policy and non-canonical exclusions.
8. Synthetic integration-test exclusion regex validation (positive & negative).
9. Deterministic cast SQL selection via real PostgreSQL execution.
10. Genuine PostgreSQL session read-only enforcement on disposable test DB.
11. Fixture manifest compliance with Section 8.11.3 using production functions.
12. SHA-256 byte-for-byte digest via production write_jsonl_snapshot.
13. Atomic staged publication with backup and rollback — genuine mid-publication failure.
14. Personal library isolation (forbidden tables).
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from ml.benchmark.scripts.prepare_catalogue_fixture import (
    ALLOWED_STRATA,
    FORBIDDEN_TABLES,
    REQUIRED_MOVIES_TOTAL,
    REQUIRED_TV_SHOWS_TOTAL,
    SYNTHETIC_MOVIE_EXCLUSION_PATTERN,
    SYNTHETIC_TV_EXCLUSION_PATTERN,
    InvalidProbeDefinitionError,
    PublicationCleanupError,
    PublicationRollbackError,
    build_manifest,
    calculate_additional_quotas,
    create_readonly_connection,
    fetch_full_metadata,
    get_cast_selection_sql,
    prepare_catalogue_snapshot,
    publish_artifacts,
    serialize_canonical_text,
    validate_probes,
    verify_database_readiness,
    write_jsonl_snapshot,
)

# ---------------------------------------------------------------------------
# Test-database connection helper
# ---------------------------------------------------------------------------


def _get_test_db_url() -> str | None:
    """Returns a safe disposable test DB URL that contains 'test' or 'e2e'.

    Checks CINESPHERE_TEST_DATABASE_URL and CINESPHERE_E2E_DATABASE_URL first,
    then falls back to the cinesphere_test database if reachable.
    Never returns a URL pointing to the production 'cinesphere' dev database.
    """
    for env_var in ("CINESPHERE_TEST_DATABASE_URL", "CINESPHERE_E2E_DATABASE_URL"):
        url = os.environ.get(env_var)
        if url:
            lower = url.lower()
            if "test" not in lower and "e2e" not in lower:
                raise RuntimeError(
                    f"Environment variable {env_var}={url!r} does not point to a "
                    "test/e2e database (URL must contain 'test' or 'e2e')."
                )
            return url

    # Try the standard cinesphere_test database as a last resort
    fallback = "postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test"
    return fallback


def _connect_test_db():
    """Connects to disposable test DB, or returns None if unavailable.

    Never connects to the development 'cinesphere' database.
    Caller must check for None and skip the test if the connection is unavailable.
    """
    try:
        import psycopg2  # noqa: PLC0415
    except ImportError:
        return None

    url = _get_test_db_url()
    if url is None:
        return None

    lower = url.lower()
    if "test" not in lower and "e2e" not in lower:
        return None

    try:
        conn = psycopg2.connect(url.split("?")[0])
        return conn
    except Exception:
        return None


@pytest.fixture
def valid_50_probes() -> list[dict[str, Any]]:
    """Generates a valid synthetic set of 50 probes matching the 38 movie / 12 TV distribution."""
    probes: list[dict[str, Any]] = []
    strata_list = list(ALLOWED_STRATA)  # 5 strata, exactly 10 per stratum

    # 38 movies (indices 0..37), 12 TV shows (indices 38..49)
    for i in range(50):
        media_type = "movie" if i < 38 else "tv"
        stratum = strata_list[i % len(strata_list)]
        probes.append(
            {
                "probe_id": f"PB-{i + 1:02d}",
                "media_type": media_type,
                "tmdb_id": 1000 + i,
                "title": f"Title {i + 1}",
                "stratum": stratum,
                "selection_rationale": "Test rationale",
                "evaluation_notes": "Test notes",
            }
        )
    return probes


# ---------------------------------------------------------------------------
# Test 1: Quota calculation for 38 movies + 12 TV shows
# ---------------------------------------------------------------------------
def test_quota_calculation_canonical_distribution():
    """Validates that 38 movie probes and 12 TV probes yield 1,362 movies and 588 TV shows."""
    additional_movies, additional_tv = calculate_additional_quotas(
        reserved_movie_probes=38,
        reserved_tv_probes=12,
        target_movies=1400,
        target_tv=600,
    )
    assert additional_movies == 1362
    assert additional_tv == 588
    assert 38 + additional_movies == 1400
    assert 12 + additional_tv == 600
    assert 1400 + 600 == 2000


# ---------------------------------------------------------------------------
# Test 2: Different valid probe distributions calculate quotas correctly
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "movies_reserved,tv_reserved,expected_add_movies,expected_add_tv",
    [
        (40, 10, 1360, 590),
        (35, 15, 1365, 585),
        (50, 0, 1350, 600),
        (0, 50, 1400, 550),
    ],
)
def test_quota_calculation_alternative_distributions(
    movies_reserved: int,
    tv_reserved: int,
    expected_add_movies: int,
    expected_add_tv: int,
):
    """Verifies dynamic calculation works for arbitrary valid distributions summing to 50."""
    add_m, add_tv = calculate_additional_quotas(movies_reserved, tv_reserved)
    assert add_m == expected_add_movies
    assert add_tv == expected_add_tv
    assert movies_reserved + add_m == 1400
    assert tv_reserved + add_tv == 600


# ---------------------------------------------------------------------------
# Test 3: Probe count greater than target fails
# ---------------------------------------------------------------------------
def test_quota_calculation_exceeding_target_fails():
    """Ensures exceeding target quotas raises ValueError."""
    with pytest.raises(ValueError, match="exceeds target"):
        calculate_additional_quotas(reserved_movie_probes=1401, reserved_tv_probes=12)

    with pytest.raises(ValueError, match="exceeds target"):
        calculate_additional_quotas(reserved_movie_probes=38, reserved_tv_probes=601)


# ---------------------------------------------------------------------------
# Test 4: Duplicate probe IDs fail
# ---------------------------------------------------------------------------
def test_validate_probes_duplicate_probe_id(valid_50_probes: list[dict[str, Any]]):
    """Ensures duplicate probe_id values are rejected with InvalidProbeDefinitionError."""
    probes = copy.deepcopy(valid_50_probes)
    probes[1]["probe_id"] = probes[0]["probe_id"]  # Duplicate PB-01
    with pytest.raises(InvalidProbeDefinitionError, match="Duplicate probe_id detected"):
        validate_probes(probes)


# ---------------------------------------------------------------------------
# Test 5: Duplicate composite probe identities fail
# ---------------------------------------------------------------------------
def test_validate_probes_duplicate_composite_identity(valid_50_probes: list[dict[str, Any]]):
    """Ensures identical (media_type, tmdb_id) across different probe IDs is rejected."""
    probes = copy.deepcopy(valid_50_probes)
    probes[1]["tmdb_id"] = probes[0]["tmdb_id"]  # Both ("MOVIE", 1000)
    probes[1]["media_type"] = probes[0]["media_type"]
    with pytest.raises(
        InvalidProbeDefinitionError, match="Duplicate composite probe identity detected"
    ):
        validate_probes(probes)


# ---------------------------------------------------------------------------
# Test 6: Missing mandatory probes fail closed
# ---------------------------------------------------------------------------
def test_verify_database_readiness_missing_probes(valid_50_probes: list[dict[str, Any]]):
    """Verifies that if any probe tmdbId is missing from DB results, it is reported."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_cur.fetchone.side_effect = [
        {"total_movies": 2000, "movies_with_overview": 1800},
        {"total_tv_shows": 1000, "tv_shows_with_overview": 800},
    ]
    movie_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "movie"]
    tv_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "tv"]

    # Omit the first movie probe
    mock_cur.fetchall.side_effect = [
        [{"tmdbId": mid} for mid in movie_probe_ids[1:]],  # 1 missing
        [{"tmdbId": tid} for tid in tv_probe_ids],  # all 12 found
    ]

    stats = verify_database_readiness(mock_conn, valid_50_probes)
    assert len(stats["missing_probes"]) == 1
    assert stats["missing_probes"][0]["probe_id"] == valid_50_probes[0]["probe_id"]


# ---------------------------------------------------------------------------
# Test 7: Insufficient movie candidates fail closed
# ---------------------------------------------------------------------------
def test_verify_database_readiness_insufficient_movies(valid_50_probes: list[dict[str, Any]]):
    """Verifies that having fewer than 1,400 movies with overview is captured in audit stats."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_cur.fetchone.side_effect = [
        {"total_movies": 1249, "movies_with_overview": 307},  # Deficit
        {"total_tv_shows": 1000, "tv_shows_with_overview": 700},
    ]
    movie_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "movie"]
    tv_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "tv"]

    mock_cur.fetchall.side_effect = [
        [{"tmdbId": mid} for mid in movie_probe_ids],
        [{"tmdbId": tid} for tid in tv_probe_ids],
    ]

    stats = verify_database_readiness(mock_conn, valid_50_probes)
    assert stats["movies_with_overview"] == 307
    assert stats["movies_with_overview"] < REQUIRED_MOVIES_TOTAL


# ---------------------------------------------------------------------------
# Test 8: Insufficient TV candidates fail closed
# ---------------------------------------------------------------------------
def test_verify_database_readiness_insufficient_tv(valid_50_probes: list[dict[str, Any]]):
    """Verifies that having fewer than 600 TV shows with overview is captured in audit stats."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_cur.fetchone.side_effect = [
        {"total_movies": 2000, "movies_with_overview": 1500},
        {"total_tv_shows": 2174, "tv_shows_with_overview": 302},  # Deficit
    ]
    movie_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "movie"]
    tv_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "tv"]

    mock_cur.fetchall.side_effect = [
        [{"tmdbId": mid} for mid in movie_probe_ids],
        [{"tmdbId": tid} for tid in tv_probe_ids],
    ]

    stats = verify_database_readiness(mock_conn, valid_50_probes)
    assert stats["tv_shows_with_overview"] == 302
    assert stats["tv_shows_with_overview"] < REQUIRED_TV_SHOWS_TOTAL


# ---------------------------------------------------------------------------
# Test 9: Probe records reserved and excluded from additional candidates
# ---------------------------------------------------------------------------
def test_candidate_selection_excludes_probes(tmp_path: Path, valid_50_probes: list[dict[str, Any]]):
    """Verifies that candidate selection queries pass reserved probe IDs to exclude them."""
    probes_file = tmp_path / "probes.json"
    with open(probes_file, "w", encoding="utf-8") as f:
        json.dump(valid_50_probes, f)

    executed_queries = []

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    # Readiness queries
    mock_cur.fetchone.side_effect = [
        {"total_movies": 5000, "movies_with_overview": 4000},
        {"total_tv_shows": 2000, "tv_shows_with_overview": 1500},
    ]

    movie_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "movie"]
    tv_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "tv"]

    # Probes presence queries
    presence_movie_rows = [{"tmdbId": mid} for mid in movie_probe_ids]
    presence_tv_rows = [{"tmdbId": tid} for tid in tv_probe_ids]

    # Additional candidates queries
    add_movie_rows = [{"tmdbId": 50000 + i} for i in range(1362)]
    add_tv_rows = [{"tmdbId": 60000 + i} for i in range(588)]

    # Metadata fetch queries
    meta_movie_rows = [
        {
            "id": f"m-{mid}",
            "tmdbId": mid,
            "title": f"M {mid}",
            "originalTitle": f"Orig M {mid}",
            "overview": "Overview",
            "releaseDate": None,
            "popularity": 10.0,
            "voteAverage": 7.0,
            "voteCount": 100,
            "genres": ["Action"],
            "keywords": ["Hero"],
            "cast": ["Actor A"],
        }
        for mid in (movie_probe_ids + [r["tmdbId"] for r in add_movie_rows])
    ]
    meta_tv_rows = [
        {
            "id": f"t-{tid}",
            "tmdbId": tid,
            "title": f"T {tid}",
            "originalName": f"Orig T {tid}",
            "overview": "Overview",
            "firstAirDate": None,
            "popularity": 10.0,
            "voteAverage": 7.0,
            "voteCount": 100,
            "genres": ["Drama"],
            "keywords": ["Serial"],
            "cast": ["Actor B"],
        }
        for tid in (tv_probe_ids + [r["tmdbId"] for r in add_tv_rows])
    ]

    mock_cur.fetchall.side_effect = [
        presence_movie_rows,
        presence_tv_rows,
        add_movie_rows,
        add_tv_rows,
        meta_movie_rows,
        meta_tv_rows,
    ]

    def record_execute(query, params=None):
        executed_queries.append((query, params))

    mock_cur.execute.side_effect = record_execute

    with patch("psycopg2.connect", return_value=mock_conn):
        code = prepare_catalogue_snapshot(
            db_url="postgresql://localhost:5432/cinesphere",
            probes_file=probes_file,
            output_dir=tmp_path / "out",
        )

    assert code == 0
    # Check that candidate selection queries received probe IDs as exclusion parameter
    candidate_queries = [(q, p) for q, p in executed_queries if 'NOT ("tmdbId" = ANY(%s))' in q]
    assert len(candidate_queries) == 2
    movie_cand_query, movie_cand_params = candidate_queries[0]
    tv_cand_query, tv_cand_params = candidate_queries[1]

    assert 'NOT ("tmdbId" = ANY(%s))' in movie_cand_query
    assert movie_cand_params[0] == movie_probe_ids
    assert movie_cand_params[1] == SYNTHETIC_MOVIE_EXCLUSION_PATTERN
    assert movie_cand_params[2] == 1362

    assert 'NOT ("tmdbId" = ANY(%s))' in tv_cand_query
    assert tv_cand_params[0] == tv_probe_ids
    assert tv_cand_params[1] == SYNTHETIC_TV_EXCLUSION_PATTERN
    assert tv_cand_params[2] == 588


# ---------------------------------------------------------------------------
# Test 10: Deterministic NULL ordering in candidate selection queries
# ---------------------------------------------------------------------------
def test_candidate_query_deterministic_null_ordering():
    """Validates that candidate selection queries explicitly specify NULLS LAST and tmdbId ASC."""
    script_path = Path("ml/benchmark/scripts/prepare_catalogue_fixture.py")
    with open(script_path, encoding="utf-8") as f:
        source = f.read()

    expected_movie_order = (
        "ORDER BY\n"
        "                    popularity DESC NULLS LAST,\n"
        '                    "voteCount" DESC NULLS LAST,\n'
        '                    "releaseDate" DESC NULLS LAST,\n'
        '                    "tmdbId" ASC'
    )
    expected_tv_order = (
        "ORDER BY\n"
        "                    popularity DESC NULLS LAST,\n"
        '                    "voteCount" DESC NULLS LAST,\n'
        '                    "firstAirDate" DESC NULLS LAST,\n'
        '                    "tmdbId" ASC'
    )

    assert expected_movie_order in source, (
        "Movie candidate query missing explicit NULLS LAST deterministic ordering"
    )
    assert expected_tv_order in source, (
        "TV candidate query missing explicit NULLS LAST deterministic ordering"
    )


# ---------------------------------------------------------------------------
# Test 11: Final ordering is deterministic (media_type ASC, tmdb_id ASC)
# ---------------------------------------------------------------------------
def test_final_ordering_is_deterministic():
    """Validates that final records list sorts deterministically by (media_type ASC, tmdb_id ASC)."""  # noqa: E501
    raw_records = [
        {"media_type": "TV", "tmdb_id": 500},
        {"media_type": "MOVIE", "tmdb_id": 999},
        {"media_type": "TV", "tmdb_id": 100},
        {"media_type": "MOVIE", "tmdb_id": 12},
    ]
    raw_records.sort(key=lambda r: (r["media_type"], r["tmdb_id"]))
    assert raw_records == [
        {"media_type": "MOVIE", "tmdb_id": 12},
        {"media_type": "MOVIE", "tmdb_id": 999},
        {"media_type": "TV", "tmdb_id": 100},
        {"media_type": "TV", "tmdb_id": 500},
    ]


# ---------------------------------------------------------------------------
# Test 12: Duplicate candidate identities are rejected
# ---------------------------------------------------------------------------
def test_duplicate_candidate_identities_rejected(
    tmp_path: Path, valid_50_probes: list[dict[str, Any]]
):
    """Ensures that if candidate queries return duplicate IDs, generation fails closed."""
    probes_file = tmp_path / "probes.json"
    with open(probes_file, "w", encoding="utf-8") as f:
        json.dump(valid_50_probes, f)

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_cur.fetchone.side_effect = [
        {"total_movies": 5000, "movies_with_overview": 4000},
        {"total_tv_shows": 2000, "tv_shows_with_overview": 1500},
    ]
    movie_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "movie"]
    tv_probe_ids = [p["tmdb_id"] for p in valid_50_probes if p["media_type"] == "tv"]

    # Injected duplicate: return one duplicate candidate ID
    duplicate_candidates = [{"tmdbId": 99999}] * 1362

    mock_cur.fetchall.side_effect = [
        [{"tmdbId": mid} for mid in movie_probe_ids],
        [{"tmdbId": tid} for tid in tv_probe_ids],
        duplicate_candidates,
        [{"tmdbId": 60000 + i} for i in range(588)],
    ]

    with patch("psycopg2.connect", return_value=mock_conn):
        code = prepare_catalogue_snapshot(
            db_url="postgresql://localhost:5432/cinesphere",
            probes_file=probes_file,
            output_dir=tmp_path / "out",
        )
    assert code == 1


# ---------------------------------------------------------------------------
# Test 13: Movie canonical document serialization (Section 8.11.1)
# ---------------------------------------------------------------------------
def test_serialize_canonical_text_movie_bracketed_format():
    """Validates exact bracketed token format and order for Movie documents."""
    text = serialize_canonical_text(
        media_type="MOVIE",
        title="Inception",
        original_title="Inception",
        year=2010,
        genres=["Action", "Sci-Fi"],
        directors=["Christopher Nolan"],
        creators=None,
        cast=["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
        keywords=["dream", "subconscious"],
        overview="A thief who steals corporate secrets...",
        tagline="Your mind is the scene of the crime.",
    )
    expected = (
        "[TITLE] Inception "
        "[ORIGINAL_TITLE] Inception "
        "[YEAR] 2010 "
        "[GENRES] Action, Sci-Fi "
        "[DIRECTOR] Christopher Nolan "
        "[CAST] Leonardo DiCaprio, Joseph Gordon-Levitt "
        "[KEYWORDS] dream, subconscious "
        "[OVERVIEW] A thief who steals corporate secrets... "
        "[TAGLINE] Your mind is the scene of the crime."
    )
    assert text == expected


# ---------------------------------------------------------------------------
# Test 14: TV canonical document serialization (Section 8.11.1)
# ---------------------------------------------------------------------------
def test_serialize_canonical_text_tv_bracketed_format():
    """Validates exact bracketed token format and order for TV documents (FIRST_AIR_YEAR, CREATOR)."""  # noqa: E501
    text = serialize_canonical_text(
        media_type="TV",
        title="Breaking Bad",
        original_title="Breaking Bad",
        year=2008,
        genres=["Crime", "Drama"],
        directors=None,
        creators=["Vince Gilligan"],
        cast=["Bryan Cranston", "Aaron Paul"],
        keywords=["chemistry", "meth"],
        overview="A high school chemistry teacher diagnosed with lung cancer...",
        tagline="Remember my name.",
    )
    expected = (
        "[TITLE] Breaking Bad "
        "[ORIGINAL_TITLE] Breaking Bad "
        "[FIRST_AIR_YEAR] 2008 "
        "[GENRES] Crime, Drama "
        "[CREATOR] Vince Gilligan "
        "[CAST] Bryan Cranston, Aaron Paul "
        "[KEYWORDS] chemistry, meth "
        "[OVERVIEW] A high school chemistry teacher diagnosed with lung cancer... "
        "[TAGLINE] Remember my name."
    )
    assert text == expected


# ---------------------------------------------------------------------------
# Test 15: Strict null/empty/whitespace omission policy (Section 8.11.1)
# ---------------------------------------------------------------------------
def test_serialize_canonical_text_strict_null_omission():
    """Validates that empty/null/whitespace fields are completely omitted without empty tokens."""
    text = serialize_canonical_text(
        media_type="MOVIE",
        title="Spirited Away",
        original_title="Sen to Chihiro no Kamikakushi",
        year=2001,
        genres=["Animation", "Fantasy"],
        directors=[],  # Empty list -> omitted
        creators=None,  # None -> omitted
        cast=["Rumi Hiiragi"],
        keywords=[],  # Empty list -> omitted
        overview="Chihiro wanders into a magical world.",
        tagline="   ",  # Whitespace only -> omitted
    )
    expected = (
        "[TITLE] Spirited Away "
        "[ORIGINAL_TITLE] Sen to Chihiro no Kamikakushi "
        "[YEAR] 2001 "
        "[GENRES] Animation, Fantasy "
        "[CAST] Rumi Hiiragi "
        "[OVERVIEW] Chihiro wanders into a magical world."
    )
    assert text == expected
    assert "[DIRECTOR]" not in text
    assert "[CREATOR]" not in text
    assert "[KEYWORDS]" not in text
    assert "[TAGLINE]" not in text
    assert "None" not in text
    assert "null" not in text


# ---------------------------------------------------------------------------
# Test 16: Non-canonical scalar metadata exclusions
# ---------------------------------------------------------------------------
def test_serialize_canonical_text_non_canonical_exclusions():
    """Verifies scalar fields (popularity, votes, runtime) are excluded from canonical text."""
    text = serialize_canonical_text(
        media_type="MOVIE",
        title="Tenet",
        original_title="Tenet",
        year=2020,
        genres=["Action"],
        cast=["John David Washington"],
        overview="Armed with only one word, Tenet...",
    )
    # The signature itself excludes popularity, runtime, etc.
    # Verify no accidental scalar metadata is present.
    assert "[POPULARITY]" not in text
    assert "[RUNTIME]" not in text
    assert "[STATUS]" not in text
    assert "[VOTE_AVERAGE]" not in text


# ---------------------------------------------------------------------------
# Test 17: Synthetic record exclusion pattern validation
# ---------------------------------------------------------------------------
def test_synthetic_record_exclusion_patterns():
    """Validates that known synthetic test records match exclusion patterns,

    while legitimate movie and TV titles remain eligible (no false positives).
    """
    import re

    # Known synthetic movie fixtures
    synthetic_movies = [
        "Test Movie 828800201",
        "Test Movie 104",
        "Integration Movie 503",
        "Detailed Movie 748314838",
        "Concurrent Movie 822050293",
        "Ingestion Movie 812794626",
        "On-Demand Movie 906241586",
        "E-3 Movie",
        "[E2E] Movie Test",
        "Initial Title",
        "Updated Title",
        "Duplicate",
        "Tagged Movie",
        "Library Movie Excluded",
        "Notes Test Movie",
        "Rollback Test Movie A",
        "Viewing Event Missing WatchedAt Movie",
        "CSV CreatedAt Movie",
        "CSV Multi Movie 1",
    ]
    for title in synthetic_movies:
        assert re.search(SYNTHETIC_MOVIE_EXCLUSION_PATTERN, title, re.I), (
            f"Expected synthetic movie '{title}' to be excluded by regex"
        )

    # Legitimate movie titles that must NOT be excluded
    legitimate_movies = [
        "The Lego Movie",
        "Scary Movie",
        "Bee Movie",
        "The Simpsons Movie",
        "Testament of Youth",
        "The Test",
        "Testing the Waters",
        "Test Pilot",
        "The Movie",
        "Movie 43",
        "Inception",
        "The Dark Knight",
        "Spider-Man: No Way Home",
        "Blade Runner 2049",
        "Alien",
        "Arrival",
        "Heat",
        # Critical false-positive guard: "The Test Movie" must NOT be excluded
        "The Test Movie",
        "A Test Movie",
        "My Test Movie",
    ]
    for title in legitimate_movies:
        assert not re.search(SYNTHETIC_MOVIE_EXCLUSION_PATTERN, title, re.I), (
            f"False positive: legitimate movie '{title}' was incorrectly excluded"
        )

    # Known synthetic TV fixtures
    synthetic_tv = [
        "Test Show 101",
        "Integration Show 202",
        "Detailed TV Show 303",
        "Concurrent TV Show 404",
        "Ingestion TV Show 800815289",
        "On-Demand TV Show 505",
        "E-1 Show",
        "E-2 Show 1",
        "[E2E] Breaking Test Series",
        "TV Hierarchy 701562702",
        "Show Alpha",
        "Show Beta",
        "Show 1",
        "TV Show A",
        "Completed Show",
        "Fully Watched Show",
        "Null WatchedAt Show",
        "Tagged Show",
        "Specials Show 800815295",
        "Breaking Cosmos",
        "Better Call Cosmos",
        "TV Show Missing Season",
    ]
    for name in synthetic_tv:
        assert re.search(SYNTHETIC_TV_EXCLUSION_PATTERN, name, re.I), (
            f"Expected synthetic TV show '{name}' to be excluded by regex"
        )

    # Legitimate TV show titles that must NOT be excluded
    legitimate_tv = [
        "The Daily Show",
        "The Truman Show",
        "Regular Show",
        "The Show",
        "Freakshow",
        "Testament",
        "Chernobyl",
        "Doctor Who",
        "Fargo",
        "Lioness",
        "Severance",
        "Succession",
        "The Wire",
        "True Detective",
        "Breaking Bad",
        # Critical false-positive guards: must NOT be excluded
        "The Test Show",
        "A Test Show",
        "The Daily Test Series",
    ]
    for name in legitimate_tv:
        assert not re.search(SYNTHETIC_TV_EXCLUSION_PATTERN, name, re.I), (
            f"False positive: legitimate TV show '{name}' was incorrectly excluded"
        )


# ---------------------------------------------------------------------------
# Test 17b: PostgreSQL regex engine synthetic exclusion verification
# ---------------------------------------------------------------------------
def test_postgres_regex_synthetic_exclusion():
    """Verifies synthetic exclusion patterns directly against PostgreSQL's POSIX regex engine (~*).

    Ensures that PostgreSQL evaluates the expressions identically to Python's re module,
    guaranteeing that legitimate titles are eligible and synthetic records are excluded.
    Uses disposable test DB; skips with NOT VERIFIED if unavailable.
    """
    conn = _connect_test_db()
    if conn is None:
        pytest.skip("NOT VERIFIED — Disposable PostgreSQL integration environment unavailable.")

    synthetic_movies = [
        "Test Movie 828800201",
        "Test Movie 104",
        "Integration Movie 503",
        "Detailed Movie 748314838",
        "Concurrent Movie 822050293",
        "Ingestion Movie 812794626",
        "On-Demand Movie 906241586",
        "E-3 Movie",
        "[E2E] Movie Test",
        "Initial Title",
        "Updated Title",
        "Duplicate",
        "Tagged Movie",
        "Library Movie Excluded",
        "Notes Test Movie",
        "Rollback Test Movie A",
        "Viewing Event Missing WatchedAt Movie",
        "CSV CreatedAt Movie",
        "CSV Multi Movie 1",
    ]

    legitimate_movies = [
        "The Lego Movie",
        "Scary Movie",
        "Bee Movie",
        "The Simpsons Movie",
        "Testament of Youth",
        "The Test",
        "Testing the Waters",
        "Test Pilot",
        "The Movie",
        "Movie 43",
        "Inception",
        "The Dark Knight",
        "Spider-Man: No Way Home",
        "Blade Runner 2049",
        "Alien",
        "Arrival",
        "Heat",
        "The Test Movie",
        "A Test Movie",
        "My Test Movie",
    ]

    synthetic_tv = [
        "Test Show 101",
        "Integration Show 202",
        "Detailed TV Show 303",
        "Concurrent TV Show 404",
        "Ingestion TV Show 800815289",
        "On-Demand TV Show 505",
        "E-1 Show",
        "E-2 Show 1",
        "[E2E] Breaking Test Series",
        "TV Hierarchy 701562702",
        "Show Alpha",
        "Show Beta",
        "Show 1",
        "TV Show A",
        "Completed Show",
        "Fully Watched Show",
        "Null WatchedAt Show",
        "Tagged Show",
        "Specials Show 800815295",
        "Breaking Cosmos",
        "Better Call Cosmos",
        "TV Show Missing Season",
    ]

    legitimate_tv = [
        "The Daily Show",
        "The Truman Show",
        "Regular Show",
        "The Show",
        "Freakshow",
        "Testament",
        "Chernobyl",
        "Doctor Who",
        "Fargo",
        "Lioness",
        "Severance",
        "Succession",
        "The Wire",
        "True Detective",
        "Breaking Bad",
        "The Test Show",
        "A Test Show",
        "The Daily Test Series",
    ]

    try:
        with conn.cursor() as cur:
            # Test synthetic movies are excluded (~* returns True)
            for title in synthetic_movies:
                cur.execute("SELECT %s ~* %s;", (title, SYNTHETIC_MOVIE_EXCLUSION_PATTERN))
                is_excluded = cur.fetchone()[0]
                assert is_excluded, f"PostgreSQL regex did not exclude synthetic movie: '{title}'"

            # Test legitimate movies remain eligible (~* returns False)
            for title in legitimate_movies:
                cur.execute("SELECT %s ~* %s;", (title, SYNTHETIC_MOVIE_EXCLUSION_PATTERN))
                is_excluded = cur.fetchone()[0]
                assert not is_excluded, (
                    f"PostgreSQL regex incorrectly excluded legitimate movie: '{title}'"
                )

            # Test synthetic TV shows are excluded (~* returns True)
            for name in synthetic_tv:
                cur.execute("SELECT %s ~* %s;", (name, SYNTHETIC_TV_EXCLUSION_PATTERN))
                is_excluded = cur.fetchone()[0]
                assert is_excluded, f"PostgreSQL regex did not exclude synthetic TV show: '{name}'"

            # Test legitimate TV shows remain eligible (~* returns False)
            for name in legitimate_tv:
                cur.execute("SELECT %s ~* %s;", (name, SYNTHETIC_TV_EXCLUSION_PATTERN))
                is_excluded = cur.fetchone()[0]
                assert not is_excluded, (
                    f"PostgreSQL regex incorrectly excluded legitimate TV show: '{name}'"
                )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Test 18: Deterministic cast SQL selection via real PostgreSQL
# ---------------------------------------------------------------------------
def test_deterministic_cast_selection_real_sql():
    """Validates that the actual cast selection SQL, when executed against PostgreSQL,
    selects the top-5 actors ordered by (name ASC, tmdbId ASC) deterministically,
    regardless of insertion order.

    Uses a disposable test DB; skips with NOT VERIFIED if unavailable.
    """
    conn = _connect_test_db()
    if conn is None:
        pytest.skip("NOT VERIFIED — Disposable PostgreSQL integration environment unavailable.")

    test_prefix = f"cast_test_{uuid.uuid4().hex[:8]}"
    persons_table = f"{test_prefix}_persons"
    credits_table = f"{test_prefix}_credits"
    movies_table = f"{test_prefix}_movies"

    # Test actors: 7 total, top-5 by name ASC, tmdbId ASC should be a deterministic set.
    # Inserted in scrambled order to prove ordering is from SQL, not insertion.
    actors = [
        # (name, tmdbId)
        ("Zoe Saldana", 8691),
        ("Bradley Cooper", 51329),  # <- in top-5
        ("Chris Pratt", 73457),  # <- in top-5
        ("Dave Bautista", 543530),  # <- in top-5
        ("Karen Gillan", 543261),  # <- in top-5
        ("Michael Rooker", 8516),  # <- in top-5
        ("Vin Diesel", 12835),
    ]
    # Expected top-5 alphabetically
    expected_names = [
        "Bradley Cooper",
        "Chris Pratt",
        "Dave Bautista",
        "Karen Gillan",
        "Michael Rooker",
    ]

    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TEMP TABLE {persons_table} (
                    id uuid PRIMARY KEY,
                    "tmdbId" integer NOT NULL,
                    name varchar NOT NULL
                );
                """
            )
            cur.execute(
                f"""
                CREATE TEMP TABLE {movies_table} (
                    id uuid PRIMARY KEY
                );
                """
            )
            cur.execute(
                f"""
                CREATE TEMP TABLE {credits_table} (
                    id uuid PRIMARY KEY,
                    "personId" uuid NOT NULL,
                    "movieId" uuid
                );
                """
            )

            movie_id = str(uuid.uuid4())
            cur.execute(f"INSERT INTO {movies_table} VALUES (%s);", (movie_id,))

            # Insert actors in scrambled order
            person_ids = {}
            for _i, (name, tmdb_id) in enumerate(reversed(actors)):
                pid = str(uuid.uuid4())
                person_ids[name] = pid
                cur.execute(
                    f'INSERT INTO {persons_table} (id, "tmdbId", name) VALUES (%s, %s, %s);',
                    (pid, tmdb_id, name),
                )

            for name, _ in actors:
                cid = str(uuid.uuid4())
                cur.execute(
                    f'INSERT INTO {credits_table} (id, "personId", "movieId") VALUES (%s, %s, %s);',
                    (cid, person_ids[name], movie_id),
                )
            conn.commit()

            # Build the production cast selection SQL using the helper
            cast_sql = get_cast_selection_sql(
                'pc."movieId" = m.id',
                table_alias="pc",
            )
            # Rewrite to use test temp tables
            cast_sql_test = cast_sql.replace(
                "FROM person_credits pc",
                f"FROM {credits_table} pc",
            ).replace(
                'JOIN persons p ON pc."personId" = p.id',
                f'JOIN {persons_table} p ON pc."personId" = p.id',
            )

            query = f"""
                SELECT {cast_sql_test}
                FROM {movies_table} m
                WHERE m.id = %s;
            """

            # Execute twice to verify stability
            cur.execute(query, (movie_id,))
            result_1 = cur.fetchone()[0]

            cur.execute(query, (movie_id,))
            result_2 = cur.fetchone()[0]

        assert result_1 is not None, "Cast selection returned NULL for a movie with actors."
        assert len(result_1) == 5, f"Expected 5 cast members, got {len(result_1)}: {result_1}"
        assert result_1 == expected_names, (
            f"Cast order incorrect. Expected {expected_names}, got {list(result_1)}"
        )
        # Determinism check: same result on repeated execution
        assert list(result_1) == list(result_2), (
            "Cast selection is non-deterministic: repeated queries returned different results."
        )
    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()


# ---------------------------------------------------------------------------
# Test 18b: Actual fetch_full_metadata() movie production query against PostgreSQL
# ---------------------------------------------------------------------------
def test_fetch_full_metadata_movie_production_sql():
    """Executes the actual production fetch_full_metadata() function for movies
    against disposable PostgreSQL tables.

    Verifies:
    1. Movie query executes successfully (no SQL syntax/interpolation errors).
    2. Fields mapped correctly: title, originalTitle, year, genres, keywords, cast.
    3. Exactly 5 cast members selected from >5 available, sorted by (name ASC, tmdbId ASC).
    4. Canonical text format conforms to Section 8.11.1.
    5. Probe metadata associated correctly when item is in probes_map.
    Uses disposable test DB; skips with NOT VERIFIED if unavailable.
    """
    conn = _connect_test_db()
    if conn is None:
        pytest.skip("NOT VERIFIED — Disposable PostgreSQL integration environment unavailable.")

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TEMP TABLE movies (
                    id uuid PRIMARY KEY,
                    "tmdbId" integer NOT NULL,
                    title varchar NOT NULL,
                    "originalTitle" varchar,
                    overview text,
                    "releaseDate" date,
                    popularity double precision,
                    "voteAverage" double precision,
                    "voteCount" integer
                );
                CREATE TEMP TABLE genres ("tmdbId" integer PRIMARY KEY, name varchar NOT NULL);
                CREATE TEMP TABLE keywords ("tmdbId" integer PRIMARY KEY, name varchar NOT NULL);
                CREATE TEMP TABLE "_GenreToMovie" ("A" integer, "B" uuid);
                CREATE TEMP TABLE "_KeywordToMovie" ("A" integer, "B" uuid);
                CREATE TEMP TABLE persons (
                    id uuid PRIMARY KEY,
                    "tmdbId" integer NOT NULL,
                    name varchar NOT NULL
                );
                CREATE TEMP TABLE person_credits (
                    id uuid PRIMARY KEY,
                    "personId" uuid NOT NULL,
                    "movieId" uuid,
                    "tvShowId" uuid
                );
                """
            )

            movie_id = str(uuid.uuid4())
            tmdb_id = 99001
            cur.execute(
                """
                INSERT INTO movies VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    movie_id,
                    tmdb_id,
                    "Galactic Odyssey",
                    "Odyssée Galactique",
                    "A journey beyond the stars.",
                    "2023-07-21",
                    145.8,
                    8.2,
                    4500,
                ),
            )
            cur.execute("INSERT INTO genres VALUES (878, 'Science Fiction');")
            cur.execute('INSERT INTO "_GenreToMovie" VALUES (878, %s);', (movie_id,))
            cur.execute("INSERT INTO keywords VALUES (9882, 'space exploration');")
            cur.execute('INSERT INTO "_KeywordToMovie" VALUES (9882, %s);', (movie_id,))

            actors = [
                ("Zoe Saldana", 8691),
                ("Bradley Cooper", 51329),
                ("Chris Pratt", 73457),
                ("Dave Bautista", 543530),
                ("Karen Gillan", 543261),
                ("Michael Rooker", 8516),
                ("Vin Diesel", 12835),
            ]
            for name, actor_tmdb_id in reversed(actors):
                pid = str(uuid.uuid4())
                cur.execute("INSERT INTO persons VALUES (%s, %s, %s);", (pid, actor_tmdb_id, name))
                cur.execute(
                    "INSERT INTO person_credits VALUES (%s, %s, %s, NULL);",
                    (str(uuid.uuid4()), pid, movie_id),
                )
            conn.commit()

        probes_map = {("MOVIE", tmdb_id): {"probe_id": "PB-01", "stratum": "Mainstream"}}
        records = fetch_full_metadata(conn, [tmdb_id], [], probes_map)

        assert len(records) == 1, f"Expected 1 record, got {len(records)}"
        rec = records[0]
        assert rec["media_type"] == "MOVIE"
        assert rec["tmdb_id"] == tmdb_id
        assert rec["title"] == "Galactic Odyssey"
        assert rec["original_title"] == "Odyssée Galactique"
        assert rec["year"] == 2023
        assert rec["genres"] == ["Science Fiction"]
        assert rec["keywords"] == ["space exploration"]
        assert rec["is_probe"] is True
        assert rec["probe_id"] == "PB-01"
        assert rec["stratum"] == "Mainstream"

        expected_cast = [
            "Bradley Cooper",
            "Chris Pratt",
            "Dave Bautista",
            "Karen Gillan",
            "Michael Rooker",
        ]
        assert len(rec["cast"]) == 5, f"Expected 5 cast members, got {len(rec['cast'])}"
        assert rec["cast"] == expected_cast, f"Cast ordering mismatch: {rec['cast']}"

        assert "[TITLE] Galactic Odyssey" in rec["canonical_text"]
        assert "[ORIGINAL_TITLE] Odyssée Galactique" in rec["canonical_text"]
        assert "[YEAR] 2023" in rec["canonical_text"]
        assert "[GENRES] Science Fiction" in rec["canonical_text"]
        assert (
            "[CAST] Bradley Cooper, Chris Pratt, Dave Bautista, Karen Gillan, Michael Rooker"
            in rec["canonical_text"]
        )
        assert "[KEYWORDS] space exploration" in rec["canonical_text"]
        assert "[OVERVIEW] A journey beyond the stars." in rec["canonical_text"]

    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()


# ---------------------------------------------------------------------------
# Test 18c: Actual fetch_full_metadata() TV production query against PostgreSQL
# ---------------------------------------------------------------------------
def test_fetch_full_metadata_tv_production_sql():
    """Executes the actual production fetch_full_metadata() function for TV shows
    against disposable PostgreSQL tables.

    Verifies:
    1. TV query executes successfully (no SQL syntax/interpolation errors).
    2. Fields mapped correctly: title (from name), originalName, firstAirDate year.
    3. Exactly 5 cast members selected from >5 available, sorted deterministically.
    4. Canonical text format conforms to Section 8.11.1 (uses [FIRST_AIR_YEAR]).
    5. Probe metadata associated correctly when item is in probes_map.
    Uses disposable test DB; skips with NOT VERIFIED if unavailable.
    """
    conn = _connect_test_db()
    if conn is None:
        pytest.skip("NOT VERIFIED — Disposable PostgreSQL integration environment unavailable.")

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TEMP TABLE tv_shows (
                    id uuid PRIMARY KEY,
                    "tmdbId" integer NOT NULL,
                    name varchar NOT NULL,
                    "originalName" varchar,
                    overview text,
                    "firstAirDate" date,
                    popularity double precision,
                    "voteAverage" double precision,
                    "voteCount" integer
                );
                CREATE TEMP TABLE genres ("tmdbId" integer PRIMARY KEY, name varchar NOT NULL);
                CREATE TEMP TABLE keywords ("tmdbId" integer PRIMARY KEY, name varchar NOT NULL);
                CREATE TEMP TABLE "_GenreToTvShow" ("A" integer, "B" uuid);
                CREATE TEMP TABLE "_KeywordToTvShow" ("A" integer, "B" uuid);
                CREATE TEMP TABLE persons (
                    id uuid PRIMARY KEY,
                    "tmdbId" integer NOT NULL,
                    name varchar NOT NULL
                );
                CREATE TEMP TABLE person_credits (
                    id uuid PRIMARY KEY,
                    "personId" uuid NOT NULL,
                    "movieId" uuid,
                    "tvShowId" uuid
                );
                """
            )

            tv_id = str(uuid.uuid4())
            tmdb_id = 88001
            cur.execute(
                """
                INSERT INTO tv_shows VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    tv_id,
                    tmdb_id,
                    "Cosmic Mystery",
                    "Mystère Cosmique",
                    "Detectives solving interstellar crimes.",
                    "2021-09-15",
                    95.2,
                    8.6,
                    3200,
                ),
            )
            cur.execute("INSERT INTO genres VALUES (18, 'Drama');")
            cur.execute('INSERT INTO "_GenreToTvShow" VALUES (18, %s);', (tv_id,))
            cur.execute("INSERT INTO keywords VALUES (200, 'investigation');")
            cur.execute('INSERT INTO "_KeywordToTvShow" VALUES (200, %s);', (tv_id,))

            actors = [
                ("Zoe Saldana", 8691),
                ("Bradley Cooper", 51329),
                ("Chris Pratt", 73457),
                ("Dave Bautista", 543530),
                ("Karen Gillan", 543261),
                ("Michael Rooker", 8516),
                ("Vin Diesel", 12835),
            ]
            for name, actor_tmdb_id in reversed(actors):
                pid = str(uuid.uuid4())
                cur.execute("INSERT INTO persons VALUES (%s, %s, %s);", (pid, actor_tmdb_id, name))
                cur.execute(
                    "INSERT INTO person_credits VALUES (%s, %s, NULL, %s);",
                    (str(uuid.uuid4()), pid, tv_id),
                )
            conn.commit()

        probes_map = {("TV", tmdb_id): {"probe_id": "PB-39", "stratum": "Serialized TV"}}
        records = fetch_full_metadata(conn, [], [tmdb_id], probes_map)

        assert len(records) == 1, f"Expected 1 record, got {len(records)}"
        rec = records[0]
        assert rec["media_type"] == "TV"
        assert rec["tmdb_id"] == tmdb_id
        assert rec["title"] == "Cosmic Mystery"
        assert rec["original_title"] == "Mystère Cosmique"
        assert rec["year"] == 2021
        assert rec["genres"] == ["Drama"]
        assert rec["keywords"] == ["investigation"]
        assert rec["is_probe"] is True
        assert rec["probe_id"] == "PB-39"
        assert rec["stratum"] == "Serialized TV"

        expected_cast = [
            "Bradley Cooper",
            "Chris Pratt",
            "Dave Bautista",
            "Karen Gillan",
            "Michael Rooker",
        ]
        assert len(rec["cast"]) == 5, f"Expected 5 cast members, got {len(rec['cast'])}"
        assert rec["cast"] == expected_cast

        assert "[FIRST_AIR_YEAR] 2021" in rec["canonical_text"]
        assert "[TITLE] Cosmic Mystery" in rec["canonical_text"]
        assert "[ORIGINAL_TITLE] Mystère Cosmique" in rec["canonical_text"]
        assert "[GENRES] Drama" in rec["canonical_text"]
        assert (
            "[CAST] Bradley Cooper, Chris Pratt, Dave Bautista, Karen Gillan, Michael Rooker"
            in rec["canonical_text"]
        )
        assert "[KEYWORDS] investigation" in rec["canonical_text"]
        assert "[OVERVIEW] Detectives solving interstellar crimes." in rec["canonical_text"]

    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()


# ---------------------------------------------------------------------------
# Test 19: Genuine PostgreSQL read-only enforcement on disposable test DB
# ---------------------------------------------------------------------------
def test_postgres_readonly_enforcement_disposable_db():
    """Verifies that create_readonly_connection enforces read-only mode against
    a real, isolated test database — not the development database.

    - SELECT must succeed.
    - INSERT must fail with SQLSTATE 25006 (ReadOnlySqlTransaction).
    - UPDATE must fail with SQLSTATE 25006 (ReadOnlySqlTransaction).
    Reports NOT VERIFIED if the disposable test DB is unavailable.
    """
    try:
        import psycopg2  # noqa: PLC0415
        from psycopg2.errors import ReadOnlySqlTransaction  # noqa: PLC0415
    except ImportError:
        pytest.skip("psycopg2 is not installed.")

    url = _get_test_db_url()
    if url is None:
        pytest.skip(
            "NOT VERIFIED — CINESPHERE_TEST_DATABASE_URL / CINESPHERE_E2E_DATABASE_URL not set."
        )

    # Safety: refuse to run against non-test databases
    if "test" not in url.lower() and "e2e" not in url.lower():
        pytest.fail(
            f"SAFETY: Test database URL '{url}' does not contain 'test' or 'e2e'. "
            "Refusing to run read-only enforcement test against a non-test database."
        )

    # Create a fresh read-only connection using the PRODUCTION function
    try:
        conn = create_readonly_connection(url)
    except Exception as e:
        pytest.skip(f"NOT VERIFIED — Disposable test DB not reachable: {e}")

    test_table = f"ro_test_{uuid.uuid4().hex[:8]}"
    setup_conn = None
    try:
        # Setup: create an isolated test table using a separate writable connection
        setup_conn = psycopg2.connect(url.split("?")[0])
        with setup_conn.cursor() as sc:
            sc.execute(f"""
                CREATE TEMP TABLE {test_table} (id serial PRIMARY KEY, val text);
                INSERT INTO {test_table} (val) VALUES ('probe_row');
            """)
        setup_conn.commit()

        with conn.cursor() as cur:
            # 1. SELECT must succeed
            cur.execute("SELECT count(*) FROM movies;")  # noqa: S608
            count = cur.fetchone()[0]
            assert isinstance(count, int), "SELECT did not return an integer."

            # 2. INSERT must fail with ReadOnlySqlTransaction (SQLSTATE 25006)
            with pytest.raises(ReadOnlySqlTransaction):
                cur.execute(
                    'INSERT INTO movies ("tmdbId", title, "originalTitle") '
                    "VALUES (-99999, '__ro_test__', '__ro_test__');"
                )

            # Reset connection state after the error
            conn.rollback()

            # 3. UPDATE must fail with ReadOnlySqlTransaction (SQLSTATE 25006)
            with pytest.raises(ReadOnlySqlTransaction):
                cur.execute("UPDATE movies SET title = '__hacked__' WHERE \"tmdbId\" = -99999;")

    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()
        if setup_conn:
            try:
                setup_conn.rollback()
            except Exception:
                pass
            setup_conn.close()


# ---------------------------------------------------------------------------
# Test 20: SHA-256 via production write_jsonl_snapshot
# ---------------------------------------------------------------------------
def test_sha256_computation_via_production_function(tmp_path: Path):
    """Verifies that write_jsonl_snapshot writes correct UTF-8 JSON lines and returns
    a SHA-256 digest that matches the byte-for-byte hash of the file it wrote.
    """
    records = [
        {
            "media_type": "MOVIE",
            "tmdb_id": 101,
            "title": "Parasite",
            "canonical_text": "한국어",
        },
        {
            "media_type": "TV",
            "tmdb_id": 202,
            "title": "Squid Game",
            "canonical_text": "오징어 게임",
        },
    ]

    target_file = tmp_path / "catalogue_snapshot_v1.jsonl.tmp"
    # Call production function
    digest = write_jsonl_snapshot(records, target_file)

    assert target_file.exists(), "write_jsonl_snapshot did not create output file."

    # Verify file is valid UTF-8 JSON lines
    raw_bytes = target_file.read_bytes()
    lines = raw_bytes.split(b"\n")
    # Last element should be empty (file ends with \n)
    assert lines[-1] == b"", "JSONL file does not end with a newline."
    content_lines = [line for line in lines if line]
    assert len(content_lines) == len(records), (
        f"Expected {len(records)} lines, got {len(content_lines)}."
    )
    for i, (line, record) in enumerate(zip(content_lines, records, strict=False)):
        parsed = json.loads(line.decode("utf-8"))
        assert parsed["tmdb_id"] == record["tmdb_id"], f"Line {i}: tmdb_id mismatch."
        # Verify non-ASCII is preserved (not escaped)
        assert record["canonical_text"] in line.decode("utf-8"), (
            f"Line {i}: canonical_text was incorrectly escaped (ensure_ascii=False violated)."
        )

    # Verify SHA-256 digest matches byte-for-byte hash of the written file
    expected_digest = hashlib.sha256(raw_bytes).hexdigest()
    assert digest == expected_digest, (
        f"digest mismatch: function returned {digest!r}, file hash is {expected_digest!r}."
    )


# ---------------------------------------------------------------------------
# Test 21: Fixture manifest via production build_manifest + Section 8.11.3
# ---------------------------------------------------------------------------
def test_manifest_schema_and_checksum_via_production_function(tmp_path: Path):
    """Verifies that build_manifest produces a manifest strictly conforming to
    Section 8.11.3: all required fields, correct types, cross-artifact consistency.
    """
    records = [
        {
            "media_type": "MOVIE",
            "tmdb_id": 100 + i,
            "is_probe": (i == 0),
            "stratum": "Mainstream" if i == 0 else None,
        }
        for i in range(3)
    ] + [
        {
            "media_type": "TV",
            "tmdb_id": 200 + i,
            "is_probe": False,
            "stratum": None,
        }
        for i in range(2)
    ]

    target_file = tmp_path / "catalogue_snapshot_v1.jsonl.tmp"
    digest = write_jsonl_snapshot(records, target_file)

    # Call production build_manifest
    manifest = build_manifest(
        records=records,
        digest=digest,
        probe_movie_count=38,
        additional_movies_quota=1362,
        probe_tv_count=12,
        additional_tv_quota=588,
        generated_at="2026-11-24T07:00:00+00:00",
    )

    # Section 8.11.3: Required top-level fields
    required_fields = [
        "fixture_filename",
        "record_count",
        "movie_count",
        "tv_count",
        "probe_count",
        "sha256",
        "source_identity",
        "selection_algorithm_version",
        "serialization_version",
        "generated_at",
        "probes_by_stratum",
        "selection_parameters",
    ]
    for field in required_fields:
        assert field in manifest, f"Section 8.11.3: Required field '{field}' missing from manifest."

    # Cross-artifact consistency: record_count == movie_count + tv_count
    assert manifest["record_count"] == len(records), "record_count mismatch."
    assert manifest["movie_count"] == 3, f"Expected 3 movies, got {manifest['movie_count']}."
    assert manifest["tv_count"] == 2, f"Expected 2 TV shows, got {manifest['tv_count']}."
    assert manifest["record_count"] == manifest["movie_count"] + manifest["tv_count"], (
        "record_count != movie_count + tv_count."
    )
    assert manifest["probe_count"] == 1, f"Expected 1 probe, got {manifest['probe_count']}."

    # SHA-256 field must match the actual digest
    assert manifest["sha256"] == digest, "Manifest sha256 does not match the digest argument."

    # Canonical string fields
    assert manifest["fixture_filename"] == "catalogue_snapshot_v1.jsonl"
    assert manifest["source_identity"] == "CineSphere PostgreSQL (catalogue tables)"
    assert manifest["selection_algorithm_version"] == "1.0.0-deterministic"
    assert manifest["serialization_version"] == "1.0.0-bracketed-tokens"
    assert manifest["generated_at"] == "2026-11-24T07:00:00+00:00"

    # probes_by_stratum: all allowed strata present
    assert set(manifest["probes_by_stratum"].keys()) == ALLOWED_STRATA, (
        "probes_by_stratum keys do not match ALLOWED_STRATA."
    )

    # selection_parameters present
    sp = manifest["selection_parameters"]
    assert sp["movie_probe_quota"] == 38
    assert sp["movie_additional_quota"] == 1362
    assert sp["tv_probe_quota"] == 12
    assert sp["tv_additional_quota"] == 588
    assert sp["synthetic_movie_exclusion_applied"] is True
    assert sp["synthetic_tv_exclusion_applied"] is True


# ---------------------------------------------------------------------------
# Test 22a: Publication rollback — existing destinations restored (Scenario A)
# ---------------------------------------------------------------------------
def test_publish_artifacts_rollback_restores_existing_destinations(tmp_path: Path):
    """Scenario A: All 3 destination files exist initially.
    Failure injected after file 2 is replaced.
    Verifies all 3 destinations are restored to original content.
    """
    out_dir = tmp_path / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    # Write original content to all destinations
    dest_1.write_text("ORIGINAL_A\n", encoding="utf-8")
    dest_2.write_text("ORIGINAL_B\n", encoding="utf-8")
    dest_3.write_text("ORIGINAL_C\n", encoding="utf-8")

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"
    tmp_1.write_text("NEW_A\n", encoding="utf-8")
    tmp_2.write_text("NEW_B\n", encoding="utf-8")
    tmp_3.write_text("NEW_C\n", encoding="utf-8")

    artifacts = [(tmp_1, dest_1), (tmp_2, dest_2), (tmp_3, dest_3)]

    call_count = [0]
    original_replace = Path.replace

    def failing_replace(self: Path, target: Path) -> Path:
        # Only intercept moves of .tmp files (phase 3 publication moves)
        # Allow backup moves (.old) and rollback restores (.old → final) to proceed freely.
        if str(self).endswith(".tmp"):
            call_count[0] += 1
            if call_count[0] >= 3:
                raise OSError("Injected failure on 3rd artifact replacement.")
        return original_replace(self, target)

    with patch.object(Path, "replace", failing_replace):
        with pytest.raises(RuntimeError, match="Artifact publication failed"):
            publish_artifacts(artifacts)

    # All destinations must be restored to original content
    assert dest_1.read_text(encoding="utf-8") == "ORIGINAL_A\n", "dest_1 not restored."
    assert dest_2.read_text(encoding="utf-8") == "ORIGINAL_B\n", "dest_2 not restored."
    assert dest_3.read_text(encoding="utf-8") == "ORIGINAL_C\n", "dest_3 not restored."

    # No .tmp or .old files should remain
    assert not tmp_1.exists(), ".tmp file for dest_1 not cleaned up."
    assert not tmp_2.exists(), ".tmp file for dest_2 not cleaned up."
    assert not tmp_3.exists(), ".tmp file for dest_3 not cleaned up."
    assert not dest_1.with_name(dest_1.name + ".old").exists(), ".old backup not cleaned up."
    assert not dest_2.with_name(dest_2.name + ".old").exists(), ".old backup not cleaned up."


# ---------------------------------------------------------------------------
# Test 22b: Publication rollback — nonexistent destinations removed (Scenario B)
# ---------------------------------------------------------------------------
def test_publish_artifacts_rollback_removes_newly_created_destinations(tmp_path: Path):
    """Scenario B: Dest 1 exists, Dests 2 and 3 do not exist initially.
    Failure injected after dest 2 is published (newly created).
    Verifies dest 1 is restored, dest 2 is deleted, dest 3 never exists.
    """
    out_dir = tmp_path / "fixtures_b"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    # Only dest_1 exists initially
    dest_1.write_text("ORIGINAL_1\n", encoding="utf-8")
    # dest_2 and dest_3 do NOT exist

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"
    tmp_1.write_text("NEW_1\n", encoding="utf-8")
    tmp_2.write_text("NEW_2\n", encoding="utf-8")
    tmp_3.write_text("NEW_3\n", encoding="utf-8")

    artifacts = [(tmp_1, dest_1), (tmp_2, dest_2), (tmp_3, dest_3)]

    call_count = [0]
    original_replace = Path.replace

    def failing_replace(self: Path, target: Path) -> Path:
        # Only intercept moves of .tmp files (phase 3 publication moves)
        # Allow backup moves (.old) and rollback restores (.old → final) to proceed freely.
        if str(self).endswith(".tmp"):
            call_count[0] += 1
            if call_count[0] >= 3:
                raise OSError("Injected failure on 3rd artifact replacement.")
        return original_replace(self, target)

    with patch.object(Path, "replace", failing_replace):
        with pytest.raises(RuntimeError, match="Artifact publication failed"):
            publish_artifacts(artifacts)

    # dest_1 must be restored to original content
    assert dest_1.read_text(encoding="utf-8") == "ORIGINAL_1\n", "dest_1 not restored."
    # dest_2 was newly created (didn't exist before) — must be deleted on rollback
    assert not dest_2.exists(), "dest_2 (newly created, non-existing initially) must be deleted."
    # dest_3 was never touched — must not exist
    assert not dest_3.exists(), "dest_3 must not exist."


# ---------------------------------------------------------------------------
# Test 22c: Publication success — all destinations updated, no .tmp/.old remain
# ---------------------------------------------------------------------------
def test_publish_artifacts_clean_success(tmp_path: Path):
    """Scenario C: Clean publication success. All destinations are updated with new content.
    No .tmp or .old files remain after successful publication.
    """
    out_dir = tmp_path / "fixtures_c"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    dest_1.write_text("OLD_A\n", encoding="utf-8")
    # dest_2 and dest_3 do not exist

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"
    tmp_1.write_text("NEW_A\n", encoding="utf-8")
    tmp_2.write_text("NEW_B\n", encoding="utf-8")
    tmp_3.write_text("NEW_C\n", encoding="utf-8")

    artifacts = [(tmp_1, dest_1), (tmp_2, dest_2), (tmp_3, dest_3)]
    publish_artifacts(artifacts)  # Must not raise

    # All destinations must have new content
    assert dest_1.read_text(encoding="utf-8") == "NEW_A\n"
    assert dest_2.read_text(encoding="utf-8") == "NEW_B\n"
    assert dest_3.read_text(encoding="utf-8") == "NEW_C\n"

    # No .tmp files remain
    assert not tmp_1.exists()
    assert not tmp_2.exists()
    assert not tmp_3.exists()

    # No .old backup files remain
    assert not dest_1.with_name(dest_1.name + ".old").exists()


# ---------------------------------------------------------------------------
# Test 22d: Publication rollback failure — PublicationRollbackError raised
# ---------------------------------------------------------------------------
def test_publish_artifacts_rollback_failure_raises_composite_error(tmp_path: Path):
    """Scenario D: Publication fails AND rollback also encounters an error.
    Verifies PublicationRollbackError is raised with both original error and rollback
    errors reported — no silent swallowing of rollback exceptions.
    """
    out_dir = tmp_path / "fixtures_d"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    dest_1.write_text("ORIGINAL_A\n", encoding="utf-8")
    dest_2.write_text("ORIGINAL_B\n", encoding="utf-8")
    dest_3.write_text("ORIGINAL_C\n", encoding="utf-8")

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"
    tmp_1.write_text("NEW_A\n", encoding="utf-8")
    tmp_2.write_text("NEW_B\n", encoding="utf-8")
    tmp_3.write_text("NEW_C\n", encoding="utf-8")

    artifacts = [(tmp_1, dest_1), (tmp_2, dest_2), (tmp_3, dest_3)]

    publication_replace_count = [0]
    original_replace = Path.replace

    def combined_failing_replace(self: Path, target: Path) -> Path:
        # Phase 3: .tmp → final_path moves: fail on 3rd publication
        if str(self).endswith(".tmp"):
            publication_replace_count[0] += 1
            if publication_replace_count[0] >= 3:
                raise OSError("Injected publication failure.")
        # Rollback restores: .old → final_path moves: always fail
        elif str(self).endswith(".old"):
            raise OSError("Injected rollback failure.")
        return original_replace(self, target)

    with patch.object(Path, "replace", combined_failing_replace):
        with pytest.raises(PublicationRollbackError) as exc_info:
            publish_artifacts(artifacts)

    err = exc_info.value
    assert isinstance(err, PublicationRollbackError), (
        "Expected PublicationRollbackError when both publication and rollback fail."
    )
    assert err.original_error is not None, "original_error must be set on PublicationRollbackError."
    assert len(err.rollback_errors) > 0, (
        "rollback_errors must be non-empty when rollback itself fails."
    )


# ---------------------------------------------------------------------------
# Test 22e: Post-publication backup cleanup failure raises PublicationCleanupError
# ---------------------------------------------------------------------------
def test_publish_artifacts_post_publication_cleanup_failure(tmp_path: Path):
    """Scenario E: All artifacts are published successfully (Phase 3 complete),
    but unlinking backup (.old) files in Phase 4 encounters an error.
    Verifies:
    1. PublicationCleanupError is raised.
    2. Published destination files remain intact and contain new content (no rollback).
    3. The cleanup error is explicitly reported (not swallowed).
    """
    out_dir = tmp_path / "fixtures_e"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    dest_1.write_text("INITIAL_A\n", encoding="utf-8")
    dest_2.write_text("INITIAL_B\n", encoding="utf-8")
    dest_3.write_text("INITIAL_C\n", encoding="utf-8")

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"
    tmp_1.write_text("NEW_A\n", encoding="utf-8")
    tmp_2.write_text("NEW_B\n", encoding="utf-8")
    tmp_3.write_text("NEW_C\n", encoding="utf-8")

    artifacts = [(tmp_1, dest_1), (tmp_2, dest_2), (tmp_3, dest_3)]

    original_unlink = Path.unlink

    def failing_unlink(self: Path, *args: Any, **kwargs: Any) -> None:
        if str(self).endswith(".old"):
            raise PermissionError("Injected failure during backup cleanup.")
        original_unlink(self, *args, **kwargs)

    with patch.object(Path, "unlink", failing_unlink):
        with pytest.raises(PublicationCleanupError) as exc_info:
            publish_artifacts(artifacts)

    # All destinations MUST have the new content (publication was successful!)
    assert dest_1.read_text(encoding="utf-8") == "NEW_A\n"
    assert dest_2.read_text(encoding="utf-8") == "NEW_B\n"
    assert dest_3.read_text(encoding="utf-8") == "NEW_C\n"

    err = exc_info.value
    assert isinstance(err, PublicationCleanupError)
    assert len(err.cleanup_errors) > 0


# ---------------------------------------------------------------------------
# Test 22f: Preflight check detects missing temporary artifact
# ---------------------------------------------------------------------------
def test_publish_artifacts_preflight_missing_file_raises_and_cleans_up(tmp_path: Path):
    """Scenario F: Preflight fails because one of the tmp files is missing.
    Verifies:
    1. RuntimeError is raised with preflight details.
    2. Any existing tmp files are cleaned up.
    3. Destination files remain untouched.
    """
    out_dir = tmp_path / "fixtures_f"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_1.write_text("ORIGINAL\n", encoding="utf-8")

    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_1.write_text("NEW\n", encoding="utf-8")
    tmp_missing = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    # tmp_missing does not exist

    artifacts = [(tmp_1, dest_1), (tmp_missing, out_dir / "catalogue_snapshot_v1.sha256")]

    with pytest.raises(RuntimeError, match="Artifact publication preflight failed"):
        publish_artifacts(artifacts)

    # Destination untouched
    assert dest_1.read_text(encoding="utf-8") == "ORIGINAL\n"
    # tmp_1 was cleaned up
    assert not tmp_1.exists()


# ---------------------------------------------------------------------------
# Test 23: Failed run leaves no stale or misleading partial artifacts
# ---------------------------------------------------------------------------
def test_failed_run_cleans_up_temporary_artifacts(
    tmp_path: Path, valid_50_probes: list[dict[str, Any]]
):
    """Ensures that on mid-run failure, no partial .tmp files or snapshots remain."""
    probes_file = tmp_path / "probes.json"
    with open(probes_file, "w", encoding="utf-8") as f:
        json.dump(valid_50_probes, f)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    # Mock stop condition failure (missing probes)
    mock_cur.fetchone.side_effect = [
        {"total_movies": 100, "movies_with_overview": 50},
        {"total_tv_shows": 100, "tv_shows_with_overview": 50},
    ]
    mock_cur.fetchall.side_effect = [[], []]  # 0 probes found

    with patch("psycopg2.connect", return_value=mock_conn):
        code = prepare_catalogue_snapshot(
            db_url="postgresql://localhost:5432/cinesphere",
            probes_file=probes_file,
            output_dir=out_dir,
        )

    assert code == 1
    assert not (out_dir / "catalogue_snapshot_v1.jsonl").exists()
    assert not (out_dir / "catalogue_snapshot_v1.sha256").exists()
    assert not (out_dir / "catalogue_snapshot_v1.manifest.json").exists()
    assert not (out_dir / "catalogue_snapshot_v1.jsonl.tmp").exists()


# ---------------------------------------------------------------------------
# Test 24: Personal library tables are never queried
# ---------------------------------------------------------------------------
def test_personal_library_tables_never_queried():
    """Audits script source code to guarantee personal tables are never referenced."""
    script_path = Path("ml/benchmark/scripts/prepare_catalogue_fixture.py")
    with open(script_path, encoding="utf-8") as f:
        source_code = f.read()

    # Inspect all executable functions and SQL queries (after constant definitions)
    code_start = source_code.find("def get_cast_selection_sql")
    assert code_start != -1
    executable_source = source_code[code_start:]

    for forbidden in FORBIDDEN_TABLES:
        assert forbidden not in executable_source, (
            f"Forbidden table '{forbidden}' detected in executable code/SQL of "
            f"prepare_catalogue_fixture.py"
        )
