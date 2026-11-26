"""CLI orchestrator for the Stage 5.0 two-model embedding benchmark pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ml.benchmark.scripts.compute_metrics import evaluate_benchmark
from ml.benchmark.scripts.config import RESULTS_DIR
from ml.benchmark.scripts.embed_catalogue import embed_all_models
from ml.benchmark.scripts.evaluate_benchmark_h import (
    evaluate_benchmark_h,
    generate_report_h,
)
from ml.benchmark.scripts.generate_annotation_sheet import generate_annotation_sheets
from ml.benchmark.scripts.hardware_profile import run_hardware_profile
from ml.benchmark.scripts.retrieve_candidates import run_retrieval_pooling
from ml.benchmark.scripts.tokenizer_audit import run_tokenizer_audit
from ml.benchmark.scripts.validate_fixture import run_validation


def generate_markdown_report(results_dir: Path = RESULTS_DIR) -> Path:
    """Generate a concise Markdown summary report from metrics and hardware profile."""
    metrics_path = results_dir / "benchmark_metrics_v1.json"
    hw_path = results_dir / "hardware_profile_v1.json"

    lines = [
        "# CineSphere Stage 5.0 — Embedding Model Benchmark Results",
        "",
        "> **Protocol Note (Spec Section 8.4):** Single human evaluator blinded grading. "
        "Human–human Cohen's kappa is not computed or reported.",
        "",
    ]

    if metrics_path.exists():
        m = json.loads(metrics_path.read_text(encoding="utf-8"))
        lines.extend(
            [
                "## Retrieval Quality (95% Stratified Paired Bootstrap CI)",
                "",
                "| Metric | Model A (MiniLM-L6-v2) | Model B (MPNet-base-v2) | "
                "Paired Diff (B - A) |",
                "|---|---:|---:|---:|",
            ]
        )
        for key, label in [
            ("macro_pooled_recall_at_10", "MacroPooledRecall@10"),
            ("mrr_at_10", "MRR@10"),
            ("ild_at_10", "ILD@10"),
        ]:
            d = m["metrics"][key]

            def _fmt(entry: dict) -> str:
                est = entry.get("estimate")
                ci = entry.get("ci_95")
                if est is None:
                    return "N/A"
                if ci is None:
                    return f"{est:.4f}"
                return f"{est:.4f} [{ci[0]:.4f}, {ci[1]:.4f}]"

            lines.append(
                f"| {label} | {_fmt(d['model_a'])} | {_fmt(d['model_b'])} | "
                f"{_fmt(d['paired_difference_b_minus_a'])} |"
            )
        lines.append("")
    else:
        lines.append("_Retrieval metrics not yet computed (pending human annotation)._\n")

    if hw_path.exists():
        hw = json.loads(hw_path.read_text(encoding="utf-8"))
        lines.extend(
            [
                "## CPU Hardware Profile",
                "",
                "| Model | Device | Batch | p50 (ms) | p95 (ms) | p99 (ms) | "
                "Throughput (items/s) | RSS After (MB) |",
                "|---|---|---:|---:|---:|---:|---:|---:|",
            ]
        )
        for key in ("model_a", "model_b"):
            if key in hw["models"]:
                hm = hw["models"][key]
                lat = hm["latency_ms"]
                lines.append(
                    f"| {hm['model_id']} | {hm['device']} | {hm['batch_size']} | "
                    f"{lat['p50']} | {lat['p95']} | {lat['p99']} | "
                    f"{hm['throughput_items_per_sec']} | {hm['rss_after_mb']} |"
                )
        lines.append("")
    else:
        lines.append("_Hardware profile not yet generated._\n")

    results_dir.mkdir(parents=True, exist_ok=True)
    out_path = results_dir / "benchmark_report_v1.md"
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CineSphere Stage 5.0 Embedding Benchmark Runner")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="Validate fixture integrity and schema")
    sub.add_parser("audit", help="Run tokenizer length/truncation audit")
    embed_p = sub.add_parser("embed", help="Generate and cache CPU embeddings")
    embed_p.add_argument("--force", action="store_true", help="Ignore existing cache")
    sub.add_parser("pool", help="Run top-20 retrieval and blinded union pooling")
    sub.add_parser("annotate", help="Generate blinded annotation worksheets")
    sub.add_parser("metrics", help="Compute evaluation metrics and bootstrap CIs (Stage 5.0.4-B)")
    sub.add_parser(
        "metrics-h", help="Stage 5.0.4-H: exclusion-aware metrics with 42-record exclusion manifest"
    )
    sub.add_parser("report-h", help="Generate Stage 5.0.4-H Markdown benchmark report")
    sub.add_parser("profile", help="Run CPU hardware profiling")
    sub.add_parser("report", help="Generate Markdown benchmark summary report")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "validate":
        result = run_validation()
    elif args.command == "audit":
        result = run_tokenizer_audit()
    elif args.command == "embed":
        result = embed_all_models(force=args.force)
    elif args.command == "pool":
        result = run_retrieval_pooling()
    elif args.command == "annotate":
        result = generate_annotation_sheets()
    elif args.command == "metrics":
        result = evaluate_benchmark()
    elif args.command == "metrics-h":
        result = evaluate_benchmark_h()
    elif args.command == "report-h":
        out = generate_report_h()
        result = {"report_path": str(out)}
    elif args.command == "profile":
        result = run_hardware_profile()
    elif args.command == "report":
        out = generate_markdown_report()
        result = {"report_path": str(out)}
    else:
        parser.error(f"Unknown command: {args.command}")
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
