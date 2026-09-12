from __future__ import annotations

import sys
import tempfile
import unittest
import json
from unittest.mock import patch
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.models import (
    AuditCreate,
    FlowEdge,
    MapState,
    Objective,
    PlanningState,
    Risk,
    Test,
    Workstream,
)
from app.features.planning_readiness.service import planning_readiness_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


class PlanningReadinessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_projects_dir = settings.projects_dir
        self.original_demo_mode = settings.demo_mode
        settings.projects_dir = Path(self.temp_dir.name)
        settings.projects_dir.mkdir(parents=True, exist_ok=True)
        settings.demo_mode = True
        project_store.file_store = FileStore(settings.projects_dir)
        self.project = project_store.create_project(
            AuditCreate(
                title="Procurement Audit",
                description="Review procurement approvals, vendor onboarding, invoice matching, and related governance controls.",
                process_area="Procurement",
                initial_concern="Manual approval overrides",
            )
        )

    def tearDown(self) -> None:
        settings.projects_dir = self.original_projects_dir
        settings.demo_mode = self.original_demo_mode
        project_store.file_store = FileStore(settings.projects_dir)
        self.temp_dir.cleanup()

    def test_empty_plan_is_not_ready(self) -> None:
        readiness = planning_readiness_service.get_readiness(self.project.id)

        self.assertEqual(readiness.deterministic.status, "not_ready")
        self.assertLess(readiness.deterministic.score, 90)
        self.assertIn("No workstreams", {finding.check_name for finding in readiness.deterministic.findings})
        self.assertIsNone(readiness.overall_score)
        self.assertEqual(readiness.overall_status, "awaiting_ai_review")

    def test_complete_plan_scores_strong(self) -> None:
        project_store.save_planning(self.project.id, self._complete_plan())

        readiness = planning_readiness_service.get_readiness(self.project.id)

        self.assertEqual(readiness.deterministic.score, 100)
        self.assertEqual(readiness.deterministic.status, "strong")
        self.assertEqual(readiness.deterministic.findings, [])

    def test_duplicate_titles_and_invalid_canvas_relationships_are_flagged(self) -> None:
        planning = self._complete_plan()
        duplicate_risk = Risk(
            id="risk_override_duplicate",
            title="Unauthorized approval override",
            description="Duplicate risk description with enough detail.",
            why_it_matters="Duplicated risk creates unclear coverage ownership.",
            potential_impact="Duplicated risk can lead to inefficient audit work.",
            tests=[
                Test(
                    id="test_duplicate",
                    title="Inspect duplicate approval evidence",
                    description="Inspect duplicate approval evidence in detail.",
                    expected_evidence="Approval records and system logs.",
                )
            ],
        )
        planning.workstreams[0].objectives[0].risks.append(duplicate_risk)
        project_store.save_planning(self.project.id, planning)
        project_store.save_map_state(
            self.project.id,
            MapState(
                edges=[
                    FlowEdge(id="invalid-risk-to-objective", source="risk_override", target="obj_approval"),
                ]
            ),
        )

        readiness = planning_readiness_service.get_readiness(self.project.id)
        checks = {finding.check_name for finding in readiness.deterministic.findings}

        self.assertIn("Duplicate risk titles", checks)
        self.assertIn("Invalid planning relationship", checks)

    def test_missing_persisted_readiness_file_loads_for_existing_projects(self) -> None:
        readiness_path = project_store.project_dir(self.project.id) / "planning_readiness.json"
        readiness_path.unlink()

        readiness = planning_readiness_service.get_readiness(self.project.id)

        self.assertEqual(readiness.overall_status, "awaiting_ai_review")
        self.assertIsNone(readiness.ai_review)

    async def test_ai_review_success_is_stale_after_plan_change(self) -> None:
        project_store.save_planning(self.project.id, self._complete_plan())
        reviewed = await planning_readiness_service.run_ai_review(self.project.id)
        self.assertEqual(reviewed.overall_status, "current")
        self.assertIsNotNone(reviewed.overall_score)

        planning = project_store.load_planning(self.project.id)
        planning.workstreams[0].objectives[0].title = "Assess emergency approval controls"
        project_store.save_planning(self.project.id, planning)

        refreshed = planning_readiness_service.get_readiness(self.project.id)

        self.assertEqual(refreshed.overall_status, "stale_ai_review")
        self.assertIsNone(refreshed.overall_score)
        self.assertTrue(refreshed.ai_review.stale if refreshed.ai_review else False)

    def test_ai_review_normalization_tolerates_loose_values(self) -> None:
        review = planning_readiness_service._normalize_ai_review(
            {
                "score": 140,
                "strengths": "not a list",
                "critical_gaps": [
                    {
                        "category": "Coverage",
                        "priority": "Urgent",
                        "severity": "severe",
                        "confidence": "high",
                        "explanation": "A useful finding still needs to survive normalization.",
                        "affected_artifact_ids": "obj_approval",
                    }
                ],
            },
            "fingerprint",
            "test-provider",
            "test-model",
        )

        self.assertEqual(review.critical_gaps[0].concise_issue, "")
        self.assertEqual(review.score, 100)
        self.assertEqual(review.critical_gaps[0].priority, "Important")
        self.assertEqual(review.critical_gaps[0].severity, "medium")
        self.assertEqual(review.critical_gaps[0].confidence, 0.7)
        self.assertEqual(review.critical_gaps[0].affected_artifact_ids, [])

    async def test_readable_review_is_saved_without_changing_internal_references(self):
        from app.features.planning_readiness import service as readiness_module
        from app.llm.base import LLMResponse
        from app.features.planning_readiness.display_text import TEXT_FIELDS, TEXT_LISTS
        plan = self._complete_plan()
        objective = plan.workstreams[0].objectives[0]
        objective.id = "obj_3665a6d198"
        risk = objective.risks[0]
        risk.id = "risk_2a66f67672"
        project_store.save_planning(self.project.id, plan)
        settings.demo_mode = False
        prose = "`obj_3665a6d198` should address risk_2a66f67672; test_ffffffff00 needs clarification."
        data = {"score": 82, "executive_summary": prose, "strengths": [prose],
                "dimension_scores": [{"dimension": prose, "score": 81, "explanation": prose}]}
        groups = ["critical_gaps", "warnings", "duplication_findings", "contradiction_findings",
                  "missing_coverage_findings", "improvement_opportunities", "prioritized_recommendations"]
        for group in groups:
            data[group] = [{"concise_issue": prose, "category": prose, "explanation": prose, "suggested_action": prose,
                            "affected_artifact_ids": [objective.id, risk.id],
                            "affected_artifact_names": [objective.id, risk.id], "affected_workstreams": ["ws_procure"]}]

        class Provider:
            async def generate(self, system_prompt, user_prompt, json_mode):
                return LLMResponse(content=json.dumps(data), provider="fake", model="fake")

        with patch.object(readiness_module, "get_llm_provider", return_value=Provider()):
            result = await planning_readiness_service.run_ai_review(self.project.id)
        saved = project_store.load_planning_readiness(self.project.id).latest_successful_ai_review
        self.assertEqual(saved.score, 82)
        self.assertEqual(saved.plan_fingerprint, result.plan_fingerprint)
        for group in groups:
            self.assertEqual(getattr(saved, group)[0].affected_artifact_ids, [objective.id, risk.id])
            self.assertEqual(getattr(saved, group)[0].affected_artifact_names, [objective.title, risk.title])
        self.assertIn("“Assess approval controls”", saved.critical_gaps[0].concise_issue)
        self.assertIn("“Assess approval controls”", saved.executive_summary)
        self.assertIn("“Unauthorized approval override”", saved.executive_summary)
        self.assertIn("the referenced test", saved.executive_summary)
        def assert_display_fields(item):
            if isinstance(item, dict):
                for key, value in item.items():
                    if key in TEXT_FIELDS or key in TEXT_LISTS:
                        self.assertNotRegex(str(value), r"(?:obj|risk|test|ws)_")
                    else:
                        assert_display_fields(value)
            elif isinstance(item, list):
                for value in item:
                    assert_display_fields(value)
        assert_display_fields(result.model_dump())
        assert_display_fields(saved.model_dump())

    def test_old_and_stale_reviews_are_readable_without_rewriting_persistence(self):
        from app.features.planning_readiness.models import PlanningAIReviewResult, PlanningAIReviewFinding, PlanningAIReviewError
        plan = self._complete_plan()
        project_store.save_planning(self.project.id, plan)
        state = project_store.load_planning_readiness(self.project.id)
        state.latest_successful_ai_review = PlanningAIReviewResult(score=80, plan_fingerprint="old-plan",
            executive_summary="obj_approval needs work; risk_deadbeef00 was removed.",
            warnings=[PlanningAIReviewFinding(id="finding-internal", category="Coverage",
                explanation="risk_deadbeef00 is duplicated by risk_override.",
                affected_artifact_ids=["risk_deadbeef00"], affected_artifact_names=["Former approval risk"])])
        state.latest_error = PlanningAIReviewError(error_message="Review failed for obj_approval")
        project_store.save_planning_readiness(self.project.id, state)
        original = state.model_dump()
        result = planning_readiness_service.get_readiness(self.project.id)
        self.assertTrue(result.ai_review.stale)
        self.assertIsNone(result.overall_score)
        self.assertIn("Assess approval controls", result.ai_review.executive_summary)
        self.assertIn("Former approval risk", result.ai_review.executive_summary)
        self.assertNotIn("obj_approval", result.ai_error.error_message)
        self.assertEqual(result.ai_review.warnings[0].affected_artifact_ids, ["risk_deadbeef00"])
        self.assertEqual(project_store.load_planning_readiness(self.project.id).model_dump(), original)

    def test_deterministic_branches_and_invalid_edges_use_labels_with_missing_titles(self):
        plan = self._complete_plan()
        objective = plan.workstreams[0].objectives[0]
        objective.title = ""
        project_store.save_planning(self.project.id, plan)
        project_store.save_map_state(self.project.id, MapState(edges=[FlowEdge(id="bad", source="risk_override", target="obj_approval")]))
        result = planning_readiness_service.deterministic_readiness(self.project.id)
        edge = next(item for item in result.findings if item.check_name == "Invalid planning relationship")
        self.assertEqual(edge.affected_artifact_ids, ["risk_override", "obj_approval"])
        self.assertEqual(edge.affected_artifact_names, ["Unauthorized approval override", objective.description])
        missing = next(item for item in result.findings if item.check_name == "Objective title missing")
        self.assertIn("Untitled objective", missing.branch)
        self.assertEqual(missing.navigation.node_id, objective.id)
        self.assertNotIn(objective.id, missing.branch)

    def test_readable_labels_disambiguate_duplicates_and_preserve_ordinary_numbers(self):
        from app.features.planning_readiness.display_text import artifact_catalog, readable_readiness
        from app.features.planning_readiness.models import PlanningAIReviewResult
        plan = self._complete_plan()
        second = plan.workstreams[0].model_copy(deep=True)
        second.id = "ws_second"
        second.name = "Travel Documentation"
        second.objectives[0].id = "obj_second"
        second.objectives[0].risks[0].id = "risk_second"
        second.objectives[0].risks[0].tests = []
        plan.workstreams.append(second)
        review = PlanningAIReviewResult(score=80, executive_summary="risk_override and risk_second duplicate coverage of ISO 27001 and FY2026 and invoice_1234567890; test_0123456789 is unavailable.")
        result = readable_readiness(review, artifact_catalog(self.project, plan))
        self.assertIn("Procurement Governance", result.executive_summary)
        self.assertIn("Travel Documentation", result.executive_summary)
        self.assertIn("ISO 27001 and FY2026 and invoice_1234567890", result.executive_summary)
        self.assertNotRegex(result.executive_summary, r"risk_override|risk_second|test_0123456789")
        self.assertEqual(readable_readiness(result, artifact_catalog(self.project, plan)), result)
        self.assertIn("risk_override", review.executive_summary)

    def _complete_plan(self) -> PlanningState:
        test = Test(
            id="test_approval_sample",
            title="Sample purchase approvals",
            test_type="Detailed Test",
            test_objective="Confirm sampled purchases have evidence of required approval.",
            description="Select purchase transactions and inspect approval records against the delegation matrix.",
            expected_evidence="Purchase request records, approval workflow logs, and delegation matrix extracts.",
            sample_considerations="Include high-value and override transactions.",
        )
        risk = Risk(
            id="risk_override",
            title="Unauthorized approval override",
            description="Users may bypass required approval controls for purchase transactions.",
            why_it_matters="Unauthorized approvals can cause inappropriate spending and policy breaches.",
            potential_impact="Financial loss, compliance exposure, and weak accountability.",
            severity="High",
            tests=[test],
        )
        objective = Objective(
            id="obj_approval",
            title="Assess approval controls",
            description="Confirm purchasing approval controls are designed and evidenced.",
            risks=[risk],
        )
        workstream = Workstream(
            id="ws_procure",
            name="Procurement Governance",
            description="Governance and control ownership over procurement activity.",
            rationale="Procurement is in scope because manual overrides were identified as the initial concern.",
            objectives=[objective],
        )
        return PlanningState(stage="tests_generated", workstreams=[workstream])


if __name__ == "__main__":
    unittest.main()
