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
    FieldworkItem,
    FieldworkState,
    Finding,
    FindingsState,
    FlowEdge,
    MapState,
    Objective,
    PlanningState,
    Risk,
    Test,
    Workstream,
)
from app.services.audit_graph_service import audit_graph_service
from app.services.audit_map_service import audit_map_service
from app.services.agent_service import agent_service
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
        related = audit_graph_service.get_related_items(graph, self.objective.id, depth=1, direction="both")
        self.assertNotIn(self.agent.id, {entry["item"]["id"] for entry in related})

    def test_removed_planning_artifacts_are_not_canvas_artifacts(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)

        self.assertEqual(graph.items[self.fieldwork_item.id].phase, "fieldwork")

        audit_map = audit_map_service.build(self.project.id)
        nodes_by_id = {node.id: node for node in audit_map.nodes}
        self.assertEqual(nodes_by_id["fieldwork-section-issues"].data["phase"], "fieldwork")

    def test_partial_phase_layouts_are_completed_for_map_compatibility(self) -> None:
        project_dir = project_store.project_dir(self.project.id)
        project_store.file_store.write_json(
            project_dir / "map_state.json",
            {
                "phaseLayouts": {
                    "planning": {"x": 10, "y": 20, "width": 2500, "height": 900},
                },
                "nodePositions": {},
                "nodeDimensions": {},
                "edges": [],
                "agents": [],
            },
        )

        map_state = project_store.load_map_state(self.project.id)
        self.assertEqual(map_state.phaseLayouts["planning"].x, 10)
        self.assertIn("fieldwork", map_state.phaseLayouts)
        self.assertIn("reporting", map_state.phaseLayouts)

        audit_map = audit_map_service.build(self.project.id)
        node_ids = {node.id for node in audit_map.nodes}
        self.assertIn("phase-fieldwork", node_ids)
        self.assertIn("phase-reporting", node_ids)

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
        self.assertEqual(pack.context_summary.blocks, ["global_audit_knowledge", "current_task"])
        self.assertNotIn("connected_items", pack.context_summary.blocks)
        global_knowledge = next(block for block in pack.blocks if block.block_id == "global_audit_knowledge")
        current_task = next(block for block in pack.blocks if block.block_id == "current_task")
        objective_items = global_knowledge.content["planning"]["objective"]["items"]
        self.assertIn(self.objective.id, {item["id"] for item in objective_items})
        self.assertEqual(current_task.content["focus_items"][0]["item"]["id"], self.objective.id)
        self.assertIn("# Audit Context Pack", pack.rendered_context)
        self.assertIn("## Global Audit Knowledge", pack.rendered_context)
        self.assertIn("## Current Task", pack.rendered_context)
        self.assertIn("## Instructions", pack.rendered_context)

    def test_agent_input_resolution_falls_back_to_saved_connections(self) -> None:
        resolved = agent_service._resolve_agent_input_node_ids(
            self.project.id,
            project_store.load_map_state(self.project.id),
            self.agent,
            ["stale_node_id"],
        )

        self.assertEqual(resolved, [self.objective.id])

    def test_traceability_chain_block_and_existing_outputs(self) -> None:
        test_agent = AgentState(
            id="agent_test",
            type="test_generator",
            title="Test Generator",
            prompt="Generate tests.",
        )
        pack = context_pack_builder.build(self.project.id, test_agent, [self.risk.id])
        block_ids = [block.block_id for block in pack.blocks]
        current_task = next(block for block in pack.blocks if block.block_id == "current_task")

        self.assertNotIn("traceability_chain", block_ids)
        self.assertNotIn("connected_items", block_ids)
        self.assertNotIn("workflow_state", block_ids)
        self.assertIn(self.risk.id, current_task.content["existing_outputs_to_avoid"])
        self.assertEqual(current_task.content["existing_outputs_to_avoid"][self.risk.id][0]["id"], self.test.id)
        self.assertEqual(current_task.content["focus_items"][0]["parent_hierarchy"][0]["id"], self.project.id)

    def test_relationship_gaps_include_supported_issues(self) -> None:
        graph = audit_graph_service.build_graph(self.project.id)
        gap_types = {gap["gap_type"] for gap in audit_graph_service.get_relationship_gaps(graph)}

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
        self.assertIn("## Instructions", pack.rendered_context)


if __name__ == "__main__":
    unittest.main()
