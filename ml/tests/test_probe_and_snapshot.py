"""
Tests for run_probe_ingestion.py and verify_personal_data_snapshot.py.

All tests use mocks or disposable temporary directories.
No real catalogue writes or live TMDB requests are performed.
"""

from __future__ import annotations

import json
import os
import pathlib
import urllib.error
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from ml.benchmark.scripts.prepare_catalogue_fixture import InvalidProbeDefinitionError
from ml.benchmark.scripts.run_probe_ingestion import (
    _PROBES_PATH,
    ProbeCheckpoint,
    ProbeCheckpointError,
    ProbeIngestResult,
    ProbeSpec,
    ProbeValidationError,
    assert_authorized_probe,
    compute_probes_digest,
    ingest_probe,
    load_and_validate_probes,
    load_probe_checkpoint,
    run_probe_ingestion,
)
from ml.benchmark.scripts.run_probe_ingestion import (
    main as probe_main,
)
from ml.benchmark.scripts.verify_personal_data_snapshot import (
    PERSONAL_DATA_TABLES,
    PERSONAL_TABLE_COLUMNS,
    PersonalDataIntegrityError,
    PersonalDataSnapshot,
    TargetVerificationError,
    capture_personal_snapshot,
    compare_personal_snapshots,
    compute_table_fingerprint,
    fetch_sql_db_identity,
    open_snapshot_connection,
    parse_safe_db_identity,
    save_snapshot_atomic,
    strip_prisma_schema_param,
    verify_api_and_db_target,
)
from ml.benchmark.scripts.verify_personal_data_snapshot import (
    main as snapshot_main,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _make_probe(
    probe_id: str = "PB-01",
    media_type: str = "MOVIE",
    tmdb_id: int = 27205,
    title: str = "Inception",
    stratum: str = "Mainstream",
) -> ProbeSpec:
    return ProbeSpec(
        probe_id=probe_id,
        media_type=media_type,
        tmdb_id=tmdb_id,
        title=title,
        stratum=stratum,
    )


def _sample_sql_identity(
    *,
    database_name: str = "cinesphere",
    server_address: str = "172.20.0.2/32",
    server_port: int = 5432,
    system_identifier: str = "7704763478273589286",
    database_oid: int = 16384,
) -> dict[str, Any]:
    return {
        "database_name": database_name,
        "server_address": server_address,
        "server_port": server_port,
        "system_identifier": system_identifier,
        "database_oid": database_oid,
        "url_host": "localhost",
        "is_local_host": True,
    }


def _sample_health_payload(
    *,
    database_name: str = "cinesphere",
    server_address: str = "172.20.0.2/32",
    port: int = 5432,
    system_identifier: str = "7704763478273589286",
    database_oid: int = 16384,
) -> dict[str, Any]:
    return {
        "status": "ok",
        "database": {
            "connected": True,
            "databaseName": database_name,
            "host": "localhost",
            "port": port,
            "serverAddress": server_address,
            "systemIdentifier": system_identifier,
            "databaseOid": database_oid,
        },
    }


def _build_full_snapshot(
    *,
    identity: dict[str, Any] | None = None,
    row_overrides: dict[str, list[tuple[Any, ...]]] | None = None,
) -> PersonalDataSnapshot:
    ident = identity or _sample_sql_identity()
    row_counts: dict[str, int] = {}
    table_fingerprints: dict[str, dict[str, Any]] = {}
    overrides = row_overrides or {}

    for tbl, cols in PERSONAL_TABLE_COLUMNS.items():
        if tbl in overrides:
            rows = overrides[tbl]
        elif tbl == "users":
            rows = [
                (
                    "u1",
                    "CineSphere User",
                    datetime(2026, 1, 1, tzinfo=UTC),
                    datetime(2026, 1, 1, tzinfo=UTC),
                )
            ]
        elif tbl == "system_configs":
            rows = [("theme", "dark", datetime(2026, 1, 1, tzinfo=UTC))]
        else:
            rows = []
        fp = compute_table_fingerprint(tbl, cols, rows)
        row_counts[tbl] = fp["row_count"]
        table_fingerprints[tbl] = fp

    return PersonalDataSnapshot(
        captured_at="2026-11-25T00:00:00Z",
        database_identity=ident,
        row_counts=row_counts,
        table_fingerprints=table_fingerprints,
    )


class _FakeHttpResp:
    def __init__(self, payload: dict[str, Any], status: int = 200) -> None:
        self._bytes = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._bytes

    def __enter__(self) -> _FakeHttpResp:
        return self

    def __exit__(self, *args: object) -> None:
        return None


# ===========================================================================
# Tests: Probe Ingestion Workflow (Step 2)
# ===========================================================================
class TestProbeIngestionWorkflow:
    def test_load_authoritative_probes_50_total(self) -> None:
        probes = load_and_validate_probes(_PROBES_PATH)
        assert len(probes) == 50
        assert sum(1 for p in probes if p.media_type == "MOVIE") == 38
        assert sum(1 for p in probes if p.media_type == "TV") == 12

    def test_load_probes_rejects_wrong_count(self, tmp_path: pathlib.Path) -> None:
        bad = [
            {
                "probe_id": "PB-01",
                "media_type": "MOVIE",
                "tmdb_id": 27205,
                "title": "Inception",
                "stratum": "Mainstream",
            }
        ]
        p = tmp_path / "probes.json"
        p.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(ProbeValidationError, match="Expected 50 probes"):
            load_and_validate_probes(p)

    def test_load_probes_rejects_invalid_media_type(self, tmp_path: pathlib.Path) -> None:
        bad = [
            {
                "probe_id": "PB-01",
                "media_type": "ANIME",
                "tmdb_id": 27205,
                "title": "Inception",
                "stratum": "Mainstream",
            }
        ]
        p = tmp_path / "probes.json"
        p.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(ProbeValidationError, match="invalid media_type"):
            load_and_validate_probes(p)

    def test_load_probes_rejects_duplicate_identity(self, tmp_path: pathlib.Path) -> None:
        bad = [
            {
                "probe_id": "PB-01",
                "media_type": "MOVIE",
                "tmdb_id": 27205,
                "title": "Inception",
                "stratum": "Mainstream",
            },
            {
                "probe_id": "PB-02",
                "media_type": "MOVIE",
                "tmdb_id": 27205,
                "title": "Inception Duplicate",
                "stratum": "Mainstream",
            },
        ]
        p = tmp_path / "probes.json"
        p.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(InvalidProbeDefinitionError, match="Duplicate probe composite identity"):
            load_and_validate_probes(p)

    def test_assert_authorized_probe_rejects_arbitrary_id(self) -> None:
        auth = {"PB-01": _make_probe()}
        with pytest.raises(ProbeValidationError, match="Unauthorized probe_id"):
            assert_authorized_probe(_make_probe(probe_id="PB-999", tmdb_id=99999), auth)

    def test_assert_authorized_probe_rejects_wrong_media_type(self) -> None:
        auth = {"PB-01": _make_probe()}
        with pytest.raises(ProbeValidationError, match="Unauthorized probe target"):
            assert_authorized_probe(_make_probe(media_type="TV"), auth)

    def test_ingest_probe_pb45_twin_peaks_alias_accepted(self) -> None:
        pb45 = _make_probe(
            probe_id="PB-45",
            media_type="TV",
            tmdb_id=1920,
            title="Twin Peaks: The Return",
            stratum="Stress Cases",
        )
        with patch(
            "urllib.request.urlopen",
            return_value=_FakeHttpResp({"tmdbId": 1920, "name": "Twin Peaks", "isPartial": False}),
        ):
            res = ingest_probe("http://localhost:4000", pb45)
        assert res.success is True
        assert res.identity_verified is True
        assert res.is_partial is False

    def test_ingest_probe_identity_mismatch_rejected(self) -> None:
        pb27 = _make_probe(
            probe_id="PB-27",
            media_type="MOVIE",
            tmdb_id=334541,
            title="Manchester by the Sea",
            stratum="Indie",
        )
        with patch(
            "urllib.request.urlopen",
            return_value=_FakeHttpResp({"tmdbId": 334541, "title": "Wrong Movie Title"}),
        ):
            res = ingest_probe("http://localhost:4000", pb27)
        assert res.success is False
        assert res.identity_verified is False
        assert "identity mismatch" in (res.error_message or "").lower()

    def test_ingest_probe_partial_tv_flagged(self) -> None:
        pb40 = _make_probe(
            probe_id="PB-40",
            media_type="TV",
            tmdb_id=1438,
            title="The Wire",
            stratum="Serialized TV",
        )
        with patch(
            "urllib.request.urlopen",
            return_value=_FakeHttpResp({"tmdbId": 1438, "name": "The Wire", "isPartial": True}),
        ):
            res = ingest_probe("http://localhost:4000", pb40)
        assert res.success is True
        assert res.is_partial is True

    def test_run_probe_ingestion_resumable_and_partial_retry(self, tmp_path: pathlib.Path) -> None:
        probes = [
            _make_probe("PB-01", "MOVIE", 27205, "Inception", "Mainstream"),
            _make_probe("PB-40", "TV", 1438, "The Wire", "Serialized TV"),
        ]
        cp_path = tmp_path / "probe_cp.json"
        digest = compute_probes_digest(probes)
        cp = ProbeCheckpoint(probes_digest=digest, api_base_url="http://localhost:4000")
        cp.completed_probe_ids = ["PB-01"]
        cp.partial_tv_probe_ids = ["PB-40"]

        called: list[str] = []

        def fake_ingest(url: str, probe: ProbeSpec) -> ProbeIngestResult:
            called.append(probe.probe_id)
            return ProbeIngestResult(
                probe_id=probe.probe_id,
                tmdb_id=probe.tmdb_id,
                media_type=probe.media_type,
                success=True,
                is_partial=False,
                identity_verified=True,
                returned_title=probe.title,
            )

        with (
            patch("ml.benchmark.scripts.run_probe_ingestion.ingest_probe", side_effect=fake_ingest),
            patch("ml.benchmark.scripts.run_probe_ingestion.INTER_ITEM_DELAY_S", 0),
        ):
            summary = run_probe_ingestion(probes, cp, cp_path, "http://localhost:4000")

        assert called == ["PB-40"]
        assert summary.success is True
        assert summary.completed_count == 2
        assert summary.partial_tv_count == 0
        assert summary.unresolved_count == 0

    def test_run_probe_ingestion_exhausted_attempts_skipped_and_fails(
        self, tmp_path: pathlib.Path
    ) -> None:
        probes = [_make_probe("PB-01", "MOVIE", 27205, "Inception", "Mainstream")]
        cp_path = tmp_path / "probe_cp.json"
        cp = ProbeCheckpoint(
            probes_digest=compute_probes_digest(probes),
            api_base_url="http://localhost:4000",
        )
        cp.attempt_counts["PB-01"] = 3

        with patch("ml.benchmark.scripts.run_probe_ingestion.INTER_ITEM_DELAY_S", 0):
            summary = run_probe_ingestion(probes, cp, cp_path, "http://localhost:4000")

        assert summary.success is False
        assert summary.skipped_count == 1
        assert summary.unresolved_count == 1

    def test_probe_checkpoint_digest_mismatch_raises(self, tmp_path: pathlib.Path) -> None:
        cp_path = tmp_path / "probe_cp.json"
        cp = ProbeCheckpoint(probes_digest="old", api_base_url="http://localhost:4000")
        cp_path.write_text(json.dumps(cp.to_dict()), encoding="utf-8")
        with pytest.raises(ProbeCheckpointError, match="digest mismatch"):
            load_probe_checkpoint(cp_path, "new", "http://localhost:4000")

    def test_probe_main_dry_run_default_returns_0(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            rc = probe_main(["--probes", str(_PROBES_PATH)])
        assert rc == 0

    def test_probe_main_execute_without_env_returns_2(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            rc = probe_main(["--execute", "--probes", str(_PROBES_PATH)])
        assert rc == 2


# ===========================================================================
# Tests: Personal Data Content-Integrity Fingerprints (Objective A)
# ===========================================================================
class TestPersonalDataFingerprints:
    def test_identical_contents_produce_identical_fingerprints(self) -> None:
        cols = ("id", "library_entry_id", "watched_at", "rating", "notes")
        dt = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
        rows_a = [("ev1", "le1", dt, Decimal("8.50"), "Great")]
        rows_b = [("ev1", "le1", dt.astimezone(UTC), Decimal("8.5"), "Great")]
        fp_a = compute_table_fingerprint("viewing_events", cols, rows_a)
        fp_b = compute_table_fingerprint("viewing_events", cols, rows_b)
        assert fp_a["fingerprint"] == fp_b["fingerprint"]

    def test_row_ordering_does_not_affect_fingerprint(self) -> None:
        cols = ("key", "value", "updatedAt")
        dt = datetime(2026, 1, 1, tzinfo=UTC)
        rows_a = [("k1", "v1", dt), ("k2", "v2", dt)]
        rows_b = [("k2", "v2", dt), ("k1", "v1", dt)]
        assert (
            compute_table_fingerprint("system_configs", cols, rows_a)["fingerprint"]
            == compute_table_fingerprint("system_configs", cols, rows_b)["fingerprint"]
        )

    def test_cross_table_isolation_prevents_identical_row_collision(self) -> None:
        cols = ("a", "b")
        rows = [("x", "y")]
        fp_a = compute_table_fingerprint("users", cols, rows)["fingerprint"]
        fp_b = compute_table_fingerprint("system_configs", cols, rows)["fingerprint"]
        assert fp_a != fp_b

    def test_update_preserving_row_count_detected(self) -> None:
        pre = _build_full_snapshot()
        post = _build_full_snapshot(
            row_overrides={
                "users": [
                    (
                        "u1",
                        "Modified User Name",
                        datetime(2026, 1, 1, tzinfo=UTC),
                        datetime(2026, 1, 1, tzinfo=UTC),
                    )
                ]
            }
        )
        res = compare_personal_snapshots(pre, post)
        assert res.row_count_passed is True
        assert res.fingerprint_passed is False
        assert res.passed is False
        assert res.changed_tables == []
        assert res.fingerprint_mismatches == ["users"]

    def test_delete_then_insert_preserving_row_count_detected(self) -> None:
        pre = _build_full_snapshot(
            row_overrides={"system_configs": [("k1", "v1", datetime(2026, 1, 1, tzinfo=UTC))]}
        )
        post = _build_full_snapshot(
            row_overrides={"system_configs": [("k2", "v1", datetime(2026, 1, 1, tzinfo=UTC))]}
        )
        res = compare_personal_snapshots(pre, post)
        assert res.row_count_passed is True
        assert res.fingerprint_passed is False
        assert res.passed is False
        assert res.fingerprint_mismatches == ["system_configs"]

    def test_missing_fingerprint_metadata_fails_closed(self) -> None:
        pre = _build_full_snapshot()
        post = _build_full_snapshot()
        del post.table_fingerprints["users"]
        res = compare_personal_snapshots(pre, post)
        assert res.fingerprint_passed is False
        assert res.passed is False

    def test_missing_required_table_row_count_fails_closed(self) -> None:
        pre = _build_full_snapshot()
        post = _build_full_snapshot()
        del post.row_counts["episode_progress"]
        res = compare_personal_snapshots(pre, post)
        assert res.row_count_passed is False
        assert res.passed is False

    def test_column_set_mismatch_fails_closed(self) -> None:
        pre = _build_full_snapshot()
        post = _build_full_snapshot()
        post.table_fingerprints["users"]["columns"] = ["id", "displayName"]
        res = compare_personal_snapshots(pre, post)
        assert res.fingerprint_passed is False
        assert res.passed is False

    def test_different_database_identity_fails_closed(self) -> None:
        pre = _build_full_snapshot(identity=_sample_sql_identity(system_identifier="111"))
        post = _build_full_snapshot(identity=_sample_sql_identity(system_identifier="222"))
        res = compare_personal_snapshots(pre, post)
        assert res.identity_passed is False
        assert res.passed is False

    def test_snapshot_artifact_never_persists_raw_personal_data(
        self, tmp_path: pathlib.Path
    ) -> None:
        snap = _build_full_snapshot(
            row_overrides={
                "users": [
                    (
                        "u1",
                        "SecretPersonalDisplayName123",
                        datetime(2026, 1, 1, tzinfo=UTC),
                        datetime(2026, 1, 1, tzinfo=UTC),
                    )
                ]
            }
        )
        path = tmp_path / "snap.json"
        save_snapshot_atomic(snap, path)
        raw_text = path.read_text(encoding="utf-8")
        assert "SecretPersonalDisplayName123" not in raw_text

    def test_capture_personal_snapshot_uses_single_connection(self) -> None:
        """B.2-D: identity and all table reads share one connection (call_count == 1)."""
        mock_cursor = MagicMock()
        # fetchone() is called once for the identity query.
        mock_cursor.fetchone.return_value = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        )
        # fetchall() is called once per personal table (6 tables).
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ) as mock_connect:
            snap = capture_personal_snapshot(
                "postgresql://user:pw@localhost:5432/cinesphere?schema=public"
            )

        # B.2-D invariant: exactly ONE connection opened.
        assert mock_connect.call_count == 1
        assert len(snap.row_counts) == len(PERSONAL_DATA_TABLES)
        assert len(snap.table_fingerprints) == len(PERSONAL_DATA_TABLES)

    def test_snapshot_cli_verify_mode_exit_codes(self, tmp_path: pathlib.Path) -> None:
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        report_path = tmp_path / "report.json"

        save_snapshot_atomic(_build_full_snapshot(), pre_path)
        save_snapshot_atomic(_build_full_snapshot(), post_path)
        rc_pass = snapshot_main(
            [
                "--mode",
                "verify",
                "--pre-snapshot",
                str(pre_path),
                "--post-snapshot",
                str(post_path),
                "--report-output",
                str(report_path),
            ]
        )
        assert rc_pass == 0
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert report["passed"] is True
        assert report["row_count_passed"] is True
        assert report["fingerprint_passed"] is True
        assert report["identity_passed"] is True

        # Now mutate a user row without changing row count and verify exit code 1
        mutated = _build_full_snapshot(
            row_overrides={
                "users": [
                    (
                        "u1",
                        "Tampered Name",
                        datetime(2026, 1, 1, tzinfo=UTC),
                        datetime(2026, 1, 1, tzinfo=UTC),
                    )
                ]
            }
        )
        save_snapshot_atomic(mutated, post_path)
        rc_fail = snapshot_main(
            [
                "--mode",
                "verify",
                "--pre-snapshot",
                str(pre_path),
                "--post-snapshot",
                str(post_path),
            ]
        )
        assert rc_fail == 1


# ===========================================================================
# Tests: SQL Database Instance & Target Verification (Objective B)
# ===========================================================================
class TestDatabaseInstanceTargetVerification:
    def test_strip_prisma_schema_param(self) -> None:
        url = "postgresql://user:pass@localhost:5432/cinesphere?schema=public"
        assert strip_prisma_schema_param(url) == "postgresql://user:pass@localhost:5432/cinesphere"

    def test_parse_safe_db_identity_redacts_credentials(self) -> None:
        url = "postgresql://secret_user:super_secret_pw@localhost:5432/cinesphere?schema=public"
        ident = parse_safe_db_identity(url)
        serialized = json.dumps(ident)
        assert "secret_user" not in serialized
        assert "super_secret_pw" not in serialized

    def test_exact_sql_identity_match_passes(self) -> None:
        res = verify_api_and_db_target(
            "http://localhost:4000",
            "postgresql://u:p@localhost:5432/cinesphere?schema=public",
            health_payload=_sample_health_payload(),
            direct_db_identity=_sample_sql_identity(),
        )
        assert res["verified"] is True
        assert res["system_identifier"] == "7704763478273589286"
        assert res["database_oid"] == 16384

    def test_different_database_names_rejected(self) -> None:
        with pytest.raises(TargetVerificationError, match="database_name"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=_sample_health_payload(database_name="cinesphere_other"),
                direct_db_identity=_sample_sql_identity(database_name="cinesphere"),
            )

    def test_same_name_and_port_different_system_identifier_rejected(self) -> None:
        with pytest.raises(TargetVerificationError, match="system_identifier"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=_sample_health_payload(system_identifier="1111111111111111111"),
                direct_db_identity=_sample_sql_identity(system_identifier="2222222222222222222"),
            )

    def test_different_server_address_rejected(self) -> None:
        with pytest.raises(TargetVerificationError, match="server_address"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=_sample_health_payload(server_address="127.0.0.1/32"),
                direct_db_identity=_sample_sql_identity(server_address="172.20.0.2/32"),
            )

    def test_missing_api_identity_fields_fails_closed(self) -> None:
        incomplete_health = _sample_health_payload()
        del incomplete_health["database"]["systemIdentifier"]
        with pytest.raises(TargetVerificationError, match="missing mandatory SQL identity"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=incomplete_health,
                direct_db_identity=_sample_sql_identity(),
            )

    def test_missing_direct_db_identity_fields_fails_closed(self) -> None:
        incomplete_direct = _sample_sql_identity()
        incomplete_direct["database_oid"] = None
        with pytest.raises(TargetVerificationError, match="Direct PostgreSQL identity missing"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=_sample_health_payload(),
                direct_db_identity=incomplete_direct,
            )

    def test_remote_api_target_rejected(self) -> None:
        with pytest.raises(TargetVerificationError, match="not a local loopback host"):
            verify_api_and_db_target(
                "https://api.example.com",
                "postgresql://u:p@localhost:5432/cinesphere",
                health_payload=_sample_health_payload(),
                direct_db_identity=_sample_sql_identity(),
            )

    def test_remote_db_target_rejected(self) -> None:
        with pytest.raises(TargetVerificationError, match="not a recognized local host"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@prod.db.example.com:5432/cinesphere",
                health_payload=_sample_health_payload(),
                direct_db_identity=_sample_sql_identity(),
            )

    def test_unreachable_api_fails_closed(self) -> None:
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError("connection refused"),
        ):
            with pytest.raises(TargetVerificationError, match="Failed to query API health"):
                verify_api_and_db_target(
                    "http://localhost:19999",
                    "postgresql://u:p@localhost:5432/cinesphere",
                    direct_db_identity=_sample_sql_identity(),
                )

    def test_unavailable_sql_identity_query_fails_closed_and_redacts_credentials(self) -> None:
        secret_url = (
            "postgresql://admin_user:TopSecretPass99@localhost:5432/cinesphere?schema=public"
        )
        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            side_effect=RuntimeError(f"auth failed for {secret_url}"),
        ):
            with pytest.raises(TargetVerificationError) as exc_info:
                fetch_sql_db_identity(secret_url)
        msg = str(exc_info.value)
        assert "TopSecretPass99" not in msg
        assert "admin_user" not in msg


