from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import settings
from app.models import AgentRunLog, AgentRunLoggingSettings, AgentRunLoggingSettingsUpdate, AgentState, utc_now
from app.store.file_store import FileStore


SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class AgentRunLogService:
    def current_settings(self, *, can_modify: bool) -> AgentRunLoggingSettings:
        full_io, raw_response = self._effective_content_flags()
        return AgentRunLoggingSettings(
            enabled=settings.agent_run_logs_enabled,
            full_io=full_io,
            raw_response=raw_response,
            retention_days=settings.agent_run_log_retention_days,
            log_directory=settings.agent_run_log_dir,
            hosted_full_logs_allowed=settings.allow_hosted_full_agent_logs,
            can_modify=can_modify,
        )

    def update_settings(self, update: AgentRunLoggingSettingsUpdate) -> AgentRunLoggingSettings:
        if settings.deployment_mode == "hosted" and not settings.allow_hosted_full_agent_logs and (update.full_io or update.raw_response):
            raise ValueError("Full I/O and raw response logging are disabled by backend policy for the hosted showcase.")
        settings.agent_run_logs_enabled = update.enabled
        settings.agent_run_log_full_io = update.full_io
        settings.agent_run_log_raw_response = update.raw_response
        settings.agent_run_log_retention_days = update.retention_days
        self.cleanup_old_runs()
        return self.current_settings(can_modify=True)

    def start_run(
        self,
        *,
        project_id: str,
        actor_id: str,
        agent: AgentState,
        provider: str,
        model: str,
        selected_item_ids: list[str],
        context_recipe_id: str,
        context_blocks_used: list[str],
        estimated_context_tokens: int,
        context_truncated: bool,
        rendered_context: str,
    ) -> str | None:
        if not settings.agent_run_logs_enabled:
            return None
        self._validate_id(project_id, "project_id")
        run_id = f"run_{uuid4().hex}"
        full_io, raw_response = self._effective_content_flags()
        log = AgentRunLog(
            run_id=run_id,
            project_id=project_id,
            actor_id=actor_id,
            agent_id=agent.id,
            agent_name=agent.title,
            status="started",
            started_at=utc_now(),
            provider=provider,
            model=model,
            selected_item_ids=selected_item_ids,
            context_recipe_id=context_recipe_id,
            context_blocks_used=context_blocks_used,
            estimated_context_tokens=estimated_context_tokens,
            context_truncated=context_truncated,
            full_io_logged=full_io,
            raw_response_logged=raw_response,
            rendered_context=rendered_context if full_io else None,
        )
        self._write(log)
        return run_id

    def complete_run(
        self,
        project_id: str,
        run_id: str | None,
        *,
        provider: str,
        model: str,
        output_object_ids: list[str],
        final_prompt: Any,
        parsed_output: Any,
        raw_llm_response: Any,
    ) -> None:
        if not run_id:
            return
        log = self.get_run(project_id, run_id)
        full_io, raw_response = self._effective_content_flags()
        log.status = "success"
        log.completed_at = utc_now()
        log.provider = provider or log.provider
        log.model = model or log.model
        log.output_object_ids = sorted(set(output_object_ids))
        log.full_io_logged = full_io
        log.raw_response_logged = raw_response
        log.final_prompt = final_prompt if full_io else None
        log.parsed_output = parsed_output if full_io else None
        log.raw_llm_response = raw_llm_response if raw_response else None
        if not full_io:
            log.rendered_context = None
        self._write(log)

    def fail_run(
        self,
        project_id: str,
        run_id: str | None,
        *,
        error_message: str,
        provider: str = "",
        model: str = "",
        final_prompt: Any = None,
        raw_llm_response: Any = None,
    ) -> None:
        if not run_id:
            return
        log = self.get_run(project_id, run_id)
        full_io, raw_response = self._effective_content_flags()
        log.status = "error"
        log.completed_at = utc_now()
        log.error_message = error_message
        log.provider = provider or log.provider
        log.model = model or log.model
        log.full_io_logged = full_io
        log.raw_response_logged = raw_response
        log.final_prompt = final_prompt if full_io else None
        log.raw_llm_response = raw_llm_response if raw_response else None
        if not full_io:
            log.rendered_context = None
        self._write(log)

    def list_runs(self, project_id: str) -> list[AgentRunLog]:
        directory = self._project_dir(project_id)
        if not directory.exists():
            return []
        logs: list[AgentRunLog] = []
        for path in directory.glob("run_*.json"):
            try:
                logs.append(AgentRunLog.model_validate(self._store().read_json(path, {})))
            except (ValueError, OSError):
                continue
        return sorted(logs, key=lambda item: item.started_at, reverse=True)

    def list_all_runs(self) -> list[AgentRunLog]:
        root = self._root()
        if not root.exists():
            return []
        logs: list[AgentRunLog] = []
        for directory in root.iterdir():
            if directory.is_dir() and SAFE_ID_PATTERN.fullmatch(directory.name):
                logs.extend(self.list_runs(directory.name))
        return sorted(logs, key=lambda item: item.started_at, reverse=True)

    def get_run(self, project_id: str, run_id: str) -> AgentRunLog:
        path = self._run_path(project_id, run_id)
        if not path.exists():
            raise FileNotFoundError(f"Agent run log not found: {run_id}")
        return AgentRunLog.model_validate(self._store().read_json(path, {}))

    def delete_run(self, project_id: str, run_id: str) -> None:
        path = self._run_path(project_id, run_id)
        if not path.exists():
            raise FileNotFoundError(f"Agent run log not found: {run_id}")
        path.unlink()

    def cleanup_old_runs(self, now: datetime | None = None) -> int:
        root = self._root()
        if not root.exists():
            return 0
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=settings.agent_run_log_retention_days)
        deleted = 0
        for path in root.glob("*/run_*.json"):
            try:
                modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                if modified < cutoff:
                    path.unlink()
                    deleted += 1
            except OSError:
                continue
        return deleted

    def _effective_content_flags(self) -> tuple[bool, bool]:
        hosted_allowed = settings.deployment_mode != "hosted" or settings.allow_hosted_full_agent_logs
        return (
            settings.agent_run_log_full_io and hosted_allowed,
            settings.agent_run_log_raw_response and hosted_allowed,
        )

    def _write(self, log: AgentRunLog) -> None:
        self._store().write_json(self._run_path(log.project_id, log.run_id), log.model_dump())

    def _root(self) -> Path:
        configured = Path(settings.agent_run_log_dir)
        if configured.is_absolute() or ".." in configured.parts:
            raise ValueError("AGENT_RUN_LOG_DIR must be a safe relative directory.")
        return settings.projects_dir / configured

    def _project_dir(self, project_id: str) -> Path:
        self._validate_id(project_id, "project_id")
        return self._root() / project_id

    def _run_path(self, project_id: str, run_id: str) -> Path:
        self._validate_id(run_id, "run_id")
        if not run_id.startswith("run_"):
            raise ValueError("Invalid run_id.")
        return self._project_dir(project_id) / f"{run_id}.json"

    def _store(self) -> FileStore:
        return FileStore(self._root())

    def _validate_id(self, value: str, field_name: str) -> None:
        if not SAFE_ID_PATTERN.fullmatch(value):
            raise ValueError(f"Invalid {field_name}.")


agent_run_log_service = AgentRunLogService()
