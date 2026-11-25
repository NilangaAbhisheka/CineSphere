"""
CineSphere — Stage 5.0.3-B.2: Dedicated Benchmark Probe Ingestion Runner
==========================================================================

Ingests ONLY the 50 authoritative benchmark probes defined in
ml/benchmark/fixtures/probes_v1.json via the existing NestJS ingestion API:
  POST /api/catalogue/ingest/movie/:tmdbId
  POST /api/catalogue/ingest/tv/:tmdbId

Design & Safety Guarantees:
  - Completely separated from non-probe candidate seeding (run_seeding_batch.py).
  - Never modifies probes_v1.json or seeding_checkpoint.json.
  - Rejects arbitrary non-probe IDs, invalid media types, or duplicate identities.
  - Validates returned title/name against expected probe identity using
    matches_probe_identity() and APPROVED_PROBE_ALIASES (preserving PB-45).
  - Preserves serial execution (concurrency = 1) and API-side TMDB rate pacing.
  - Supports resumable checkpointing (probe_ingestion_checkpoint.json) and
    explicit partial TV retry tracking.
  - Default mode is DRY RUN (zero HTTP POSTs, zero DB writes).
  - Live execution requires --execute, CINESPHERE_ALLOW_CATALOGUE_SEEDING=true,
    and API/DB target verification.
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

from ml.benchmark.scripts.prepare_catalogue_fixture import (
    ALLOWED_MEDIA_TYPES,
    ALLOWED_STRATA,
    InvalidProbeDefinitionError,
    matches_probe_identity,
)
from ml.benchmark.scripts.verify_personal_data_snapshot import (
    TargetVerificationError,
    verify_api_and_db_target,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_PROBES_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "probes_v1.json"
_CHECKPOINT_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "probe_ingestion_checkpoint.json"

PROBE_CHECKPOINT_SCHEMA_VERSION = "1.0.0"
EXPECTED_MOVIE_PROBES = 38
EXPECTED_TV_PROBES = 12
EXPECTED_TOTAL_PROBES = 50
MAX_ITEM_ATTEMPTS = 3
INTER_ITEM_DELAY_S = 0.15
INGEST_TIMEOUT_S = 60

ALLOW_SEEDING_ENV_VAR = "CINESPHERE_ALLOW_CATALOGUE_SEEDING"
ALLOW_REMOTE_ENV_VAR = "CINESPHERE_ALLOW_REMOTE_SEEDING"

logger = logging.getLogger("probe_ingestion")


class ProbeValidationError(Exception):
    """Raised when probe definitions or probe ingestion targets are invalid."""


class ProbeCheckpointError(Exception):
    """Raised when probe checkpoint compatibility fails."""


@dataclass(frozen=True)
class ProbeSpec:
    probe_id: str
    media_type: str
    tmdb_id: int
    title: str
    stratum: str


@dataclass
class ProbeIngestResult:
    probe_id: str
    tmdb_id: int
    media_type: str
    success: bool
    is_partial: bool = False
    identity_verified: bool = False
    returned_title: str | None = None
    error_message: str | None = None


@dataclass
class ProbeExecutionSummary:
    total_probes: int = 0
    completed_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    partial_tv_count: int = 0
    identity_mismatch_count: int = 0
    unresolved_count: int = 0
    success: bool = False


@dataclass
class ProbeCheckpoint:
    schema_version: str = PROBE_CHECKPOINT_SCHEMA_VERSION
    probes_digest: str = ""
    api_base_url: str = ""
    completed_probe_ids: list[str] = field(default_factory=list)
    partial_tv_probe_ids: list[str] = field(default_factory=list)
    failed_probes: list[dict[str, Any]] = field(default_factory=list)
    attempt_counts: dict[str, int] = field(default_factory=dict)
    last_success_at: str | None = None
    last_failure: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "probes_digest": self.probes_digest,
            "api_base_url": self.api_base_url,
            "completed_probe_ids": sorted(self.completed_probe_ids),
            "partial_tv_probe_ids": sorted(self.partial_tv_probe_ids),
            "failed_probes": self.failed_probes,
            "attempt_counts": self.attempt_counts,
            "last_success_at": self.last_success_at,
            "last_failure": self.last_failure,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProbeCheckpoint:
        cp = cls()
        cp.schema_version = str(data.get("schema_version", PROBE_CHECKPOINT_SCHEMA_VERSION))
        cp.probes_digest = str(data.get("probes_digest", ""))
        cp.api_base_url = str(data.get("api_base_url", ""))
        cp.completed_probe_ids = list(data.get("completed_probe_ids") or [])
        cp.partial_tv_probe_ids = list(data.get("partial_tv_probe_ids") or [])
        cp.failed_probes = list(data.get("failed_probes") or [])
        cp.attempt_counts = dict(data.get("attempt_counts") or {})
        cp.last_success_at = data.get("last_success_at")
        cp.last_failure = data.get("last_failure")
        return cp


def normalize_api_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    scheme = (parsed.scheme or "http").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/")
    return f"{scheme}://{netloc}{path}".rstrip("/")


def is_local_api_target(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def compute_probes_digest(probes: list[ProbeSpec]) -> str:
    payload = [
        {
            "probe_id": p.probe_id,
            "media_type": p.media_type,
            "tmdb_id": p.tmdb_id,
            "title": p.title,
        }
        for p in sorted(probes, key=lambda x: x.probe_id)
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def load_and_validate_probes(probes_path: Path = _PROBES_PATH) -> list[ProbeSpec]:
    """
    Load and strictly validate the authoritative 50-probe fixture.
    Rejects non-50 counts, invalid media types, invalid strata, or duplicates.
    """
    if not probes_path.exists():
        raise ProbeValidationError(f"Authoritative probe fixture not found: {probes_path}")

    with probes_path.open("r", encoding="utf-8") as fh:
        raw_probes = json.load(fh)

    if not isinstance(raw_probes, list):
        raise ProbeValidationError("Probe fixture must be a JSON list.")

    seen_ids: set[str] = set()
    seen_identities: set[tuple[str, int]] = set()
    specs: list[ProbeSpec] = []
    movie_count = 0
    tv_count = 0

    for item in raw_probes:
        if not isinstance(item, dict):
            raise ProbeValidationError("Each probe entry must be a JSON object.")
        probe_id = str(item.get("probe_id", "")).strip()
        media_type = str(item.get("media_type", "")).strip().upper()
        tmdb_id = item.get("tmdb_id")
        title = str(item.get("title", "")).strip()
        stratum = str(item.get("stratum", "")).strip()

        if not probe_id or not title:
            raise ProbeValidationError(f"Probe missing probe_id or title: {item!r}")
        if media_type not in ALLOWED_MEDIA_TYPES:
            raise ProbeValidationError(f"Probe {probe_id} has invalid media_type {media_type!r}.")
        if not isinstance(tmdb_id, int) or isinstance(tmdb_id, bool) or tmdb_id <= 0:
            raise ProbeValidationError(f"Probe {probe_id} has invalid tmdb_id {tmdb_id!r}.")
        if stratum not in ALLOWED_STRATA:
            raise ProbeValidationError(f"Probe {probe_id} has invalid stratum {stratum!r}.")
        if probe_id in seen_ids:
            raise InvalidProbeDefinitionError(f"Duplicate probe_id: {probe_id}")
        if (media_type, tmdb_id) in seen_identities:
            raise InvalidProbeDefinitionError(
                f"Duplicate probe composite identity: {(media_type, tmdb_id)}"
            )

        seen_ids.add(probe_id)
        seen_identities.add((media_type, tmdb_id))
        if media_type == "MOVIE":
            movie_count += 1
        else:
            tv_count += 1
        specs.append(
            ProbeSpec(
                probe_id=probe_id,
                media_type=media_type,
                tmdb_id=tmdb_id,
                title=title,
                stratum=stratum,
            )
        )

    if (
        len(specs) != EXPECTED_TOTAL_PROBES
        or movie_count != EXPECTED_MOVIE_PROBES
        or tv_count != EXPECTED_TV_PROBES
    ):
        raise ProbeValidationError(
            f"Expected {EXPECTED_TOTAL_PROBES} probes ({EXPECTED_MOVIE_PROBES} MOVIE, "
            f"{EXPECTED_TV_PROBES} TV); found {len(specs)} ({movie_count} MOVIE, {tv_count} TV)."
        )

    return specs


def assert_authorized_probe(
    probe: ProbeSpec,
    authorized_by_id: dict[str, ProbeSpec],
) -> None:
    """Reject any ID/media_type not matching the canonical probes_v1.json registry."""
    expected = authorized_by_id.get(probe.probe_id)
    if expected is None:
        raise ProbeValidationError(
            f"Unauthorized probe_id {probe.probe_id!r}: not present in authoritative fixture."
        )
    if expected.media_type != probe.media_type or expected.tmdb_id != probe.tmdb_id:
        raise ProbeValidationError(
            f"Unauthorized probe target for {probe.probe_id}: "
            f"got ({probe.media_type}, {probe.tmdb_id}), "
            f"expected ({expected.media_type}, {expected.tmdb_id})."
        )


def load_probe_checkpoint(path: Path, probes_digest: str, api_base_url: str) -> ProbeCheckpoint:
    normalized = normalize_api_url(api_base_url)
    if not path.exists():
        return ProbeCheckpoint(probes_digest=probes_digest, api_base_url=normalized)

    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    cp = ProbeCheckpoint.from_dict(data)

    if cp.schema_version != PROBE_CHECKPOINT_SCHEMA_VERSION:
        raise ProbeCheckpointError(
            f"Probe checkpoint schema mismatch: {cp.schema_version!r} != "
            f"{PROBE_CHECKPOINT_SCHEMA_VERSION!r}."
        )
    if cp.probes_digest != probes_digest:
        raise ProbeCheckpointError("Probe checkpoint digest mismatch against probes_v1.json.")
    if normalize_api_url(cp.api_base_url) != normalized:
        raise ProbeCheckpointError(
            f"Probe checkpoint API target mismatch: {cp.api_base_url!r} != {normalized!r}."
        )
    return cp


def save_probe_checkpoint_atomic(cp: ProbeCheckpoint, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".probe_cp_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(cp.to_dict(), fh, indent=2, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def ingest_probe(api_base_url: str, probe: ProbeSpec) -> ProbeIngestResult:
    """
    Call the existing NestJS movie or TV ingestion endpoint for a single probe
    and verify returned title/name against canonical identity & PB-45 aliases.
    """
    endpoint_type = "movie" if probe.media_type == "MOVIE" else "tv"
    url = f"{api_base_url.rstrip('/')}/api/catalogue/ingest/{endpoint_type}/{probe.tmdb_id}"
    req = urllib.request.Request(url, method="POST", data=b"")
    try:
        with urllib.request.urlopen(req, timeout=INGEST_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return ProbeIngestResult(
            probe_id=probe.probe_id,
            tmdb_id=probe.tmdb_id,
            media_type=probe.media_type,
            success=False,
            error_message=f"HTTP {exc.code}: {exc.reason}",
        )
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
        return ProbeIngestResult(
            probe_id=probe.probe_id,
            tmdb_id=probe.tmdb_id,
            media_type=probe.media_type,
            success=False,
            error_message=str(exc),
        )

    returned_tmdb_id = body.get("tmdbId")
    if returned_tmdb_id != probe.tmdb_id:
        return ProbeIngestResult(
            probe_id=probe.probe_id,
            tmdb_id=probe.tmdb_id,
            media_type=probe.media_type,
            success=False,
            identity_verified=False,
            error_message=(
                f"TMDB ID mismatch in API response: expected {probe.tmdb_id}, "
                f"got {returned_tmdb_id!r}"
            ),
        )

    returned_title = body.get("title") if probe.media_type == "MOVIE" else body.get("name")
    identity_ok = matches_probe_identity(
        expected_title=probe.title,
        stored_title=returned_title,
        stored_original_title=None,
        media_type=probe.media_type,
        tmdb_id=probe.tmdb_id,
    )
    if not identity_ok:
        return ProbeIngestResult(
            probe_id=probe.probe_id,
            tmdb_id=probe.tmdb_id,
            media_type=probe.media_type,
            success=False,
            identity_verified=False,
            returned_title=returned_title,
            error_message=(
                f"Probe identity mismatch for [{probe.probe_id}]: "
                f"expected '{probe.title}', API returned '{returned_title}'."
            ),
        )

    is_partial = bool(body.get("isPartial", False)) if probe.media_type == "TV" else False
    return ProbeIngestResult(
        probe_id=probe.probe_id,
        tmdb_id=probe.tmdb_id,
        media_type=probe.media_type,
        success=True,
        is_partial=is_partial,
        identity_verified=True,
        returned_title=returned_title,
    )


def run_probe_ingestion(
    probes: list[ProbeSpec],
    cp: ProbeCheckpoint,
    cp_path: Path,
    api_base_url: str,
) -> ProbeExecutionSummary:
    """Execute resumable, serial probe ingestion with identity verification."""
    authorized_by_id = {p.probe_id: p for p in probes}
    completed_set = set(cp.completed_probe_ids)
    partial_tv_set = set(cp.partial_tv_probe_ids)

    failed_count = 0
    skipped_count = 0
    identity_mismatch_count = 0

    for probe in probes:
        assert_authorized_probe(probe, authorized_by_id)
        if probe.probe_id in completed_set and probe.probe_id not in partial_tv_set:
            continue

        attempts = cp.attempt_counts.get(probe.probe_id, 0)
        if attempts >= MAX_ITEM_ATTEMPTS:
            skipped_count += 1
            continue

        cp.attempt_counts[probe.probe_id] = attempts + 1
        result = ingest_probe(api_base_url, probe)

        if result.success and result.identity_verified:
            if result.is_partial:
                partial_tv_set.add(probe.probe_id)
                completed_set.discard(probe.probe_id)
            else:
                partial_tv_set.discard(probe.probe_id)
                completed_set.add(probe.probe_id)
                cp.last_success_at = datetime.now(UTC).isoformat()
                cp.failed_probes = [
                    f for f in cp.failed_probes if f.get("probe_id") != probe.probe_id
                ]
        else:
            failed_count += 1
            if result.error_message and "identity mismatch" in result.error_message.lower():
                identity_mismatch_count += 1
            cp.last_failure = {
                "probe_id": probe.probe_id,
                "tmdb_id": probe.tmdb_id,
                "media_type": probe.media_type,
                "error": result.error_message,
                "at": datetime.now(UTC).isoformat(),
            }
            if not any(f.get("probe_id") == probe.probe_id for f in cp.failed_probes):
                cp.failed_probes.append(
                    {
                        "probe_id": probe.probe_id,
                        "tmdb_id": probe.tmdb_id,
                        "media_type": probe.media_type,
                        "error": result.error_message,
                    }
                )

        cp.completed_probe_ids = sorted(completed_set)
        cp.partial_tv_probe_ids = sorted(partial_tv_set)
        save_probe_checkpoint_atomic(cp, cp_path)

        if INTER_ITEM_DELAY_S > 0:
            time.sleep(INTER_ITEM_DELAY_S)

    unresolved_count = len(probes) - len(completed_set)
    return ProbeExecutionSummary(
        total_probes=len(probes),
        completed_count=len(completed_set),
        failed_count=failed_count,
        skipped_count=skipped_count,
        partial_tv_count=len(partial_tv_set),
        identity_mismatch_count=identity_mismatch_count,
        unresolved_count=unresolved_count,
        success=(unresolved_count == 0 and len(partial_tv_set) == 0),
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Dedicated resumable ingestion runner for the 50 authoritative benchmark probes."
        )
    )
    parser.add_argument("--probes", type=Path, default=_PROBES_PATH)
    parser.add_argument("--checkpoint", type=Path, default=_CHECKPOINT_PATH)
    parser.add_argument("--api-url", default="http://localhost:4000")
    parser.add_argument(
        "--execute",
        action="store_true",
        default=False,
        help="Actually execute probe ingestion (requires CINESPHERE_ALLOW_CATALOGUE_SEEDING=true).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    args = build_arg_parser().parse_args(argv)

    try:
        probes = load_and_validate_probes(args.probes)
    except (ProbeValidationError, InvalidProbeDefinitionError) as exc:
        logger.error("Probe fixture validation failed: %s", exc)
        return 2

    if not args.execute:
        logger.info(
            "DRY RUN: validated %d probes (%d MOVIE, %d TV). Zero API/DB writes performed.",
            len(probes),
            EXPECTED_MOVIE_PROBES,
            EXPECTED_TV_PROBES,
        )
        return 0

    if os.environ.get(ALLOW_SEEDING_ENV_VAR, "").lower() != "true":
        logger.error("--execute requires %s=true in the environment.", ALLOW_SEEDING_ENV_VAR)
        return 2

    allow_remote = os.environ.get(ALLOW_REMOTE_ENV_VAR, "").lower() == "true"
    if not is_local_api_target(args.api_url) and not allow_remote:
        logger.error(
            "Refusing remote API target %s without %s=true.",
            args.api_url,
            ALLOW_REMOTE_ENV_VAR,
        )
        return 2

    db_url = os.environ.get("DATABASE_URL")
    try:
        verify_api_and_db_target(
            args.api_url,
            db_url,
            allow_remote=allow_remote,
        )
    except TargetVerificationError as exc:
        logger.error("Target preflight verification failed: %s", exc)
        return 2

    digest = compute_probes_digest(probes)
    try:
        cp = load_probe_checkpoint(args.checkpoint, digest, args.api_url)
    except ProbeCheckpointError as exc:
        logger.error("Probe checkpoint validation failed: %s", exc)
        return 2

    summary = run_probe_ingestion(probes, cp, args.checkpoint, args.api_url)
    logger.info(
        "Probe ingestion finished: completed=%d/%d, partial_tv=%d, unresolved=%d, success=%s",
        summary.completed_count,
        summary.total_probes,
        summary.partial_tv_count,
        summary.unresolved_count,
        summary.success,
    )
    return 0 if summary.success else 1


if __name__ == "__main__":
    sys.exit(main())
