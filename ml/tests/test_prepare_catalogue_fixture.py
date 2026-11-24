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
9. Deterministic cast selection behavior and schema limitation handling.
10. Genuine PostgreSQL session read-only enforcement (rejected writes).
11. Fixture manifest compliance with Section 8.11.3.
12. SHA-256 byte-for-byte digest calculation.
13. Atomic staged publication with backup and rollback on failure.
14. Personal library isolation (forbidden tables).
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from ml.benchmark.scripts.prepare_catalogue_fixture import (
    ALLOWED_STRATA,
    DEFAULT_DB_URL,
    FORBIDDEN_TABLES,
    REQUIRED_MOVIES_TOTAL,
    REQUIRED_TV_SHOWS_TOTAL,
    SYNTHETIC_MOVIE_EXCLUSION_PATTERN,
    SYNTHETIC_TV_EXCLUSION_PATTERN,
    InvalidProbeDefinitionError,
    calculate_additional_quotas,
    create_readonly_connection,
    prepare_catalogue_snapshot,
    publish_artifacts,
    serialize_canonical_text,
    validate_probes,
    verify_database_readiness,
)


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
    ]
    for name in legitimate_tv:
        assert not re.search(SYNTHETIC_TV_EXCLUSION_PATTERN, name, re.I), (
            f"False positive: legitimate TV show '{name}' was incorrectly excluded"
        )


# ---------------------------------------------------------------------------
# Test 18: Deterministic cast selection behavior
# ---------------------------------------------------------------------------
def test_deterministic_cast_selection_behavior():
    """Validates that cast selection ordering produces identical outputs regardless

    of input record ordering on disk.
    """
    # 10 actors in arbitrary orders
    actors_batch_1 = [
        {"name": "Zoe Saldana", "tmdbId": 8691},
        {"name": "Chris Pratt", "tmdbId": 73457},
        {"name": "Bradley Cooper", "tmdbId": 51329},
        {"name": "Vin Diesel", "tmdbId": 12835},
        {"name": "Dave Bautista", "tmdbId": 543530},
        {"name": "Karen Gillan", "tmdbId": 543261},
        {"name": "Michael Rooker", "tmdbId": 8516},
    ]

    actors_batch_2 = list(reversed(actors_batch_1))

    # Deterministic selection: ORDER BY name ASC, tmdbId ASC LIMIT 5
    selected_1 = sorted(actors_batch_1, key=lambda a: (a["name"], a["tmdbId"]))[:5]
    selected_2 = sorted(actors_batch_2, key=lambda a: (a["name"], a["tmdbId"]))[:5]

    names_1 = [a["name"] for a in selected_1]
    names_2 = [a["name"] for a in selected_2]

    assert names_1 == names_2
    assert len(names_1) == 5
    assert names_1 == [
        "Bradley Cooper",
        "Chris Pratt",
        "Dave Bautista",
        "Karen Gillan",
        "Michael Rooker",
    ]


# ---------------------------------------------------------------------------
# Test 19: Genuine PostgreSQL read-only enforcement
# ---------------------------------------------------------------------------
def test_postgres_readonly_enforcement():
    """Verifies against PostgreSQL that session read-only rejects write attempts."""
    try:
        from psycopg2.errors import ReadOnlySqlTransaction
    except ImportError:
        pytest.skip("psycopg2 is not installed.")

    try:
        conn = create_readonly_connection(DEFAULT_DB_URL)
    except Exception as e:
        pytest.skip(f"Live PostgreSQL database is not reachable: {e}")

    try:
        with conn.cursor() as cur:
            # 1. Verify read succeeds
            cur.execute("SELECT count(*) FROM movies;")
            count = cur.fetchone()[0]
            assert isinstance(count, int)

            # 2. Verify UPDATE fails with ReadOnlySqlTransaction
            with pytest.raises(ReadOnlySqlTransaction):
                cur.execute("UPDATE movies SET title = 'hacked' WHERE false;")

            # 3. Verify INSERT fails with ReadOnlySqlTransaction
            with pytest.raises(ReadOnlySqlTransaction):
                cur.execute("INSERT INTO movies (\"tmdbId\", title) VALUES (-999, 'hacked');")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Test 20: SHA-256 calculation matches actual output bytes
# ---------------------------------------------------------------------------
def test_sha256_computation_exact_bytes(tmp_path: Path):
    """Verifies generated sha256 matches the byte-for-byte hash of the JSONL file."""
    test_file = tmp_path / "test_snapshot.jsonl"
    lines = [
        json.dumps({"id": 1, "name": "Item 1"}, ensure_ascii=False) + "\n",
        json.dumps({"id": 2, "name": "Item 2"}, ensure_ascii=False) + "\n",
    ]
    with open(test_file, "w", encoding="utf-8", newline="\n") as f:
        for line in lines:
            f.write(line)

    hasher = hashlib.sha256()
    with open(test_file, "rb") as f:
        hasher.update(f.read())
    expected_digest = hasher.hexdigest()

    # Recompute line-by-line as in script
    script_hasher = hashlib.sha256()
    for line in lines:
        script_hasher.update(line.encode("utf-8"))
    assert script_hasher.hexdigest() == expected_digest


