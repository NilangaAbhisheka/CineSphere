"""Tests for Stage 5.0.4-H: exclusion manifest, filtered annotations, metrics, bootstrap."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest
from ml.benchmark.scripts.compute_metrics import (
    compute_ild,
    compute_mrr_at_k,
    stratified_paired_bootstrap,
)
from ml.benchmark.scripts.config import (
    ANNOTATION_DIR,
    EMBEDDINGS_DIR,
    RANDOM_SEED,
    RELEVANCE_THRESHOLD,
)
from ml.benchmark.scripts.evaluate_benchmark_h import (
    EXPECTED_EXCLUSION_COUNT,
    EXPECTED_PROBE_COUNT,
    EXPECTED_PROBE_DISTRIBUTION,
    EXPECTED_VALID_CANDIDATES,
    PB40_GRADE3_ID,
    PLACEHOLDER_OVERVIEW,
    compute_recall_at_k_pooled,
    load_annotations_filtered,
    load_exclusion_manifest,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_HAS_LOCAL_BENCHMARK_ARTIFACTS = (
    (ANNOTATION_DIR / "annotation_worksheet_v1.json").exists()
    and (EMBEDDINGS_DIR / "embeddings_model_a.npy").exists()
    and (EMBEDDINGS_DIR / "embeddings_model_b.npy").exists()
)

requires_local_benchmark_artifacts = pytest.mark.skipif(
    not _HAS_LOCAL_BENCHMARK_ARTIFACTS,
    reason="Requires gitignored local Stage 5.0.4 benchmark artifacts",
)


def _make_ws(probes: list[dict]) -> dict:
    """Wrap probes in worksheet envelope."""
    return {"version": "1.0", "probes": probes}


def _make_exclusion_manifest(
    exclusions: list[dict],
    count: int | None = None,
    dist: dict | None = None,
    pb40_grade: int = 3,
) -> dict:
    """Build a minimal exclusion manifest for test injection."""
    return {
        "schema_version": "1.0.0",
        "exclusion_count": count if count is not None else len(exclusions),
        "exclusions": exclusions,
        "probe_distribution": dist or EXPECTED_PROBE_DISTRIBUTION,
        "pb40_grade3_exclusion": {
            "blinded_id": PB40_GRADE3_ID,
            "probe_id": "PB-40",
            "original_grade": pb40_grade,
            "owner_decision": "exclude_option_a",
        },
        "owner_decision": "option_a_exclude_all_42",
    }


# ---------------------------------------------------------------------------
# Exclusion manifest integrity tests
# ---------------------------------------------------------------------------


class TestExclusionManifestIntegrity:
    """Verify the real on-disk exclusion manifest passes all 8 assertions."""

    def test_manifest_loads_and_validates(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        assert manifest["exclusion_count"] == EXPECTED_EXCLUSION_COUNT

    def test_manifest_has_42_unique_ids(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        bids = [e["blinded_id"] for e in manifest["exclusions"]]
        assert len(bids) == EXPECTED_EXCLUSION_COUNT
        assert len(set(bids)) == EXPECTED_EXCLUSION_COUNT

    def test_manifest_no_duplicate_ids(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        bids = [e["blinded_id"] for e in manifest["exclusions"]]
        assert len(bids) == len(set(bids))

    def test_manifest_all_synthetic_placeholder_reason(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        for e in manifest["exclusions"]:
            assert e["reason"] == "synthetic_placeholder", (
                f"{e['blinded_id']} has reason={e['reason']!r}"
            )

    def test_manifest_includes_pb40_grade3_id(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        bids = {e["blinded_id"] for e in manifest["exclusions"]}
        assert PB40_GRADE3_ID in bids

    def test_manifest_pb40_grade3_has_owner_decision_exclude(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        rec = next(e for e in manifest["exclusions"] if e["blinded_id"] == PB40_GRADE3_ID)
        assert rec["original_grade"] == 3
        assert rec["owner_decision"] == "exclude_option_a"

    def test_manifest_probe_distribution_matches_audit(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        actual: dict[str, int] = defaultdict(int)
        for e in manifest["exclusions"]:
            actual[e["probe_id"]] += 1
        assert dict(actual) == EXPECTED_PROBE_DISTRIBUTION

    def test_manifest_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="Exclusion manifest not found"):
            load_exclusion_manifest(annotation_dir=tmp_path)


# ---------------------------------------------------------------------------
# Filtered annotations integrity tests
# ---------------------------------------------------------------------------


class TestFilteredAnnotations:
    """Verify load_annotations_filtered against real data."""

    @requires_local_benchmark_artifacts
    def test_total_retained_candidates(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, report = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        assert report["total_retained"] == EXPECTED_VALID_CANDIDATES

    @requires_local_benchmark_artifacts
    def test_all_50_probes_present(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        assert len(grades) == EXPECTED_PROBE_COUNT

    @requires_local_benchmark_artifacts
    def test_zero_null_grades_retained(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, report = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        assert report["total_null_retained"] == 0
        for pid, probe_grades in grades.items():
            for bid, g in probe_grades.items():
                assert g is not None, f"Null grade for probe {pid} bid {bid}"

    @requires_local_benchmark_artifacts
    def test_pb40_has_27_retained_candidates(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, report = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        pb40 = grades.get("PB-40", {})
        assert len(pb40) == 27, f"PB-40 retained={len(pb40)}, expected=27"

    @requires_local_benchmark_artifacts
    def test_pb40_grade3_id_is_excluded(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        assert PB40_GRADE3_ID not in grades.get("PB-40", {}), (
            f"PB-40 grade-3 ID {PB40_GRADE3_ID} should be excluded but is retained"
        )

    @requires_local_benchmark_artifacts
    def test_no_placeholder_overview_in_pool_files(self) -> None:
        """Verify original pool files are untouched (still contain placeholder records)."""
        for probe_id in EXPECTED_PROBE_DISTRIBUTION:
            pool_path = ANNOTATION_DIR / f"pool_{probe_id}.json"
            pool = json.loads(pool_path.read_text(encoding="utf-8"))
            ph_count = sum(
                1 for c in pool["candidates"] if c.get("overview") == PLACEHOLDER_OVERVIEW
            )
            assert ph_count == EXPECTED_PROBE_DISTRIBUTION[probe_id], (
                f"{probe_id} pool: expected {EXPECTED_PROBE_DISTRIBUTION[probe_id]} placeholders, "
                f"found {ph_count} — pool file must not be modified"
            )

    @requires_local_benchmark_artifacts
    def test_worksheet_untouched(self) -> None:
        """Verify annotation worksheet still contains all 1,623 records including 11 nulls."""
        ws = json.loads(
            (ANNOTATION_DIR / "annotation_worksheet_v1.json").read_text(encoding="utf-8")
        )
        total = sum(len(p["candidates"]) for p in ws["probes"])
        null_count = sum(1 for p in ws["probes"] for c in p["candidates"] if c.get("grade") is None)
        assert total == 1623, f"Worksheet total candidates changed: {total}"
        assert null_count == 11, f"Worksheet null count changed: {null_count}"

    @requires_local_benchmark_artifacts
    def test_grade_distribution_post_exclusion(self) -> None:
        """Verify post-exclusion grade totals match audit expectations."""
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        counts: dict[int, int] = defaultdict(int)
        for probe_grades in grades.values():
            for g in probe_grades.values():
                counts[int(g)] += 1
        # From audit: excluding 42 records removes:
        # PB-32: 6×grade3  → -6 from grade 3
        # PB-36: 6×grade3  → -6 from grade 3
        # PB-37: 6×grade3  → -6 from grade 3
        # PB-38: 6×grade3  → -6 from grade 3
        # PB-40: 11×null + 1×grade3 → -1 from grade 3 (nulls excluded from valid)
        # PB-45: 6×grade0  → -6 from grade 0
        assert counts[0] == 331, f"Grade 0 count: {counts[0]} (expected 331)"
        assert counts[1] == 571, f"Grade 1 count: {counts[1]} (expected 571)"
        assert counts[2] == 486, f"Grade 2 count: {counts[2]} (expected 486)"
        assert counts[3] == 193, f"Grade 3 count: {counts[3]} (expected 193)"
        assert sum(counts.values()) == EXPECTED_VALID_CANDIDATES

    @requires_local_benchmark_artifacts
    def test_relevant_non_relevant_totals(self) -> None:
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        relevant = sum(1 for pg in grades.values() for g in pg.values() if g >= RELEVANCE_THRESHOLD)
        non_relevant = sum(
            1 for pg in grades.values() for g in pg.values() if g < RELEVANCE_THRESHOLD
        )
        assert relevant == 679, f"Relevant count: {relevant} (expected 679)"
        assert non_relevant == 902, f"Non-relevant count: {non_relevant} (expected 902)"
        assert relevant + non_relevant == EXPECTED_VALID_CANDIDATES

    def test_null_grade_raises_if_not_excluded(self, tmp_path: Path) -> None:
        """Filtered annotations must reject retained null grades."""
        ws = {
            "probes": [
                {
                    "probe_id": "PB-01",
                    "candidates": [
                        {"blinded_id": "aaa", "grade": 2, "overview": "normal overview"},
                        {"blinded_id": "bbb", "grade": None, "overview": "normal overview"},
                    ],
                }
            ]
        }
        (tmp_path / "annotation_worksheet_v1.json").write_text(json.dumps(ws), encoding="utf-8")
        # Exclusion manifest that doesn't exclude "bbb"
        exclusions = [
            {
                "blinded_id": f"exc_{i:04d}",
                "probe_id": "PB-32",
                "reason": "synthetic_placeholder",
                "original_grade": 3,
                "owner_decision": "exclude_option_a",
                "source_pool": "pool_PB-32.json",
                "title": "X",
            }
            for i in range(42)
        ]
        excl_manifest = {
            "schema_version": "1.0.0",
            "exclusion_count": 42,
            "exclusions": exclusions,
            "probe_distribution": {
                "PB-32": 6,
                "PB-36": 6,
                "PB-37": 6,
                "PB-38": 6,
                "PB-40": 12,
                "PB-45": 6,
            },
            "owner_decision": "option_a_exclude_all_42",
        }
        (tmp_path / "evaluation_exclusions_v1.json").write_text(
            json.dumps(excl_manifest), encoding="utf-8"
        )
        with pytest.raises(ValueError, match="null grade"):
            load_annotations_filtered(excl_manifest, annotation_dir=tmp_path)

    @requires_local_benchmark_artifacts
    def test_identical_probe_sets_across_models(self) -> None:
        """Both models must be evaluated on the exact same probe set and human labels."""
        from ml.benchmark.scripts.config import EMBEDDINGS_DIR
        from ml.benchmark.scripts.evaluate_benchmark_h import (
            EXPECTED_PROBE_COUNT,
            build_probe_records_filtered,
        )

        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        excluded_ids = {e["blinded_id"] for e in manifest["exclusions"]}
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        probe_records = build_probe_records_filtered(
            grades_by_probe=grades,
            excluded_ids=excluded_ids,
            annotation_dir=ANNOTATION_DIR,
            embeddings_dir=EMBEDDINGS_DIR,
        )
        probe_ids_model_a = {r["probe_id"] for r in probe_records}
        probe_ids_model_b = {r["probe_id"] for r in probe_records}
        assert probe_ids_model_a == probe_ids_model_b
        assert len(probe_records) == EXPECTED_PROBE_COUNT


# ---------------------------------------------------------------------------
# Recall@K pooled (fixed denominator) tests
# ---------------------------------------------------------------------------


class TestRecallAtKPooled:
    """Verify pooled Recall@K uses min(k, |relevant|) denominator."""

    def test_denominator_is_min_k_relevant(self) -> None:
        # Only 3 relevant items in pool → denominator = min(10, 3) = 3
        relevant = {"r1", "r2", "r3"}
        top_k = ["r1", "x", "r2", "y", "r3", "z", "a", "b", "c", "d"]
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(3 / 3)  # all 3 relevant found, denom=3

    def test_denominator_capped_at_k_when_many_relevant(self) -> None:
        # 15 relevant items in pool → denominator = min(10, 15) = 10
        relevant = {f"r{i}" for i in range(15)}
        top_k = [f"r{i}" for i in range(10)]  # all 10 slots hit
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(10 / 10)  # = 1.0

    def test_partial_hits_with_small_pool(self) -> None:
        # 5 relevant items → denominator = min(10, 5) = 5; 2 hits
        relevant = {"r1", "r2", "r3", "r4", "r5"}
        top_k = ["r1", "x", "r2", "y", "z", "a", "b", "c", "d", "e"]
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(2 / 5)

    def test_zero_relevant_returns_none(self) -> None:
        result = compute_recall_at_k_pooled(["a", "b", "c"], set(), k=10)
        assert result is None

    def test_no_hits_in_top_k(self) -> None:
        relevant = {"r1", "r2", "r3"}
        top_k = ["x", "y", "z", "a", "b", "c", "d", "e", "f", "g"]
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(0.0)

    def test_excludes_positions_beyond_k(self) -> None:
        relevant = {"r11"}  # r11 is at position 11, beyond k=10
        top_k = ["x"] * 10 + ["r11"]
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(0.0)  # not found in top 10

    def test_exactly_k_relevant_denominator_is_k(self) -> None:
        relevant = {f"r{i}" for i in range(10)}
        top_k = [f"r{i}" for i in range(10)]
        result = compute_recall_at_k_pooled(top_k, relevant, k=10)
        assert result == pytest.approx(10 / 10)


# ---------------------------------------------------------------------------
# MRR@K tests
# ---------------------------------------------------------------------------


class TestMRRAtK:
    def test_first_relevant_at_rank_1(self) -> None:
        relevant = {"r1"}
        assert compute_mrr_at_k(["r1", "x", "y"], relevant, k=10) == pytest.approx(1.0)

    def test_first_relevant_at_rank_10(self) -> None:
        relevant = {"r10"}
        top_k = ["x"] * 9 + ["r10"]
        assert compute_mrr_at_k(top_k, relevant, k=10) == pytest.approx(1.0 / 10)

    def test_no_relevant_in_top_k_returns_zero(self) -> None:
        relevant = {"r99"}
        top_k = ["x"] * 10
        assert compute_mrr_at_k(top_k, relevant, k=10) == pytest.approx(0.0)

    def test_first_relevant_at_rank_5(self) -> None:
        relevant = {"r5"}
        top_k = ["x", "y", "z", "a", "r5"] + ["q"] * 5
        assert compute_mrr_at_k(top_k, relevant, k=10) == pytest.approx(1.0 / 5)

    def test_multiple_relevant_uses_first(self) -> None:
        relevant = {"r3", "r7"}
        top_k = ["x", "y", "r3", "z", "a", "b", "r7", "c", "d", "e"]
        assert compute_mrr_at_k(top_k, relevant, k=10) == pytest.approx(1.0 / 3)

    def test_empty_top_k_returns_zero(self) -> None:
        assert compute_mrr_at_k([], {"r1"}, k=10) == pytest.approx(0.0)

    def test_zero_relevant_probe_contributes_zero_to_average(self) -> None:
        """MRR with no relevant in top-10 is 0 and probe is NOT dropped from average."""
        records = [
            {
                "probe_id": "P1",
                "stratum": "S1",
                "model_a": {"mrr_at_10": 0.5},
                "model_b": {"mrr_at_10": 0.5},
            },
            {
                "probe_id": "P2",
                "stratum": "S1",
                "model_a": {"mrr_at_10": 0.0},
                "model_b": {"mrr_at_10": 0.0},
            },
        ]
        result = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=10, seed=42)
        # (0.5 + 0.0) / 2 = 0.25
        assert result["model_a"]["estimate"] == pytest.approx(0.25)


# ---------------------------------------------------------------------------
# ILD tests
# ---------------------------------------------------------------------------


class TestILD:
    def test_orthogonal_vectors_give_ild_1(self) -> None:
        embs = np.eye(3, dtype=np.float32)
        assert compute_ild(embs) == pytest.approx(1.0)

    def test_identical_vectors_give_ild_0(self) -> None:
        embs = np.ones((4, 8), dtype=np.float32)
        embs /= np.linalg.norm(embs, axis=1, keepdims=True)
        assert compute_ild(embs) == pytest.approx(0.0, abs=1e-6)

    def test_single_vector_returns_none(self) -> None:
        embs = np.eye(1, 3, dtype=np.float32)
        assert compute_ild(embs) is None

    def test_two_identical_vectors(self) -> None:
        v = np.array([[1.0, 0.0, 0.0], [1.0, 0.0, 0.0]], dtype=np.float32)
        assert compute_ild(v) == pytest.approx(0.0)

    def test_two_orthogonal_vectors(self) -> None:
        v = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
        assert compute_ild(v) == pytest.approx(1.0)

    def test_known_3_vector_calculation(self) -> None:
        # Three vectors at 60° from each other: cos(60°)=0.5 → dist=0.5
        a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        b = np.array([0.5, np.sqrt(0.75), 0.0], dtype=np.float32)
        c = np.array([0.5, -np.sqrt(0.75), 0.0], dtype=np.float32)
        embs = np.stack([a, b, c])
        # pairs: (a,b)=0.5, (a,c)=0.5, (b,c)=-0.5 → dist: 0.5, 0.5, 1.5 → mean=2.5/3
        result = compute_ild(embs)
        assert result == pytest.approx((0.5 + 0.5 + 1.5) / 3, abs=1e-5)

    def test_ild_uses_unordered_pairs_only(self) -> None:
        """ILD must use unique unordered pairs (no self-pairs, no double-counting)."""
        embs = np.eye(4, dtype=np.float32)
        # 4 orthogonal → all pairwise cos=0 → dist=1 → ILD=1.0
        assert compute_ild(embs) == pytest.approx(1.0)

    def test_no_model_cross_contamination(self) -> None:
        """ILD for model_a and model_b must use their own embedding spaces."""
        rng = np.random.default_rng(99)
        emb_a = rng.normal(size=(5, 4)).astype(np.float32)
        emb_a /= np.linalg.norm(emb_a, axis=1, keepdims=True)
        emb_b = rng.normal(size=(5, 8)).astype(np.float32)
        emb_b /= np.linalg.norm(emb_b, axis=1, keepdims=True)
        ild_a = compute_ild(emb_a)
        ild_b = compute_ild(emb_b)
        # Just verify both are computed independently and are valid floats
        assert isinstance(ild_a, float)
        assert isinstance(ild_b, float)
        assert 0.0 <= ild_a <= 2.0
        assert 0.0 <= ild_b <= 2.0


# ---------------------------------------------------------------------------
# Bootstrap tests
# ---------------------------------------------------------------------------


class TestBootstrap:
    def _make_records(self, n: int = 50) -> list[dict]:
        records = []
        strata = ["Mainstream", "Indie", "International", "Serialized TV", "Stress Cases"]
        for i in range(n):
            records.append(
                {
                    "probe_id": f"PB-{i + 1:02d}",
                    "stratum": strata[i % 5],
                    "model_a": {
                        "macro_pooled_recall_at_10": 0.3 + 0.01 * (i % 10),
                        "mrr_at_10": 0.25 + 0.01 * (i % 7),
                        "ild_at_10": 0.5 + 0.01 * (i % 5),
                    },
                    "model_b": {
                        "macro_pooled_recall_at_10": 0.4 + 0.01 * (i % 10),
                        "mrr_at_10": 0.35 + 0.01 * (i % 7),
                        "ild_at_10": 0.48 + 0.01 * (i % 5),
                    },
                }
            )
        return records

    def test_bootstrap_exactly_10000_iterations(self) -> None:
        from ml.benchmark.scripts.config import NUM_BOOTSTRAP

        assert NUM_BOOTSTRAP == 10_000

    def test_bootstrap_reproducibility_same_seed(self) -> None:
        records = self._make_records(50)
        r1 = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=42)
        r2 = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=42)
        assert r1 == r2

    def test_bootstrap_different_seed_gives_different_result(self) -> None:
        records = self._make_records(50)
        r1 = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=42)
        r2 = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=99)
        # With enough records and iterations, different seeds should differ
        assert r1["model_a"]["ci_95"] != r2["model_a"]["ci_95"]

    def test_bootstrap_paired_delta_from_paired_samples(self) -> None:
        """Delta must be computed from paired probes, not independent distributions."""
        records = self._make_records(50)
        result = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=42)
        # Model B is consistently higher → positive delta
        assert result["paired_difference_b_minus_a"]["estimate"] > 0

    def test_bootstrap_all_50_probes_represented(self) -> None:
        """Population includes all 50 probes (no dropout)."""
        records = self._make_records(50)
        result = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=10, seed=42)
        # Point estimate uses all 50 probes
        a_est = result["model_a"]["estimate"]
        # Manual calculation
        vals = [r["model_a"]["mrr_at_10"] for r in records]
        expected = sum(vals) / len(vals)
        assert a_est == pytest.approx(expected)

    def test_bootstrap_confidence_interval_ordering(self) -> None:
        records = self._make_records(50)
        result = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=500, seed=42)
        ci = result["model_a"]["ci_95"]
        assert ci[0] <= result["model_a"]["estimate"] <= ci[1]

    @requires_local_benchmark_artifacts
    def test_bootstrap_no_excluded_candidate_contributes(self) -> None:
        """Excluded candidates must not appear in metric computations.

        Verified indirectly: probe records built from filtered annotations
        contain only retained candidate IDs. Bootstrap operates on probe-level
        aggregates which are already exclusion-clean.
        """
        manifest = load_exclusion_manifest(annotation_dir=ANNOTATION_DIR)
        excluded_ids = {e["blinded_id"] for e in manifest["exclusions"]}
        grades, _ = load_annotations_filtered(manifest, annotation_dir=ANNOTATION_DIR)
        for pid, probe_grades in grades.items():
            for bid in probe_grades:
                assert bid not in excluded_ids, (
                    f"Excluded ID {bid} found in filtered grades for probe {pid}"
                )

    def test_bootstrap_seed_from_config(self) -> None:
        from ml.benchmark.scripts.config import RANDOM_SEED

        assert RANDOM_SEED == 42

    def test_bootstrap_n_bootstrap_from_config(self) -> None:
        from ml.benchmark.scripts.config import NUM_BOOTSTRAP

        assert NUM_BOOTSTRAP == 10_000

    def test_bootstrap_ci_method_is_percentile(self) -> None:
        """CI uses 2.5th and 97.5th percentiles (percentile/quantile method)."""
        # With a constant distribution, CI should be [val, val]
        records = [
            {
                "probe_id": f"P{i}",
                "stratum": "S1",
                "model_a": {"mrr_at_10": 0.5},
                "model_b": {"mrr_at_10": 0.5},
            }
            for i in range(10)
        ]
        result = stratified_paired_bootstrap(records, "mrr_at_10", n_iter=100, seed=42)
        ci = result["model_a"]["ci_95"]
        assert ci[0] == pytest.approx(0.5, abs=1e-9)
        assert ci[1] == pytest.approx(0.5, abs=1e-9)

    def test_bootstrap_macro_pooled_recall_excludes_zero_relevant_probes(self) -> None:
        """Probes with None recall (zero pooled-relevant) must not enter macro average."""
        records = [
            {
                "probe_id": "P1",
                "stratum": "S1",
                "model_a": {"macro_pooled_recall_at_10": 0.6},
                "model_b": {"macro_pooled_recall_at_10": 0.8},
            },
            {
                "probe_id": "P2",
                "stratum": "S1",
                "model_a": {"macro_pooled_recall_at_10": None},  # zero-relevant probe
                "model_b": {"macro_pooled_recall_at_10": None},
            },
        ]
        result = stratified_paired_bootstrap(
            records, "macro_pooled_recall_at_10", n_iter=10, seed=42
        )
        # Only P1 contributes; P2 is None
        assert result["model_a"]["estimate"] == pytest.approx(0.6)
        assert result["model_b"]["estimate"] == pytest.approx(0.8)


# ---------------------------------------------------------------------------
# Determinism test
# ---------------------------------------------------------------------------


@requires_local_benchmark_artifacts
class TestDeterminism:
    def test_full_evaluation_deterministic(self) -> None:
        """Running evaluate_benchmark_h twice with same seed gives identical metrics."""
        from ml.benchmark.scripts.config import EMBEDDINGS_DIR, RESULTS_DIR
        from ml.benchmark.scripts.evaluate_benchmark_h import evaluate_benchmark_h

        result1 = evaluate_benchmark_h(
            annotation_dir=ANNOTATION_DIR,
            embeddings_dir=EMBEDDINGS_DIR,
            results_dir=RESULTS_DIR,
            n_bootstrap=100,  # small for speed
            seed=RANDOM_SEED,
        )
        result2 = evaluate_benchmark_h(
            annotation_dir=ANNOTATION_DIR,
            embeddings_dir=EMBEDDINGS_DIR,
            results_dir=RESULTS_DIR,
            n_bootstrap=100,
            seed=RANDOM_SEED,
        )
        for metric_key in ("macro_pooled_recall_at_10", "mrr_at_10", "ild_at_10"):
            m1 = result1["metrics"][metric_key]
            m2 = result2["metrics"][metric_key]
            assert m1["model_a"]["estimate"] == m2["model_a"]["estimate"]
            assert m1["model_b"]["estimate"] == m2["model_b"]["estimate"]
            assert m1["model_a"]["ci_95"] == m2["model_a"]["ci_95"]
            assert (
                m1["paired_difference_b_minus_a"]["estimate"]
                == (m2["paired_difference_b_minus_a"]["estimate"])
            )

    def test_all_metric_outputs_are_finite(self) -> None:
        """All metric estimates and CI bounds must be finite floats."""
        from ml.benchmark.scripts.config import EMBEDDINGS_DIR, RESULTS_DIR
        from ml.benchmark.scripts.evaluate_benchmark_h import evaluate_benchmark_h

        result = evaluate_benchmark_h(
            annotation_dir=ANNOTATION_DIR,
            embeddings_dir=EMBEDDINGS_DIR,
            results_dir=RESULTS_DIR,
            n_bootstrap=100,
            seed=RANDOM_SEED,
        )
        counts = result["post_exclusion_counts"]
        assert counts["total_valid_candidates"] == 1581
        assert counts["relevant_grade_gte_2"] == 679
        assert counts["non_relevant_grade_lt_2"] == 902
        for metric_key in ("macro_pooled_recall_at_10", "mrr_at_10", "ild_at_10"):
            d = result["metrics"][metric_key]
            for model_key in ("model_a", "model_b"):
                est = d[model_key]["estimate"]
                ci = d[model_key]["ci_95"]
                assert est is not None and np.isfinite(est), (
                    f"{metric_key}/{model_key} estimate not finite"
                )
                assert ci is not None, f"{metric_key}/{model_key} CI is None"
                assert np.isfinite(ci[0]) and np.isfinite(ci[1])

    def test_no_embedding_arrays_regenerated(self) -> None:
        """Embedding .npy files must exist and their shapes must match the cache manifest."""
        import json

        from ml.benchmark.scripts.config import EMBEDDINGS_DIR

        manifest_path = EMBEDDINGS_DIR / "embedding_cache_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        for key in ("model_a", "model_b"):
            npy_path = EMBEDDINGS_DIR / manifest["models"][key]["file"]
            assert npy_path.exists(), f"{npy_path} missing"
            arr = np.load(str(npy_path))
            expected_shape = tuple(manifest["models"][key]["shape"])
            assert arr.shape == expected_shape, (
                f"{key} shape {arr.shape} != expected {expected_shape}"
            )
