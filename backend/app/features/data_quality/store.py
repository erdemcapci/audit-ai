from __future__ import annotations

import gzip
import hashlib
import io
import os
import re
import uuid
import zlib
from pathlib import Path

from app.features.data_quality.models import DataQualityRun, DataQualityRunCreate, DataQualityRunSummary, SavedRule, StoredSourceFile
from app.store.project_store import project_store
from app.time_utils import utc_now


RUN_ID = re.compile(r"^[a-f0-9]{32}$")
CONTENT_HASH = re.compile(r"^[a-f0-9]{64}$")
MAX_SOURCE_BYTES = 512 * 1024 * 1024
CHUNK = 1024 * 1024


class DataQualityStore:
    """Runs live in `<project>/data_quality/runs/<run_id>.json`; source files are stored once per
    content as `<project>/data_quality/files/<sha256>.csv.gz`."""

    def list_runs(self, project_id: str) -> list[DataQualityRunSummary]:
        runs_dir = self._root(project_id) / "runs"
        if not runs_dir.exists():
            return []
        summaries = [DataQualityRunSummary.model_validate(self._read(path)) for path in runs_dir.glob("*.json")]
        return sorted(summaries, key=lambda run: run.created_at, reverse=True)

    def get_run(self, project_id: str, run_id: str) -> DataQualityRun:
        path = self._run_path(project_id, run_id)
        if not path.exists():
            raise FileNotFoundError(f"Data quality run not found: {run_id}")
        return DataQualityRun.model_validate(self._read(path))

    def create_run(self, project_id: str, payload: DataQualityRunCreate) -> DataQualityRun:
        source = payload.source.model_copy()
        if source.content_hash:
            self._validate_hash(source.content_hash)
        source.stored = bool(source.content_hash) and self._file_path(project_id, source.content_hash).exists()
        run = DataQualityRun(**payload.model_dump(exclude={"source"}), source=source, id=uuid.uuid4().hex, created_at=utc_now())
        project_store.file_store.write_json(self._run_path(project_id, run.id), run.model_dump())
        return run

    def delete_run(self, project_id: str, run_id: str) -> None:
        run = self.get_run(project_id, run_id)
        self._run_path(project_id, run_id).unlink()
        content_hash = run.source.content_hash
        if content_hash and not any(other.source.content_hash == content_hash for other in self.list_runs(project_id)):
            self._file_path(project_id, content_hash).unlink(missing_ok=True)

    def store_file(self, project_id: str, compressed: bytes) -> StoredSourceFile:
        """Stores a gzip-compressed source file under the SHA-256 of its uncompressed content."""
        digest = hashlib.sha256()
        size = 0
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as handle:
                while chunk := handle.read(CHUNK):
                    size += len(chunk)
                    if size > MAX_SOURCE_BYTES:
                        raise ValueError("The source file is too large to store.")
                    digest.update(chunk)
        except (OSError, EOFError, zlib.error) as exc:
            raise ValueError("The source file must be gzip-compressed.") from exc
        content_hash = digest.hexdigest()
        path = self._file_path(project_id, content_hash)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = path.with_suffix(path.suffix + ".tmp")
            tmp_path.write_bytes(compressed)
            os.replace(tmp_path, path)
        return StoredSourceFile(content_hash=content_hash, compressed_size=len(compressed), size=size)

    def file_path(self, project_id: str, content_hash: str) -> Path:
        path = self._file_path(project_id, content_hash)
        if not path.exists():
            raise FileNotFoundError("The source file of this run is no longer stored.")
        return path

    def delete_file(self, project_id: str, content_hash: str) -> None:
        """Removes a stored source file; the runs that used it keep their results."""
        self.file_path(project_id, content_hash).unlink()
        runs_dir = self._root(project_id) / "runs"
        for path in runs_dir.glob("*.json") if runs_dir.exists() else []:
            run = DataQualityRun.model_validate(self._read(path))
            if run.source.content_hash == content_hash and run.source.stored:
                run.source.stored = False
                project_store.file_store.write_json(path, run.model_dump())

    def list_rules(self, project_id: str) -> list[SavedRule]:
        return [SavedRule.model_validate(rule) for rule in project_store.file_store.read_json(self._root(project_id) / "rules.json", [])]

    def save_rules(self, project_id: str, rules: list[SavedRule]) -> list[SavedRule]:
        """Replaces the project's saved rules; one entry per rule id, the last one wins."""
        unique: dict[str, SavedRule] = {}
        for rule in rules:
            if not rule.id or len(rule.id) > 500:
                raise ValueError("Every saved rule needs an id of at most 500 characters.")
            rule.savedAt = rule.savedAt or utc_now()
            unique[rule.id] = rule
        if len(unique) > 500:
            raise ValueError("A project can keep at most 500 saved rules.")
        saved = list(unique.values())
        project_store.file_store.write_json(self._root(project_id) / "rules.json", [rule.model_dump() for rule in saved])
        return saved

    def _root(self, project_id: str) -> Path:
        return project_store.project_dir(project_id) / "data_quality"

    def _run_path(self, project_id: str, run_id: str) -> Path:
        if not RUN_ID.match(run_id):
            raise ValueError("Invalid data quality run id.")
        return self._root(project_id) / "runs" / f"{run_id}.json"

    def _file_path(self, project_id: str, content_hash: str) -> Path:
        self._validate_hash(content_hash)
        return self._root(project_id) / "files" / f"{content_hash}.csv.gz"

    @staticmethod
    def _validate_hash(content_hash: str) -> None:
        if not CONTENT_HASH.match(content_hash):
            raise ValueError("Invalid source file hash.")

    @staticmethod
    def _read(path: Path) -> dict:
        return project_store.file_store.read_json(path, {})


data_quality_store = DataQualityStore()
