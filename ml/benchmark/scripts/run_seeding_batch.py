"""
CineSphere — Stage 5.0.3-B.1: Resumable Batch Ingestion Runner
===============================================================

Calls the existing NestJS ingestion endpoints to populate the CineSphere
catalogue from a seeding candidate manifest.

Endpoints used:
  POST /api/catalogue/ingest/movie/:tmdbId
  POST /api/catalogue/ingest/tv/:tmdbId

Usage:
  python -m ml.benchmark.scripts.run_seeding_batch --help

Default mode is DRY RUN (no ingestion). To ingest:
  1. Pass --execute
  2. Set CINESPHERE_ALLOW_CATALOGUE_SEEDING=true in the environment.

Checkpoint:
  ml/benchmark/fixtures/seeding_checkpoint.json

Both manifest and checkpoint files are written atomically.
Credentials are never stored in checkpoint files or logs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MANIFEST_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "seeding_candidate_manifest.json"
_CHECKPOINT_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "seeding_checkpoint.json"
_PROBES_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "probes_v1.json"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHECKPOINT_SCHEMA_VERSION = "1.0.0"

#: Maximum attempts per item (original + retries).
MAX_ITEM_ATTEMPTS = 3

#: Delay between batch items (seconds). The NestJS API enforces its own
#: transport-level pacing; this delay is advisory and prevents burst load.
INTER_ITEM_DELAY_S = 0.15

#: Concurrency: runner processes one item at a time (serial dispatch).
RUNNER_CONCURRENCY = 1

#: HTTP timeout for ingestion POST requests (seconds).
INGEST_TIMEOUT_S = 60

#: Safeguard environment variable required when --execute is passed.
ALLOW_SEEDING_ENV_VAR = "CINESPHERE_ALLOW_CATALOGUE_SEEDING"

#: Safeguard environment variable required if targeting a non-local API URL.
ALLOW_REMOTE_ENV_VAR = "CINESPHERE_ALLOW_REMOTE_SEEDING"

# ---------------------------------------------------------------------------
# Canonical Execution Targets — enforced at runner boundary (Correction C/D)
# These are project-authoritative constants derived from the seeding plan
# (ceil(1,224 × 1.15) = 1,408; ceil(482 × 1.15) = 555).
# A manifest cannot weaken these requirements by supplying lower values.
# ---------------------------------------------------------------------------
CANONICAL_MOVIE_TARGET: int = 1_408
CANONICAL_TV_TARGET: int = 555
CANONICAL_MOVIE_NONENG_FRACTION: float = 0.25
CANONICAL_TV_NONENG_FRACTION: float = 0.20

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("seeding_runner")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class ManifestValidationError(Exception):
    """Raised when the manifest fails schema, probe, count, or digest validation."""


class CheckpointValidationError(Exception):
    """Raised when a checkpoint is incompatible with the current manifest or API target."""


class ExecutionSafeguardError(Exception):
    """Raised when execution safeguards or target constraints are not satisfied."""


# ---------------------------------------------------------------------------
# Target URL Helpers & Safeguards
# ---------------------------------------------------------------------------
def normalize_api_url(url: str) -> str:
    """Normalize an API target URL (strip trailing slashes, lowercase scheme and host)."""
    parsed = urllib.parse.urlparse(url.strip())
    scheme = (parsed.scheme or "http").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/")
    normalized = f"{scheme}://{netloc}{path}"
    return normalized.rstrip("/")


def is_local_api_target(url: str) -> bool:
    """Return True if URL hostname is a loopback or local address."""
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


# ---------------------------------------------------------------------------
# Probe Loading
# ---------------------------------------------------------------------------
def load_probe_ids(probes_path: Path = _PROBES_PATH) -> dict[str, set[int]]:
    """
    Independently load canonical probe IDs from the authoritative probes fixture.
    Validates that the fixture contains exactly 38 movie and 12 TV probes.
    """
    if not probes_path.exists():
        raise ManifestValidationError(f"Authoritative probe fixture not found: {probes_path}")

    with probes_path.open("r", encoding="utf-8") as fh:
        probes: list[dict[str, Any]] = json.load(fh)

    result: dict[str, set[int]] = {"movie": set(), "tv": set()}
    for p in probes:
        mt = p.get("media_type", "").lower()
        tid = p.get("tmdb_id")
        if mt in result and isinstance(tid, int):
            result[mt].add(tid)

    if len(result["movie"]) != 38 or len(result["tv"]) != 12:
        raise ManifestValidationError(
            f"Corrupted probe fixture at {probes_path}: expected 38 movies and 12 TV shows, "
            f"found {len(result['movie'])} movies and {len(result['tv'])} TV shows."
        )

    return result


# ---------------------------------------------------------------------------
# Manifest Loading and Boundary Validation
# ---------------------------------------------------------------------------
def load_manifest(
    path: Path,
    is_execution_mode: bool = False,
    probes_path: Path = _PROBES_PATH,
) -> dict[str, Any]:
    """
    Load and thoroughly validate the seeding manifest at the runner boundary.

    Validations enforced:
      1. File existence and valid JSON.
      2. Required top-level keys.
      3. Valid candidate lists (type, tmdb_id, title, original_language).
      4. No duplicate (media_type, tmdb_id) entries.
      5. Candidate counts strictly match manifest counts metadata.
      6. Independent probe exclusion: no candidate may be one of the 50 probes.
      7. Digest verification against manifest payload.
      8. In execution mode: manifest must be marked is_executable=True (not diagnostic)
         and satisfy gross candidate count and language diversity thresholds.
    """
    if not path.exists():
        raise ManifestValidationError(f"Manifest file not found: {path}")

    with path.open("r", encoding="utf-8") as fh:
        try:
            manifest: dict[str, Any] = json.load(fh)
        except json.JSONDecodeError as exc:
            raise ManifestValidationError(f"Malformed manifest JSON: {exc}") from exc

    required_keys = {
        "schema_version",
        "manifest_digest",
        "movies",
        "tv_shows",
        "counts",
        "targets",
        "language_diversity",
        "filtering_criteria",
    }
    missing = required_keys - manifest.keys()
    if missing:
        raise ManifestValidationError(f"Manifest missing required keys: {missing}")

    movies = manifest.get("movies")
    tv_shows = manifest.get("tv_shows")
    if not isinstance(movies, list) or not isinstance(tv_shows, list):
        raise ManifestValidationError("Manifest 'movies' and 'tv_shows' must be lists.")

    counts_meta = manifest.get("counts") or {}
    if counts_meta.get("movie_candidates_selected") != len(movies):
        raise ManifestValidationError(
            f"Manifest movie count mismatch: counts metadata says "
            f"{counts_meta.get('movie_candidates_selected')} but found {len(movies)} entries."
        )
    if counts_meta.get("tv_candidates_selected") != len(tv_shows):
        raise ManifestValidationError(
            f"Manifest TV count mismatch: counts metadata says "
            f"{counts_meta.get('tv_candidates_selected')} but found {len(tv_shows)} entries."
        )
    if counts_meta.get("total_candidates") != (len(movies) + len(tv_shows)):
        total_len = len(movies) + len(tv_shows)
        raise ManifestValidationError(
            f"Manifest total count mismatch: counts metadata says "
            f"{counts_meta.get('total_candidates')} but actual sum is {total_len}."
        )

    # Validate individual entries.
    for entry in movies:
        _validate_candidate_entry(entry, "movie")
    for entry in tv_shows:
        _validate_candidate_entry(entry, "tv")

    # Check for duplicate identities.
    movie_ids = [m["tmdb_id"] for m in movies]
    if len(movie_ids) != len(set(movie_ids)):
        duplicates = [x for x in movie_ids if movie_ids.count(x) > 1]
        raise ManifestValidationError(f"Duplicate movie candidate IDs found: {set(duplicates)}")

    tv_ids = [t["tmdb_id"] for t in tv_shows]
    if len(tv_ids) != len(set(tv_ids)):
        duplicates = [x for x in tv_ids if tv_ids.count(x) > 1]
        raise ManifestValidationError(f"Duplicate TV candidate IDs found: {set(duplicates)}")

    # Independent probe exclusion check.
    probe_ids = load_probe_ids(probes_path)
    prohibited_movies = set(movie_ids) & probe_ids["movie"]
    if prohibited_movies:
        raise ManifestValidationError(
            f"Probe exclusion violation: manifest contains prohibited movie probe IDs: "
            f"{sorted(prohibited_movies)}"
        )
    prohibited_tv = set(tv_ids) & probe_ids["tv"]
    if prohibited_tv:
        raise ManifestValidationError(
            f"Probe exclusion violation: manifest contains prohibited TV probe IDs: "
            f"{sorted(prohibited_tv)}"
        )

    # Recompute and verify SHA-256 digest.
    verify_manifest_digest(manifest)

    # In execution mode: ensure manifest is certified execution-ready.
    if is_execution_mode:
        # --- Correction A: Strict boolean identity check for is_executable ---
        # Only the explicit boolean True is acceptable.
        # Missing field, null, false, 0, "true", or any other non-boolean
        # or truthy-but-not-True value must all be rejected.
        if manifest.get("is_executable") is not True:
            raise ManifestValidationError(
                f"Execution mode rejected: manifest 'is_executable' must be the explicit "
                f"boolean true. Got: {manifest.get('is_executable')!r}. "
                "Regenerate the manifest in execution_ready mode before proceeding."
            )
        mode = manifest.get("mode") or manifest.get("status")
        if mode in {"diagnostic", "incomplete", "dry_run"}:
            raise ManifestValidationError(
                f"Execution mode rejected: manifest has non-executable mode/status '{mode}'."
            )

        # --- Correction C: Enforce canonical project targets; do not trust manifest values ---
        # The runner always enforces the project-authoritative constants.
        # A manifest cannot weaken requirements by supplying lower target values.
        if len(movies) < CANONICAL_MOVIE_TARGET:
            raise ManifestValidationError(
                f"Execution mode rejected: movie candidates ({len(movies)}) below "
                f"canonical project target ({CANONICAL_MOVIE_TARGET}). "
                "The manifest cannot reduce this requirement."
            )
        if len(tv_shows) < CANONICAL_TV_TARGET:
            raise ManifestValidationError(
                f"Execution mode rejected: TV candidates ({len(tv_shows)}) below "
                f"canonical project target ({CANONICAL_TV_TARGET}). "
                "The manifest cannot reduce this requirement."
            )

        # --- Correction B: Recompute language diversity from actual candidate data ---
        # Do not trust the manifest-reported non_english_fraction metadata.
        # Classify languages using the same rule as the generator: 'en' == English.
        movie_noneng = _recompute_noneng_fraction(movies)
        tv_noneng = _recompute_noneng_fraction(tv_shows)

        if movie_noneng < CANONICAL_MOVIE_NONENG_FRACTION:
            raise ManifestValidationError(
                f"Execution mode rejected: recomputed movie non-English fraction "
                f"({movie_noneng:.4f}) is below the canonical "
                f"{CANONICAL_MOVIE_NONENG_FRACTION:.0%} quota. "
                "The manifest-reported diversity metadata is not used for this check."
            )
        if tv_noneng < CANONICAL_TV_NONENG_FRACTION:
            raise ManifestValidationError(
                f"Execution mode rejected: recomputed TV non-English fraction "
                f"({tv_noneng:.4f}) is below the canonical "
                f"{CANONICAL_TV_NONENG_FRACTION:.0%} quota. "
                "The manifest-reported diversity metadata is not used for this check."
            )

        # Cross-check: reported diversity metadata must match recomputed values.
        # This catches manifests where the metadata was forged independently of entries.
        diversity = manifest.get("language_diversity") or {}
        reported_movie_noneng = (diversity.get("movies") or {}).get("non_english_fraction")
        reported_tv_noneng = (diversity.get("tv") or {}).get("non_english_fraction")

        if reported_movie_noneng is not None and abs(reported_movie_noneng - movie_noneng) > 0.0001:
            raise ManifestValidationError(
                f"Execution mode rejected: manifest-reported movie diversity fraction "
                f"({reported_movie_noneng:.4f}) does not match the value recomputed from "
                f"actual candidates ({movie_noneng:.4f}). The manifest may have been tampered with."
            )
        if reported_tv_noneng is not None and abs(reported_tv_noneng - tv_noneng) > 0.0001:
            raise ManifestValidationError(
                f"Execution mode rejected: manifest-reported TV diversity fraction "
                f"({reported_tv_noneng:.4f}) does not match the value recomputed from "
                f"actual candidates ({tv_noneng:.4f}). The manifest may have been tampered with."
            )

        cat_ex = manifest.get("catalogue_exclusion") or {}
        if not cat_ex.get("enabled") or cat_ex.get("status") != "verified":
            raise ManifestValidationError(
                "Execution mode rejected: fresh catalogue exclusion is not verified in manifest."
            )

    logger.info(
        "Manifest validated: %d movies, %d TV shows (digest=%s…)",
        len(movies),
        len(tv_shows),
        str(manifest.get("manifest_digest", ""))[:12],
    )
    return manifest


def _validate_candidate_entry(entry: dict[str, Any], media_type: str) -> None:
    if not isinstance(entry, dict):
        raise ManifestValidationError(
            f"Invalid {media_type} entry: expected dict, got {type(entry).__name__}"
        )
    tmdb_id = entry.get("tmdb_id")
    if not isinstance(tmdb_id, int) or tmdb_id <= 0:
        raise ManifestValidationError(
            f"Invalid {media_type} candidate: tmdb_id must be a positive integer, got {tmdb_id!r}"
        )
    title = entry.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ManifestValidationError(
            f"Invalid {media_type} candidate (id={tmdb_id}): title must be a non-empty string."
        )
    lang = entry.get("original_language")
    if not isinstance(lang, str) or not lang.strip():
        raise ManifestValidationError(
            f"Invalid {media_type} candidate (id={tmdb_id}): "
            "original_language must be a non-empty string."
        )


def _is_english(lang: str) -> bool:
    """Return True if the language code represents English ('en')."""
    return lang.strip().lower() == "en"


def _recompute_noneng_fraction(candidates: list[dict[str, Any]]) -> float:
    """
    Recompute the non-English fraction directly from actual candidate entries.

    Language classification rules (consistent with generate_candidate_manifest.py):
      - A candidate with original_language == 'en' (case-insensitive strip) is English.
      - Any other non-empty language code is non-English.
      - A missing or empty language value is treated as INVALID and raises
        ManifestValidationError — the entry-level validator already rejects
        empty languages, so this path only fires if the validator was bypassed.

    Returns the non-English fraction [0.0, 1.0].  Returns 0.0 for empty lists.
    """
    if not candidates:
        return 0.0
    total = len(candidates)
    non_english = 0
    for entry in candidates:
        lang = entry.get("original_language")
        if not isinstance(lang, str) or not lang.strip():
            raise ManifestValidationError(
                f"Candidate (id={entry.get('tmdb_id', '?')}) has an invalid or empty "
                "original_language value. Cannot determine language diversity."
            )
        if not _is_english(lang):
            non_english += 1
    return non_english / total


def compute_manifest_digest_from_data(manifest: dict[str, Any]) -> str:
    """
    Recompute the manifest digest to verify integrity.

    The digest payload covers every field that determines whether a manifest is
    safe and eligible for execution:
      - schema_version
      - filtering_criteria
      - movie_ids (sorted) — candidate IDs
      - tv_ids (sorted) — candidate IDs
      - movie_languages (sorted list of (tmdb_id, language) pairs)
      - tv_languages (sorted list of (tmdb_id, language) pairs)
      - is_executable
      - canonical_movie_target / canonical_tv_target / canonical fractions

    Language values and canonical targets are included so that tampering with
    candidate language data or trying to substitute a weaker target cannot
    silently produce a valid digest.
    """
    filtering_criteria = manifest.get("filtering_criteria") or {}
    movies = manifest.get("movies") or []
    tv_shows = manifest.get("tv_shows") or []

    movie_ids = sorted(c["tmdb_id"] for c in movies)
    tv_ids = sorted(c["tmdb_id"] for c in tv_shows)

    # Include (tmdb_id, language) pairs so language tampering invalidates the digest.
    movie_languages = sorted((c["tmdb_id"], c.get("original_language", "")) for c in movies)
    tv_languages = sorted((c["tmdb_id"], c.get("original_language", "")) for c in tv_shows)

    digest_payload: dict[str, Any] = {
        "schema_version": manifest.get("schema_version", ""),
        "filtering_criteria": filtering_criteria,
        "movie_ids": movie_ids,
        "tv_ids": tv_ids,
        "movie_languages": movie_languages,
        "tv_languages": tv_languages,
        # Canonical targets protect against weakened-target manifests.
        "canonical_movie_target": CANONICAL_MOVIE_TARGET,
        "canonical_tv_target": CANONICAL_TV_TARGET,
        "canonical_movie_noneng_fraction": CANONICAL_MOVIE_NONENG_FRACTION,
        "canonical_tv_noneng_fraction": CANONICAL_TV_NONENG_FRACTION,
    }
    if "is_executable" in manifest:
        digest_payload["is_executable"] = manifest["is_executable"]
    payload_bytes = json.dumps(digest_payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload_bytes).hexdigest()


def verify_manifest_digest(manifest: dict[str, Any]) -> None:
    """Raise ManifestValidationError if digest does not match content."""
    stored_digest = manifest.get("manifest_digest", "")
    computed = compute_manifest_digest_from_data(manifest)
    if computed != stored_digest:
        raise ManifestValidationError(
            f"Manifest digest mismatch. "
            f"Stored: {stored_digest[:16]}… | Computed: {computed[:16]}… "
            "The manifest may have been modified. Regenerate it before proceeding."
        )
    logger.info("Manifest digest verified: %s…", stored_digest[:16])


# ---------------------------------------------------------------------------
# Checkpoint Schema
# ---------------------------------------------------------------------------
@dataclass
class Checkpoint:
    schema_version: str = CHECKPOINT_SCHEMA_VERSION
    manifest_digest: str = ""
    api_base_url: str = ""
    completed_movie_ids: list[int] = field(default_factory=list)
    completed_tv_ids: list[int] = field(default_factory=list)
    partial_tv_ids: list[int] = field(default_factory=list)
    failed_ids: list[dict[str, Any]] = field(default_factory=list)
    attempt_counts: dict[str, int] = field(default_factory=dict)
    last_success_at: str | None = None
    last_failure: dict[str, Any] | None = None

    # Statistics (informational only).
    movies_total: int = 0
    tv_total: int = 0
    movies_remaining: int = 0
    tv_remaining: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "manifest_digest": self.manifest_digest,
            "api_base_url": self.api_base_url,
            "completed_movie_ids": sorted(self.completed_movie_ids),
            "completed_tv_ids": sorted(self.completed_tv_ids),
            "partial_tv_ids": sorted(self.partial_tv_ids),
            "failed_ids": self.failed_ids,
            "attempt_counts": self.attempt_counts,
            "last_success_at": self.last_success_at,
            "last_failure": self.last_failure,
            "stats": {
                "movies_total": self.movies_total,
                "tv_total": self.tv_total,
                "movies_remaining": self.movies_remaining,
                "tv_remaining": self.tv_remaining,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Checkpoint:
        cp = cls()
        cp.schema_version = data.get("schema_version", CHECKPOINT_SCHEMA_VERSION)
        cp.manifest_digest = data.get("manifest_digest", "")
        cp.api_base_url = data.get("api_base_url", "")
        cp.completed_movie_ids = list(data.get("completed_movie_ids") or [])
        cp.completed_tv_ids = list(data.get("completed_tv_ids") or [])
        cp.partial_tv_ids = list(data.get("partial_tv_ids") or [])
        cp.failed_ids = list(data.get("failed_ids") or [])
        cp.attempt_counts = dict(data.get("attempt_counts") or {})
        cp.last_success_at = data.get("last_success_at")
        cp.last_failure = data.get("last_failure")
        stats = data.get("stats") or {}
        cp.movies_total = stats.get("movies_total", 0)
        cp.tv_total = stats.get("tv_total", 0)
        cp.movies_remaining = stats.get("movies_remaining", 0)
        cp.tv_remaining = stats.get("tv_remaining", 0)
        return cp


# ---------------------------------------------------------------------------
# Checkpoint Persistence
# ---------------------------------------------------------------------------
def load_checkpoint(path: Path, manifest_digest: str, api_base_url: str) -> Checkpoint:
    """
    Load an existing checkpoint or create a fresh one.
    Validates schema version, manifest digest, and normalized API base URL compatibility.
    Raises CheckpointValidationError on incompatibility.
    """
    normalized_target = normalize_api_url(api_base_url)

    if not path.exists():
        logger.info("No existing checkpoint — starting fresh.")
        cp = Checkpoint()
        cp.manifest_digest = manifest_digest
        cp.api_base_url = normalized_target
        return cp

    with path.open("r", encoding="utf-8") as fh:
        raw: dict[str, Any] = json.load(fh)

    cp = Checkpoint.from_dict(raw)

    if cp.schema_version != CHECKPOINT_SCHEMA_VERSION:
        raise CheckpointValidationError(
            f"Checkpoint schema version mismatch: "
            f"checkpoint={cp.schema_version}, runner={CHECKPOINT_SCHEMA_VERSION}. "
            "Delete the checkpoint or use a compatible runner version."
        )

    if cp.manifest_digest != manifest_digest:
        raise CheckpointValidationError(
            f"Checkpoint manifest digest mismatch: "
            f"checkpoint={cp.manifest_digest[:16]}… | current={manifest_digest[:16]}… "
            "The manifest has changed. Delete the checkpoint to restart."
        )

    if normalize_api_url(cp.api_base_url) != normalized_target:
        raise CheckpointValidationError(
            f"Checkpoint API target mismatch: "
            f"checkpoint={cp.api_base_url!r} | current={normalized_target!r} "
            "Delete the checkpoint to run against a different API target."
        )

    logger.info(
        "Checkpoint loaded: %d movies done, %d TV done, %d partial TV, %d failed.",
        len(cp.completed_movie_ids),
        len(cp.completed_tv_ids),
        len(cp.partial_tv_ids),
        len(cp.failed_ids),
    )
    return cp


def save_checkpoint_atomic(checkpoint: Checkpoint, path: Path) -> None:
    """Write checkpoint atomically using a temporary file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path_str = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as fh:
            json.dump(checkpoint.to_dict(), fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp_path_str, path)
    except Exception:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Ingestion HTTP Calls
