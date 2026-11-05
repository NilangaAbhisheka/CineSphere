# CineSphere — Python ML Package

This directory contains offline and on-demand machine learning pipelines for CineSphere:

- `embeddings/`: Semantic vector generation (Sentence Transformers).
- `clustering/`: HDBSCAN density clustering on high-dimensional embeddings.
- `similarity/`: Precomputed cosine nearest-neighbour similarity matrices.
- `recommendations/`: Candidate scoring formula validation.
- `taste-profiling/`: Structured preference modeling and snapshot comparison.
- `movie-map/`: UMAP 2D projection strictly for WebGL visualization.
- `scripts/`: CLI entrypoints for on-demand batch runs.
- `tests/`: Pytest suite for mathematical correctness and pipeline validation.

## Local Setup

```bash
# From within ml/
python -m venv .venv

# Activate environment:
# Linux/macOS:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate.ps1

# Install development dependencies:
pip install -e ".[dev]"

# Run tests:
pytest

# Run linter:
ruff check .
```
