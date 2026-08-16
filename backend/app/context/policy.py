from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.services.audit_graph_service import AuditGraph, AuditGraphItem


PLANNING_CONTEXT_DOMAIN = "planning"
FULL_CONTEXT_DOMAIN = "full"

PLANNING_ITEM_TYPES = {"audit", "workstream", "objective", "risk", "test"}
PLANNING_AGENT_TYPES = {"workstream_generator", "objective_generator", "risk_generator", "test_generator"}
PLANNING_BLOCK_IDS = {
    "audit_overview",
    "global_audit_knowledge",
    "current_task",
    "selected_items",
    "connected_items",
    "upstream_items",
    "downstream_items",
    "existing_outputs",
    "planning_summary",
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

    def project_global_summary(self, structured: dict[str, Any]) -> dict[str, Any]:
        if not self.is_planning_only:
            return structured
        item_counts = {
            item_type: count
            for item_type, count in structured.get("item_counts", {}).items()
            if item_type in PLANNING_ITEM_TYPES - {"audit"}
        }
        relationship_gaps = [
            gap
            for gap in structured.get("relationship_gaps", [])
            if gap.get("gap_type") in PLANNING_GAP_TYPES
        ]
        return {
            "audit": structured.get("audit", {}),
            "current_phase": "planning",
            "item_counts": item_counts,
            "planning_summary": structured.get("planning_summary", {}),
            "workstreams_summary": structured.get("workstreams_summary", []),
            "objectives_summary": structured.get("objectives_summary", []),
            "risks_summary": structured.get("risks_summary", []),
            "tests_summary": structured.get("tests_summary", []),
            "relationship_gaps": relationship_gaps,
            "relationship_gap_count": len(relationship_gaps),
            "key_open_items": self._planning_status_items(structured.get("key_open_items", [])),
            "key_completed_items": self._planning_status_items(structured.get("key_completed_items", [])),
            "warnings": self._planning_warnings(relationship_gaps),
        }

    def source_sections_used(self) -> list[str]:
        if not self.is_planning_only:
            return []
        return [
            "audit",
            "planning_summary",
            "relationship_gaps",
            "key_open_items",
            "key_completed_items",
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

    def _planning_status_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [item for item in items if item.get("type") in PLANNING_ITEM_TYPES]

    def _planning_warnings(self, gaps: list[dict[str, Any]]) -> list[str]:
        warnings: list[str] = []
        for gap in gaps:
            gap_type = str(gap.get("gap_type", "")).replace("_", " ")
            message = str(gap.get("message", "")).strip()
            warnings.append(f"{gap_type}: {message}" if message else gap_type)
        return warnings


def context_policy_for_domain(domain: str) -> ContextPolicy:
    return ContextPolicy(domain)
