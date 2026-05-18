from app.models import FieldworkCreateFromPlanningRequest, FieldworkItem, FieldworkState
from app.services.audit_map_service import PHASE_PADDING, calculate_required_node_size
from app.store.project_store import project_store


def fieldwork_source_id(item: FieldworkItem) -> str:
    return item.source_test_id or item.test_id


class FieldworkService:
    def create_from_planning(self, project_id: str, request: FieldworkCreateFromPlanningRequest | None = None) -> FieldworkState:
        mode = (request or FieldworkCreateFromPlanningRequest()).mode
        planning = project_store.load_planning(project_id)
        existing = project_store.load_fieldwork(project_id)
        map_state = project_store.load_map_state(project_id)
        fieldwork_layout = map_state.phaseLayouts["fieldwork"]
        built_map = __import__("app.services.audit_map_service", fromlist=["audit_map_service"]).audit_map_service.build(project_id)
        test_positions = {node.id: node.position for node in built_map.nodes if node.type == "testNode"}
        test_ids = {
            test.id
            for workstream in planning.workstreams
            for objective in workstream.objectives
            for risk in objective.risks
            for test in risk.tests
        }

        for existing_item in existing.items:
            if not existing_item.source_test_id:
                existing_item.source_test_id = existing_item.test_id
        existing_by_test = {fieldwork_source_id(item): item for item in existing.items}
        if mode == "replace":
            removed_ids = [item.id for item in existing.items if fieldwork_source_id(item) in test_ids]
            existing.items = [item for item in existing.items if fieldwork_source_id(item) not in test_ids]
            existing_by_test = {}
            for item_id in removed_ids:
                map_state.nodePositions.pop(item_id, None)
                map_state.nodeDimensions.pop(item_id, None)
                map_state.edges = [edge for edge in map_state.edges if edge.source != item_id and edge.target != item_id]
        elif mode == "keep":
            return project_store.save_fieldwork(project_id, existing)

        items: list[FieldworkItem] = list(existing.items)
        occupied_y = [
            position.get("y", 0)
            for item in items
            if (position := map_state.nodePositions.get(item.id))
        ]
        next_y = max(occupied_y, default=fieldwork_layout.y + PHASE_PADDING["top"] + 40)
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                for risk in objective.risks:
                    for test in risk.tests:
                        if test.id in existing_by_test:
                            continue
                        item = FieldworkItem(
                            test_id=test.id,
                            source_test_id=test.id,
                            title=test.title,
                            test_type=test.test_type,
                            description=test.description,
                            expected_evidence=test.expected_evidence,
                            evidence_placeholder=f"Add evidence for {test.title}",
                        )
                        items.append(item)

                        test_y = test_positions.get(test.id, {}).get("y")
                        candidate_y = float(test_y if test_y is not None else next_y)
                        while any(abs(candidate_y - existing_y) < 140 for existing_y in occupied_y):
                            candidate_y += 140
                        occupied_y.append(candidate_y)
                        next_y = max(next_y, candidate_y + 140)
                        map_state.nodePositions[item.id] = {"x": fieldwork_layout.x + PHASE_PADDING["left"], "y": candidate_y}
                        size = calculate_required_node_size(
                            {"title": item.title, "description": item.description, "testType": item.test_type, "itemStatus": item.status},
                            "fieldworkItemNode",
                            map_state.nodeDimensions.get(item.id, {}).get("width", 560),
                        )
                        map_state.nodeDimensions[item.id] = size

        state = FieldworkState(items=items)
        project_store.save_map_state(project_id, map_state)
        return project_store.save_fieldwork(project_id, state)


fieldwork_service = FieldworkService()