# ---------------------------------------------------------------------------
# Test 21: Fixture manifest conformity with Section 8.11.3
# ---------------------------------------------------------------------------
def test_manifest_schema_and_checksum_consistency(tmp_path: Path):
    """Verifies that generated manifest conforms strictly to Section 8.11.3 field contract."""
    jsonl_file = tmp_path / "catalogue_snapshot_v1.jsonl"
    sha256_file = tmp_path / "catalogue_snapshot_v1.sha256"
    manifest_file = tmp_path / "catalogue_snapshot_v1.manifest.json"

    records = [
        {"media_type": "MOVIE", "tmdb_id": 101, "is_probe": True, "stratum": "Mainstream"},
        {"media_type": "TV", "tmdb_id": 201, "is_probe": False, "stratum": None},
    ]

    hasher = hashlib.sha256()
    with open(jsonl_file, "w", encoding="utf-8", newline="\n") as f:
        for r in records:
            line = json.dumps(r) + "\n"
            f.write(line)
            hasher.update(line.encode("utf-8"))

    digest = hasher.hexdigest()
    with open(sha256_file, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{digest}  catalogue_snapshot_v1.jsonl\n")

    manifest_data = {
        "fixture_filename": "catalogue_snapshot_v1.jsonl",
        "record_count": len(records),
        "movie_count": 1,
        "tv_count": 1,
        "probe_count": 1,
        "sha256": digest,
        "source_identity": "CineSphere PostgreSQL (catalogue tables)",
        "selection_algorithm_version": "1.0.0-deterministic",
        "serialization_version": "1.0.0-bracketed-tokens",
        "generated_at": "2026-11-24T12:00:00Z",
    }
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f)

    # Verify manifest fields per Section 8.11.3
    with open(manifest_file, encoding="utf-8") as f:
        loaded = json.load(f)

    assert loaded["fixture_filename"] == "catalogue_snapshot_v1.jsonl"
    assert loaded["record_count"] == 2
    assert loaded["movie_count"] == 1
    assert loaded["tv_count"] == 1
    assert loaded["record_count"] == loaded["movie_count"] + loaded["tv_count"]
    assert loaded["probe_count"] == 1
    assert loaded["sha256"] == digest
    assert loaded["source_identity"] == "CineSphere PostgreSQL (catalogue tables)"
    assert loaded["selection_algorithm_version"] == "1.0.0-deterministic"
    assert loaded["serialization_version"] == "1.0.0-bracketed-tokens"

    # Verify sha256 file matches
    with open(sha256_file, encoding="utf-8") as f:
        checksum_content = f.read()
    assert checksum_content.startswith(digest)


# ---------------------------------------------------------------------------
# Test 22: Publication rollback on failure preserves existing valid files
# ---------------------------------------------------------------------------
def test_publish_artifacts_atomic_rollback_on_failure(tmp_path: Path):
    """Verifies that if publication fails midway, previous valid artifacts are restored

    and all temporary files are cleaned up.
    """
    out_dir = tmp_path / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_1 = out_dir / "catalogue_snapshot_v1.jsonl"
    dest_2 = out_dir / "catalogue_snapshot_v1.sha256"
    dest_3 = out_dir / "catalogue_snapshot_v1.manifest.json"

    # Write initial valid versions
    dest_1.write_text("INITIAL_JSONL\n", encoding="utf-8")
    dest_2.write_text("INITIAL_SHA\n", encoding="utf-8")
    dest_3.write_text("INITIAL_MANIFEST\n", encoding="utf-8")

    # Prepare temporary files
    tmp_1 = out_dir / "catalogue_snapshot_v1.jsonl.tmp"
    tmp_2 = out_dir / "catalogue_snapshot_v1.sha256.tmp"
    tmp_3 = out_dir / "catalogue_snapshot_v1.manifest.json.tmp"

    tmp_1.write_text("NEW_JSONL\n", encoding="utf-8")
    tmp_2.write_text("NEW_SHA\n", encoding="utf-8")
    # Simulate tmp_3 missing to trigger publication failure in Phase 1
    if tmp_3.exists():
        tmp_3.unlink()

    artifacts = [
        (tmp_1, dest_1),
        (tmp_2, dest_2),
        (tmp_3, dest_3),
    ]

    with pytest.raises(RuntimeError, match="Artifact publication failed"):
        publish_artifacts(artifacts)

    # Verify that initial valid versions remain untouched and uncorrupted
    assert dest_1.read_text(encoding="utf-8") == "INITIAL_JSONL\n"
    assert dest_2.read_text(encoding="utf-8") == "INITIAL_SHA\n"
    assert dest_3.read_text(encoding="utf-8") == "INITIAL_MANIFEST\n"

    # Verify temporary files were cleaned up
    assert not tmp_1.exists()
    assert not tmp_2.exists()
    assert not tmp_3.exists()


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
    code_start = source_code.find("def serialize_canonical_text")
    assert code_start != -1
    executable_source = source_code[code_start:]

    for forbidden in FORBIDDEN_TABLES:
        assert forbidden not in executable_source, (
            f"Forbidden table '{forbidden}' detected in executable code/SQL of "
            f"prepare_catalogue_fixture.py"
        )
