from __future__ import annotations

import sys
import tempfile
import unittest
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
from app.services.planning_readiness_service import planning_readiness_service
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

        self.assertEqual(review.score, 100)
        self.assertEqual(review.critical_gaps[0].priority, "Important")
        self.assertEqual(review.critical_gaps[0].severity, "medium")
        self.assertEqual(review.critical_gaps[0].confidence, 0.7)
        self.assertEqual(review.critical_gaps[0].affected_artifact_ids, [])

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
