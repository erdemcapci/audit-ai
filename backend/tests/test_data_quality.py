from __future__ import annotations

import gzip
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.features.data_quality.models import DataQualityRunCreate, SavedRule, SourceFile
from app.features.data_quality.store import data_quality_store
from app.models import AuditCreate
from app.runtime import ADMIN_COOKIE, create_admin_token, ensure_data_quality_write_allowed
from app.store.file_store import FileStore
from app.store.project_store import project_store


CSV = b"id,amount\n1,10.50\n2,20.00\n"


def anonymous_request() -> Request:
    return Request({"type": "http", "headers": []})


def admin_request() -> Request:
    token = create_admin_token()
    return Request({"type": "http", "headers": [(b"cookie", f"{ADMIN_COOKIE}={token}".encode("utf-8"))]})


class DataQualityStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original = {
            "deployment_mode": settings.deployment_mode,
            "admin_secret": settings.admin_secret,
            "projects_dir": settings.projects_dir,
        }
        self.original_file_store = project_store.file_store
        settings.projects_dir = Path(self.temp_dir.name)
        project_store.file_store = FileStore(settings.projects_dir)
        self.project = project_store.create_project(AuditCreate(title="Procurement", description="Test"))
        self.other = project_store.create_project(AuditCreate(title="Payroll", description="Test"))

    def tearDown(self) -> None:
        project_store.file_store = self.original_file_store
        for key, value in self.original.items():
            setattr(settings, key, value)
        self.temp_dir.cleanup()

    def run_payload(self, content_hash: str = "") -> DataQualityRunCreate:
        return DataQualityRunCreate(source=SourceFile(name="invoices.csv", size=len(CSV), rows=2, columns=2, headers=["id", "amount"], content_hash=content_hash))

    def test_file_is_stored_once_under_the_hash_of_its_content(self) -> None:
        first = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        second = data_quality_store.store_file(self.project.id, gzip.compress(CSV, compresslevel=1))

        self.assertEqual(first.content_hash, hashlib.sha256(CSV).hexdigest())
        self.assertEqual(second.content_hash, first.content_hash)
        self.assertEqual(first.size, len(CSV))
        self.assertEqual(gzip.decompress(data_quality_store.file_path(self.project.id, first.content_hash).read_bytes()), CSV)

    def test_rejects_uncompressed_uploads(self) -> None:
        with self.assertRaises(ValueError):
            data_quality_store.store_file(self.project.id, CSV)

    def test_runs_are_scoped_to_their_project(self) -> None:
        stored = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        run = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))

        self.assertTrue(run.source.stored)
        self.assertEqual([r.id for r in data_quality_store.list_runs(self.project.id)], [run.id])
        self.assertEqual(data_quality_store.list_runs(self.other.id), [])
        with self.assertRaises(FileNotFoundError):
            data_quality_store.get_run(self.other.id, run.id)

    def test_deleting_a_run_keeps_a_file_another_run_still_uses(self) -> None:
        stored = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        first = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))
        second = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))

        data_quality_store.delete_run(self.project.id, first.id)
        self.assertTrue(data_quality_store.file_path(self.project.id, stored.content_hash).exists())

        data_quality_store.delete_run(self.project.id, second.id)
        with self.assertRaises(FileNotFoundError):
            data_quality_store.file_path(self.project.id, stored.content_hash)
        self.assertEqual(data_quality_store.list_runs(self.project.id), [])

    def test_deleting_the_source_file_keeps_the_results(self) -> None:
        stored = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        run = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))

        data_quality_store.delete_run_file(self.project.id, run.id)

        reloaded = data_quality_store.get_run(self.project.id, run.id)
        self.assertFalse(reloaded.source.stored)
        self.assertEqual(reloaded.source.name, "invoices.csv")
        with self.assertRaises(FileNotFoundError):
            data_quality_store.file_path(self.project.id, stored.content_hash)

    def test_deleting_the_source_file_of_one_run_leaves_other_runs_on_the_same_file(self) -> None:
        stored = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        first = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))
        second = data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))

        data_quality_store.delete_run_file(self.project.id, first.id)
        self.assertFalse(data_quality_store.get_run(self.project.id, first.id).source.stored)
        self.assertTrue(data_quality_store.get_run(self.project.id, second.id).source.stored)
        self.assertTrue(data_quality_store.file_path(self.project.id, stored.content_hash).exists())

        data_quality_store.delete_run(self.project.id, second.id)
        with self.assertRaises(FileNotFoundError):
            data_quality_store.file_path(self.project.id, stored.content_hash)

    def test_deleting_the_project_deletes_its_runs_and_files(self) -> None:
        stored = data_quality_store.store_file(self.project.id, gzip.compress(CSV))
        data_quality_store.create_run(self.project.id, self.run_payload(stored.content_hash))
        project_dir = project_store.project_dir(self.project.id)

        project_store.delete_project(self.project.id)

        self.assertFalse((project_dir / "data_quality").exists())

    def test_saved_rules_are_kept_per_project_once_per_id(self) -> None:
        rule = SavedRule(id="rule:vendor_id → vendor_name", subject="vendor_id → vendor_name", params={"kind": "dependency", "from": "vendor_id", "to": "vendor_name"}, source="discovered")

        saved = data_quality_store.save_rules(self.project.id, [rule, rule.model_copy(update={"reason": "again"})])

        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].reason, "again")
        self.assertTrue(saved[0].savedAt)
        self.assertEqual([r.id for r in data_quality_store.list_rules(self.project.id)], [rule.id])
        self.assertEqual(data_quality_store.list_rules(self.other.id), [])

    def test_old_runs_without_rule_totals_still_load(self) -> None:
        run = data_quality_store.create_run(self.project.id, self.run_payload())
        path = project_store.project_dir(self.project.id) / "data_quality" / "runs" / f"{run.id}.json"
        raw = project_store.file_store.read_json(path, {})
        raw["totals"] = {"tests": 3, "findings": 1, "high": 0, "medium": 1, "low": 0, "exceptions": 4}
        project_store.file_store.write_json(path, raw)

        reloaded = data_quality_store.get_run(self.project.id, run.id)
        self.assertEqual((reloaded.totals.uncertain, reloaded.totals.notHeld), (0, 0))

    def test_rejects_ids_that_could_escape_the_project_folder(self) -> None:
        with self.assertRaises(ValueError):
            data_quality_store.get_run(self.project.id, "../../audit")
        with self.assertRaises(ValueError):
            data_quality_store.file_path(self.project.id, "../audit.json")


class DataQualityPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original = {"deployment_mode": settings.deployment_mode, "admin_secret": settings.admin_secret}
        settings.admin_secret = "secret"

    def tearDown(self) -> None:
        for key, value in self.original.items():
            setattr(settings, key, value)

    def test_local_mode_allows_writes(self) -> None:
        settings.deployment_mode = "local"
        ensure_data_quality_write_allowed(anonymous_request())

    def test_hosted_showcase_is_read_only_for_visitors(self) -> None:
        settings.deployment_mode = "hosted"
        with self.assertRaises(HTTPException) as raised:
            ensure_data_quality_write_allowed(anonymous_request())
        self.assertEqual(raised.exception.status_code, 403)

    def test_hosted_admin_can_create_showcase_runs(self) -> None:
        settings.deployment_mode = "hosted"
        ensure_data_quality_write_allowed(admin_request())


if __name__ == "__main__":
    unittest.main()
