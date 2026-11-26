"""CPU hardware profiling (warmup, latency, throughput, peak RSS) for Stage 5.0."""

from __future__ import annotations

import json
import os
import platform
import time
from pathlib import Path
from typing import Any

import numpy as np
from ml.benchmark.scripts.config import (
    CPU_THREADS,
    FIXTURE_PATH,
    HARDWARE_PROFILE_PATH,
    MODELS,
    RANDOM_SEED,
    RESULTS_DIR,
    ModelSpec,
)
from ml.benchmark.scripts.validate_fixture import (
    get_probes,
    load_fixture,
    validate_fixture_integrity,
)


def profile_model_cpu(
    spec: ModelSpec,
    probe_texts: list[str],
    throughput_texts: list[str],
    warmup_batches: int = 5,
    probe_iterations: int = 10,
) -> dict[str, Any]:
    """Profile CPU latency, throughput, and peak RSS for a single embedding model."""
    import psutil
    import torch
    from sentence_transformers import SentenceTransformer

    np.random.seed(RANDOM_SEED)
    torch.manual_seed(RANDOM_SEED)
    torch.set_num_threads(CPU_THREADS)
    torch.use_deterministic_algorithms(True)

    process = psutil.Process(os.getpid())
    rss_before_mb = process.memory_info().rss / (1024 * 1024)

    model = SentenceTransformer(spec.model_id, revision=spec.revision, device="cpu")
    model.max_seq_length = spec.max_seq_length

    # Warmup: 5 batches of 32 items
    warmup_batch = throughput_texts[: spec.batch_size]
    for _ in range(warmup_batches):
        model.encode(
            warmup_batch,
            batch_size=spec.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

    # Query latency: 10 iterations over 50 probes (one query at a time)
    latencies_ms: list[float] = []
    for _ in range(probe_iterations):
        for text in probe_texts:
            t0 = time.perf_counter_ns()
            model.encode(
                [text],
                batch_size=1,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            t1 = time.perf_counter_ns()
            latencies_ms.append((t1 - t0) / 1_000_000.0)

    # Batch throughput: 1,000 items at B=32
    t_start = time.perf_counter_ns()
    model.encode(
        throughput_texts,
        batch_size=spec.batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    t_end = time.perf_counter_ns()
    elapsed_sec = (t_end - t_start) / 1_000_000_000.0
    throughput_items_per_sec = len(throughput_texts) / elapsed_sec if elapsed_sec > 0 else 0.0

    rss_after_mb = process.memory_info().rss / (1024 * 1024)
    lat_arr = np.asarray(latencies_ms, dtype=np.float64)

    return {
        "model_key": spec.key,
        "model_id": spec.model_id,
        "revision": spec.revision,
        "device": "CPU",
        "precision": "FP32",
        "batch_size": spec.batch_size,
        "max_seq_length": spec.max_seq_length,
        "cpu_threads": CPU_THREADS,
        "latency_ms": {
            "p50": round(float(np.percentile(lat_arr, 50)), 3),
            "p95": round(float(np.percentile(lat_arr, 95)), 3),
            "p99": round(float(np.percentile(lat_arr, 99)), 3),
            "samples": len(latencies_ms),
        },
        "throughput_items_per_sec": round(throughput_items_per_sec, 2),
        "throughput_item_count": len(throughput_texts),
        "rss_before_mb": round(rss_before_mb, 2),
        "rss_after_mb": round(rss_after_mb, 2),
    }


def run_hardware_profile(
    fixture_path: Path = FIXTURE_PATH,
    output_path: Path = HARDWARE_PROFILE_PATH,
) -> dict[str, Any]:
    """Run CPU hardware profiling for all configured models and save JSON."""
    sha = validate_fixture_integrity(fixture_path)
    records = load_fixture(fixture_path)
    probes = get_probes(records)
    probe_texts = [p["canonical_text"] for p in probes]
    throughput_texts = [r["canonical_text"] for r in records[:1000]]

    report: dict[str, Any] = {
        "fixture_sha256": sha,
        "platform": platform.platform(),
        "processor": platform.processor(),
        "python_version": platform.python_version(),
        "models": {},
    }
    for key, spec in MODELS.items():
        report["models"][key] = profile_model_cpu(
            spec=spec,
            probe_texts=probe_texts,
            throughput_texts=throughput_texts,
        )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
