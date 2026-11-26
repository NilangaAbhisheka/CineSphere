"""Authoritative configuration constants for Stage 5.0 two-model embedding benchmark."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelSpec:
    """Immutable specification for a candidate embedding model."""

    key: str
    model_id: str
    revision: str
    dim: int
    max_seq_length: int
    name: str
    batch_size: int = 32


MODELS: dict[str, ModelSpec] = {
    "model_a": ModelSpec(
        key="model_a",
        model_id="sentence-transformers/all-MiniLM-L6-v2",
        revision="e4ce9877abf3edfe10b0d82785e83bdcb973e22e",
        dim=384,
        max_seq_length=256,
        name="MiniLM-L6-v2",
        batch_size=32,
    ),
    "model_b": ModelSpec(
        key="model_b",
        model_id="sentence-transformers/all-mpnet-base-v2",
        revision="9a3225965996d404b775526de6dbfe85d3368642",
        dim=768,
        max_seq_length=384,
        name="MPNet-base-v2",
        batch_size=32,
    ),
}

BENCHMARK_DIR: Path = Path(__file__).resolve().parent.parent
FIXTURES_DIR: Path = BENCHMARK_DIR / "fixtures"
FIXTURE_PATH: Path = FIXTURES_DIR / "catalogue_snapshot_v1.jsonl"
FIXTURE_MANIFEST_PATH: Path = FIXTURES_DIR / "catalogue_snapshot_v1.manifest.json"
PROBES_PATH: Path = FIXTURES_DIR / "probes_v1.json"

EXPECTED_SHA256: str = "042dccd50ee4f01f9d63f56f3a161aa5c3de9d2ea7ed2a9b6cc6162a0d6d6fe9"
EXPECTED_RECORD_COUNT: int = 2000
EXPECTED_MOVIE_COUNT: int = 1400
EXPECTED_TV_COUNT: int = 600
EXPECTED_PROBE_COUNT: int = 50
EXPECTED_MOVIE_PROBE_COUNT: int = 38
EXPECTED_TV_PROBE_COUNT: int = 12
EXPECTED_STRATA: tuple[str, ...] = (
    "Mainstream",
    "Indie",
    "International",
    "Serialized TV",
    "Stress Cases",
)
EXPECTED_PROBES_PER_STRATUM: int = 10

EMBEDDINGS_DIR: Path = BENCHMARK_DIR / "embeddings"
CACHE_MANIFEST_PATH: Path = EMBEDDINGS_DIR / "embedding_cache_manifest.json"
TOKENIZER_AUDIT_PATH: Path = EMBEDDINGS_DIR / "tokenizer_audit.json"
ANNOTATION_DIR: Path = BENCHMARK_DIR / "annotation"
RESULTS_DIR: Path = BENCHMARK_DIR / "results"
HARDWARE_PROFILE_PATH: Path = RESULTS_DIR / "hardware_profile_v1.json"

RANDOM_SEED: int = 42
CPU_THREADS: int = 4
TOP_K_POOL: int = 20
TOP_K_EVAL: int = 10
RELEVANCE_THRESHOLD: float = 1.5
NUM_BOOTSTRAP: int = 10_000
