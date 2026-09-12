from __future__ import annotations

import ast
import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.agents import json_utils as legacy_json
from app.features.planning_readiness import models as readiness_models
from app.features.planning_readiness import service as readiness
from app.features.planning_readiness.prompts import build_review_prompts
from app.llm.base import LLMResponse
from app.llm.json_utils import parse_or_warn
from app.services.planning_readiness_service import planning_readiness_service


class CapabilityBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_readiness_provider_request_matches_original_prompt_and_contract(self):
        # Captured from public/main before moving the inline prompt renderer.
        fixture = json.loads((Path(__file__).parent / "fixtures/planning_review_prompt.json").read_text())
        audit = models.AuditProject.model_validate(fixture["audit"])
        planning = models.PlanningState.model_validate(fixture["planning"])
        deterministic = readiness_models.PlanningReadinessComponent.model_validate(fixture["deterministic"])
        self.assertEqual(build_review_prompts(audit, planning, deterministic), (fixture["system_prompt"], fixture["user_prompt"]))
        calls = []

        class Provider:
            async def generate(self, system_prompt, user_prompt, json_mode):
                calls.append((system_prompt, user_prompt, json_mode))
                return LLMResponse(content='```json\n{"score": 75, "executive_summary": "Review complete"}\n```', provider="fake", model="fake-model")

        store = SimpleNamespace(get_project=lambda _: audit, load_planning=lambda _: planning)
        with patch.object(readiness, "project_store", store), patch.object(readiness, "get_llm_provider", return_value=Provider()):
            result = await planning_readiness_service._llm_ai_review(audit.id, deterministic, "fingerprint")
        self.assertEqual(calls, [(fixture["system_prompt"], fixture["user_prompt"], fixture["json_mode"])])
        self.assertEqual((result.score, result.provider, result.model, result.plan_fingerprint), (75, "fake", "fake-model", "fingerprint"))
        self.assertEqual(result.executive_summary, "Review complete")

    def test_legacy_imports_share_the_same_models_service_and_parser(self):
        self.assertIs(models.PlanningReadinessState, readiness_models.PlanningReadinessState)
        self.assertIs(models.PlanningReadinessResponse, readiness_models.PlanningReadinessResponse)
        self.assertIs(planning_readiness_service, readiness.planning_readiness_service)
        self.assertIs(legacy_json.parse_or_warn, parse_or_warn)

    def test_json_parser_preserves_fenced_prose_and_failure_behavior(self):
        for text in ['{"score": 2}', '```json\n{"score": 2}\n```', 'Result: {"score": 2} done']:
            self.assertEqual(parse_or_warn(text), ({"score": 2}, ""))
        self.assertEqual(parse_or_warn("no object"), (None, "Model response did not include a JSON object."))
        data, warning = parse_or_warn('{"score": }')
        self.assertIsNone(data)
        self.assertTrue(warning.startswith("Model returned invalid JSON:"))

    def test_provider_infrastructure_does_not_import_audit_implementations(self):
        root = Path(__file__).resolve().parents[1] / "app"
        for path in (root / "llm").glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.ImportFrom) and node.module:
                    self.assertFalse(node.module.startswith(("app.features", "app.agents", "app.services", "app.context", "app.store")), f"{path.name}: {node.module}")
        # Readiness schemas must be independently importable, without a cycle
        # through the global model compatibility exports or project persistence.
        schema = ast.parse((root / "features/planning_readiness/models.py").read_text())
        imports = [node.module for node in ast.walk(schema) if isinstance(node, ast.ImportFrom)]
        self.assertNotIn("app.models", imports)
        self.assertNotIn("app.store.project_store", imports)
