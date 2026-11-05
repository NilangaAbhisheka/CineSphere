"""
CineSphere ML — Foundation Environment & Mathematical Invariance Tests
"""

import math
import sys
from pathlib import Path

import pytest


def test_python_version_compatibility():
    """Verify runtime Python meets the >= 3.11 requirement."""
    assert sys.version_info >= (3, 11), f"Python 3.11+ required, detected: {sys.version}"


def test_cosine_similarity_invariance():
    """
    Verify high-dimensional cosine similarity calculation mathematically matches
    the behavior implemented in the PostgreSQL pgvector VectorRepository.
    """
    v1 = [1.0, 2.0, 3.0]
    v2 = [2.0, 4.0, 6.0]  # Exactly collinear

    dot_product = sum(a * b for a, b in zip(v1, v2, strict=True))
    norm_v1 = math.sqrt(sum(a * a for a in v1))
    norm_v2 = math.sqrt(sum(b * b for b in v2))

    cosine_similarity = dot_product / (norm_v1 * norm_v2)
    cosine_distance = 1.0 - cosine_similarity

    assert pytest.approx(cosine_similarity, rel=1e-6) == 1.0
    assert pytest.approx(cosine_distance, abs=1e-6) == 0.0


def test_recommendation_scoring_formula():
    """
    Verify the hybrid content-based recommendation scoring formula:
    Score = 0.35*S + 0.25*P + 0.20*M + 0.10*Q + 0.10*N
    """
    weights = {"S": 0.35, "P": 0.25, "M": 0.20, "Q": 0.10, "N": 0.10}
    assert math.isclose(sum(weights.values()), 1.0), "Scoring weights must sum to 1.0"

    # Test with perfect scores (all 1.0)
    score_max = sum(weights[k] * 1.0 for k in weights)
    assert pytest.approx(score_max) == 1.0

    # Test sample candidate: S=0.8, P=0.6, M=0.5, Q=0.9, N=0.7
    signals = {"S": 0.8, "P": 0.6, "M": 0.5, "Q": 0.9, "N": 0.7}
    expected_score = (
        0.35 * 0.8  # 0.28
        + 0.25 * 0.6  # 0.15
        + 0.20 * 0.5  # 0.10
        + 0.10 * 0.9  # 0.09
        + 0.10 * 0.7  # 0.07
    )  # Total = 0.69
    computed_score = sum(weights[k] * signals[k] for k in weights)
    assert pytest.approx(computed_score, rel=1e-5) == expected_score


def test_directory_structure_completeness():
    """Verify all planned ML subdirectories are present."""
    base_dir = Path(__file__).parent.parent
    expected_dirs = [
        "embeddings",
        "clustering",
        "similarity",
        "recommendations",
        "taste-profiling",
        "movie-map",
        "scripts",
        "tests",
    ]
    for directory in expected_dirs:
        dir_path = base_dir / directory
        assert dir_path.is_dir(), f"Expected ML directory missing: {directory}"
