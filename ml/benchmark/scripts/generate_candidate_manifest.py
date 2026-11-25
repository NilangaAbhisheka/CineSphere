"""
CineSphere — Stage 5.0.3-B.1: Candidate Manifest Generator
============================================================

Discovers TMDB catalogue candidates for Stage 5.0.3-B seeding via:
  - GET /discover/movie  (parametric sorted by vote_count.desc)
  - GET /discover/tv     (parametric sorted by vote_count.desc)
  - GET /movie/top_rated (paginated)
  - GET /tv/top_rated    (paginated)

Applies validated filtering, deduplication, language-diversity quotas and
probe exclusion before writing an atomic manifest to:
  ml/benchmark/fixtures/seeding_candidate_manifest.json

Usage:
  python -m ml.benchmark.scripts.generate_candidate_manifest
    [--dry-run] [--mode {execution_ready,diagnostic}] [--pages N]

Environment:
  TMDB_READ_ACCESS_TOKEN   TMDB v4 Read Access Token (Bearer)
  DATABASE_URL             PostgreSQL connection string. In execution_ready mode,
                           a successful read-only catalogue audit is mandatory.

Safety:
  - Never writes to PostgreSQL.
  - Never accesses personal library tables.
  - Never modifies probes_v1.json.
  - Writes the manifest atomically via a temporary file + rename.
  - Redacts TMDB_READ_ACCESS_TOKEN from all log output, exception messages,
    and the manifest itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
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
_PROBES_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "probes_v1.json"
_MANIFEST_PATH = _REPO_ROOT / "ml" / "benchmark" / "fixtures" / "seeding_candidate_manifest.json"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "1.0.0"
MANIFEST_VERSION = "1.0.0"

#: Minimum overview length (characters) a candidate must have.
MIN_OVERVIEW_LENGTH = 30

#: Minimum TMDB vote count a candidate must have.
MIN_VOTE_COUNT = 50

#: At least this fraction of movie candidates must be non-English.
MOVIE_NONENG_FRACTION = 0.25

#: At least this fraction of TV candidates must be non-English.
TV_NONENG_FRACTION = 0.20

#: Gross ingestion targets (Section 10 of seeding plan, corrected arithmetic).
#: ceil(1,224 × 1.15) = ceil(1407.6) = 1,408 movie non-probe candidates.
#: ceil(482  × 1.15) = ceil(554.3)  =   555 TV non-probe candidates.
MOVIE_CANDIDATE_TARGET = 1_408
TV_CANDIDATE_TARGET = 555

#: Maximum pages to fetch per TMDB endpoint.
DEFAULT_MAX_PAGES = 100

#: Minimum inter-request delay in seconds (matches transport-level pacing).
MIN_REQUEST_INTERVAL_S = 0.11

TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Regex patterns matching synthetic / placeholder titles that must be excluded.
# Keep in sync with prepare_catalogue_fixture.py.
_SYNTHETIC_MOVIE_PATTERN = re.compile(
    r"""
    ^ (?:
        Test\s|
        Fake\s|
        Mock\s|
        Sample\s|
        Placeholder|
        Untitled|
        N/A|
        TBD|
        Unknown|
        \[.*?\]           # bracket-wrapped titles
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

_SYNTHETIC_TV_PATTERN = re.compile(
    r"""
    ^ (?:
        Test\s|
        Fake\s|
        Mock\s|
        Sample\s|
        Placeholder|
        Untitled|
        N/A|
        TBD|
        Unknown|
        \[.*?\]
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("manifest_generator")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class CredentialError(Exception):
    """Raised when TMDB_READ_ACCESS_TOKEN is missing or authentication fails."""


class CatalogueAuditError(Exception):
    """Raised when database catalogue audit fails in execution-ready mode."""


class InsufficientCandidatesError(Exception):
    """Raised when candidate collection fails to satisfy target or diversity quotas."""


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------
@dataclass
class CandidateEntry:
    media_type: str  # "movie" or "tv"
    tmdb_id: int
    title: str
    original_language: str
    overview: str
    vote_count: int
    source_endpoints: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# TMDB HTTP Helpers
# ---------------------------------------------------------------------------
def _redact_token(text: str, token: str) -> str:
    """Remove any accidental token leakage from log strings."""
    if not token:
        return text
    return text.replace(token, "[REDACTED]")


class TmdbClient:
    """Minimal synchronous TMDB HTTP client with rate pacing."""

    def __init__(self, token: str) -> None:
        if not token:
            raise CredentialError("TMDB_READ_ACCESS_TOKEN is not set.")
        self._token = token
        self._last_request_at: float = 0.0

    def _pace(self) -> None:
        """Block until the minimum inter-request interval has elapsed."""
        elapsed = time.monotonic() - self._last_request_at
        gap = MIN_REQUEST_INTERVAL_S - elapsed
        if gap > 0:
            time.sleep(gap)
        self._last_request_at = time.monotonic()

    def get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
        retries: int = 3,
    ) -> dict[str, Any]:
        """Perform a paced GET request; raises on unrecoverable errors."""
        url = f"{TMDB_BASE_URL}{endpoint}"
        if params:
            encoded = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            url = f"{url}?{encoded}"

        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }

        attempt = 0
        while attempt <= retries:
            self._pace()
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")  # noqa: S310
                with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    retry_after = int(exc.headers.get("Retry-After", "2"))
                    logger.warning("HTTP 429 — sleeping %ds before retry.", retry_after + 1)
                    time.sleep(retry_after + 1)
                    attempt += 1
                    continue
                if exc.code in {401, 403}:
                    raise CredentialError(f"TMDB authentication failed (HTTP {exc.code}).") from exc
                if exc.code == 404:
                    raise FileNotFoundError(f"TMDB resource not found: {endpoint}") from exc
                if attempt < retries:
                    wait = 2**attempt
                    logger.warning("HTTP %d — retrying in %ds.", exc.code, wait)
                    time.sleep(wait)
                    attempt += 1
                    continue
                raise
            except (OSError, TimeoutError) as exc:
                if attempt < retries:
                    wait = 2**attempt
                    logger.warning("Network error (%s) — retrying in %ds.", exc, wait)
                    time.sleep(wait)
                    attempt += 1
                    continue
                raise

        raise RuntimeError(f"TMDB request failed after {retries} retries: {endpoint}")


# ---------------------------------------------------------------------------
# Probe Loading
# ---------------------------------------------------------------------------
def load_probe_ids(probes_path: Path) -> dict[str, set[int]]:
    """
    Returns a mapping of media_type -> set of TMDB IDs for all 50 probes.
    Used to exclude probes from the candidate manifest.
    """
    with probes_path.open("r", encoding="utf-8") as fh:
        probes: list[dict[str, Any]] = json.load(fh)

    result: dict[str, set[int]] = {"movie": set(), "tv": set()}
    for p in probes:
        mt = p["media_type"].lower()
        result.setdefault(mt, set()).add(int(p["tmdb_id"]))
    return result


# ---------------------------------------------------------------------------
# Database Catalogue Exclusion (Fail-Closed)
# ---------------------------------------------------------------------------
def load_existing_catalogue_ids(
    database_url: str | None,
    require_audit: bool = True,
) -> tuple[dict[str, set[int]], str, str | None]:
    """
    Returns (ids_by_type, audit_status, audit_timestamp).
    Uses a strictly read-only PostgreSQL transaction; queries only catalogue tables
    (`movies` and `tv_shows`), never personal library tables.

    If require_audit is True (execution_ready mode):
      - Missing DATABASE_URL raises CatalogueAuditError.
      - Missing psycopg2 raises CatalogueAuditError.
      - Connection or query failure raises CatalogueAuditError.
    If require_audit is False (diagnostic mode):
      - Falls back to empty sets with warning and returns status 'diagnostic'.
    """
    if not database_url:
        if require_audit:
            raise CatalogueAuditError(
                "Execution-ready mode requires DATABASE_URL to verify existing catalogue records. "
                "Set DATABASE_URL before generating an execution-ready manifest."
            )
        logger.info("DATABASE_URL not set — diagnostic mode skipping catalogue exclusion.")
        return {"movie": set(), "tv": set()}, "diagnostic", None

    try:
        import psycopg2  # type: ignore[import]
    except ImportError as exc:
        if require_audit:
            raise CatalogueAuditError(
                "psycopg2 is required for execution-ready catalogue audit. "
                "Install psycopg2-binary or run in diagnostic mode."
            ) from exc
        logger.warning("psycopg2 not available — diagnostic mode skipping catalogue exclusion.")
        return {"movie": set(), "tv": set()}, "diagnostic", None

    try:
        conn = psycopg2.connect(database_url)
        conn.set_session(readonly=True, autocommit=False)
        with conn.cursor() as cursor:
            cursor.execute('SELECT "tmdbId" FROM movies;')
            movie_ids = {int(row[0]) for row in cursor.fetchall()}

            cursor.execute('SELECT "tmdbId" FROM tv_shows;')
            tv_ids = {int(row[0]) for row in cursor.fetchall()}

        conn.close()
        timestamp = datetime.now(UTC).isoformat()

        logger.info(
            "Catalogue exclusion verified: %d movies and %d TV shows already present.",
            len(movie_ids),
            len(tv_ids),
        )
        return {"movie": movie_ids, "tv": tv_ids}, "verified", timestamp
    except Exception as exc:  # noqa: BLE001
        if require_audit:
            raise CatalogueAuditError(
                f"Catalogue audit query failed: {exc}. "
                "Execution-ready manifest cannot be generated without verified catalogue exclusion."
            ) from exc
        logger.warning("Could not query catalogue DB (diagnostic mode fallback): %s", exc)
        return {"movie": set(), "tv": set()}, "failed", None


# ---------------------------------------------------------------------------
# Candidate Validation
# ---------------------------------------------------------------------------
def is_valid_movie_candidate(item: dict[str, Any]) -> bool:
    """Return True when item passes all movie candidate filters."""
    tmdb_id = item.get("id")
    title = item.get("title") or item.get("original_title") or ""
    overview = item.get("overview") or ""
    vote_count = item.get("vote_count") or 0
    language = item.get("original_language") or ""

    if not isinstance(tmdb_id, int) or tmdb_id <= 0:
        return False
    if not title.strip():
        return False
    if len(overview.strip()) < MIN_OVERVIEW_LENGTH:
        return False
    if vote_count < MIN_VOTE_COUNT:
        return False
    if not language.strip():
        return False
    if _SYNTHETIC_MOVIE_PATTERN.match(title):
        return False
    return True


def is_valid_tv_candidate(item: dict[str, Any]) -> bool:
    """Return True when item passes all TV candidate filters."""
    tmdb_id = item.get("id")
    name = item.get("name") or item.get("original_name") or ""
    overview = item.get("overview") or ""
    vote_count = item.get("vote_count") or 0
    language = item.get("original_language") or ""

    if not isinstance(tmdb_id, int) or tmdb_id <= 0:
        return False
    if not name.strip():
        return False
    if len(overview.strip()) < MIN_OVERVIEW_LENGTH:
        return False
    if vote_count < MIN_VOTE_COUNT:
        return False
    if not language.strip():
        return False
    if _SYNTHETIC_TV_PATTERN.match(name):
        return False
    return True


# ---------------------------------------------------------------------------
# TMDB Discovery
# ---------------------------------------------------------------------------
def _fetch_pages(
    client: TmdbClient,
    endpoint: str,
    extra_params: dict[str, Any],
    max_pages: int,
) -> list[dict[str, Any]]:
    """Paginate through a TMDB endpoint and return all raw result items."""
    items: list[dict[str, Any]] = []
    page = 1
    while page <= max_pages:
        params = {"page": page, **extra_params}
        try:
            data = client.get(endpoint, params)
        except FileNotFoundError:
            break
        results = data.get("results") or []
        total_pages = data.get("total_pages") or 1
        items.extend(results)
        logger.debug("  %s page %d/%d: %d items", endpoint, page, total_pages, len(results))
        if page >= total_pages or not results:
            break
        page += 1
    return items


def collect_movie_candidates(
    client: TmdbClient,
    max_pages: int,
    probe_ids: set[int],
    catalogue_ids: set[int],
) -> list[CandidateEntry]:
    """
    Discover movie candidates from /discover/movie and /movie/top_rated.
    Returns a deduplicated, validated list ordered by TMDB ID.
    """
    logger.info("Collecting movie candidates...")
    seen: dict[int, CandidateEntry] = {}

    source_configs: list[tuple[str, dict[str, Any]]] = [
        ("/movie/top_rated", {"language": "en-US"}),
        (
            "/discover/movie",
            {
                "sort_by": "vote_count.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "without_genres": "",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "ja",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "ko",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "fr",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "es",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "de",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "it",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "pt",
            },
        ),
        (
            "/discover/movie",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "zh",
            },
        ),
    ]

    for endpoint, params in source_configs:
        items = _fetch_pages(client, endpoint, params, max_pages)
        for item in items:
            if not is_valid_movie_candidate(item):
                continue
            tmdb_id = int(item["id"])
            if tmdb_id in probe_ids or tmdb_id in catalogue_ids:
                continue
            if tmdb_id in seen:
                if endpoint not in seen[tmdb_id].source_endpoints:
                    seen[tmdb_id].source_endpoints.append(endpoint)
                continue
            seen[tmdb_id] = CandidateEntry(
                media_type="movie",
                tmdb_id=tmdb_id,
                title=(item.get("title") or item.get("original_title") or "").strip(),
                original_language=(item.get("original_language") or "").strip(),
                overview=(item.get("overview") or "").strip(),
                vote_count=int(item.get("vote_count") or 0),
                source_endpoints=[endpoint],
            )

    candidates = list(seen.values())
    logger.info("Movie candidates collected: %d (before target cap)", len(candidates))
    return candidates


def collect_tv_candidates(
    client: TmdbClient,
    max_pages: int,
    probe_ids: set[int],
    catalogue_ids: set[int],
) -> list[CandidateEntry]:
    """
    Discover TV candidates from /discover/tv and /tv/top_rated.
    Returns a deduplicated, validated list.
    """
    logger.info("Collecting TV candidates...")
    seen: dict[int, CandidateEntry] = {}

    source_configs: list[tuple[str, dict[str, Any]]] = [
        ("/tv/top_rated", {"language": "en-US"}),
        (
            "/discover/tv",
            {
                "sort_by": "vote_count.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
            },
        ),
        (
            "/discover/tv",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "ja",
            },
        ),
        (
            "/discover/tv",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "ko",
            },
        ),
        (
            "/discover/tv",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "fr",
            },
        ),
        (
            "/discover/tv",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "es",
            },
        ),
        (
            "/discover/tv",
            {
                "sort_by": "popularity.desc",
                "vote_count.gte": MIN_VOTE_COUNT,
                "with_original_language": "de",
            },
        ),
    ]

    for endpoint, params in source_configs:
        items = _fetch_pages(client, endpoint, params, max_pages)
        for item in items:
            if not is_valid_tv_candidate(item):
                continue
            tmdb_id = int(item["id"])
            if tmdb_id in probe_ids or tmdb_id in catalogue_ids:
                continue
            if tmdb_id in seen:
                if endpoint not in seen[tmdb_id].source_endpoints:
                    seen[tmdb_id].source_endpoints.append(endpoint)
                continue
            seen[tmdb_id] = CandidateEntry(
                media_type="tv",
                tmdb_id=tmdb_id,
                title=(item.get("name") or item.get("original_name") or "").strip(),
                original_language=(item.get("original_language") or "").strip(),
                overview=(item.get("overview") or "").strip(),
                vote_count=int(item.get("vote_count") or 0),
                source_endpoints=[endpoint],
            )

    candidates = list(seen.values())
    logger.info("TV candidates collected: %d (before target cap)", len(candidates))
    return candidates


# ---------------------------------------------------------------------------
# Language Diversity Selection
# ---------------------------------------------------------------------------
def select_with_diversity(
    candidates: list[CandidateEntry],
    target: int,
    min_noneng_fraction: float,
) -> list[CandidateEntry]:
    """
    Select up to `target` candidates while ensuring at least
    `min_noneng_fraction` of the selection is non-English.
    Uses math.ceil for mathematically correct rounding of quota minimums.
    """
    min_noneng = math.ceil(target * min_noneng_fraction)

    def _sort_key(c: CandidateEntry) -> tuple[int, int]:
        return (-c.vote_count, c.tmdb_id)

    non_english = sorted([c for c in candidates if c.original_language != "en"], key=_sort_key)
    selected_noneng = non_english[:min_noneng]
    already_selected_ids = {c.tmdb_id for c in selected_noneng}

    # Fill remaining slots from all candidates (excluding already selected).
    remaining_target = target - len(selected_noneng)
    all_sorted = sorted(candidates, key=_sort_key)
    remaining = [c for c in all_sorted if c.tmdb_id not in already_selected_ids]
    selected_rest = remaining[:remaining_target]

    combined = selected_noneng + selected_rest
    return sorted(combined, key=lambda c: c.tmdb_id)


# ---------------------------------------------------------------------------
# Diversity Reporting
# ---------------------------------------------------------------------------
def compute_diversity_stats(candidates: list[CandidateEntry]) -> dict[str, Any]:
    total = len(candidates)
    if total == 0:
        return {
            "total": 0,
            "english_count": 0,
            "non_english_count": 0,
            "non_english_fraction": 0.0,
            "language_distribution": {},
        }
    lang_dist: dict[str, int] = {}
    english_count = 0
    for c in candidates:
        lang = c.original_language or "unknown"
        lang_dist[lang] = lang_dist.get(lang, 0) + 1
        if lang == "en":
            english_count += 1

    non_english_count = total - english_count
    return {
        "total": total,
        "english_count": english_count,
        "non_english_count": non_english_count,
        "non_english_fraction": round(non_english_count / total, 4) if total else 0.0,
        "language_distribution": dict(sorted(lang_dist.items())),
    }


# ---------------------------------------------------------------------------
# Manifest Digest
# ---------------------------------------------------------------------------
def compute_manifest_digest(
    movie_candidates: list[CandidateEntry],
    tv_candidates: list[CandidateEntry],
    filtering_criteria: dict[str, Any],
    is_executable: bool = True,
) -> str:
    """
    Deterministic SHA-256 digest of the candidate selection, including execution
    readiness state and filtering criteria. Excludes timestamps.
    """
    digest_payload = {
        "schema_version": SCHEMA_VERSION,
        "filtering_criteria": filtering_criteria,
        "movie_ids": sorted(c.tmdb_id for c in movie_candidates),
        "tv_ids": sorted(c.tmdb_id for c in tv_candidates),
        "is_executable": is_executable,
    }
    payload_bytes = json.dumps(digest_payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload_bytes).hexdigest()


# ---------------------------------------------------------------------------
# Atomic Manifest Write
# ---------------------------------------------------------------------------
def write_manifest_atomic(manifest: dict[str, Any], path: Path) -> None:
    """Write manifest atomically using a temporary file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Main Generation Logic
# ---------------------------------------------------------------------------
def build_manifest(
    max_pages: int = DEFAULT_MAX_PAGES,
    dry_run: bool = False,
    mode: str = "execution_ready",
    database_url: str | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    """
    Core manifest generation logic. Returns the manifest dict.
    In dry_run mode the manifest is marked non-executable and NOT written to disk.

    Args:
        max_pages:    Maximum discovery pages per endpoint.
        dry_run:      If True, skips TMDB discovery and manifest write.
        mode:         'execution_ready' (requires full audit and quota satisfaction)
                      or 'diagnostic' (diagnostic inspection allowed).
        database_url: PostgreSQL URL for catalogue exclusion.
        token:        TMDB read access token; falls back to env var.
    """
    resolved_token = token or os.environ.get("TMDB_READ_ACCESS_TOKEN", "")
    if not resolved_token and not dry_run:
        raise CredentialError(
            "TMDB_READ_ACCESS_TOKEN is not set. Export it before running the manifest generator."
        )

    # Load probe IDs to exclude from candidates.
    probe_ids_by_type = load_probe_ids(_PROBES_PATH)
    probe_movie_ids = probe_ids_by_type.get("movie", set())
    probe_tv_ids = probe_ids_by_type.get("tv", set())
    total_probe_ids = len(probe_movie_ids) + len(probe_tv_ids)
    logger.info("Loaded %d benchmark probe IDs to exclude.", total_probe_ids)

    # Fail-closed catalogue exclusion check.
    require_audit = mode == "execution_ready" and not dry_run
    catalogue_ids, audit_status, audit_timestamp = load_existing_catalogue_ids(
        database_url, require_audit=require_audit
    )

    filtering_criteria: dict[str, Any] = {
        "min_overview_length": MIN_OVERVIEW_LENGTH,
        "min_vote_count": MIN_VOTE_COUNT,
        "movie_noneng_min_fraction": MOVIE_NONENG_FRACTION,
        "tv_noneng_min_fraction": TV_NONENG_FRACTION,
        "probe_exclusion": True,
        "catalogue_exclusion": bool(database_url),
        "max_pages_per_endpoint": max_pages,
        "generation_mode": mode,
    }

    if dry_run:
        logger.info(
            "[DRY RUN] Skipping TMDB discovery. Returning non-executable manifest structure."
        )
        movie_candidates: list[CandidateEntry] = []
        tv_candidates: list[CandidateEntry] = []
        is_executable = False
        status = "dry_run"
    else:
        client = TmdbClient(resolved_token)

        raw_movies = collect_movie_candidates(
            client, max_pages, probe_movie_ids, catalogue_ids.get("movie", set())
        )
        raw_tv = collect_tv_candidates(
            client, max_pages, probe_tv_ids, catalogue_ids.get("tv", set())
        )

        movie_candidates = select_with_diversity(
            raw_movies, MOVIE_CANDIDATE_TARGET, MOVIE_NONENG_FRACTION
        )
        tv_candidates = select_with_diversity(raw_tv, TV_CANDIDATE_TARGET, TV_NONENG_FRACTION)

        # Verification of targets & quotas
        movie_diversity = compute_diversity_stats(movie_candidates)
        tv_diversity = compute_diversity_stats(tv_candidates)

        movies_meet_target = len(movie_candidates) >= MOVIE_CANDIDATE_TARGET
        tv_meets_target = len(tv_candidates) >= TV_CANDIDATE_TARGET
        movie_meets_div = movie_diversity.get("non_english_fraction", 0.0) >= MOVIE_NONENG_FRACTION
        tv_meets_div = tv_diversity.get("non_english_fraction", 0.0) >= TV_NONENG_FRACTION

        all_quotas_met = movies_meet_target and tv_meets_target and movie_meets_div and tv_meets_div

        if mode == "execution_ready":
            if not all_quotas_met or audit_status != "verified":
                logger.error(
                    "Execution-ready quotas not satisfied: movies=%d/%d (%.1f%% non-en), "
                    "tv=%d/%d (%.1f%% non-en), audit=%s",
                    len(movie_candidates),
                    MOVIE_CANDIDATE_TARGET,
                    movie_diversity.get("non_english_fraction", 0.0) * 100,
                    len(tv_candidates),
                    TV_CANDIDATE_TARGET,
                    tv_diversity.get("non_english_fraction", 0.0) * 100,
                    audit_status,
                )
                raise InsufficientCandidatesError(
                    f"Candidate quotas or audit incomplete: "
                    f"movies={len(movie_candidates)}/{MOVIE_CANDIDATE_TARGET}, "
                    f"tv={len(tv_candidates)}/{TV_CANDIDATE_TARGET}, audit={audit_status}. "
                    "Cannot generate an execution-ready manifest."
                )
            is_executable = True
            status = "execution_ready"
        else:
            is_executable = False
            status = "diagnostic"

    movie_diversity = compute_diversity_stats(movie_candidates)
    tv_diversity = compute_diversity_stats(tv_candidates)

    source_endpoints = [
        "/movie/top_rated",
        "/tv/top_rated",
        "/discover/movie (sort_by=vote_count.desc)",
        "/discover/tv (sort_by=vote_count.desc)",
        "/discover/movie (non-English language passes: ja,ko,fr,es,de,it,pt,zh)",
        "/discover/tv (non-English language passes: ja,ko,fr,es,de)",
    ]

    digest = compute_manifest_digest(
        movie_candidates, tv_candidates, filtering_criteria, is_executable=is_executable
    )

    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "manifest_version": MANIFEST_VERSION,
        "is_executable": is_executable,
        "mode": mode,
        "status": status,
        "generation_timestamp": datetime.now(UTC).isoformat(),
        "source_endpoints": source_endpoints,
        "filtering_criteria": filtering_criteria,
        "targets": {
            "movie_candidate_target": MOVIE_CANDIDATE_TARGET,
            "tv_candidate_target": TV_CANDIDATE_TARGET,
        },
        "counts": {
            "movie_candidates_selected": len(movie_candidates),
            "tv_candidates_selected": len(tv_candidates),
            "total_candidates": len(movie_candidates) + len(tv_candidates),
        },
        "probe_exclusion": {
            "probes_excluded_movie_count": len(probe_movie_ids),
            "probes_excluded_tv_count": len(probe_tv_ids),
            "probes_fixture_path": str(_PROBES_PATH.relative_to(_REPO_ROOT)),
        },
        "catalogue_exclusion": {
            "enabled": bool(database_url),
            "status": audit_status,
            "audit_timestamp": audit_timestamp,
            "movies_already_in_catalogue": len(catalogue_ids.get("movie", set())),
            "tv_shows_already_in_catalogue": len(catalogue_ids.get("tv", set())),
        },
        "language_diversity": {
            "movies": movie_diversity,
            "tv": tv_diversity,
        },
        "movies": [
            {
                "tmdb_id": c.tmdb_id,
                "title": c.title,
                "original_language": c.original_language,
                "vote_count": c.vote_count,
                "source_endpoints": c.source_endpoints,
            }
            for c in movie_candidates
        ],
        "tv_shows": [
            {
                "tmdb_id": c.tmdb_id,
                "title": c.title,
                "original_language": c.original_language,
                "vote_count": c.vote_count,
                "source_endpoints": c.source_endpoints,
            }
            for c in tv_candidates
        ],
        "manifest_digest": digest,
    }

    if not dry_run:
        write_manifest_atomic(manifest, _MANIFEST_PATH)
        logger.info(
            "Manifest written to %s (%d movies, %d TV shows, is_executable=%s, digest=%s…)",
            _MANIFEST_PATH,
            len(movie_candidates),
            len(tv_candidates),
            is_executable,
            digest[:12],
        )
    else:
        logger.info("[DRY RUN] Manifest not written (dry_run=True).")

    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a TMDB candidate seeding manifest for CineSphere Stage 5.0.3-B."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Validate configuration and print stats without calling TMDB or writing files.",
    )
    parser.add_argument(
        "--mode",
        choices=["execution_ready", "diagnostic"],
        default="execution_ready",
        help="Generation mode: 'execution_ready' (requires full DB audit) or 'diagnostic'.",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"Maximum pages to fetch per TMDB endpoint (default: {DEFAULT_MAX_PAGES}).",
    )
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")

    try:
        manifest = build_manifest(
            max_pages=args.pages,
            dry_run=args.dry_run,
            mode=args.mode,
            database_url=database_url,
        )
        print(
            f"\nManifest summary: "
            f"{manifest['counts']['movie_candidates_selected']} movies, "
            f"{manifest['counts']['tv_candidates_selected']} TV shows | "
            f"is_executable={manifest['is_executable']} | "
            f"digest={manifest['manifest_digest'][:16]}…"
        )
        return 0
    except CredentialError as exc:
        logger.error("Credential error: %s", exc)
        return 2
    except CatalogueAuditError as exc:
        logger.error("Catalogue audit error: %s", exc)
        return 2
    except InsufficientCandidatesError as exc:
        logger.error("Candidate quota error: %s", exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        logger.error("Manifest generation failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
