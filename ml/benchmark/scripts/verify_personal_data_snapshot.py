"""
CineSphere — Stage 5.0.3-B.2: Personal Data Isolation & Target Verification
===========================================================================

Provides:
  1. Read-only PostgreSQL row-count snapshots for all personal-data tables
     defined in apps/api/prisma/schema.prisma:
       - users
       - user_library_entries
       - viewing_events
       - episode_progress
       - season_ratings
       - system_configs
  2. Pre/post snapshot comparison that fails closed if any personal-data table
     changes during catalogue seeding.
  3. Safe, credential-free database & API target verification for preflight checks.

Never logs or persists database passwords, usernames, API tokens, or full URLs.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    import psycopg2
except ImportError:  # pragma: no cover - optional in minimal unit-test envs
    psycopg2 = None  # type: ignore[assignment]

logger = logging.getLogger("personal_snapshot")

SNAPSHOT_SCHEMA_VERSION = "1.0.0"

#: Authoritative list of personal-data & system-config tables from prisma/schema.prisma
PERSONAL_DATA_TABLES: tuple[str, ...] = (
    "users",
    "user_library_entries",
    "viewing_events",
    "episode_progress",
    "season_ratings",
    "system_configs",
)

LOCAL_DB_HOSTS: frozenset[str] = frozenset({"localhost", "127.0.0.1", "::1", "postgres"})


class PersonalDataIntegrityError(Exception):
    """Raised when personal-data table counts change between pre and post snapshots."""


class TargetVerificationError(Exception):
    """Raised when API or database target identity cannot be verified safely."""


def strip_prisma_schema_param(database_url: str) -> str:
    """Remove Prisma-specific ?schema=... query parameter that psycopg2 rejects."""
    parsed = urllib.parse.urlparse(database_url)
    if not parsed.query:
        return database_url
    params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    params.pop("schema", None)
    new_query = urllib.parse.urlencode(params, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


def parse_safe_db_identity(database_url: str) -> dict[str, Any]:
    """
    Extract non-secret database identity (database_name, host, port) from a URL.
    Never returns username, password, query secrets, or raw URL.
    """
    if not database_url or not database_url.strip():
        raise TargetVerificationError("DATABASE_URL is empty or missing.")
    parsed = urllib.parse.urlparse(database_url.strip())
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise TargetVerificationError(
            f"Unsupported database scheme {parsed.scheme!r}; expected postgresql/postgres."
        )
    host = (parsed.hostname or "").lower()
    if not host:
        raise TargetVerificationError("DATABASE_URL is missing a hostname.")
    port = parsed.port or 5432
    db_name = parsed.path.lstrip("/")
    if not db_name:
        raise TargetVerificationError("DATABASE_URL is missing a database name.")
    return {
        "database_name": db_name,
        "host": host,
        "port": port,
        "is_local_host": host in LOCAL_DB_HOSTS,
    }


def _is_local_api_host(api_url: str) -> bool:
    host = (urllib.parse.urlparse(api_url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def verify_api_and_db_target(
    api_base_url: str,
    database_url: str | None,
    *,
    allow_remote: bool = False,
    health_payload: dict[str, Any] | None = None,
    timeout_s: int = 10,
) -> dict[str, Any]:
    """
    Verify that the NestJS API and local scripts target the exact same intended
    local database without printing any credentials.

    Fails closed with TargetVerificationError on any mismatch or unreachability.
    """
    if not allow_remote and not _is_local_api_host(api_base_url):
        raise TargetVerificationError(f"API target {api_base_url!r} is not a local loopback host.")

    if not database_url:
        raise TargetVerificationError(
            "DATABASE_URL is required to verify database target identity."
        )
    db_identity = parse_safe_db_identity(database_url)
    if not allow_remote and not db_identity["is_local_host"]:
        raise TargetVerificationError(
            f"Database host {db_identity['host']!r} is not a recognized local host."
        )

    if health_payload is None:
        health_url = f"{api_base_url.rstrip('/')}/api/health"
        req = urllib.request.Request(health_url, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                if resp.status != 200:
                    raise TargetVerificationError(f"API health check returned HTTP {resp.status}.")
                health_payload = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
            raise TargetVerificationError(
                f"Failed to query API health endpoint at {health_url}: {exc}"
            ) from exc

    if health_payload.get("status") != "ok":
        raise TargetVerificationError(
            f"API health status is {health_payload.get('status')!r}, expected 'ok'."
        )

    api_db = health_payload.get("database") or {}
    if api_db.get("connected") is not True:
        raise TargetVerificationError("API reports database is not connected.")

    api_db_name = api_db.get("databaseName")
    api_db_port = api_db.get("port")
    api_db_host = (api_db.get("host") or "").lower() or None

    if api_db_name is not None and api_db_name != db_identity["database_name"]:
        raise TargetVerificationError(
            f"Database name mismatch: API uses {api_db_name!r}, "
            f"manifest/audit uses {db_identity['database_name']!r}."
        )

    if api_db_port is not None and int(api_db_port) != int(db_identity["port"]):
        raise TargetVerificationError(
            f"Database port mismatch: API uses {api_db_port}, "
            f"manifest/audit uses {db_identity['port']}."
        )

    if api_db_host is not None and not allow_remote and api_db_host not in LOCAL_DB_HOSTS:
        raise TargetVerificationError(f"API database host {api_db_host!r} is not a local host.")

    return {
        "verified": True,
        "api_url": api_base_url.rstrip("/"),
        "database_name": db_identity["database_name"],
        "database_host": db_identity["host"],
        "database_port": db_identity["port"],
        "api_reported_database_name": api_db_name,
        "api_reported_port": api_db_port,
        "api_reported_host": api_db_host,
    }


@dataclass
class PersonalDataSnapshot:
    schema_version: str = SNAPSHOT_SCHEMA_VERSION
    captured_at: str = ""
    database_identity: dict[str, Any] = field(default_factory=dict)
    row_counts: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "captured_at": self.captured_at,
            "database_identity": self.database_identity,
            "row_counts": dict(self.row_counts),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PersonalDataSnapshot:
        return cls(
            schema_version=str(data.get("schema_version", SNAPSHOT_SCHEMA_VERSION)),
            captured_at=str(data.get("captured_at", "")),
            database_identity=dict(data.get("database_identity") or {}),
            row_counts={str(k): int(v) for k, v in (data.get("row_counts") or {}).items()},
        )


@dataclass
class SnapshotComparisonResult:
    passed: bool
    pre_captured_at: str
    post_captured_at: str
    deltas: dict[str, dict[str, int]] = field(default_factory=dict)
    changed_tables: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "pre_captured_at": self.pre_captured_at,
            "post_captured_at": self.post_captured_at,
            "changed_tables": self.changed_tables,
            "errors": self.errors,
            "deltas": self.deltas,
        }


def capture_personal_snapshot(database_url: str) -> PersonalDataSnapshot:
    """
    Capture read-only row counts for all personal-data tables.
    Enforces read-only PostgreSQL session mode and never writes to the database.
    """
    if psycopg2 is None:
        raise ImportError("psycopg2 is required to capture personal-data snapshots.")

    db_identity = parse_safe_db_identity(database_url)
    clean_url = strip_prisma_schema_param(database_url)

    conn = psycopg2.connect(clean_url)
    try:
        conn.set_session(readonly=True, autocommit=True)
        row_counts: dict[str, int] = {}
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on;")
            cur.execute("SELECT current_database(), inet_server_port();")
            sql_row = cur.fetchone()
            if sql_row:
                db_identity["sql_current_database"] = sql_row[0]
                db_identity["sql_server_port"] = sql_row[1]

            for table in PERSONAL_DATA_TABLES:
                cur.execute(f'SELECT COUNT(*) FROM "{table}";')
                count_row = cur.fetchone()
                row_counts[table] = int(count_row[0]) if count_row else 0
    finally:
        conn.close()

    return PersonalDataSnapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        captured_at=datetime.now(UTC).isoformat(),
        database_identity=db_identity,
        row_counts=row_counts,
    )


def save_snapshot_atomic(snapshot: PersonalDataSnapshot, path: Path) -> None:
    """Write snapshot JSON atomically via temp file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".snapshot_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(snapshot.to_dict(), fh, indent=2, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def load_snapshot(path: Path) -> PersonalDataSnapshot:
    """Load a previously saved PersonalDataSnapshot JSON file."""
    if not path.exists():
        raise PersonalDataIntegrityError(f"Snapshot file not found: {path}")
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return PersonalDataSnapshot.from_dict(data)


