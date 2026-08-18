from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.settings import update_llm_settings
from app.config import settings
from app.models import LLMSettingsUpdate
from app.runtime import ensure_agent_execution_allowed, runtime_settings


def anonymous_request() -> Request:
    return Request({"type": "http", "headers": []})


class RuntimePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original = {
            "deployment_mode": settings.deployment_mode,
            "admin_secret": settings.admin_secret,
            "demo_mode": settings.demo_mode,
            "llm_provider": settings.llm_provider,
            "ollama_base_url": settings.ollama_base_url,
        }
        settings.deployment_mode = "hosted"
        settings.admin_secret = "secret"
        settings.llm_provider = "ollama"
        settings.ollama_base_url = ""

    def tearDown(self) -> None:
        for key, value in self.original.items():
            setattr(settings, key, value)

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


if __name__ == "__main__":
    unittest.main()
