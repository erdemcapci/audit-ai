"""Public workflow contracts characterized before capability extraction."""
from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.agent_service import agent_service
from app.services.planning_readiness_service import planning_readiness_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


class WorkflowContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = settings.model_copy(deep=True)
        self.original_store = project_store.file_store
        settings.projects_dir = Path(self.temp.name)
        settings.demo_mode = True
        settings.deployment_mode = "local"
        project_store.file_store = FileStore(settings.projects_dir)
        self.client = TestClient(app)
        project = self.client.post("/api/projects", json={"title": "Procurement Audit", "description": "Review vendor approvals."})
        self.assertEqual(project.status_code, 200)
        self.project_id = project.json()["id"]
        self.base = f"/api/projects/{self.project_id}"

    def tearDown(self):
        self.client.close()
        project_store.file_store = self.original_store
        for key, value in self.original.model_dump().items():
            setattr(settings, key, value)
        self.temp.cleanup()

    def post(self, suffix, payload=None):
        response = self.client.post(self.base + suffix, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_phase_workflow_persistence_and_export(self):
        plan = self.post("/planning/generate-objectives")
        self.assertEqual(plan["stage"], "objectives_generated")
        self.assertEqual(plan["workstreams"][0]["name"], "Procurement Governance")
        self.post("/planning/generate-risks")
        plan = self.post("/planning/generate-tests")
        tests = [test for ws in plan["workstreams"] for obj in ws["objectives"] for risk in obj["risks"] for test in risk["tests"]]
        self.assertTrue(tests)
        approved = self.post("/planning/approve")
        self.assertTrue(approved["approved"])
        self.assertEqual(project_store.get_project(self.project_id).status, "fieldwork")
        fieldwork = self.post("/fieldwork/create-from-planning", {"mode": "missing"})
        self.assertEqual({item["test_id"] for item in fieldwork["items"]}, {test["id"] for test in tests})
        fieldwork_id = fieldwork["items"][0]["id"]
        finding = self.post("/findings/draft", {"raw_description": "Approval evidence missing.", "fieldwork_item_id": fieldwork_id})
        saved_item = project_store.load_fieldwork(self.project_id).items[0]
        self.assertIn(finding["id"], saved_item.finding_ids)
        self.assertEqual(saved_item.status, "Issue Identified")
        report = self.post("/reports/generate-draft-report")
        self.assertEqual(report["issue_summary"], finding["title"])
        self.assertEqual(project_store.get_project(self.project_id).status, "reporting")
        export = self.client.get(self.base + "/reports/export-markdown")
        self.assertEqual(export.status_code, 200)
        self.assertIn('filename="audit-report.md"', export.headers["content-disposition"])
        self.assertEqual(export.text, report["draft_markdown"])
        self.assertIn("Findings noted during fieldwork should be validated", export.text)
        reopened = self.post("/planning/reopen")
        self.assertFalse(reopened["approved"])
        self.assertEqual(reopened["stage"], "tests_generated")
        self.assertEqual(self.client.get(self.base + "/planning").json(), reopened)

    def test_canvas_generators_and_downstream_drafts(self):
        selected = self.project_id
        for agent_type, collection in [("workstream_generator", "workstreams"), ("objective_generator", "objectives"), ("risk_generator", "risks"), ("test_generator", "tests")]:
            agent = self.post("/agents", {"type": agent_type, "position": {"x": 0, "y": 0}})
            result = self.post(f'/agents/{agent["id"]}/run', {"input_node_ids": [selected]})
            self.assertGreater(result["generated"][collection], 0)
            plan = project_store.load_planning(self.project_id)
            ws = plan.workstreams[0]
            if collection == "workstreams":
                selected = ws.id
            elif collection == "objectives":
                selected = ws.objectives[0].id
            elif collection == "risks":
                selected = ws.objectives[0].risks[0].id
        self.post("/planning/approve")
        fieldwork = self.post("/fieldwork/create-from-planning", {"mode": "missing"})
        agent = self.post("/agents", {"type": "finding_draft_agent", "position": {"x": 0, "y": 0}})
        result = self.post(f'/agents/{agent["id"]}/run', {"input_node_ids": [fieldwork["items"][0]["id"]], "rough_finding_text": "Evidence missing."})
        self.assertEqual(result["generated"]["findings"], 1)
        agent = self.post("/agents", {"type": "report_draft_agent", "position": {"x": 0, "y": 0}})
        result = self.post(f'/agents/{agent["id"]}/run', {})
        self.assertEqual(result["generated"]["report"], 1)
        self.assertTrue(project_store.load_report(self.project_id).draft_markdown)

    def test_readiness_review_staleness_and_hosted_guard(self):
        initial = self.client.get(self.base + "/planning/readiness")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.json()["overall_status"], "awaiting_ai_review")
        review = self.post("/planning/readiness/ai-review")
        self.assertEqual(review["overall_status"], "current")
        self.assertEqual(review["weights"], {"deterministic": 0.65, "ai": 0.35})
        persisted = project_store.load_planning_readiness(self.project_id).model_dump()
        self.assertEqual(persisted["latest_successful_ai_review"], review["ai_review"])
        self.post("/planning/generate-objectives")
        stale = self.client.get(self.base + "/planning/readiness").json()
        self.assertEqual(stale["overall_status"], "stale_ai_review")
        self.assertIsNone(stale["overall_score"])
        settings.deployment_mode = "hosted"
        settings.demo_mode = False
        settings.admin_secret = "test-secret"
        self.assertEqual(self.client.post(self.base + "/planning/readiness/ai-review").status_code, 403)
        self.assertEqual(project_store.load_planning_readiness(self.project_id).model_dump(), persisted)

    def test_readiness_provider_failure_preserves_last_success(self):
        self.post("/planning/readiness/ai-review")
        original_review = project_store.load_planning_readiness(self.project_id).latest_successful_ai_review
        settings.demo_mode = False
        with patch.object(planning_readiness_service, "_llm_ai_review", side_effect=ValueError("Invalid model output")):
            response = self.post("/planning/readiness/ai-review")
        self.assertEqual(response["ai_review"], original_review.model_dump())
        self.assertEqual(response["ai_error"]["error_message"], "Invalid model output")
        self.assertEqual(project_store.load_planning_readiness(self.project_id).latest_successful_ai_review, original_review)

    def test_report_normalization_aliases_markdown_and_empty_output(self):
        report = agent_service._report_from_agent_data({"summary": " Summary ", "themes": "Theme", "sections": [{"title": "Results", "body": "Detail"}, "Follow up"]})
        self.assertEqual(report.executive_summary, "Summary")
        self.assertEqual(report.key_themes, ["Theme"])
        self.assertEqual(report.draft_report_structure, [{"heading": "Results", "content": "Detail"}, {"heading": "Section 2", "content": "Follow up"}])
        self.assertIn("### Results\nDetail", report.draft_markdown)
        self.assertEqual(agent_service._report_from_agent_data({"markdown": "# Explicit report"}).draft_markdown, "# Explicit report")
        with self.assertRaisesRegex(ValueError, "empty draft report"):
            agent_service._report_from_agent_data({})
