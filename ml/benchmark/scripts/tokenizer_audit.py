"""Tokenizer length and truncation audit for Stage 5.0 benchmark models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ml.benchmark.scripts.config import (
    EMBEDDINGS_DIR,
    FIXTURE_PATH,
    MODELS,
    TOKENIZER_AUDIT_PATH,
    ModelSpec,
)
from ml.benchmark.scripts.validate_fixture import load_fixture, validate_fixture_integrity


def audit_model_tokenizer(
    texts: list[str],
    spec: ModelSpec,
    tokenizer: Any | None = None,
) -> dict[str, Any]:
    """Compute token-count statistics and truncation rate for a model's tokenizer."""
    if tokenizer is None:
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(spec.model_id, revision=spec.revision)

    lengths: list[int] = []
    truncated_count = 0
    for text in texts:
        encoded = tokenizer.encode(text, add_special_tokens=True, truncation=False)
        tok_len = len(encoded)
        lengths.append(tok_len)
        if tok_len > spec.max_seq_length:
            truncated_count += 1

    sorted_lengths = sorted(lengths)
    n = len(sorted_lengths)
    p95_idx = min(n - 1, int(0.95 * n))
    return {
        "model_key": spec.key,
        "model_id": spec.model_id,
        "revision": spec.revision,
        "max_seq_length": spec.max_seq_length,
        "record_count": n,
        "min_tokens": sorted_lengths[0] if n else 0,
        "max_tokens": sorted_lengths[-1] if n else 0,
        "mean_tokens": round(sum(lengths) / n, 2) if n else 0.0,
        "p95_tokens": sorted_lengths[p95_idx] if n else 0,
        "exceeding_limit_count": truncated_count,
        "exceeding_limit_pct": round((truncated_count / n) * 100.0, 2) if n else 0.0,
    }


def run_tokenizer_audit(
    fixture_path: Path = FIXTURE_PATH,
    output_path: Path = TOKENIZER_AUDIT_PATH,
) -> dict[str, Any]:
    """Run tokenizer audit across all configured benchmark models and save JSON."""
    sha = validate_fixture_integrity(fixture_path)
    records = load_fixture(fixture_path)
    texts = [r["canonical_text"] for r in records]

    results: dict[str, Any] = {"fixture_sha256": sha, "models": {}}
    for key, spec in MODELS.items():
        results["models"][key] = audit_model_tokenizer(texts=texts, spec=spec)

    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results
