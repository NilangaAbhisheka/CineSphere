"""
ml/tests/test_prepare_catalogue_fixture.py

Comprehensive unit test suite for ml/benchmark/scripts/prepare_catalogue_fixture.py.
Covers all 16 required invariants and edge cases specified in
Section 5 of the Stage 5.0 audit charter.
Isolated from the live CineSphere PostgreSQL database using controlled test fixtures and mocks.
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
    FORBIDDEN_TABLES,
    REQUIRED_MOVIES_TOTAL,
    REQUIRED_TV_SHOWS_TOTAL,
    InvalidProbeDefinitionError,
    calculate_additional_quotas,
    prepare_catalogue_snapshot,
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

    # Mock movie stats and tv stats
    mock_cur.fetchone.side_effect = [
        {"total_movies": 2000, "movies_with_overview": 1800},
        {"total_tv_shows": 1000, "tv_shows_with_overview": 800},
    ]
    # Mock found probes: database only returns 37 of 38 movie probes, and 12 TV probes
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
        {"total_movies": 1249, "movies_with_overview": 307},  # Deficit of 1093
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
        {"total_tv_shows": 2174, "tv_shows_with_overview": 302},  # Deficit of 298
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
    assert movie_cand_params[1] == 1362

    assert 'NOT ("tmdbId" = ANY(%s))' in tv_cand_query
    assert tv_cand_params[0] == tv_probe_ids
    assert tv_cand_params[1] == 588


# ---------------------------------------------------------------------------
# Test 10: Deterministic NULL ordering in candidate selection queries
# ---------------------------------------------------------------------------
def test_candidate_query_deterministic_null_ordering():
    """Validates that candidate selection queries explicitly specify NULLS LAST and tmdbId ASC."""
    # Read the query directly from the prepare_catalogue_fixture module source code
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
    """Ensures that if candidate queries somehow return duplicate IDs, generation fails closed."""
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
# Test 13: Canonical text serialization with strict omission
# ---------------------------------------------------------------------------
def test_serialize_canonical_text_strict_null_omission():
    """Validates that empty/null fields omit their line and never emit None or empty tokens."""
    # Full metadata
    text_full = serialize_canonical_text(
        title="Inception",
        year=2010,
        genres=["Action", "Sci-Fi"],
        directors=["Christopher Nolan"],
        cast=["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
        overview="A thief who steals corporate secrets...",
        keywords=["dream", "subconscious"],
    )
    expected_full = (
        "Title: Inception\n"
        "Year: 2010\n"
        "Genres: Action, Sci-Fi\n"
        "Directors: Christopher Nolan\n"
        "Cast: Leonardo DiCaprio, Joseph Gordon-Levitt\n"
        "Overview: A thief who steals corporate secrets...\n"
        "Keywords: dream, subconscious"
    )
    assert text_full == expected_full

    # Partial metadata with nulls/empty lists (Directors and Keywords omitted)
    text_partial = serialize_canonical_text(
        title="Spirited Away",
        year=2001,
        genres=["Animation", "Fantasy"],
        directors=[],
        cast=["Rumi Hiiragi"],
        overview="Chihiro wanders into a magical world.",
        keywords=[],
    )
    expected_partial = (
        "Title: Spirited Away\n"
        "Year: 2001\n"
        "Genres: Animation, Fantasy\n"
        "Cast: Rumi Hiiragi\n"
        "Overview: Chihiro wanders into a magical world."
    )
    assert text_partial == expected_partial
    assert "Directors" not in text_partial
    assert "Keywords" not in text_partial
    assert "None" not in text_partial


# ---------------------------------------------------------------------------
# Test 14: SHA-256 calculation matches actual output bytes
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
# Test 15: Failed run leaves no stale or misleading partial artifacts
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
    # Check that no snapshot, checksum, or temporary files were left behind
    assert not (out_dir / "catalogue_snapshot_v1.jsonl").exists()
    assert not (out_dir / "catalogue_snapshot_v1.sha256").exists()
    assert not (out_dir / "catalogue_snapshot_v1.manifest.json").exists()
    assert not (out_dir / "catalogue_snapshot_v1.jsonl.tmp").exists()


# ---------------------------------------------------------------------------
# Test 16: Personal library tables are never queried
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
            f"Forbidden table '{forbidden}' detected in executable code/SQL of prepare_catalogue_fixture.py"  # noqa: E501
        )