# ---------------------------------------------------------------------------
@dataclass
class IngestResult:
    tmdb_id: int
    media_type: str
    success: bool
    is_partial: bool = False
    response_body: dict[str, Any] | None = None
    error_message: str | None = None
    http_status: int | None = None


def _post_ingest(api_base_url: str, endpoint: str, timeout: float) -> dict[str, Any]:
    """Issue a POST request to the NestJS ingestion endpoint."""
    url = f"{normalize_api_url(api_base_url)}{endpoint}"
    req = urllib.request.Request(url, data=b"", method="POST")  # noqa: S310
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode())


def ingest_movie(api_base_url: str, tmdb_id: int) -> IngestResult:
    """Call POST /api/catalogue/ingest/movie/:tmdbId."""
    endpoint = f"/api/catalogue/ingest/movie/{tmdb_id}"
    try:
        body = _post_ingest(api_base_url, endpoint, INGEST_TIMEOUT_S)
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="movie",
            success=True,
            is_partial=False,
            response_body=body,
        )
    except urllib.error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode()
        except Exception:  # noqa: BLE001
            pass
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="movie",
            success=False,
            http_status=exc.code,
            error_message=f"HTTP {exc.code}: {body_text[:200]}",
        )
    except Exception as exc:  # noqa: BLE001
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="movie",
            success=False,
            error_message=str(exc)[:300],
        )