def compare_personal_snapshots(
    pre: PersonalDataSnapshot,
    post: PersonalDataSnapshot,
) -> SnapshotComparisonResult:
    """
    Compare pre- and post-ingestion personal-data snapshots.
    Fails if any personal table row count changed or if table coverage is incomplete.
    """
    errors: list[str] = []
    changed_tables: list[str] = []
    deltas: dict[str, dict[str, int]] = {}

    pre_db = pre.database_identity.get("database_name")
    post_db = post.database_identity.get("database_name")
    if pre_db and post_db and pre_db != post_db:
        errors.append(f"Snapshot database mismatch: pre={pre_db!r}, post={post_db!r}.")

    for table in PERSONAL_DATA_TABLES:
        if table not in pre.row_counts or table not in post.row_counts:
            errors.append(f"Missing row count for required personal table {table!r}.")
            continue
        before = pre.row_counts[table]
        after = post.row_counts[table]
        delta = after - before
        deltas[table] = {"pre": before, "post": after, "delta": delta}
        if delta != 0:
            changed_tables.append(table)
            errors.append(
                f"Personal table {table!r} mutated during seeding: "
                f"pre={before}, post={after}, delta={delta:+d}."
            )

    passed = len(changed_tables) == 0 and len(errors) == 0
    return SnapshotComparisonResult(
        passed=passed,
        pre_captured_at=pre.captured_at,
        post_captured_at=post.captured_at,
        deltas=deltas,
        changed_tables=changed_tables,
        errors=errors,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Capture and verify read-only personal-data table snapshots."
    )
    parser.add_argument(
        "--mode",
        choices=["pre", "post", "verify"],
        required=True,
        help=(
            "pre: capture pre-ingestion snapshot; post: capture post & verify against "
            "--pre-snapshot; verify: compare two saved snapshots."
        ),
    )
    parser.add_argument("--output", type=Path, help="Output path for captured snapshot JSON.")
    parser.add_argument("--pre-snapshot", type=Path, help="Path to pre-ingestion snapshot JSON.")
    parser.add_argument("--post-snapshot", type=Path, help="Path to post-ingestion snapshot JSON.")
    parser.add_argument("--report-output", type=Path, help="Optional path for comparison JSON.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="PostgreSQL connection URL (defaults to DATABASE_URL env var).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    args = build_arg_parser().parse_args(argv)
    db_url = args.database_url or os.environ.get("DATABASE_URL")

    if args.mode == "pre":
        if not db_url:
            logger.error("DATABASE_URL is required for --mode pre.")
            return 2
        if not args.output:
            logger.error("--output is required for --mode pre.")
            return 2
        snap = capture_personal_snapshot(db_url)
        save_snapshot_atomic(snap, args.output)
        logger.info("Pre-ingestion personal snapshot saved to %s", args.output)
        return 0

    if args.mode == "post":
        if not db_url:
            logger.error("DATABASE_URL is required for --mode post.")
            return 2
        if not args.pre_snapshot or not args.output:
            logger.error("--pre-snapshot and --output are required for --mode post.")
            return 2
        pre = load_snapshot(args.pre_snapshot)
        post = capture_personal_snapshot(db_url)
        save_snapshot_atomic(post, args.output)
        result = compare_personal_snapshots(pre, post)
        if args.report_output:
            args.report_output.parent.mkdir(parents=True, exist_ok=True)
            args.report_output.write_text(json.dumps(result.to_dict(), indent=2), encoding="utf-8")
        if not result.passed:
            logger.error("Personal data verification FAILED: %s", "; ".join(result.errors))
            return 1
        logger.info(
            "Personal data verification PASSED (0 mutations across %d tables).",
            len(PERSONAL_DATA_TABLES),
        )
        return 0

    # --mode verify
    if not args.pre_snapshot or not args.post_snapshot:
        logger.error("--pre-snapshot and --post-snapshot are required for --mode verify.")
        return 2
    pre = load_snapshot(args.pre_snapshot)
    post = load_snapshot(args.post_snapshot)
    result = compare_personal_snapshots(pre, post)
    if args.report_output:
        args.report_output.parent.mkdir(parents=True, exist_ok=True)
        args.report_output.write_text(json.dumps(result.to_dict(), indent=2), encoding="utf-8")
    if not result.passed:
        logger.error("Personal data verification FAILED: %s", "; ".join(result.errors))
        return 1
    logger.info(
        "Personal data verification PASSED (0 mutations across %d tables).",
        len(PERSONAL_DATA_TABLES),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
