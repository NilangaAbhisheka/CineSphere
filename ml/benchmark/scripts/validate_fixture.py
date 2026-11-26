"""Fixture integrity and schema validation for Stage 5.0 benchmark."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from ml.benchmark.scripts.config import (
    EXPECTED_MOVIE_COUNT,
    EXPECTED_MOVIE_PROBE_COUNT,
    EXPECTED_PROBE_COUNT,
    EXPECTED_PROBES_PER_STRATUM,
    EXPECTED_RECORD_COUNT,
    EXPECTED_SHA256,
    EXPECTED_STRATA,
    EXPECTED_TV_COUNT,
    EXPECTED_TV_PROBE_COUNT,
    FIXTURE_PATH,
)

REQUIRED_FIELDS: tuple[str, ...] = (
    "media_type",
    "tmdb_id",
    "title",
    "overview",
    "genres",
    "canonical_text",
    "is_probe",
)


def compute_sha256(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_fixture_integrity(
    path: Path = FIXTURE_PATH,
    expected_sha256: str = EXPECTED_SHA256,
) -> str:
    """Verify fixture exists and matches expected SHA-256 digest."""
    if not path.exists():
        raise FileNotFoundError(f"Benchmark fixture not found: {path}")
    actual_sha = compute_sha256(path)
    if actual_sha != expected_sha256:
        raise ValueError(f"Fixture SHA-256 mismatch: expected {expected_sha256}, got {actual_sha}")
    return actual_sha


def load_fixture(path: Path = FIXTURE_PATH) -> list[dict[str, Any]]:
    """Load JSONL fixture records in file order."""
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            stripped = raw_line.strip()
            if not stripped:
                raise ValueError(f"Empty line at {path}:{line_no}")
            records.append(json.loads(stripped))
    return records


def validate_fixture_schema(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate record schema, counts, composite uniqueness, ordering, and probe strata."""
    if len(records) != EXPECTED_RECORD_COUNT:
        raise ValueError(f"Expected {EXPECTED_RECORD_COUNT} records, got {len(records)}")

    seen_keys: set[tuple[str, int]] = set()
    seen_probe_ids: set[str] = set()
    media_counts: Counter[str] = Counter()
    probe_media_counts: Counter[str] = Counter()
    stratum_counts: Counter[str] = Counter()
    prev_sort_key: tuple[str, int] | None = None

    for idx, rec in enumerate(records):
        for field in REQUIRED_FIELDS:
            if field not in rec:
                raise ValueError(f"Record {idx} missing required field '{field}'")

        media_type = rec["media_type"]
        if media_type not in ("MOVIE", "TV"):
            raise ValueError(f"Record {idx} invalid media_type: {media_type!r}")

        tmdb_id = rec["tmdb_id"]
        if not isinstance(tmdb_id, int) or tmdb_id <= 0:
            raise ValueError(f"Record {idx} invalid tmdb_id: {tmdb_id!r}")

        canonical_text = rec["canonical_text"]
        if not isinstance(canonical_text, str) or not canonical_text.strip():
            raise ValueError(f"Record {idx} has empty canonical_text")

        composite_key = (media_type, tmdb_id)
        if composite_key in seen_keys:
            raise ValueError(f"Duplicate composite key: {composite_key}")
        seen_keys.add(composite_key)

        if prev_sort_key is not None and composite_key <= prev_sort_key:
            raise ValueError(
                f"Fixture ordering violation at record {idx}: {composite_key} <= {prev_sort_key}"
            )
        prev_sort_key = composite_key

        media_counts[media_type] += 1

        if rec["is_probe"]:
            probe_id = rec.get("probe_id")
            stratum = rec.get("stratum")
            if not isinstance(probe_id, str) or not probe_id.strip():
                raise ValueError(f"Probe record {idx} missing probe_id")
            if probe_id in seen_probe_ids:
                raise ValueError(f"Duplicate probe_id: {probe_id}")
            seen_probe_ids.add(probe_id)
            if stratum not in EXPECTED_STRATA:
                raise ValueError(f"Probe {probe_id} invalid stratum: {stratum!r}")
            probe_media_counts[media_type] += 1
            stratum_counts[stratum] += 1

    if media_counts["MOVIE"] != EXPECTED_MOVIE_COUNT:
        raise ValueError(f"Expected {EXPECTED_MOVIE_COUNT} movies, got {media_counts['MOVIE']}")
    if media_counts["TV"] != EXPECTED_TV_COUNT:
        raise ValueError(f"Expected {EXPECTED_TV_COUNT} TV shows, got {media_counts['TV']}")
    if len(seen_probe_ids) != EXPECTED_PROBE_COUNT:
        raise ValueError(f"Expected {EXPECTED_PROBE_COUNT} probes, got {len(seen_probe_ids)}")
    if probe_media_counts["MOVIE"] != EXPECTED_MOVIE_PROBE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_MOVIE_PROBE_COUNT} movie probes, got {probe_media_counts['MOVIE']}"
        )
    if probe_media_counts["TV"] != EXPECTED_TV_PROBE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_TV_PROBE_COUNT} TV probes, got {probe_media_counts['TV']}"
        )
    for stratum in EXPECTED_STRATA:
        if stratum_counts[stratum] != EXPECTED_PROBES_PER_STRATUM:
            raise ValueError(
                f"Stratum {stratum!r}: expected {EXPECTED_PROBES_PER_STRATUM} probes, "
                f"got {stratum_counts[stratum]}"
            )

    return {
        "record_count": len(records),
        "movie_count": media_counts["MOVIE"],
        "tv_count": media_counts["TV"],
        "probe_count": len(seen_probe_ids),
        "probe_movie_count": probe_media_counts["MOVIE"],
        "probe_tv_count": probe_media_counts["TV"],
        "strata": dict(stratum_counts),
    }


def get_probes(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return all probe records sorted by probe_id."""
    probes = [r for r in records if r.get("is_probe")]
    return sorted(probes, key=lambda r: str(r["probe_id"]))


def get_catalogue(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return non-probe catalogue records."""
    return [r for r in records if not r.get("is_probe")]


def run_validation(
    path: Path = FIXTURE_PATH,
    expected_sha256: str = EXPECTED_SHA256,
) -> dict[str, Any]:
    """Run full integrity and schema validation and return summary dict."""
    sha256 = validate_fixture_integrity(path=path, expected_sha256=expected_sha256)
    records = load_fixture(path=path)
    summary = validate_fixture_schema(records)
    summary["sha256"] = sha256
    return summary