def ingest_tv(api_base_url: str, tmdb_id: int) -> IngestResult:
    """Call POST /api/catalogue/ingest/tv/:tmdbId."""
    endpoint = f"/api/catalogue/ingest/tv/{tmdb_id}"
    try:
        body = _post_ingest(api_base_url, endpoint, INGEST_TIMEOUT_S)
        is_partial = bool(body.get("isPartial", False))
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="tv",
            success=True,
            is_partial=is_partial,
            response_body=body,
        )
    except urllib.error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode()
        except Exception:  # noqa: BLE001
            pass
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="tv",
            success=False,
            http_status=exc.code,
            error_message=f"HTTP {exc.code}: {body_text[:200]}",
        )
    except Exception as exc:  # noqa: BLE001
        return IngestResult(
            tmdb_id=tmdb_id,
            media_type="tv",
            success=False,
            error_message=str(exc)[:300],
        )


# ---------------------------------------------------------------------------
# Execution Summary
# ---------------------------------------------------------------------------
@dataclass
class ExecutionSummary:
    total_manifest_movies: int = 0
    total_manifest_tv: int = 0
    completed_movies_count: int = 0
    completed_tv_count: int = 0
    partial_tv_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    unresolved_count: int = 0
    success: bool = False
    details: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Dry-run Mode
