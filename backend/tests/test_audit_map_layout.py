from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.models import AgentState, AuditCreate, AutoLayoutRequest, MapState, PlanningState, Workstream
from app.services.audit_map_service import audit_map_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


class AuditMapLayoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        settings.projects_dir = Path(self.temp_dir.name)
        settings.projects_dir.mkdir(parents=True, exist_ok=True)
        project_store.file_store = FileStore(settings.projects_dir)
        self.project = project_store.create_project(AuditCreate(title="Procurement Audit", description="Review procurement controls."))
        project_store.save_planning(
            self.project.id,
            PlanningState(workstreams=[Workstream(id="ws_procurement", name="Procurement Governance")]),
        )
        project_store.save_map_state(
            self.project.id,
            MapState(
                agents=[
                    AgentState(
                        id="agent_workstreams",
                        type="workstream_generator",
                        title="Workstream Generator",
                        prompt="Generate workstreams.",
                    )
                ]
            ),
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_horizontal_gap_does_not_move_audit_or_workstream_generator(self) -> None:
        positions = []
        for horizontal_gap in [620, 1000, 1600]:
            audit_map = audit_map_service.auto_layout(
                self.project.id,
                AutoLayoutRequest(horizontal_gap=horizontal_gap, vertical_gap=50, card_width=560, phase_gap=160),
            )
            nodes = {node.id: node for node in audit_map.nodes}
            positions.append(
                (
                    nodes[self.project.id].position["x"],
                    nodes["agent_workstreams"].position["x"],
                    nodes["phase-planning"].position["x"],
                )
            )

        self.assertEqual(len(set(positions)), 1)
        audit_x, agent_x, planning_x = positions[0]
        self.assertLess(audit_x, planning_x)
        self.assertEqual(agent_x, audit_x)


if __name__ == "__main__":
    unittest.main()
