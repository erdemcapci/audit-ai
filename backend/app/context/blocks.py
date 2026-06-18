from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.context.block_registry import ContextBlockRegistry, ContextBlockRequest
from app.context.models import ContextBlock, ContextBlockMetadata
from app.services.audit_graph_service import DEFAULT_CONTEXT_RELATIONSHIPS


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

    def _summarize_item(self, request: ContextBlockRequest, item: dict[str, Any], include_data: bool = False) -> dict[str, Any]:
        return request.graph_service.compact_item(item, summary_mode=request.recipe.summary_mode, include_data=include_data)

    def _limit_items(self, request: ContextBlockRequest, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
        max_items = max(1, request.recipe.max_items_per_type)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            grouped[item.get("type", "unknown")].append(item)
        limited: list[dict[str, Any]] = []
        truncated = False
        for item_type in sorted(grouped):
            group = grouped[item_type]
            limited.extend(group[:max_items])
            truncated = truncated or len(group) > max_items
        return limited, truncated

    def _selected_items(self, request: ContextBlockRequest, include_data: bool = False) -> tuple[list[dict[str, Any]], bool]:
        items = [item for item_id in request.selected_item_ids if (item := request.graph.items.get(item_id))]
        limited, truncated = self._limit_items(request, [item.to_dict() for item in items])
        return [self._summarize_item(request, item, include_data=include_data) for item in limited], truncated

    def _related_entries(self, request: ContextBlockRequest, direction: str) -> tuple[list[dict[str, Any]], bool]:
        entries: list[dict[str, Any]] = []
        seen: set[str] = set()
        relationship_types = set(request.recipe.relationship_types) if request.recipe.relationship_types is not None else DEFAULT_CONTEXT_RELATIONSHIPS
        exclude_item_types = set(request.recipe.exclude_item_types or [])
        for item_id in request.selected_item_ids:
            related = request.graph_service.get_related_items(
                request.graph,
                item_id,
                depth=request.recipe.relationship_depth,
                direction=direction,
                relationship_types=relationship_types,
                exclude_item_types=exclude_item_types,
            )
            for entry in related:
                item = entry["item"]
                if request.recipe.item_type_filters and item["type"] not in request.recipe.item_type_filters:
                    continue
                key = item["id"]
                if key in seen:
                    continue
                seen.add(key)
                entries.append(entry)
        limited_items, truncated = self._limit_items(request, [entry["item"] for entry in entries])
        limited_ids = {item["id"] for item in limited_items}
        limited_entries = [entry for entry in entries if entry["item"]["id"] in limited_ids]
        return limited_entries, truncated

    def _related_content(self, request: ContextBlockRequest, direction: str) -> tuple[dict[str, Any], int, bool]:
        entries, truncated = self._related_entries(request, direction)
        items = [
            {
                "depth": entry["depth"],
                "direction": entry["direction"],
                "relationship_type": entry["relationship"]["type"],
                "item": self._summarize_item(request, entry["item"]),
            }
            for entry in entries
        ]
        return {"items": items}, len(items), truncated


class AuditOverviewBlock(BaseContextBlock):
    block_id = "audit_overview"
    title = "Audit Overview"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        audit = request.graph.audit
        return self._block(
            request,
            {
                "audit": {
                    "id": audit.id,
                    "title": audit.title,
                    "description": audit.description,
                    "process_area": audit.process_area,
                    "initial_concern": audit.initial_concern,
                    "extra_context": audit.extra_context,
                    "status": audit.status,
                }
            },
            item_count=1,
        )


class WorkflowStateBlock(BaseContextBlock):
    block_id = "workflow_state"
    title = "Workflow State"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        counts: dict[str, int] = defaultdict(int)
        phase_counts: dict[str, int] = defaultdict(int)
        for item in request.graph.items.values():
            counts[item.type] += 1
            phase_counts[item.phase] += 1
        relationship_gaps = request.graph_service.get_relationship_gaps(request.graph)
        phase = self._current_phase(counts)
        return self._block(
            request,
            {
                "current_phase": phase,
                "item_counts": dict(sorted(counts.items())),
                "phase_counts": dict(sorted(phase_counts.items())),
                "relationship_count": len(request.graph.relationships),
                "relationship_gap_count": len(relationship_gaps),
            },
            item_count=len(request.graph.items),
        )

    def _current_phase(self, counts: dict[str, int]) -> str:
        if counts.get("finding"):
            return "reporting"
        if counts.get("fieldwork_item") or counts.get("interview_role") or counts.get("document_request"):
            return "fieldwork"
        return "planning"


class SelectedItemsBlock(BaseContextBlock):
    block_id = "selected_items"
    title = "Selected Items"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        include_data = request.recipe.detail_mode in {"selected_full_related_summary", "full_with_limits"}
        items, truncated = self._selected_items(request, include_data=include_data)
        missing_ids = [item_id for item_id in request.selected_item_ids if item_id not in request.graph.items]
        return self._block(request, {"items": items, "missing_item_ids": missing_ids}, item_count=len(items), truncated=truncated)


class ConnectedItemsBlock(BaseContextBlock):
    block_id = "connected_items"
    title = "Connected Audit Items"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        content, count, truncated = self._related_content(request, request.recipe.direction)
        return self._block(request, content, item_count=count, truncated=truncated)


class UpstreamItemsBlock(BaseContextBlock):
    block_id = "upstream_items"
    title = "Upstream Items"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        content, count, truncated = self._related_content(request, "upstream")
        return self._block(request, content, item_count=count, truncated=truncated)


class DownstreamItemsBlock(BaseContextBlock):
    block_id = "downstream_items"
    title = "Downstream Items"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        content, count, truncated = self._related_content(request, "downstream")
        return self._block(request, content, item_count=count, truncated=truncated)


class ExistingOutputsBlock(BaseContextBlock):
    block_id = "existing_outputs"
    title = "Existing Outputs / Avoid Duplicates"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        raw_outputs = request.graph_service.get_existing_outputs_for_agent(request.graph, request.agent.type, request.selected_item_ids)
        outputs: dict[str, list[dict[str, Any]]] = {}
        truncated = False
        count = 0
        for source_id, items in raw_outputs.items():
            limited, was_truncated = self._limit_items(request, items)
            outputs[source_id] = [self._summarize_item(request, item) for item in limited]
            truncated = truncated or was_truncated
            count += len(outputs[source_id])
        return self._block(request, {"outputs_by_source": outputs}, item_count=count, truncated=truncated)


class TraceabilityChainBlock(BaseContextBlock):
    block_id = "traceability_chain"
    title = "Traceability Chain"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        chains: dict[str, Any] = {}
        item_count = 0
        truncated = False
        selected_ids = request.selected_item_ids[: max(1, request.recipe.max_items_per_type)]
        if len(request.selected_item_ids) > len(selected_ids):
            truncated = True
        for item_id in selected_ids:
            chain = request.graph_service.get_traceability_chain(request.graph, item_id)
            compact_chain = self._compact_chain(request, chain)
            chains[item_id] = compact_chain
            item_count += self._count_chain_items(compact_chain)
        return self._block(
            request,
            {
                "selected_item_count": len(selected_ids),
                "chain_count": len(chains),
                "chains_by_selected_item": chains,
            },
            item_count=item_count,
            truncated=truncated,
        )

    def _compact_chain(self, request: ContextBlockRequest, chain: dict[str, Any]) -> dict[str, Any]:
        compact: dict[str, Any] = {}
        for key, value in chain.items():
            if isinstance(value, list):
                compact[key] = [self._summarize_item(request, item) if self._looks_like_item(item) else item for item in value]
            elif self._looks_like_item(value):
                compact[key] = self._summarize_item(request, value, include_data=request.recipe.detail_mode == "full_with_limits")
            else:
                compact[key] = value
        return compact

    def _looks_like_item(self, value: Any) -> bool:
        return isinstance(value, dict) and "id" in value and "type" in value

    def _count_chain_items(self, chain: dict[str, Any]) -> int:
        count = 0
        for value in chain.values():
            if isinstance(value, list):
                count += sum(1 for item in value if self._looks_like_item(item))
            elif self._looks_like_item(value):
                count += 1
        return count


class RelationshipGapsBlock(BaseContextBlock):
    block_id = "relationship_gaps"
    title = "Relationship Gaps"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        gaps = request.graph_service.get_relationship_gaps(request.graph)
        limited_gaps = gaps[: max(1, request.recipe.max_items_per_type)]
        return self._block(
            request,
            {"gaps": limited_gaps},
            item_count=len(limited_gaps),
            truncated=len(gaps) > len(limited_gaps),
        )


class PhaseSummaryBlock(BaseContextBlock):
    phase = ""

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        items = request.graph_service.get_items_by_phase(request.graph, self.phase)
        limited, truncated = self._limit_items(request, items)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in limited:
            grouped[item["type"]].append(self._summarize_item(request, item))
        return self._block(request, {"items_by_type": dict(sorted(grouped.items()))}, item_count=len(limited), truncated=truncated)


class PlanningSummaryBlock(PhaseSummaryBlock):
    block_id = "planning_summary"
    title = "Planning Summary"
    phase = "planning"


class FieldworkSummaryBlock(PhaseSummaryBlock):
    block_id = "fieldwork_summary"
    title = "Fieldwork Summary"
    phase = "fieldwork"


class FindingsSummaryBlock(BaseContextBlock):
    block_id = "findings_summary"
    title = "Findings Summary"

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        findings = request.graph_service.get_items_by_type(request.graph, "finding")
        limited, truncated = self._limit_items(request, findings)
        return self._block(request, {"findings": [self._summarize_item(request, item) for item in limited]}, item_count=len(limited), truncated=truncated)


class ReportingSummaryBlock(PhaseSummaryBlock):
    block_id = "reporting_summary"
    title = "Reporting Summary"
    phase = "reporting"


def default_context_block_registry() -> ContextBlockRegistry:
    registry = ContextBlockRegistry()
    for provider in [
        AuditOverviewBlock(),
        WorkflowStateBlock(),
        SelectedItemsBlock(),
        ConnectedItemsBlock(),
        UpstreamItemsBlock(),
        DownstreamItemsBlock(),
        ExistingOutputsBlock(),
        TraceabilityChainBlock(),
        RelationshipGapsBlock(),
        PlanningSummaryBlock(),
        FieldworkSummaryBlock(),
        FindingsSummaryBlock(),
        ReportingSummaryBlock(),
    ]:
        registry.register(provider)
    return registry
