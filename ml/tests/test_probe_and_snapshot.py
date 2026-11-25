"""
Tests for run_probe_ingestion.py and verify_personal_data_snapshot.py.

All tests use mocks or disposable temporary directories.
No real catalogue writes or live TMDB requests are performed.
"""

from __future__ import annotations

import json
import os
import pathlib
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
    PersonalDataSnapshot,
    TargetVerificationError,
    capture_personal_snapshot,
    compare_personal_snapshots,
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

        assert called == ["PB-40"]  # PB-01 skipped because already complete
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
# Tests: Personal Data Snapshot & Target Verification (Steps 3 & 4)
# ===========================================================================
class TestPersonalSnapshotAndTargetVerification:
    def test_strip_prisma_schema_param(self) -> None:
        url = "postgresql://user:pass@localhost:5432/cinesphere?schema=public"
        assert strip_prisma_schema_param(url) == "postgresql://user:pass@localhost:5432/cinesphere"

    def test_parse_safe_db_identity_redacts_credentials(self) -> None:
        url = "postgresql://secret_user:super_secret_pw@localhost:5432/cinesphere?schema=public"
        ident = parse_safe_db_identity(url)
        assert ident == {
            "database_name": "cinesphere",
            "host": "localhost",
            "port": 5432,
            "is_local_host": True,
        }
        serialized = json.dumps(ident)
        assert "secret_user" not in serialized
        assert "super_secret_pw" not in serialized

    def test_verify_api_and_db_target_passes_on_matching_local(self) -> None:
        health = {
            "status": "ok",
            "database": {
                "connected": True,
                "databaseName": "cinesphere",
                "host": "localhost",
                "port": 5432,
            },
        }
        res = verify_api_and_db_target(
            "http://localhost:4000",
            "postgresql://u:p@localhost:5432/cinesphere?schema=public",
            health_payload=health,
        )
        assert res["verified"] is True
        assert res["database_name"] == "cinesphere"

    def test_verify_api_and_db_target_fails_on_db_name_mismatch(self) -> None:
        health = {
            "status": "ok",
            "database": {
                "connected": True,
                "databaseName": "cinesphere_e2e",
                "host": "localhost",
                "port": 5432,
            },
        }
        with pytest.raises(TargetVerificationError, match="Database name mismatch"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=health,
            )

    def test_verify_api_and_db_target_fails_on_port_mismatch(self) -> None:
        health = {
            "status": "ok",
            "database": {
                "connected": True,
                "databaseName": "cinesphere",
                "host": "localhost",
                "port": 5433,
            },
        }
        with pytest.raises(TargetVerificationError, match="Database port mismatch"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@localhost:5432/cinesphere?schema=public",
                health_payload=health,
            )

    def test_verify_api_and_db_target_rejects_remote_db_host(self) -> None:
        with pytest.raises(TargetVerificationError, match="not a recognized local host"):
            verify_api_and_db_target(
                "http://localhost:4000",
                "postgresql://u:p@prod.db.example.com:5432/cinesphere",
                health_payload={"status": "ok", "database": {"connected": True}},
            )

    def test_compare_personal_snapshots_passes_when_unchanged(self) -> None:
        counts = {tbl: idx * 10 for idx, tbl in enumerate(PERSONAL_DATA_TABLES, start=1)}
        pre = PersonalDataSnapshot(
            captured_at="2026-11-25T00:00:00Z",
            database_identity={"database_name": "cinesphere"},
            row_counts=counts,
        )
        post = PersonalDataSnapshot(
            captured_at="2026-11-25T00:10:00Z",
            database_identity={"database_name": "cinesphere"},
            row_counts=dict(counts),
        )
        res = compare_personal_snapshots(pre, post)
        assert res.passed is True
        assert res.changed_tables == []

    def test_compare_personal_snapshots_fails_on_mutation(self) -> None:
        counts = {tbl: 10 for tbl in PERSONAL_DATA_TABLES}
        mutated = dict(counts)
        mutated["user_library_entries"] = 11
        pre = PersonalDataSnapshot(
            captured_at="t1", database_identity={"database_name": "cinesphere"}, row_counts=counts
        )
        post = PersonalDataSnapshot(
            captured_at="t2", database_identity={"database_name": "cinesphere"}, row_counts=mutated
        )
        res = compare_personal_snapshots(pre, post)
        assert res.passed is False
        assert res.changed_tables == ["user_library_entries"]
        assert res.deltas["user_library_entries"]["delta"] == 1

    def test_capture_personal_snapshot_uses_readonly_session(self) -> None:
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [("cinesphere", 5432)] + [(5,)] * len(
            PERSONAL_DATA_TABLES
        )
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch(
            "ml.benchmark.scripts.verify_personal_data_snapshot.psycopg2.connect",
            return_value=mock_conn,
        ) as mock_connect:
            snap = capture_personal_snapshot(
                "postgresql://user:pw@localhost:5432/cinesphere?schema=public"
            )

        mock_connect.assert_called_once_with("postgresql://user:pw@localhost:5432/cinesphere")
        mock_conn.set_session.assert_called_once_with(readonly=True, autocommit=True)
        assert len(snap.row_counts) == len(PERSONAL_DATA_TABLES)

    def test_snapshot_cli_verify_mode_exit_codes(self, tmp_path: pathlib.Path) -> None:
        counts = {tbl: 42 for tbl in PERSONAL_DATA_TABLES}
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        report_path = tmp_path / "report.json"

        save_snapshot_atomic(
            PersonalDataSnapshot(
                captured_at="t1",
                database_identity={"database_name": "cinesphere"},
                row_counts=counts,
            ),
            pre_path,
        )
        save_snapshot_atomic(
            PersonalDataSnapshot(
                captured_at="t2",
                database_identity={"database_name": "cinesphere"},
                row_counts=counts,
            ),
            post_path,
        )
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
        assert json.loads(report_path.read_text(encoding="utf-8"))["passed"] is True

        # Now mutate post snapshot and verify exit code 1
        mutated = dict(counts)
        mutated["users"] = 43
        save_snapshot_atomic(
            PersonalDataSnapshot(
                captured_at="t2",
                database_identity={"database_name": "cinesphere"},
                row_counts=mutated,
            ),
            post_path,
        )
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