# ===========================================================================
# Tests: Snapshot Connection Consistency (B.2-D)
# ===========================================================================
class TestSnapshotConnectionConsistency:
    """
    Adversarial tests verifying that capture_personal_snapshot() uses a single
    PostgreSQL connection and consistent REPEATABLE READ transaction for both
    the SQL identity query and all six personal-data table reads.
    """

    _DB_URL = "postgresql://user:pw@localhost:5432/cinesphere?schema=public"

    def _make_mock_conn(
        self,
        identity_row: tuple[Any, ...] | None = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        ),
        table_rows: list[Any] | None = None,
    ) -> MagicMock:
        """Build a mock psycopg2 connection whose cursor returns the given data."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = identity_row
        mock_cursor.fetchall.return_value = table_rows if table_rows is not None else []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        return mock_conn

    # ------------------------------------------------------------------
    # 1. Identity and all six table reads share exactly one connection
    # ------------------------------------------------------------------
    def test_single_connection_opened(self) -> None:
        mock_conn = self._make_mock_conn()
        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ) as mock_connect:
            snap = capture_personal_snapshot(self._DB_URL)
        assert mock_connect.call_count == 1, (
            "capture_personal_snapshot must open exactly one PostgreSQL connection."
        )
        assert snap.database_identity["database_name"] == "cinesphere"
        assert len(snap.row_counts) == len(PERSONAL_DATA_TABLES)
        assert len(snap.table_fingerprints) == len(PERSONAL_DATA_TABLES)

    # ------------------------------------------------------------------
    # 2. Identity query failure prevents snapshot creation (fail-closed)
    # ------------------------------------------------------------------
    def test_identity_query_failure_prevents_snapshot(self) -> None:
        """If the identity query returns no row, capture_personal_snapshot raises."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None  # Identity query returned nothing
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            with pytest.raises(PersonalDataIntegrityError, match="identity query returned no rows"):
                capture_personal_snapshot(self._DB_URL)

    # ------------------------------------------------------------------
    # 3. Table read failure prevents snapshot creation (fail-closed)
    # ------------------------------------------------------------------
    def test_table_read_failure_prevents_snapshot(self) -> None:
        """If a table SELECT raises, capture_personal_snapshot propagates the error."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        )
        # Raise on the first table fetchall call
        mock_cursor.fetchall.side_effect = RuntimeError("relation does not exist")
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            with pytest.raises((PersonalDataIntegrityError, RuntimeError)):
                capture_personal_snapshot(self._DB_URL)

    # ------------------------------------------------------------------
    # 4. REPEATABLE READ READ ONLY transaction is established via set_session
    # ------------------------------------------------------------------
    def test_repeatable_read_transaction_established(self) -> None:
        """set_session(REPEATABLE READ, readonly=True, autocommit=False) before queries."""
        executed_statements: list[str] = []

        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        )
        mock_cursor.fetchall.return_value = []

        def _record_execute(sql: str, *args: object, **kwargs: object) -> None:
            executed_statements.append(sql.strip())

        mock_cursor.execute.side_effect = _record_execute
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            capture_personal_snapshot(self._DB_URL)

        mock_conn.set_session.assert_called_once_with(
            isolation_level="REPEATABLE READ",
            readonly=True,
            autocommit=False,
        )
        # No redundant raw BEGIN should be sent after implicit transaction setup.
        begin_stmts = [s for s in executed_statements if s.upper().startswith("BEGIN")]
        assert begin_stmts == [], f"Unexpected redundant BEGIN statements: {begin_stmts}"

    # ------------------------------------------------------------------
    # 5. All six table SELECTs execute on the same connection/cursor
    # ------------------------------------------------------------------
    def test_all_tables_read_via_same_connection(self) -> None:
        """Every personal-table SELECT must go through the single connection."""
        executed_selects: list[str] = []

        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        )
        mock_cursor.fetchall.return_value = []

        def _record_execute(sql: str, *args: object, **kwargs: object) -> None:
            if "SELECT" in sql.upper() and "FROM" in sql.upper() and "current_database" not in sql:
                executed_selects.append(sql.strip())

        mock_cursor.execute.side_effect = _record_execute
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ) as mock_connect:
            capture_personal_snapshot(self._DB_URL)

        # B.2-D: single connection
        assert mock_connect.call_count == 1

        # Every personal table must have been SELECTed
        for table in PERSONAL_DATA_TABLES:
            matching = [s for s in executed_selects if f'"{table}"' in s]
            assert matching, f"Expected SELECT for table {table!r} but it was missing."

    # ------------------------------------------------------------------
    # 6. Connection closes on success
    # ------------------------------------------------------------------
    def test_connection_closes_on_success(self) -> None:
        mock_conn = self._make_mock_conn()
        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            capture_personal_snapshot(self._DB_URL)
        mock_conn.close.assert_called_once()

    # ------------------------------------------------------------------
    # 7. Connection closes on failure (identity error)
    # ------------------------------------------------------------------
    def test_connection_closes_on_identity_failure(self) -> None:
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None  # causes identity failure
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            with pytest.raises(PersonalDataIntegrityError):
                capture_personal_snapshot(self._DB_URL)

        mock_conn.close.assert_called_once()

    # ------------------------------------------------------------------
    # 8. Connection closes on failure (table-read error)
    # ------------------------------------------------------------------
    def test_connection_closes_on_table_read_failure(self) -> None:
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            "cinesphere",
            "172.20.0.2/32",
            5432,
            "7704763478273589286",
            16384,
        )
        mock_cursor.fetchall.side_effect = RuntimeError("disk I/O error")
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            with pytest.raises((PersonalDataIntegrityError, RuntimeError)):
                capture_personal_snapshot(self._DB_URL)

        mock_conn.close.assert_called_once()

    # ------------------------------------------------------------------
    # 9. Missing mandatory identity field fails closed (not silently skipped)
    # ------------------------------------------------------------------
    def test_missing_mandatory_identity_field_fails_closed(self) -> None:
        """system_identifier=None in identity row must raise, not produce a snapshot."""
        mock_cursor = MagicMock()
        # system_identifier is None — mandatory field missing
        mock_cursor.fetchone.return_value = ("cinesphere", "172.20.0.2/32", 5432, None, 16384)
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            with pytest.raises(PersonalDataIntegrityError, match="missing mandatory fields"):
                capture_personal_snapshot(self._DB_URL)

    # ------------------------------------------------------------------
    # 10. Credential redaction on connection failure
    # ------------------------------------------------------------------
    def test_connection_failure_redacts_credentials(self) -> None:
        secret_url = (
            "postgresql://secret_user:HighlySecretPW99@localhost:5432/cinesphere?schema=public"
        )
        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            side_effect=RuntimeError("auth failed: password HighlySecretPW99 for secret_user"),
        ):
            with pytest.raises(PersonalDataIntegrityError) as exc_info:
                capture_personal_snapshot(secret_url)
        msg = str(exc_info.value)
        assert "HighlySecretPW99" not in msg
        assert "secret_user" not in msg

    # ------------------------------------------------------------------
    # 11. Snapshot database_identity reflects the connection that read the rows
    # ------------------------------------------------------------------
    def test_snapshot_identity_reflects_actual_connection(self) -> None:
        """Identity in the snapshot must come from the same connection as row reads."""
        mock_conn = self._make_mock_conn(
            identity_row=(
                "cinesphere_specific",
                "10.0.0.5/32",
                5433,
                "9999888877776666",
                12345,
            )
        )
        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ):
            snap = capture_personal_snapshot(
                "postgresql://user:pw@localhost:5433/cinesphere_specific?schema=public"
            )

        assert snap.database_identity["database_name"] == "cinesphere_specific"
        assert snap.database_identity["server_port"] == 5433
        assert snap.database_identity["system_identifier"] == "9999888877776666"
        assert snap.database_identity["database_oid"] == 12345


# ===========================================================================
# Tests: Real PostgreSQL Transaction Semantics Integration (B.2-E)
# ===========================================================================
def _get_disposable_test_db_url() -> str | None:
    """Return a safe disposable test DB URL containing 'test' or 'e2e'."""
    for env_var in ("CINESPHERE_TEST_DATABASE_URL", "CINESPHERE_E2E_DATABASE_URL"):
        url = os.environ.get(env_var)
        if url:
            lower = url.lower()
            if "test" not in lower and "e2e" not in lower:
                raise RuntimeError(f"SAFETY: {env_var}={url!r} does not contain 'test' or 'e2e'.")
            return url
    return "postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere_test"


def _require_disposable_test_db() -> str:
    """Connect to the disposable test DB or skip with NOT VERIFIED if unreachable."""
    try:
        import psycopg2  # noqa: PLC0415
    except ImportError:
        pytest.skip("NOT VERIFIED — psycopg2 is not installed.")

    url = _get_disposable_test_db_url()
    if url is None:
        pytest.skip("NOT VERIFIED — No disposable test database URL configured.")
    if "test" not in url.lower() and "e2e" not in url.lower():
        pytest.fail(f"SAFETY: Refusing to run integration test against non-test DB {url!r}.")

    try:
        probe = psycopg2.connect(strip_prisma_schema_param(url))
        probe.close()
    except Exception as exc:
        pytest.skip(f"NOT VERIFIED — Disposable test DB not reachable: {exc}")
    return url


class TestSnapshotTransactionPostgresIntegration:
    """
    Real PostgreSQL integration tests (against disposable cinesphere_test only)
    proving effective REPEATABLE READ isolation, READ ONLY enforcement,
    concurrent-commit snapshot consistency, zero-warning transaction setup,
    and proper connection cleanup.
    """

    def test_effective_repeatable_read_and_readonly_in_live_snapshot(self) -> None:
        """SHOW transaction_isolation == 'repeatable read', SHOW transaction_read_only == 'on',
        no PostgreSQL warnings, and same backend PID across identity + table reads."""
        url = _require_disposable_test_db()
        observed: dict[str, Any] = {}

        def _inspect_tx(conn: Any) -> None:
            with conn.cursor() as cur:
                cur.execute("SHOW transaction_isolation;")
                observed["isolation"] = cur.fetchone()[0]
                cur.execute("SHOW transaction_read_only;")
                observed["read_only"] = cur.fetchone()[0]
                cur.execute("SELECT pg_backend_pid();")
                observed["pid"] = cur.fetchone()[0]
            observed["notices"] = list(getattr(conn, "notices", []))
            observed["conn_ref"] = conn

        snap = capture_personal_snapshot(url, _after_identity_hook=_inspect_tx)

        assert observed["isolation"] == "repeatable read", (
            f"Expected 'repeatable read', got {observed['isolation']!r} "
            "(silent fallback to READ COMMITTED must fail)."
        )
        assert observed["read_only"] == "on", (
            f"Expected 'on', got {observed['read_only']!r} "
            "(silent fallback to READ WRITE must fail)."
        )
        assert observed["notices"] == [], (
            f"Expected zero PostgreSQL warnings (no redundant BEGIN), got {observed['notices']!r}"
        )
        assert observed["conn_ref"].closed != 0, "Connection must be closed after capture."
        assert len(snap.row_counts) == len(PERSONAL_DATA_TABLES)
        assert len(snap.table_fingerprints) == len(PERSONAL_DATA_TABLES)

    def test_snapshot_connection_rejects_writes(self) -> None:
        """open_snapshot_connection() must reject writes with SQLSTATE 25006."""
        from psycopg2.errors import ReadOnlySqlTransaction  # noqa: PLC0415

        url = _require_disposable_test_db()
        conn = open_snapshot_connection(url)
        try:
            with conn.cursor() as cur:
                cur.execute("SHOW transaction_isolation;")
                assert cur.fetchone()[0] == "repeatable read"
                cur.execute("SHOW transaction_read_only;")
                assert cur.fetchone()[0] == "on"
                with pytest.raises(ReadOnlySqlTransaction):
                    cur.execute(
                        'INSERT INTO "system_configs" ("key", "value", "updatedAt") '
                        "VALUES ('__b2e_ro_probe__', 'should_fail', NOW());"
                    )
                conn.rollback()
        finally:
            conn.close()
        assert conn.closed != 0

    def test_concurrent_commit_invisible_to_active_snapshot(self) -> None:
        """A second connection committing a row after snapshot start must NOT be seen
        by the active REPEATABLE READ snapshot (fails if silently READ COMMITTED)."""
        import psycopg2  # noqa: PLC0415

        url = _require_disposable_test_db()
        clean_url = strip_prisma_schema_param(url)
        probe_key = f"__b2e_concurrency_{uuid.uuid4().hex[:12]}__"

        baseline = capture_personal_snapshot(url)
        baseline_count = baseline.row_counts["system_configs"]
        baseline_fp = baseline.table_fingerprints["system_configs"]["fingerprint"]

        hook_state: dict[str, Any] = {}

        def _commit_on_second_connection(conn: Any) -> None:
            with conn.cursor() as cur:
                cur.execute("SHOW transaction_isolation;")
                hook_state["isolation"] = cur.fetchone()[0]
                cur.execute("SHOW transaction_read_only;")
                hook_state["read_only"] = cur.fetchone()[0]

            writer = psycopg2.connect(clean_url)
            try:
                with writer.cursor() as wc:
                    wc.execute(
                        'INSERT INTO "system_configs" ("key", "value", "updatedAt") '
                        "VALUES (%s, %s, NOW());",
                        (probe_key, "concurrent_commit_value"),
                    )
                writer.commit()
                hook_state["committed"] = True
            finally:
                writer.close()

        try:
            during = capture_personal_snapshot(
                url, _after_identity_hook=_commit_on_second_connection
            )
            assert hook_state.get("committed") is True
            assert hook_state.get("isolation") == "repeatable read"
            assert hook_state.get("read_only") == "on"

            # Under REPEATABLE READ, the active snapshot MUST still match baseline.
            assert during.row_counts["system_configs"] == baseline_count
            assert during.table_fingerprints["system_configs"]["fingerprint"] == baseline_fp

            # A subsequent snapshot MUST see the committed row.
            after = capture_personal_snapshot(url)
            assert after.row_counts["system_configs"] == baseline_count + 1
            assert after.table_fingerprints["system_configs"]["fingerprint"] != baseline_fp
        finally:
            cleanup = psycopg2.connect(clean_url)
            try:
                with cleanup.cursor() as cc:
                    cc.execute('DELETE FROM "system_configs" WHERE "key" = %s;', (probe_key,))
                cleanup.commit()
            finally:
                cleanup.close()

    def test_live_failure_aborts_and_closes_connection(self) -> None:
        """If an error occurs mid-transaction on a live DB, snapshot raises and closes conn."""
        url = _require_disposable_test_db()
        captured_conn: list[Any] = []

        def _failing_hook(conn: Any) -> None:
            captured_conn.append(conn)
            raise RuntimeError("simulated mid-snapshot failure")

        with pytest.raises(PersonalDataIntegrityError, match="simulated mid-snapshot failure"):
            capture_personal_snapshot(url, _after_identity_hook=_failing_hook)

        assert len(captured_conn) == 1
        assert captured_conn[0].closed != 0
