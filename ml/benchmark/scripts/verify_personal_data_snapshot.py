"""
CineSphere — Stage 5.0.3-B.2-E: Personal Data Integrity & Target Verification
===============================================================================

Provides:
  1. Read-only PostgreSQL row-count AND deterministic content-integrity
     fingerprints for all personal-data / configuration tables defined in
     apps/api/prisma/schema.prisma:
       - users
       - user_library_entries
       - viewing_events
       - episode_progress
       - season_ratings
       - system_configs
  2. Pre/post snapshot comparison that fails closed if any row count,
     content fingerprint, schema column set, or database instance identity
     is missing or changed.
  3. SQL-grounded database & API target instance verification for preflight checks.

Never logs or persists personal row data, database passwords, usernames,
API tokens, or full connection strings.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import logging
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

try:
    import psycopg2
except ImportError:  # pragma: no cover - optional in minimal unit-test envs
    psycopg2 = None  # type: ignore[assignment]

logger = logging.getLogger("personal_snapshot")

SNAPSHOT_SCHEMA_VERSION = "2.0.0"

#: Authoritative column sets per personal/configuration table (prisma/schema.prisma).
#: Order is canonical; fingerprints bind both table name and column list.
PERSONAL_TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "users": ("id", "displayName", "createdAt", "updatedAt"),
    "user_library_entries": (
        "id",
        "user_id",
        "media_type",
        "movie_id",
        "tv_show_id",
        "status",
        "personal_rating",
        "notes",
        "created_at",
        "updated_at",
    ),
    "viewing_events": ("id", "library_entry_id", "watched_at", "rating", "notes"),
    "episode_progress": ("library_entry_id", "episode_id", "watched_at"),
    "season_ratings": (
        "id",
        "library_entry_id",
        "season_id",
        "rating",
        "created_at",
        "updated_at",
    ),
    "system_configs": ("key", "value", "updatedAt"),
}

PERSONAL_DATA_TABLES: tuple[str, ...] = tuple(PERSONAL_TABLE_COLUMNS.keys())

LOCAL_DB_HOSTS: frozenset[str] = frozenset({"localhost", "127.0.0.1", "::1", "postgres"})

MANDATORY_SQL_IDENTITY_FIELDS: tuple[str, ...] = (
    "database_name",
    "server_address",
    "server_port",
    "system_identifier",
    "database_oid",
)


class PersonalDataIntegrityError(Exception):
    """Raised when personal-data snapshots fail validation or integrity checks."""


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
    Extract non-secret database URL metadata (database_name, host, port).
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


def _is_local_server_ip(server_address: str | None) -> bool:
    """Return True if PostgreSQL inet_server_addr() is loopback or private/Docker."""
    if not server_address:
        return False
    addr_str = server_address.split("/")[0].strip()
    if not addr_str:
        return False
    try:
        ip = ipaddress.ip_address(addr_str)
        return ip.is_loopback or ip.is_private
    except ValueError:
        return False


def _redact_url_credentials(text: str, database_url: str | None = None) -> str:
    """Ensure credentials from database_url never appear in error messages."""
    if not database_url:
        return text
    parsed = urllib.parse.urlparse(database_url)
    sanitized = text.replace(database_url, "<REDACTED_DATABASE_URL>")
    if parsed.password:
        sanitized = sanitized.replace(parsed.password, "<REDACTED>")
    if parsed.username:
        sanitized = sanitized.replace(parsed.username, "<REDACTED>")
    return sanitized


def fetch_sql_db_identity(database_url: str) -> dict[str, Any]:
    """
    Independently query PostgreSQL instance identity over a read-only SQL connection.
    Fails closed if psycopg2 is unavailable, connection fails, or any mandatory
    identity field is missing.
    """
    if psycopg2 is None:
        raise TargetVerificationError(
            "psycopg2 is required to verify PostgreSQL instance identity."
        )
    url_meta = parse_safe_db_identity(database_url)
    clean_url = strip_prisma_schema_param(database_url)
    try:
        conn = psycopg2.connect(clean_url)
    except Exception as exc:
        safe_msg = _redact_url_credentials(str(exc), database_url)
        raise TargetVerificationError(
            f"Direct PostgreSQL connection failed during target verification: {safe_msg}"
        ) from exc

    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on;")
            cur.execute(
                """
                SELECT
                    current_database() AS database_name,
                    CAST(inet_server_addr() AS TEXT) AS server_address,
                    inet_server_port() AS server_port,
                    (SELECT system_identifier::TEXT FROM pg_control_system()) AS system_identifier,
                    (SELECT oid::INT FROM pg_database WHERE datname = current_database())
                        AS database_oid
                """
            )
            row = cur.fetchone()
    except Exception as exc:
        safe_msg = _redact_url_credentials(str(exc), database_url)
        raise TargetVerificationError(
            f"PostgreSQL instance identity query failed (fail-closed): {safe_msg}"
        ) from exc
    finally:
        conn.close()

    if not row:
        raise TargetVerificationError("PostgreSQL instance identity query returned no rows.")

    identity: dict[str, Any] = {
        "database_name": row[0],
        "server_address": row[1],
        "server_port": int(row[2]) if row[2] is not None else None,
        "system_identifier": str(row[3]) if row[3] is not None else None,
        "database_oid": int(row[4]) if row[4] is not None else None,
        "url_host": url_meta["host"],
        "is_local_host": url_meta["is_local_host"],
    }
    missing = [f for f in MANDATORY_SQL_IDENTITY_FIELDS if not identity.get(f)]
    if missing:
        raise TargetVerificationError(
            f"Direct PostgreSQL identity missing mandatory fields: {missing}."
        )
    return identity


def verify_api_and_db_target(
    api_base_url: str,
    database_url: str | None,
    *,
    allow_remote: bool = False,
    health_payload: dict[str, Any] | None = None,
    direct_db_identity: dict[str, Any] | None = None,
    timeout_s: int = 10,
) -> dict[str, Any]:
    """
    Verify that the NestJS API and Python process connect to the exact same
    PostgreSQL cluster and database instance, using SQL-derived identity fields.

    Fails closed with TargetVerificationError on any missing field, mismatch,
    remote target (unless allow_remote=True), or unreachable API/DB.
    """
    if not allow_remote and not _is_local_api_host(api_base_url):
        raise TargetVerificationError(f"API target {api_base_url!r} is not a local loopback host.")

    if not database_url:
        raise TargetVerificationError(
            "DATABASE_URL is required to verify database target identity."
        )
    url_meta = parse_safe_db_identity(database_url)
    if not allow_remote and not url_meta["is_local_host"]:
        raise TargetVerificationError(
            f"Database host {url_meta['host']!r} is not a recognized local host."
        )

    if health_payload is None:
        health_url = f"{api_base_url.rstrip('/')}/api/health"
        req = urllib.request.Request(health_url, method="GET")  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:  # noqa: S310
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

    # Require ALL mandatory SQL identity fields from API /api/health
    api_identity = {
        "database_name": api_db.get("databaseName"),
        "server_address": api_db.get("serverAddress"),
        "server_port": api_db.get("port"),
        "system_identifier": api_db.get("systemIdentifier"),
        "database_oid": api_db.get("databaseOid"),
    }
    missing_api = [f for f in MANDATORY_SQL_IDENTITY_FIELDS if not api_identity.get(f)]
    if missing_api:
        raise TargetVerificationError(
            f"API /api/health missing mandatory SQL identity fields: {missing_api}. "
            "Cannot verify database instance parity."
        )

    # Independently query Python's direct PostgreSQL connection
    sql_identity = (
        direct_db_identity
        if direct_db_identity is not None
        else fetch_sql_db_identity(database_url)
    )
    missing_sql = [f for f in MANDATORY_SQL_IDENTITY_FIELDS if not sql_identity.get(f)]
    if missing_sql:
        raise TargetVerificationError(
            f"Direct PostgreSQL identity missing mandatory fields: {missing_sql}."
        )

    if not allow_remote and not _is_local_server_ip(sql_identity.get("server_address")):
        raise TargetVerificationError(
            f"PostgreSQL serverAddress {sql_identity.get('server_address')!r} "
            "is not a local/private address."
        )

    # Compare every mandatory SQL identity field between API and Python
    mismatches: list[str] = []
    if str(api_identity["database_name"]) != str(sql_identity["database_name"]):
        mismatches.append(
            f"database_name (API={api_identity['database_name']!r}, "
            f"Python={sql_identity['database_name']!r})"
        )
    if int(api_identity["server_port"]) != int(sql_identity["server_port"]):
        mismatches.append(
            f"server_port (API={api_identity['server_port']}, Python={sql_identity['server_port']})"
        )
    if str(api_identity["server_address"]) != str(sql_identity["server_address"]):
        mismatches.append(
            f"server_address (API={api_identity['server_address']!r}, "
            f"Python={sql_identity['server_address']!r})"
        )
    if str(api_identity["system_identifier"]) != str(sql_identity["system_identifier"]):
        mismatches.append(
            f"system_identifier (API={api_identity['system_identifier']!r}, "
            f"Python={sql_identity['system_identifier']!r})"
        )
    if int(api_identity["database_oid"]) != int(sql_identity["database_oid"]):
        mismatches.append(
            f"database_oid (API={api_identity['database_oid']}, "
            f"Python={sql_identity['database_oid']})"
        )

    if mismatches:
        raise TargetVerificationError(
            "API and Python target different PostgreSQL instances: " + "; ".join(mismatches)
        )

    return {
        "verified": True,
        "api_url": api_base_url.rstrip("/"),
        "database_name": sql_identity["database_name"],
        "server_address": sql_identity["server_address"],
        "server_port": int(sql_identity["server_port"]),
        "system_identifier": str(sql_identity["system_identifier"]),
        "database_oid": int(sql_identity["database_oid"]),
    }


# ---------------------------------------------------------------------------
# Objective A: Deterministic Content-Integrity Fingerprinting
# ---------------------------------------------------------------------------
def canonicalize_value(val: Any) -> dict[str, Any]:
    """
    Deterministically canonicalize a database column value for hashing.
    Handles None, bool, int, Decimal, float, datetime (UTC), date, UUID, str, JSON.
    """
    if val is None:
        return {"t": "null"}
    if isinstance(val, bool):
        return {"t": "bool", "v": val}
    if isinstance(val, int):
        return {"t": "int", "v": val}
    if isinstance(val, Decimal):
        normalized = val.normalize()
        return {"t": "dec", "v": format(normalized, "f")}
    if isinstance(val, float):
        return {"t": "dec", "v": format(Decimal(str(val)).normalize(), "f")}
    if isinstance(val, datetime):
        dt = val.astimezone(UTC) if val.tzinfo is not None else val.replace(tzinfo=UTC)
        return {"t": "dt", "v": dt.isoformat()}
    if isinstance(val, date):
        return {"t": "date", "v": val.isoformat()}
    if isinstance(val, UUID):
        return {"t": "uuid", "v": str(val).lower()}
    if isinstance(val, (dict, list)):
        return {
            "t": "json",
            "v": json.dumps(val, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
        }
    return {"t": "str", "v": str(val)}


def compute_table_fingerprint(
    table: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
) -> dict[str, Any]:
    """
    Compute an order-independent SHA-256 content-integrity fingerprint for a table.
    Binds table name, column list, row count, and sorted per-row hashes.
    Never returns or stores raw row values.
    """
    col_list = list(columns)
    row_hashes: list[str] = []
    for row in rows:
        if len(row) != len(col_list):
            raise PersonalDataIntegrityError(
                f"Row width mismatch for table {table!r}: expected {len(col_list)}, got {len(row)}."
            )
        canonical_row = {
            "table": table,
            "columns": col_list,
            "values": [canonicalize_value(v) for v in row],
        }
        row_bytes = json.dumps(
            canonical_row, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        row_hashes.append(hashlib.sha256(row_bytes).hexdigest())

    row_hashes.sort()
    table_payload = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "table": table,
        "columns": col_list,
        "row_count": len(row_hashes),
        "row_hashes": row_hashes,
    }
    table_bytes = json.dumps(
        table_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return {
        "fingerprint": hashlib.sha256(table_bytes).hexdigest(),
        "columns": col_list,
        "row_count": len(row_hashes),
    }


@dataclass
class PersonalDataSnapshot:
    schema_version: str = SNAPSHOT_SCHEMA_VERSION
    captured_at: str = ""
    database_identity: dict[str, Any] = field(default_factory=dict)
    row_counts: dict[str, int] = field(default_factory=dict)
    table_fingerprints: dict[str, dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "captured_at": self.captured_at,
            "database_identity": self.database_identity,
            "row_counts": dict(self.row_counts),
            "table_fingerprints": dict(self.table_fingerprints),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PersonalDataSnapshot:
        return cls(
            schema_version=str(data.get("schema_version", SNAPSHOT_SCHEMA_VERSION)),
            captured_at=str(data.get("captured_at", "")),
            database_identity=dict(data.get("database_identity") or {}),
            row_counts={str(k): int(v) for k, v in (data.get("row_counts") or {}).items()},
            table_fingerprints={
                str(k): dict(v) for k, v in (data.get("table_fingerprints") or {}).items()
            },
        )


@dataclass
class SnapshotComparisonResult:
    passed: bool
    row_count_passed: bool
    fingerprint_passed: bool
    identity_passed: bool
    pre_captured_at: str
    post_captured_at: str
    deltas: dict[str, dict[str, Any]] = field(default_factory=dict)
    changed_tables: list[str] = field(default_factory=list)
    fingerprint_mismatches: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "row_count_passed": self.row_count_passed,
            "fingerprint_passed": self.fingerprint_passed,
            "identity_passed": self.identity_passed,
            "pre_captured_at": self.pre_captured_at,
            "post_captured_at": self.post_captured_at,
            "changed_tables": self.changed_tables,
            "fingerprint_mismatches": self.fingerprint_mismatches,
            "errors": self.errors,
            "deltas": self.deltas,
        }


def open_snapshot_connection(database_url: str) -> Any:
    """
    Open a single PostgreSQL connection configured with ``REPEATABLE READ``
    isolation, ``READ ONLY`` mode, and ``autocommit=False`` via psycopg2's
    native ``set_session()`` API before any query executes.
    """
    if psycopg2 is None:
        raise ImportError("psycopg2 is required to capture personal-data snapshots.")

    clean_url = strip_prisma_schema_param(database_url)
    conn = None
    try:
        conn = psycopg2.connect(clean_url)
        conn.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
        return conn
    except Exception as exc:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        safe_msg = _redact_url_credentials(str(exc), database_url)
        raise PersonalDataIntegrityError(
            f"Failed to open PostgreSQL connection for personal snapshot: {safe_msg}"
        ) from exc


def capture_personal_snapshot(
    database_url: str,
    *,
    _after_identity_hook: Callable[[Any], None] | None = None,
) -> PersonalDataSnapshot:
    """
    Capture read-only row counts, content-integrity fingerprints, and SQL
    instance identity for all personal/configuration tables using a single
    PostgreSQL connection and a consistent ``REPEATABLE READ READ ONLY``
    transaction snapshot.

    Design (B.2-D / B.2-E):
    - One connection is opened via ``open_snapshot_connection()`` with
      ``set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)``
      before any query executes.
    - Psycopg2 starts the transaction with ``REPEATABLE READ`` and ``READ ONLY``
      on the first statement (no redundant ``BEGIN`` after an implicit ``BEGIN``).
    - The database identity fields are queried first through this same
      connection and transaction, establishing the consistent snapshot and
      binding identity to the exact connection that reads all six tables.
    - All six personal/configuration tables are read within that same
      transaction.
    - The connection is always rolled back and closed in ``finally`` on both
      success and failure.

    Never persists personal row values or credentials.
    """
    if psycopg2 is None:
        raise ImportError("psycopg2 is required to capture personal-data snapshots.")

    conn = open_snapshot_connection(database_url)

    try:
        # Single consistent snapshot: set_session(REPEATABLE READ, readonly=True)
        # ensures the first statement starts the transaction with those exact modes.
        with conn.cursor() as cur:
            # --- Query SQL instance identity through this same connection ---
            cur.execute(
                """
                SELECT
                    current_database() AS database_name,
                    CAST(inet_server_addr() AS TEXT) AS server_address,
                    inet_server_port() AS server_port,
                    (SELECT system_identifier::TEXT FROM pg_control_system())
                        AS system_identifier,
                    (SELECT oid::INT FROM pg_database WHERE datname = current_database())
                        AS database_oid
                """
            )
            identity_row = cur.fetchone()

        if _after_identity_hook is not None:
            _after_identity_hook(conn)

        if not identity_row:
            raise PersonalDataIntegrityError(
                "PostgreSQL instance identity query returned no rows (fail-closed)."
            )

        raw_identity: dict[str, Any] = {
            "database_name": identity_row[0],
            "server_address": identity_row[1],
            "server_port": int(identity_row[2]) if identity_row[2] is not None else None,
            "system_identifier": str(identity_row[3]) if identity_row[3] is not None else None,
            "database_oid": int(identity_row[4]) if identity_row[4] is not None else None,
        }
        missing = [f for f in MANDATORY_SQL_IDENTITY_FIELDS if not raw_identity.get(f)]
        if missing:
            raise PersonalDataIntegrityError(
                f"Snapshot identity query missing mandatory fields: {missing} (fail-closed)."
            )

        # Enrich with URL-derived non-secret metadata (host/is_local_host)
        url_meta = parse_safe_db_identity(database_url)
        db_identity: dict[str, Any] = {
            **raw_identity,
            "url_host": url_meta["host"],
            "is_local_host": url_meta["is_local_host"],
        }

        # --- Read all six personal/configuration tables in the same transaction ---
        row_counts: dict[str, int] = {}
        table_fingerprints: dict[str, dict[str, Any]] = {}
        with conn.cursor() as cur:
            for table, columns in PERSONAL_TABLE_COLUMNS.items():
                col_sql = ", ".join(f'"{c}"' for c in columns)
                cur.execute(f'SELECT {col_sql} FROM "{table}";')  # noqa: S608
                rows = cur.fetchall()
                fp_info = compute_table_fingerprint(table, columns, rows)
                row_counts[table] = fp_info["row_count"]
                table_fingerprints[table] = fp_info

        conn.rollback()  # Read-only: nothing to commit; explicit rollback is clean.
    except (PersonalDataIntegrityError, TargetVerificationError):
        raise
    except Exception as exc:
        safe_msg = _redact_url_credentials(str(exc), database_url)
        raise PersonalDataIntegrityError(f"Personal snapshot capture failed: {safe_msg}") from exc
    finally:
        conn.close()

    return PersonalDataSnapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        captured_at=datetime.now(UTC).isoformat(),
        database_identity=db_identity,
        row_counts=row_counts,
        table_fingerprints=table_fingerprints,
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
    Fails closed if database instance identity, row counts, content fingerprints,
    or expected column sets are missing or mismatched.
    """
    errors: list[str] = []
    changed_tables: list[str] = []
    fingerprint_mismatches: list[str] = []
    deltas: dict[str, dict[str, Any]] = {}

    # 1. Verify mandatory SQL database instance identity
    identity_passed = True
    for field_name in MANDATORY_SQL_IDENTITY_FIELDS:
        pre_val = pre.database_identity.get(field_name)
        post_val = post.database_identity.get(field_name)
        if not pre_val or not post_val:
            identity_passed = False
            errors.append(
                f"Snapshot missing mandatory database identity field {field_name!r} "
                f"(pre={pre_val!r}, post={post_val!r})."
            )
        elif str(pre_val) != str(post_val):
            identity_passed = False
            errors.append(
                f"Snapshot database identity mismatch for {field_name!r}: "
                f"pre={pre_val!r}, post={post_val!r}."
            )

    # 2. Verify row counts & content fingerprints for all 6 tables
    row_count_passed = True
    fingerprint_passed = True

    for table, expected_cols in PERSONAL_TABLE_COLUMNS.items():
        if table not in pre.row_counts or table not in post.row_counts:
            row_count_passed = False
            errors.append(f"Missing row count for required personal table {table!r}.")
            continue
        if table not in pre.table_fingerprints or table not in post.table_fingerprints:
            fingerprint_passed = False
            errors.append(f"Missing content fingerprint for required personal table {table!r}.")
            continue

        before = pre.row_counts[table]
        after = post.row_counts[table]
        delta = after - before

        pre_fp = pre.table_fingerprints[table]
        post_fp = post.table_fingerprints[table]

        pre_cols = tuple(pre_fp.get("columns") or ())
        post_cols = tuple(post_fp.get("columns") or ())
        if pre_cols != expected_cols or post_cols != expected_cols:
            fingerprint_passed = False
            errors.append(
                f"Column set mismatch for table {table!r}: "
                f"expected={list(expected_cols)}, pre={list(pre_cols)}, post={list(post_cols)}."
            )

        pre_hash = pre_fp.get("fingerprint")
        post_hash = post_fp.get("fingerprint")
        if not pre_hash or not post_hash:
            fingerprint_passed = False
            errors.append(f"Empty content fingerprint hash for table {table!r}.")
        elif pre_hash != post_hash:
            fingerprint_passed = False
            fingerprint_mismatches.append(table)
            errors.append(
                f"Content fingerprint mismatch for personal table {table!r} "
                f"(pre={str(pre_hash)[:12]}…, post={str(post_hash)[:12]}…)."
            )

        if delta != 0:
            row_count_passed = False
            changed_tables.append(table)
            errors.append(
                f"Personal table {table!r} row count changed: "
                f"pre={before}, post={after}, delta={delta:+d}."
            )

        deltas[table] = {
            "pre": before,
            "post": after,
            "delta": delta,
            "fingerprint_match": bool(pre_hash and post_hash and pre_hash == post_hash),
        }

    passed = identity_passed and row_count_passed and fingerprint_passed and len(errors) == 0
    return SnapshotComparisonResult(
        passed=passed,
        row_count_passed=row_count_passed,
        fingerprint_passed=fingerprint_passed,
        identity_passed=identity_passed,
        pre_captured_at=pre.captured_at,
        post_captured_at=post.captured_at,
        deltas=deltas,
        changed_tables=changed_tables,
        fingerprint_mismatches=fingerprint_mismatches,
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
            "Personal data verification PASSED: row counts and content fingerprints "
            "unchanged across %d tables.",
            len(PERSONAL_DATA_TABLES),
        )
        return 0

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
        "Personal data verification PASSED: row counts and content fingerprints "
        "unchanged across %d tables.",
        len(PERSONAL_DATA_TABLES),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
