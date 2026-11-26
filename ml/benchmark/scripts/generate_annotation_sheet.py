"""Generate blinded human annotation worksheets (JSON + Markdown) for Stage 5.0."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ml.benchmark.scripts.config import ANNOTATION_DIR

RUBRIC_DESCRIPTION = {
    "scale": "4-point Likert (0 to 3)",
    "grades": {
        "3": (
            "Highly Relevant — Direct thematic counterpart, franchise continuation, "
            "exact tone match."
        ),
        "2": (
            "Substantively Relevant — Deep thematic or structural overlap despite "
            "differing surface settings."
        ),
        "1": "Weakly Related — Superficial overlap with conflicting tone or narrative intent.",
        "0": "Irrelevant / Noise — Zero meaningful narrative, thematic, or tonal connection.",
    },
    "relevance_threshold": (
        "g >= 1.5 (Grades 2 and 3 are relevant; Grades 0 and 1 are non-relevant)"
    ),
    "protocol": "Single-evaluator blinded grading (Section 8.4). No model provenance is shown.",
}


def load_blinded_pools(annotation_dir: Path = ANNOTATION_DIR) -> list[dict[str, Any]]:
    """Load all blinded pool JSON files sorted by probe_id."""
    pool_files = sorted(annotation_dir.glob("pool_*.json"))
    if not pool_files:
        raise FileNotFoundError(
            f"No blinded pool files found in {annotation_dir}. Run 'pool' first."
        )
    return [json.loads(p.read_text(encoding="utf-8")) for p in pool_files]


def generate_annotation_sheets(
    annotation_dir: Path = ANNOTATION_DIR,
) -> dict[str, Any]:
    """Generate JSON and Markdown blinded annotation worksheets from pool files."""
    pools = load_blinded_pools(annotation_dir)

    worksheet_probes: list[dict[str, Any]] = []
    md_lines: list[str] = [
        "# CineSphere Stage 5.0 — Blinded Human Annotation Worksheet",
        "",
        "## Grading Rubric (0–3)",
        "",
        "- **3 (Highly Relevant):** Direct thematic counterpart, franchise continuation, "
        "exact tone match.",
        "- **2 (Substantively Relevant):** Deep thematic or structural overlap despite "
        "differing surface settings.",
        "- **1 (Weakly Related):** Superficial overlap only with conflicting tone or "
        "narrative intent.",
        "- **0 (Irrelevant / Noise):** Zero meaningful narrative, thematic, or tonal connection.",
        "",
        "> **Protocol:** Single-evaluator blinded grading (Spec Section 8.4). "
        "Grades 2 and 3 count as relevant.",
        "",
    ]

    total_candidates = 0
    for pool in pools:
        candidates_out: list[dict[str, Any]] = []
        probe_header = (
            f"## {pool['probe_id']}: {pool['probe_title']} "
            f"({pool['probe_media_type']}, {pool.get('probe_year')})"
        )
        md_lines.extend(
            [
                probe_header,
                f"- **Stratum:** {pool['probe_stratum']}",
                f"- **Genres:** {', '.join(pool.get('probe_genres', []))}",
                f"- **Overview:** {pool['probe_overview']}",
                f"- **Pool Size:** {pool['pool_size']}",
                "",
                "| # | Blinded ID | Title | Type | Year | Genres | Grade (0-3) |",
                "|---:|---|---|---|---:|---|---|",
            ]
        )
        for idx, cand in enumerate(pool["candidates"], start=1):
            total_candidates += 1
            candidates_out.append(
                {
                    "blinded_id": cand["blinded_id"],
                    "title": cand["title"],
                    "media_type": cand["media_type"],
                    "year": cand.get("year"),
                    "genres": cand.get("genres", []),
                    "overview": cand["overview"],
                    "grade": None,
                }
            )
            genres_str = ", ".join(cand.get("genres", []))
            md_lines.append(
                f"| {idx} | `{cand['blinded_id']}` | {cand['title']} | "
                f"{cand['media_type']} | {cand.get('year') or ''} | {genres_str} | |"
            )
        md_lines.append("")

        worksheet_probes.append(
            {
                "probe_id": pool["probe_id"],
                "probe_title": pool["probe_title"],
                "probe_media_type": pool["probe_media_type"],
                "probe_year": pool.get("probe_year"),
                "probe_stratum": pool["probe_stratum"],
                "probe_genres": pool.get("probe_genres", []),
                "probe_overview": pool["probe_overview"],
                "pool_size": pool["pool_size"],
                "candidates": candidates_out,
            }
        )

    worksheet = {
        "version": "v1",
        "rubric": RUBRIC_DESCRIPTION,
        "probe_count": len(worksheet_probes),
        "total_candidates": total_candidates,
        "probes": worksheet_probes,
    }

    json_path = annotation_dir / "annotation_worksheet_v1.json"
    md_path = annotation_dir / "annotation_worksheet_v1.md"
    json_path.write_text(json.dumps(worksheet, indent=2), encoding="utf-8")
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    return {
        "probe_count": len(worksheet_probes),
        "total_candidates": total_candidates,
        "json_path": str(json_path),
        "md_path": str(md_path),
    }
