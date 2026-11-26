"""Top-20 candidate retrieval, query exclusion, and blinded union pooling for Stage 5.0."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from ml.benchmark.scripts.config import (
    ANNOTATION_DIR,
    EMBEDDINGS_DIR,
    EXPECTED_SHA256,
    FIXTURE_PATH,
    MODELS,
    TOP_K_EVAL,
    TOP_K_POOL,
)
from ml.benchmark.scripts.embed_catalogue import load_cached_embeddings
from ml.benchmark.scripts.validate_fixture import (
    get_probes,
    load_fixture,
    validate_fixture_integrity,
)


def make_blinded_id(probe_id: str, media_type: str, tmdb_id: int) -> str:
    """Generate deterministic UUIDv5 blinded candidate identifier."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{probe_id}|{media_type}|{tmdb_id}"))


def rank_candidates_for_probe(
    probe_idx: int,
    embeddings: np.ndarray,
    records: list[dict[str, Any]],
    top_k: int = TOP_K_POOL,
) -> list[tuple[int, float]]:
    """Rank all non-probe items by cosine similarity with deterministic tie-breaking.

    Tie-breaking order: similarity DESC, media_type ASC, tmdb_id ASC.
    """
    probe_vec = embeddings[probe_idx]
    scores = embeddings @ probe_vec
    scores = scores.astype(np.float64, copy=True)
    scores[probe_idx] = -np.inf

    ranked_indices = sorted(
        (i for i in range(len(records)) if i != probe_idx),
        key=lambda i: (
            -float(scores[i]),
            str(records[i]["media_type"]),
            int(records[i]["tmdb_id"]),
        ),
    )
    return [(i, float(scores[i])) for i in ranked_indices[:top_k]]


def build_probe_pool(
    probe: dict[str, Any],
    probe_idx: int,
    records: list[dict[str, Any]],
    embeddings_by_model: dict[str, np.ndarray],
    top_k_pool: int = TOP_K_POOL,
    top_k_eval: int = TOP_K_EVAL,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build blinded union pool and internal retrieval metadata for a single probe."""
    probe_id = str(probe["probe_id"])
    union_indices: set[int] = set()
    model_rankings: dict[str, Any] = {}

    for model_key, embs in embeddings_by_model.items():
        top_ranked = rank_candidates_for_probe(
            probe_idx=probe_idx,
            embeddings=embs,
            records=records,
            top_k=top_k_pool,
        )
        top_blinded: list[str] = []
        scores_by_blinded: dict[str, float] = {}
        for idx, score in top_ranked:
            union_indices.add(idx)
            rec = records[idx]
            bid = make_blinded_id(probe_id, str(rec["media_type"]), int(rec["tmdb_id"]))
            top_blinded.append(bid)
            scores_by_blinded[bid] = score

        model_rankings[model_key] = {
            "top_k_pool": top_blinded,
            "top_k_eval": top_blinded[:top_k_eval],
            "scores": scores_by_blinded,
        }

    blinded_candidates: list[dict[str, Any]] = []
    blinded_to_key: dict[str, dict[str, Any]] = {}
    for idx in union_indices:
        rec = records[idx]
        media_type = str(rec["media_type"])
        tmdb_id = int(rec["tmdb_id"])
        bid = make_blinded_id(probe_id, media_type, tmdb_id)
        blinded_candidates.append(
            {
                "blinded_id": bid,
                "title": rec["title"],
                "overview": rec["overview"],
                "genres": rec["genres"],
                "year": rec.get("year"),
                "media_type": media_type,
            }
        )
        blinded_to_key[bid] = {
            "fixture_index": idx,
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "title": rec["title"],
        }

    blinded_candidates.sort(key=lambda c: str(c["blinded_id"]))

    blinded_pool = {
        "probe_id": probe_id,
        "probe_title": probe["title"],
        "probe_media_type": probe["media_type"],
        "probe_overview": probe["overview"],
        "probe_genres": probe["genres"],
        "probe_year": probe.get("year"),
        "probe_stratum": probe["stratum"],
        "pool_size": len(blinded_candidates),
        "candidates": blinded_candidates,
    }

    metadata = {
        "probe_id": probe_id,
        "probe_stratum": probe["stratum"],
        "probe_index": probe_idx,
        "pool_size": len(blinded_candidates),
        "models": model_rankings,
        "blinded_to_key": blinded_to_key,
    }
    return blinded_pool, metadata


def run_retrieval_pooling(
    fixture_path: Path = FIXTURE_PATH,
    embeddings_dir: Path = EMBEDDINGS_DIR,
    annotation_dir: Path = ANNOTATION_DIR,
    top_k_pool: int = TOP_K_POOL,
    top_k_eval: int = TOP_K_EVAL,
) -> dict[str, Any]:
    """Run retrieval and blinded union pooling for all 50 probes."""
    sha = validate_fixture_integrity(fixture_path, EXPECTED_SHA256)
    records = load_fixture(fixture_path)
    probes = get_probes(records)

    index_by_key = {(str(r["media_type"]), int(r["tmdb_id"])): i for i, r in enumerate(records)}
    embeddings_by_model = {
        key: load_cached_embeddings(key, fixture_sha256=sha, embeddings_dir=embeddings_dir)
        for key in MODELS
    }

    annotation_dir.mkdir(parents=True, exist_ok=True)
    pool_sizes: list[int] = []
    for probe in probes:
        probe_idx = index_by_key[(str(probe["media_type"]), int(probe["tmdb_id"]))]
        blinded_pool, metadata = build_probe_pool(
            probe=probe,
            probe_idx=probe_idx,
            records=records,
            embeddings_by_model=embeddings_by_model,
            top_k_pool=top_k_pool,
            top_k_eval=top_k_eval,
        )
        pool_sizes.append(blinded_pool["pool_size"])
        pid = probe["probe_id"]
        (annotation_dir / f"pool_{pid}.json").write_text(
            json.dumps(blinded_pool, indent=2), encoding="utf-8"
        )
        (annotation_dir / f"retrieval_metadata_{pid}.json").write_text(
            json.dumps(metadata, indent=2), encoding="utf-8"
        )

    return {
        "probe_count": len(probes),
        "min_pool_size": min(pool_sizes) if pool_sizes else 0,
        "max_pool_size": max(pool_sizes) if pool_sizes else 0,
        "total_candidates": sum(pool_sizes),
    }
