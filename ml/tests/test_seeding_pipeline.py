"""
Tests for generate_candidate_manifest.py and run_seeding_batch.py.

All tests use mocks or disposable temporary directories.
No primary database writes are performed.
No live TMDB requests are made.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
from typing import Any
from unittest.mock import patch

import pytest
from ml.benchmark.scripts.generate_candidate_manifest import (
    _PROBES_PATH,
    MIN_OVERVIEW_LENGTH,
    MIN_VOTE_COUNT,
    MOVIE_NONENG_FRACTION,
    CandidateEntry,
    CredentialError,
    TmdbClient,
    build_manifest,
    compute_diversity_stats,
    compute_manifest_digest,
    is_valid_movie_candidate,
    is_valid_tv_candidate,
    load_probe_ids,
    select_with_diversity,
    write_manifest_atomic,
)
from ml.benchmark.scripts.run_seeding_batch import (
    ALLOW_SEEDING_ENV_VAR,
    Checkpoint,
    CheckpointValidationError,
    IngestResult,
    ManifestValidationError,
    _record_failure,
    load_checkpoint,
    load_manifest,
    main,
    save_checkpoint_atomic,
    verify_manifest_digest,
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
            "original_language": "en",
            "vote_count": 500,
            "source_endpoints": [],
        }
        for i in range(1, 6)
    ]
    tv_shows = [
        {
            "tmdb_id": i + 100,
            "title": f"Show {i}",
            "original_language": "en",
            "vote_count": 500,
            "source_endpoints": [],
        }
        for i in range(1, 4)
    ]

    movie_ids = sorted(m["tmdb_id"] for m in movies)
    tv_ids = sorted(t["tmdb_id"] for t in tv_shows)
    digest_payload = {
        "schema_version": "1.0.0",
        "filtering_criteria": filtering_criteria,
        "movie_ids": movie_ids,
        "tv_ids": tv_ids,
    }
    digest = hashlib.sha256(json.dumps(digest_payload, sort_keys=True).encode()).hexdigest()

    return {
        "schema_version": "1.0.0",
        "manifest_version": "1.0.0",
        "generation_timestamp": "2026-11-24T00:00:00+00:00",
        "source_endpoints": ["/movie/top_rated"],
        "filtering_criteria": filtering_criteria,
        "targets": {"movie_candidate_target": 1412, "tv_candidate_target": 556},
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
            "enabled": False,
            "movies_already_in_catalogue": 0,
            "tv_shows_already_in_catalogue": 0,
        },
        "language_diversity": {"movies": {}, "tv": {}},
        "movies": movies,
        "tv_shows": tv_shows,
        "manifest_digest": digest,
    }


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
        # Authoritative fixture contains 38 movies and 12 TV probes.
        assert len(probe_ids["movie"]) == 38
        assert len(probe_ids["tv"]) == 12

    def test_load_probe_ids_known_ids_present(self) -> None:
        probe_ids = load_probe_ids(_PROBES_PATH)
        # PB-01 Inception = movie 27205
        assert 27205 in probe_ids["movie"]
        # PB-27 Manchester by the Sea (corrected) = 334541
        assert 334541 in probe_ids["movie"]
        # PB-40 The Wire (corrected) = 1438
        assert 1438 in probe_ids["tv"]
        # PB-46 Samsara (corrected) = 89708
        assert 89708 in probe_ids["movie"]
        # PB-45 Twin Peaks = 1920
        assert 1920 in probe_ids["tv"]

    def test_load_probe_ids_erroneous_ids_absent(self) -> None:
        """The old incorrect IDs must NOT appear in the probe set."""
        probe_ids = load_probe_ids(_PROBES_PATH)
        assert 334543 not in probe_ids["movie"]  # was Lion, not Manchester
        assert 3297 not in probe_ids["tv"]  # was Wilfred, not The Wire
        assert 85350 not in probe_ids["movie"]  # was Boyhood, not Samsara


# ===========================================================================
# Tests: Candidate Deduplication
# ===========================================================================
class TestCandidateDeduplication:
    def test_selection_output_sorted_by_tmdb_id(self) -> None:
        """select_with_diversity always returns output sorted by tmdb_id."""
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
        # 10 non-English and 10 English → 50% non-English ≥ required 25%.
        candidates = [_make_candidate(tmdb_id=i, language="fr") for i in range(1, 11)] + [
            _make_candidate(tmdb_id=i + 100, language="en") for i in range(1, 11)
        ]
        selected = select_with_diversity(candidates, 20, MOVIE_NONENG_FRACTION)
        non_eng = sum(1 for c in selected if c.original_language != "en")
        total = len(selected)
        assert non_eng / total >= MOVIE_NONENG_FRACTION

    def test_non_english_fraction_prioritized_first(self) -> None:
        # Only 2 non-English available out of 20 candidates; they must be selected.
        candidates = [
            _make_candidate(tmdb_id=i, language="ko", vote_count=100) for i in range(1, 3)
        ] + [_make_candidate(tmdb_id=i + 50, language="en", vote_count=200) for i in range(1, 19)]
        min_noneng = max(1, int(10 * MOVIE_NONENG_FRACTION))  # 2 or 3
        selected = select_with_diversity(candidates, 10, MOVIE_NONENG_FRACTION)
        non_eng_ids = {c.tmdb_id for c in selected if c.original_language != "en"}
        # Both Korean candidates should appear if available.
        assert non_eng_ids == {1, 2} or len(non_eng_ids) >= min(2, min_noneng)

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
        # No .tmp files should remain.
        tmp_files = list(temp_dir.glob("*.tmp"))
        assert tmp_files == []

    def test_manifest_path_created(self, temp_dir: pathlib.Path) -> None:
        nested = temp_dir / "deep" / "nested" / "manifest.json"
        write_manifest_atomic({"data": 1}, nested)
        assert nested.exists()


# ===========================================================================
# Tests: Dry-run mode (build_manifest)
# ===========================================================================
class TestBuildManifestDryRun:
    def test_dry_run_returns_manifest_dict(self) -> None:
        manifest = build_manifest(dry_run=True)
        assert "schema_version" in manifest
        assert "movies" in manifest
        assert "tv_shows" in manifest
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
        assert written == [], "dry_run=True must not write any file"

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
        assert created_clients == [], "dry_run=True must not create a TmdbClient"


# ===========================================================================
# Tests: Execution safeguards (run_seeding_batch)
# ===========================================================================
class TestExecutionSafeguards:
    def test_missing_env_var_returns_error_code(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """--execute without env var must return exit code 2."""
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
                    "--checkpoint",
                    str(tmp_path / "checkpoint.json"),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 2

    def test_dry_run_returns_zero_without_env_var(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """Dry-run mode must succeed without the safeguard env var."""
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        env = {k: v for k, v in os.environ.items() if k != ALLOW_SEEDING_ENV_VAR}
        with patch.dict(os.environ, env, clear=True):
            rc = main(
                [
                    "--manifest",
                    str(manifest_path),
                    "--checkpoint",
                    str(tmp_path / "checkpoint.json"),
                    "--api-url",
                    "http://localhost:4000",
                ]
            )
        assert rc == 0

    def test_execute_with_env_var_checks_api_health(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """--execute with env var must attempt an API health check and fail gracefully."""
        manifest_path = tmp_path / "manifest.json"
        with manifest_path.open("w") as fh:
            json.dump(valid_manifest, fh)

        with patch.dict(os.environ, {ALLOW_SEEDING_ENV_VAR: "true"}):
            # Health check will fail (no server running); must return non-zero exit code.
            rc = main(
                [
                    "--execute",
                    "--manifest",
                    str(manifest_path),
                    "--checkpoint",
                    str(tmp_path / "checkpoint.json"),
                    "--api-url",
                    "http://localhost:19999",
                ]
            )
        assert rc == 2


# ===========================================================================
# Tests: Manifest validation (run_seeding_batch)
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
        path = tmp_path / "manifest.json"
        with path.open("w") as fh:
            json.dump(valid_manifest, fh)
        with pytest.raises(ManifestValidationError, match="non-empty string"):
            load_manifest(path)

    def test_digest_verification_passes_for_valid_manifest(
        self, valid_manifest: dict[str, Any]
    ) -> None:
        verify_manifest_digest(valid_manifest)  # must not raise

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
# Tests: Checkpoint integrity
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

    def test_schema_version_mismatch_raises(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "cp.json"
        cp = Checkpoint()
        cp.schema_version = "0.0.1"  # older version
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
# Tests: Partial TV ingestion recovery
# ===========================================================================
class TestPartialTvIngestion:
    def test_partial_tv_added_to_retry_queue(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """When isPartial=True, TV show must be added to partial_tv_ids, not completed_tv_ids."""
        from ml.benchmark.scripts import run_seeding_batch as rb

        checkpoint_path = tmp_path / "cp.json"
        api_base_url = "http://localhost:4000"
        manifest_digest = valid_manifest["manifest_digest"]

        cp = Checkpoint()
        cp.manifest_digest = manifest_digest
        cp.api_base_url = api_base_url

        def fake_ingest_tv(url: str, tmdb_id: int) -> IngestResult:
            return IngestResult(
                tmdb_id=tmdb_id,
                media_type="tv",
                success=True,
                is_partial=True,
            )

        def fake_ingest_movie(url: str, tmdb_id: int) -> IngestResult:
            return IngestResult(
                tmdb_id=tmdb_id,
                media_type="movie",
                success=True,
                is_partial=False,
            )

        with (
            patch.object(rb, "ingest_movie", side_effect=fake_ingest_movie),
            patch.object(rb, "ingest_tv", side_effect=fake_ingest_tv),
            patch.object(rb, "INTER_ITEM_DELAY_S", 0),
        ):
            rb.run_ingestion(valid_manifest, cp, checkpoint_path, api_base_url)

        # TV shows should be in partial queue, not completed.
        assert len(cp.partial_tv_ids) == len(valid_manifest["tv_shows"])
        assert len(cp.completed_tv_ids) == 0
        # Movies should be completed.
        assert len(cp.completed_movie_ids) == len(valid_manifest["movies"])

    def test_partial_tv_retried_on_next_run(
        self, tmp_path: pathlib.Path, valid_manifest: dict[str, Any]
    ) -> None:
        """Partial TV IDs should be retried in the next ingestion pass."""
        from ml.benchmark.scripts import run_seeding_batch as rb

        checkpoint_path = tmp_path / "cp.json"
        api_base_url = "http://localhost:4000"
        manifest_digest = valid_manifest["manifest_digest"]

        # Set up checkpoint with partial TV IDs from a previous run.
        cp = Checkpoint()
        cp.manifest_digest = manifest_digest
        cp.api_base_url = api_base_url
        # Mark all movies and English tv as done, only tv 101 as partial.
        cp.completed_movie_ids = sorted(m["tmdb_id"] for m in valid_manifest["movies"])
        cp.partial_tv_ids = [101]  # from the tv_shows list in valid_manifest

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
                rb, "ingest_movie", side_effect=lambda u, tid: IngestResult(tid, "movie", True)
            ),
            patch.object(rb, "ingest_tv", side_effect=fake_ingest_tv),
            patch.object(rb, "INTER_ITEM_DELAY_S", 0),
        ):
            rb.run_ingestion(valid_manifest, cp, checkpoint_path, api_base_url)

        # TV show 101 must have been attempted.
        assert 101 in call_log


# ===========================================================================
# Tests: Failed item recording
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
# Tests: Credential safety
# ===========================================================================
class TestCredentialSafety:
    def test_tmdb_client_requires_token(self) -> None:
        with pytest.raises(CredentialError):
            TmdbClient("")

    def test_build_manifest_raises_without_token_in_live_mode(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            # Clear TMDB_READ_ACCESS_TOKEN
            env = {k: v for k, v in os.environ.items() if k != "TMDB_READ_ACCESS_TOKEN"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(CredentialError):
                    build_manifest(dry_run=False)
