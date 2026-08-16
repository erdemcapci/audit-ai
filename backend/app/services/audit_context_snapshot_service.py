from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from typing import Any

from app.models import AuditContextSnapshot, utc_now
from app.services.audit_graph_service import AuditGraph, AuditGraphService, audit_graph_service
from app.store.project_store import project_store


SNAPSHOT_FILE = "audit_context_snapshot.json"
MAX_ITEMS_PER_SECTION = 8
MAX_WARNINGS = 12


class AuditContextSnapshotService:
    def __init__(self, graph_service: AuditGraphService | None = None) -> None:
        self.graph_service = graph_service or audit_graph_service

    def get_snapshot(self, project_id: str, *, build_if_missing: bool = False) -> AuditContextSnapshot | None:
        path = project_store.project_dir(project_id) / SNAPSHOT_FILE
        if not path.exists():
            return self.rebuild(project_id) if build_if_missing else None
        snapshot = AuditContextSnapshot.model_validate(project_store.file_store.read_json(path, {}))
        current_fingerprint = self.source_fingerprint(project_id)
        snapshot.stale = snapshot.source_fingerprint != current_fingerprint
        return snapshot

    def rebuild(self, project_id: str) -> AuditContextSnapshot:
        graph = self.graph_service.build_graph(project_id)
        fingerprint = self.source_fingerprint(project_id)
        structured = self._structured_summary(graph)
        summary_text = self._summary_text(graph, structured)
        snapshot = AuditContextSnapshot(
            project_id=graph.audit.id,
            generated_at=utc_now(),
            source_updated_at=graph.audit.updated_at,
            source_fingerprint=fingerprint,
            stale=False,
            summary_text=summary_text,
            structured_summary=structured,
            item_counts=structured["item_counts"],
            relationship_gap_count=len(structured["relationship_gaps"]),
            source_sections_used=list(structured.keys()),
            generation_mode="deterministic",
            truncated=self._is_truncated(graph, structured),
        )
        self._save(snapshot)
        return snapshot

    def source_fingerprint(self, project_id: str) -> str:
        audit = project_store.get_project(project_id)
        payload = {
            "audit": audit.model_dump(),
            "planning": project_store.load_planning(audit.id).model_dump(),
            "fieldwork": project_store.load_fieldwork(audit.id).model_dump(),
            "findings": project_store.load_findings(audit.id).model_dump(),
            "report": project_store.load_report(audit.id).model_dump(),
            "map_edges": [edge.model_dump() for edge in project_store.load_map_state(audit.id).edges],
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _save(self, snapshot: AuditContextSnapshot) -> None:
        path = project_store.project_dir(snapshot.project_id) / SNAPSHOT_FILE
        project_store.file_store.write_json(path, snapshot.model_dump())

    def _structured_summary(self, graph: AuditGraph) -> dict[str, Any]:
        items_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in graph.items.values():
            if item.type == "agent":
                continue
            items_by_type[item.type].append(item.to_dict())

        gaps = self.graph_service.get_relationship_gaps(graph)
        warnings = self._warnings(gaps)
        open_items = self._status_items(items_by_type, open_status=True)
        completed_items = self._status_items(items_by_type, open_status=False)
        return {
            "audit": {
                "id": graph.audit.id,
                "title": graph.audit.title,
                "description": graph.audit.description,
                "process_area": graph.audit.process_area,
                "initial_concern": graph.audit.initial_concern,
                "extra_context": graph.audit.extra_context,
                "status": graph.audit.status,
            },
            "current_phase": self._current_phase(items_by_type),
            "item_counts": dict(sorted((item_type, len(items)) for item_type, items in items_by_type.items())),
            "planning_summary": self._section(items_by_type, ["workstream", "objective", "risk", "test"]),
            "workstreams_summary": self._items(items_by_type.get("workstream", [])),
            "objectives_summary": self._items(items_by_type.get("objective", [])),
            "risks_summary": self._items(items_by_type.get("risk", [])),
            "tests_summary": self._items(items_by_type.get("test", [])),
            "fieldwork_summary": self._section(items_by_type, ["fieldwork_item"]),
            "findings_summary": self._items(items_by_type.get("finding", [])),
            "reporting_summary": self._items(items_by_type.get("report", [])),
            "relationship_gaps": gaps[:MAX_WARNINGS],
            "relationship_gap_count": len(gaps),
            "key_open_items": open_items,
            "key_completed_items": completed_items,
            "warnings": warnings,
        }

    def _summary_text(self, graph: AuditGraph, structured: dict[str, Any]) -> str:
        counts = structured["item_counts"]
        lines = [
            f"Audit: {graph.audit.title}",
            f"Status/phase: {graph.audit.status} / {structured['current_phase']}",
            f"Audit description: {graph.audit.description or 'No description provided.'}",
            "Counts: "
            + ", ".join(f"{item_type}={count}" for item_type, count in counts.items() if count)
            if counts
            else "Counts: no audit items recorded.",
            f"Traceability warnings: {structured['relationship_gap_count']}",
        ]
        if structured["warnings"]:
            lines.append("Important warnings:")
            lines.extend(f"- {warning}" for warning in structured["warnings"][:5])
        if structured["key_open_items"]:
            lines.append("Key open items:")
            lines.extend(f"- {item['type']}: {item['title']}" for item in structured["key_open_items"][:5])
        if structured["key_completed_items"]:
            lines.append("Key completed items:")
            lines.extend(f"- {item['type']}: {item['title']}" for item in structured["key_completed_items"][:5])
        return "\n".join(lines)

    def _section(self, items_by_type: dict[str, list[dict[str, Any]]], item_types: list[str]) -> dict[str, Any]:
        return {
            item_type: {
                "count": len(items_by_type.get(item_type, [])),
                "items": self._items(items_by_type.get(item_type, [])),
            }
            for item_type in item_types
        }

    def _items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        compact_items: list[dict[str, Any]] = []
        for item in items[:MAX_ITEMS_PER_SECTION]:
            compact = self.graph_service.compact_item(item, summary_mode="compact", include_data=False)
            metadata = item.get("metadata") or {}
            parent_ids = {
                key: value
                for key, value in {
                    "workstream_id": metadata.get("workstream_id"),
                    "objective_id": metadata.get("objective_id"),
                    "risk_id": metadata.get("risk_id"),
                    "test_id": metadata.get("test_id") or metadata.get("source_test_id"),
                    "source_node_id": metadata.get("source_node_id"),
                    "linked_fieldwork_item_id": metadata.get("linked_fieldwork_item_id"),
                    "role_id": metadata.get("role_id"),
                }.items()
                if value
            }
            if parent_ids:
                compact["parent_ids"] = parent_ids
            compact_items.append(compact)
        return compact_items

    def _status_items(self, items_by_type: dict[str, list[dict[str, Any]]], *, open_status: bool) -> list[dict[str, Any]]:
        closed = {"confirmed", "ready for report", "completed", "done", "approved"}
        result: list[dict[str, Any]] = []
        for item_type in ["objective", "risk", "test", "fieldwork_item", "finding", "report"]:
            for item in items_by_type.get(item_type, []):
                status = str(item.get("status", "")).strip().lower()
                is_closed = status in closed
                if open_status != is_closed:
                    result.extend(self._items([item]))
                if len(result) >= MAX_ITEMS_PER_SECTION:
                    return result
        return result

    def _warnings(self, gaps: list[dict[str, Any]]) -> list[str]:
        counts = Counter(gap.get("gap_type", "relationship_gap") for gap in gaps)
        warnings = [f"{count} {gap_type.replace('_', ' ')}" for gap_type, count in counts.most_common(MAX_WARNINGS)]
        warnings.extend(str(gap.get("message", "")) for gap in gaps[:MAX_WARNINGS] if gap.get("message"))
        return warnings[:MAX_WARNINGS]

    def _current_phase(self, items_by_type: dict[str, list[dict[str, Any]]]) -> str:
        report_items = items_by_type.get("report", [])
        has_report_content = any(
            str(value or "").strip()
            for item in report_items
            for value in item.get("data", {}).values()
            if isinstance(value, str)
        )
        if items_by_type.get("finding") or has_report_content:
            return "reporting"
        if items_by_type.get("fieldwork_item"):
            return "fieldwork"
        return "planning"

    def _is_truncated(self, graph: AuditGraph, structured: dict[str, Any]) -> bool:
        return any(count > MAX_ITEMS_PER_SECTION for count in structured["item_counts"].values()) or len(self.graph_service.get_relationship_gaps(graph)) > MAX_WARNINGS

    def _shorten(self, value: str, limit: int = 220) -> str:
        text = " ".join(str(value or "").split())
        return text if len(text) <= limit else f"{text[: limit - 3].rstrip()}..."


audit_context_snapshot_service = AuditContextSnapshotService()
