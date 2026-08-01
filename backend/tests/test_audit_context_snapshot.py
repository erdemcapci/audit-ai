from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.context.context_pack_builder import context_pack_builder
from app.models import AuditCreate, Objective, PlanningState, Risk, Workstream
from app.services.audit_context_snapshot_service import AuditContextSnapshotService
from app.store.file_store import FileStore
from app.store.project_store import project_store


class AuditContextSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_projects_dir = settings.projects_dir
        settings.projects_dir = Path(self.temp_dir.name)
        settings.projects_dir.mkdir(parents=True, exist_ok=True)
        project_store.file_store = FileStore(settings.projects_dir)
        self.service = AuditContextSnapshotService()
        self.project = project_store.create_project(
            AuditCreate(
                title="Procurement Audit",
                description="Review vendor onboarding and invoice approvals.",
                process_area="Procurement",
                initial_concern="Manual approval overrides",
            )
        )
        objective = Objective(id="obj_approval", title="Assess approval controls", description="Review approval design")
        objective.risks.append(Risk(id="risk_override", title="Unauthorized override", description="Approvals may be bypassed"))
        workstream = Workstream(id="ws_procurement", name="Procurement Governance", objectives=[objective])
        project_store.save_planning(self.project.id, PlanningState(stage="risks_generated", workstreams=[workstream]))

    def tearDown(self) -> None:
        settings.projects_dir = self.original_projects_dir
        project_store.file_store = FileStore(settings.projects_dir)
        self.temp_dir.cleanup()

    def test_rebuild_creates_compact_snapshot(self) -> None:
        snapshot = self.service.rebuild(self.project.id)

        self.assertEqual(snapshot.project_id, self.project.id)
        self.assertFalse(snapshot.stale)
        self.assertEqual(snapshot.generation_mode, "deterministic")
        self.assertIn("Audit: Procurement Audit", snapshot.summary_text)
        self.assertEqual(snapshot.item_counts["workstream"], 1)
        self.assertEqual(snapshot.item_counts["objective"], 1)
        self.assertEqual(snapshot.item_counts["risk"], 1)
        self.assertIn("planning_summary", snapshot.source_sections_used)
        self.assertEqual(snapshot.structured_summary["fieldwork_summary"]["fieldwork_item"]["count"], 0)

    def test_snapshot_stale_when_source_changes(self) -> None:
        snapshot = self.service.rebuild(self.project.id)
        planning = project_store.load_planning(self.project.id)
        planning.workstreams.append(Workstream(id="ws_new", name="New Workstream"))
        project_store.save_planning(self.project.id, planning)

        loaded = self.service.get_snapshot(self.project.id)

        self.assertIsNotNone(loaded)
        self.assertNotEqual(snapshot.source_fingerprint, self.service.source_fingerprint(self.project.id))
        self.assertTrue(loaded.stale)

    def test_context_pack_can_include_snapshot_block(self) -> None:
        self.service.rebuild(self.project.id)
        pack = context_pack_builder.build(self.project.id, project_store.load_map_state(self.project.id).agents[0] if project_store.load_map_state(self.project.id).agents else self._agent())

        block = next(item for item in pack.blocks if item.block_id == "global_audit_knowledge")
        self.assertFalse(block.content["stale"])
        self.assertIn("summary_text", block.content)
        self.assertIn("planning", block.content)
        self.assertEqual(block.content["planning"]["objective"]["items"][0]["id"], "obj_approval")
        self.assertIn("truncated", block.content)
        self.assertNotIn("structured_summary", block.content)

    def _agent(self):
        from app.models import AgentState

        return AgentState(id="agent_risk", type="risk_generator", title="Risk Generator", prompt="Generate risks.")


if __name__ == "__main__":
    unittest.main()
