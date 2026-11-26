"""CPU embedding generation and manifest-validated caching for Stage 5.0 benchmark."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from ml.benchmark.scripts.config import (
    CACHE_MANIFEST_PATH,
    CPU_THREADS,
    EMBEDDINGS_DIR,
    EXPECTED_SHA256,
    FIXTURE_PATH,
    MODELS,
    RANDOM_SEED,
    ModelSpec,
)
from ml.benchmark.scripts.validate_fixture import load_fixture, validate_fixture_integrity


def get_embedding_path(model_key: str, embeddings_dir: Path = EMBEDDINGS_DIR) -> Path:
    """Return path to cached .npy embedding matrix for a model."""
    return embeddings_dir / f"embeddings_{model_key}.npy"


def is_cache_valid(
    manifest: dict[str, Any] | None,
    fixture_sha256: str,
    spec: ModelSpec,
    embedding_path: Path,
) -> bool:
    """Check whether cached embeddings match fixture SHA-256, model revision, and file."""
    if manifest is None or not embedding_path.exists():
        return False
    if manifest.get("fixture_sha256") != fixture_sha256:
        return False
    model_entry = manifest.get("models", {}).get(spec.key)
    if not isinstance(model_entry, dict):
        return False
    if model_entry.get("model_id") != spec.model_id:
        return False
    if model_entry.get("revision") != spec.revision:
        return False
    if model_entry.get("dim") != spec.dim:
        return False
    return True


def load_cache_manifest(
    manifest_path: Path = CACHE_MANIFEST_PATH,
) -> dict[str, Any] | None:
    """Load cache manifest JSON if it exists and is valid JSON."""
    if not manifest_path.exists():
        return None
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _set_determinism(seed: int = RANDOM_SEED, num_threads: int = CPU_THREADS) -> None:
    import torch

    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(num_threads)
    torch.use_deterministic_algorithms(True)


def encode_texts_for_model(
    texts: list[str],
    spec: ModelSpec,
    seed: int = RANDOM_SEED,
    num_threads: int = CPU_THREADS,
) -> np.ndarray:
    """Encode texts on CPU using a pinned SentenceTransformer model."""
    from sentence_transformers import SentenceTransformer

    _set_determinism(seed=seed, num_threads=num_threads)
    model = SentenceTransformer(
        spec.model_id,
        revision=spec.revision,
        device="cpu",
    )
    model.max_seq_length = spec.max_seq_length
    embeddings = model.encode(
        texts,
        batch_size=spec.batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    arr = np.asarray(embeddings, dtype=np.float32)
    if arr.shape != (len(texts), spec.dim):
        raise ValueError(
            f"Unexpected embedding shape for {spec.key}: {arr.shape} != ({len(texts)}, {spec.dim})"
        )
    return arr


def embed_all_models(
    fixture_path: Path = FIXTURE_PATH,
    embeddings_dir: Path = EMBEDDINGS_DIR,
    manifest_path: Path = CACHE_MANIFEST_PATH,
    force: bool = False,
) -> dict[str, Any]:
    """Generate and cache embeddings for all configured models, skipping valid caches."""
    import sentence_transformers
    import torch

    fixture_sha = validate_fixture_integrity(fixture_path, EXPECTED_SHA256)
    records = load_fixture(fixture_path)
    texts = [r["canonical_text"] for r in records]

    embeddings_dir.mkdir(parents=True, exist_ok=True)
    existing_manifest = None if force else load_cache_manifest(manifest_path)

    manifest: dict[str, Any] = {
        "fixture_sha256": fixture_sha,
        "record_count": len(records),
        "seed": RANDOM_SEED,
        "cpu_threads": CPU_THREADS,
        "generated_at": datetime.now(UTC).isoformat(),
        "torch_version": torch.__version__,
        "sentence_transformers_version": sentence_transformers.__version__,
        "models": {},
    }

    for key, spec in MODELS.items():
        emb_path = get_embedding_path(key, embeddings_dir)
        if not force and is_cache_valid(existing_manifest, fixture_sha, spec, emb_path):
            manifest["models"][key] = existing_manifest["models"][key]
            manifest["models"][key]["cache_hit"] = True
            continue

        arr = encode_texts_for_model(texts=texts, spec=spec)
        np.save(emb_path, arr)
        manifest["models"][key] = {
            "model_id": spec.model_id,
            "revision": spec.revision,
            "dim": spec.dim,
            "max_seq_length": spec.max_seq_length,
            "batch_size": spec.batch_size,
            "dtype": str(arr.dtype),
            "shape": list(arr.shape),
            "normalized": True,
            "file": emb_path.name,
            "cache_hit": False,
        }

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def load_cached_embeddings(
    model_key: str,
    fixture_sha256: str = EXPECTED_SHA256,
    embeddings_dir: Path = EMBEDDINGS_DIR,
    manifest_path: Path = CACHE_MANIFEST_PATH,
) -> np.ndarray:
    """Load cached embeddings after validating manifest integrity."""
    spec = MODELS[model_key]
    manifest = load_cache_manifest(manifest_path)
    emb_path = get_embedding_path(model_key, embeddings_dir)
    if not is_cache_valid(manifest, fixture_sha256, spec, emb_path):
        raise RuntimeError(
            f"Invalid or missing embedding cache for {model_key}. Run 'embed' first."
        )
    return np.load(emb_path)