# ---------------------------------------------------------------------------
def dry_run_report(
    manifest: dict[str, Any],
    checkpoint: Checkpoint,
    api_base_url: str,
) -> None:
    """Print a dry-run summary of planned operations."""
    movies = manifest.get("movies") or []
    tv_shows = manifest.get("tv_shows") or []

    completed_movies = set(checkpoint.completed_movie_ids)
    completed_tv = set(checkpoint.completed_tv_ids)
    partial_tv = set(checkpoint.partial_tv_ids)

    pending_movies = [m for m in movies if m["tmdb_id"] not in completed_movies]
    pending_tv = [t for t in tv_shows if t["tmdb_id"] not in completed_tv]
    retry_tv = [t for t in tv_shows if t["tmdb_id"] in partial_tv]

    print("\n" + "=" * 70)
    print("CineSphere Seeding Runner — DRY RUN")
    print("=" * 70)
    print(f"  Manifest digest    : {manifest.get('manifest_digest', 'N/A')[:20]}…")
    print(f"  API target         : {api_base_url}")
    print(f"  Movies in manifest : {len(movies)}")
    print(f"  TV shows in manif. : {len(tv_shows)}")
    print(f"  Movies completed   : {len(completed_movies)}")
    print(f"  TV shows completed : {len(completed_tv)}")
    print(f"  TV shows partial   : {len(partial_tv)}")
    print(f"  Movies pending     : {len(pending_movies)}")
    print(f"  TV shows pending   : {len(pending_tv)}")
    print(f"  TV shows to retry  : {len(retry_tv)}")
    print(f"  Failed items       : {len(checkpoint.failed_ids)}")
    print("-" * 70)
    if checkpoint.failed_ids:
        print("  Failed items (first 5):")
        for f in checkpoint.failed_ids[:5]:
            mid = f.get("media_type", "?")
            tid = f.get("tmdb_id")
            err = f.get("error", "")
            print(f"    [{mid}] tmdb_id={tid} — {err}")
    print("=" * 70)
    print("[DRY RUN] No ingestion performed. Pass --execute with")
    print(f"  export {ALLOW_SEEDING_ENV_VAR}=true")
    print("to execute the seeding run.\n")


