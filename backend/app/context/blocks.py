from __future__ import annotations

from typing import Any

from app.context.block_registry import ContextBlockRegistry, ContextBlockRequest
from app.context.models import ContextBlock, ContextBlockMetadata
from app.context.policy import PLANNING_CONTEXT_DOMAIN, PLANNING_GAP_TYPES
from app.services.audit_context_snapshot_service import audit_context_snapshot_service
from app.store.project_store import project_store


class BaseContextBlock:
    block_id = ""
    title = ""

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        raise NotImplementedError

    def _block(self, request: ContextBlockRequest, content: dict[str, Any], item_count: int = 0, truncated: bool = False, notes: list[str] | None = None) -> ContextBlock:
        return ContextBlock(
            block_id=self.block_id,
            title=self.title,
            content=content,
            metadata=ContextBlockMetadata(
                item_count=item_count,
                truncated=truncated,
                summary_mode=request.recipe.summary_mode,
                detail_mode=request.recipe.detail_mode,
                notes=notes or [],
            ),
        )

    def _limit_items(self, request: ContextBlockRequest, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
        max_items = max(1, request.recipe.max_items_per_type)
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            grouped.setdefault(item.get("type", "unknown"), []).append(item)
        limited: list[dict[str, Any]] = []
        truncated = False
        for item_type in sorted(grouped):
            group = grouped[item_type]
            limited.extend(group[:max_items])
            truncated = truncated or len(group) > max_items
        return limited, truncated


class PlanningContextBlock(BaseContextBlock):
    block_id = "planning_context"
    title = "Planning Context"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        audit = request.graph.audit
        planning = project_store.load_planning(request.project_id)
        relationship_gaps = [
            self._gap_ref(gap)
            for gap in request.graph_service.get_relationship_gaps(request.graph)
            if gap.get("gap_type") in PLANNING_GAP_TYPES
        ]
        content = {
            "domain": "planning",
            "audit": audit.model_dump(),
            "planning": planning.model_dump(),
            "item_counts": self._item_counts(planning),
            "relationship_gaps": relationship_gaps,
        }
        return self._block(
            request,
            content,
            item_count=1 + sum(content["item_counts"].values()),
            truncated=False,
        )

    def _item_counts(self, planning) -> dict[str, int]:
        objective_count = 0
        risk_count = 0
        test_count = 0
        for workstream in planning.workstreams:
            objective_count += len(workstream.objectives)
            for objective in workstream.objectives:
                risk_count += len(objective.risks)
                for risk in objective.risks:
                    test_count += len(risk.tests)
        return {
            "workstream": len(planning.workstreams),
            "objective": objective_count,
            "risk": risk_count,
            "test": test_count,
        }

    def _gap_ref(self, gap: dict[str, Any]) -> dict[str, Any]:
        item = gap.get("item") or {}
        return {
            "gap_type": gap.get("gap_type"),
            "message": gap.get("message"),
            "item": {
                "id": item.get("id"),
                "type": item.get("type"),
                "title": item.get("title"),
            },
        }


class GlobalAuditKnowledgeBlock(BaseContextBlock):
    block_id = "global_audit_knowledge"
    title = "Global Audit Knowledge"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        snapshot = audit_context_snapshot_service.get_snapshot(request.project_id, build_if_missing=True)
        if not snapshot:
            return self._block(
                request,
                {
                    "missing": True,
                    "message": "Audit context snapshot is missing. Rebuild it from the context snapshot endpoint.",
                },
                notes=["Snapshot missing."],
            )
        notes = ["Snapshot stale: audit changed since last update."] if snapshot.stale else []
        structured = snapshot.structured_summary
        content = {
            "stale": snapshot.stale,
            "generated_at": snapshot.generated_at,
            "current_phase": structured.get("current_phase", ""),
            "audit": structured.get("audit", {}),
            "summary_text": snapshot.summary_text,
            "item_counts": snapshot.item_counts,
            "planning": structured.get("planning_summary", {}),
            "fieldwork": structured.get("fieldwork_summary", {}),
            "findings": {
                "count": len(structured.get("findings_summary", [])),
                "items": structured.get("findings_summary", []),
            },
            "reporting": {
                "count": len(structured.get("reporting_summary", [])),
                "items": structured.get("reporting_summary", []),
            },
            "relationship_gaps": [self._gap_ref(gap) for gap in structured.get("relationship_gaps", [])],
            "generation_mode": snapshot.generation_mode,
            "truncated": snapshot.truncated,
        }
        if request.recipe.summary_mode in {"structured", "detailed"} or request.recipe.detail_mode in {"all_summary", "full_with_limits"}:
            content["structured_summary"] = snapshot.structured_summary
        if request.recipe.detail_mode == "full_with_limits":
            content["project_id"] = snapshot.project_id
            content["source_updated_at"] = snapshot.source_updated_at
            content["source_sections_used"] = snapshot.source_sections_used
        return self._block(
            request,
            content,
            item_count=sum(snapshot.item_counts.values()),
            truncated=snapshot.truncated,
            notes=notes,
        )

    def _gap_ref(self, gap: dict[str, Any]) -> dict[str, Any]:
        item = gap.get("item") or {}
        return {
            "gap_type": gap.get("gap_type"),
            "message": gap.get("message"),
            "item": {
                "id": item.get("id"),
                "type": item.get("type"),
                "title": item.get("title"),
            },
        }


class CurrentTaskBlock(BaseContextBlock):
    block_id = "current_task"
    title = "Current Task"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        selected_items = [item for item_id in request.selected_item_ids if (item := request.graph.items.get(item_id))]
        focus_items = [self._focus_item(request, item.to_dict()) for item in selected_items]
        existing_outputs = self._existing_output_refs(request)
        missing_ids = [item_id for item_id in request.selected_item_ids if item_id not in request.graph.items]
        return self._block(
            request,
            {
                "agent": {
                    "id": request.agent.id,
                    "type": request.agent.type,
                    "title": request.agent.title,
                    "config": request.agent.config,
                },
                "focus_items": focus_items,
                "existing_outputs_to_avoid": existing_outputs,
                "missing_focus_item_ids": missing_ids,
                "output_contract": "Provided in the Output Contract section of the current LLM request.",
            },
            item_count=len(focus_items) + sum(len(items) for items in existing_outputs.values()),
        )

    def _focus_item(self, request: ContextBlockRequest, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "item": self._task_item(request, item),
            "parent_hierarchy": self._parent_hierarchy(request, item["id"]),
        }

    def _parent_hierarchy(self, request: ContextBlockRequest, item_id: str) -> list[dict[str, Any]]:
        upstream = request.graph_service.get_upstream_items(
            request.graph,
            item_id,
            depth=4,
            relationship_types={"contains", "executed_as", "results_in"},
            exclude_item_types={"agent"},
        )
        ordered = sorted(upstream, key=lambda entry: entry["depth"], reverse=True)
        return [self._item_ref(entry["item"]) for entry in ordered]

    def _existing_output_refs(self, request: ContextBlockRequest) -> dict[str, list[dict[str, Any]]]:
        raw_outputs = request.graph_service.get_existing_outputs_for_agent(request.graph, request.agent.type, request.selected_item_ids)
        refs: dict[str, list[dict[str, Any]]] = {}
        for source_id, items in raw_outputs.items():
            if request.recipe.context_domain == PLANNING_CONTEXT_DOMAIN:
                refs[source_id] = [self._task_item(request, item) for item in items]
                continue
            limited, _truncated = self._limit_items(request, items)
            refs[source_id] = [self._item_ref(item) for item in limited]
        return refs

    def _task_item(self, request: ContextBlockRequest, item: dict[str, Any]) -> dict[str, Any]:
        if request.recipe.context_domain == PLANNING_CONTEXT_DOMAIN:
            return {
                "id": item.get("id"),
                "type": item.get("type"),
                "title": item.get("title"),
                "description": item.get("description"),
                "status": item.get("status"),
                "data": item.get("data", {}),
                "metadata": item.get("metadata", {}),
            }
        return self._item_ref(item)

    def _item_ref(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": item.get("id"),
            "type": item.get("type"),
            "title": item.get("title"),
            "status": item.get("status"),
        }


def default_context_block_registry() -> ContextBlockRegistry:
    registry = ContextBlockRegistry()
    for provider in [
        PlanningContextBlock(),
        GlobalAuditKnowledgeBlock(),
        CurrentTaskBlock(),
    ]:
        registry.register(provider)
    return registry
