from __future__ import annotations

import sys
import tempfile
import unittest
import asyncio
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.context.context_pack_builder import context_pack_builder
from app.context import recipes as context_recipes
from app.context.models import ContextRecipe
from app.context.policy import PLANNING_CONTEXT_DOMAIN
from app.models import (
    AgentState,
    AgentRunRequest,
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
from app.services.audit_context_snapshot_service import audit_context_snapshot_service
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

    def assert_no_downstream_context(self, pack) -> None:
        forbidden_terms = [
            "fieldwork",
            "finding",
            "findings",
            "reporting",
            "report-main",
            "executive-summary",
            "report_without_findings",
            "test_without_fieldwork",
            "fieldwork_without_finding",
            "finding_without_report",
            "finding_without_recommendation",
            "finding_without_impact",
            "Missing approval evidence",
            "Execute approval sample",
            "Draft Report",
            "Executive Summary",
        ]
        rendered = pack.rendered_context.lower()
        for term in forbidden_terms:
            self.assertNotIn(term.lower(), rendered)

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
        self.assertNotIn("fieldwork", global_knowledge.content)
        self.assertNotIn("findings", global_knowledge.content)
        self.assertNotIn("reporting", global_knowledge.content)
        self.assertNotIn("report", global_knowledge.content["item_counts"])
        self.assertNotIn("fieldwork_item", global_knowledge.content["item_counts"])
        self.assertNotIn("finding", global_knowledge.content["item_counts"])
        self.assertNotIn("report_without_findings", {gap["gap_type"] for gap in global_knowledge.content["relationship_gaps"]})
        self.assertIn("Audit description:", global_knowledge.content["summary_text"])
        self.assertNotIn("Scope:", global_knowledge.content["summary_text"])
        self.assertEqual(current_task.content["focus_items"][0]["item"]["id"], self.objective.id)
        self.assertIn("# Audit Context Pack", pack.rendered_context)
        self.assertIn("## Global Audit Knowledge", pack.rendered_context)
        self.assertIn("## Current Task", pack.rendered_context)
        self.assertIn("## Instructions", pack.rendered_context)
        self.assertNotIn('"reporting"', pack.rendered_context)
        self.assertNotIn('"fieldwork"', pack.rendered_context)
        self.assert_no_downstream_context(pack)

    def test_all_planning_agents_receive_planning_only_global_context(self) -> None:
        selected_by_agent = {
            "workstream_generator": [self.project.id],
            "objective_generator": [self.workstream.id],
            "risk_generator": [self.objective.id],
            "test_generator": [self.risk.id],
        }
        for agent_type, selected_ids in selected_by_agent.items():
            with self.subTest(agent_type=agent_type):
                agent = AgentState(id=f"agent_{agent_type}", type=agent_type, title=agent_type, prompt="Run planning agent.")
                pack = context_pack_builder.build(self.project.id, agent, selected_ids)
                global_knowledge = next(block for block in pack.blocks if block.block_id == "global_audit_knowledge")
                self.assertEqual(global_knowledge.content["current_phase"], "planning")
                self.assertNotIn("stale", global_knowledge.content)
                self.assertNotIn("truncated", global_knowledge.content)
                self.assertFalse(global_knowledge.metadata.truncated)
                self.assert_no_downstream_context(pack)

    def test_planning_agent_drops_downstream_selected_items(self) -> None:
        report_agent = AgentState(id="agent_plan", type="risk_generator", title="Risk Generator", prompt="Generate risks.")
        recipe = ContextRecipe(
            recipe_id="planning_policy_test",
            agent_id="risk_generator",
            context_domain=PLANNING_CONTEXT_DOMAIN,
            blocks=["global_audit_knowledge", "selected_items", "connected_items", "current_task"],
        )
        for selected_id in [self.fieldwork_item.id, "finding_missing_approval", "report-main", "executive-summary"]:
            with self.subTest(selected_id=selected_id):
                pack = context_pack_builder.build_with_recipe(self.project.id, report_agent, recipe, [selected_id])
                current_task = next(block for block in pack.blocks if block.block_id == "current_task")
                selected_items = next(block for block in pack.blocks if block.block_id == "selected_items")
                connected_items = next(block for block in pack.blocks if block.block_id == "connected_items")
                self.assertEqual(current_task.content["focus_items"], [])
                self.assertEqual(selected_items.content["items"], [])
                self.assertEqual(connected_items.content["items"], [])
                self.assert_no_downstream_context(pack)

    def test_planning_policy_omits_unsafe_blocks(self) -> None:
        agent = AgentState(id="agent_plan", type="risk_generator", title="Risk Generator", prompt="Generate risks.")
        recipe = ContextRecipe(
            recipe_id="planning_unsafe_blocks_test",
            agent_id="risk_generator",
            context_domain=PLANNING_CONTEXT_DOMAIN,
            blocks=[
                "global_audit_knowledge",
                "relationship_gaps",
                "traceability_chain",
                "workflow_state",
                "fieldwork_summary",
                "findings_summary",
                "reporting_summary",
                "current_task",
            ],
        )

        pack = context_pack_builder.build_with_recipe(self.project.id, agent, recipe, [self.risk.id])

        self.assertEqual(pack.context_summary.blocks, ["global_audit_knowledge", "current_task"])
        self.assertNotIn("test_without_fieldwork", pack.rendered_context)
        self.assertNotIn("fieldwork_items", pack.rendered_context)
        self.assertNotIn("report_sections", pack.rendered_context)
        self.assert_no_downstream_context(pack)

    def test_planning_policy_removes_downstream_relationship_types_between_planning_nodes(self) -> None:
        map_state = project_store.load_map_state(self.project.id)
        map_state.edges.append(
            FlowEdge(
                id=f"{self.workstream.id}->{self.risk.id}",
                source=self.workstream.id,
                target=self.risk.id,
                data={"relationship_type": "reported_in"},
            )
        )
        project_store.save_map_state(self.project.id, map_state)
        agent = AgentState(id="agent_plan", type="risk_generator", title="Risk Generator", prompt="Generate risks.")
        recipe = ContextRecipe(
            recipe_id="planning_relationship_type_test",
            agent_id="risk_generator",
            context_domain=PLANNING_CONTEXT_DOMAIN,
            blocks=["connected_items"],
            relationship_depth=1,
            direction="downstream",
        )

        pack = context_pack_builder.build_with_recipe(self.project.id, agent, recipe, [self.workstream.id])

        self.assertNotIn("reported_in", pack.rendered_context)
        self.assert_no_downstream_context(pack)

    def test_planning_agent_structured_and_all_summary_modes_are_planning_only(self) -> None:
        agent = AgentState(id="agent_plan", type="risk_generator", title="Risk Generator", prompt="Generate risks.")
        for options in [
            {"summary_mode": "structured"},
            {"detail_mode": "all_summary"},
            {"summary_mode": "structured", "detail_mode": "all_summary"},
        ]:
            with self.subTest(options=options):
                pack = context_pack_builder.build(self.project.id, agent, [self.objective.id], options)
                global_knowledge = next(block for block in pack.blocks if block.block_id == "global_audit_knowledge")
                structured = global_knowledge.content.get("structured_summary", {})
                self.assertIn("structured_summary", global_knowledge.content)
                self.assertNotIn("fieldwork_summary", structured)
                self.assertNotIn("findings_summary", structured)
                self.assertNotIn("reporting_summary", structured)
                self.assert_no_downstream_context(pack)

    def test_downstream_only_snapshot_stale_does_not_affect_planning_context(self) -> None:
        audit_context_snapshot_service.rebuild(self.project.id)
        before = context_pack_builder.build(self.project.id, self.agent, [self.objective.id])
        before_global = next(block for block in before.blocks if block.block_id == "global_audit_knowledge").content
        project_store.save_fieldwork(
            self.project.id,
            FieldworkState(
                items=[
                    self.fieldwork_item,
                    FieldworkItem(id="fw_downstream_only", test_id=self.test.id, title="Downstream only item"),
                ]
            ),
        )

        pack = context_pack_builder.build(self.project.id, self.agent, [self.objective.id])
        global_knowledge = next(block for block in pack.blocks if block.block_id == "global_audit_knowledge")
        self.assertNotIn("stale", global_knowledge.content)
        self.assertEqual(global_knowledge.metadata.notes, [])
        self.assertEqual(before_global, global_knowledge.content)
        self.assert_no_downstream_context(pack)

    def test_downstream_only_snapshot_truncation_does_not_affect_planning_context(self) -> None:
        project_store.save_fieldwork(
            self.project.id,
            FieldworkState(
                items=[
                    FieldworkItem(id=f"fw_downstream_{index}", test_id=self.test.id, title=f"Downstream item {index}")
                    for index in range(20)
                ]
            ),
        )
        audit_context_snapshot_service.rebuild(self.project.id)

        pack = context_pack_builder.build(self.project.id, self.agent, [self.objective.id])
        global_knowledge = next(block for block in pack.blocks if block.block_id == "global_audit_knowledge")
        self.assertNotIn("truncated", global_knowledge.content)
        self.assertNotIn("generated_at", global_knowledge.content)
        self.assertNotIn("generation_mode", global_knowledge.content)
        self.assertFalse(global_knowledge.metadata.truncated)
        self.assert_no_downstream_context(pack)

    def test_known_planning_agents_have_planning_domain_recipes(self) -> None:
        for agent_type in ["workstream_generator", "objective_generator", "risk_generator", "test_generator"]:
            with self.subTest(agent_type=agent_type):
                recipe, fallback = context_recipes.get_context_recipe(agent_type)
                self.assertFalse(fallback)
                self.assertEqual(recipe.context_domain, PLANNING_CONTEXT_DOMAIN)

    def test_planning_run_with_only_downstream_inputs_fails_cleanly(self) -> None:
        with self.assertRaises(HTTPException) as error:
            asyncio.run(
                agent_service.run(
                    self.project.id,
                    self.agent.id,
                    AgentRunRequest(input_node_ids=[self.fieldwork_item.id]),
                )
            )

        self.assertIn("Planning agents can only run with planning inputs", str(error.exception.detail))

    def test_final_llm_request_for_planning_agent_is_downstream_free(self) -> None:
        pack = context_pack_builder.build(self.project.id, self.agent, [self.objective.id])
        rendered = agent_service._render_llm_request(
            pack,
            "Generate risks.",
            {"selected_item_ids": [self.objective.id]},
            {"risks": [{"title": "..."}]},
        )

        self.assert_no_downstream_context(type("Pack", (), {"rendered_context": rendered})())

    def test_fieldwork_and_reporting_agents_keep_full_global_context(self) -> None:
        finding_agent = AgentState(id="agent_finding", type="finding_draft_agent", title="Finding Draft Agent", prompt="Draft finding.")
        report_agent = AgentState(id="agent_report", type="report_draft_agent", title="Report Draft Agent", prompt="Draft report.")

        finding_pack = context_pack_builder.build(self.project.id, finding_agent, [self.fieldwork_item.id])
        finding_global = next(block for block in finding_pack.blocks if block.block_id == "global_audit_knowledge")
        self.assertIn("fieldwork", finding_global.content)
        self.assertIn("findings", finding_global.content)
        self.assertIn("reporting", finding_global.content)

        report_pack = context_pack_builder.build(self.project.id, report_agent, [])
        report_global = next(block for block in report_pack.blocks if block.block_id == "global_audit_knowledge")
        self.assertIn("fieldwork", report_global.content)
        self.assertIn("findings", report_global.content)
        self.assertIn("reporting", report_global.content)

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
