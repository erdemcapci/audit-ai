from __future__ import annotations

from copy import deepcopy

from app.services.audit_graph_service import AuditGraph, AuditGraphItem


PLANNING_CONTEXT_DOMAIN = "planning"
FULL_CONTEXT_DOMAIN = "full"

PLANNING_ITEM_TYPES = {"audit", "workstream", "objective", "risk", "test"}
PLANNING_AGENT_TYPES = {"workstream_generator", "objective_generator", "risk_generator", "test_generator"}
PLANNING_BLOCK_IDS = {
    "planning_context",
    "current_task",
}
PLANNING_GAP_TYPES = {
    "objective_without_risk",
    "risk_without_test",
    "risk_without_objective",
    "test_without_risk",
}
PLANNING_RELATIONSHIP_TYPES = {"contains"}


class ContextPolicy:
    def __init__(self, domain: str = FULL_CONTEXT_DOMAIN) -> None:
        self.domain = domain

    @property
    def is_planning_only(self) -> bool:
        return self.domain == PLANNING_CONTEXT_DOMAIN

    def project_graph(self, graph: AuditGraph) -> AuditGraph:
        if not self.is_planning_only:
            return graph
        allowed_items: dict[str, AuditGraphItem] = {
            item_id: self._copy_item(item)
            for item_id, item in graph.items.items()
            if item.type in PLANNING_ITEM_TYPES
        }
        allowed_relationships = [
            deepcopy(relationship)
            for relationship in graph.relationships
            if relationship.source_id in allowed_items and relationship.target_id in allowed_items
            and relationship.type in PLANNING_RELATIONSHIP_TYPES
        ]
        return AuditGraph(
            project_id=graph.project_id,
            audit=graph.audit,
            items=allowed_items,
            relationships=allowed_relationships,
        )

    def project_block_ids(self, block_ids: list[str]) -> list[str]:
        if not self.is_planning_only:
            return block_ids
        return [block_id for block_id in block_ids if block_id in PLANNING_BLOCK_IDS]

    def project_selected_ids(self, graph: AuditGraph, selected_item_ids: list[str]) -> list[str]:
        if not self.is_planning_only:
            return selected_item_ids
        return [
            item_id
            for item_id in selected_item_ids
            if (item := graph.items.get(item_id)) and item.type in PLANNING_ITEM_TYPES
        ]

    def _copy_item(self, item: AuditGraphItem) -> AuditGraphItem:
        return AuditGraphItem(
            id=item.id,
            type=item.type,
            title=item.title,
            description=item.description,
            status=item.status,
            phase=item.phase,
            data=deepcopy(item.data),
            metadata=deepcopy(item.metadata),
        )


def context_policy_for_domain(domain: str) -> ContextPolicy:
    return ContextPolicy(domain)
