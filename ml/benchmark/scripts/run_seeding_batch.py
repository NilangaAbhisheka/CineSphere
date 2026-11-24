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

Default mode is DRY RUN (no ingestion).  To ingest:
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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHECKPOINT_SCHEMA_VERSION = "1.0.0"

#: Maximum attempts per item (original + retries).
MAX_ITEM_ATTEMPTS = 3

#: Delay between batch items (seconds).  The NestJS API enforces its own
#: transport-level pacing; this delay is advisory and prevents any accidental
#: burst at the runner level.
INTER_ITEM_DELAY_S = 0.15

#: Bounded concurrency: runner processes one item at a time (serial dispatch).
#: The API-side pacing is authoritative for TMDB throughput.
RUNNER_CONCURRENCY = 1

#: HTTP timeout for ingestion POST requests (seconds).
INGEST_TIMEOUT_S = 60

#: Safeguard environment variable required when --execute is passed.
ALLOW_SEEDING_ENV_VAR = "CINESPHERE_ALLOW_CATALOGUE_SEEDING"

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
    """Raised when the manifest fails schema or digest validation."""


class CheckpointValidationError(Exception):
    """Raised when a checkpoint is incompatible with the current manifest."""


class ExecutionSafeguardError(Exception):
    """Raised when execution safeguards are not satisfied."""


# ---------------------------------------------------------------------------
# Manifest loading and validation
# ---------------------------------------------------------------------------
def load_manifest(path: Path) -> dict[str, Any]:
    """Load and validate the seeding manifest."""
    if not path.exists():
        raise ManifestValidationError(f"Manifest file not found: {path}")

    with path.open("r", encoding="utf-8") as fh:
        manifest: dict[str, Any] = json.load(fh)

    required_keys = {
        "schema_version",
        "manifest_digest",
        "movies",
        "tv_shows",
        "counts",
        "targets",
    }
    missing = required_keys - manifest.keys()
    if missing:
        raise ManifestValidationError(f"Manifest missing required keys: {missing}")

    movies = manifest.get("movies") or []
    tv_shows = manifest.get("tv_shows") or []

    # Validate each candidate entry.
    for entry in movies:
        _validate_candidate_entry(entry, "movie")
    for entry in tv_shows:
        _validate_candidate_entry(entry, "tv")

    logger.info(
        "Manifest validated: %d movies, %d TV shows (digest=%s…)",
        len(movies),
        len(tv_shows),
        str(manifest.get("manifest_digest", ""))[:12],
    )
    return manifest


def _validate_candidate_entry(entry: dict[str, Any], media_type: str) -> None:
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


def compute_manifest_digest_from_data(manifest: dict[str, Any]) -> str:
    """Recompute the manifest digest to verify integrity."""
    filtering_criteria = manifest.get("filtering_criteria") or {}
    movie_ids = sorted(c["tmdb_id"] for c in (manifest.get("movies") or []))
    tv_ids = sorted(c["tmdb_id"] for c in (manifest.get("tv_shows") or []))
    digest_payload = {
        "schema_version": manifest.get("schema_version", ""),
        "filtering_criteria": filtering_criteria,
        "movie_ids": movie_ids,
        "tv_ids": tv_ids,
    }
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
# Checkpoint schema
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
# Checkpoint persistence
# ---------------------------------------------------------------------------
def load_checkpoint(path: Path, manifest_digest: str, api_base_url: str) -> Checkpoint:
    """
    Load an existing checkpoint or create a fresh one.
    Validates schema version, manifest digest, and API base URL compatibility.
    Raises CheckpointValidationError on incompatibility.
    """
    if not path.exists():
        logger.info("No existing checkpoint — starting fresh.")
        cp = Checkpoint()
        cp.manifest_digest = manifest_digest
        cp.api_base_url = api_base_url
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

    if cp.api_base_url != api_base_url:
        raise CheckpointValidationError(
            f"Checkpoint API target mismatch: "
            f"checkpoint={cp.api_base_url!r} | current={api_base_url!r} "
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
# Ingestion HTTP calls
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
    """
    Issue a POST request to the NestJS ingestion endpoint.
    Raises urllib.error.HTTPError or OSError on failure.
    """
    url = f"{api_base_url.rstrip('/')}{endpoint}"
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
# Dry-run mode
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
# Execution runner
# ---------------------------------------------------------------------------
def run_ingestion(
    manifest: dict[str, Any],
    checkpoint: Checkpoint,
    checkpoint_path: Path,
    api_base_url: str,
) -> None:
    """
    Execute batch ingestion against the NestJS API.

    Processing order:
    1. Pending movies (not in completed_movie_ids).
    2. Pending TV shows (not in completed_tv_ids), including partial retries.

    Checkpoint is saved after every item.
    """
    movies = manifest.get("movies") or []
    tv_shows = manifest.get("tv_shows") or []

    completed_movies = set(checkpoint.completed_movie_ids)
    completed_tv = set(checkpoint.completed_tv_ids)
    partial_tv = set(checkpoint.partial_tv_ids)

    # Merge partial TV into pending TV (they should be retried).
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
                "[%d/%d] SKIP tv tmdb_id=%d — exceeded max attempts.",
                idx,
                len(pending_tv),
                tmdb_id,
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

    # Final summary.
    logger.info(
        "Ingestion pass complete. Movies: %d/%d done. TV: %d/%d done (%d partial). Failed: %d.",
        len(completed_movies),
        len(movies),
        len(completed_tv),
        len(tv_shows),
        len(partial_tv),
        len(checkpoint.failed_ids),
    )

    if partial_tv:
        logger.warning(
            "%d TV shows remain partial. Re-run to retry: %s",
            len(partial_tv),
            sorted(partial_tv),
        )


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
    api_base_url: str = args.api_url.rstrip("/")

    # --- Load & validate manifest ---
    try:
        manifest = load_manifest(manifest_path)
        verify_manifest_digest(manifest)
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

        # Validate API target is reachable.
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
            run_ingestion(manifest, checkpoint, checkpoint_path, api_base_url)
        except KeyboardInterrupt:
            logger.warning("Interrupted by user. Checkpoint saved. Re-run to resume.")
            return 130
        return 0
    else:
        # Dry-run mode (default).
        dry_run_report(manifest, checkpoint, api_base_url)
        return 0


if __name__ == "__main__":
    sys.exit(main())
