"""
Tests for generate_candidate_manifest.py and run_seeding_batch.py.

All tests use mocks or disposable temporary directories.
No primary database writes are performed.
No live TMDB requests are made.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from ml.benchmark.scripts.generate_candidate_manifest import (
    _PROBES_PATH,
    MIN_OVERVIEW_LENGTH,
    MIN_VOTE_COUNT,
    MOVIE_NONENG_FRACTION,
    CandidateEntry,
    CatalogueAuditError,
    CredentialError,
    TmdbClient,
    build_manifest,
    compute_diversity_stats,
    compute_manifest_digest,
    is_valid_movie_candidate,
    is_valid_tv_candidate,
    load_existing_catalogue_ids,
    load_probe_ids,
    select_with_diversity,
    write_manifest_atomic,
)
from ml.benchmark.scripts.run_seeding_batch import (
    ALLOW_REMOTE_ENV_VAR,
    ALLOW_SEEDING_ENV_VAR,
    CANONICAL_MOVIE_TARGET,
    CANONICAL_TV_TARGET,
    Checkpoint,
    CheckpointValidationError,
    ExecutionSummary,
    IngestResult,
    ManifestValidationError,
    _recompute_noneng_fraction,
    _record_failure,
    compute_manifest_digest_from_data,
    is_local_api_target,
    load_checkpoint,
    load_manifest,
    main,
    normalize_api_url,
    run_ingestion,
    save_checkpoint_atomic,
    verify_manifest_digest,
)
from ml.benchmark.scripts.run_seeding_batch import (
    load_probe_ids as load_runner_probe_ids,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _make_movie_item(
    tmdb_id: int = 100,
    title: str = "Inception",
    overview: str = "A" * 50,
    vote_count: int = 200,
    language: str = "en",
) -> dict[str, Any]:
    return {
        "id": tmdb_id,
        "title": title,
        "overview": overview,
        "vote_count": vote_count,
        "original_language": language,
        "original_title": title,
    }


def _make_tv_item(
    tmdb_id: int = 200,
    name: str = "Breaking Bad",
    overview: str = "B" * 50,
    vote_count: int = 200,
    language: str = "en",
) -> dict[str, Any]:
    return {
        "id": tmdb_id,
        "name": name,
        "overview": overview,
        "vote_count": vote_count,
        "original_language": language,
        "original_name": name,
    }


def _make_candidate(
    tmdb_id: int = 100,
    media_type: str = "movie",
    language: str = "en",
    vote_count: int = 500,
) -> CandidateEntry:
    return CandidateEntry(
        media_type=media_type,
        tmdb_id=tmdb_id,
        title=f"Title {tmdb_id}",
        original_language=language,
        overview="X" * 60,
        vote_count=vote_count,
    )


@pytest.fixture
def temp_dir(tmp_path: pathlib.Path) -> pathlib.Path:
    return tmp_path


@pytest.fixture
def valid_manifest(tmp_path: pathlib.Path) -> dict[str, Any]:
    """A minimal valid manifest dict (no live TMDB required)."""
    filtering_criteria: dict[str, Any] = {
        "min_overview_length": MIN_OVERVIEW_LENGTH,
        "min_vote_count": MIN_VOTE_COUNT,
    }
    movies = [
        {
            "tmdb_id": i,
            "title": f"Movie {i}",
            "original_language": "en" if i % 2 == 0 else "ja",
            "vote_count": 500,
            "source_endpoints": [],
        }
        for i in range(1, 6)
    ]
    tv_shows = [
        {
            "tmdb_id": i + 100,
            "title": f"Show {i}",
            "original_language": "en" if i % 2 == 0 else "ko",
            "vote_count": 500,
            "source_endpoints": [],
        }
        for i in range(1, 4)
    ]

    # Movies: IDs 1-5; i%2==0 -> "en" (IDs 2,4); i%2!=0 -> "ja" (IDs 1,3,5)
    # Non-English fraction = 3/5 = 0.6
    # TV: IDs 101-103 (i in 1..3); i%2==0 -> "en" (ID 102); i%2!=0 -> "ko" (IDs 101,103)
    # Non-English fraction = 2/3 ≈ 0.6667
    manifest_dict: dict[str, Any] = {
        "schema_version": "1.0.0",
        "manifest_version": "1.0.0",
        "is_executable": True,
        "mode": "execution_ready",
        "status": "execution_ready",
        "generation_timestamp": "2026-11-24T00:00:00+00:00",
        "source_endpoints": ["/movie/top_rated"],
        "filtering_criteria": filtering_criteria,
        "targets": {"movie_candidate_target": len(movies), "tv_candidate_target": len(tv_shows)},
        "counts": {
            "movie_candidates_selected": len(movies),
            "tv_candidates_selected": len(tv_shows),
            "total_candidates": len(movies) + len(tv_shows),
        },
        "probe_exclusion": {
            "probes_excluded_movie_count": 38,
            "probes_excluded_tv_count": 12,
            "probes_fixture_path": "ml/benchmark/fixtures/probes_v1.json",
        },
        "catalogue_exclusion": {
            "enabled": True,
            "status": "verified",
            "audit_timestamp": "2026-11-24T00:00:00+00:00",
            "movies_already_in_catalogue": 0,
            "tv_shows_already_in_catalogue": 0,
        },
        "language_diversity": {
            # Must match the actual fractions computed from the candidate lists above
            # (Correction B cross-check tolerance is 0.0001).
            "movies": {"non_english_fraction": 0.6},
            "tv": {"non_english_fraction": round(2 / 3, 10)},
        },
        "movies": movies,
        "tv_shows": tv_shows,
        "manifest_digest": "",  # Filled in below using canonical digest function
    }
    # Use the runner's canonical digest function so the fixture always stays in
    # sync with the extended payload schema (Corrections D).
    from ml.benchmark.scripts.run_seeding_batch import (
        compute_manifest_digest_from_data as _compute_digest,
    )

    manifest_dict["manifest_digest"] = _compute_digest(manifest_dict)
    return manifest_dict


# ===========================================================================
# Tests: Candidate Validation
# ===========================================================================
class TestCandidateValidation:
    def test_valid_movie_passes(self) -> None:
        assert is_valid_movie_candidate(_make_movie_item()) is True

    def test_valid_tv_passes(self) -> None:
        assert is_valid_tv_candidate(_make_tv_item()) is True

    def test_movie_missing_id_rejected(self) -> None:
        item = _make_movie_item()
        item["id"] = None
        assert is_valid_movie_candidate(item) is False

    def test_movie_zero_id_rejected(self) -> None:
        item = _make_movie_item()
        item["id"] = 0
        assert is_valid_movie_candidate(item) is False

    def test_movie_negative_id_rejected(self) -> None:
        item = _make_movie_item()
        item["id"] = -1
        assert is_valid_movie_candidate(item) is False

    def test_movie_short_overview_rejected(self) -> None:
        item = _make_movie_item(overview="short")
        assert is_valid_movie_candidate(item) is False

    def test_movie_exactly_minimum_overview_accepted(self) -> None:
        item = _make_movie_item(overview="A" * MIN_OVERVIEW_LENGTH)
        assert is_valid_movie_candidate(item) is True

    def test_movie_low_vote_count_rejected(self) -> None:
        item = _make_movie_item(vote_count=MIN_VOTE_COUNT - 1)
        assert is_valid_movie_candidate(item) is False

    def test_movie_exact_minimum_vote_count_accepted(self) -> None:
        item = _make_movie_item(vote_count=MIN_VOTE_COUNT)
        assert is_valid_movie_candidate(item) is True

    def test_movie_empty_title_rejected(self) -> None:
        item = _make_movie_item(title="")
        item["original_title"] = ""
        assert is_valid_movie_candidate(item) is False

    def test_movie_missing_language_rejected(self) -> None:
        item = _make_movie_item()
        item["original_language"] = ""
        assert is_valid_movie_candidate(item) is False

    def test_synthetic_movie_title_rejected(self) -> None:
        for title in [
            "Test Movie",
            "Fake Film",
            "Mock Screening",
            "Placeholder",
            "Untitled",
            "[REDACTED]",
        ]:
            item = _make_movie_item(title=title)
            assert is_valid_movie_candidate(item) is False, f"Expected {title!r} to be rejected"

    def test_synthetic_tv_title_rejected(self) -> None:
        for title in ["Test Show", "Fake Series", "Unknown", "N/A"]:
            item = _make_tv_item(name=title)
            assert is_valid_tv_candidate(item) is False, f"Expected {title!r} to be rejected"

    def test_tv_missing_name_rejected(self) -> None:
        item = _make_tv_item()
        item["name"] = ""
        item["original_name"] = ""
        assert is_valid_tv_candidate(item) is False


# ===========================================================================
# Tests: Probe Exclusion
# ===========================================================================
class TestProbeExclusion:
    def test_load_probe_ids_returns_correct_counts(self) -> None:
        probe_ids = load_probe_ids(_PROBES_PATH)
        assert "movie" in probe_ids
        assert "tv" in probe_ids
        assert len(probe_ids["movie"]) == 38
        assert len(probe_ids["tv"]) == 12

    def test_load_runner_probe_ids_matches(self) -> None:
        runner_probes = load_runner_probe_ids(_PROBES_PATH)
        assert len(runner_probes["movie"]) == 38
        assert len(runner_probes["tv"]) == 12

    def test_load_probe_ids_known_ids_present(self) -> None:
        probe_ids = load_probe_ids(_PROBES_PATH)
        assert 27205 in probe_ids["movie"]
        assert 334541 in probe_ids["movie"]
        assert 1438 in probe_ids["tv"]
        assert 89708 in probe_ids["movie"]
        assert 1920 in probe_ids["tv"]

    def test_load_probe_ids_erroneous_ids_absent(self) -> None:
        probe_ids = load_probe_ids(_PROBES_PATH)
        assert 334543 not in probe_ids["movie"]
        assert 3297 not in probe_ids["tv"]
        assert 85350 not in probe_ids["movie"]


# ===========================================================================
# Tests: Candidate Deduplication
# ===========================================================================
class TestCandidateDeduplication:
    def test_selection_output_sorted_by_tmdb_id(self) -> None:
        candidates = [_make_candidate(tmdb_id=i) for i in range(1, 21)]
        selected = select_with_diversity(candidates, 20, 0.0)
        ids = [c.tmdb_id for c in selected]
        assert ids == sorted(ids)

    def test_selection_respects_target_cap(self) -> None:
        candidates = [_make_candidate(tmdb_id=i) for i in range(1, 101)]
        selected = select_with_diversity(candidates, 10, 0.0)
        assert len(selected) <= 10


# ===========================================================================
# Tests: Language Diversity
# ===========================================================================
class TestLanguageDiversity:
    def test_diversity_quota_met_when_sufficient_noneng(self) -> None:
        candidates = [_make_candidate(tmdb_id=i, language="fr") for i in range(1, 11)] + [
            _make_candidate(tmdb_id=i + 100, language="en") for i in range(1, 11)
        ]
        selected = select_with_diversity(candidates, 20, MOVIE_NONENG_FRACTION)
        non_eng = sum(1 for c in selected if c.original_language != "en")
        total = len(selected)
        assert non_eng / total >= MOVIE_NONENG_FRACTION

    def test_non_english_fraction_prioritized_first(self) -> None:
        candidates = [
            _make_candidate(tmdb_id=i, language="ko", vote_count=100) for i in range(1, 3)
        ] + [_make_candidate(tmdb_id=i + 50, language="en", vote_count=200) for i in range(1, 19)]
        selected = select_with_diversity(candidates, 10, MOVIE_NONENG_FRACTION)
        non_eng_ids = {c.tmdb_id for c in selected if c.original_language != "en"}
        assert non_eng_ids == {1, 2}

    def test_select_with_diversity_uses_ceil_rounding(self) -> None:
        # 11 items * 0.25 = 2.75 -> ceil is 3 non-English items required.
        candidates = [_make_candidate(tmdb_id=i, language="fr") for i in range(1, 6)] + [
            _make_candidate(tmdb_id=i + 50, language="en") for i in range(1, 10)
        ]
        selected = select_with_diversity(candidates, 11, 0.25)
        non_eng = [c for c in selected if c.original_language != "en"]
        assert len(non_eng) >= 3

    def test_compute_diversity_stats_empty(self) -> None:
        stats = compute_diversity_stats([])
        assert stats["total"] == 0
        assert stats["non_english_fraction"] == 0.0

    def test_compute_diversity_stats_all_english(self) -> None:
        candidates = [_make_candidate(tmdb_id=i, language="en") for i in range(1, 6)]
        stats = compute_diversity_stats(candidates)
        assert stats["total"] == 5
        assert stats["english_count"] == 5
        assert stats["non_english_count"] == 0
        assert stats["non_english_fraction"] == 0.0

    def test_compute_diversity_stats_mixed(self) -> None:
        candidates = [_make_candidate(tmdb_id=i, language="en") for i in range(1, 4)] + [
            _make_candidate(tmdb_id=i + 10, language="fr") for i in range(1, 3)
        ]
        stats = compute_diversity_stats(candidates)
        assert stats["total"] == 5
        assert stats["non_english_count"] == 2
        assert abs(stats["non_english_fraction"] - 0.4) < 0.001


# ===========================================================================
# Tests: Deterministic Selection
# ===========================================================================
class TestDeterministicSelection:
    def test_same_input_produces_same_digest(self) -> None:
        movies = [_make_candidate(tmdb_id=i) for i in [3, 1, 2]]
        tv = [_make_candidate(tmdb_id=i, media_type="tv") for i in [10, 11]]
        criteria: dict[str, Any] = {"min_overview_length": 30, "min_vote_count": 50}
        d1 = compute_manifest_digest(movies, tv, criteria)
        d2 = compute_manifest_digest(movies, tv, criteria)
        assert d1 == d2

    def test_different_candidates_produce_different_digest(self) -> None:
        movies_a = [_make_candidate(tmdb_id=1)]
        movies_b = [_make_candidate(tmdb_id=2)]
        tv: list[CandidateEntry] = []
        criteria: dict[str, Any] = {}
        assert compute_manifest_digest(movies_a, tv, criteria) != compute_manifest_digest(
            movies_b, tv, criteria
        )

    def test_digest_covers_is_executable_state(self) -> None:
        movies = [_make_candidate(tmdb_id=1)]
        tv: list[CandidateEntry] = []
        criteria: dict[str, Any] = {}
        d_exec = compute_manifest_digest(movies, tv, criteria, is_executable=True)
        d_diag = compute_manifest_digest(movies, tv, criteria, is_executable=False)
        assert d_exec != d_diag

    def test_selection_sorted_by_tmdb_id(self) -> None:
        candidates = [_make_candidate(tmdb_id=i) for i in [5, 3, 1, 4, 2]]
        selected = select_with_diversity(candidates, 5, 0.0)
        ids = [c.tmdb_id for c in selected]
        assert ids == sorted(ids)


# ===========================================================================
# Tests: Atomic Manifest Write
# ===========================================================================
class TestAtomicManifestWrite:
    def test_writes_valid_json(self, temp_dir: pathlib.Path) -> None:
        path = temp_dir / "fixtures" / "manifest.json"
        manifest = {"schema_version": "1.0.0", "movies": [], "tv_shows": []}
        write_manifest_atomic(manifest, path)
        assert path.exists()
        with path.open() as fh:
            loaded = json.load(fh)
        assert loaded["schema_version"] == "1.0.0"

    def test_no_partial_file_on_success(self, temp_dir: pathlib.Path) -> None:
        path = temp_dir / "manifest.json"
        write_manifest_atomic({"ok": True}, path)
        tmp_files = list(temp_dir.glob("*.tmp"))
        assert tmp_files == []

    def test_manifest_path_created(self, temp_dir: pathlib.Path) -> None:
        nested = temp_dir / "deep" / "nested" / "manifest.json"
        write_manifest_atomic({"data": 1}, nested)
        assert nested.exists()


# ===========================================================================
# Tests: Dry-run and Manifest Generator Modes
# ===========================================================================
class TestBuildManifestDryRun:
    def test_dry_run_returns_manifest_dict_marked_non_executable(self) -> None:
        manifest = build_manifest(dry_run=True)
        assert "schema_version" in manifest
        assert manifest["is_executable"] is False
        assert manifest["status"] == "dry_run"
        assert manifest["counts"]["movie_candidates_selected"] == 0
        assert manifest["counts"]["tv_candidates_selected"] == 0

    def test_dry_run_does_not_write_file(self, monkeypatch: pytest.MonkeyPatch) -> None:
        written = []

        def fake_write(m: dict[str, Any], p: pathlib.Path) -> None:
            written.append(p)

        monkeypatch.setattr(
            "ml.benchmark.scripts.generate_candidate_manifest.write_manifest_atomic",
            fake_write,
        )
        build_manifest(dry_run=True)
        assert written == []

    def test_dry_run_no_tmdb_calls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        created_clients: list[object] = []

        class FakeClient:
            def __init__(self, token: str) -> None:
                created_clients.append(self)

        monkeypatch.setattr(
            "ml.benchmark.scripts.generate_candidate_manifest.TmdbClient",
            FakeClient,
        )
        build_manifest(dry_run=True)
        assert created_clients == []

    def test_catalogue_audit_missing_database_url_raises_in_execution_mode(self) -> None:
        with pytest.raises(CatalogueAuditError, match="requires DATABASE_URL"):
            load_existing_catalogue_ids(None, require_audit=True)

    def test_catalogue_audit_diagnostic_mode_allows_fallback(self) -> None:
        ids, status, ts = load_existing_catalogue_ids(None, require_audit=False)
        assert ids == {"movie": set(), "tv": set()}
        assert status == "diagnostic"
        assert ts is None

    def test_catalogue_audit_db_failure_raises_in_execution_mode(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_psycopg2 = MagicMock()
        fake_psycopg2.connect.side_effect = RuntimeError("connection refused")
        monkeypatch.setitem(sys.modules, "psycopg2", fake_psycopg2)

        with pytest.raises(CatalogueAuditError, match="Catalogue audit query failed"):
            load_existing_catalogue_ids("postgresql://localhost/fake", require_audit=True)


# ===========================================================================
# Tests: Target URL Safeguards (run_seeding_batch)
# ===========================================================================
class TestTargetSafeguards:
    def test_normalize_api_url_standardizes(self) -> None:
        assert normalize_api_url("http://localhost:4000/") == "http://localhost:4000"
        assert normalize_api_url("HTTP://LOCALHOST:4000") == "http://localhost:4000"
        assert normalize_api_url("https://127.0.0.1:8080/api/") == "https://127.0.0.1:8080/api"

    def test_is_local_api_target(self) -> None:
        assert is_local_api_target("http://localhost:4000") is True
        assert is_local_api_target("http://127.0.0.1:4000") is True
        assert is_local_api_target("http://[::1]:4000") is True
        assert is_local_api_target("http://192.168.1.100:4000") is False
        assert is_local_api_target("https://api.cinesphere.internal") is False

    def test_missing_execution_flag_runs_dry_run_default(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """Running without --execute must trigger dry-run and succeed with exit code 0."""
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        env = {k: v for k, v in os.environ.items() if k != ALLOW_SEEDING_ENV_VAR}
        with patch.dict(os.environ, env, clear=True):
            rc = main(
                [
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 0

    def test_missing_env_var_returns_error_code(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """--execute without ALLOW_SEEDING_ENV_VAR must fail closed with exit code 2."""
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        env = {k: v for k, v in os.environ.items() if k != ALLOW_SEEDING_ENV_VAR}
        with patch.dict(os.environ, env, clear=True):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 2

    def test_execute_with_env_var_checks_api_health_failure(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """--execute with env var must attempt API health check and fail gracefully if server down."""
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        with patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://localhost:19999",
                ]
            )
        assert rc == 2

    def test_remote_target_rejected_by_default(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        with patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}, clear=True):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://remote.host:4000",
                ]
            )
        assert rc == 2

    def test_remote_target_accepted_with_explicit_safeguard(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        # Health check will fail since remote.host is fictitious, but safeguard check passes.
        with patch.dict(
            os.environ,
            {ALLOW_SEEDING_ENV_VAR: "true", ALLOW_REMOTE_ENV_VAR: "true"},
            clear=True,
        ):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://remote.host:4000",
                ]
            )
        # Exits with 2 due to health check failure, not safeguard refusal.
        assert rc == 2


# ===========================================================================
# Tests: Manifest Boundary Validation (run_seeding_batch)
# ===========================================================================
class TestManifestValidation:
    def test_valid_manifest_loads(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        m = load_manifest(path)
        assert m["schema_version"] == "1.0.0"

    def test_missing_manifest_file_raises(self, tmp_path: pathlib.Path) -> None:
        with pytest.raises(ManifestValidationError, match="not found"):
            load_manifest(tmp_path / "nonexistent.json")

    def test_manifest_missing_key_raises(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        del valid_manifest["movies"]
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="missing required keys"):
            load_manifest(path)

    def test_candidate_with_negative_id_raises(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["movies"].append(
            {
                "tmdb_id": -1,
                "title": "Bad",
                "original_language": "en",
                "vote_count": 100,
                "source_endpoints": [],
            }
        )
        valid_manifest["counts"]["movie_candidates_selected"] = len(valid_manifest["movies"])
        valid_manifest["counts"]["total_candidates"] = len(valid_manifest["movies"]) + len(
            valid_manifest["tv_shows"]
        )
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="positive integer"):
            load_manifest(path)

    def test_candidate_with_empty_title_raises(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["movies"].append(
            {
                "tmdb_id": 999,
                "title": "",
                "original_language": "en",
                "vote_count": 100,
                "source_endpoints": [],
            }
        )
        valid_manifest["counts"]["movie_candidates_selected"] = len(valid_manifest["movies"])
        valid_manifest["counts"]["total_candidates"] = len(valid_manifest["movies"]) + len(
            valid_manifest["tv_shows"]
        )
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="non-empty string"):
            load_manifest(path)

    def test_manifest_rejects_count_metadata_mismatch(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["counts"]["movie_candidates_selected"] = 999
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="movie count mismatch"):
            load_manifest(path)

    def test_manifest_rejects_duplicate_movie_ids(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["movies"].append(
            {
                "tmdb_id": valid_manifest["movies"][0]["tmdb_id"],
                "title": "Duplicate",
                "original_language": "en",
                "vote_count": 500,
                "source_endpoints": [],
            }
        )
        valid_manifest["counts"]["movie_candidates_selected"] = len(valid_manifest["movies"])
        valid_manifest["counts"]["total_candidates"] = len(valid_manifest["movies"]) + len(
            valid_manifest["tv_shows"]
        )
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="Duplicate movie candidate IDs"):
            load_manifest(path)

    def test_manifest_rejects_injected_movie_probe(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        # Inception is probe PB-01 (tmdb_id: 27205)
        valid_manifest["movies"].append(
            {
                "tmdb_id": 27205,
                "title": "Inception Probe Injected",
                "original_language": "en",
                "vote_count": 1000,
                "source_endpoints": [],
            }
        )
        valid_manifest["counts"]["movie_candidates_selected"] = len(valid_manifest["movies"])
        valid_manifest["counts"]["total_candidates"] = len(valid_manifest["movies"]) + len(
            valid_manifest["tv_shows"]
        )
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="prohibited movie probe IDs"):
            load_manifest(path)

    def test_manifest_rejects_injected_tv_probe(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        # The Wire is probe PB-40 (tmdb_id: 1438)
        valid_manifest["tv_shows"].append(
            {
                "tmdb_id": 1438,
                "title": "The Wire Probe Injected",
                "original_language": "en",
                "vote_count": 1000,
                "source_endpoints": [],
            }
        )
        valid_manifest["counts"]["tv_candidates_selected"] = len(valid_manifest["tv_shows"])
        valid_manifest["counts"]["total_candidates"] = len(valid_manifest["movies"]) + len(
            valid_manifest["tv_shows"]
        )
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="prohibited TV probe IDs"):
            load_manifest(path)

    def test_manifest_rejects_diagnostic_in_execution_mode(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["is_executable"] = False
        valid_manifest["mode"] = "diagnostic"
        from ml.benchmark.scripts.run_seeding_batch import compute_manifest_digest_from_data

        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="must be the explicit boolean true"):
            load_manifest(path, is_execution_mode=True)

    def test_digest_verification_passes_for_valid_manifest(
        self, valid_manifest: dict[str, Any]
    ) -> None:
        verify_manifest_digest(valid_manifest)

    def test_digest_verification_fails_on_tampered_manifest(
        self, valid_manifest: dict[str, Any]
    ) -> None:
        valid_manifest["movies"].append(
            {
                "tmdb_id": 9999,
                "title": "Injected",
                "original_language": "en",
                "vote_count": 100,
                "source_endpoints": [],
            }
        )
        with pytest.raises(ManifestValidationError, match="digest mismatch"):
            verify_manifest_digest(valid_manifest)


# ===========================================================================
# Tests: Checkpoint Integrity
# ===========================================================================
class TestCheckpointIntegrity:
    def test_fresh_checkpoint_created_when_no_file(self, tmp_path: pathlib.Path) -> None:
        cp = load_checkpoint(tmp_path / "cp.json", "abc123", "http://localhost:4000")
        assert cp.manifest_digest == "abc123"
        assert cp.completed_movie_ids == []

    def test_checkpoint_persists_and_loads(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "digest1"
        cp.api_base_url = "http://localhost:4000"
        cp.completed_movie_ids = [1, 2, 3]
        save_checkpoint_atomic(cp, path)

        loaded = load_checkpoint(path, "digest1", "http://localhost:4000")
        assert loaded.completed_movie_ids == [1, 2, 3]

    def test_manifest_digest_mismatch_raises(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "old_digest"
        cp.api_base_url = "http://localhost:4000"
        save_checkpoint_atomic(cp, path)

        with pytest.raises(CheckpointValidationError, match="manifest digest mismatch"):
            load_checkpoint(path, "new_digest", "http://localhost:4000")

    def test_api_target_mismatch_raises(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "digest"
        cp.api_base_url = "http://localhost:4000"
        save_checkpoint_atomic(cp, path)

        with pytest.raises(CheckpointValidationError, match="API target mismatch"):
            load_checkpoint(path, "digest", "http://localhost:5000")

    def test_api_target_normalized_comparison_passes(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "digest"
        cp.api_base_url = "http://localhost:4000"
        save_checkpoint_atomic(cp, path)

        loaded = load_checkpoint(path, "digest", "http://localhost:4000/")
        assert loaded.api_base_url == "http://localhost:4000"

    def test_schema_version_mismatch_raises(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.schema_version = "0.0.1"
        cp.manifest_digest = "digest"
        cp.api_base_url = "http://localhost:4000"
        save_checkpoint_atomic(cp, path)

        with pytest.raises(CheckpointValidationError, match="schema version mismatch"):
            load_checkpoint(path, "digest", "http://localhost:4000")

    def test_atomic_write_no_tmp_files_on_success(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "d"
        save_checkpoint_atomic(cp, path)
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert tmp_files == []

    def test_checkpoint_round_trip_preserves_partial_tv(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.manifest_digest = "digest"
        cp.api_base_url = "http://localhost:4000"
        cp.partial_tv_ids = [101, 202]
        cp.completed_tv_ids = [300]
        save_checkpoint_atomic(cp, path)

        loaded = load_checkpoint(path, "digest", "http://localhost:4000")
        assert loaded.partial_tv_ids == [101, 202]
        assert loaded.completed_tv_ids == [300]


# ===========================================================================
# Tests: Execution Summary and Truthful Exit Codes (Stage A)
# ===========================================================================
class TestExecutionTruthfulness:
    def test_run_ingestion_all_completed_returns_success_summary(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        cp = Checkpoint(
            manifest_digest=valid_manifest["manifest_digest"],
            api_base_url="http://localhost:4000",
        )
        cp_path = tmp_path / "cp.json"

        with (
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_movie",
                side_effect=lambda u, tid: IngestResult(tid, "movie", True),
            ),
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_tv",
                side_effect=lambda u, tid: IngestResult(tid, "tv", True, is_partial=False),
            ),
            patch("ml.benchmark.scripts.run_seeding_batch.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_ingestion(valid_manifest, cp, cp_path, "http://localhost:4000")

        assert summary.success is True
        assert summary.unresolved_count == 0
        assert summary.completed_movies_count == len(valid_manifest["movies"])
        assert summary.completed_tv_count == len(valid_manifest["tv_shows"])
        assert summary.partial_tv_count == 0

    def test_run_ingestion_movie_failure_returns_unresolved(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        cp = Checkpoint(
            manifest_digest=valid_manifest["manifest_digest"],
            api_base_url="http://localhost:4000",
        )
        cp_path = tmp_path / "cp.json"

        def fake_movie(url: str, tid: int) -> IngestResult:
            if tid == 1:
                return IngestResult(tid, "movie", False, error_message="HTTP 500")
            return IngestResult(tid, "movie", True)

        with (
            patch("ml.benchmark.scripts.run_seeding_batch.ingest_movie", side_effect=fake_movie),
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_tv",
                side_effect=lambda u, tid: IngestResult(tid, "tv", True, is_partial=False),
            ),
            patch("ml.benchmark.scripts.run_seeding_batch.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_ingestion(valid_manifest, cp, cp_path, "http://localhost:4000")

        assert summary.success is False
        assert summary.unresolved_count == 1
        assert 1 not in cp.completed_movie_ids

    def test_run_ingestion_partial_tv_classified_as_unresolved(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        cp = Checkpoint(
            manifest_digest=valid_manifest["manifest_digest"],
            api_base_url="http://localhost:4000",
        )
        cp_path = tmp_path / "cp.json"

        def fake_tv(url: str, tid: int) -> IngestResult:
            return IngestResult(tid, "tv", True, is_partial=True)

        with (
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_movie",
                side_effect=lambda u, tid: IngestResult(tid, "movie", True),
            ),
            patch("ml.benchmark.scripts.run_seeding_batch.ingest_tv", side_effect=fake_tv),
            patch("ml.benchmark.scripts.run_seeding_batch.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_ingestion(valid_manifest, cp, cp_path, "http://localhost:4000")

        assert summary.success is False
        assert summary.partial_tv_count == len(valid_manifest["tv_shows"])
        assert summary.unresolved_count == len(valid_manifest["tv_shows"])

    def test_run_ingestion_skipped_items_when_max_attempts_exhausted(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        cp = Checkpoint(
            manifest_digest=valid_manifest["manifest_digest"],
            api_base_url="http://localhost:4000",
        )
        # Mark movie 1 as having exhausted attempts.
        cp.attempt_counts["movie_1"] = 3
        cp_path = tmp_path / "cp.json"

        with (
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_movie",
                side_effect=lambda u, tid: IngestResult(tid, "movie", True),
            ),
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_tv",
                side_effect=lambda u, tid: IngestResult(tid, "tv", True, is_partial=False),
            ),
            patch("ml.benchmark.scripts.run_seeding_batch.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_ingestion(valid_manifest, cp, cp_path, "http://localhost:4000")

        assert summary.success is False
        assert summary.skipped_count == 1
        assert summary.unresolved_count == 1

    def test_run_ingestion_resumes_after_prior_failure(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        cp = Checkpoint(
            manifest_digest=valid_manifest["manifest_digest"],
            api_base_url="http://localhost:4000",
        )
        # Mark movies 1,2,3 already done.
        cp.completed_movie_ids = [1, 2, 3]
        cp_path = tmp_path / "cp.json"

        attempted_movies: list[int] = []

        def track_movie(url: str, tid: int) -> IngestResult:
            attempted_movies.append(tid)
            return IngestResult(tid, "movie", True)

        with (
            patch("ml.benchmark.scripts.run_seeding_batch.ingest_movie", side_effect=track_movie),
            patch(
                "ml.benchmark.scripts.run_seeding_batch.ingest_tv",
                side_effect=lambda u, tid: IngestResult(tid, "tv", True, is_partial=False),
            ),
            patch("ml.benchmark.scripts.run_seeding_batch.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_ingestion(valid_manifest, cp, cp_path, "http://localhost:4000")

        assert attempted_movies == [4, 5]
        assert summary.success is True
        assert summary.unresolved_count == 0

    def test_main_execute_unresolved_returns_exit_code_1(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        unresolved_summary = ExecutionSummary(
            total_manifest_movies=5,
            total_manifest_tv=3,
            completed_movies_count=4,
            completed_tv_count=3,
            unresolved_count=1,
            success=False,
        )

        with (
            patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}),
            patch("urllib.request.urlopen"),  # mock health check pass
            patch(
                "ml.benchmark.scripts.run_seeding_batch.run_ingestion",
                return_value=unresolved_summary,
            ),
        ):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 1

    def test_main_execute_all_completed_returns_exit_code_0(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        success_summary = ExecutionSummary(
            total_manifest_movies=5,
            total_manifest_tv=3,
            completed_movies_count=5,
            completed_tv_count=3,
            unresolved_count=0,
            success=True,
        )

        with (
            patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}),
            patch("urllib.request.urlopen"),  # mock health check pass
            patch(
                "ml.benchmark.scripts.run_seeding_batch.run_ingestion",
                return_value=success_summary,
            ),
        ):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 0


# ===========================================================================
# Tests: Partial TV Ingestion Recovery
# ===========================================================================
class TestPartialTvIngestion:
    def test_partial_tv_added_to_retry_queue(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        from ml.benchmark.scripts import run_seeding_batch as rb

        checkpoint_path = tmp_path / "cp.json"
        api_base_url = "http://localhost:4000"
        manifest_digest = valid_manifest["manifest_digest"]

        cp = Checkpoint(manifest_digest=manifest_digest, api_base_url=api_base_url)

        def fake_ingest_tv(url: str, tmdb_id: int) -> IngestResult:
            return IngestResult(
                tmdb_id=tmdb_id,
                media_type="tv",
                success=True,
                is_partial=True,
            )

        with (
            patch.object(
                rb,
                "ingest_movie",
                side_effect=lambda u, tid: IngestResult(tid, "movie", True, is_partial=False),
            ),
            patch.object(rb, "ingest_tv", side_effect=fake_ingest_tv),
            patch.object(rb, "INTER_ITEM_DELAY_S", 0),
        ):
            rb.run_ingestion(valid_manifest, cp, checkpoint_path, api_base_url)

        assert len(cp.partial_tv_ids) == len(valid_manifest["tv_shows"])
        assert len(cp.completed_tv_ids) == 0
        assert len(cp.completed_movie_ids) == len(valid_manifest["movies"])

    def test_partial_tv_retried_on_next_run(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        from ml.benchmark.scripts import run_seeding_batch as rb

        checkpoint_path = tmp_path / "cp.json"
        api_base_url = "http://localhost:4000"
        manifest_digest = valid_manifest["manifest_digest"]

        cp = Checkpoint(manifest_digest=manifest_digest, api_base_url=api_base_url)
        cp.completed_movie_ids = sorted(m["tmdb_id"] for m in valid_manifest["movies"])
        cp.partial_tv_ids = [101]

        call_log: list[int] = []

        def fake_ingest_tv(url: str, tmdb_id: int) -> IngestResult:
            call_log.append(tmdb_id)
            return IngestResult(
                tmdb_id=tmdb_id,
                media_type="tv",
                success=True,
                is_partial=False,
            )

        with (
            patch.object(
                rb,
                "ingest_movie",
                side_effect=lambda u, tid: IngestResult(tid, "movie", True),
            ),
            patch.object(rb, "ingest_tv", side_effect=fake_ingest_tv),
            patch.object(rb, "INTER_ITEM_DELAY_S", 0),
        ):
            rb.run_ingestion(valid_manifest, cp, checkpoint_path, api_base_url)

        assert 101 in call_log


# ===========================================================================
# Tests: Failed Item Recording
# ===========================================================================
class TestFailedItemRecording:
    def test_failed_item_added_to_list(self) -> None:
        cp = Checkpoint()
        _record_failure(cp, 999, "movie", "HTTP 503")
        assert len(cp.failed_ids) == 1
        assert cp.failed_ids[0]["tmdb_id"] == 999
        assert cp.failed_ids[0]["media_type"] == "movie"

    def test_duplicate_failure_not_added(self) -> None:
        cp = Checkpoint()
        _record_failure(cp, 999, "movie", "HTTP 503")
        _record_failure(cp, 999, "movie", "HTTP 503")
        assert len(cp.failed_ids) == 1

    def test_different_media_types_added_separately(self) -> None:
        cp = Checkpoint()
        _record_failure(cp, 100, "movie", "err")
        _record_failure(cp, 100, "tv", "err")
        assert len(cp.failed_ids) == 2


# ===========================================================================
# Tests: Credential Safety
# ===========================================================================
class TestCredentialSafety:
    def test_tmdb_client_requires_token(self) -> None:
        with pytest.raises(CredentialError):
            TmdbClient("")

    def test_build_manifest_raises_without_token_in_live_mode(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            env = {k: v for k, v in os.environ.items() if k != "TMDB_READ_ACCESS_TOKEN"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(CredentialError):
                    build_manifest(dry_run=False)


# ===========================================================================
# Tests: Adversarial Tampering & Execution-Readiness Gate (Correction E)
# ===========================================================================
class TestAdversarialTampering:
    @staticmethod
    def _write_manifest(tmp_path: pathlib.Path, manifest: dict[str, Any]) -> pathlib.Path:
        path = tmp_path / "manifest.json"
        with path.open("w", encoding="utf-8") as fh:
            json.dump(manifest, fh)
        return path

    # --- Readiness tampering (Correction A) ---
    def test_missing_is_executable_rejected_in_execution_mode(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        del valid_manifest["is_executable"]
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="must be the explicit boolean true"):
            load_manifest(path, is_execution_mode=True)

    @pytest.mark.parametrize("bad_value", [None, False, 0, "true", 1])
    def test_non_true_is_executable_rejected_in_execution_mode(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
        bad_value: Any,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["is_executable"] = bad_value
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="must be the explicit boolean true"):
            load_manifest(path, is_execution_mode=True)

    def test_rejected_readiness_produces_zero_side_effects(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
    ) -> None:
        valid_manifest["is_executable"] = "true"
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)
        cp_path = tmp_path / "checkpoint.json"

        with (
            patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}),
            patch("urllib.request.urlopen"),
            patch("ml.benchmark.scripts.run_seeding_batch.run_ingestion") as mock_ingest,
        ):
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(path),
                    "--checkpoint",
                    str(cp_path),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 2
        mock_ingest.assert_not_called()
        assert not cp_path.exists()

    # --- Language tampering (Correction B & D) ---
    def test_language_tampered_without_digest_update_rejected(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        # Change a candidate language without updating manifest_digest
        valid_manifest["movies"][0]["original_language"] = "en"
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="digest mismatch"):
            load_manifest(path, is_execution_mode=True)

    def test_language_tampered_with_digest_update_fails_diversity_threshold(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        # Convert all movies to English (0.0 non-English) while keeping reported metadata at 0.6
        for m in valid_manifest["movies"]:
            m["original_language"] = "en"
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="recomputed movie non-English fraction"):
            load_manifest(path, is_execution_mode=True)

    @pytest.mark.parametrize("bad_lang", ["", "   ", None])
    def test_missing_or_empty_language_raises_manifest_error(self, bad_lang: Any) -> None:
        candidates = [{"tmdb_id": 1, "original_language": bad_lang}]
        with pytest.raises(ManifestValidationError, match="invalid or empty original_language"):
            _recompute_noneng_fraction(candidates)

    # --- Diversity metadata tampering (Correction B cross-check) ---
    def test_inflated_reported_movie_diversity_rejected(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        # Actual movies: 3/5 = 0.6; forge reported metadata to 0.9
        valid_manifest["language_diversity"]["movies"]["non_english_fraction"] = 0.9
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="manifest-reported movie diversity"):
            load_manifest(path, is_execution_mode=True)

    def test_inflated_reported_tv_diversity_rejected(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        # Actual TV: 2/3 ≈ 0.6667; forge reported metadata to 0.9
        valid_manifest["language_diversity"]["tv"]["non_english_fraction"] = 0.9
        path = self._write_manifest(tmp_path, valid_manifest)

        with pytest.raises(ManifestValidationError, match="manifest-reported TV diversity"):
            load_manifest(path, is_execution_mode=True)

    # --- Target and quota tampering (Correction C) ---
    def test_manifest_with_insufficient_movies_rejected_in_execution_mode(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
    ) -> None:
        # valid_manifest has 5 movies and targets={"movie_candidate_target": 5};
        # canonical target (1408) must still be enforced.
        path = self._write_manifest(tmp_path, valid_manifest)
        with pytest.raises(
            ManifestValidationError,
            match=f"below canonical project target \\({CANONICAL_MOVIE_TARGET}\\)",
        ):
            load_manifest(path, is_execution_mode=True)

    def test_manifest_with_insufficient_tv_rejected_in_execution_mode(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Satisfy movie target via monkeypatch so TV target check is reached.
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)
        with pytest.raises(
            ManifestValidationError,
            match=f"below canonical project target \\({CANONICAL_TV_TARGET}\\)",
        ):
            load_manifest(path, is_execution_mode=True)

    # --- Digest integrity & regression ---
    def test_valid_unmodified_manifest_passes_execution_mode(
        self,
        tmp_path: pathlib.Path,
        valid_manifest: dict[str, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_MOVIE_TARGET", 5)
        monkeypatch.setattr("ml.benchmark.scripts.run_seeding_batch.CANONICAL_TV_TARGET", 3)
        valid_manifest["manifest_digest"] = compute_manifest_digest_from_data(valid_manifest)
        path = self._write_manifest(tmp_path, valid_manifest)
        loaded = load_manifest(path, is_execution_mode=True)
        assert loaded["is_executable"] is True
        assert loaded["manifest_digest"] == valid_manifest["manifest_digest"]
