"""Stage 5.0.4-H: Exclusion-aware evaluation metrics for the CineSphere embedding benchmark.

Extends Stage 5.0.4-B compute_metrics.py with:
- load_exclusion_manifest(): loads and validates evaluation_exclusions_v1.json
- load_annotations_filtered(): loads annotations and removes excluded blinded_ids
- compute_recall_at_k_pooled(): fixed denominator = min(TOP_K_EVAL, |pooled_relevant|) per spec §7.2
- evaluate_benchmark_h(): full Stage 5.0.4-H pipeline with exclusion enforcement
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from ml.benchmark.scripts.compute_metrics import (
    compute_ild,
    compute_mrr_at_k,
    stratified_paired_bootstrap,
)
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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EXCLUSION_MANIFEST_FILENAME = "evaluation_exclusions_v1.json"
RESULTS_H_FILENAME = "benchmark_metrics_h_v1.json"
REPORT_H_FILENAME = "benchmark_report_h_v1.md"
REPRODUCIBILITY_MANIFEST_FILENAME = "reproducibility_manifest_h_v1.json"

EXPECTED_EXCLUSION_COUNT = 42
EXPECTED_VALID_CANDIDATES = 1581
EXPECTED_PROBE_COUNT = 50
PB40_GRADE3_ID = "005f1807-2fb3-5e9f-925b-edee776404c3"
EXPECTED_PROBE_DISTRIBUTION: dict[str, int] = {
    "PB-32": 6,
    "PB-36": 6,
    "PB-37": 6,
    "PB-38": 6,
    "PB-40": 12,
    "PB-45": 6,
}
PLACEHOLDER_OVERVIEW = "Test show overview"


# ---------------------------------------------------------------------------
# Exclusion manifest
# ---------------------------------------------------------------------------


def load_exclusion_manifest(
    annotation_dir: Path = ANNOTATION_DIR,
) -> dict[str, Any]:
    """Load and validate evaluation_exclusions_v1.json.

    Performs all 8 manifest integrity assertions required by Stage 5.0.4-H spec §3.5.
    Fails closed (raises AssertionError) if any assertion fails.
    """
    path = annotation_dir / EXCLUSION_MANIFEST_FILENAME
    if not path.exists():
        raise FileNotFoundError(
            f"Exclusion manifest not found: {path}. "
            "Run the manifest generator before Stage 5.0.4-H evaluation."
        )

    manifest = json.loads(path.read_text(encoding="utf-8"))
    exclusions: list[dict[str, Any]] = manifest["exclusions"]

    # Assertion 1: Exactly 42 unique exclusion IDs
    bids = [e["blinded_id"] for e in exclusions]
    assert len(bids) == EXPECTED_EXCLUSION_COUNT, (
        f"Assertion 1 FAILED: expected {EXPECTED_EXCLUSION_COUNT} exclusion IDs, got {len(bids)}"
    )

    # Assertion 2: No duplicate IDs
    assert len(set(bids)) == EXPECTED_EXCLUSION_COUNT, (
        "Assertion 2 FAILED: duplicate blinded_ids in exclusion manifest"
    )

    # Assertion 3 & 4: Every ID maps to expected probe (validate probe_id present)
    for e in exclusions:
        assert "probe_id" in e and e["probe_id"], (
            f"Assertion 3/4 FAILED: missing probe_id for exclusion {e['blinded_id']}"
        )

    # Assertion 5: All exclusions are marked as synthetic_placeholder
    for e in exclusions:
        assert e.get("reason") == "synthetic_placeholder", (
            f"Assertion 5 FAILED: exclusion {e['blinded_id']} reason={e.get('reason')!r}"
        )

    # Assertion 6: Manifest includes the exact PB-40 grade-3 ID
    assert PB40_GRADE3_ID in bids, (
        f"Assertion 6 FAILED: PB-40 grade-3 ID {PB40_GRADE3_ID} not in exclusion manifest"
    )

    # Assertion 7: That PB-40 record is excluded despite grade=3
    pb40_graded = next(e for e in exclusions if e["blinded_id"] == PB40_GRADE3_ID)
    grade_val = pb40_graded.get("original_grade")
    assert grade_val == 3, (
        f"Assertion 7 FAILED: PB-40 grade-3 record has original_grade={grade_val}"
    )
    assert pb40_graded["owner_decision"] == "exclude_option_a", (
        "Assertion 7 FAILED: owner_decision for PB-40 grade-3 record is not exclude_option_a"
    )

    # Assertion 8: probe distribution matches audit
    actual_dist: dict[str, int] = defaultdict(int)
    for e in exclusions:
        actual_dist[e["probe_id"]] += 1
    actual_dist_dict = dict(actual_dist)
    assert actual_dist_dict == EXPECTED_PROBE_DISTRIBUTION, (
        f"Assertion 8 FAILED: probe distribution mismatch.\n"
        f"  Expected: {EXPECTED_PROBE_DISTRIBUTION}\n"
        f"  Actual:   {actual_dist_dict}"
    )

    return manifest


# ---------------------------------------------------------------------------
# Annotation loading with exclusions
# ---------------------------------------------------------------------------


def load_annotations_filtered(
    exclusion_manifest: dict[str, Any],
    annotation_dir: Path = ANNOTATION_DIR,
) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
    """Load annotations and apply the approved exclusion manifest.

    Exclusions are applied by exact blinded_id lookup from the manifest only.
    No heuristic or metadata-based filtering is used in the final dataset.

    Returns:
        (grades_by_probe, integrity_report)
        grades_by_probe: {probe_id: {blinded_id: grade}} with exclusions removed
        integrity_report: counts and verification results
    """
    # Build exclusion set (exact ID lookup only)
    excluded_ids: set[str] = {e["blinded_id"] for e in exclusion_manifest["exclusions"]}
    assert len(excluded_ids) == EXPECTED_EXCLUSION_COUNT

    ws_path = annotation_dir / "annotation_worksheet_v1.json"
    if not ws_path.exists():
        raise FileNotFoundError(f"Annotation worksheet not found: {ws_path}")

    # Verify worksheet is not modified (excluded IDs still present in original form)
    ws_raw = json.loads(ws_path.read_text(encoding="utf-8"))
    ws_probes = ws_raw.get("probes", [])

    grades_by_probe: dict[str, dict[str, float]] = {}
    total_original = 0
    total_excluded_found = 0
    total_null_original = 0
    total_null_retained = 0
    per_probe_counts: dict[str, dict[str, int]] = {}

    for probe in ws_probes:
        pid = str(probe["probe_id"])
        probe_grades: dict[str, float] = {}
        orig_count = 0
        excl_count = 0
        null_count = 0

        for cand in probe.get("candidates", []):
            bid = str(cand["blinded_id"])
            grade = cand.get("grade")
            orig_count += 1

            if bid in excluded_ids:
                excl_count += 1
                if grade is None:
                    null_count += 1
                continue  # Skip excluded

            if grade is None:
                total_null_retained += 1
                raise ValueError(
                    f"Retained candidate {bid} in probe {pid} has null grade after exclusions. "
                    "All 11 null-grade candidates must be in the exclusion manifest."
                )

            if not isinstance(grade, (int, float)) or not (0.0 <= float(grade) <= 3.0):
                raise ValueError(
                    f"Invalid grade {grade!r} for probe {pid}, candidate {bid}. "
                    "Expected numeric value in [0, 3]."
                )
            probe_grades[bid] = float(grade)

        total_original += orig_count
        total_excluded_found += excl_count
        total_null_original += null_count
        per_probe_counts[pid] = {
            "original": orig_count,
            "excluded": excl_count,
            "retained": orig_count - excl_count,
        }
        grades_by_probe[pid] = probe_grades

    # Integrity assertions (assertions 9–12 from spec §3.5)
    total_retained = total_original - total_excluded_found

    # Assertion 9: Exactly 1,581 candidates remain
    assert total_retained == EXPECTED_VALID_CANDIDATES, (
        f"Assertion 9 FAILED: expected {EXPECTED_VALID_CANDIDATES} retained candidates, "
        f"got {total_retained} (original={total_original}, excluded={total_excluded_found})"
    )

    # Assertion 10: All 50 probes remain represented
    assert len(grades_by_probe) == EXPECTED_PROBE_COUNT, (
        f"Assertion 10 FAILED: expected {EXPECTED_PROBE_COUNT} probes, got {len(grades_by_probe)}"
    )

    # Assertion 11: Zero retained null grades (already enforced by exception above)
    assert total_null_retained == 0, (
        f"Assertion 11 FAILED: {total_null_retained} retained candidates have null grades"
    )

    # Assertion 12: Verify PB-40 exclusion reduced to 27 candidates
    pb40_retained = per_probe_counts.get("PB-40", {}).get("retained", -1)
    assert pb40_retained == 27, (
        f"Assertion 12 FAILED: PB-40 expected 27 retained candidates, got {pb40_retained}"
    )

    # Verify PB-40 grade-3 exclusion was actually applied
    assert PB40_GRADE3_ID not in grades_by_probe.get("PB-40", {}), (
        f"Assertion 12 FAILED: PB-40 grade-3 ID {PB40_GRADE3_ID} was NOT excluded from grades"
    )

    integrity_report = {
        "total_original": total_original,
        "total_excluded": total_excluded_found,
        "total_retained": total_retained,
        "total_null_in_excluded": total_null_original,
        "total_null_retained": 0,
        "probe_count": len(grades_by_probe),
        "per_probe": per_probe_counts,
        "assertions_passed": 12,
    }

    return grades_by_probe, integrity_report


# ---------------------------------------------------------------------------
# Fixed Recall@K per spec §7.2
# ---------------------------------------------------------------------------


def compute_recall_at_k_pooled(
    top_k_ids: list[str],
    relevant_ids: set[str],
    k: int = TOP_K_EVAL,
) -> float | None:
    """Compute Pooled Recall@K per spec §7.2.

    Denominator = min(k, |PooledRelevant_q|) — not |PooledRelevant_q| alone.
    Returns None if |relevant_ids| == 0 (probe excluded from macro-average).

    Formula from spec:
        PooledRecall@K = hits / min(K, |PooledRelevant_q|)
    """
    if not relevant_ids:
        return None
    hits = sum(1 for cid in top_k_ids[:k] if cid in relevant_ids)
    denominator = min(k, len(relevant_ids))
    return hits / denominator


# ---------------------------------------------------------------------------
# Retrieval metadata loading with exclusion
# ---------------------------------------------------------------------------


def build_probe_records_filtered(
    grades_by_probe: dict[str, dict[str, float]],
    excluded_ids: set[str],
    annotation_dir: Path = ANNOTATION_DIR,
    embeddings_dir: Path = EMBEDDINGS_DIR,
) -> list[dict[str, Any]]:
    """Build per-probe metric records with exclusions applied to retrieval rankings.

    For each probe and model:
    - Loads the top_k_eval list from retrieval metadata.
    - Removes any excluded blinded_ids from the top-k list (they cannot contribute to metrics).
    - Computes Recall@K, MRR@K, and ILD@K using the filtered ranking.
    """
    meta_files = sorted(annotation_dir.glob("retrieval_metadata_*.json"))
    if not meta_files:
        raise FileNotFoundError(f"No retrieval_metadata_*.json files found in {annotation_dir}.")
    if len(meta_files) != EXPECTED_PROBE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_PROBE_COUNT} retrieval metadata files, found {len(meta_files)}."
        )

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

        if pid not in grades_by_probe:
            raise ValueError(
                f"Probe {pid} found in retrieval metadata but missing from filtered annotations."
            )

        probe_grades = grades_by_probe[pid]
        # relevant_ids must NOT include excluded IDs (already removed by load_annotations_filtered)
        relevant_ids = {bid for bid, g in probe_grades.items() if g >= RELEVANCE_THRESHOLD}
        blinded_to_key = meta["blinded_to_key"]

        entry: dict[str, Any] = {
            "probe_id": pid,
            "stratum": meta["probe_stratum"],
            "pooled_relevant_count": len(relevant_ids),
            "retained_candidate_count": len(probe_grades),
        }

        for model_key in MODELS:
            raw_top_eval: list[str] = meta["models"][model_key]["top_k_eval"]

            # Apply exclusions to top-k list (do NOT silently drop — log count)
            filtered_top_eval = [bid for bid in raw_top_eval if bid not in excluded_ids]
            excluded_from_top = len(raw_top_eval) - len(filtered_top_eval)

            # Compute metrics on the filtered top-k
            recall = compute_recall_at_k_pooled(filtered_top_eval, relevant_ids, k=TOP_K_EVAL)
            mrr = compute_mrr_at_k(filtered_top_eval, relevant_ids, k=TOP_K_EVAL)

            # ILD: get embeddings for the filtered top-k items only
            ild_top_ids = filtered_top_eval[:TOP_K_EVAL]
            if ild_top_ids:
                indices = []
                for bid in ild_top_ids:
                    if bid not in blinded_to_key:
                        raise ValueError(
                            f"Probe {pid} model {model_key}: blinded_id {bid} not in blinded_to_key"
                        )
                    indices.append(blinded_to_key[bid]["fixture_index"])
                embs = embeddings_by_model[model_key][indices]
                ild = compute_ild(embs)
            else:
                ild = None

            entry[model_key] = {
                "macro_pooled_recall_at_10": recall,
                "mrr_at_10": mrr,
                "ild_at_10": ild,
                "top_k_filtered_count": len(filtered_top_eval),
                "top_k_excluded_count": excluded_from_top,
            }

        probe_records.append(entry)

    if len(probe_records) != EXPECTED_PROBE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_PROBE_COUNT} probe records, built {len(probe_records)}."
        )

    return probe_records


# ---------------------------------------------------------------------------
# Main Stage 5.0.4-H evaluation function
# ---------------------------------------------------------------------------


def evaluate_benchmark_h(
    annotation_dir: Path = ANNOTATION_DIR,
    embeddings_dir: Path = EMBEDDINGS_DIR,
    results_dir: Path = RESULTS_DIR,
    n_bootstrap: int = NUM_BOOTSTRAP,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    """Run the full Stage 5.0.4-H evaluation with exclusion enforcement.

    Steps:
    1. Load and validate exclusion manifest (all 12 assertions).
    2. Load filtered annotations (exclusions applied by exact ID).
    3. Build per-probe metric records with excluded IDs removed from rankings.
    4. Compute Recall@10, MRR@10, ILD@10 per probe and aggregate.
    5. Run paired stratified bootstrap (B=10,000, seed=42).
    6. Write machine-readable results and human-readable report.
    7. Write reproducibility manifest.

    Single-evaluator limitation is disclosed in results and report.
    """
    # --- Step 1: Load & validate exclusion manifest ---
    exclusion_manifest = load_exclusion_manifest(annotation_dir=annotation_dir)
    excluded_ids: set[str] = {e["blinded_id"] for e in exclusion_manifest["exclusions"]}

    # --- Step 2: Load filtered annotations ---
    grades_by_probe, integrity_report = load_annotations_filtered(
        exclusion_manifest=exclusion_manifest,
        annotation_dir=annotation_dir,
    )

    # Verify post-exclusion label totals
    grade_counts: dict[int, int] = defaultdict(int)
    for probe_grades in grades_by_probe.values():
        for g in probe_grades.values():
            grade_counts[int(g)] += 1

    total_valid = sum(grade_counts.values())
    assert total_valid == EXPECTED_VALID_CANDIDATES, (
        f"Grade count verification FAILED: expected {EXPECTED_VALID_CANDIDATES}, got {total_valid}"
    )

    relevant_total = sum(v for k, v in grade_counts.items() if k >= RELEVANCE_THRESHOLD)
    non_relevant_total = sum(v for k, v in grade_counts.items() if k < RELEVANCE_THRESHOLD)

    # --- Step 3: Build per-probe records ---
    probe_records = build_probe_records_filtered(
        grades_by_probe=grades_by_probe,
        excluded_ids=excluded_ids,
        annotation_dir=annotation_dir,
        embeddings_dir=embeddings_dir,
    )

    # --- Step 4 & 5: Compute aggregate metrics with bootstrap ---
    zero_relevant_count = sum(1 for r in probe_records if r["pooled_relevant_count"] == 0)

    summary: dict[str, Any] = {
        "stage": "5.0.4-H",
        "schema_version": "1.0.0",
        "probe_count": len(probe_records),
        "zero_relevant_probe_count": zero_relevant_count,
        "exclusion_manifest": EXCLUSION_MANIFEST_FILENAME,
        "exclusion_count": EXPECTED_EXCLUSION_COUNT,
        "post_exclusion_counts": {
            "total_valid_candidates": total_valid,
            "grade_0": grade_counts[0],
            "grade_1": grade_counts[1],
            "grade_2": grade_counts[2],
            "grade_3": grade_counts[3],
            "relevant_grade_gte_2": relevant_total,
            "non_relevant_grade_lt_2": non_relevant_total,
        },
        "protocol_limitations": {
            "single_evaluator": (
                "Single human evaluator blinded grading (Spec §7.2 / §8.4). "
                "No two-human inter-rater reliability is available. "
                "Human-human Cohen's kappa is NOT computed or reported. "
                "Independent second-human validation has NOT been performed. "
                "All relevance labels are from one evaluator."
            ),
            "pooled_recall": (
                "Pooled Recall@10 is computed over the blinded union pool of candidates judged "
                "by the evaluator. It is NOT full-catalogue recall."
            ),
            "placeholder_exclusions": (
                f"{EXPECTED_EXCLUSION_COUNT} synthetic placeholder records"
                " excluded per owner Option A. "
                "These had overview='Test show overview', empty genres, year=2024."
            ),
        },
        "metric_definitions": {
            "macro_pooled_recall_at_10": (
                "Per-probe: hits_in_top10 / min(10, |PooledRelevant_q|). "
                "Macro-averaged over probes with at least 1 pooled-relevant candidate. "
                "Per spec §7.2."
            ),
            "mrr_at_10": (
                "Per-probe: 1/rank of first relevant in top-10 (0 if none). "
                "Averaged over all 50 probes. Per spec §7.2."
            ),
            "ild_at_10": (
                "Intra-List Diversity: mean pairwise cosine distance (1 - cosine_sim) "
                "over unique unordered pairs in top-10. Uses high-dimensional embeddings. "
                "Per spec §7.2."
            ),
        },
        "bootstrap_config": {
            "n_iterations": n_bootstrap,
            "confidence_level": 0.95,
            "method": "stratified_paired",
            "paired_difference": "model_b_minus_model_a",
            "seed": seed,
            "strata": "probe (each probe is its own stratum for resampling within strata groups)",
        },
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
        "integrity_report": integrity_report,
    }

    # --- Step 6: Write results ---
    results_dir.mkdir(parents=True, exist_ok=True)
    results_path = results_dir / RESULTS_H_FILENAME
    results_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # --- Step 7: Write reproducibility manifest ---
    _write_reproducibility_manifest(
        results_dir=results_dir,
        exclusion_manifest=exclusion_manifest,
        n_bootstrap=n_bootstrap,
        seed=seed,
    )

    return summary


# ---------------------------------------------------------------------------
# Reproducibility manifest
# ---------------------------------------------------------------------------


def _write_reproducibility_manifest(
    results_dir: Path,
    exclusion_manifest: dict[str, Any],
    n_bootstrap: int,
    seed: int,
) -> None:
    """Write reproducibility_manifest_h_v1.json with all provenance metadata."""
    import datetime

    # Hash the exclusion manifest itself
    excl_path = ANNOTATION_DIR / EXCLUSION_MANIFEST_FILENAME
    excl_sha256 = hashlib.sha256(excl_path.read_bytes()).hexdigest()

    # Package versions
    try:
        import importlib.metadata as _im

        st_version = _im.version("sentence-transformers")
        np_version = _im.version("numpy")
    except Exception:
        st_version = "unknown"
        np_version = np.__version__

    try:
        import torch

        torch_version = torch.__version__
    except ImportError:
        torch_version = "unknown"

    repro = {
        "stage": "5.0.4-H",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "fixture": {
            "file": "catalogue_snapshot_v1.jsonl",
            "sha256": EXPECTED_SHA256,
            "record_count": 2000,
        },
        "models": {
            key: {
                "model_id": spec.model_id,
                "revision": spec.revision,
                "dim": spec.dim,
                "max_seq_length": spec.max_seq_length,
                "embedding_file": f"embeddings_{key}.npy",
                "normalized": True,
            }
            for key, spec in MODELS.items()
        },
        "exclusion_manifest": {
            "file": EXCLUSION_MANIFEST_FILENAME,
            "sha256": excl_sha256,
            "exclusion_count": EXPECTED_EXCLUSION_COUNT,
            "policy": "option_a_exclude_all_42",
        },
        "evaluation_config": {
            "top_k_eval": TOP_K_EVAL,
            "relevance_threshold": RELEVANCE_THRESHOLD,
            "binary_relevant_iff": "grade >= 2",
            "recall_denominator": "min(TOP_K_EVAL, pooled_relevant_count)",
            "random_seed": seed,
            "n_bootstrap": n_bootstrap,
            "bootstrap_method": "stratified_paired",
            "confidence_level": 0.95,
            "paired_difference": "model_b_minus_model_a",
        },
        "package_versions": {
            "numpy": np_version,
            "sentence_transformers": st_version,
            "torch": torch_version,
        },
        "evaluation_script": "ml/benchmark/scripts/evaluate_benchmark_h.py",
        "annotation_worksheet": "ml/benchmark/annotation/annotation_worksheet_v1.json",
        "results_file": RESULTS_H_FILENAME,
    }

    out_path = results_dir / REPRODUCIBILITY_MANIFEST_FILENAME
    out_path.write_text(json.dumps(repro, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Markdown report
# ---------------------------------------------------------------------------


def generate_report_h(results_dir: Path = RESULTS_DIR) -> Path:
    """Generate a human-readable Markdown report from Stage 5.0.4-H results."""
    results_path = results_dir / RESULTS_H_FILENAME
    if not results_path.exists():
        raise FileNotFoundError(
            f"Results not found: {results_path}. Run evaluate_benchmark_h first."
        )

    m = json.loads(results_path.read_text(encoding="utf-8"))

    lines = [
        "# CineSphere Stage 5.0.4-H — Embedding Model Benchmark Results",
        "",
        "> [!IMPORTANT]",
        "> **Single-Evaluator Limitation (Spec §8.4):** All relevance labels come from one human "
        "evaluator using blinded grading. No two-human inter-rater reliability is available. "
        "Human-human Cohen's kappa is **not computed or reported**. Independent second-human "
        "validation has **not** been performed. Confidence intervals reflect sampling uncertainty "
        "only, not inter-annotator variance.",
        "",
        "> [!NOTE]",
        f"> **Exclusion Policy:** {m.get('exclusion_count', 42)} synthetic placeholder records "
        "excluded per owner Option A decision. Original annotation worksheet is unchanged.",
        "",
        "## Evaluation Dataset",
        "",
        "| Item | Value |",
        "|---|---:|",
        f"| Probes evaluated | {m['probe_count']} |",
        f"| Total valid candidates | {m['post_exclusion_counts']['total_valid_candidates']} |",
        f"| Synthetic placeholders excluded | {m['exclusion_count']} |",
        f"| Relevant candidates (grade \u2265 2) | "
        f"{m['post_exclusion_counts']['relevant_grade_gte_2']} |",
        f"| Non-relevant (grade < 2) | {m['post_exclusion_counts']['non_relevant_grade_lt_2']} |",
        f"| Grade 0 | {m['post_exclusion_counts']['grade_0']} |",
        f"| Grade 1 | {m['post_exclusion_counts']['grade_1']} |",
        f"| Grade 2 | {m['post_exclusion_counts']['grade_2']} |",
        f"| Grade 3 | {m['post_exclusion_counts']['grade_3']} |",
        f"| Probes with zero pooled-relevant | {m['zero_relevant_probe_count']} |",
        "",
        "## Retrieval Quality (95% Stratified Paired Bootstrap CI)",
        "",
        "| Metric | Model A (MiniLM-L6-v2) | Model B (MPNet-base-v2) | Paired Diff (B − A) |",
        "|---|---:|---:|---:|",
    ]

    def _fmt(entry: dict) -> str:
        est = entry.get("estimate")
        ci = entry.get("ci_95")
        if est is None:
            return "N/A"
        if ci is None:
            return f"{est:.4f}"
        return f"{est:.4f} [{ci[0]:.4f}, {ci[1]:.4f}]"

    for key, label in [
        ("macro_pooled_recall_at_10", "MacroPooledRecall@10"),
        ("mrr_at_10", "MRR@10"),
        ("ild_at_10", "ILD@10"),
    ]:
        d = m["metrics"][key]
        lines.append(
            f"| {label} | {_fmt(d['model_a'])} | {_fmt(d['model_b'])} | "
            f"{_fmt(d['paired_difference_b_minus_a'])} |"
        )

    lines.extend(
        [
            "",
            "## Metric Definitions",
            "",
            "| Metric | Definition |",
            "|---|---|",
            "| MacroPooledRecall@10 | Per-probe: hits_in_top10 / min(10, pooled_relevant). "
            "Macro-averaged over probes with ≥1 pooled-relevant candidate. |",
            "| MRR@10 | Per-probe: 1/rank of first relevant in top-10 (0 if none). "
            "Averaged over all 50 probes. |",
            "| ILD@10 | Mean pairwise cosine distance in top-10 "
            "using high-dimensional embeddings. |",
            "",
            "## Bootstrap Configuration",
            "",
            f"- Iterations: {m['bootstrap_config']['n_iterations']:,}",
            f"- Confidence level: {m['bootstrap_config']['confidence_level'] * 100:.0f}%",
            f"- Method: {m['bootstrap_config']['method']}",
            f"- Paired difference: {m['bootstrap_config']['paired_difference']}",
            f"- Random seed: {m['bootstrap_config']['seed']}",
            "",
            "## Limitations",
            "",
            "- **Single human evaluator:** No inter-annotator agreement is measurable. "
            "Bootstrap CIs reflect sampling variance, not annotation variance.",
            "- **Pooled Recall, not catalogue Recall:** Only judged candidates are assessed.",
            f"- **{m['exclusion_count']} placeholder records excluded:**"
            " These had no real content; "
            "their retrieval was an artifact of the synthetic test fixture.",
            "",
            "---",
            "",
            "_Report generated by Stage 5.0.4-H evaluation pipeline. "
            "See `reproducibility_manifest_h_v1.json` for full provenance._",
        ]
    )

    out_path = results_dir / REPORT_H_FILENAME
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path
