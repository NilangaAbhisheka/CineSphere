"""Evaluation metrics and stratified paired bootstrap CIs for Stage 5.0 benchmark."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from ml.benchmark.scripts.config import (
    ANNOTATION_DIR,
    EMBEDDINGS_DIR,
    EXPECTED_SHA256,
    MODELS,
    NUM_BOOTSTRAP,
    RANDOM_SEED,
    RELEVANCE_THRESHOLD,
    RESULTS_DIR,
    TOP_K_EVAL,
)
from ml.benchmark.scripts.embed_catalogue import load_cached_embeddings


def load_annotations(
    worksheet_path: Path | None = None,
    annotation_dir: Path = ANNOTATION_DIR,
) -> dict[str, dict[str, float]]:
    """Load and validate graded annotations from annotation_worksheet_v1.json."""
    path = worksheet_path or (annotation_dir / "annotation_worksheet_v1.json")
    if not path.exists():
        raise FileNotFoundError(f"Annotation worksheet not found: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    grades_by_probe: dict[str, dict[str, float]] = {}
    for probe in data.get("probes", []):
        pid = str(probe["probe_id"])
        probe_grades: dict[str, float] = {}
        for cand in probe.get("candidates", []):
            bid = str(cand["blinded_id"])
            grade = cand.get("grade")
            if grade is None:
                raise ValueError(
                    f"Missing grade for probe {pid}, candidate {bid}. "
                    "Complete human annotation before computing metrics."
                )
            if not isinstance(grade, (int, float)) or not (0.0 <= float(grade) <= 3.0):
                raise ValueError(
                    f"Invalid grade {grade!r} for probe {pid}, candidate {bid}. "
                    "Expected numeric value in [0, 3]."
                )
            probe_grades[bid] = float(grade)
        grades_by_probe[pid] = probe_grades
    return grades_by_probe


def compute_recall_at_k(
    top_k_ids: list[str],
    relevant_ids: set[str],
    k: int = TOP_K_EVAL,
) -> float | None:
    """Compute Recall@K for a single probe. Returns None if |relevant_ids| == 0."""
    if not relevant_ids:
        return None
    hits = sum(1 for cid in top_k_ids[:k] if cid in relevant_ids)
    return hits / len(relevant_ids)


def compute_macro_pooled_recall(per_probe_recalls: list[float | None]) -> float | None:
    """Compute Macro Pooled Recall@K, excluding probes with zero pooled-relevant items."""
    valid = [r for r in per_probe_recalls if r is not None]
    if not valid:
        return None
    return float(sum(valid) / len(valid))


def compute_mrr_at_k(
    top_k_ids: list[str],
    relevant_ids: set[str],
    k: int = TOP_K_EVAL,
) -> float:
    """Compute Reciprocal Rank@K for a single probe (0.0 if no relevant item in top-K)."""
    for rank, cid in enumerate(top_k_ids[:k], start=1):
        if cid in relevant_ids:
            return 1.0 / rank
    return 0.0


def compute_ild(top_k_embeddings: np.ndarray) -> float | None:
    """Compute Intra-List Diversity (pairwise cosine distance) for K >= 2 embeddings."""
    k = top_k_embeddings.shape[0]
    if k < 2:
        return None
    sim_matrix = top_k_embeddings @ top_k_embeddings.T
    triu_i, triu_j = np.triu_indices(k, k=1)
    pair_dists = 1.0 - sim_matrix[triu_i, triu_j]
    return float(np.mean(pair_dists))


def _quantile_ci(values: list[float]) -> tuple[float, float]:
    arr = np.asarray(values, dtype=np.float64)
    return (float(np.quantile(arr, 0.025)), float(np.quantile(arr, 0.975)))


def stratified_paired_bootstrap(
    probe_records: list[dict[str, Any]],
    metric_key: str,
    model_a_key: str = "model_a",
    model_b_key: str = "model_b",
    n_iter: int = NUM_BOOTSTRAP,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    """Run stratified paired bootstrap resampling across probes.

    Both models use the identical resampled probe set in every bootstrap iteration.
    """
    rng = np.random.default_rng(seed)
    by_stratum: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in probe_records:
        by_stratum[str(rec["stratum"])].append(rec)

    strata = sorted(by_stratum.keys())

    def _agg(recs: list[dict[str, Any]], m_key: str) -> float | None:
        vals = [r[m_key][metric_key] for r in recs if r[m_key][metric_key] is not None]
        if not vals:
            return None
        return float(sum(vals) / len(vals))

    point_a = _agg(probe_records, model_a_key)
    point_b = _agg(probe_records, model_b_key)
    point_diff = (point_b - point_a) if (point_a is not None and point_b is not None) else None

    boot_a: list[float] = []
    boot_b: list[float] = []
    boot_diff: list[float] = []

    for _ in range(n_iter):
        sampled: list[dict[str, Any]] = []
        for s in strata:
            group = by_stratum[s]
            chosen_idx = rng.integers(0, len(group), size=len(group))
            sampled.extend(group[int(i)] for i in chosen_idx)

        val_a = _agg(sampled, model_a_key)
        val_b = _agg(sampled, model_b_key)
        if val_a is not None:
            boot_a.append(val_a)
        if val_b is not None:
            boot_b.append(val_b)
        if val_a is not None and val_b is not None:
            boot_diff.append(val_b - val_a)

    return {
        "metric": metric_key,
        model_a_key: {
            "estimate": point_a,
            "ci_95": _quantile_ci(boot_a) if boot_a else None,
        },
        model_b_key: {
            "estimate": point_b,
            "ci_95": _quantile_ci(boot_b) if boot_b else None,
        },
        "paired_difference_b_minus_a": {
            "estimate": point_diff,
            "ci_95": _quantile_ci(boot_diff) if boot_diff else None,
        },
        "n_bootstrap": n_iter,
        "seed": seed,
    }


def evaluate_benchmark(
    annotation_dir: Path = ANNOTATION_DIR,
    embeddings_dir: Path = EMBEDDINGS_DIR,
    results_dir: Path = RESULTS_DIR,
    n_bootstrap: int = NUM_BOOTSTRAP,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    """Compute all Stage 5.0 metrics and paired bootstrap CIs from graded annotations."""
    grades_by_probe = load_annotations(annotation_dir=annotation_dir)
    meta_files = sorted(annotation_dir.glob("retrieval_metadata_*.json"))
    if not meta_files:
        raise FileNotFoundError(f"No retrieval_metadata_*.json files found in {annotation_dir}.")

    embeddings_by_model = {
        key: load_cached_embeddings(
            key, fixture_sha256=EXPECTED_SHA256, embeddings_dir=embeddings_dir
        )
        for key in MODELS
    }

    probe_records: list[dict[str, Any]] = []
    for meta_path in meta_files:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        pid = str(meta["probe_id"])
        probe_grades = grades_by_probe[pid]
        relevant_ids = {bid for bid, g in probe_grades.items() if g >= RELEVANCE_THRESHOLD}
        blinded_to_key = meta["blinded_to_key"]

        entry: dict[str, Any] = {
            "probe_id": pid,
            "stratum": meta["probe_stratum"],
            "pooled_relevant_count": len(relevant_ids),
        }
        for model_key in MODELS:
            top_eval = meta["models"][model_key]["top_k_eval"]
            recall = compute_recall_at_k(top_eval, relevant_ids, k=TOP_K_EVAL)
            mrr = compute_mrr_at_k(top_eval, relevant_ids, k=TOP_K_EVAL)
            indices = [blinded_to_key[bid]["fixture_index"] for bid in top_eval]
            embs = embeddings_by_model[model_key][indices]
            ild = compute_ild(embs)
            entry[model_key] = {
                "macro_pooled_recall_at_10": recall,
                "mrr_at_10": mrr,
                "ild_at_10": ild,
            }
        probe_records.append(entry)

    summary = {
        "probe_count": len(probe_records),
        "zero_relevant_probe_count": sum(
            1 for r in probe_records if r["pooled_relevant_count"] == 0
        ),
        "protocol_limitation": (
            "Single human evaluator blinded grading (Section 8.4). "
            "Human-human Cohen's kappa is not applicable."
        ),
        "metrics": {
            "macro_pooled_recall_at_10": stratified_paired_bootstrap(
                probe_records, "macro_pooled_recall_at_10", n_iter=n_bootstrap, seed=seed
            ),
            "mrr_at_10": stratified_paired_bootstrap(
                probe_records, "mrr_at_10", n_iter=n_bootstrap, seed=seed
            ),
            "ild_at_10": stratified_paired_bootstrap(
                probe_records, "ild_at_10", n_iter=n_bootstrap, seed=seed
            ),
        },
        "per_probe": probe_records,
    }

    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / "benchmark_metrics_v1.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary
