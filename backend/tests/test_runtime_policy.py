from __future__ import annotations

import sys
import unittest
import tempfile
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.settings import update_llm_settings
from app.config import settings
from app.models import AuditCreate, LLMSettingsUpdate
from app.runtime import ADMIN_COOKIE, create_admin_token, ensure_agent_execution_allowed, ensure_project_write_allowed, runtime_settings
from app.store.file_store import FileStore
from app.store.project_store import project_store


def anonymous_request() -> Request:
    return Request({"type": "http", "headers": []})


def admin_request() -> Request:
    token = create_admin_token()
    return Request({"type": "http", "headers": [(b"cookie", f"{ADMIN_COOKIE}={token}".encode("utf-8"))]})


class RuntimePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original = {
            "deployment_mode": settings.deployment_mode,
            "admin_secret": settings.admin_secret,
            "demo_mode": settings.demo_mode,
            "llm_provider": settings.llm_provider,
            "ollama_base_url": settings.ollama_base_url,
            "projects_dir": settings.projects_dir,
            "project_file_store": project_store.file_store,
        }
        settings.deployment_mode = "hosted"
        settings.admin_secret = "secret"
        settings.llm_provider = "ollama"
        settings.ollama_base_url = ""
        settings.projects_dir = Path(self.temp_dir.name)
        project_store.file_store = FileStore(settings.projects_dir)

    def tearDown(self) -> None:
        project_store.file_store = self.original["project_file_store"]
        for key, value in self.original.items():
            if key != "project_file_store":
                setattr(settings, key, value)
        self.temp_dir.cleanup()

    def test_hosted_demo_mode_allows_anonymous_agent_execution(self) -> None:
        settings.demo_mode = True

        runtime = runtime_settings(anonymous_request())

        self.assertEqual(runtime.deploymentMode, "hosted")
        self.assertFalse(runtime.isAdmin)
        self.assertTrue(runtime.llmProviderConfigured)
        self.assertTrue(runtime.agentExecutionEnabled)
        ensure_agent_execution_allowed(anonymous_request())

    def test_hosted_non_demo_mode_keeps_anonymous_agent_execution_disabled(self) -> None:
        settings.demo_mode = False

        runtime = runtime_settings(anonymous_request())

        self.assertFalse(runtime.llmProviderConfigured)
        self.assertFalse(runtime.agentExecutionEnabled)
        with self.assertRaises(HTTPException):
            ensure_agent_execution_allowed(anonymous_request())

    def test_hosted_anonymous_user_cannot_disable_demo_mode_or_change_provider(self) -> None:
        settings.demo_mode = True

        with self.assertRaises(HTTPException) as raised:
            update_llm_settings(
                anonymous_request(),
                LLMSettingsUpdate(provider="openai", demo_mode=False),
            )

        self.assertEqual(raised.exception.status_code, 403)
        self.assertTrue(settings.demo_mode)
        self.assertEqual(settings.llm_provider, "ollama")

    def test_hosted_locked_project_blocks_anonymous_writes(self) -> None:
        audit = project_store.create_project(AuditCreate(title="Demo audit", description="Protected demo audit"))
        audit.locked = True
        project_store.save_project(audit)

        with self.assertRaises(HTTPException) as raised:
            ensure_project_write_allowed(anonymous_request(), audit.id)

        self.assertEqual(raised.exception.status_code, 423)

    def test_hosted_locked_project_allows_admin_writes(self) -> None:
        audit = project_store.create_project(AuditCreate(title="Demo audit", description="Protected demo audit"))
        audit.locked = True
        project_store.save_project(audit)

        ensure_project_write_allowed(admin_request(), audit.id)

    def test_local_mode_ignores_project_lock(self) -> None:
        audit = project_store.create_project(AuditCreate(title="Local audit", description="Local lock ignored"))
        audit.locked = True
        project_store.save_project(audit)
        settings.deployment_mode = "local"

        ensure_project_write_allowed(anonymous_request(), audit.id)


if __name__ == "__main__":
    unittest.main()
