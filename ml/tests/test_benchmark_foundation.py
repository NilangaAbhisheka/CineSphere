"""Tests for Stage 5.0 benchmark foundation: fixture integrity, config, tokenizer, cache."""

from __future__ import annotations

from pathlib import Path

import pytest
from ml.benchmark.scripts.config import (
    EXPECTED_MOVIE_COUNT,
    EXPECTED_MOVIE_PROBE_COUNT,
    EXPECTED_PROBE_COUNT,
    EXPECTED_PROBES_PER_STRATUM,
    EXPECTED_RECORD_COUNT,
    EXPECTED_SHA256,
    EXPECTED_STRATA,
    EXPECTED_TV_COUNT,
    EXPECTED_TV_PROBE_COUNT,
    FIXTURE_PATH,
    MODELS,
)
from ml.benchmark.scripts.embed_catalogue import is_cache_valid
from ml.benchmark.scripts.tokenizer_audit import audit_model_tokenizer
from ml.benchmark.scripts.validate_fixture import (
    get_catalogue,
    get_probes,
    load_fixture,
    validate_fixture_integrity,
    validate_fixture_schema,
)


def test_fixture_sha256_matches() -> None:
    sha = validate_fixture_integrity(FIXTURE_PATH, EXPECTED_SHA256)
    assert sha == EXPECTED_SHA256


def test_fixture_record_count_and_distribution() -> None:
    records = load_fixture(FIXTURE_PATH)
    summary = validate_fixture_schema(records)
    assert summary["record_count"] == EXPECTED_RECORD_COUNT
    assert summary["movie_count"] == EXPECTED_MOVIE_COUNT
    assert summary["tv_count"] == EXPECTED_TV_COUNT
    assert summary["probe_count"] == EXPECTED_PROBE_COUNT
    assert summary["probe_movie_count"] == EXPECTED_MOVIE_PROBE_COUNT
    assert summary["probe_tv_count"] == EXPECTED_TV_PROBE_COUNT
    for stratum in EXPECTED_STRATA:
        assert summary["strata"][stratum] == EXPECTED_PROBES_PER_STRATUM


def test_fixture_probes_and_catalogue_partition() -> None:
    records = load_fixture(FIXTURE_PATH)
    probes = get_probes(records)
    catalogue = get_catalogue(records)
    assert len(probes) == EXPECTED_PROBE_COUNT
    assert len(catalogue) == EXPECTED_RECORD_COUNT - EXPECTED_PROBE_COUNT


def test_config_model_keys() -> None:
    assert set(MODELS.keys()) == {"model_a", "model_b"}
    assert MODELS["model_a"].model_id == "sentence-transformers/all-MiniLM-L6-v2"
    assert MODELS["model_a"].dim == 384
    assert MODELS["model_a"].max_seq_length == 256
    assert MODELS["model_b"].model_id == "sentence-transformers/all-mpnet-base-v2"
    assert MODELS["model_b"].dim == 768
    assert MODELS["model_b"].max_seq_length == 384


def test_cache_manifest_valid_vs_invalid_sha(tmp_path: Path) -> None:
    spec = MODELS["model_a"]
    emb_path = tmp_path / "embeddings_model_a.npy"
    emb_path.write_bytes(b"dummy")

    valid_manifest = {
        "fixture_sha256": EXPECTED_SHA256,
        "models": {
            "model_a": {
                "model_id": spec.model_id,
                "revision": spec.revision,
                "dim": spec.dim,
            }
        },
    }
    assert is_cache_valid(valid_manifest, EXPECTED_SHA256, spec, emb_path) is True
    assert is_cache_valid(valid_manifest, "wrong_sha", spec, emb_path) is False

    bad_rev_manifest = {
        "fixture_sha256": EXPECTED_SHA256,
        "models": {
            "model_a": {
                "model_id": spec.model_id,
                "revision": "other_rev",
                "dim": spec.dim,
            }
        },
    }
    assert is_cache_valid(bad_rev_manifest, EXPECTED_SHA256, spec, emb_path) is False
    assert is_cache_valid(valid_manifest, EXPECTED_SHA256, spec, tmp_path / "missing.npy") is False


def test_validate_fixture_schema_missing_field() -> None:
    records = load_fixture(FIXTURE_PATH)
    broken = [dict(r) for r in records]
    del broken[0]["canonical_text"]
    with pytest.raises(ValueError, match="missing required field"):
        validate_fixture_schema(broken)


def test_tokenizer_audit_with_mock_tokenizer() -> None:
    class _FakeTokenizer:
        def encode(
            self, text: str, add_special_tokens: bool = True, truncation: bool = False
        ) -> list[int]:
            return list(range(len(text.split()) + (2 if add_special_tokens else 0)))

    spec = MODELS["model_a"]
    texts = ["short text", "word " * 260]
    res = audit_model_tokenizer(texts=texts, spec=spec, tokenizer=_FakeTokenizer())
    assert res["record_count"] == 2
    assert res["exceeding_limit_count"] == 1
    assert res["exceeding_limit_pct"] == 50.0


def test_model_revisions_are_pinned_immutable_shas() -> None:
    import re

    sha_pattern = re.compile(r"^[0-9a-f]{40}$")
    for key, spec in MODELS.items():
        assert spec.revision != "main", f"{key} must not use mutable 'main' revision"
        assert sha_pattern.match(spec.revision), (
            f"{key} revision {spec.revision!r} is not a 40-char lowercase hex commit SHA"
        )
    assert MODELS["model_a"].revision == "e4ce9877abf3edfe10b0d82785e83bdcb973e22e"
    assert MODELS["model_b"].revision == "9a3225965996d404b775526de6dbfe85d3368642"