# ---------------------------------------------------------------------------
# Execution Runner
# ---------------------------------------------------------------------------
def run_ingestion(
    manifest: dict[str, Any],
    checkpoint: Checkpoint,
    checkpoint_path: Path,
    api_base_url: str,
) -> ExecutionSummary:
    """
    Execute batch ingestion against the NestJS API.

    Processing order:
    1. Pending movies (not in completed_movie_ids).
    2. Pending TV shows (not in completed_tv_ids), including partial retries.

    Checkpoint is saved after every item.
    Returns a structured ExecutionSummary.
    """
    movies = manifest.get("movies") or []
    tv_shows = manifest.get("tv_shows") or []

    completed_movies = set(checkpoint.completed_movie_ids)
    completed_tv = set(checkpoint.completed_tv_ids)
    partial_tv = set(checkpoint.partial_tv_ids)

    pending_movies = [m for m in movies if m["tmdb_id"] not in completed_movies]
    pending_tv = [t for t in tv_shows if t["tmdb_id"] not in completed_tv]

    checkpoint.movies_total = len(movies)
    checkpoint.tv_total = len(tv_shows)
    checkpoint.movies_remaining = len(pending_movies)
    checkpoint.tv_remaining = len(pending_tv)

    logger.info(
        "Starting ingestion: %d movies, %d TV shows pending.",
        len(pending_movies),
        len(pending_tv),
    )

    skipped_items: list[dict[str, Any]] = []

    # --- Movies ---
    for idx, entry in enumerate(pending_movies, start=1):
        tmdb_id: int = entry["tmdb_id"]
        attempt_key = f"movie_{tmdb_id}"

        if checkpoint.attempt_counts.get(attempt_key, 0) >= MAX_ITEM_ATTEMPTS:
            logger.warning(
                "[%d/%d] SKIP movie tmdb_id=%d — exceeded max attempts (%d).",
                idx,
                len(pending_movies),
                tmdb_id,
                MAX_ITEM_ATTEMPTS,
            )
            skipped_items.append(
                {"media_type": "movie", "tmdb_id": tmdb_id, "reason": "max_attempts_exceeded"}
            )
            continue

        checkpoint.attempt_counts[attempt_key] = checkpoint.attempt_counts.get(attempt_key, 0) + 1
        logger.info("[%d/%d] Ingesting movie tmdb_id=%d…", idx, len(pending_movies), tmdb_id)

        result = ingest_movie(api_base_url, tmdb_id)

        if result.success:
            completed_movies.add(tmdb_id)
            checkpoint.completed_movie_ids = sorted(completed_movies)
            checkpoint.last_success_at = datetime.now(UTC).isoformat()
            checkpoint.movies_remaining = max(0, checkpoint.movies_remaining - 1)
            logger.info("  ✓ movie %d ingested.", tmdb_id)
        else:
            logger.error("  ✗ movie %d failed: %s", tmdb_id, result.error_message)
            checkpoint.last_failure = {
                "tmdb_id": tmdb_id,
                "media_type": "movie",
                "error": result.error_message,
                "http_status": result.http_status,
                "at": datetime.now(UTC).isoformat(),
            }
            if checkpoint.attempt_counts.get(attempt_key, 0) >= MAX_ITEM_ATTEMPTS:
                _record_failure(checkpoint, tmdb_id, "movie", result.error_message)

        save_checkpoint_atomic(checkpoint, checkpoint_path)
        time.sleep(INTER_ITEM_DELAY_S)

    # --- TV Shows ---
    for idx, entry in enumerate(pending_tv, start=1):
        tmdb_id = entry["tmdb_id"]
        attempt_key = f"tv_{tmdb_id}"

        if checkpoint.attempt_counts.get(attempt_key, 0) >= MAX_ITEM_ATTEMPTS:
            logger.warning(
                "[%d/%d] SKIP tv tmdb_id=%d — exceeded max attempts (%d).",
                idx,
                len(pending_tv),
                tmdb_id,
                MAX_ITEM_ATTEMPTS,
            )
            skipped_items.append(
                {"media_type": "tv", "tmdb_id": tmdb_id, "reason": "max_attempts_exceeded"}
            )
            continue

        checkpoint.attempt_counts[attempt_key] = checkpoint.attempt_counts.get(attempt_key, 0) + 1

        # Clear from partial queue before attempting (re-ingest is idempotent).
        if tmdb_id in partial_tv:
            logger.info("[%d/%d] Retrying partial TV tmdb_id=%d…", idx, len(pending_tv), tmdb_id)
            partial_tv.discard(tmdb_id)
            checkpoint.partial_tv_ids = sorted(partial_tv)
        else:
            logger.info("[%d/%d] Ingesting TV tmdb_id=%d…", idx, len(pending_tv), tmdb_id)

        result = ingest_tv(api_base_url, tmdb_id)

        if result.success and not result.is_partial:
            completed_tv.add(tmdb_id)
            checkpoint.completed_tv_ids = sorted(completed_tv)
            checkpoint.last_success_at = datetime.now(UTC).isoformat()
            checkpoint.tv_remaining = max(0, checkpoint.tv_remaining - 1)
            logger.info("  ✓ TV show %d ingested (complete).", tmdb_id)
        elif result.success and result.is_partial:
            # Header committed, but some seasons failed.
            partial_tv.add(tmdb_id)
            checkpoint.partial_tv_ids = sorted(partial_tv)
            checkpoint.last_success_at = datetime.now(UTC).isoformat()
            logger.warning(
                "  ~ TV show %d ingested partially (isPartial=True). Added to retry queue.",
                tmdb_id,
            )
        else:
            logger.error("  ✗ TV show %d failed: %s", tmdb_id, result.error_message)
            checkpoint.last_failure = {
                "tmdb_id": tmdb_id,
                "media_type": "tv",
                "error": result.error_message,
                "http_status": result.http_status,
                "at": datetime.now(UTC).isoformat(),
            }
            if checkpoint.attempt_counts.get(attempt_key, 0) >= MAX_ITEM_ATTEMPTS:
                _record_failure(checkpoint, tmdb_id, "tv", result.error_message)

        save_checkpoint_atomic(checkpoint, checkpoint_path)
        time.sleep(INTER_ITEM_DELAY_S)

    # Compute execution summary.
    comp_movies = len(checkpoint.completed_movie_ids)
    comp_tv = len(checkpoint.completed_tv_ids)
    part_tv = len(checkpoint.partial_tv_ids)
    unresolved_m = len(movies) - comp_movies
    unresolved_t = len(tv_shows) - comp_tv
    total_unresolved = unresolved_m + unresolved_t

    summary = ExecutionSummary(
        total_manifest_movies=len(movies),
        total_manifest_tv=len(tv_shows),
        completed_movies_count=comp_movies,
        completed_tv_count=comp_tv,
        partial_tv_count=part_tv,
        failed_count=len(checkpoint.failed_ids),
        skipped_count=len(skipped_items),
        unresolved_count=total_unresolved,
        success=(total_unresolved == 0 and part_tv == 0),
        details={
            "unresolved_movies": unresolved_m,
            "unresolved_tv": unresolved_t,
            "partial_tv_ids": list(checkpoint.partial_tv_ids),
            "skipped_items": skipped_items,
        },
    )

    logger.info(
        "Ingestion pass complete. Movies: %d/%d done. TV: %d/%d done (%d partial). "
        "Failed: %d, Skipped: %d, Unresolved: %d.",
        comp_movies,
        len(movies),
        comp_tv,
        len(tv_shows),
        part_tv,
        len(checkpoint.failed_ids),
        len(skipped_items),
        total_unresolved,
    )

    if part_tv:
        logger.warning(
            "%d TV shows remain partial. Re-run to retry: %s",
            part_tv,
            sorted(partial_tv),
        )

    return summary


