from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.models import AgentRunLoggingSettingsUpdate, AgentState
from app.services.agent_run_log_service import AgentRunLogService


class AgentRunLoggingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original = {
            "projects_dir": settings.projects_dir,
            "deployment_mode": settings.deployment_mode,
            "agent_run_logs_enabled": settings.agent_run_logs_enabled,
            "agent_run_log_full_io": settings.agent_run_log_full_io,
            "agent_run_log_raw_response": settings.agent_run_log_raw_response,
            "agent_run_log_retention_days": settings.agent_run_log_retention_days,
            "agent_run_log_dir": settings.agent_run_log_dir,
            "allow_hosted_full_agent_logs": settings.allow_hosted_full_agent_logs,
        }
        settings.projects_dir = Path(self.temp_dir.name)
        settings.deployment_mode = "local"
        settings.agent_run_logs_enabled = True
        settings.agent_run_log_full_io = False
        settings.agent_run_log_raw_response = False
        settings.agent_run_log_retention_days = 30
        settings.agent_run_log_dir = "agent_runs"
        settings.allow_hosted_full_agent_logs = False
        self.service = AgentRunLogService()
        self.agent = AgentState(id="agent_test", type="test_generator", title="Test Generator", prompt="Generate tests.")

    def tearDown(self) -> None:
        for key, value in self.original.items():
            setattr(settings, key, value)
        self.temp_dir.cleanup()

    def start(self) -> str:
        run_id = self.service.start_run(
            project_id="audit_test",
            actor_id="local",
            agent=self.agent,
            provider="ollama",
            model="llama3.1:8b",
            selected_item_ids=["risk_1"],
            context_recipe_id="test_generator_default",
            context_blocks_used=["audit_overview", "selected_items"],
            estimated_context_tokens=400,
            context_truncated=False,
            rendered_context="Sensitive audit context",
        )
        self.assertIsNotNone(run_id)
        return str(run_id)

    def test_metadata_success_log_without_full_io(self) -> None:
        run_id = self.start()
        self.service.complete_run(
            "audit_test",
            run_id,
            provider="ollama",
            model="llama3.1:8b",
            output_object_ids=["test_1"],
            final_prompt={"system": "secret prompt"},
            parsed_output={"tests": ["sensitive output"]},
            raw_llm_response={"response": "raw"},
        )

        log = self.service.get_run("audit_test", run_id)
        self.assertEqual(log.status, "success")
        self.assertEqual(log.output_object_ids, ["test_1"])
        self.assertFalse(log.full_io_logged)
        self.assertFalse(log.raw_response_logged)
        self.assertIsNone(log.rendered_context)
        self.assertIsNone(log.final_prompt)
        self.assertIsNone(log.parsed_output)
        self.assertIsNone(log.raw_llm_response)

    def test_error_log_created(self) -> None:
        run_id = self.start()
        self.service.fail_run("audit_test", run_id, error_message="Model failed")

        log = self.service.get_run("audit_test", run_id)
        self.assertEqual(log.status, "error")
        self.assertEqual(log.error_message, "Model failed")
        self.assertIsNotNone(log.completed_at)

    def test_full_io_and_raw_response_stored_when_enabled_locally(self) -> None:
        settings.agent_run_log_full_io = True
        settings.agent_run_log_raw_response = True
        run_id = self.start()
        self.service.complete_run(
            "audit_test",
            run_id,
            provider="openai",
            model="gpt-test",
            output_object_ids=["test_1"],
            final_prompt={"user_prompt": "full prompt"},
            parsed_output={"tests": [{"id": "test_1"}]},
            raw_llm_response={"choices": []},
        )

        log = self.service.get_run("audit_test", run_id)
        self.assertTrue(log.full_io_logged)
        self.assertTrue(log.raw_response_logged)
        self.assertEqual(log.rendered_context, "Sensitive audit context")
        self.assertEqual(log.final_prompt, {"user_prompt": "full prompt"})
        self.assertEqual(log.raw_llm_response, {"choices": []})

    def test_hosted_policy_rejects_content_logging(self) -> None:
        settings.deployment_mode = "hosted"
        with self.assertRaisesRegex(ValueError, "disabled by backend policy"):
            self.service.update_settings(
                AgentRunLoggingSettingsUpdate(enabled=True, full_io=True, raw_response=False, retention_days=30)
            )

    def test_list_get_delete_and_path_validation(self) -> None:
        run_id = self.start()
        self.assertEqual([item.run_id for item in self.service.list_runs("audit_test")], [run_id])
        self.assertEqual(self.service.get_run("audit_test", run_id).run_id, run_id)
        self.service.delete_run("audit_test", run_id)
        self.assertEqual(self.service.list_runs("audit_test"), [])

        with self.assertRaises(ValueError):
            self.service.list_runs("../audit_test")
        with self.assertRaises(ValueError):
            self.service.get_run("audit_test", "../../secret")

    def test_disabled_logging_returns_no_run(self) -> None:
        settings.agent_run_logs_enabled = False
        self.assertIsNone(
            self.service.start_run(
                project_id="audit_test",
                actor_id="local",
                agent=self.agent,
                provider="demo",
                model="deterministic",
                selected_item_ids=[],
                context_recipe_id="generic_default",
                context_blocks_used=[],
                estimated_context_tokens=0,
                context_truncated=False,
                rendered_context="",
            )
        )


if __name__ == "__main__":
    unittest.main()
