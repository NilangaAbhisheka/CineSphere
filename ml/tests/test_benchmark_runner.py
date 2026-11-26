"""Tests for Stage 5.0 benchmark runner: retrieval, pooling, metrics, bootstrap."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from ml.benchmark.scripts.compute_metrics import (
    compute_ild,
    compute_macro_pooled_recall,
    compute_mrr_at_k,
    compute_recall_at_k,
    load_annotations,
    stratified_paired_bootstrap,
)
from ml.benchmark.scripts.generate_annotation_sheet import generate_annotation_sheets
from ml.benchmark.scripts.retrieve_candidates import (
    build_probe_pool,
    make_blinded_id,
    rank_candidates_for_probe,
)


def _make_synthetic_records(n: int = 30) -> list[dict]:
    records = []
    for i in range(n):
        media = "MOVIE" if i < 20 else "TV"
        records.append(
            {
                "media_type": media,
                "tmdb_id": 100 + i,
                "title": f"Title {i}",
                "overview": f"Overview {i}",
                "genres": ["Drama"],
                "year": 2020,
                "is_probe": i == 0,
                "probe_id": "PB-01" if i == 0 else None,
                "stratum": "Mainstream" if i == 0 else None,
            }
        )
    return records


def test_probe_self_exclusion_and_tie_breaking() -> None:
    records = _make_synthetic_records(10)
    # All embeddings identical -> cosine = 1.0 everywhere -> tie-breaking must be media_type ASC, tmdb_id ASC
    embs = np.ones((10, 4), dtype=np.float32)
    embs /= np.linalg.norm(embs, axis=1, keepdims=True)

    ranked = rank_candidates_for_probe(probe_idx=0, embeddings=embs, records=records, top_k=5)
    ranked_indices = [idx for idx, _ in ranked]
    assert 0 not in ranked_indices
    assert ranked_indices == [1, 2, 3, 4, 5]


def test_union_pool_deduplication_and_blinded_view(tmp_path: Path) -> None:
    records = _make_synthetic_records(30)
    rng = np.random.default_rng(7)
    emb_a = rng.normal(size=(30, 8)).astype(np.float32)
    emb_a /= np.linalg.norm(emb_a, axis=1, keepdims=True)
    emb_b = rng.normal(size=(30, 12)).astype(np.float32)
    emb_b /= np.linalg.norm(emb_b, axis=1, keepdims=True)

    pool, meta = build_probe_pool(
        probe=records[0],
        probe_idx=0,
        records=records,
        embeddings_by_model={"model_a": emb_a, "model_b": emb_b},
        top_k_pool=20,
        top_k_eval=10,
    )
    assert 20 <= pool["pool_size"] <= 40
    assert pool["pool_size"] == len(pool["candidates"])
    # No duplicate blinded_ids
    bids = [c["blinded_id"] for c in pool["candidates"]]
    assert len(bids) == len(set(bids))
    # Blinded view must not expose model provenance or scores
    for cand in pool["candidates"]:
        assert set(cand.keys()) == {
            "blinded_id",
            "title",
            "overview",
            "genres",
            "year",
            "media_type",
        }

    # Worksheet generation
    (tmp_path / "pool_PB-01.json").write_text(json.dumps(pool), encoding="utf-8")
    res = generate_annotation_sheets(annotation_dir=tmp_path)
    assert res["probe_count"] == 1
    assert res["total_candidates"] == pool["pool_size"]
    assert (tmp_path / "annotation_worksheet_v1.json").exists()
    assert (tmp_path / "annotation_worksheet_v1.md").exists()


def test_blinded_id_determinism() -> None:
    id1 = make_blinded_id("PB-01", "MOVIE", 27205)
    id2 = make_blinded_id("PB-01", "MOVIE", 27205)
    id3 = make_blinded_id("PB-02", "MOVIE", 27205)
    assert id1 == id2
    assert id1 != id3


def test_recall_mrr_and_macro_pooled_recall() -> None:
    relevant = {"c2", "c5", "c12"}
    top_10 = [f"c{i}" for i in range(1, 11)]
    assert compute_recall_at_k(top_10, relevant, k=10) == pytest.approx(2 / 3)
    assert compute_mrr_at_k(top_10, relevant, k=10) == pytest.approx(0.5)
    assert compute_mrr_at_k(["x1", "x2"], relevant, k=10) == 0.0
    assert compute_recall_at_k(top_10, set(), k=10) is None
    assert compute_macro_pooled_recall([1.0, None, 0.5]) == pytest.approx(0.75)


def test_ild_hand_calculated() -> None:
    # 3 orthogonal unit vectors -> pairwise cos = 0 -> pairwise dist = 1 -> ILD = 1.0
    embs = np.eye(3, dtype=np.float32)
    assert compute_ild(embs) == pytest.approx(1.0)
    # Identical vectors -> cos = 1 -> ILD = 0.0
    same = np.ones((3, 4), dtype=np.float32)
    same /= np.linalg.norm(same, axis=1, keepdims=True)
    assert compute_ild(same) == pytest.approx(0.0)
    # Single vector -> None
    assert compute_ild(embs[:1]) is None


def test_paired_bootstrap_reproducibility() -> None:
    probe_records = []
    for i in range(10):
        stratum = "S1" if i < 5 else "S2"
        probe_records.append(
            {
                "probe_id": f"PB-{i:02d}",
                "stratum": stratum,
                "model_a": {"mrr_at_10": 0.2 + 0.01 * i},
                "model_b": {"mrr_at_10": 0.4 + 0.02 * i},
            }
        )
    r1 = stratified_paired_bootstrap(probe_records, "mrr_at_10", n_iter=200, seed=42)
    r2 = stratified_paired_bootstrap(probe_records, "mrr_at_10", n_iter=200, seed=42)
    assert r1 == r2
    assert r1["paired_difference_b_minus_a"]["estimate"] > 0


def test_annotation_schema_validation_missing_grade(tmp_path: Path) -> None:
    ws = {
        "probes": [
            {
                "probe_id": "PB-01",
                "candidates": [{"blinded_id": "abc", "grade": None}],
            }
        ]
    }
    (tmp_path / "annotation_worksheet_v1.json").write_text(json.dumps(ws), encoding="utf-8")
    with pytest.raises(ValueError, match="Missing grade"):
        load_annotations(annotation_dir=tmp_path)
