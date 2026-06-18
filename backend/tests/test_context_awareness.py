from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.context.context_pack_builder import context_pack_builder
from app.models import (
    AgentState,
    AuditCreate,
    DocumentRequest,
    DocumentRequestState,
    FieldworkItem,
    FieldworkState,
    Finding,
    FindingsState,
    FlowEdge,
    InterviewPlan,
    InterviewQuestion,
    InterviewRole,
    MapState,
    Objective,
    PlanningState,
    Risk,
    Test,
    Workstream,
)
from app.services.audit_graph_service import audit_graph_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


class ContextAwarenessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        settings.projects_dir = Path(self.temp_dir.name)
        settings.projects_dir.mkdir(parents=True, exist_ok=True)
        project_store.file_store = FileStore(settings.projects_dir)

        self.project = project_store.create_project(
            AuditCreate(
                title="Procurement Audit",
                description="Review procurement approvals, vendor onboarding, and invoice matching.",
                process_area="Procurement",
                initial_concern="Manual approval overrides",
                extra_context="Focus on EU operations and high-value vendors.",
            )
        )
        self.workstream = Workstream(id="ws_procure", name="Procurement Governance", description="Governance and control ownership")
        self.objective = Objective(id="obj_approval", title="Assess approval controls", description="Confirm approvals are designed and evidenced")
        self.other_objective = Objective(id="obj_vendor", title="Assess vendor onboarding", description="Confirm vendor onboarding controls")
        self.risk = Risk(id="risk_override", title="Unauthorized approval override", description="Users may bypass required approval")
        self.other_risk = Risk(id="risk_vendor_due_diligence", title="Incomplete vendor due diligence", description="Vendor checks may be incomplete")
        self.test = Test(id="test_approval_sample", title="Sample purchase approvals", description="Inspect approval evidence")
        self.other_test = Test(id="test_vendor_master", title="Inspect vendor master changes", description="Review vendor master change evidence")
        self.risk.tests.append(self.test)
        self.other_risk.tests.append(self.other_test)
        self.objective.risks.append(self.risk)
        self.other_objective.risks.append(self.other_risk)
        self.workstream.objectives.append(self.objective)
        self.workstream.objectives.append(self.other_objective)
        project_store.save_planning(self.project.id, PlanningState(stage="tests_generated", workstreams=[self.workstream]))

        self.fieldwork_item = FieldworkItem(
            id="fw_approval_sample",
            test_id=self.test.id,
            title="Execute approval sample",
            description="Test sampled approvals",
            status="Issue Identified",
            finding_ids=["finding_missing_approval"],
        )
        project_store.save_fieldwork(self.project.id, FieldworkState(items=[self.fieldwork_item]))
        project_store.save_findings(
            self.project.id,
            FindingsState(
                findings=[
                    Finding(
                        id="finding_missing_approval",
                        title="Missing approval evidence",
                        issue="Two sampled items lacked approval evidence.",
                        linked_fieldwork_item_id=self.fieldwork_item.id,
                    )
                ]
            ),
        )
        project_store.save_document_requests(
            self.project.id,
            DocumentRequestState(
                requests=[
                    DocumentRequest(
                        id="doc_approval_matrix",
                        title="Approval matrix",
                        expected_document="Current approval matrix",
                        source_node_id=self.risk.id,
                    ),
                    DocumentRequest(
                        id="doc_vendor_master",
                        title="Vendor master extract",
                        expected_document="Vendor master change listing",
                    ),
                    DocumentRequest(
                        id="doc_orphan",
                        title="Unlinked policy",
                        expected_document="Policy document",
                    ),
                ]
            ),
        )
        project_store.save_interviews(
            self.project.id,
            InterviewPlan(
                roles=[
                    InterviewRole(
                        id="role_procurement_owner",
                        role_title="Procurement Owner",
                        questions=[
                            InterviewQuestion(
                                id="iq_override_review",
                                question_text="How are approval overrides reviewed?",
                                mapped_risk_id=self.risk.id,
                            )
                        ],
                    )
                ]
            ),
        )
        self.agent = AgentState(
            id="agent_risk",
            type="risk_generator",
            title="Risk Generator",
            prompt="Generate procurement risks.",
        )
        project_store.save_map_state(
            self.project.id,
            MapState(
                agents=[self.agent],
                edges=[
                    FlowEdge(id=f"{self.objective.id}->{self.agent.id}", source=self.objective.id, target=self.agent.id),
                    FlowEdge(id=f"{self.objective.id}->{self.other_risk.id}", source=self.objective.id, target=self.other_risk.id),
                    FlowEdge(id=f"{self.risk.id}->{self.other_test.id}", source=self.risk.id, target=self.other_test.id),
                    FlowEdge(id=f"{self.test.id}->doc_vendor_master", source=self.test.id, target="doc_vendor_master"),
                ],
            ),
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_graph_traversal_and_objective_chain(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)

        related = audit_graph_service.get_related_items(graph, self.objective.id, depth=2, direction="downstream")
        related_ids = {entry["item"]["id"] for entry in related}

        self.assertIn(self.risk.id, related_ids)
        self.assertIn(self.test.id, related_ids)

        chain = audit_graph_service.get_objective_chain(graph, self.objective.id)
        self.assertEqual(chain["objective"]["id"], self.objective.id)
        self.assertIn(self.risk.id, {item["id"] for item in chain["risks"]})
        self.assertIn(self.other_risk.id, {item["id"] for item in chain["risks"]})
        self.assertIn(self.test.id, {item["id"] for item in chain["tests"]})
        self.assertIn(self.fieldwork_item.id, {item["id"] for item in chain["fieldwork_items"]})
        self.assertEqual([item["id"] for item in chain["findings"]], ["finding_missing_approval"])
        self.assertEqual({item["id"] for item in chain["report_sections"]}, {"report-main", "executive-summary"})
        self.assertEqual([item["id"] for item in chain["interview_questions"]], ["iq_override_review"])
        self.assertEqual([item["id"] for item in chain["interview_roles"]], ["role_procurement_owner"])

    def test_semantic_canvas_edges_and_default_agent_exclusion(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)
        canvas_relationships = [
            relationship
            for relationship in graph.relationships
            if relationship.metadata.get("source") == "canvas"
        ]
        by_pair = {(relationship.source_id, relationship.target_id): relationship for relationship in canvas_relationships}

        self.assertEqual(by_pair[(self.objective.id, self.other_risk.id)].type, "contains")
        self.assertTrue(by_pair[(self.objective.id, self.other_risk.id)].metadata["semantic"])
        self.assertEqual(by_pair[(self.risk.id, self.other_test.id)].type, "contains")
        self.assertEqual(by_pair[(self.test.id, "doc_vendor_master")].type, "requires_document")

        related = audit_graph_service.get_related_items(graph, self.objective.id, depth=1, direction="both")
        self.assertNotIn(self.agent.id, {entry["item"]["id"] for entry in related})

    def test_risk_and_test_chain_include_report_sections(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)

        risk_chain = audit_graph_service.get_risk_chain(graph, self.risk.id)
        test_chain = audit_graph_service.get_test_chain(graph, self.test.id)

        self.assertEqual({item["id"] for item in risk_chain["report_sections"]}, {"report-main", "executive-summary"})
        self.assertEqual({item["id"] for item in test_chain["report_sections"]}, {"report-main", "executive-summary"})

    def test_context_pack_builder_uses_default_recipe(self) -> None:
        pack = context_pack_builder.build(self.project.id, self.agent, [self.objective.id])

        self.assertEqual(pack.recipe_id, "risk_generator_default")
        self.assertEqual(pack.context_summary.selected_item_count, 1)
        self.assertIn("selected_items", pack.context_summary.blocks)
        self.assertIn("connected_items", pack.context_summary.blocks)
        self.assertIn("# Audit Context Pack", pack.rendered_context)
        self.assertIn("## Instructions for Context Use", pack.rendered_context)

    def test_traceability_chain_block_and_existing_outputs(self) -> None:
        test_agent = AgentState(
            id="agent_test",
            type="test_generator",
            title="Test Generator",
            prompt="Generate tests.",
        )
        pack = context_pack_builder.build(self.project.id, test_agent, [self.risk.id])
        block_ids = [block.block_id for block in pack.blocks]
        existing_outputs = next(block for block in pack.blocks if block.block_id == "existing_outputs")

        self.assertIn("traceability_chain", block_ids)
        self.assertIn(self.risk.id, existing_outputs.content["outputs_by_source"])
        self.assertEqual(existing_outputs.content["outputs_by_source"][self.risk.id][0]["id"], self.test.id)

    def test_relationship_gaps_include_supported_issues(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)
        gap_types = {gap["gap_type"] for gap in audit_graph_service.get_relationship_gaps(graph)}

        self.assertIn("document_request_without_test_or_source", gap_types)
        self.assertIn("finding_without_recommendation", gap_types)
        self.assertIn("finding_without_impact", gap_types)

    def test_context_pack_fallback_and_truncation_metadata(self) -> None:
        future_agent = AgentState(
            id="agent_future",
            type="future_quality_reviewer",
            title="Future Reviewer",
            prompt="Review quality.",
        )
        self.project.description = "Long context. " * 2000
        project_store.save_project(self.project)

        pack = context_pack_builder.build(
            self.project.id,
            future_agent,
            [self.objective.id],
            {"max_context_tokens": 500, "summary_mode": "detailed", "detail_mode": "full_with_limits"},
        )

        self.assertTrue(pack.context_summary.fallback_recipe)
        self.assertEqual(pack.recipe_id, "future_quality_reviewer_fallback")
        self.assertTrue(pack.limits.truncated)
        self.assertIn("## Instructions for Context Use", pack.rendered_context)


if __name__ == "__main__":
    unittest.main()