def _record_failure(
    checkpoint: Checkpoint,
    tmdb_id: int,
    media_type: str,
    error: str | None,
) -> None:
    """Add an item to the permanent failure list (after max attempts exhausted)."""
    existing_ids = {(f["tmdb_id"], f["media_type"]) for f in checkpoint.failed_ids}
    if (tmdb_id, media_type) not in existing_ids:
        checkpoint.failed_ids.append(
            {
                "tmdb_id": tmdb_id,
                "media_type": media_type,
                "error": error or "Unknown error",
                "at": datetime.now(UTC).isoformat(),
            }
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "CineSphere Stage 5.0.3-B Seeding Runner. "
            "Default mode is DRY RUN. "
            f"Requires --execute AND {ALLOW_SEEDING_ENV_VAR}=true for live ingestion."
        )
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        default=False,
        help=(
            f"Enable execution mode. MUST also set {ALLOW_SEEDING_ENV_VAR}=true in the environment."
        ),
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:4000",
        help="Base URL of the CineSphere NestJS API (default: http://localhost:4000).",
    )
    parser.add_argument(
        "--manifest",
        default=str(_MANIFEST_PATH),
        help="Path to the seeding manifest JSON file.",
    )
    parser.add_argument(
        "--checkpoint",
        default=str(_CHECKPOINT_PATH),
        help="Path to the seeding checkpoint JSON file.",
    )
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    checkpoint_path = Path(args.checkpoint)
    api_base_url = normalize_api_url(args.api_url)

    # --- Target Safeguard ---
    if args.execute and not is_local_api_target(api_base_url):
        allow_remote = os.environ.get(ALLOW_REMOTE_ENV_VAR, "").strip().lower() == "true"
        if not allow_remote:
            logger.error(
                "Execution refused: target host in %r is non-local. "
                "Seeding is restricted to loopback/local targets unless %s=true is set.",
                api_base_url,
                ALLOW_REMOTE_ENV_VAR,
            )
            return 2

    # --- Load & boundary-validate manifest ---
    try:
        manifest = load_manifest(manifest_path, is_execution_mode=args.execute)
    except ManifestValidationError as exc:
        logger.error("Manifest validation failed: %s", exc)
        return 2

    manifest_digest = manifest["manifest_digest"]

    # --- Load checkpoint ---
    try:
        checkpoint = load_checkpoint(checkpoint_path, manifest_digest, api_base_url)
    except CheckpointValidationError as exc:
        logger.error("Checkpoint incompatible: %s", exc)
        return 2

    # --- Execution safeguards ---
    if args.execute:
        env_flag = os.environ.get(ALLOW_SEEDING_ENV_VAR, "").strip().lower()
        if env_flag != "true":
            logger.error(
                "Execution refused: --execute requires %s=true in the environment.",
                ALLOW_SEEDING_ENV_VAR,
            )
            return 2

        # Validate API target is reachable before first ingestion request.
        health_url = f"{api_base_url}/api/health"
        try:
            req = urllib.request.Request(health_url, method="GET")  # noqa: S310
            with urllib.request.urlopen(req, timeout=10):  # noqa: S310
                pass
            logger.info("API health check passed: %s", health_url)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "API health check failed for %s: %s. "
                "Ensure the NestJS API is running before executing seeding.",
                health_url,
                exc,
            )
            return 2

        logger.info("Execution safeguards satisfied. Starting ingestion.")
        try:
            summary = run_ingestion(manifest, checkpoint, checkpoint_path, api_base_url)
        except KeyboardInterrupt:
            logger.warning("Interrupted by user. Checkpoint saved. Re-run to resume.")
            return 130

        if not summary.success:
            logger.error(
                "Seeding execution finished with %d unresolved items "
                "(failed, skipped, or partial). Returning exit code 1.",
                summary.unresolved_count,
            )
            return 1

        logger.info("Seeding execution completed successfully with 0 unresolved items.")
        return 0
    else:
        # Dry-run mode (default).
        dry_run_report(manifest, checkpoint, api_base_url)
        return 0


if __name__ == "__main__":
    sys.exit(main())
